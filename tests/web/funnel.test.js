// Walk the demo and check which steps report, that each fires once, and that
// nothing at all is sent when the keys are empty.
//
// The walk is the path a new member takes now: signup as it comes (Play is
// pre-selected, Date is off, so there is no dating question to answer), into
// the deck, a like, a match, and through to the conversation — the last step
// the funnel counts, and one it never used to record.
const { launch, step, fail, watch, finish, fileUrl, REPO } = require('./lib/harness');
const URL = fileUrl('app/index.html');
const CFG = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'anon-key-123' };

async function walk(page) {
  await page.click('#btn-create');
  await page.fill('#ob-name','Sam'); await page.fill('#ob-age','32');
  await page.click('#ob-gender [data-gender="woman"]');
  await page.click('#ob1-next');
  await page.fill('#ob-phone','3175550142'); await page.click('#phone-send');
  await page.fill('#ob-phone-code','123456'); await page.click('#phone-verify');
  await page.click('#obphone-next');
  await page.click('[data-sport="Pickleball"]'); await page.click('#ob2-next');
  await page.click('[data-skill="Intermediate"]'); await page.click('#ob3-next');
  await page.click('#ob4-done');
  await page.waitForSelector('#screen-home.active', { timeout: 4000 });
  await page.click('#open-deck');   // Home opens on events; the deck is one tap away
  await page.click('.act-like');
  await page.waitForTimeout(500);
  await page.click('#act-ace');     // an ace always matches
  await page.waitForSelector('#match-overlay.open', { timeout: 4000 });
  await page.click('#match-message');
  await page.waitForSelector('#screen-convo.active', { timeout: 4000 });
  await page.waitForTimeout(300);
}

// Every step the walk above passes through, in the order it is reached.
const WALKED = ['landed', 'start_signup', 'phone_verified', 'sports_picked', 'skill_picked',
  'finished_signup', 'swiped', 'matched', 'opened_chat'];

(async () => {
  const b = await launch();

  // configured — patch the file the way go-live.sh does, because the page's
  // own config script would overwrite anything injected before load.
  const fs = require('fs');
  const html = fs.readFileSync(require('path').join(REPO, 'app/index.html'), 'utf8')
    .replace(/window\.RSVPLAY = \{[^}]*\};/,
      `window.RSVPLAY = { SUPABASE_URL: '${CFG.SUPABASE_URL}', SUPABASE_ANON_KEY: '${CFG.SUPABASE_ANON_KEY}' };`);
  let p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('configured: ' + e.message));
  const seen = [];
  await p.route('**/rest/v1/rpc/record_demo_step', (r) => {
    seen.push(r.request().postDataJSON()); r.fulfill({ status: 204, body: '' });
  });
  await p.route('https://demo.local/', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await p.goto('https://demo.local/'); await p.waitForTimeout(500);
  await walk(p);
  const steps = seen.map((x) => x.p_step);
  const visits = new Set(seen.map((x) => x.p_visit));

  await step('the demo reports the funnel steps it walked', async () => {
    if (steps.length < 3) throw new Error('only reported: ' + steps.join(', '));
    if (steps.join(' → ') !== WALKED.join(' → ')) throw new Error('reported: ' + steps.join(' → '));
  });
  await step('opening the conversation is recorded as opened_chat', async () => {
    if (steps.indexOf('opened_chat') === -1) throw new Error('never sent; reported: ' + steps.join(', '));
    if (steps.indexOf('opened_chat') < steps.indexOf('matched')) throw new Error('out of order: ' + steps.join(' → '));
  });
  await step('everything the funnel watches or listens for is really on the page', async () => {
    // opened_chat was lost to a screen id that did not exist. The funnel is
    // deliberately blind to the prototype's internals, so nothing complains
    // when an id it names goes away — except this.
    const src = html.slice(html.indexOf('Anonymous funnel'));
    const watched = [...src.matchAll(/watch\('([^']+)'/g)].map((m) => m[1]);
    const byId = [...(src.match(/var BY_ID = \{([^}]*)\}/) || ['', ''])[1].matchAll(/'([^']+)':/g)].map((m) => m[1]);
    if (watched.length < 3 || byId.length < 4) throw new Error('could not read the funnel’s ids: ' + JSON.stringify({ watched, byId }));
    const missing = await p.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), watched.concat(byId));
    if (missing.length) throw new Error('not on the page: ' + missing.join(', '));
    const screens = await p.evaluate((ids) => ids.filter((id) => /^screen-/.test(id) && !document.getElementById(id).classList.contains('screen')), watched);
    if (screens.length) throw new Error('not a screen: ' + screens.join(', '));
  });
  await step('all of them belong to one anonymous visit', async () => {
    if (visits.size !== 1) throw new Error(visits.size + ' visit ids');
  });
  await step('no step is counted twice', async () => {
    if (steps.length !== new Set(steps).size) throw new Error(steps.join(' → '));
  });
  await step('nothing personal is in the payload', async () => {
    const leaked = seen.filter((x) => /Sam|3175550142|@/.test(JSON.stringify(x)));
    if (leaked.length) throw new Error(JSON.stringify(leaked[0]));
  });
  await p.close();

  // Unconfigured — must be completely silent. The page reads its config once at
  // load, so this has to be served with the keys blanked rather than cleared
  // afterwards; serving it also means the check still means something after
  // go-live.sh has written real keys into the file.
  const blank = fs.readFileSync(require('path').join(REPO, 'app/index.html'), 'utf8')
    .replace(/window\.RSVPLAY = \{[^}]*\};/,
      "window.RSVPLAY = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };");
  p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', (e) => errs.push('unconfigured: ' + e.message));
  let calls = 0;
  p.on('request', (r) => { if (/supabase|record_demo_step/.test(r.url())) calls += 1; });
  await p.route('https://demo.local/', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: blank }));
  await p.goto('https://demo.local/');
  await p.waitForTimeout(400);
  await walk(p);
  await step('an unconfigured demo sends nothing at all', async () => {
    if (calls !== 0) throw new Error(calls + ' requests leaked');
  });
  await p.close();

  await finish(b, errs);
})();
