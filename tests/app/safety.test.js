// The three actions where a swallowed failure is a safety problem rather than
// an inconvenience: blocking someone, reporting someone, and RSVPing to an
// event that has a physical guest list. Each one must either happen or say it
// didn't. These are regression tests for fixes that are easy to undo by
// accident — a stray `.catch(() => {})` puts them all back.
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
const { AppStateProvider, useApp, impl, calls, alerts } = require('./.build/state.cjs');

let app = null;
function Probe() { app = useApp(); return null; }
const tick = (n = 20) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

async function main() {
  const soon = new Date(Date.now() + 4 * 86400000).toISOString();
  impl.listMatches = () => [{ id: 'match-1', user_a: 'me-uuid', user_b: 'them-uuid' }];
  impl.getProfilesByIds = () => [{ id: 'them-uuid', name: 'Maya', age: 30, city: 'indianapolis' }];
  impl.listEvents = () => [{
    id: 'event-1', title: 'Doubles Mixer', venue: 'Broad Ripple', sport: 'tennis',
    city: 'indianapolis', capacity: 12, starts_at: soon, event_rsvps: [],
  }];

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(40); });

  // ---- block ----
  impl.blockUser = () => { throw new Error('network'); };
  alerts.length = 0;
  await act(async () => { app.block('them-uuid'); await tick(40); });
  check('a block the server refused is not left showing as blocked', !app.blocked['them-uuid'], app.blocked);
  check('a refused block says so', alerts.length === 1 && /block/i.test(alerts[0].title), alerts.map((a) => a.title));
  check('a refused block puts the match back', app.threads.some((t) => t.id === 'them-uuid'), app.threads.map((t) => t.id));

  impl.blockUser = () => ({ ok: true });
  alerts.length = 0;
  await act(async () => { app.block('them-uuid'); await tick(40); });
  check('a block the server accepted sticks', app.blocked['them-uuid'] === true, app.blocked);
  check('an accepted block is silent', alerts.length === 0, alerts);

  // ---- report ----
  impl.reportUser = () => { throw new Error('network'); };
  alerts.length = 0;
  await act(async () => { app.report('them-uuid', true); await tick(40); });
  check('a refused report says so', alerts.length === 1 && /report/i.test(alerts[0].title), alerts.map((a) => a.title));

  impl.reportUser = () => ({ ok: true });
  alerts.length = 0;
  await act(async () => { app.report('them-uuid', true); await tick(40); });
  check('a delivered report is silent', alerts.length === 0, alerts);

  // ---- RSVP ----
  const ev = () => app.events.find((e) => e.id === 'event-1') || {};
  check('the event loaded', ev().title === 'Doubles Mixer', app.events.length);
  const spots = ev().spotsLeft;

  impl.rsvp = () => { const e = new Error('event is full'); throw e; };
  alerts.length = 0;
  await act(async () => { app.toggleJoin('event-1'); await tick(40); });
  check('an RSVP the server refused does not stay "Going"', ev().going !== true, ev().going);
  check('a full event is named as full, not as a connection problem', alerts.length === 1 && /filled up/i.test(alerts[0].title), alerts.map((a) => a.title));
  check('the spot count is put back', ev().spotsLeft === spots, [ev().spotsLeft, spots]);

  impl.rsvp = () => ({ ok: true });
  alerts.length = 0;
  await act(async () => { app.toggleJoin('event-1'); await tick(40); });
  check('an accepted RSVP sticks', ev().going === true, ev().going);
  check('an accepted RSVP is silent', alerts.length === 0, alerts);

  // ---- meetups follow the cities on the profile: those, and no others ----
  const seen = [];
  impl.listEvents = (cities) => {
    seen.push(cities);
    const all = [
      { id: 'e-indy', title: 'Indy Mixer', venue: 'Broad Ripple', sport: 'tennis', city: 'indianapolis', capacity: 12, starts_at: soon, event_rsvps: [] },
      { id: 'e-sea', title: 'Seattle Mixer', venue: 'Green Lake', sport: 'pickleball', city: 'seattle', capacity: 12, starts_at: soon, event_rsvps: [] },
      { id: 'e-mia', title: 'Miami Mixer', venue: 'Flamingo Park', sport: 'tennis', city: 'miami', capacity: 12, starts_at: soon, event_rsvps: [] },
    ];
    // Answers the way the old nationwide API did when asked without a city, so
    // a regression that drops the cities shows up as every event, not none.
    const list = Array.isArray(cities) ? cities : (cities ? [cities] : []);
    return !list.length || list.includes('all') ? all : all.filter((e) => list.includes(e.city));
  };
  const shown = () => app.events.map((e) => e.city).sort().join(',');
  const last = () => [].concat(seen[seen.length - 1] || []).join(',');

  // The provider only carries a local user once one has been saved; seed one
  // the way onboarding does, so there is a city to belong to and to move from.
  await act(async () => {
    await app.finishOnboarding({
      name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', modes: ['play'],
      gender: 'man', seeking: [], playGames: ['singles'], playPref: 'everyone',
      friendsPref: 'everyone', sports: ['Tennis'], skill: 'Intermediate', rating: '', bio: '',
    });
    await tick(60);
  });
  check('the meetup list starts as the member’s own city', app.eventCities.join(',') === 'indianapolis', app.eventCities);
  check('there is no separate city picker for meetups', typeof app.setEventCity === 'undefined', typeof app.setEventCity);

  await act(async () => { app.updateCity('seattle'); await tick(60); });
  check('moving city refetches for the new city', last() === 'seattle', seen);
  check('only the new city’s meetups are shown', shown() === 'seattle', shown());

  // ---- more than one city at a time ----
  let ok;
  await act(async () => { ok = app.toggleCity('indianapolis'); await tick(60); });
  check('a second city can be added', ok === true && app.eventCities.join(',') === 'seattle,indianapolis', app.eventCities);
  check('the first city picked stays the home city', app.user.city === 'seattle', app.user.city);
  check('meetups are fetched for every selected city', last() === 'seattle,indianapolis', seen);
  check('meetups from all selected cities are shown, and no others', shown() === 'indianapolis,seattle', shown());
  const saved = calls.filter((c) => c.name === 'updateMyProfile').map((c) => c.args[0]).filter((a) => a && 'extra_cities' in a).pop();
  check('the server is told the home city and the extras', !!saved && saved.city === 'seattle' && (saved.extra_cities || []).join(',') === 'indianapolis', saved);

  await act(async () => { ok = app.toggleCity('seattle'); await tick(60); });
  check('dropping the home city promotes the next one', ok === true && app.user.city === 'indianapolis' && app.eventCities.join(',') === 'indianapolis', [app.user.city, app.eventCities]);
  check('a dropped city’s meetups go with it', shown() === 'indianapolis', shown());

  await act(async () => { ok = app.toggleCity('indianapolis'); await tick(60); });
  check('the last city cannot be dropped', ok === false && app.eventCities.join(',') === 'indianapolis', [ok, app.eventCities]);
  check('the list is never fetched without a city', seen.length > 0 && seen.every((c) => [].concat(c || []).length > 0 && ![].concat(c).includes('all')), seen);

  await act(async () => { renderer.unmount(); });
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
