// The App Review sign-in path in mobile/src/api/backend.js, bundled for real
// (not stubbed) against a fake Supabase client that records every auth call.
//   - With EXPO_PUBLIC_REVIEW_EMAIL set, that one address sends no email and
//     its six-digit "code" is checked as the account's password.
//   - Every other address, and every address when the variable is unset,
//     goes through the normal emailed code.
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const src = path.join(__dirname, '..', '..', 'mobile', 'src', 'api', 'backend.js');
const out = path.join(__dirname, '.build');
fs.mkdirSync(out, { recursive: true });

let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${ok ? '' : ' :: ' + JSON.stringify(got)}`); if (!ok) failed++; };

const FAKE_SUPABASE = `
  const ok = (name) => (args) => { globalThis.__authCalls.push({ name, args }); return Promise.resolve({ data: { session: { via: name } }, error: null }); };
  module.exports = { supabase: { auth: { signInWithOtp: ok('signInWithOtp'), verifyOtp: ok('verifyOtp'), signInWithPassword: ok('signInWithPassword') } } };`;

async function build(reviewEmail) {
  const file = path.join(out, `backend.review-${reviewEmail ? 'on' : 'off'}.cjs`);
  await esbuild.build({
    entryPoints: [src], bundle: true, platform: 'node', format: 'cjs', outfile: file, logLevel: 'silent',
    define: { 'process.env.EXPO_PUBLIC_REVIEW_EMAIL': JSON.stringify(reviewEmail) },
    plugins: [{
      name: 'fakes',
      setup(b) {
        b.onResolve({ filter: /lib\/(supabase|socialAuth)$/ }, (a) => ({ path: path.basename(a.path), namespace: 'fake' }));
        b.onResolve({ filter: /^(expo-|react-native)/ }, () => ({ path: 'native', namespace: 'fake' }));
        b.onLoad({ filter: /.*/, namespace: 'fake' }, (a) => ({
          contents: a.path === 'supabase' ? FAKE_SUPABASE : a.path === 'native' ? 'module.exports = {};' : 'module.exports = { revokeAppleAccount: () => Promise.resolve() };',
          loader: 'js',
        }));
      },
    }],
  });
  delete require.cache[require.resolve(file)];
  return require(file);
}

(async () => {
  const calls = (globalThis.__authCalls = []);
  const names = () => calls.splice(0).map((c) => c.name).join(',');

  const on = await build('Review@RSVPlayApp.com');
  await on.signInWithEmail('review@rsvplayapp.com');
  check('no email is sent for the review address', names() === '', calls);
  let s = await on.verifyOtp('review@rsvplayapp.com', '739215');
  const pw = calls[0];
  check('its six digits are checked as the password', s.via === 'signInWithPassword' && pw.args.password === '739215' && pw.args.email === 'review@rsvplayapp.com', calls);
  names();
  s = await on.verifyOtp('  REVIEW@rsvplayapp.com ', '739215');
  check('case and spaces in the address do not matter', s.via === 'signInWithPassword', s); names();
  await on.signInWithEmail('someone@example.com');
  s = await on.verifyOtp('someone@example.com', '123456');
  check('everyone else is emailed a code and verifies it', names() === 'signInWithOtp,verifyOtp' && s.via === 'verifyOtp', s);
  check('a near-miss address is not the review account', !on.isReviewEmail('review@rsvplayapp.com.evil.com') && !on.isReviewEmail('xreview@rsvplayapp.com') && !on.isReviewEmail(''), null);

  const off = await build('');
  await off.signInWithEmail('review@rsvplayapp.com');
  s = await off.verifyOtp('review@rsvplayapp.com', '739215');
  check('with no review address configured, the path does not exist', names() === 'signInWithOtp,verifyOtp' && s.via === 'verifyOtp', s);
  check('and no address counts as the review account', !off.isReviewEmail('review@rsvplayapp.com') && !off.isReviewEmail(''), null);

  console.log(failed ? `\n${failed} failing` : '\nall green');
  process.exit(failed ? 1 : 0);
})();
