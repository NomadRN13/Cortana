// Opening the app when the phone is signed in but has no cached profile —
// a reinstall, cleared storage, or a second device. If the profile fetch
// fails or hangs, the app used to wait on a black screen forever: no error,
// no retry, no way to sign out. Every one of these must reach a real screen.
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

// The screen App.js would actually show for a given state.
const screen = () => (app.bootError ? 'CantLoad' : (app.bootRoute || 'black'));

// Each mount is a fresh install: no cached profile on the phone, which is the
// only state where this path runs at all.
async function mount() {
  resetStorage();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(60); });
  return renderer;
}

async function main() {
  // 1. the profile fetch fails
  impl.getMyProfile = () => { throw new Error('network'); };
  let renderer = await mount();
  check('a failed profile fetch does not leave the app on black', screen() !== 'black', screen());
  check('it offers a way out', screen() === 'CantLoad' && typeof app.retryBoot === 'function', screen());

  // 2. retrying once the connection is back gets them in
  impl.getMyProfile = () => ({
    id: 'me-uuid', first_name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis',
    modes: ['date'], radius_mi: 25, age_min: 25, age_max: 40, same_sports_only: false,
    bio: '', user_sports: [{ sport: 'tennis', level: 'intermediate', rating_label: '' }],
  });
  await act(async () => { app.retryBoot(); await tick(80); });
  check('retrying lands them in the app', screen() === 'Main', screen());
  check('and their profile came back', !!app.user && app.user.name === 'Sam', app.user && app.user.name);
  await act(async () => { renderer.unmount(); });

  // 3. a request that never answers is the same problem as one that fails
  impl.getMyProfile = () => new Promise(() => {});
  renderer = await mount();
  check('a hung fetch is still on the splash at first', screen() === 'black', screen());
  await act(async () => { await tick(12200); });
  check('a hung fetch gives up rather than waiting forever', screen() === 'CantLoad', screen());

  // 3b. a profile that lands after the deadline still counts
  await act(async () => { renderer.unmount(); });
  let land = null;
  impl.getMyProfile = () => new Promise((resolve) => { land = resolve; });
  renderer = await mount();
  await act(async () => { await tick(12200); });
  check('the slow fetch showed the way out', screen() === 'CantLoad', screen());
  await act(async () => {
    land({
      id: 'me-uuid', first_name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis',
      modes: ['date'], radius_mi: 25, age_min: 25, age_max: 40, same_sports_only: false,
      bio: '', user_sports: [],
    });
    await tick(80);
  });
  check('a profile that lands late takes them in anyway', screen() === 'Main', screen());

  // 4. signing out from there is a real escape, not a loop back to black
  await act(async () => { app.signOut(); await tick(60); });
  check('signing out clears the error', !app.bootError, app.bootError);
  await act(async () => { renderer.unmount(); });

  // 5. signed in with no profile yet → onboarding, not an error
  impl.getMyProfile = () => null;
  renderer = await mount();
  check('a signed-in account with no profile goes to onboarding', screen() === 'Onboarding', screen());
  await act(async () => { renderer.unmount(); });

  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
