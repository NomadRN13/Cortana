// Write the 40/LOVE mark into every page that shows it.
//
//   node scripts/sync-mark.js
//
// The ball is defined once, in scripts/lib/ball.js. It used to be pasted into
// four files by hand, which is how the shading drifted apart last time. Each
// target carries marker comments; this replaces what's between them.
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

// Between "<!--mark:defs-->" and "<!--/mark:defs-->", replace everything.
function replaceBlock(src, name, body, file) {
  const open = `<!--mark:${name}-->`;
  const close = `<!--/mark:${name}-->`;
  const i = src.indexOf(open);
  const j = src.indexOf(close);
  if (i < 0 || j < 0) throw new Error(`${file}: missing ${open} / ${close} markers`);
  return src.slice(0, i + open.length) + body + src.slice(j);
}

// The prototype keeps its ball in a JS string, so its markers are comments
// wrapping the whole assignment rather than HTML comments.
function replaceJsBlock(src, name, body, file) {
  const open = `/*mark:${name}*/`;
  const close = `/*\/mark:${name}*/`;
  const i = src.indexOf(open);
  const j = src.indexOf(close);
  if (i < 0 || j < 0) throw new Error(`${file}: missing ${open} / ${close} markers`);
  return src.slice(0, i + open.length) + body + src.slice(j);
}

const jobs = [
  ['landing/index.html', (s, f) => replaceBlock(s, 'defs', '\n' + DEFS_BLOCK + '\n', f)],
  ['app/index.html', (s, f) => {
    s = replaceBlock(s, 'defs', '\n' + DEFS_BLOCK + '\n', f);
    if (USE.includes("'")) throw new Error('mark markup needs escaping for the JS literal');
    return replaceJsBlock(s, 'ball', `\n  var BALL_SVG = '${USE}';\n  `, f);
  }],
  // admin/index.html shows the name as text only — no ball to sync.
];

for (const [rel, fn] of jobs) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { console.log('-- skipped (absent):', rel); continue; }
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before, rel);
  fs.writeFileSync(file, after);
  console.log(before === after ? '   unchanged' : '== updated  ', rel);
}

// Every <use> instance in the landing page markup, for reference when adding
// a new wordmark by hand.
console.log('\ninstance markup:\n  ' + USE);
