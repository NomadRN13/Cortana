// Encrypted storage for everything the app keeps on the phone that is about
// the member: the sign-in session, the cached profile (which includes gender
// and who they are looking for), their settings and their saved list.
//
// WHERE THE ENCRYPTION COMES FROM. Values go into the operating system's own
// secure store through expo-secure-store: the Keychain on iPhone, and on
// Android values encrypted with AES-256-GCM under a key held in the Android
// Keystore. No cipher is implemented in this file or shipped in the app; the
// app only uses the encryption built into the phone. That is deliberate — it
// is the strongest storage a phone offers, and it keeps the App Store's export
// answer at "exempt" (mobile/app.json, usesNonExemptEncryption: false).
//
// Same interface as AsyncStorage (getItem / setItem / removeItem), so it can
// be handed to the Supabase client as its `storage` and used by state.js.
//
// Four things a plain SecureStore call does not give you, handled here:
//   1. SIZE. A single secure-store value should stay under 2048 bytes and a
//      session is larger, so a value is split into chunks.
//   2. ATOMIC WRITES. Chunks are written under a new generation and then one
//      small pointer is flipped; a crash mid-write leaves the old value whole.
//   3. UNINSTALL. The iPhone Keychain survives deleting the app. A marker in
//      AsyncStorage (which does not survive) tells a fresh install to throw
//      away anything a previous install left behind, so "I deleted the app"
//      really does sign the phone out.
//   4. OLDER BUILDS. A value an earlier build left unencrypted in
//      AsyncStorage is moved across the first time it is read, then erased.
//
// On the web (the browser preview of the app, never a store build) there is
// no secure store, so this falls back to AsyncStorage.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const CHUNK = 1800;                       // characters; the encoding below is ASCII, so bytes too
const INSTALL_MARK = 'rsvplay.secure.installed';
const passthrough = Platform.OS === 'web';

// Readable after the first unlock (a push can arrive while the phone is
// locked), never copied into a backup or onto another device.
const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// Secure-store keys may only contain letters, digits, ".", "-" and "_".
const safe = (key) => String(key).replace(/[^A-Za-z0-9._-]/g, '_');
const pointer = (key) => `${safe(key)}.p`;
const chunkKey = (key, gen, i) => `${safe(key)}.${gen}.${i}`;

// ASCII-only and reversible, so a chunk boundary can never split a character.
const encode = (s) => String(s).replace(/[%\u0080-￿]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const decode = (s) => s.replace(/%([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

// Is this the first run of this install? Decided once, before anything is read.
let fresh = null;
const touched = new Set();
const installCheck = (async () => {
  if (passthrough) { fresh = false; return; }
  try {
    fresh = (await AsyncStorage.getItem(INSTALL_MARK)) == null;
    if (fresh) await AsyncStorage.setItem(INSTALL_MARK, '1');
  } catch (e) {
    fresh = false;   // can't tell: keep what is there rather than sign someone out
  }
})();

// One operation per key at a time, in the order they were asked for.
const queues = {};
const inOrder = (key, op) => {
  const next = (queues[key] || Promise.resolve()).then(op, op);
  queues[key] = next.catch(() => {});
  return next;
};

async function readPointer(key) {
  const raw = await SecureStore.getItemAsync(pointer(key), OPTS);
  const m = raw && /^([ab]):(\d+)$/.exec(raw);
  return m ? { gen: m[1], n: Number(m[2]) } : null;
}

async function dropChunks(key, gen, n) {
  await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, gen, i), OPTS).catch(() => {})));
}

async function erase(key) {
  const p = await readPointer(key);
  await SecureStore.deleteItemAsync(pointer(key), OPTS).catch(() => {});
  if (p) await dropChunks(key, p.gen, p.n);
}

async function write(key, value) {
  const text = encode(value);
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
  if (!parts.length) parts.push('');
  const old = await readPointer(key);
  const gen = old && old.gen === 'a' ? 'b' : 'a';
  try {
    const done = await Promise.allSettled(parts.map((part, i) => SecureStore.setItemAsync(chunkKey(key, gen, i), part, OPTS)));
    const bad = done.find((d) => d.status === 'rejected');
    if (bad) throw bad.reason;
    await SecureStore.setItemAsync(pointer(key), `${gen}:${parts.length}`, OPTS);   // the switch
  } catch (e) {
    await dropChunks(key, gen, parts.length);   // leave no half-written pieces behind
    throw e;
  }
  if (old) await dropChunks(key, old.gen, old.n);
}

async function read(key) {
  const p = await readPointer(key);
  if (!p) return null;
  const parts = await Promise.all(Array.from({ length: p.n }, (_, i) => SecureStore.getItemAsync(chunkKey(key, p.gen, i), OPTS)));
  if (parts.some((x) => x == null)) { await erase(key); return null; }   // incomplete: treat as absent
  return decode(parts.join(''));
}

const secureStorage = {
  getItem(key) {
    if (passthrough) return AsyncStorage.getItem(key);
    return inOrder(key, async () => {
      await installCheck;
      // A previous install's leftovers (the Keychain outlives the app).
      if (fresh && !touched.has(key)) { touched.add(key); await erase(key); }
      const stored = await read(key);
      if (stored != null) return stored;
      // An earlier build kept this unencrypted: move it across, then erase it.
      const legacy = await AsyncStorage.getItem(key);
      if (legacy == null) return null;
      await write(key, legacy);
      await AsyncStorage.removeItem(key);
      return legacy;
    });
  },

  setItem(key, value) {
    if (passthrough) return AsyncStorage.setItem(key, value);
    return inOrder(key, async () => {
      await installCheck;
      touched.add(key);
      await write(key, value);
      await AsyncStorage.removeItem(key).catch(() => {});   // never leave an unencrypted copy behind
    });
  },

  removeItem(key) {
    if (passthrough) return AsyncStorage.removeItem(key);
    return inOrder(key, async () => {
      await installCheck;
      touched.add(key);
      await erase(key);
      await AsyncStorage.removeItem(key).catch(() => {});
    });
  },
};

export default secureStorage;
