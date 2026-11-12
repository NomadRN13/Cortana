const { launch, step, fail, watch, finish, serve, REPO } = require('./lib/harness');

(async () => {
  const site = await serve();
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  await page.goto(site.url('admin/index.html'));

  await step('demo mode: banner + desk visible, sign-in hidden', async () => {
    await page.waitForSelector('#demo-banner:not([hidden])', { timeout: 3000 });
    await page.waitForSelector('#view-desk:not([hidden])', { timeout: 3000 });
    if (await page.isVisible('#view-signin')) throw new Error('sign-in shown in demo mode');
  });

  await step('photos queue renders 3 pending with count badge', async () => {
    const n = await page.locator('#photo-list .item').count();
    if (n !== 3) throw new Error('expected 3 pending photos, got ' + n);
    if ((await page.textContent('#n-photos')).trim() !== '3') throw new Error('badge wrong');
  });

  await step('approve removes a photo from the queue', async () => {
    await page.click('#photo-list .item >> nth=0 >> button[data-act="approve"]');
    const n = await page.locator('#photo-list .item').count();
    if (n !== 2) throw new Error('expected 2 after approve, got ' + n);
  });

  await step('reject removes another', async () => {
    await page.click('#photo-list .item >> nth=0 >> button[data-act="reject"]');
    if ((await page.locator('#photo-list .item').count()) !== 1) throw new Error('reject did not remove');
  });

  await step('reports tab: 2 open, dismiss clears one', async () => {
    await page.click('#tab-reports');
    await page.waitForSelector('#pane-reports:not([hidden])', { timeout: 3000 });
    if ((await page.locator('#report-list .item').count()) !== 2) throw new Error('expected 2 reports');
    await page.click('#report-list .item >> nth=0 >> button[data-act="reviewed"]');
    if ((await page.locator('#report-list .item').count()) !== 1) throw new Error('dismiss did not remove');
  });

  await step('events tab: create validates and adds to list', async () => {
    await page.click('#tab-events');
    await page.waitForSelector('#pane-events:not([hidden])', { timeout: 3000 });
    await page.click('#ev-create');
    const msg = await page.textContent('#ev-msg');
    if (!msg.includes('required')) throw new Error('missing-fields validation absent: ' + msg);
    await page.fill('#ev-title', 'Test Rally Night');
    await page.fill('#ev-venue', 'Riverside Park');
    const d = new Date(Date.now() + 3 * 86400000);
    await page.fill('#ev-date', d.toISOString().slice(0, 10));
    await page.click('#ev-create');
    if ((await page.locator('#event-list .item').count()) !== 2) throw new Error('event not added');
    if (!(await page.textContent('#event-list')).includes('Test Rally Night')) throw new Error('new event missing');
  });

  await step('places tab: lists venues, validates, adds one, refuses a duplicate', async () => {
    await page.click('#tab-places');
    await page.waitForSelector('#pane-places:not([hidden])', { timeout: 3000 });
    const before = await page.locator('#place-list .item').count();
    if (before < 1) throw new Error('no demo places listed');
    const cities = await page.$$eval('#pl-city option', (o) => o.map((x) => x.value));
    if (cities.indexOf('bakersfield') === -1) throw new Error('Bakersfield missing from the city list');
    await page.click('#pl-create');
    if (!(await page.textContent('#pl-msg')).includes('required')) throw new Error('missing-name validation absent');
    await page.fill('#pl-name', 'Test Park Courts');
    await page.click('#pl-create');
    if (!/Choose the city/.test(await page.textContent('#pl-msg'))) throw new Error('a place could be filed without choosing a city');
    await page.selectOption('#pl-city', 'bakersfield');
    await page.fill('#pl-courts', '500');
    await page.click('#pl-create');
    if (!/from 1 to 99/.test(await page.textContent('#pl-msg'))) throw new Error('court-count validation absent');
    await page.fill('#pl-courts', '');
    await page.click('#pl-create');
    if ((await page.locator('#place-list .item').count()) !== before + 1) throw new Error('place not added');
    const row = await page.textContent('#place-list');
    if (!row.includes('Test Park Courts')) throw new Error('new place missing');
    const added = row.split('Test Park Courts')[1].split('Remove')[0];
    if (/\d+ courts?\b|null|NaN|undefined/.test(added)) throw new Error('a blank court count was shown as something: ' + added);
    await page.fill('#pl-name', 'test park courts');
    await page.selectOption('#pl-city', 'bakersfield');
    await page.click('#pl-create');
    if (!/already listed/.test(await page.textContent('#pl-msg'))) throw new Error('duplicate was accepted');
  });

  await step('place remove works (confirm auto-accepted)', async () => {
    const before = await page.locator('#place-list .item').count();
    await page.click('#place-list .item >> nth=0 >> button[data-act="delete"]');
    if ((await page.locator('#place-list .item').count()) !== before - 1) throw new Error('remove did not remove');
    await page.click('#tab-events');
    await page.waitForSelector('#pane-events:not([hidden])', { timeout: 3000 });
  });

  await step('event delete works (confirm auto-accepted)', async () => {
    await page.click('#event-list .item >> nth=0 >> button[data-act="delete"]');
    if ((await page.locator('#event-list .item').count()) !== 1) throw new Error('delete did not remove');
  });

  await step('empty photo queue shows friendly empty state', async () => {
    await page.click('#tab-photos');
    await page.click('#photo-list .item >> nth=0 >> button[data-act="approve"]');
    if (!(await page.textContent('#photo-list')).includes('queue is clear')) throw new Error('no empty state');
  });

  site.close();
  await finish(browser, errors);
})();
