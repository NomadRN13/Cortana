// The bracket rules the demo build uses (mobile/src/lib/bracket.js) — the same
// rules the database implements, checked for every field size from 2 to 24.
//
//   ./scripts/test-app.sh
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(__dirname, '.build', 'bracket.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'mobile', 'src', 'lib', 'bracket.js')],
  bundle: true, format: 'cjs', outfile: out, logLevel: 'silent',
});
const { bracketSizeFor, bracketSeedOrder, buildBracket, bracketRecord, bracketRoundName } = require(out);

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

check('seed order for 8 is the standard one', bracketSeedOrder(8).join() === '1,8,4,5,2,7,3,6', bracketSeedOrder(8));
check('24 players play in a bracket of 32', bracketSizeFor(24) === 32 && bracketSizeFor(16) === 16 && bracketSizeFor(17) === 32 && bracketSizeFor(2) === 2);
check('rounds are named from the final back', [1, 2, 3, 4, 5].map((r) => bracketRoundName(r, 5)).join('|') === 'Round of 32|Round of 16|Quarterfinals|Semifinals|Final');

const problems = [];
for (let n = 2; n <= 24; n += 1) {
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
check('every field size from 2 to 24 builds, fills and finishes correctly', problems.length === 0, problems.slice(0, 5));

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

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
