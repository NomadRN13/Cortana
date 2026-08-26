// Shared plumbing for the browser suites. The important part is `finish()`:
// every one of these used to print FAIL and still exit 0, so a broken page
// looked green from the shell.
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..', '..', '..');

// Chromium is pre-installed in the session image; PW_CHROMIUM overrides it, and
// with neither we fall back to whatever playwright can find itself.
const EXECUTABLE = process.env.PW_CHROMIUM
  || (require('fs').existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const fileUrl = (rel) => 'file://' + path.join(REPO, rel);

// Root-absolute asset paths (`/favicon.png`) resolve to the filesystem root
// over file://, so a page that is fine in production looks broken. Serve the
// repo over http and the pages behave the way a browser really sees them.
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon',
};

async function serve() {
  const http = require('http');
  const fs = require('fs');
  // The site build puts these at the root; mirror that so href="/favicon.png"
  // resolves here exactly as it does on Netlify.
  const ROOT_ALIASES = {
    '/favicon.png': 'mobile/assets/favicon.png',
    '/og.png': 'mobile/assets/og.png',
  };
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const rel = ROOT_ALIASES[clean] || clean.replace(/^\/+/, '');
    const file = path.join(REPO, rel);
    if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { url: (rel) => `${origin}/${rel.replace(/^\/+/, '')}`, close: () => server.close() };
}

async function launch() {
  return chromium.launch({
    executablePath: EXECUTABLE,
    args: ['--no-sandbox', '--disable-gpu'],
  });
}

// One counter per process; `finish` is what makes the shell believe the result.
let failures = 0;
let checks = 0;

async function step(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failures += 1;
    console.log(' FAIL  ' + name + ' :: ' + String(e.message).split('\n')[0]);
  }
}

function fail(why) {
  failures += 1;
  console.log(' FAIL  ' + why);
}

// Page errors are failures too — a screen that renders but throws is broken.
function watch(page, { ignore = [] } = {}) {
  const seen = [];
  const keep = (s) => !ignore.some((re) => re.test(s));
  page.on('pageerror', (e) => { if (keep(e.message)) seen.push('pageerror: ' + e.message); });
  page.on('console', (m) => {
    if (m.type() === 'error' && keep(m.text())) seen.push('console: ' + m.text());
  });
  return seen;
}

async function finish(browser, errors) {
  if (errors && errors.length) {
    errors.forEach((e) => fail('JS error — ' + e));
  }
  if (browser) await browser.close();
  console.log(failures ? `\n${failures} failing of ${checks}` : `\nall green (${checks} checks)`);
  process.exit(failures ? 1 : 0);
}

module.exports = { launch, step, fail, watch, finish, fileUrl, serve, REPO };
