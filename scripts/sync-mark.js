// Write the 40/LOVE mark into every page that shows it.
//
//   node scripts/sync-mark.js
//
// The ball is defined once, in scripts/lib/ball.js. It used to be pasted into
// four files by hand, which is how the shading drifted apart last time. Each
// target carries marker comments; this replaces what's between them:
//
//   <!--mark:defs--> … <!--/mark:defs-->   the gradients + the <symbol>, once
//   <!--mark:ball--> … <!--/mark:ball-->   one instance, as a <use>
//   /*mark:ball*/ … /*\/mark:ball*/        same, for a JS string literal
//
// After running, re-run scripts/build-site.sh to refresh site/.

const fs = require('fs');
const path = require('path');
const { DEFS, ball } = require('./lib/ball');

const root = path.join(__dirname, '..');

// One <symbol> holds the whole ball so a page with several wordmarks pays for
// the geometry once and each instance is a one-line <use>.
const DEFS_BLOCK =
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>\n' +
  DEFS.trim() +
  '\n<symbol id="pb-mark" viewBox="0 0 24 24">' + ball() + '</symbol>\n' +
  '</defs></svg>';

const USE = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#pb-mark"/></svg>';

function replaceBetween(src, open, close, body, file, required) {
  const i = src.indexOf(open);
  const j = src.indexOf(close);
  if (i < 0 || j < 0) {
    if (required) throw new Error(`${file}: missing ${open} / ${close} markers`);
    return src;
  }
  return src.slice(0, i + open.length) + body + src.slice(j);
}

// A page can carry any number of ball instances; they're all identical.
function fillAllBalls(src) {
  return src.replace(
    /<!--mark:ball-->[\s\S]*?<!--\/mark:ball-->/g,
    '<!--mark:ball-->' + USE + '<!--/mark:ball-->'
  );
}

const files = [
  'landing/index.html',
  'app/index.html',
  'admin/index.html',
  'landing/privacy.html',
  'landing/terms.html',
  'landing/delete-account.html',
];

let changed = 0;
for (const rel of files) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { console.log('-- skipped (absent):', rel); continue; }
  const before = fs.readFileSync(file, 'utf8');
  let after = replaceBetween(before, '<!--mark:defs-->', '<!--/mark:defs-->',
                             '\n' + DEFS_BLOCK + '\n', rel, true);
  after = fillAllBalls(after);
  // The prototype keeps its ball in a JS string rather than in the markup.
  if (after.includes('/*mark:ball*/')) {
    if (USE.includes("'")) throw new Error('mark markup needs escaping for the JS literal');
    after = replaceBetween(after, '/*mark:ball*/', '/*\/mark:ball*/',
                           `\n  var BALL_SVG = '${USE}';\n  `, rel, true);
  }
  fs.writeFileSync(file, after);
  if (before !== after) changed++;
  console.log(before === after ? '   unchanged' : '== updated  ', rel);
}
console.log(`\n${changed} file(s) updated. Run scripts/build-site.sh to refresh site/.`);
