// A stable identifier for this install, plus a human name for it.
//
// Deliberately NOT a hardware identifier: Apple and Google both restrict
// those, and we don't need one. This is a random key generated the first
// time the app runs and kept in the app's own storage, so it dies with an
// uninstall — which is the behaviour you want anyway ("this phone forgot
// me" should mean it's gone from the list).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const DEVICE_KEY = '40love.device';

let cachedKey = null;

function randomKey() {
  // 32 hex chars; enough that two installs will never collide, and it
  // satisfies the 8..64 length the database checks.
  let out = '';
  for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export async function getDeviceKey() {
  if (cachedKey) return cachedKey;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_KEY);
    if (stored && stored.length >= 8) {
      cachedKey = stored;
      return cachedKey;
    }
  } catch (e) { /* fall through and mint a new one */ }
  cachedKey = randomKey();
  AsyncStorage.setItem(DEVICE_KEY, cachedKey).catch(() => {});
  return cachedKey;
}

// "Aaron's iPhone" when the OS will tell us, otherwise the model, otherwise
// something honest rather than blank.
export function getDeviceName() {
  try {
    const Device = require('expo-device');
    return Device.deviceName || Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
  } catch (e) {
    return Platform.OS === 'ios' ? 'iPhone' : 'Android phone';
  }
}

export function getPlatform() {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'unknown';
}
