// How distance reads in the app (mobile/src/lib/distance.js). The deck sends
// whole miles between ~2.5-mile grid squares, where 1 means the same square —
// so 1 reads as "nearby", never as a precise mile, and nothing is shown for null.
//
//   ./scripts/test-app.sh
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(__dirname, '.build', 'distance.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'mobile', 'src', 'lib', 'distance.js')],
  bundle: true, format: 'cjs', outfile: out, logLevel: 'silent',
});
const { distanceLabel, distanceShort, distanceReason } = require(out);

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond || extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`);
  if (!cond) failures += 1;
}

const inputs = [null, 1, '1', 2, 3, 4, 12];
const table = (f) => inputs.map((v) => f(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const long = table(distanceLabel);
check('long form: nothing, Nearby, About N miles away',
  same(long, [null, 'Nearby', 'Nearby', 'About 2 miles away', 'About 3 miles away', 'About 4 miles away', 'About 12 miles away']), long);

const short = table(distanceShort);
check('short form: nothing, nearby, ~N mi',
  same(short, [null, 'nearby', 'nearby', '~2 mi', '~3 mi', '~4 mi', '~12 mi']), short);

const reason = table(distanceReason);
check('reason: Plays nearby up close, About N miles away to 3, nothing beyond',
  same(reason, [null, 'Plays nearby', 'Plays nearby', 'About 2 miles away', 'About 3 miles away', null, null]), reason);

check('undefined shows no distance', distanceLabel(undefined) === null && distanceShort(undefined) === null && distanceReason(undefined) === null);
check('a numeric string past 1 is read as a number', distanceLabel('12') === 'About 12 miles away' && distanceShort('4') === '~4 mi');
check('no tenths ever show', !/\./.test([distanceLabel(2.4), distanceShort(7.6), distanceReason(2.5)].join(' ')),
  [distanceLabel(2.4), distanceShort(7.6), distanceReason(2.5)]);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
