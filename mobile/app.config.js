// Wraps app.json (still the source of truth) with the two things a static
// file can't decide: whether a store build has its backend keys, and whether
// Google sign-in's native setup should be included.
//
// 1. A production build without EXPO_PUBLIC_SUPABASE_URL and
//    EXPO_PUBLIC_SUPABASE_ANON_KEY would silently run in demo mode, with
//    sample players, and be sent to the stores that way. EAS cloud builds do
//    not see mobile/.env (it is git-ignored), so the keys must be EAS
//    environment variables for the "production" environment. Without them
//    the build stops here, with this message, before anything is uploaded.
// 2. Google sign-in needs a URL scheme on iOS or the SDK crashes on tap. The
//    plugin is added only when the iOS client id is set; with no ids the
//    button never renders (src/lib/socialAuth.js) and nothing is added.
// 3. Android push needs google-services.json from Firebase; it is used when
//    present at mobile/google-services.json (git-ignored, or an EAS file
//    variable named GOOGLE_SERVICES_JSON).
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile === 'production') {
    const missing = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']
      .filter((k) => !process.env[k] || /YOUR_/.test(process.env[k]));
    if (missing.length) {
      throw new Error(
        `Production build stopped: ${missing.join(' and ')} not set. Without them the app ships in demo mode. `
        + 'Add them with `eas env:create --environment production` (see docs/store-submission.md).'
      );
    }
  }

  const plugins = [...(config.plugins || [])];
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID && iosClientId) {
    const scheme = `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: scheme }]);
  }

  const android = { ...(config.android || {}) };
  const gsf = process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, 'google-services.json');
  if (fs.existsSync(gsf)) android.googleServicesFile = gsf;

  return { ...config, plugins, android };
};
