// Native-only modules the state layer touches at boot but this harness doesn't need.
export const getDeviceKey = () => Promise.resolve('device-key');
export const getDeviceName = () => 'Test Device';
export const getPlatform = () => 'ios';
export const registerForPush = () => Promise.resolve(null);
// No location by default; a test sets nativeImpl.coarseLocation = { lat, lng }.
// The phone's timezone is a fixed, real zone by default; a test sets
// nativeImpl.timezone to another IANA name, or to null for a phone that can't say.
export const nativeImpl = { coarseLocation: null, timezone: 'America/Indiana/Indianapolis' };
export const getCoarseLocation = () => Promise.resolve(nativeImpl.coarseLocation || null);
export const getDeviceTimezone = () => nativeImpl.timezone || null;
export const signOutProviders = () => Promise.resolve();
export const signInWithApple = () => Promise.resolve(null);
export const signInWithGoogle = () => Promise.resolve(null);
export const isAppleAvailable = () => Promise.resolve(false);
