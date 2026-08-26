const { launch, step, fail, watch, finish, fileUrl, REPO } = require('./lib/harness');

(async () => {
  const browser = await launch();
  const URL = fileUrl('landing/index.html');
  const CFG = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'anon-key-123' };
  const ON_THE_LIST = 'on the list';

  // 1. Demo path (no config)
  await step('demo mode: submit stores locally and shows success', async () => {
    const page = await browser.newPage();
    page.on('request', (r) => { if (r.url().includes('supabase')) throw new Error('demo mode made a network call'); });
    await page.goto(URL);
    await page.fill('#hero-email', 'demo@example.com');
    await page.click('#hero-form button');
    await page.waitForSelector('#hero-success', { state: 'visible', timeout: 2000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('40love.waitlist')));
    if (!stored.includes('demo@example.com')) throw new Error('email not stored locally');
    await page.close();
  });

  // 2. Live path goes through the RPC, never straight at the table. Posting to
  // the table returns 409 for an address already on it, which would let anyone
  // holding the (public) anon key test whether a given person had signed up.
  await step('live mode: calls join_waitlist RPC, never the table', async () => {
    const page = await browser.newPage();
    let captured = null;
    let hitTable = false;
    await page.route('**/rest/v1/waitlist**', (route) => { hitTable = true; route.fulfill({ status: 201, body: '' }); });
    await page.route('**/rest/v1/rpc/join_waitlist', (route) => {
      captured = { headers: route.request().headers(), body: route.request().postDataJSON() };
      route.fulfill({ status: 204, body: '' });
    });
    await page.goto(URL);
    await page.evaluate((cfg) => { window.FORTYLOVE = cfg; }, CFG);
    await page.fill('#hero-email', 'Player@Example.com');
    await page.selectOption('#hero-city', 'seattle');
    await page.click('#hero-form button');
    await page.waitForSelector('#hero-success', { state: 'visible', timeout: 3000 });
    if (hitTable) throw new Error('posted straight to the waitlist table — that leaks membership');
    if (!captured) throw new Error('no RPC request captured');
    if (captured.headers.apikey !== CFG.SUPABASE_ANON_KEY) throw new Error('missing apikey header');
    if (captured.body.p_email !== 'player@example.com') throw new Error('email not lowercased: ' + captured.body.p_email);
    if (captured.body.p_city !== 'seattle' || captured.body.p_source !== 'landing') {
      throw new Error('wrong body: ' + JSON.stringify(captured.body));
    }
    const txt = await page.textContent('#hero-success');
    if (!txt.includes(ON_THE_LIST)) throw new Error('wrong success copy: ' + txt);
    await page.close();
  });

  // 3. The point of the change: a repeat address must be indistinguishable from
  // a new one. The RPC swallows the conflict and the copy says the same thing.
  await step('live mode: repeat address gives nothing away', async () => {
    const page = await browser.newPage();
    await page.route('**/rest/v1/rpc/join_waitlist', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(URL);
    await page.evaluate((cfg) => { window.FORTYLOVE = cfg; }, CFG);
    await page.fill('#join-email', 'repeat@example.com');
    await page.click('#join-form button');
    await page.waitForSelector('#join-success', { state: 'visible', timeout: 3000 });
    const txt = await page.textContent('#join-success');
    if (/already/i.test(txt)) throw new Error('copy still reveals prior membership: ' + txt);
    if (!txt.includes(ON_THE_LIST)) throw new Error('wrong success copy: ' + txt);
    await page.close();
  });

  // 4. Live path: server error → inline error, button restored
  await step('live mode: 500 shows error and re-enables button', async () => {
    const page = await browser.newPage();
    await page.route('**/rest/v1/rpc/join_waitlist', (route) => route.fulfill({ status: 500, body: 'boom' }));
    await page.goto(URL);
    await page.evaluate((cfg) => { window.FORTYLOVE = cfg; }, CFG);
    await page.fill('#hero-email', 'unlucky@example.com');
    await page.click('#hero-form button');
    await page.waitForFunction(() => document.getElementById('hero-error').textContent.length > 0, { timeout: 3000 });
    const disabled = await page.$eval('#hero-form button', (b) => b.disabled);
    const label = await page.$eval('#hero-form button', (b) => b.textContent);
    if (disabled) throw new Error('button still disabled after failure');
    if (!label.includes('Join the waitlist')) throw new Error('button label not restored: ' + label);
    const formVisible = await page.$eval('#hero-form', (f) => f.style.display !== 'none');
    if (!formVisible) throw new Error('form hidden despite failure');
    await page.close();
  });

  // 5. Deployed with no backend: it must not claim to have recorded anything.
  // The local-preview fallback stores the address in the visitor's own browser,
  // which is honest when you're previewing your own page and a lie when a
  // stranger is looking at a real domain.
  await step('deployed + unconfigured: refuses to fake a signup', async () => {
    const page = await browser.newPage();
    // Served over http from a real-looking host, with no window.FORTYLOVE.
    await page.route('https://40love.app/', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: require('fs').readFileSync('/home/user/Cortana/landing/index.html', 'utf8') }));
    await page.goto('https://40love.app/');
    await page.fill('#hero-email', 'stranger@example.com');
    await page.click('#hero-form button');
    await page.waitForFunction(() => document.getElementById('hero-error').textContent.length > 0, { timeout: 3000 });
    const err = await page.textContent('#hero-error');
    if (!/waitlist isn/i.test(err)) throw new Error('wrong copy: ' + err);
    if (!/hello@40love\.app/.test(await page.innerHTML('#hero-error'))) throw new Error('no way to reach us offered');
    const shown = await page.$eval('#hero-success', (e) => getComputedStyle(e).display !== 'none');
    if (shown) throw new Error('claimed success with no backend on a real host');
    const stored = await page.evaluate(() => localStorage.getItem('40love.waitlist'));
    if (stored && stored.includes('stranger@example.com')) throw new Error('quietly stored the address in the visitor browser');
    await page.close();
  });

  await finish(browser);
})();
