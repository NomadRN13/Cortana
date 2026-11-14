// Supabase client. The app runs in demo mode (seeded local data) until the
// two EXPO_PUBLIC_ env vars are set — see ../../.env.example and
// docs/backend-setup.md.
import 'react-native-url-polyfill/auto';
import secureStorage from './secureStorage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isBackendConfigured = Boolean(url && anonKey);

export const supabase = isBackendConfigured
  ? createClient(url, anonKey, {
      auth: {
        // The session is the key to the account: it lives in the phone's secure
        // store (Keychain / Android Keystore, AES-256), never in plain storage.
        storage: secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
