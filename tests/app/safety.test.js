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

  // ---- nationwide meetups + city picker ----
  const seen = [];
  impl.listEvents = (city) => {
    seen.push(city);
    const all = [
      { id: 'e-indy', title: 'Indy Mixer', venue: 'Broad Ripple', sport: 'tennis', city: 'indianapolis', capacity: 12, starts_at: soon, event_rsvps: [] },
      { id: 'e-sea', title: 'Seattle Mixer', venue: 'Green Lake', sport: 'pickleball', city: 'seattle', capacity: 12, starts_at: soon, event_rsvps: [] },
    ];
    return !city || city === 'all' ? all : all.filter((e) => e.city === city);
  };
  check('the list starts nationwide', app.eventCity === 'all', app.eventCity);
  await act(async () => { app.setEventCity('seattle'); await tick(40); });
  check('picking a city refetches rather than filtering what was already loaded', seen[seen.length - 1] === 'seattle', seen);
  check('picking a city narrows the list', app.events.length === 1 && app.events[0].city === 'seattle', app.events.map((e) => e.city));
  await act(async () => { app.setEventCity('all'); await tick(40); });
  check('going back to nationwide shows every city', app.events.length === 2, app.events.map((e) => e.city));

  await act(async () => { renderer.unmount(); });
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
