// Three likes a day in Date mode (migration 44). The database enforces it; the
// app's job is to say so before the card moves, never lose the person, and
// leave Play, Friends and passing alone. Demo build and live build both.
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
const tick = (n = 20) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

const DRAFT = {
  name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', modes: ['play', 'date', 'friends'],
  gender: 'man', seeking: ['woman'], playGames: ['singles', 'doubles', 'mixed_doubles'], playPref: 'everyone',
  friendsPref: 'everyone', sports: ['Tennis'], skill: 'Intermediate', rating: '', bio: '', photo: null,
};

async function mount(build) {
  let app = null;
  function Probe() { app = build.useApp(); return null; }
  await act(async () => {
    TestRenderer.create(React.createElement(build.AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(40); });
  return () => app;
}

async function demo() {
  console.log('── demo build');
  const build = require('./.build/state.demo.cjs');
  build.resetStorage();
  const app = await mount(build);
  await act(async () => { await app().finishOnboarding(DRAFT); await tick(); });
  await act(async () => { app().setMode('date'); await tick(); });
  check('Date mode starts with 3 of 3 likes', app().dateLikes.allowance === 3 && app().dateLikes.remaining === 3, app().dateLikes);

  for (let i = 0; i < 3; i += 1) {
    const p = app().currentProfile();
    let r;
    await act(async () => { r = await app().swipeLike(p, i === 1); await tick(); });
    check(`like ${i + 1} goes through (an ace counts as a like)`, r !== 'limited' && app().currentProfile() && app().currentProfile().id !== p.id, r);
  }
  check('then none are left, with a time the next one comes back',
    app().dateLikes.remaining === 0 && app().dateLikes.nextAt > Date.now() + 23 * 3600e3, app().dateLikes);
  check('and the app says Date likes are blocked', app().dateLikeBlocked() === true);

  const held = app().currentProfile();
  let r;
  await act(async () => { r = await app().swipeLike(held, false); await tick(); });
  check('a fourth like is refused before anything is sent', r === 'limited', r);
  check('and the card stays where it was, so nobody is lost', app().currentProfile().id === held.id, app().currentProfile().id);
  await act(async () => { r = await app().swipeLike(held, true); await tick(); });
  check('an ace is refused too', r === 'limited', r);

  await act(async () => { app().swipePass(held); await tick(); });
  check('passing still works with no likes left', app().currentProfile() && app().currentProfile().id !== held.id);

  await act(async () => { app().setMode('play'); await tick(); });
  check('Play mode is not limited', app().dateLikeBlocked('play') === false);
  const pp = app().currentProfile();
  await act(async () => { r = await app().swipeLike(pp, false); await tick(); });
  check('a like in Play still goes through', r !== 'limited', r);
  await act(async () => { app().setMode('friends'); await tick(); });
  check('Friends mode is not limited', app().dateLikeBlocked('friends') === false);
}

async function live() {
  console.log('── live build');
  const build = require('./.build/state.cjs');
  const { impl, calls } = build;
  build.resetStorage();
  const named = (n) => calls.filter((c) => c.name === n);
  const row = (n) => ({ user_id: `p-${n}`, first_name: `P${n}`, age: 30, distance_mi: 2, sports: [{ sport: 'tennis', level: 'intermediate' }], gender: 'woman' });
  impl.fetchDeck = () => [1, 2, 3, 4, 5, 6].map(row);
  let left = 1;
  impl.getMyDateLikes = () => ({ allowance: 3, used: 3 - left, remaining: left, next_at: left ? null : new Date(Date.now() + 20 * 3600e3).toISOString() });
  impl.swipe = (id, mode, action) => {
    if (mode === 'date' && action !== 'pass') {
      if (left <= 0) { const e = new Error("You've used today's likes in Date mode. More tomorrow."); e.code = '54000'; throw e; }
      left -= 1;
    }
    return null;
  };
  const app = await mount(build);
  await act(async () => { await app().finishOnboarding(DRAFT); await tick(60); });
  await act(async () => { app().setMode('date'); await tick(60); });
  check('the count comes from the server', named('getMyDateLikes').length >= 1 && app().dateLikes.remaining === 1, app().dateLikes);

  let p = app().currentProfile();
  let r;
  await act(async () => { r = await app().swipeLike(p, false); await tick(60); });
  check('the last like goes through', r === false && app().currentProfile().id !== p.id, [r, app().currentProfile() && app().currentProfile().id]);
  check('and the count is refreshed from the server', app().dateLikes.remaining === 0 && app().dateLikes.nextAt > Date.now(), app().dateLikes);

  // The app thinks one is left, but the server says no (another phone used it).
  await act(async () => { left = 0; });
  p = app().currentProfile();
  const sent = named('swipe').length;
  await act(async () => { r = await app().swipeLike(p, false); await tick(60); });
  check('with none left, no like is even sent', r === 'limited' && named('swipe').length === sent, [r, named('swipe').length - sent]);

  // Out of step: the app believes there is one; the server refuses.
  impl.getMyDateLikes = () => ({ allowance: 3, used: 2, remaining: 1, next_at: null });
  await act(async () => { await app().refreshDateLikes(); await tick(40); });
  check('the app can believe one is left', app().dateLikes.remaining === 1);
  impl.getMyDateLikes = () => ({ allowance: 3, used: 3, remaining: 0, next_at: new Date(Date.now() + 5 * 3600e3).toISOString() });
  p = app().currentProfile();
  await act(async () => { r = await app().swipeLike(p, false); await tick(60); });
  check('when the server refuses, the app says so', r === 'limited', r);
  check('and puts the card back, so nobody is lost', app().currentProfile() && app().currentProfile().id === p.id, app().currentProfile() && app().currentProfile().id);
  check('and shows none left', app().dateLikes.remaining === 0, app().dateLikes);

  // Play is untouched by the Date limit.
  await act(async () => { app().setMode('play'); await tick(60); });
  p = app().currentProfile();
  await act(async () => { r = await app().swipeLike(p, false); await tick(60); });
  check('a like in Play is sent even with no Date likes left', r !== 'limited' && named('swipe').some((c) => c.args[1] === 'play'), r);
}

(async () => {
  await demo();
  await live();
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
