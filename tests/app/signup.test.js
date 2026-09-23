// The phone step is a hard gate: nobody reaches the app without passing it. So
// when it fails, the message has to point at whoever can actually fix it. An
// unconfigured SMS provider blocks 100% of signups and Supabase reports it in
// language that reads like the tester's number is wrong.
//
//   ./scripts/test-app.sh
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const TestRenderer = (() => {
  const { warn, error } = console;
  const quiet = (f) => (m, ...r) => (String(m).includes('react-test-renderer is deprecated') ? undefined : f(m, ...r));
  console.warn = quiet(warn); console.error = quiet(error);
  const tr = require('react-test-renderer');
  console.warn = warn; console.error = error;
  return tr;
})();
const { AppStateProvider, useApp, impl, resetStorage } = require('./.build/state.cjs');

let app = null;
function Probe() { app = useApp(); return null; }
const tick = (n = 40) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

const said = async (fn) => {
  let msg = null;
  await act(async () => { try { await fn(); } catch (e) { msg = e.message; } await tick(10); });
  return msg;
};

async function main() {
  resetStorage();
  impl.getMyProfile = () => null;
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(60); });

  // A bad number is the tester's to fix, and never reaches the server.
  let calls = 0;
  impl.startPhoneVerification = () => { calls += 1; };
  const bad = await said(() => app.requestPhoneCode('555-12'));
  check('a short number is rejected before anything is sent', /10-digit/.test(bad || ''), bad);
  check('and no code was requested for it', calls === 0, calls);

  // These are the ways Supabase says "no SMS provider is set up".
  const providerFaults = [
    'Error sending confirmation OTP to provider',
    'Unsupported phone provider',
    'Signups not allowed for otp: phone provider is disabled',
    'Error sending sms: twilio: authentication failed',
    'phone_provider_disabled',
  ];
  for (const raw of providerFaults) {
    impl.startPhoneVerification = () => { throw new Error(raw); };
    const msg = await said(() => app.requestPhoneCode('317-555-0134'));
    check(`"${raw.slice(0, 34)}…" is not blamed on the tester`, /on us, not your number/.test(msg || ''), msg);
  }

  // Rate limiting is its own thing — retrying in a minute is the right advice.
  impl.startPhoneVerification = () => { throw new Error('For security purposes, you can only request this after 51 seconds.'); };
  const rate = await said(() => app.requestPhoneCode('317-555-0134'));
  check('being rate limited says to wait, not to email support', /give it a minute/.test(rate || ''), rate);

  // A genuinely invalid number still comes through as the server described it.
  impl.startPhoneVerification = () => { throw new Error('Invalid phone number format') };
  const invalid = await said(() => app.requestPhoneCode('317-555-0134'));
  check('a real number problem is still reported as one', /Invalid phone number/.test(invalid || ''), invalid);

  // Verifying the code has the same two cases.
  impl.startPhoneVerification = () => {};
  impl.confirmPhoneVerification = () => { throw new Error('Error sending confirmation OTP to provider'); };
  const vFault = await said(() => app.verifyPhoneCode('+13175550134', '123456'));
  check('a provider fault at the verify step is named too', /on us, not your number/.test(vFault || ''), vFault);

  impl.confirmPhoneVerification = () => false;
  const wrong = await said(() => app.verifyPhoneCode('+13175550134', '123456'));
  check('a wrong code is still a wrong code', /didn’t match/.test(wrong || ''), wrong);

  impl.confirmPhoneVerification = () => true;
  const good = await said(() => app.verifyPhoneCode('+13175550134', '123456'));
  check('a correct code passes', good === null, good);

  await act(async () => { renderer.unmount(); });
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
