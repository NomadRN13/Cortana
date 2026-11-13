// RSVP → waiver → check-in → crew. The promise is "RSVP to a game, show up, and
// keep the people you met", and each step is the server's to decide:
//
//   · the waiver is stamped by accept_event_waiver, after the RSVP exists, and
//     check-in is not even attempted without it;
//   · check-in takes the host's code, and a refusal is shown in the server's
//     own words rather than blamed on the connection;
//   · the crew appears once the member has checked in, from get_my_crew;
//   · "Also open to dating" is the server's flag and nothing else — the app
//     never works it out from what it knows about anyone.
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
const { AppStateProvider, useApp, impl, calls, alerts, resetStorage } = require('./.build/state.cjs');

let app = null;
function Probe() { app = useApp(); return null; }
const tick = (n = 40) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

// The way the database refuses: an SQLSTATE and a sentence written to be shown.
const refuse = (message, code = '22023') => Object.assign(new Error(message), { code });
const named = (n) => calls.filter((c) => c.name === n);

// Date mode on, and looking for women: everything the app would need to "work
// out" a dating tag for itself, if it were ever tempted to.
const PROFILE = {
  id: 'me-uuid', first_name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis',
  modes: ['play', 'date'], gender: 'man', seeking: ['woman'],
  radius_mi: 25, age_min: 25, age_max: 40, same_sports_only: false, tier: 'club',
  bio: '', user_sports: [{ sport: 'tennis', level: 'intermediate', rating_label: '' }],
};

async function main() {
  const soon = new Date(Date.now() + 30 * 60000).toISOString();
  const later = new Date(Date.now() + 3 * 86400000).toISOString();
  const opens = new Date(Date.now() + 2 * 86400000).toISOString();
  resetStorage();
  impl.getMyProfile = () => PROFILE;
  impl.listEvents = () => [
    { id: 'event-1', title: 'Doubles Mixer', venue: 'Broad Ripple', sport: 'tennis', city: 'indianapolis', capacity: 12, starts_at: soon, price_cents: 1200, club_discount_pct: 15, general_opens_at: null, event_rsvps: [] },
    { id: 'event-2', title: 'Ladder Night', venue: 'Tarkington Park', sport: 'pickleball', city: 'indianapolis', capacity: 8, starts_at: later, price_cents: null, club_discount_pct: 0, general_opens_at: opens, event_rsvps: [] },
    // Already on the list, waiver on record, from an earlier session.
    { id: 'event-3', title: 'Sunset Social', venue: 'Riverside', sport: 'tennis', city: 'indianapolis', capacity: 8, starts_at: soon, event_rsvps: [{ user_id: 'me-uuid', status: 'going', waiver_accepted_at: '2026-11-12T10:00:00Z', checked_in_at: null }] },
  ];
  // What get_my_crew would say: nobody, until the member has checked in.
  let serverCrew = [];
  impl.fetchCrew = () => serverCrew;

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(80); });

  const ev = (id = 'event-1') => app.events.find((e) => e.id === id) || {};
  check('the events loaded', ev().title === 'Doubles Mixer' && app.events.length === 3, app.events.map((e) => e.title));
  check('the crew is asked for when the app opens', named('fetchCrew').length === 1, named('fetchCrew').length);
  check('and is empty before any check-in', app.crew.length === 0, app.crew);

  // ---- what an event row carries ----
  check('an event carries its price and the Club saving', ev().priceCents === 1200 && ev().clubDiscountPct === 15, [ev().priceCents, ev().clubDiscountPct]);
  check('no price and no saving stay empty, not zero-dollar offers', ev('event-2').priceCents === null && ev('event-2').clubDiscountPct === 0, [ev('event-2').priceCents, ev('event-2').clubDiscountPct]);
  check('Club early access comes through as the moment it opens to everyone', ev('event-2').generalOpensAt === opens && ev().generalOpensAt === null, [ev('event-2').generalOpensAt, ev().generalOpensAt]);
  check('the member’s tier comes from the profile', app.tier === 'club', app.tier);
  check('a waiver already on record is read from the member’s own RSVP', ev('event-3').going === true && ev('event-3').waiverAccepted === true && ev('event-3').checkedIn === false, ev('event-3'));

  // ---- no check-in without an RSVP ----
  let ok;
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('event-1', 'COURT7'); await tick(); });
  check('check-in without an RSVP is refused', ok === false && named('checkInToEvent').length === 0, [ok, named('checkInToEvent').length]);
  check('and says to RSVP first', alerts.length === 1 && /RSVP before you check in/.test(alerts[0].message || ''), alerts);

  // ---- RSVP, with the waiver refusing to save ----
  impl.rsvp = () => ({ ok: true });
  impl.acceptEventWaiver = () => { throw new Error('network'); };
  alerts.length = 0;
  calls.length = 0;
  await act(async () => { ok = await app.rsvpWithWaiver('event-1'); await tick(); });
  const order = calls.map((c) => c.name);
  check('the RSVP is sent first, then the waiver', order.indexOf('rsvp') >= 0 && order.indexOf('acceptEventWaiver') > order.indexOf('rsvp'), order);
  check('the waiver is accepted for that event', named('acceptEventWaiver')[0] && named('acceptEventWaiver')[0].args.join() === 'event-1', named('acceptEventWaiver').map((c) => c.args));
  check('the RSVP stands when the waiver doesn’t save', ok === true && ev().going === true, [ok, ev().going]);
  check('but the waiver is not shown as accepted', ev().waiverAccepted === false, ev().waiverAccepted);
  check('and the member is told it didn’t save', alerts.length === 1 && /waiver/i.test(alerts[0].title), alerts.map((a) => a.title));

  // ---- waiver before check-in ----
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('event-1', 'COURT7'); await tick(); });
  check('check-in is not attempted before the waiver is accepted', ok === false && named('checkInToEvent').length === 0, [ok, named('checkInToEvent').length]);
  check('and says the waiver comes first', alerts.length === 1 && /Accept the event waiver first/.test(alerts[0].message || ''), alerts);
  check('the member is still not checked in', ev().checkedIn === false, ev().checkedIn);

  impl.acceptEventWaiver = () => null;
  alerts.length = 0;
  await act(async () => { ok = await app.acceptWaiver('event-1'); await tick(); });
  check('accepting the waiver records it', ok === true && ev().waiverAccepted === true && alerts.length === 0, [ok, ev().waiverAccepted, alerts]);

  // ---- a refused code shows the server's message ----
  const crewAsks = () => named('fetchCrew').length;
  let asksBefore = crewAsks();
  impl.checkInToEvent = () => { throw refuse('That code isn’t right.'); };
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('event-1', 'WRONG1'); await tick(); });
  check('a wrong code is sent to the server to judge', named('checkInToEvent').length === 1 && named('checkInToEvent')[0].args.join() === 'event-1,WRONG1', named('checkInToEvent').map((c) => c.args));
  check('a refused code shows the server’s message', alerts.length === 1 && alerts[0].message === 'That code isn’t right.', alerts);
  check('a refused code does not check the member in', ok === false && ev().checkedIn === false, [ok, ev().checkedIn]);
  check('and no crew is fetched for a check-in that didn’t happen', crewAsks() === asksBefore && app.crew.length === 0, [crewAsks(), asksBefore]);

  impl.checkInToEvent = () => { throw refuse('Check-in opens an hour before the event.'); };
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('event-1', 'COURT7'); await tick(); });
  check('too early says so in the server’s words', ok === false && alerts.length === 1 && alerts[0].message === 'Check-in opens an hour before the event.', alerts);

  impl.checkInToEvent = () => { throw new Error('Network request failed'); };
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('event-1', 'COURT7'); await tick(); });
  check('a dropped connection is named as one, not as a bad code', ok === false && alerts.length === 1 && /connection/i.test(alerts[0].message || '') && !/code/i.test(alerts[0].message || ''), alerts);

  // The server has no waiver on record after all (accepted on a list that has
  // since changed): its word wins, and the app asks for the waiver again.
  impl.checkInToEvent = () => { throw refuse('Accept the event waiver first.', '42501'); };
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('event-1', 'COURT7'); await tick(); });
  check('if the server has no waiver on record, the app stops showing one', ok === false && ev().waiverAccepted === false && /waiver/i.test(alerts[0].message || ''), [ev().waiverAccepted, alerts]);
  await act(async () => { await app.acceptWaiver('event-1'); await tick(); });

  // ---- the right code: checked in, and the crew appears ----
  serverCrew = [
    { user_id: 'u-maya', first_name: 'Maya', event_id: 'event-1', event_title: 'Doubles Mixer', event_starts_at: soon, added: false, also_open_to_dating: true },
    { user_id: 'u-lena', first_name: 'Lena', event_id: 'event-1', event_title: 'Doubles Mixer', event_starts_at: soon, added: true, also_open_to_dating: false },
    // The flag missing, or something that only looks like yes.
    { user_id: 'u-priya', first_name: 'Priya', event_id: 'event-1', event_title: 'Doubles Mixer', event_starts_at: soon, added: false },
    { user_id: 'u-grace', first_name: 'Grace', event_id: 'event-1', event_title: 'Doubles Mixer', event_starts_at: soon, added: false, also_open_to_dating: 'true' },
    { user_id: 'u-omar', first_name: 'Omar', event_id: 'event-1', event_title: 'Doubles Mixer', event_starts_at: soon, added: false, also_open_to_dating: null },
  ];
  impl.checkInToEvent = () => null;
  asksBefore = crewAsks();
  alerts.length = 0;
  calls.length = 0;
  await act(async () => { ok = await app.checkIn('event-1', '  court7 '); await tick(); });
  check('the code is sent as the host reads it: trimmed, upper case', named('checkInToEvent')[0] && named('checkInToEvent')[0].args.join() === 'event-1,COURT7', named('checkInToEvent').map((c) => c.args));
  check('the right code checks the member in, quietly', ok === true && ev().checkedIn === true && alerts.length === 0, [ok, ev().checkedIn, alerts]);
  const seq = calls.map((c) => c.name);
  check('the crew is fetched after the check-in', seq.indexOf('fetchCrew') > seq.indexOf('checkInToEvent'), seq);
  check('the crew appears after check-in', app.crew.map((c) => c.name).join() === 'Maya,Lena,Priya,Grace,Omar', app.crew.map((c) => c.name));
  check('each crew member carries the event they were met at', app.crew[0].eventTitle === 'Doubles Mixer' && app.crew[0].eventId === 'event-1', app.crew[0]);
  check('Added / not added is the server’s', app.crew.map((c) => c.added).join() === 'false,true,false,false,false', app.crew.map((c) => c.added));

  // ---- the dating tag follows the server's flag, and only that ----
  const tag = (id) => (app.crew.find((c) => c.id === id) || {}).alsoOpenToDating;
  check('the dating tag shows where the server said true', tag('u-maya') === true, tag('u-maya'));
  check('and not where it said false — though the member is in Date mode', tag('u-lena') === false && app.user.modes.includes('date'), [tag('u-lena'), app.user.modes]);
  check('a missing, null or merely truthy flag is not a yes', tag('u-priya') === false && tag('u-omar') === false && tag('u-grace') === false, [tag('u-priya'), tag('u-omar'), tag('u-grace')]);
  check('nobody is tagged except by the server', app.crew.filter((c) => c.alsoOpenToDating).map((c) => c.id).join() === 'u-maya', app.crew.filter((c) => c.alsoOpenToDating).map((c) => c.id));

  // The member turns Date mode off. The app does not edit the tags itself: it
  // shows what the server last said until the server says otherwise.
  impl.updateMyProfile = () => null;
  await act(async () => { app.updateModes(['play']); await tick(); });
  check('changing my own modes does not make the app re-decide the tag', tag('u-maya') === true && tag('u-lena') === false, [tag('u-maya'), tag('u-lena')]);
  serverCrew = serverCrew.map((r) => ({ ...r, also_open_to_dating: false }));
  await act(async () => { app.reloadCrew(); await tick(); });
  check('the tag goes when the server withdraws it', app.crew.every((c) => c.alsoOpenToDating === false), app.crew.map((c) => c.alsoOpenToDating));
  serverCrew = serverCrew.map((r) => ({ ...r, also_open_to_dating: r.user_id === 'u-lena' }));
  await act(async () => { app.reloadCrew(); await tick(); });
  check('and appears where the server grants it — though the member has left Date mode', tag('u-lena') === true && !app.user.modes.includes('date'), [tag('u-lena'), app.user.modes]);

  // ---- Add / Added ----
  impl.addToCrew = () => null;
  alerts.length = 0;
  await act(async () => { app.addToCrew('u-maya'); await tick(); });
  check('Add goes through crew_add', named('addToCrew').length === 1 && named('addToCrew')[0].args.join() === 'u-maya', named('addToCrew').map((c) => c.args));
  check('and shows as Added', app.crew.find((c) => c.id === 'u-maya').added === true && alerts.length === 0, alerts);

  impl.addToCrew = () => { throw refuse('You can add people you’ve shared a court with.'); };
  alerts.length = 0;
  await act(async () => { app.addToCrew('u-priya'); await tick(); });
  check('a refused Add is put back', app.crew.find((c) => c.id === 'u-priya').added === false, app.crew.find((c) => c.id === 'u-priya'));
  check('and says why, in the server’s words', alerts.length === 1 && /shared a court/.test(alerts[0].message || ''), alerts);

  impl.removeFromCrew = () => { throw new Error('network'); };
  alerts.length = 0;
  await act(async () => { app.removeFromCrew('u-maya'); await tick(); });
  check('a failed remove leaves them Added and says so', app.crew.find((c) => c.id === 'u-maya').added === true && alerts.length === 1, alerts);
  impl.removeFromCrew = () => null;
  await act(async () => { app.removeFromCrew('u-maya'); await tick(); });
  check('a remove that lands goes through crew_remove', named('removeFromCrew').length === 2 && app.crew.find((c) => c.id === 'u-maya').added === false, named('removeFromCrew').map((c) => c.args));

  // ---- blocking someone from the crew ----
  impl.blockUser = () => ({ ok: true });
  await act(async () => { app.block('u-omar'); await tick(); });
  check('someone blocked leaves the crew at once', !app.crew.some((c) => c.id === 'u-omar') && named('blockUser').some((c) => c.args[0] === 'u-omar'), app.crew.map((c) => c.id));
  impl.reportUser = () => ({ ok: true });
  await act(async () => { app.report('u-grace', 'event'); await tick(); });
  const rep = named('reportUser').pop();
  check('a report from the crew list is filed as met at an event', rep && rep.args[0] === 'u-grace' && rep.args[2] === 'event', rep && rep.args);
  check('someone reported leaves the crew at once', !app.crew.some((c) => c.id === 'u-grace'), app.crew.map((c) => c.id));

  // ---- checked in is a record: it isn't un-RSVP'd ----
  calls.length = 0;
  await act(async () => { app.toggleJoin('event-1'); await tick(); });
  check('a checked-in RSVP cannot be toggled off', named('rsvp').length === 0 && ev().going === true && ev().checkedIn === true, [named('rsvp').length, ev().going]);

  // ---- leaving an event takes the waiver with it ----
  check('event 3 starts with its waiver on record', ev('event-3').waiverAccepted === true);
  await act(async () => { app.toggleJoin('event-3'); await tick(); });
  await act(async () => { app.toggleJoin('event-3'); await tick(); });
  check('an RSVP made again starts with no waiver', ev('event-3').going === true && ev('event-3').waiverAccepted === false, ev('event-3'));
  calls.length = 0;
  alerts.length = 0;
  await act(async () => { ok = await app.checkIn('event-3', 'COURT7'); await tick(); });
  check('so check-in asks for the waiver again', ok === false && named('checkInToEvent').length === 0 && /waiver/i.test(alerts[0].message || ''), alerts);

  // ---- an RSVP the server refuses on purpose says why, and no waiver is sent ----
  impl.rsvp = () => { throw refuse('Club members can RSVP now. Everyone else from Friday.', '42501'); };
  calls.length = 0;
  alerts.length = 0;
  await act(async () => { ok = await app.rsvpWithWaiver('event-2'); await tick(); });
  check('a refused RSVP is not left showing as going', ok === false && ev('event-2').going !== true, [ok, ev('event-2').going]);
  check('it says why, in the server’s words', alerts.length === 1 && /Club members can RSVP now/.test(alerts[0].message || ''), alerts);
  check('and no waiver is recorded for an RSVP that didn’t happen', named('acceptEventWaiver').length === 0, named('acceptEventWaiver').length);

  // ---- nothing here is written by the member directly ----
  const rowWrites = named('updateMyProfile').concat(named('upsertMyProfile')).map((c) => c.args[0] || {});
  const forbidden = ['tier', 'waiver_accepted_at', 'waiver_version', 'checked_in_at', 'status'];
  check('tier, waiver and check-in are never written to a row by the app', !rowWrites.some((w) => forbidden.some((k) => k in w)), rowWrites);

  await act(async () => { renderer.unmount(); });

  // ---- the tier is the desk's, and a relaunch picks up a change ----
  // The profile is cached on the phone from the run above (tier: club). The
  // desk has since moved the member to Plus; then the read fails altogether.
  const relaunch = async () => {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
    });
    await act(async () => { await tick(80); });
  };
  impl.getMyProfile = () => ({ ...PROFILE, tier: 'plus' });
  await relaunch();
  check('a tier the desk has changed is picked up when the app is next opened', app.tier === 'plus', app.tier);
  await act(async () => { renderer.unmount(); });
  impl.getMyProfile = () => { throw new Error('network'); };
  alerts.length = 0;
  await relaunch();
  check('if the tier can\u2019t be read, the last known one stands, quietly', app.tier === 'plus' && alerts.length === 0 && app.bootRoute === 'Main', [app.tier, alerts, app.bootRoute]);
  await act(async () => { renderer.unmount(); });
  impl.getMyProfile = () => ({ ...PROFILE, tier: 'platinum' });
  await relaunch();
  check('a tier the app doesn\u2019t know is treated as free, not guessed at', app.tier === 'free', app.tier);
  await act(async () => { renderer.unmount(); });

  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
