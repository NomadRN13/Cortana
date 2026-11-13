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

  // ---- places to play come from the database, with the bundled list as a net ----
  const court = (o) => Object.assign({ id: 'c-' + o.name, address: '', sport: 'pickleball', setting: 'outdoor', access: 'public', courts: null, lights: null, note: '', sort_order: 10 }, o);
  const askedCourts = [];
  impl.listCourts = (cities) => {
    askedCourts.push([].concat(cities || []).join(','));
    return [
      court({ city: 'bakersfield', name: 'A Court The Desk Just Added', access: 'members' }),
      court({ city: 'bakersfield', name: 'New Public Park', courts: 6, lights: true, sort_order: 20 }),
      court({ city: 'seattle', name: 'Green Lake', sort_order: 10 }),
    ].filter((c) => [].concat(cities || []).includes(c.city));
  };
  await act(async () => { app.updateCity('bakersfield'); await tick(60); });
  check('places are fetched for the selected cities', askedCourts[askedCourts.length - 1] === 'bakersfield', askedCourts);
  const fromDb = app.courtsFor('bakersfield').map((c) => c.name);
  check('the database list is what members see, not the bundled one', fromDb.join('|') === 'A Court The Desk Just Added|New Public Park', fromDb);
  check('a city that is not selected lists nothing', app.courtsFor('seattle').length === 0, app.courtsFor('seattle'));
  check('a suggested court is one anyone can walk onto', app.suggestedCourt('bakersfield') === 'New Public Park', app.suggestedCourt('bakersfield'));
  check('unknown lights and court counts stay unknown', app.courtsFor('bakersfield')[0].lights === null && app.courtsFor('bakersfield')[0].courts === null, app.courtsFor('bakersfield')[0]);

  impl.listCourts = () => { throw new Error('network'); };
  await act(async () => { app.toggleCity('seattle'); await tick(60); });
  const fallback = app.courtsFor('bakersfield');
  check('if the list cannot be reached, the bundled list stands in', fallback.length === 13 && fallback[0].name === 'Greenacres Park PicklePlex', fallback.length);

  impl.listCourts = () => [];
  await act(async () => { app.toggleCity('seattle'); await tick(60); });
  check('an empty answer from the database is believed, not papered over', app.courtsFor('bakersfield').length === 0, app.courtsFor('bakersfield').length);

  // While a new selection's list is on its way, the old selection's rows are
  // not reused for it — the bundled list stands in.
  let answer;
  impl.listCourts = () => new Promise((r) => { answer = r; });
  await act(async () => { app.toggleCity('seattle'); await tick(20); });
  check('a list loaded for other cities is not used for the new selection', app.courtsFor('bakersfield').length === 13, app.courtsFor('bakersfield').length);
  await act(async () => { answer([court({ city: 'bakersfield', name: 'Fresh From The Desk', sport: 'tennis' })]); await tick(20); });
  check('the new answer replaces it when it arrives', app.courtsFor('bakersfield').map((c) => c.name).join() === 'Fresh From The Desk', app.courtsFor('bakersfield'));
  check('a tennis court is not proposed for pickleball', app.suggestedCourt('bakersfield', 'Pickleball') === null && app.suggestedCourt('bakersfield', 'Tennis') === 'Fresh From The Desk', [app.suggestedCourt('bakersfield', 'Pickleball'), app.suggestedCourt('bakersfield', 'Tennis')]);

  impl.listCourts = () => { throw new Error('network'); };
  await act(async () => { app.reloadCourts(); await tick(40); });
  check('a failed refresh keeps the last good list rather than the bundled one', app.courtsFor('bakersfield').map((c) => c.name).join() === 'Fresh From The Desk', app.courtsFor('bakersfield').length);

  // ---- tournaments: the server builds the bracket, the app draws it and says no when told no ----
  // entry_count follows the entry list unless a test says otherwise — the server
  // keeps the true count, which a block-filtered list can fall short of.
  const tRow = (o) => Object.assign({
    id: 't-1', city: 'bakersfield', title: 'Fall Classic', venue: 'Jastro Park', sport: 'pickleball', level_range: 'All levels',
    starts_at: soon, max_entries: 72, status: 'registration', bracket_size: null, champion_id: null, completed_at: null,
    tournament_entries: [], tournament_matches: [],
  }, o, { entry_count: o && typeof o.entry_count === 'number' ? o.entry_count : ((o && o.tournament_entries) || []).length });
  let serverT = tRow({ tournament_entries: [{ user_id: 'them-uuid', seed: null }] });
  impl.listTournaments = () => [serverT];
  impl.joinTournament = () => { serverT = tRow({ tournament_entries: [{ user_id: 'them-uuid', seed: null }, { user_id: 'me-uuid', seed: null }] }); return { ok: true }; };
  await act(async () => { app.reloadCourts(); await tick(60); });
  const T = () => app.tournaments.find((t) => t.id === 't-1') || {};
  check('a tournament in a selected city is listed', T().title === 'Fall Classic' && T().entries.length === 1, app.tournaments.map((t) => t.title));
  await act(async () => { app.joinTournament('t-1'); await tick(60); });
  check('entering shows up once the server has it', T().entered === true && T().entries.length === 2, [T().entered, T().entries && T().entries.length]);

  impl.joinTournament = () => { throw new Error('This tournament is full.'); };
  alerts.length = 0;
  await act(async () => { app.joinTournament('t-1'); await tick(60); });
  check('a refused entry says why, in the server\u2019s words', alerts.length === 1 && /full/i.test(alerts[0].message || ''), alerts);

  // the draw arrives from the server; only your own match is yours to record
  serverT = tRow({
    status: 'in_progress', bracket_size: 4,
    tournament_entries: [{ user_id: 'me-uuid', seed: 1 }, { user_id: 'them-uuid', seed: 2 }, { user_id: 'third-uuid', seed: 3 }],
    tournament_matches: [
      { id: 'm-bye', round: 1, slot: 0, player_a: 'me-uuid', player_b: null, winner: 'me-uuid', score: '', is_bye: true, reported_at: null },
      { id: 'm-other', round: 1, slot: 1, player_a: 'them-uuid', player_b: 'third-uuid', winner: null, score: '', is_bye: false, reported_at: null },
      { id: 'm-final', round: 2, slot: 0, player_a: 'me-uuid', player_b: null, winner: null, score: '', is_bye: false, reported_at: null },
    ],
  });
  await act(async () => { app.reloadCourts(); await tick(60); });
  const mt = (id) => (T().matches || []).find((x) => x.id === id) || {};
  check('the bracket is drawn as the server built it', T().status === 'in_progress' && T().rounds === 2 && (T().matches || []).length === 3, [T().status, T().rounds]);
  check('a match between two other players is not mine to record', app.canReportMatch(mt('m-other')) === false);
  check('a bye, and a match still waiting for a player, cannot be recorded', app.canReportMatch(mt('m-bye')) === false && app.canReportMatch(mt('m-final')) === false);
  serverT = tRow(Object.assign({}, serverT, { tournament_matches: serverT.tournament_matches.map((x) => (x.id === 'm-final' ? Object.assign({}, x, { player_b: 'them-uuid' }) : x)) }));
  await act(async () => { app.reloadCourts(); await tick(60); });
  check('my own match, once both players are in, is mine to record', app.canReportMatch(mt('m-final')) === true);
  const sent = [];
  impl.reportMatchResult = (matchId, winner) => { sent.push([matchId, winner]); throw new Error('This result is already in \u2014 ask the organiser to correct it.'); };
  alerts.length = 0;
  await act(async () => { app.reportMatch('t-1', 'm-final', 'me-uuid', ''); await tick(60); });
  check('recording sends the match and the winner', sent.length === 1 && sent[0].join() === 'm-final,me-uuid', sent);
  check('a refused result says why and changes nothing', alerts.length === 1 && /already in/.test(alerts[0].message || '') && !mt('m-final').winner, alerts);

  // The entry list leaves out anyone the member has a block with; the count
  // and "Full" come from the server's own entry_count.
  serverT = tRow({ max_entries: 3, entry_count: 3, tournament_entries: [{ user_id: 'third-uuid', seed: null }] });
  await act(async () => { app.reloadCourts(); await tick(60); });
  check('the entry count is the server’s, not the length of the list I can see', T().entryCount === 3 && T().entries.length === 1, [T().entryCount, T().entries && T().entries.length]);
  check('a tournament at its limit is full even when some entrants are hidden', T().entryCount >= T().max, [T().entryCount, T().max]);

  // An older refresh that answers last must not put back what a newer one replaced.
  const pendingLists = [];
  impl.listTournaments = () => new Promise((r) => { pendingLists.push(r); });
  await act(async () => { app.reloadCourts(); app.reloadCourts(); await tick(20); });
  await act(async () => { pendingLists[1]([tRow({ title: 'Newer' })]); await tick(40); });
  await act(async () => { pendingLists[0]([tRow({ title: 'Older' })]); await tick(40); });
  check('an older tournament refresh arriving late does not overwrite a newer one', pendingLists.length === 2 && T().title === 'Newer', [pendingLists.length, T().title]);
  impl.listTournaments = () => [serverT];

  // A champion who deleted their account leaves champion_id empty: the
  // tournament is still finished, just without a name to show.
  serverT = tRow({
    status: 'completed', bracket_size: 2, champion_id: null, completed_at: new Date().toISOString(),
    tournament_entries: [{ user_id: 'third-uuid', seed: 2 }],
    tournament_matches: [
      { id: 'm-done', round: 1, slot: 0, player_a: null, player_b: 'third-uuid', winner: null, score: '11-9', is_bye: false, reported_at: new Date().toISOString() },
    ],
  });
  await act(async () => { app.reloadCourts(); await tick(60); });
  check('a finished tournament whose champion left is completed, with no champion', T().status === 'completed' && T().championId === null && !!T().completedAt, [T().status, T().championId, T().completedAt]);
  check('a match is played once reported, even with its winner gone', mt('m-done').reported === true && !mt('m-done').winner && app.canReportMatch(mt('m-done')) === false, mt('m-done'));

  // Bracket names come from a fresh lookup, and a blocked member is never named.
  const realCards = impl.getProfilesByIds;
  impl.getProfilesByIds = () => [{ id: 'them-uuid', first_name: 'Maya' }, { id: 'third-uuid', first_name: 'Lena' }];
  serverT = tRow({ tournament_entries: [{ user_id: 'them-uuid', seed: null }, { user_id: 'third-uuid', seed: null }] });
  await act(async () => { app.reloadCourts(); await tick(60); });
  check('a bracket name comes from the tournament lookup', app.playerName('third-uuid') === 'Lena', app.playerName('third-uuid'));
  check('a member I have blocked shows as an unnamed player', app.blocked['them-uuid'] === true && app.playerName('them-uuid') === 'Player', [app.blocked['them-uuid'], app.playerName('them-uuid')]);
  impl.getProfilesByIds = () => [{ id: 'them-uuid', first_name: 'Maya' }];
  await act(async () => { app.reloadCourts(); await tick(60); });
  check('someone the server stops naming (they blocked me) goes unnamed on the next refresh', app.playerName('third-uuid') === 'Player', app.playerName('third-uuid'));
  impl.getProfilesByIds = realCards;

  await act(async () => { renderer.unmount(); });
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
