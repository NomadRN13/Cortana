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
