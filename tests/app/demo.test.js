// The demo build: no backend configured, so the app runs on seeded local data
// (mobile/src/data/seed.js). The same actions the live app uses have to work
// here with nothing behind them — RSVP with the waiver, check-in, the crew,
// ladder leagues — follow the same rules the server enforces, and call the
// backend not once.
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
const { AppStateProvider, useApp, calls, alerts, resetStorage } = require('./.build/state.demo.cjs');

let app = null;
function Probe() { app = useApp(); return null; }
const tick = (n = 20) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

const DRAFT = {
  name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', modes: ['friends', 'date', 'play'],
  gender: 'man', seeking: ['woman'], playGames: ['singles', 'doubles', 'mixed_doubles'], playPref: 'everyone',
  friendsPref: 'everyone', sports: ['Tennis'], skill: 'Intermediate', rating: '', bio: '', photo: null,
};

async function main() {
  resetStorage();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(); });
  check('with no backend the app opens on the welcome screen', app.live === false && app.bootRoute === 'Welcome', [app.live, app.bootRoute]);
  check('before anyone has chosen, the app’s mode is Play, not Date', app.mode === 'play', app.mode);

  await act(async () => { await app.finishOnboarding(DRAFT); await tick(); });
  check('signing up in the demo reaches the app', app.bootRoute === 'Main' && app.user.name === 'Sam', app.bootRoute);
  check('the app opens on Play when Play is one of your modes, whatever order they were picked in', app.mode === 'play', app.mode);
  check('a demo member is on the free tier', app.tier === 'free', app.tier);

  // ---- events ----
  const ev = (id) => app.events.find((e) => e.id === id) || {};
  check('demo events are the member’s city’s', app.events.length === 6 && app.events.every((e) => e.city === 'indianapolis'), app.events.map((e) => e.city));
  check('a demo event can carry a price and a Club saving', ev('e3').clubDiscountPct === 15 && ev('e3').priceCents === 1200 && ev('e1').clubDiscountPct === 0 && ev('e1').priceCents === null, [ev('e3'), ev('e1')]);

  // ---- RSVP, waiver, check-in ----
  let ok;
  await act(async () => { app.toggleJoin('e2'); await tick(); });
  check('an RSVP without the waiver is going, with no waiver on record', ev('e2').going === true && ev('e2').waiverAccepted === false, ev('e2'));
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('e2', 'DEMO1'); await tick(); });
  check('the demo also wants the waiver before check-in', ok === false && ev('e2').checkedIn === false && /waiver/i.test((alerts[0] || {}).message || ''), alerts);

  await act(async () => { ok = await app.rsvpWithWaiver('e1'); await tick(); });
  check('RSVPing with the waiver records both', ok === true && ev('e1').going === true && ev('e1').waiverAccepted === true, ev('e1'));
  check('there is no crew before a check-in', app.crew.length === 0, app.crew);

  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('e1', '!!'); await tick(); });
  check('something that isn’t a code is refused', ok === false && ev('e1').checkedIn === false && alerts.length === 1 && /code/i.test(alerts[0].message || ''), alerts);
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('e1', ' demo1 '); await tick(); });
  check('a code checks the demo member in', ok === true && ev('e1').checkedIn === true && alerts.length === 0, [ok, ev('e1').checkedIn, alerts]);

  // ---- the crew ----
  const ids = () => app.crew.map((c) => c.id).join();
  check('the crew appears after check-in: the sample players at that event', ids() === app.eventAttendees('e1').map((p) => p.id).join() && app.crew.length === 3, ids());
  check('each one is tied to the event', app.crew.every((c) => c.eventId === 'e1' && c.eventTitle === 'Sunset Doubles Social'), app.crew);
  check('nobody is Added until the member adds them', app.crew.every((c) => c.added === false), app.crew.map((c) => c.added));
  const tagged = () => app.crew.filter((c) => c.alsoOpenToDating).map((c) => c.id).join();
  // e1's sample attendees are Maya, Elena and Theo. Sam is a man looking for
  // women with Date mode on; of the three only Maya has Date mode on and is
  // looking for men.
  check('the demo’s dating flag is mutual: Date mode on both sides, each what the other is looking for', tagged() === 'maya', tagged());
  await act(async () => { app.updateModes(['play', 'friends']); await tick(); });
  check('with the member’s Date mode off, nobody is tagged', tagged() === '', tagged());
  await act(async () => { app.updateModes(['play', 'date']); await tick(); });
  await act(async () => { app.updateDating('man', ['man']); await tick(); });
  check('and nobody who isn’t looking for someone like the member', tagged() === '', tagged());
  await act(async () => { app.updateDating('man', ['woman']); await tick(); });
  check('the tag is back when it is mutual again', tagged() === 'maya', tagged());

  await act(async () => { app.addToCrew('maya'); await tick(); });
  check('Add marks them Added', app.crew.find((c) => c.id === 'maya').added === true, app.crew);
  await act(async () => { app.removeFromCrew('maya'); await tick(); });
  check('and it can be undone', app.crew.find((c) => c.id === 'maya').added === false, app.crew);
  await act(async () => { app.block('theo'); await tick(); });
  check('someone blocked leaves the crew', !app.crew.some((c) => c.id === 'theo') && app.crew.length === 2, ids());
  await act(async () => { app.toggleJoin('e1'); await tick(); });
  check('a checked-in RSVP stays', ev('e1').going === true && ev('e1').checkedIn === true, ev('e1'));

  // ---- ladder leagues ----
  const L = (id) => app.leagues.find((l) => l.id === id) || {};
  const at = (id, rung) => (L(id).standings || []).find((r) => r.rung === rung);
  check('demo ladders are the member’s city’s', app.leagues.map((l) => l.id).join() === 'l1,l2', app.leagues.map((l) => l.id));
  check('a demo ladder has players on its rungs', L('l1').standings.length === 7 && L('l1').joined === false, L('l1').standings.length);
  await act(async () => { app.joinLeague('l1'); await tick(); });
  check('joining takes the bottom rung', L('l1').joined === true && L('l1').myRung === 8 && at('l1', 8).isMe === true && at('l1', 8).name === 'Sam', [L('l1').myRung, at('l1', 8)]);
  const can = (rung) => app.canChallenge(L('l1'), at('l1', rung));
  check('one and two rungs above can be challenged, three cannot', can(7) === true && can(6) === true && can(5) === false && can(8) === false, [can(7), can(6), can(5), can(8)]);

  alerts.length = 0;
  await act(async () => { app.challengeInLeague('l1', at('l1', 5).id); await tick(); });
  check('a challenge out of reach is refused with the reason', alerts.length === 1 && /two rungs above/.test(alerts[0].message || '') && L('l1').challenges.length === 0, alerts);

  const target = at('l1', 6);
  await act(async () => { app.challengeInLeague('l1', target.id); await tick(); });
  const ch = app.leagueChallengeWith(L('l1'), at('l1', 6));
  check('a challenge within reach is open against that player', !!ch && ch.challengedId === target.id && can(6) === false, ch);
  await act(async () => { app.reportLeagueResult('l1', ch.id, 'me'); await tick(); });
  check('winning it takes their rung', L('l1').myRung === 6 && at('l1', 7).id === target.id && L('l1').challenges.length === 0, [L('l1').myRung, at('l1', 7)]);
  check('and the records follow', at('l1', 6).wins === 1 && at('l1', 6).losses === 0 && at('l1', 7).losses === target.losses + 1, [at('l1', 6), at('l1', 7)]);
  check('rungs stay 1 to 8 with no gaps', L('l1').standings.map((r) => r.rung).join() === '1,2,3,4,5,6,7,8', L('l1').standings.map((r) => r.rung));

  await act(async () => { app.leaveLeague('l1'); await tick(); });
  check('leaving closes the gap', L('l1').joined === false && L('l1').standings.map((r) => r.rung).join() === '1,2,3,4,5,6,7', L('l1').standings.map((r) => r.rung));

  // ---- and none of it touched a backend ----
  check('the demo never calls the backend', calls.length === 0, calls.map((c) => c.name));

  await act(async () => { renderer.unmount(); });
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
