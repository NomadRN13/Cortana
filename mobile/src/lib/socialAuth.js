// Sign in with Apple / Continue with Google.
//
// Both providers need native modules that do NOT exist inside Expo Go, and the
// Google module throws the moment its native side is touched. So nothing here
// runs at import time: every native module is required lazily inside a guard,
// and if a module or its configuration is missing the corresponding button
// simply never renders. The app keeps working on email codes, in Expo Go and
// in demo mode alike.
//
// Nonce, the part most guides get wrong: expo-apple-authentication passes our
// nonce to Apple verbatim, and Supabase hashes whatever we hand it before
// comparing. So Apple gets the HASHED value and Supabase gets the RAW one.
// Swapping them fails with "Passed nonce and nonce in id_token must align".
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Google's native SDK needs these; without them we hide the button rather than
// show one that fails. Set in mobile/.env — see docs/backend-setup.md.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';

function loadApple() {
  try {
    return require('expo-apple-authentication');
  } catch (e) {
    return null; // not installed / not in this binary
  }
}

function loadCrypto() {
  try {
    return require('expo-crypto');
  } catch (e) {
    return null;
  }
}

let googleConfigured = false;
function loadGoogle() {
  if (!GOOGLE_WEB_CLIENT_ID) return null; // unconfigured → feature off
  let mod;
  try {
    mod = require('@react-native-google-signin/google-signin');
  } catch (e) {
    return null;
  }
  if (!mod || !mod.GoogleSignin) return null;
  if (!googleConfigured) {
    try {
      mod.GoogleSignin.configure({
        // On Android the id_token's audience is the WEB client id, never the
        // Android one — the Android client only binds package name + SHA-1.
        webClientId: GOOGLE_WEB_CLIENT_ID,
        iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
        scopes: ['profile', 'email'],
      });
      googleConfigured = true;
    } catch (e) {
      return null; // native side absent (Expo Go)
    }
  }
  return mod;
}

// ---------- availability (drives whether a button renders at all) ----------

export async function appleSignInAvailable() {
  if (Platform.OS !== 'ios') return false; // expo-apple-authentication is iOS-only
  if (!supabase) return false;
  const Apple = loadApple();
  const Crypto = loadCrypto();
  if (!Apple || !Crypto) return false;
  try {
    return await Apple.isAvailableAsync();
  } catch (e) {
    return false;
  }
}

export function googleSignInAvailable() {
  if (!supabase) return false;
  return !!loadGoogle();
}

// A cancelled sign-in is a normal user choice, not an error to shout about.
export function isCancelledSignIn(e) {
  const code = (e && e.code) || '';
  return (
    code === 'ERR_REQUEST_CANCELED' ||
    code === 'ERR_CANCELED' ||
    code === 'SIGN_IN_CANCELLED' ||
    code === '-5' || // Android SIGN_IN_CANCELLED
    code === '12501'
  );
}

// ---------- Apple ----------

async function makeNonce(Crypto) {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

export async function signInWithApple() {
  const Apple = loadApple();
  const Crypto = loadCrypto();
  if (!Apple || !Crypto || !supabase) throw new Error('Apple sign-in isn’t available on this device.');

  const { raw, hashed } = await makeNonce(Crypto);
  const credential = await Apple.signInAsync({
    requestedScopes: [
      Apple.AppleAuthenticationScope.FULL_NAME,
      Apple.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashed, // Apple echoes this into the token's nonce claim, unchanged
  });
  if (!credential.identityToken) throw new Error('Apple didn’t return a sign-in token. Try again.');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: raw, // Supabase hashes this itself before comparing
  });
  if (error) throw error;

  // Apple hands over the name only on the FIRST authorization, ever, and it is
  // not in the token — so capture it now or it's gone for good.
  const fn = credential.fullName;
  const firstName = (fn && fn.givenName) || '';
  if (firstName) {
    supabase.auth.updateUser({ data: { given_name: firstName } }).catch(() => {});
  }

  // Same deal with the authorization code, but on a five-minute fuse: it is
  // the only thing exchangeable for a token that can later revoke this Apple
  // sign-in, which the App Store requires when the account is deleted. Hand it
  // straight to the edge function. Deliberately not awaited — if it fails the
  // member is still signed in, and sign-in should not hang on it.
  if (credential.authorizationCode) {
    supabase.functions
      .invoke('apple-auth', { body: { action: 'link', code: credential.authorizationCode } })
      .catch(() => {});
  }
  return { firstName };
}

// Tell Apple to let go of this account. Called just before deletion; see
// supabase/functions/apple-auth. Best effort by design — a member who asked
// to be deleted must not be held hostage by Apple's endpoint being down.
export async function revokeAppleAccount() {
  if (!supabase) return;
  try {
    await supabase.functions.invoke('apple-auth', { body: { action: 'revoke' } });
  } catch {
    // swallowed on purpose: deletion proceeds regardless
  }
}

// ---------- Google ----------

export async function signInWithGoogle() {
  const G = loadGoogle();
  if (!G || !supabase) throw new Error('Google sign-in isn’t available on this device.');
  const { GoogleSignin, isSuccessResponse } = G;

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();

  // v13+ returns { type: 'success' | 'cancelled', data }; older returns the
  // user object directly. Handle both so a dependency bump can't break sign-in.
  const payload = isSuccessResponse
    ? (isSuccessResponse(response) ? response.data : null)
    : response;
  if (!payload) return null; // dismissed
  const idToken = payload.idToken || (payload.user && payload.user.idToken);
  if (!idToken) throw new Error('Google didn’t return a sign-in token. Try again.');

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;

  const given = (payload.user && payload.user.givenName) || '';
  return { firstName: given };
}

// Sign the native SDKs out too, so the next sign-in shows the account picker
// instead of silently reusing the last account.
export async function signOutProviders() {
  const G = GOOGLE_WEB_CLIENT_ID ? loadGoogle() : null;
  if (G && G.GoogleSignin) {
    try { await G.GoogleSignin.signOut(); } catch (e) { /* wasn't signed in */ }
  }
}
