export const isBackendConfigured = true;
const SESSION = { user: { id: 'me-uuid' } };
export const supabase = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: SESSION } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getUser: () => Promise.resolve({ data: { user: SESSION.user } }),
  },
};
