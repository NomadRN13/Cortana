// A photo that never reached the server is the most expensive silent failure
// in a dating app: the member sees it on their own profile, everyone else sees
// initials, and nothing tells them. The first one — picked during onboarding —
// is the one that decides whether anybody swipes right.
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
const { AppStateProvider, useApp, impl, alerts, resetStorage } = require('./.build/state.cjs');

let app = null;
function Probe() { app = useApp(); return null; }
const tick = (n = 40) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

const DRAFT = {
  name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', modes: ['date'],
  gender: 'man', seeking: ['woman'], sports: ['Tennis'], skill: 'Intermediate',
  rating: '', bio: '', photo: 'file:///phone/only/IMG_0001.jpg',
};

async function mount() {
  resetStorage();
  impl.getMyProfile = () => null;
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(60); });
  alerts.length = 0;
  return renderer;
}

async function onboard() {
  const renderer = await mount();
  await act(async () => { await app.finishOnboarding(DRAFT); await tick(60); });
  return renderer;
}

async function main() {
  // 1. the upload lands
  impl.uploadProfilePhoto = () => 'me-uuid/1.jpg';
  impl.listMyPhotos = () => [{ position: 0, url: 'https://signed/1.jpg', status: 'pending' }];
  let renderer = await onboard();
  check('a photo that uploaded is shown from the server, not the phone', app.user.photo === 'https://signed/1.jpg', app.user.photo);
  check('a successful upload is silent', alerts.length === 0, alerts.map((a) => a.title));
  await act(async () => { renderer.unmount(); });

  // 2. the upload fails
  impl.uploadProfilePhoto = () => { throw new Error('network'); };
  impl.listMyPhotos = () => [];
  renderer = await onboard();
  check('they still get into the app', !!app.user && app.user.name === 'Sam', app.user && app.user.name);
  check('a failed upload says so', alerts.length === 1 && /didn’t upload/.test(alerts[0].title), alerts.map((a) => a.title));
  check('and their own profile shows what everyone else sees', !app.user.photo, app.user.photo);
  check('the local file:// URI is never kept', app.user.photo !== DRAFT.photo, app.user.photo);
  await act(async () => { renderer.unmount(); });

  // 3. the upload hangs — don't await, or the assertion lands after the deadline
  impl.uploadProfilePhoto = () => new Promise(() => {});
  renderer = await mount();
  let done = null;
  await act(async () => { done = app.finishOnboarding(DRAFT); await tick(60); });
  check('a hung upload keeps them on the onboarding screen at first', !app.user, app.user && app.user.name);
  await act(async () => { await done; await tick(60); });
  check('a hung upload gives up and lets them in', !!app.user && app.user.name === 'Sam', app.user && app.user.name);
  check('and says we couldn’t confirm it, not that it failed', alerts.length === 1 && /couldn’t confirm/.test(alerts[0].title), alerts.map((a) => a.title));
  await act(async () => { renderer.unmount(); });

  // 4. no photo picked at all — nothing to say
  impl.uploadProfilePhoto = () => { throw new Error('should not be called'); };
  impl.listMyPhotos = () => [];
  renderer = await mount();
  await act(async () => { await app.finishOnboarding({ ...DRAFT, photo: null }); await tick(60); });
  check('skipping the photo is not an error', alerts.length === 0 && !!app.user, alerts.map((a) => a.title));
  await act(async () => { renderer.unmount(); });

  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
