const store = {};

// Wiping between mounts is how a test says "fresh install".
export const reset = () => { Object.keys(store).forEach((k) => delete store[k]); };
export default {
  getItem: (k) => Promise.resolve(k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; return Promise.resolve(); },
  removeItem: (k) => { delete store[k]; return Promise.resolve(); },
};
