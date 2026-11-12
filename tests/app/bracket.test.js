// The bracket rules the demo build uses (mobile/src/lib/bracket.js) — the same
// rules the database implements, checked for every field size from 2 to 72.
//
//   ./scripts/test-app.sh
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(__dirname, '.build', 'bracket.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'mobile', 'src', 'lib', 'bracket.js')],
  bundle: true, format: 'cjs', outfile: out, logLevel: 'silent',
});
const { bracketSizeFor, bracketSeedOrder, buildBracket, bracketRecord, bracketRoundName, bracketShuffle, bracketSide, bracketLocked, bracketDeskCanRecord, bracketByeLine } = require(out);

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

check('seed order for 8 is the standard one', bracketSeedOrder(8).join() === '1,8,4,5,2,7,3,6', bracketSeedOrder(8));
check('24 players play in a bracket of 32', bracketSizeFor(24) === 32 && bracketSizeFor(16) === 16 && bracketSizeFor(17) === 32 && bracketSizeFor(2) === 2);
check('72 players play in a bracket of 128, 64 in 64, 65 in 128', bracketSizeFor(72) === 128 && bracketSizeFor(64) === 64 && bracketSizeFor(65) === 128 && bracketSizeFor(33) === 64);
check('a bracket of 128 has seven named rounds', [1, 2, 3, 4, 5, 6, 7].map((r) => bracketRoundName(r, 7)).join('|') === 'Round of 128|Round of 64|Round of 32|Round of 16|Quarterfinals|Semifinals|Final');
check('rounds are named from the final back', [1, 2, 3, 4, 5].map((r) => bracketRoundName(r, 5)).join('|') === 'Round of 32|Round of 16|Quarterfinals|Semifinals|Final');

const problems = [];
for (let n = 2; n <= 72; n += 1) {
  const players = Array.from({ length: n }, (_, i) => `p${i + 1}`);   // p1 is seed 1
  const br = buildBracket(players);
  const fail = (why) => problems.push(`${n} players: ${why}`);
  const r1 = br.matches.filter((m) => m.round === 1);

  if (br.matches.length !== br.size - 1) fail(`${br.matches.length} matches for a bracket of ${br.size}`);
  const placed = r1.flatMap((m) => [m.a, m.b]).filter(Boolean);
  if (placed.length !== n || new Set(placed).size !== n) fail('not everyone placed exactly once');
  const byes = r1.filter((m) => m.bye);
  if (byes.length !== br.size - n) fail(`${byes.length} byes, expected ${br.size - n}`);
  if (r1.some((m) => !m.a && !m.b)) fail('a bye met a bye');
  // byes go to the top seeds, and each is already in round 2
  const byeSeeds = byes.map((m) => Number(m.winner.slice(1))).sort((a, b) => a - b);
  if (byeSeeds.some((s, i) => s !== i + 1)) fail(`byes went to seeds ${byeSeeds.join(',')}`);
  if (br.rounds > 1) {
    byes.forEach((m) => {
      const next = br.matches.find((x) => x.round === 2 && x.slot === Math.floor(m.slot / 2));
      if (next.a !== m.winner && next.b !== m.winner) fail('a bye did not advance');
    });
  }
  // play it out, better seed always wins: every match must be filled when due
  for (let r = 1; r <= br.rounds; r += 1) {
    br.matches.filter((m) => m.round === r && !m.winner).forEach((m) => {
      if (!m.a || !m.b) { fail(`round ${r} slot ${m.slot} not filled when due`); return; }
      const better = Number(m.a.slice(1)) < Number(m.b.slice(1)) ? m.a : m.b;
      const err = bracketRecord(br, m.id, better, '11-7');
      if (err) fail(err);
    });
  }
  if (br.champion !== 'p1') fail(`champion is ${br.champion}`);
  // 1 and 2 meet only in the final
  const fin = br.matches.find((m) => m.round === br.rounds);
  if (n >= 2 && [fin.a, fin.b].sort().join() !== ['p1', 'p2'].sort().join()) fail(`final was ${fin.a} v ${fin.b}`);
}
check('every field size from 2 to 72 builds, fills and finishes correctly', problems.length === 0, problems.slice(0, 5));

// the rules around recording
const br = buildBracket(['a', 'b', 'c']);           // bracket of 4: a has the bye, b plays c
const m = br.matches.find((x) => x.round === 1 && !x.bye);
const bye = br.matches.find((x) => x.round === 1 && x.bye);
const fin = br.matches.find((x) => x.round === 2);
check('a bye cannot be given a result', /bye/.test(bracketRecord(br, bye.id, 'a', '')));
check('the final cannot be played before it is filled', /waiting/.test(bracketRecord(br, fin.id, 'a', '')));
check('the winner must be in the match', /one of the two/.test(bracketRecord(br, m.id, 'a', '')));
check('a result records and advances', bracketRecord(br, m.id, 'c', '11-9') === null && [fin.a, fin.b].includes('c'));
check('a recorded result is final for the players', /already in/.test(bracketRecord(br, m.id, 'b', '')));
check('the organiser can correct it', bracketRecord(br, m.id, 'b', 'fixed', true) === null && [fin.a, fin.b].includes('b') && ![fin.a, fin.b].includes('c'));
check('the final crowns the champion', bracketRecord(br, fin.id, 'a', '11-2') === null && br.champion === 'a');
check('but not after the next round is played', /next round/.test(bracketRecord(br, m.id, 'c', '', true)));

// the shuffle is a permutation, and fair: over many draws each player lands in
// each of four places about a quarter of the time
{
  const ids = ['a', 'b', 'c', 'd'];
  const counts = { a: [0, 0, 0, 0], b: [0, 0, 0, 0], c: [0, 0, 0, 0], d: [0, 0, 0, 0] };
  let perm = true;
  for (let k = 0; k < 40000; k += 1) {
    const sh = bracketShuffle(ids);
    if (sh.slice().sort().join() !== 'a,b,c,d') perm = false;
    sh.forEach((id, i) => { counts[id][i] += 1; });
  }
  const worst = Math.max(...Object.values(counts).flat().map((c) => Math.abs(c / 10000 - 1)));
  check('the draw shuffle is a permutation', perm);
  check('the draw shuffle is fair (every place within 5% of a quarter)', worst < 0.05, counts);
  check('the shuffle leaves the original list alone', ids.join() === 'a,b,c,d');
}

// empty places: withdrawn (the desk can settle) vs still to be decided
{
  const br = buildBracket(['p1', 'p2', 'p3', 'p4']);   // 1v4, 2v3, then the final
  const sf1 = br.matches.find((x) => x.round === 1 && x.slot === 0);
  const sf2 = br.matches.find((x) => x.round === 1 && x.slot === 1);
  const fin = br.matches.find((x) => x.round === 2);
  bracketRecord(br, sf1.id, 'p1', '');
  check('an empty final place fed by an unplayed match is pending', bracketSide(br.matches, fin, 'b') === 'pending');
  check('so the desk cannot settle that final yet', bracketDeskCanRecord(br.matches, fin) === false);
  // p1 deletes their account: their places empty, the played match stays played
  sf1.winner = null; sf1.a = null; fin.a = null;
  bracketRecord(br, sf2.id, 'p2', '');
  check('a place emptied by a player who left is withdrawn', bracketSide(br.matches, fin, 'a') === 'withdrawn');
  check('so the desk can give the final to the player who is there', bracketDeskCanRecord(br.matches, fin) === true);
  check('a first-round place with nobody in it (not a bye) is withdrawn', bracketSide(br.matches, sf1, 'a') === 'withdrawn');
  // (the demo rules don't record walkovers — only the database's desk path does)
  {
    const b2 = buildBracket(['q1', 'q2', 'q3', 'q4']);
    const [s1, s2] = [0, 1].map((slot) => b2.matches.find((x) => x.round === 1 && x.slot === slot));
    const f2 = b2.matches.find((x) => x.round === 2);
    bracketRecord(b2, s1.id, 'q1', ''); bracketRecord(b2, s2.id, 'q2', '');
    check('a played match is not locked while the next one is unplayed', !bracketLocked(b2.matches, s2) && bracketDeskCanRecord(b2.matches, s2));
    bracketRecord(b2, f2.id, 'q1', '');
    check('a played match is locked once the next one is played', bracketLocked(b2.matches, s2) && !bracketDeskCanRecord(b2.matches, s2));
    check('the final itself is never locked (nothing comes after it)', !bracketLocked(b2.matches, f2));
  }
  check('a bye is a bye', bracketSide(buildBracket(['x', 'y', 'z']).matches, buildBracket(['x', 'y', 'z']).matches.find((x) => x.bye), 'b') === 'bye');
}

check('the bye line reads right for one and for many',
  bracketByeLine(1, 2) === '1 player has a bye and starts in the Final.' &&
  bracketByeLine(56, 7) === '56 players have a bye and start in the Round of 64.' &&
  bracketByeLine(0, 3) === '', [bracketByeLine(1, 2), bracketByeLine(56, 7)]);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
