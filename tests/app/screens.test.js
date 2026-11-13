// The screens that draw the events-first flow, rendered for real against the
// shipped provider: Home leads with events and keeps the deck working, the
// RSVP card walks waiver → check-in → crew, the crew sits above the matches
// with the server-decided dating tag, a drawn tournament is a bracket by
// rounds, ladders offer "Challenge" only within reach, and the tier shows on
// the profile. React Native's components are plain host elements here
// (stubs/react-native.js, stubs/ui.js) — the screens' own code is untouched.
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
const act = TestRenderer.act;
const tick = (n = 30) => new Promise((r) => setTimeout(r, n));

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

const OPTIC = '#C8F04A';
const flat = (style) => Object.assign({}, ...[].concat(style || []).flat(Infinity).filter(Boolean));

// Everything a node shows, as one string, in reading order.
function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children || []).map(textOf).join(node.type === 'Text' ? '' : ' ');
}

// A screen mounted inside the real provider, with helpers to read and press it.
function harness(bundle) {
  const h = { app: null, navs: [], params: [], backs: 0, resets: [], renderer: null, alerts: bundle.alerts, calls: bundle.calls, impl: bundle.impl };
  const navigation = {
    navigate: (name, params) => { h.navs.push(name); h.params.push(params); },
    goBack: () => { h.backs += 1; },
    reset: (state) => h.resets.push(state),
    addListener: () => () => {},
  };
  // Nothing is drawn until there is a member, as in the app's navigator.
  function Gate({ screen, route }) {
    const app = bundle.useApp();
    h.app = app;
    return app.user && screen ? React.createElement(screen, { navigation, route }) : null;
  }
  function Root({ screen, route }) {
    return React.createElement(bundle.AppStateProvider, null, React.createElement(Gate, { screen, route }));
  }
  h.mount = async (screen) => {
    await act(async () => { h.renderer = TestRenderer.create(React.createElement(Root, { screen })); });
    await act(async () => { await tick(80); });
  };
  // `route` is what the navigator would hand the screen ({ params }).
  h.show = async (screen, route) => {
    await act(async () => { h.renderer.update(React.createElement(Root, { screen, route })); });
    await act(async () => { await tick(); });
  };
  // Where the last navigate() went, and with what.
  h.lastNav = () => ({ name: h.navs[h.navs.length - 1], params: h.params[h.params.length - 1] });
  h.text = () => textOf(h.renderer.toJSON());
  h.all = (type) => h.renderer.root.findAll((n) => n.type === type);
  const label = (n) => n.props.accessibilityLabel || '';
  const toJson = (inst) => {
    if (typeof inst === 'string') return inst;
    return { type: inst.type, children: inst.children.map(toJson) };
  };
  // The words inside one rendered node.
  h.textIn = (inst) => textOf(toJson(inst)).replace(/\s+/g, ' ').trim();
  // Pressables, by accessibility label or failing that by the words on them.
  h.buttons = (what) => {
    const test = what instanceof RegExp ? (s) => what.test(s) : (s) => s === what;
    return h.all('Pressable').filter((n) => n.props.onPress && (test(label(n)) || test(h.textIn(n))));
  };
  h.button = (what) => h.buttons(what)[0];
  h.press = async (what) => {
    const b = typeof what === 'object' && !(what instanceof RegExp) ? what : h.button(what);
    if (!b) throw new Error(`no button: ${what}`);
    await act(async () => { await b.props.onPress(); await tick(); });
  };
  // Tap a button in the alert that is showing.
  h.answer = async (text) => {
    const a = h.alerts[h.alerts.length - 1];
    const b = a && a.buttons.find((x) => x.text === text);
    if (!b) throw new Error(`no alert button: ${text}`);
    await act(async () => { await b.onPress(); await tick(); });
  };
  h.unmount = async () => { await act(async () => { h.renderer.unmount(); }); };
  return h;
}

const DRAFT = {
  name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', modes: ['friends', 'date', 'play'],
  gender: 'man', seeking: ['woman'], playGames: ['singles', 'doubles', 'mixed_doubles'], playPref: 'everyone',
  friendsPref: 'everyone', sports: ['Tennis'], skill: 'Intermediate', rating: '', bio: '', photo: null,
};

async function demo() {
  const B = require('./.build/state.demo.cjs');
  B.resetStorage();
  const h = harness(B);
  await h.mount(null);
  await act(async () => { await h.app.finishOnboarding(DRAFT); await tick(); });

  // ---------- Home: events first ----------
  await h.show(B.HomeScreen);
  let t = h.text();
  const at = (s) => t.indexOf(s);
  check('Home leads with "This week on the courts"', at('This week on the courts') >= 0, t.slice(0, 200));
  check('then "Find a game"', at('Find a game') > at('This week on the courts'), [at('This week on the courts'), at('Find a game')]);
  const titles = h.app.events.slice(0, 3).map((e) => e.title);
  check('the next three events sit between the two headings', titles.every((x) => at(x) > at('This week on the courts') && at(x) < at('Find a game')), titles.map(at));
  check('and no more than three', at(h.app.events[3].title) === -1, h.app.events[3].title);
  check('each has an RSVP control', h.buttons(/^RSVP to /).length === 3, h.buttons(/^RSVP to /).length);
  const pills = ['Play Mode', 'Date Mode', 'Friends Mode'].map(at);
  check('the mode pills are under "Find a game", in the order Play, Date, Friends', pills[0] > at('Find a game') && pills[0] < pills[1] && pills[1] < pills[2], pills);
  const first = h.app.currentProfile();
  check('the deck is there, below the pills', !!first && at(first.name) > pills[2], [first && first.name, at(first.name)]);
  check('a Club saving shows on the event that has one, and only there', (t.match(/Club members save 15%/g) || []).length === 1 && !/Club members save 0%/.test(t), t.match(/Club members save \d+%/g));

  // the deck keeps working exactly as before
  await h.press(`Pass on ${first.name}`);
  const second = h.app.currentProfile();
  check('passing moves the deck on', !!second && second.id !== first.id && h.text().includes(second.name), [first.name, second && second.name]);
  await h.press('Rewind last card');
  check('rewind brings the card back', h.app.currentProfile().id === first.id, h.app.currentProfile().id);
  await h.press(/^Request to hit /);
  check('a like still goes through the deck', h.app.currentProfile().id !== first.id, h.app.currentProfile().id);
  await h.press('Date Mode');
  check('a mode pill still switches the mode', h.app.mode === 'date', h.app.mode);
  await h.press('Play Mode');

  // ---------- the RSVP card: waiver, then check-in, then the crew ----------
  const title = titles[0];
  B.alerts.length = 0;
  await h.press(`RSVP to ${title}`);
  check('RSVP opens the waiver line rather than booking at once', h.text().includes('I’ve read the event waiver and code of conduct') && !h.app.events[0].going, h.app.events[0].going);
  await h.press('Confirm RSVP');
  check('confirming without the tick is refused', !h.app.events[0].going && B.alerts.length === 1 && /Tick the box first/.test(B.alerts[0].title), B.alerts);
  await h.press('Read the waiver');
  check('the waiver can be read before ticking', h.text().includes('I am playing at my own risk.') && h.text().includes('Version 2026-11-draft'), h.text().slice(-300));
  await h.press('Close');
  await h.press('I’ve read the event waiver and code of conduct');
  await h.press('Confirm RSVP');
  check('ticked and confirmed, the member is going with the waiver on record', h.app.events[0].going === true && h.app.events[0].waiverAccepted === true, h.app.events[0]);
  check('a joined event shows "Check in"', !!h.button(`Check in to ${title}`) && h.text().includes('Going ✓'), h.text().slice(0, 400));

  await h.press(`Check in to ${title}`);
  const input = () => h.all('TextInput')[0];
  check('Check in asks for the host’s code', !!input() && h.text().includes('Host’s check-in code'), h.all('TextInput').length);
  check('the demo says its code isn’t real', /Demo: there’s no host and no real code/.test(h.text()));
  B.alerts.length = 0;
  await h.press('Check in');
  check('an empty code is refused, and says so', !h.app.events[0].checkedIn && B.alerts.length === 1, B.alerts);
  await act(async () => { input().props.onChangeText('court-7'); await tick(); });
  check('the code box keeps to letters and digits, upper case', input().props.value === 'COURT7', input().props.value);
  await h.press('Check in');
  check('the code checks the member in', h.app.events[0].checkedIn === true && h.text().includes('Checked in ✓'), h.app.events[0].checkedIn);
  check('a checked-in event has no button to cancel with', !h.button(/^Going to /) || h.buttons(/^Going to /).every((b) => !b.props.accessibilityLabel.includes(title)), h.buttons(/^Going to /).length);
  await h.press('See your crew');
  check('and leads through to the crew', h.navs[h.navs.length - 1] === 'Matches', h.navs);

  // ---------- Matches: the crew on top ----------
  await h.show(B.MatchesScreen);
  t = h.text();
  check('"Your crew" is at the top of the Matches tab, above the matches', t.indexOf('Your crew') >= 0 && t.indexOf('Your crew') < t.indexOf('Message →'), [t.indexOf('Your crew'), t.indexOf('Message →')]);
  check('with its line about who they are', t.includes('The people you shared a court with.'));
  check('the people from the event are listed', h.app.crew.length === 3 && h.app.crew.every((c) => t.includes(c.name)), h.app.crew.map((c) => c.name));
  check('the demo crew is labelled as sample players', /Demo: these are sample players/.test(t));
  const tags = (t.match(/Also open to dating/g) || []).length;
  check('the dating tag shows once for each flagged crew member, and nowhere else', tags === h.app.crew.filter((c) => c.alsoOpenToDating).length && tags === 1, [tags, h.app.crew.map((c) => c.alsoOpenToDating)]);
  const who = h.app.crew[1];
  await h.press(`Add ${who.name} to your crew`);
  check('Add becomes Added', h.app.crew[1].added === true && !!h.button(`${who.name} is in your crew. Tap to remove`) && h.text().includes('Added ✓'), h.app.crew[1]);
  B.alerts.length = 0;
  await h.press(`More options for ${who.name}`);
  check('every crew member can be reported or blocked', B.alerts.length === 1 && B.alerts[0].buttons.some((b) => /^Report /.test(b.text)) && B.alerts[0].buttons.some((b) => /^Block /.test(b.text)), B.alerts.map((a) => a.buttons.map((b) => b.text)));
  await h.answer(`Block ${who.name}`);
  check('blocking takes them off the list', !h.text().includes(who.name) && h.app.crew.length === 2, h.app.crew.map((c) => c.name));

  // ---------- Events: bracket and ladders ----------
  await h.show(B.EventsScreen);
  check('the Events tab uses the same card: the checked-in event says so here too', h.text().includes('Checked in ✓'));
  await h.press('See the bracket');
  t = h.text();
  // The round labels, in the order they are drawn (the bye line also names a
  // round, so these are the headings themselves, not a search of the page).
  const NAMES = ['Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];
  const heads = h.all('Text').map((n) => h.textIn(n)).filter((x) => NAMES.includes(x));
  check('a drawn tournament shows a column per round, each labelled, in order', heads.join('|') === NAMES.join('|'), heads);
  const cols = h.all('View').filter((n) => flat(n.props.style).width === 214);
  check('the rounds are columns side by side in one sideways scroller', cols.length === 4 && h.all('ScrollView').some((n) => n.props.horizontal && n.findAll((x) => x.type === 'View' && flat(x.props.style).width === 214).length === 4), cols.length);
  const T = h.app.tournaments.find((x) => x.status === 'in_progress');
  const played = T.matches.filter((m) => m.winner && !m.bye);
  const lit = h.all('View').filter((n) => flat(n.props.style).borderLeftColor === OPTIC);
  check('each played match has its winner’s row lit in optic', lit.length === played.length && lit.length === 4, [lit.length, played.length]);
  const scoreNode = lit[0].findAll((n) => n.type === 'Text' && flat(n.props.style).textAlign === 'right')[0];
  check('with the score right-aligned on that row', !!scoreNode && h.textIn(scoreNode) === played[0].score, scoreNode && h.textIn(scoreNode));
  check('and the winner’s name on it', h.textIn(lit[0]).includes(h.app.playerName(played[0].winner)), h.textIn(lit[0]));
  check('byes are counted in a line, not drawn as matches', /4 players have a bye/.test(t), t.match(/\d+ players? ha\w+ a bye[^.]*\./));
  check('a match waiting on a result can be recorded (demo)', h.buttons(/^Record .* as the winner$/).length > 0, h.buttons(/^Record /).length);

  t = h.text();
  check('ladder leagues are listed under the tournaments', t.indexOf('Ladder leagues') > t.indexOf('Tournaments'), [t.indexOf('Tournaments'), t.indexOf('Ladder leagues')]);
  const lg = h.app.leagues[0];
  await h.press(`Join ${lg.title}`);
  check('Join puts the member on the ladder', h.app.leagues[0].joined && !!h.button(`On the ladder for ${lg.title}. Tap to leave`), h.app.leagues[0].joined);
  t = h.text();
  check('the open ladder shows the rungs and the member’s own', t.includes(`You’re on rung ${h.app.leagues[0].myRung} of ${h.app.leagues[0].standings.length}`), t.match(/You’re on rung \d+ of \d+/));
  const reach = h.app.leagues[0].standings.filter((r) => h.app.canChallenge(h.app.leagues[0], r));
  check('"Challenge" is offered on the two rungs above, and only those', h.buttons(/^Challenge /).length === 2 && reach.length === 2 && reach.every((r) => h.app.leagues[0].myRung - r.rung <= 2), [h.buttons(/^Challenge /).length, reach.map((r) => r.rung)]);
  B.alerts.length = 0;
  await h.press(`Challenge ${reach[0].name}`);
  await h.answer('Challenge');
  check('a challenge is confirmed first, then open against that player', h.app.leagues[0].challenges.length === 1 && h.text().includes('You challenged them'), h.app.leagues[0].challenges);
  check('who can no longer be challenged again', h.buttons(/^Challenge /).length === 1, h.buttons(/^Challenge /).length);
  await h.press(`Record that you beat ${reach[0].name}`);
  await h.answer('Record result');
  check('recording the win moves the member up to their rung', h.app.leagues[0].myRung === reach[0].rung && h.app.leagues[0].challenges.length === 0, [h.app.leagues[0].myRung, reach[0].rung]);
  B.alerts.length = 0;
  await h.press(`On the ladder for ${lg.title}. Tap to leave`);
  check('leaving a ladder asks first', h.app.leagues[0].joined === true && B.alerts.length === 1 && /Leave /.test(B.alerts[0].title), B.alerts.map((a) => a.title));
  await h.answer('Leave the ladder');
  check('and then takes the member off', h.app.leagues[0].joined === false, h.app.leagues[0].joined);

  // ---------- Profile: the tier ----------
  await h.show(B.ProfileScreen);
  check('the profile shows the member’s tier', h.text().includes('Free member'), h.text().slice(0, 200));
  check('the demo never called the backend', B.calls.length === 0, B.calls.map((c) => c.name));

  // ---------- Event detail: opened from a card, same RSVP as the card ----------
  await h.show(B.HomeScreen);
  const ev = h.app.events[1];
  check('the second event on Home is free and not yet joined (the setup this section needs)', ev.priceCents == null && !ev.going && !!ev.desc, ev);
  await h.press(`${ev.title}: see the details`);
  const nav = h.lastNav();
  check('tapping an event card opens its detail screen', nav.name === 'EventDetail' && nav.params && nav.params.id === ev.id, nav);
  await h.show(B.EventDetailScreen, { params: nav.params });
  t = h.text();
  check('the detail shows the event’s title, venue, day and time', t.includes(ev.title) && t.includes(ev.venue) && t.includes(`${ev.dow} ${ev.dom} · ${ev.time}`), t.slice(0, 300));
  check('and its sport and level', t.includes(ev.sport) && t.includes(ev.level));
  const steps = B.descSteps(ev.desc);
  check('"How the night works" is the event’s own description, split only at sentence ends', t.includes('How the night works') && steps.length > 1 && steps.join(' ') === ev.desc && steps.every((x) => t.includes(x)), steps);
  check('a sentence split never breaks a rating or an abbreviation', B.descSteps('NTRP 3.0–4.0 only. Int. and up welcome! Bring water.').length === 3 && B.descSteps('').length === 0 && B.descSteps('One line').join() === 'One line');
  check('spots left and the show-up line are there', t.includes(`${ev.spotsLeft} spots left`) && t.includes('RSVP means show up. Check in with the host’s code when you arrive.'));
  check('a free event shows no price and no Club saving', !/\$\d/.test(t) && !/Club members save/.test(t), t.match(/\$\d[\d.]*|Club members save \d+%/g));
  B.shares.length = 0;
  await h.press('Share event');
  const msg = B.shares[0] && B.shares[0].message;
  check('Share sends the title, day, time and venue, and no made-up link', !!msg && [ev.title, `${ev.dow} ${ev.dom}`, ev.time, ev.venue].every((x) => msg.includes(x)) && !/https?:/.test(msg), msg);

  B.alerts.length = 0;
  await h.press(`RSVP to ${ev.title}`);
  check('RSVP on the detail opens the waiver line', h.text().includes('I’ve read the event waiver and code of conduct') && !h.app.events[1].going);
  await h.press('Confirm RSVP');
  check('without the tick it is refused, as on the card', !h.app.events[1].going && B.alerts.length === 1 && /Tick the box first/.test(B.alerts[0].title), B.alerts);
  await h.press('I’ve read the event waiver and code of conduct');
  await h.press('Confirm RSVP');
  check('ticked and confirmed: going, waiver on record, "Going ✓"', h.app.events[1].going && h.app.events[1].waiverAccepted && h.text().includes('Going ✓'), h.app.events[1]);
  check('and the count says it includes you', h.text().includes('going · including you'));
  await h.press(`Check in to ${ev.title}`);
  check('check-in asks for the host’s code', h.all('TextInput').length === 1 && h.text().includes('Host’s check-in code'));
  await act(async () => { h.all('TextInput')[0].props.onChangeText('ab12'); await tick(); });
  await h.press('Check in');
  check('the code checks the member in, on the detail', h.app.events[1].checkedIn === true && h.text().includes('Checked in ✓'), h.app.events[1]);
  await h.press('See your crew');
  check('"See your crew" leads to the Matches tab', h.lastNav().name === 'Main' && h.lastNav().params.screen === 'Matches', h.lastNav());
  await h.press('Back');
  check('Back goes back', h.backs === 1, h.backs);
  await h.show(B.HomeScreen);
  const card = h.button(`${ev.title}: see the details`).parent.parent;
  check('the card on Home shows the same check-in', h.textIn(card).includes('Checked in ✓') && !h.button(`RSVP to ${ev.title}`), h.textIn(card));

  // a priced event: the price and the Club saving, from the same helpers as the card
  const paid = h.app.events.find((x) => x.priceCents > 0 && x.clubDiscountPct > 0);
  await h.show(B.EventDetailScreen, { params: { id: paid.id } });
  t = h.text();
  check('a priced event shows its price and the Club saving', t.includes(B.priceLabel(paid.priceCents)) && /^\$\d/.test(B.priceLabel(paid.priceCents)) && t.includes(`Club members save ${paid.clubDiscountPct}%`), t.match(/\$\d[\d.]*|Club members save \d+%/g));

  // who's going: never someone blocked or reported
  const faces = () => h.renderer.root.findAll((n) => n.props && n.props.size === 36 && n.props.id && n.props.name && typeof n.type === 'function').map((n) => n.props.id);
  await h.show(B.EventDetailScreen, { params: { id: 'e1' } });
  let shown = faces();
  check('the going row shows the sample players, minus the one blocked from the crew', shown.length === 2 && !shown.includes(who.id), shown);
  const gone = shown[0];
  await act(async () => { h.app.report(gone, 'event'); await tick(); });
  await h.show(B.EventDetailScreen, { params: { id: 'e1' } });
  shown = faces();
  check('someone reported leaves the going row at once', shown.length === 1 && !shown.includes(gone) && !shown.includes(who.id), shown);
  await h.show(B.EventDetailScreen, { params: { id: 'nope' } });
  check('an event no longer on the list says so instead of crashing', h.text().includes('This event isn’t on your list any more'));

  // ---------- Settings → House rules & safety ----------
  await h.show(B.SettingsScreen);
  check('Settings has a "House rules & safety" row', h.text().includes('House rules & safety') && !!h.button('House rules & safety'));
  await h.press('House rules & safety');
  check('which opens the rules screen', h.lastNav().name === 'Rules', h.lastNav());
  check('the safety tips link is still the website', h.text().includes('Safety tips'));
  await h.show(B.RulesScreen);
  t = h.text();
  check('seven rules, numbered 1 to 7', B.HOUSE_RULES.length === 7 && B.HOUSE_RULES.every((r, i) => t.includes(`${i + 1} ${r.head}`) && t.includes(r.body)), t.slice(0, 400));
  check('no rule promises what the app doesn’t do', !/Hosts can remove|re-rated by the desk/.test(t));
  B.opened.length = 0;
  await h.press('Privacy policy');
  await h.press('Terms of use');
  check('Privacy policy and Terms of use open the site pages', /\/privacy\/$/.test(B.opened[0] || '') && /\/terms\/$/.test(B.opened[1] || ''), B.opened);
  B.alerts.length = 0;
  await h.press('Delete account');
  const del = B.alerts[0];
  check('Delete account asks first, with the Settings delete flow', !!del && del.title === 'Delete your account?' && del.buttons.some((b) => b.text === 'Delete forever'), B.alerts);
  await h.answer('Delete forever');
  check('and confirmed, signs out and goes back to Welcome', !h.app.user && h.resets.length === 1 && h.resets[0].routes[0].name === 'Welcome', [h.app.user && h.app.user.name, h.resets]);
  check('the demo still never called the backend', B.calls.length === 0, B.calls.map((c) => c.name));
  await h.unmount();
}

async function live() {
  const B = require('./.build/state.cjs');
  B.resetStorage();
  const soon = new Date(Date.now() + 30 * 60000).toISOString();
  const opens = new Date(Date.now() + 2 * 86400000).toISOString();
  let tier = 'plus';
  B.impl.getMyProfile = () => ({
    id: 'me-uuid', first_name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', tier,
    modes: ['date', 'play'], gender: 'man', seeking: ['woman'], radius_mi: 25, age_min: 25, age_max: 40,
    same_sports_only: false, bio: '', user_sports: [{ sport: 'tennis', level: 'intermediate', rating_label: '' }],
  });
  B.impl.listEvents = () => [
    { id: 'ev-1', title: 'Doubles Mixer', venue: 'Broad Ripple', sport: 'tennis', level_range: 'All levels', city: 'indianapolis', capacity: 12, starts_at: soon, price_cents: 1250, club_discount_pct: 20, general_opens_at: null, event_rsvps: [{ user_id: 'me-uuid', status: 'checked_in', waiver_accepted_at: soon, checked_in_at: soon }] },
    { id: 'ev-2', title: 'Club Night', venue: 'Tarkington', sport: 'pickleball', level_range: 'All levels', city: 'indianapolis', capacity: 8, starts_at: opens, price_cents: null, club_discount_pct: 0, general_opens_at: opens, event_rsvps: [] },
  ];
  B.impl.fetchCrew = () => [
    { user_id: 'u-maya', first_name: 'Maya', event_id: 'ev-1', event_title: 'Doubles Mixer', event_starts_at: soon, added: false, also_open_to_dating: true },
    { user_id: 'u-lena', first_name: 'Lena', event_id: 'ev-1', event_title: 'Doubles Mixer', event_starts_at: soon, added: true, also_open_to_dating: false },
    { user_id: 'u-priya', first_name: 'Priya', event_id: 'ev-1', event_title: 'Doubles Mixer', event_starts_at: soon, added: false },
  ];
  B.impl.getProfilesByIds = (ids) => ids.map((id) => ({ id, first_name: { 'u-a': 'Ana', 'u-b': 'Ben', 'u-c': 'Cal' }[id] || 'Player' }));
  B.impl.listTournaments = () => [{
    id: 't-1', city: 'indianapolis', title: 'Fall Classic', venue: 'Jastro Park', sport: 'pickleball', level_range: 'All levels',
    starts_at: soon, max_entries: 8, status: 'in_progress', bracket_size: 4, champion_id: null, completed_at: null, entry_count: 4,
    tournament_entries: [{ user_id: 'me-uuid', seed: 1 }, { user_id: 'u-a', seed: 2 }, { user_id: 'u-b', seed: 3 }, { user_id: 'u-c', seed: 4 }],
    tournament_matches: [
      { id: 'm-1', round: 1, slot: 0, player_a: 'me-uuid', player_b: 'u-c', winner: 'me-uuid', score: '11-8, 11-6', is_bye: false, reported_at: soon },
      { id: 'm-2', round: 1, slot: 1, player_a: 'u-a', player_b: 'u-b', winner: null, score: '', is_bye: false, reported_at: null },
      { id: 'm-3', round: 2, slot: 0, player_a: 'me-uuid', player_b: null, winner: null, score: '', is_bye: false, reported_at: null },
    ],
  }];

  const h = harness(B);
  await h.mount(B.HomeScreen);

  // ---------- Home, live ----------
  let t = h.text();
  check('live Home also leads with events, then "Find a game"', t.indexOf('This week on the courts') >= 0 && t.indexOf('Doubles Mixer') > t.indexOf('This week on the courts') && t.indexOf('Find a game') > t.indexOf('Doubles Mixer'), [t.indexOf('This week on the courts'), t.indexOf('Doubles Mixer'), t.indexOf('Find a game')]);
  check('a member with Date and Play opens on Play, and only their modes are offered', h.app.mode === 'play' && t.indexOf('Play Mode') < t.indexOf('Date Mode') && !t.includes('Friends Mode'), [h.app.mode, t.indexOf('Play Mode'), t.indexOf('Date Mode')]);
  check('the price and the Club saving are shown', t.includes('$12.50') && t.includes('Club members save 20%'), t.match(/\$[\d.]+|Club members save \d+%/g));
  check('an event with no saving shows none', (t.match(/Club members save/g) || []).length === 1);
  check('an event still in Club early access is not offered to a Plus member', !h.button('RSVP to Club Night') && /Club members can RSVP now\. It opens to everyone/.test(t), t.match(/Club[^.]*\./g));
  await h.press('Doubles Mixer: see the details');
  check('live: a card opens the detail for that event', h.lastNav().name === 'EventDetail' && h.lastNav().params.id === 'ev-1', h.lastNav());
  await h.show(B.EventDetailScreen, { params: { id: 'ev-1' } });
  t = h.text();
  check('live detail: title, venue, price and Club saving', t.includes('Doubles Mixer') && t.includes('Broad Ripple') && t.includes('$12.50') && t.includes('Club members save 20%'), t.slice(0, 400));
  check('live detail: the server’s check-in shows, with the count and no faces', t.includes('Checked in ✓') && t.includes('1 going · including you') && h.renderer.root.findAll((n) => n.props && n.props.size === 36 && n.props.id && typeof n.type === 'function').length === 0, t.match(/\d+ going[^0-9]*/));
  check('live detail: no description, so no invented steps', !t.includes('How the night works'));
  await h.show(B.EventDetailScreen, { params: { id: 'ev-2' } });
  t = h.text();
  check('live detail: a free event shows no price', !/\$\d/.test(t) && !/Club members save/.test(t));
  check('live detail: Club early access holds a Plus member here too', !h.button('RSVP to Club Night') && /Club members can RSVP now/.test(t));
  await h.show(B.ProfileScreen);
  check('the profile shows the tier the server gave', h.text().includes('Plus member'), h.text().slice(0, 200));

  // ---------- Matches, live: the tag is the server's ----------
  await h.show(B.MatchesScreen);
  t = h.text();
  check('the live crew is listed under "Your crew"', ['Maya', 'Lena', 'Priya'].every((n) => t.includes(n)) && t.indexOf('Your crew') < t.indexOf('Maya'), t.slice(0, 300));
  check('nothing live is labelled as demo data', !/Demo:/.test(t), t.match(/Demo:[^.]*\./));
  // One person's row: the card around their Add / Added button.
  const row = (name) => h.buttons(new RegExp(`^(Add ${name} to your crew|${name} is in your crew)`))[0].parent;
  check('"Also open to dating" is on the one person the server flagged', (t.match(/Also open to dating/g) || []).length === 1 && h.textIn(row('Maya')).includes('Also open to dating'), t.match(/Also open to dating/g));
  check('and on nobody else, though the member is in Date mode', !h.textIn(row('Lena')).includes('Also open to dating') && !h.textIn(row('Priya')).includes('Also open to dating') && h.app.user.modes.includes('date'));
  check('Added is shown as the server has it', h.textIn(row('Lena')).includes('Added ✓') && !h.textIn(row('Maya')).includes('Added ✓'), [h.textIn(row('Lena')), h.textIn(row('Maya'))]);

  // ---------- Events, live: the bracket ----------
  await h.show(B.EventsScreen);
  await h.press('See the bracket');
  t = h.text();
  const heads = h.all('Text').map((n) => h.textIn(n)).filter((x) => ['Semifinals', 'Final'].includes(x));
  check('the bracket has its two rounds, Semifinals then Final', heads.join('|') === 'Semifinals|Final', heads);
  const lit = h.all('View').filter((n) => flat(n.props.style).borderLeftColor === OPTIC);
  check('the winner’s row is highlighted in optic', lit.length === 1 && flat(lit[0].props.style).backgroundColor === 'rgba(200,240,74,0.16)', lit.length);
  const nameNode = lit[0].findAll((n) => n.type === 'Text' && flat(n.props.style).color === OPTIC)[0];
  check('with the winner’s name in optic', !!nameNode && h.textIn(lit[0]).startsWith('Sam'), h.textIn(lit[0]));
  const score = lit[0].findAll((n) => n.type === 'Text' && flat(n.props.style).textAlign === 'right')[0];
  check('and the score right-aligned on it', !!score && h.textIn(score) === '11-8, 11-6', score && h.textIn(score));
  const you = h.all('View').filter((n) => h.textIn(n) === 'You' && flat(n.props.style).borderColor === OPTIC && flat(n.props.style).borderRadius === 999);
  check('the member’s own rows carry a "You" tag — the played match and the final they reached', you.length === 2, you.length);
  check('the losing side is named but not lit', t.includes('Cal') && !h.textIn(lit[0]).includes('Cal'), h.textIn(lit[0]));
  check('a place still to be decided says so', t.includes('To be decided'));
  check('nobody else’s match, and no half-filled match, can be recorded', h.buttons(/^Record .* as the winner$/).length === 0, h.buttons(/^Record /).map((b) => b.props.accessibilityLabel));
  check('there is no demo draw button in the live app', !/Make the draw/.test(t));

  // the final fills; now it is the member's to record, with the confirmation it always had
  const rows = B.impl.listTournaments();
  rows[0].tournament_matches[1] = { ...rows[0].tournament_matches[1], winner: 'u-a', score: '11-9', reported_at: soon };
  rows[0].tournament_matches[2] = { ...rows[0].tournament_matches[2], player_b: 'u-a' };
  B.impl.listTournaments = () => rows;
  await act(async () => { h.app.reloadCourts(); await tick(80); });
  check('once both finalists are in, the member can record their own match', h.buttons(/^Record .* as the winner$/).length === 2, h.buttons(/^Record /).map((b) => b.props.accessibilityLabel));
  const sent = [];
  B.impl.reportMatchResult = (matchId, winner, sc) => { sent.push([matchId, winner, sc]); return null; };
  B.alerts.length = 0;
  await h.press('Record Sam as the winner');
  check('recording asks first, and says it makes them the champion', sent.length === 0 && B.alerts.length === 1 && /champion/.test(B.alerts[0].message), B.alerts);
  await h.answer('Record result');
  check('and then sends the match and the winner', sent.length === 1 && sent[0][0] === 'm-3' && sent[0][1] === 'me-uuid', sent);

  // ---------- a Club member gets the early RSVP ----------
  await h.unmount();
  B.resetStorage();
  tier = 'club';
  B.impl.fetchCrew = () => [];
  const h2 = harness(B);
  await h2.mount(B.MatchesScreen);
  check('with nobody in the crew yet, the section says how to get one', /Your crew/.test(h2.text()) && /Nobody yet\. RSVP to an event, check in/.test(h2.text()) && !/Also open to dating/.test(h2.text()), h2.text().slice(0, 300));
  await h2.show(B.EventsScreen);
  check('a Club member can RSVP during early access', !!h2.button('RSVP to Club Night') && h2.app.tier === 'club', h2.app.tier);
  await h2.show(B.ProfileScreen);
  check('and their profile says Club member', h2.text().includes('Club member'), h2.text().slice(0, 200));
  await h2.unmount();
}

(async () => {
  await demo();
  await live();
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
