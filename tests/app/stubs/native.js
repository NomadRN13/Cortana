// Native-only modules the state layer touches at boot but this harness doesn't need.
export const getDeviceKey = () => Promise.resolve('device-key');
export const getDeviceName = () => 'Test Device';
export const getPlatform = () => 'ios';
export const registerForPush = () => Promise.resolve(null);
export const getCoarseLocation = () => Promise.resolve(null);
export const signOutProviders = () => Promise.resolve();
export const signInWithApple = () => Promise.resolve(null);
export const signInWithGoogle = () => Promise.resolve(null);
export const isAppleAvailable = () => Promise.resolve(false);
