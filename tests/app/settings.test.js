// Settings are promises about who can see you and who you'll see. A write the
// server refuses used to be dropped on the floor while the app kept showing
// the new value — so someone could believe they had left Date mode and still
// be in strangers' dating decks. Each one must revert and say so.
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
const { AppStateProvider, useApp, impl, alerts } = require('./.build/state.cjs');

let app = null;
function Probe() { app = useApp(); return null; }
const tick = (n = 30) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

const PROFILE = {
  id: 'me-uuid', first_name: 'Sam', age: 31, bio: 'Baseline bio', city: 'indianapolis',
  modes: ['date', 'play', 'friends'], gender: 'man', seeking: ['woman'],
  play_pref: 'everyone', friends_pref: 'everyone', play_games: ['singles'],
  radius_mi: 25, age_min: 25, age_max: 40, same_sports_only: false, is_team: false,
};

async function main() {
  impl.getMyProfile = () => PROFILE;
  impl.getProfilesByIds = () => [];

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(40); });

  // The provider only carries a local user once one has been saved; seed one
  // the way onboarding does, so these exercise the Settings path.
  await act(async () => {
    await app.finishOnboarding({
      name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', modes: ['date', 'play', 'friends'],
      gender: 'man', seeking: ['woman'], playGames: ['singles'], playPref: 'everyone',
      friendsPref: 'everyone', sports: ['Tennis'], skill: 'Intermediate', rating: '', bio: 'Baseline bio',
    });
    await tick(40);
  });
  check('a profile is in place', !!app.user && app.user.name === 'Sam', app.user && app.user.name);

  // Every case: change it, have the server refuse, expect the old value back
  // and one alert.
  const cases = [
    {
      what: 'leaving Date mode',
      change: () => app.updateModes(['play', 'friends']),
      read: () => (app.user.modes || []).join(','),
      before: 'date,play,friends',
    },
    {
      what: 'changing city',
      change: () => app.updateCity('seattle'),
      read: () => app.user.city,
      before: 'indianapolis',
    },
    {
      what: 'changing who you want to date',
      change: () => app.updateDating('man', ['man']),
      read: () => (app.user.seeking || []).join(','),
      before: 'woman',
    },
    {
      what: 'changing your bio',
      change: () => app.updateBio('Brand new bio'),
      read: () => app.user.bio,
      before: 'Baseline bio',
    },
    {
      what: 'narrowing your Friends audience',
      change: () => app.updateFriendsPref('women'),
      read: () => app.user.friendsPref,
      before: 'everyone',
    },
    {
      what: 'switching to a doubles team',
      change: () => app.updateTeam({ isTeam: true, partnerName: 'Jo', partnerBirthdate: '1993-02-02', partnerGender: 'woman' }),
      read: () => String(!!app.user.isTeam),
      before: 'false',
    },
    {
      what: 'changing your filters',
      change: () => app.updatePrefs({ ...app.prefs, radius: 3, ageMin: 30, ageMax: 33, mySportsOnly: true }),
      read: () => String(app.prefs.radius),
      before: '25',
    },
  ];

  for (const c of cases) {
    check(`${c.what}: starts where we think`, c.read() === c.before, c.read());

    impl.updateMyProfile = () => { throw new Error('network'); };
    alerts.length = 0;
    await act(async () => { c.change(); await tick(40); });
    check(`${c.what}: reverts when the server refuses`, c.read() === c.before, c.read());
    check(`${c.what}: says it didn't save`, alerts.length === 1, alerts.map((a) => a.title));

    impl.updateMyProfile = () => ({ ok: true });
    alerts.length = 0;
    await act(async () => { c.change(); await tick(40); });
    check(`${c.what}: sticks when the server takes it`, c.read() !== c.before, c.read());
    check(`${c.what}: is silent when it works`, alerts.length === 0, alerts.map((a) => a.title));
  }

  // Turning Date off must not leave you looking at the Date deck either.
  check('the active mode follows the modes you kept', app.mode !== 'date', app.mode);

  await act(async () => { renderer.unmount(); });
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
