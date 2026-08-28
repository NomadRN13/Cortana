// Walk the demo and check which steps report, that each fires once, and that
// nothing at all is sent when the keys are empty.
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
  await page.click('#ob-seeking [data-seek="man"]');
  await page.click('#ob4-done');
  await page.waitForSelector('#screen-home.active', { timeout: 4000 });
  await page.click('.act-like');
  await page.waitForTimeout(500);
}

(async () => {
  const b = await launch();

  // configured — patch the file the way go-live.sh does, because the page's
  // own config script would overwrite anything injected before load.
  const fs = require('fs');
  const html = fs.readFileSync(require('path').join(REPO, 'app/index.html'), 'utf8')
    .replace(/window\.FORTYLOVE = \{[^}]*\};/,
      `window.FORTYLOVE = { SUPABASE_URL: '${CFG.SUPABASE_URL}', SUPABASE_ANON_KEY: '${CFG.SUPABASE_ANON_KEY}' };`);
  let p = await b.newPage({ viewport: { width: 390, height: 844 } });
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
    .replace(/window\.FORTYLOVE = \{[^}]*\};/,
      "window.FORTYLOVE = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };");
  p = await b.newPage({ viewport: { width: 390, height: 844 } });
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

  await finish(b);
})();
