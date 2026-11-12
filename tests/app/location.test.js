// Position is set only through set_my_location (migration 20260806000030): the
// database refuses approx_lat/approx_lng written to the profile row, and lets a
// member move to a new ~2.5-mile square at most once every 6 hours. The app has
// to use the RPC, carry on quietly when a move is refused, and never fail a
// signup over it.
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

const PROFILE = {
  id: 'me-uuid', first_name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis',
  modes: ['date'], radius_mi: 25, age_min: 25, age_max: 40, same_sports_only: false,
  bio: '', user_sports: [{ sport: 'tennis', level: 'intermediate', rating_label: '' }],
};
const DRAFT = {
  name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', modes: ['date'],
  gender: 'man', seeking: ['woman'], sports: ['Tennis'], skill: 'Intermediate',
  rating: '', bio: '', photo: null,
};
const HERE = { lat: 39.7684, lng: -86.1581 };

const named = (n) => calls.filter((c) => c.name === n);
const wroteCoordinates = () => named('updateMyProfile').concat(named('upsertMyProfile'))
  .some((c) => c.args[0] && ['approx_lat', 'approx_lng', 'approxLat', 'approxLng'].some((k) => k in c.args[0]));

async function mount(profile) {
  resetStorage();
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
  nativeImpl.coarseLocation = HERE;

  // 1. opening the app sends the position through the RPC, not the row
  impl.setMyLocation = () => ({ accepted: true, moved: true });
  let renderer = await mount(PROFILE);
  const sent = named('setMyLocation');
  check('opening the app sets the position through set_my_location', sent.length === 1, sent.map((c) => c.args));
  check('with the coarse coordinates', sent[0] && sent[0].args[0] === HERE.lat && sent[0].args[1] === HERE.lng, sent[0] && sent[0].args);
  check('and never writes coordinates to the profile row', !wroteCoordinates(), named('updateMyProfile').map((c) => c.args[0]));
  check('the deck is fetched again once it lands', named('fetchDeck').length >= 2, named('fetchDeck').length);
  await act(async () => { renderer.unmount(); });

  // 2. a move inside the 6-hour window is refused — the app just carries on
  impl.setMyLocation = () => ({ accepted: false, moved: false, retry_after: '2026-11-12T18:00:00Z' });
  renderer = await mount(PROFILE);
  check('a refused move says nothing', alerts.length === 0, alerts.map((a) => a.title));
  check('and the app is open as usual', app.bootRoute === 'Main' && !app.bootError, app.bootRoute);
  await act(async () => { renderer.unmount(); });

  // 3. a failing call is just as quiet
  impl.setMyLocation = () => { throw new Error('network'); };
  renderer = await mount(PROFILE);
  check('a failed position update says nothing', alerts.length === 0, alerts.map((a) => a.title));
  check('and does not stop the app opening', app.bootRoute === 'Main' && !app.bootError, app.bootRoute);
  await act(async () => { renderer.unmount(); });

  // 4. no location permission: nothing is sent at all
  nativeImpl.coarseLocation = null;
  impl.setMyLocation = () => ({ accepted: true, moved: true });
  renderer = await mount(PROFILE);
  check('without a location nothing is sent', named('setMyLocation').length === 0, named('setMyLocation').length);
  await act(async () => { renderer.unmount(); });

  // 5. signup: the row first, then the position — and a failure there is not a failed signup
  nativeImpl.coarseLocation = HERE;
  impl.setMyLocation = () => { throw new Error('Finish setting up your profile first.'); };
  renderer = await mount(null);
  let err = null;
  await act(async () => { try { await app.finishOnboarding(DRAFT); } catch (e) { err = e; } await tick(60); });
  check('a failed position update does not fail signup', !err && !!app.user, err && err.message);
  const order = calls.map((c) => c.name);
  const up = order.indexOf('upsertMyProfile');
  const loc = order.indexOf('setMyLocation', up);
  // Before setMySports, so it is signup doing it, not the boot path afterwards.
  const sports = order.indexOf('setMySports', up);
  check('signup sets the position after the profile row exists', up >= 0 && loc > up && loc < sports, order);
  check('the signup upsert carries no coordinates', !wroteCoordinates(), named('upsertMyProfile').map((c) => Object.keys(c.args[0] || {})));
  await act(async () => { renderer.unmount(); });

  nativeImpl.coarseLocation = null;
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
