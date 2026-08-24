const store = {};
export default {
  getItem: (k) => Promise.resolve(k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; return Promise.resolve(); },
  removeItem: (k) => { delete store[k]; return Promise.resolve(); },
};
