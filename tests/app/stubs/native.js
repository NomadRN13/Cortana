// Native-only modules the state layer touches at boot but this harness doesn't need.
export const getDeviceKey = () => Promise.resolve('device-key');
export const getDeviceName = () => 'Test Device';
export const getPlatform = () => 'ios';
export const registerForPush = () => Promise.resolve(null);
// No location by default; a test sets nativeImpl.coarseLocation = { lat, lng }.
export const nativeImpl = { coarseLocation: null };
export const getCoarseLocation = () => Promise.resolve(nativeImpl.coarseLocation || null);
export const signOutProviders = () => Promise.resolve();
export const signInWithApple = () => Promise.resolve(null);
export const signInWithGoogle = () => Promise.resolve(null);
export const isAppleAvailable = () => Promise.resolve(false);
