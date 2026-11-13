// Ladder leagues. Live, the server owns the ladder: the app lists the leagues
// in the member's cities, reads who is on which rung from get_league_standings
// (the row marked is_me is the member), offers "Challenge" only on rungs the
// server would allow — up to two above — and shows a refusal in the server's
// words. The demo build plays by the same rules (mobile/src/lib/ladder.js),
// checked here directly.
//
//   ./scripts/test-app.sh
global.IS_REACT_ACT_ENVIRONMENT = true;
const path = require('path');
const esbuild = require('esbuild');
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

const out = path.join(__dirname, '.build', 'ladder.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'mobile', 'src', 'lib', 'ladder.js')],
  bundle: true, format: 'cjs', outfile: out, logLevel: 'silent',
});
const { ladderJoin, ladderLeave, ladderChallengeProblem, ladderRecord } = require(out);

let app = null;
function Probe() { app = useApp(); return null; }
const tick = (n = 40) => new Promise((r) => setTimeout(r, n));
const act = TestRenderer.act;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}
const refuse = (message, code = '22023') => Object.assign(new Error(message), { code });
const named = (n) => calls.filter((c) => c.name === n);

// ---------- the ladder rules the demo uses ----------
{
  const five = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, name: id.toUpperCase(), rung: i + 1, wins: 0, losses: 0 }));
  const rungs = (list) => list.map((m) => `${m.rung}${m.id}`).join(' ');

  const joined = ladderJoin(five, 'me', 'Sam');
  check('a new member takes the bottom rung', rungs(joined) === '1a 2b 3c 4d 5e 6me', rungs(joined));
  check('joining twice changes nothing', rungs(ladderJoin(joined, 'me', 'Sam')) === rungs(joined));
  check('joining leaves the original ladder alone', five.length === 5);

  check('one rung above can be challenged', ladderChallengeProblem(joined, 'me', 'e', []) === null);
  check('two rungs above can be challenged', ladderChallengeProblem(joined, 'me', 'd', []) === null);
  check('three rungs above cannot', /two rungs above/.test(ladderChallengeProblem(joined, 'me', 'c', []) || ''));
  check('nobody below can be challenged', /two rungs above/.test(ladderChallengeProblem(joined, 'd', 'me', []) || ''));
  check('you cannot challenge yourself, or someone who isn’t on the ladder', /someone you can challenge/.test(ladderChallengeProblem(joined, 'me', 'me', []) || '') && /someone you can challenge/.test(ladderChallengeProblem(joined, 'me', 'zed', []) || ''));
  check('you have to be on the ladder to challenge', /Join the league/.test(ladderChallengeProblem(five, 'me', 'e', []) || ''));
  check('a pair has one open challenge at a time, whoever made it',
    /already have a challenge/.test(ladderChallengeProblem(joined, 'me', 'e', [{ challengerId: 'me', challengedId: 'e' }]) || '')
    && /already have a challenge/.test(ladderChallengeProblem(joined, 'me', 'e', [{ challengerId: 'e', challengedId: 'me' }]) || ''));

  const won = ladderRecord(joined, 'me', 'd', 'me');
  check('a challenger who wins takes that rung, and everyone between drops one', won.problem === null && rungs(won.list) === '1a 2b 3c 4me 5d 6e', rungs(won.list));
  const rec = (list, id) => { const m = list.find((x) => x.id === id); return `${m.wins}-${m.losses}`; };
  check('the winner gets a win and the loser a loss', rec(won.list, 'me') === '1-0' && rec(won.list, 'd') === '0-1' && rec(won.list, 'e') === '0-0', [rec(won.list, 'me'), rec(won.list, 'd')]);
  const lost = ladderRecord(joined, 'me', 'd', 'd');
  check('if the challenged player wins, nothing moves', lost.problem === null && rungs(lost.list) === rungs(joined) && rec(lost.list, 'd') === '1-0' && rec(lost.list, 'me') === '0-1', rungs(lost.list));
  check('the winner has to be one of the two players', /one of the two/.test(ladderRecord(joined, 'me', 'd', 'a').problem || '') );
  check('a result with a player who has left is refused', /left the league/.test(ladderRecord(five, 'me', 'd', 'me').problem || ''));
  check('rungs stay 1..n with no gaps or repeats after a result', won.list.map((m) => m.rung).join() === '1,2,3,4,5,6');

  const left = ladderLeave(won.list, 'b');
  check('leaving closes the gap: everyone below moves up one', rungs(left) === '1a 2c 3me 4d 5e', rungs(left));
  check('leaving a ladder you aren’t on changes nothing', rungs(ladderLeave(five, 'me')) === rungs(five));
}

// ---------- live ----------
const PROFILE = {
  id: 'me-uuid', first_name: 'Sam', birthdate: '1994-01-01', city: 'indianapolis', extra_cities: ['seattle'],
  modes: ['play'], radius_mi: 25, age_min: 25, age_max: 40, same_sports_only: false,
  bio: '', user_sports: [{ sport: 'pickleball', level: 'intermediate', rating_label: '' }],
};

async function main() {
  const soon = new Date(Date.now() + 5 * 86400000).toISOString();
  resetStorage();
  impl.getMyProfile = () => PROFILE;
  impl.fetchLeagues = () => [
    { id: 'lg-indy', city: 'indianapolis', title: 'Indy Ladder', sport: 'pickleball', level_range: 'DUPR 3.0+', starts_at: soon, weeks: 8, venue: 'Indy Pickleball Club' },
    { id: 'lg-sea', city: 'seattle', title: 'Green Lake Ladder', sport: 'tennis', level_range: 'All levels', starts_at: soon, weeks: 6, venue: 'Green Lake' },
    { id: 'lg-mia', city: 'miami', title: 'Miami Ladder', sport: 'padel', level_range: 'All levels', starts_at: soon, weeks: 6, venue: 'Flamingo Park' },
  ];
  const row = (rung, id, name, isMe = false) => ({ rung, user_id: id, first_name: name, wins: 6 - rung, losses: rung - 1, is_me: isMe });
  // Rung 2 is someone hidden from me: the server keeps their rung, not their identity.
  let indy = [row(1, 'u-a', 'Ana'), row(2, null, 'Player'), row(3, 'u-c', 'Cal'), row(4, 'u-d', 'Dee'), row(5, 'u-e', 'Eli')];
  const asked = [];
  impl.fetchLeagueStandings = (id) => { asked.push(id); return id === 'lg-indy' ? indy : [row(1, 'u-z', 'Zoe')]; };
  let serverOpen = [];
  impl.fetchMyLeagueChallenges = () => serverOpen;

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AppStateProvider, null, React.createElement(Probe)));
  });
  await act(async () => { await tick(100); });

  const L = (id = 'lg-indy') => app.leagues.find((l) => l.id === id) || {};
  const at = (rung, id = 'lg-indy') => (L(id).standings || []).find((r) => r.rung === rung);
  check('leagues in the member’s cities are listed, and no others', app.leagues.map((l) => l.id).sort().join() === 'lg-indy,lg-sea', app.leagues.map((l) => l.id));
  check('standings are asked for only for those leagues', !asked.includes('lg-mia') && asked.includes('lg-indy') && asked.includes('lg-sea'), asked);
  check('a league carries its details', L().title === 'Indy Ladder' && L().sport === 'Pickleball' && L().level === 'DUPR 3.0+' && L().weeks === 8 && L().venue === 'Indy Pickleball Club', L());
  check('the ladder comes top rung first, with records', L().standings.map((r) => r.rung).join() === '1,2,3,4,5' && at(1).name === 'Ana' && at(1).wins === 5 && at(1).losses === 0, L().standings);
  check('a member who isn’t on the ladder is not shown as on it', L().joined === false && L().myRung === null, [L().joined, L().myRung]);
  check('and has nobody to challenge', L().standings.every((r) => !app.canChallenge(L(), r)), L().standings.map((r) => app.canChallenge(L(), r)));

  // ---- joining: the server puts you on the bottom rung ----
  impl.joinLeague = () => { indy = indy.concat([row(6, 'me-uuid', 'Sam', true)]); return 6; };
  alerts.length = 0;
  await act(async () => { app.joinLeague('lg-indy'); await tick(80); });
  check('joining goes through join_league', named('joinLeague').length === 1 && named('joinLeague')[0].args.join() === 'lg-indy', named('joinLeague').map((c) => c.args));
  check('the rung is the one the server marked is_me', L().joined === true && L().myRung === 6 && at(6).isMe === true && alerts.length === 0, [L().joined, L().myRung]);

  // ---- who can be challenged: up to two rungs above, and only people the app can name ----
  const can = (rung) => app.canChallenge(L(), at(rung));
  check('one and two rungs above can be challenged', can(5) === true && can(4) === true, [can(5), can(4)]);
  check('three rungs above cannot', can(3) === false, can(3));
  check('you cannot challenge yourself', can(6) === false, can(6));
  // me at 4 → rung 2 is within reach, but it is the hidden player
  indy = [row(1, 'u-a', 'Ana'), row(2, null, 'Player'), row(3, 'u-c', 'Cal'), row(4, 'me-uuid', 'Sam', true), row(5, 'u-d', 'Dee'), row(6, 'u-e', 'Eli')];
  await act(async () => { app.reloadCourts(); await tick(80); });
  check('someone hidden from the member keeps their rung but has no name or id', at(2).id === null && at(2).name === 'Player', at(2));
  check('and cannot be challenged, though they are within reach', can(2) === false && can(3) === true, [can(2), can(3)]);
  check('nobody below can be challenged', can(5) === false && can(6) === false && can(1) === false, [can(5), can(6), can(1)]);

  // ---- challenging ----
  impl.challengeInLeague = () => { serverOpen = [{ id: 'ch-1', league_id: 'lg-indy', challenger_id: 'me-uuid', challenged_id: 'u-c' }]; return 'ch-1'; };
  alerts.length = 0;
  await act(async () => { app.challengeInLeague('lg-indy', 'u-c'); await tick(80); });
  check('a challenge goes through league_challenge with the league and the target', named('challengeInLeague').length === 1 && named('challengeInLeague')[0].args.join() === 'lg-indy,u-c', named('challengeInLeague').map((c) => c.args));
  const open = () => app.leagueChallengeWith(L(), at(3));
  check('the open challenge is shown against that player', !!open() && open().id === 'ch-1' && alerts.length === 0, open());
  check('and they can’t be challenged again while it is open', can(3) === false, can(3));

  impl.challengeInLeague = () => { throw refuse('You can challenge up to two rungs above you.'); };
  alerts.length = 0;
  await act(async () => { app.challengeInLeague('lg-indy', 'u-a'); await tick(80); });
  check('a refused challenge says why, in the server’s words', alerts.length === 1 && alerts[0].message === 'You can challenge up to two rungs above you.', alerts);

  // ---- recording the result: the server moves the rungs ----
  const sent = [];
  impl.reportLeagueResult = (challengeId, winnerId) => {
    sent.push([challengeId, winnerId]);
    serverOpen = [];
    indy = [row(1, 'u-a', 'Ana'), row(2, null, 'Player'), row(3, 'me-uuid', 'Sam', true), row(4, 'u-c', 'Cal'), row(5, 'u-d', 'Dee'), row(6, 'u-e', 'Eli')];
    return null;
  };
  alerts.length = 0;
  await act(async () => { app.reportLeagueResult('lg-indy', 'ch-1', 'me-uuid'); await tick(80); });
  check('a result is recorded against the challenge, with the winner', sent.length === 1 && sent[0].join() === 'ch-1,me-uuid', sent);
  check('the new rungs are the server’s', L().myRung === 3 && at(4).name === 'Cal' && alerts.length === 0, [L().myRung, at(4)]);
  check('and the challenge is no longer open', L().challenges.length === 0, L().challenges);

  impl.reportLeagueResult = () => { throw refuse('This result is already in.'); };
  alerts.length = 0;
  await act(async () => { app.reportLeagueResult('lg-indy', 'ch-1', 'me-uuid'); await tick(80); });
  check('a refused result says why and moves nothing', alerts.length === 1 && /already in/.test(alerts[0].message || '') && L().myRung === 3, alerts);

  // ---- a challenge made against me can be recorded too ----
  serverOpen = [{ id: 'ch-2', league_id: 'lg-indy', challenger_id: 'u-d', challenged_id: 'me-uuid' }];
  await act(async () => { app.reloadCourts(); await tick(80); });
  const fromDee = app.leagueChallengeWith(L(), at(5));
  check('a challenge someone else made against me is listed', !!fromDee && fromDee.id === 'ch-2' && fromDee.challengerId === 'u-d', fromDee);

  // ---- if open challenges can't be read, one made on this phone still stands ----
  serverOpen = [];
  await act(async () => { app.reloadCourts(); await tick(80); });
  impl.fetchMyLeagueChallenges = () => { throw new Error('network'); };
  impl.challengeInLeague = () => 'ch-3';
  await act(async () => { app.challengeInLeague('lg-indy', 'u-a'); await tick(80); });
  const kept = app.leagueChallengeWith(L(), at(1));
  check('the ladder still loads when open challenges can’t be read', L().standings.length === 6, L().standings && L().standings.length);
  check('and a challenge just made is kept by the id the server returned', !!kept && kept.id === 'ch-3', kept);

  // ---- leaving ----
  impl.leaveLeague = () => { indy = indy.filter((r) => !r.is_me).map((r, i) => ({ ...r, rung: i + 1 })); return null; };
  await act(async () => { app.leaveLeague('lg-indy'); await tick(80); });
  check('leaving goes through leave_league', named('leaveLeague').length === 1 && named('leaveLeague')[0].args.join() === 'lg-indy', named('leaveLeague').map((c) => c.args));
  check('and the ladder closes up without the member', L().joined === false && L().standings.map((r) => r.rung).join() === '1,2,3,4,5', [L().joined, L().standings.map((r) => r.rung)]);

  impl.joinLeague = () => { throw refuse('Your account is suspended.', '42501'); };
  alerts.length = 0;
  await act(async () => { app.joinLeague('lg-indy'); await tick(80); });
  check('a refused join says why and leaves the member off the ladder', alerts.length === 1 && /suspended/.test(alerts[0].message || '') && L().joined === false, alerts);

  // ---- failures ----
  impl.fetchLeagueStandings = (id) => { if (id === 'lg-sea') throw new Error('network'); return indy; };
  await act(async () => { app.reloadCourts(); await tick(80); });
  check('one ladder failing to load doesn’t take the others with it', L().standings.length === 5 && L('lg-sea').title === 'Green Lake Ladder' && L('lg-sea').standings.length === 0, [L().standings.length, L('lg-sea').standings]);
  impl.fetchLeagues = () => { throw new Error('network'); };
  await act(async () => { app.reloadCourts(); await tick(80); });
  check('a failed refresh keeps the last list', app.leagues.length === 2, app.leagues.length);

  await act(async () => { renderer.unmount(); });
  console.log(failures ? `\n${failures} failing` : '\nall green');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
