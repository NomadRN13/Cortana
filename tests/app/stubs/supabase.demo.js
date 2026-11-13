// The demo build: no backend configured, exactly as mobile/src/lib/supabase.js
// reports when the two EXPO_PUBLIC_ variables aren't set. The state layer then
// runs every action against the seeded local data and must call nothing.
export const isBackendConfigured = false;
export const supabase = null;
