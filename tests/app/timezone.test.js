// The phone's timezone goes to the server through set_my_timezone, which uses
// it to keep push notifications quiet from 10pm to 8am where the member is. It
// has the same posture as the position update: sent quietly when the app
// opens, never written to the profile row, and a refusal, a failure or a call
// that never answers must not show an alert, hold up boot, or fail a signup.
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
const { AppStateProvider, useApp, impl, calls, alerts, nativeImpl, resetStorage } = require('./.build/state.cjs');

let app = null;
function Probe() { app = useApp(); return null; }
const tick = (n = 40) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

const INDY = 'America/Indiana/Indianapolis';
const PROFILE = {
  id: 'me-uuid', first_name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis',
  modes: ['play'], radius_mi: 25, age_min: 25, age_max: 40, same_sports_only: false,
  bio: '', user_sports: [{ sport: 'tennis', level: 'intermediate', rating_label: '' }],
};
const DRAFT = {
  name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', modes: ['play'],
  gender: 'man', seeking: [], sports: ['Tennis'], skill: 'Intermediate',
  rating: '', bio: '', photo: null,
};

const named = (n) => calls.filter((c) => c.name === n);
const wroteTimezoneToRow = () => named('updateMyProfile').concat(named('upsertMyProfile'))
  .some((c) => c.args[0] && ['timezone', 'timeZone', 'tz'].some((k) => k in c.args[0]));

// fresh: wipe storage first, the way a new install starts. Leave it and the
// profile cached by the last mount is still there, as on an ordinary relaunch.
async function mount(profile, fresh = true) {
  if (fresh) resetStorage();
  calls.length = 0;
  alerts.length = 0;
  impl.getMyProfile = () => profile;
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(80); });
  return renderer;
}

async function main() {
  nativeImpl.timezone = INDY;

  // 1. opening the app sends the timezone through the RPC, not the row
  impl.setMyTimezone = () => null;
  let renderer = await mount(PROFILE);
  let sent = named('setMyTimezone');
  check('opening the app sends the timezone through set_my_timezone', sent.length === 1, sent.map((c) => c.args));
  check('as the IANA name the phone reports', sent[0] && sent[0].args.length === 1 && sent[0].args[0] === INDY, sent[0] && sent[0].args);
  check('and never writes a timezone to the profile row', !wroteTimezoneToRow(), named('updateMyProfile').map((c) => c.args[0]));
  check('an accepted timezone says nothing', alerts.length === 0, alerts.map((a) => a.title));
  await act(async () => { renderer.unmount(); });

  // 2. the server refuses a zone it doesn't know — the app just carries on
  impl.setMyTimezone = () => { throw Object.assign(new Error('That isn’t a timezone we know.'), { code: '22023' }); };
  renderer = await mount(PROFILE);
  check('a refused timezone was still attempted', named('setMyTimezone').length === 1, named('setMyTimezone').length);
  check('a refused timezone says nothing', alerts.length === 0, alerts.map((a) => [a.title, a.message]));
  check('and the app is open as usual', app.bootRoute === 'Main' && !app.bootError, [app.bootRoute, app.bootError]);
  await act(async () => { renderer.unmount(); });

  // 3. a failing call is just as quiet
  impl.setMyTimezone = () => { throw new Error('network'); };
  renderer = await mount(PROFILE);
  check('a failed timezone update says nothing', alerts.length === 0, alerts.map((a) => a.title));
  check('and does not stop the app opening', app.bootRoute === 'Main' && !app.bootError, [app.bootRoute, app.bootError]);
  await act(async () => { renderer.unmount(); });

  // 4. a call that never answers doesn't hold the app on the boot screen
  impl.setMyTimezone = () => new Promise(() => {});
  renderer = await mount(PROFILE);
  check('a timezone update that never answers does not block boot', app.bootRoute === 'Main' && !app.bootError && !!app.user, [app.bootRoute, app.bootError]);
  check('and the rest of boot went ahead without it', named('fetchDeck').length >= 1 && named('listEvents').length >= 1, [named('fetchDeck').length, named('listEvents').length]);
  await act(async () => { renderer.unmount(); });

  // 5. a phone that can't name its timezone sends nothing at all
  nativeImpl.timezone = null;
  impl.setMyTimezone = () => null;
  renderer = await mount(PROFILE);
  check('without a timezone nothing is sent', named('setMyTimezone').length === 0, named('setMyTimezone').map((c) => c.args));
  check('and the app still opens', app.bootRoute === 'Main', app.bootRoute);
  await act(async () => { renderer.unmount(); });

  // 6. the profile already holds this zone: an ordinary relaunch doesn't send
  //    it again, and a phone that has changed zone does
  nativeImpl.timezone = INDY;
  renderer = await mount({ ...PROFILE, timezone: INDY });
  check('the server’s timezone is kept with the profile', app.user && app.user.timezone === INDY, app.user && app.user.timezone);
  await act(async () => { renderer.unmount(); });
  renderer = await mount({ ...PROFILE, timezone: INDY }, false);
  check('a relaunch in the same zone does not send it again', named('setMyTimezone').length === 0, named('setMyTimezone').map((c) => c.args));
  await act(async () => { renderer.unmount(); });
  nativeImpl.timezone = 'America/Los_Angeles';
  renderer = await mount({ ...PROFILE, timezone: INDY }, false);
  sent = named('setMyTimezone');
  check('a phone that has moved zone sends the new one', sent.length === 1 && sent[0].args[0] === 'America/Los_Angeles', sent.map((c) => c.args));
  await act(async () => { renderer.unmount(); });

  // 7. signup: the row first, then the timezone — and a failure there is not a failed signup
  nativeImpl.timezone = INDY;
  impl.setMyTimezone = () => { throw Object.assign(new Error('Sign in first.'), { code: '42501' }); };
  renderer = await mount(null);
  let err = null;
  await act(async () => { try { await app.finishOnboarding(DRAFT); } catch (e) { err = e; } await tick(60); });
  check('a failed timezone update does not fail signup', !err && !!app.user, err && err.message);
  check('and signup says nothing about it', alerts.length === 0, alerts.map((a) => [a.title, a.message]));
  let order = calls.map((c) => c.name);
  let up = order.indexOf('upsertMyProfile');
  check('signup sends the timezone after the profile row exists', up >= 0 && order.indexOf('setMyTimezone', up) > up, order);
  check('the signup upsert carries no timezone', !wroteTimezoneToRow(), named('upsertMyProfile').map((c) => Object.keys(c.args[0] || {})));
  await act(async () => { renderer.unmount(); });

  // 8. signup doesn't wait for it either
  impl.setMyTimezone = () => new Promise(() => {});
  renderer = await mount(null);
  let done = false;
  await act(async () => { app.finishOnboarding(DRAFT).then(() => { done = true; }, () => {}); await tick(80); });
  order = calls.map((c) => c.name);
  up = order.indexOf('upsertMyProfile');
  check('signup finishes while the timezone update is still unanswered', done && !!app.user, done);
  check('and went on to save the rest of the profile', order.indexOf('setMySports', up) > up, order);
  await act(async () => { renderer.unmount(); });

  nativeImpl.timezone = INDY;
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
