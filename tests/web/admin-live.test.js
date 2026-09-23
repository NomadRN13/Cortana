// The moderation desk signed in against a real project. Everything before this
// only ever tested demo mode, so the path the founder actually uses — and the
// one that decides whether any tester's photo becomes visible — was untested.
//
// The three ways in used to look identical: not an admin, signed out, and
// couldn't reach the database all showed "this account isn't an admin".
//
//   ./scripts/test-web.sh admin-live
const { launch, step, finish, REPO } = require('./lib/harness');
const fs = require('fs');
const path = require('path');

const HOST = 'https://desk.local/';
const CFG = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'anon-key-123' };

// Served with real-looking keys so the page takes its live path.
const PAGE = fs.readFileSync(path.join(REPO, 'admin/index.html'), 'utf8').replace(
  /window\.FORTYLOVE\s*=\s*\{[^}]*\};/,
  `window.FORTYLOVE = { SUPABASE_URL: '${CFG.SUPABASE_URL}', SUPABASE_ANON_KEY: '${CFG.SUPABASE_ANON_KEY}' };`
);

const TOKEN_KEY = '40love.admin.session';

// Sign in the way the page does, then hand it whatever is_admin should answer.
async function open(browser, { isAdmin, signedIn = true }) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.route(HOST, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await page.route('**/rest/v1/rpc/is_admin', (r) => (typeof isAdmin === 'number'
    ? r.fulfill({ status: isAdmin, contentType: 'application/json', body: '{"message":"boom"}' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: String(isAdmin) })));
  for (const table of ['profile_photos', 'reports', 'events']) {
    await page.route(`**/rest/v1/${table}**`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  }
  await page.route('**/auth/v1/user', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"abc-123-uuid"}' }));
  if (signedIn) {
    await page.addInitScript(([key, s]) => { sessionStorage.setItem(key, s); },
      [TOKEN_KEY, JSON.stringify({ access_token: 'jwt', expires_at: 9e9, email: 'founder@example.com' })]);
  }
  await page.goto(HOST);
  await page.waitForTimeout(350);
  return page;
}

const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && !el.hidden;
}, sel);

(async () => {
  const browser = await launch();

  await step('an admin lands on the desk', async () => {
    const page = await open(browser, { isAdmin: true });
    if (!(await visible(page, '#view-desk'))) throw new Error('desk not shown');
    if (await visible(page, '#view-signin')) throw new Error('sign-in still up');
    await page.close();
  });

  await step('a signed-in non-admin is told they are not an admin, with the SQL to fix it', async () => {
    const page = await open(browser, { isAdmin: false });
    if (!(await visible(page, '#view-noadmin'))) throw new Error('noadmin not shown');
    if ((await page.textContent('#my-uid')).trim() === '—') throw new Error('user id never filled in');
    await page.close();
  });

  await step('a server error is NOT reported as "not an admin"', async () => {
    const page = await open(browser, { isAdmin: 500 });
    if (await visible(page, '#view-noadmin')) throw new Error('blamed the account for a 500');
    if (!(await visible(page, '#view-trouble'))) throw new Error('no trouble view');
    const why = await page.textContent('#trouble-why');
    if (!/500/.test(why)) throw new Error('does not say what went wrong: ' + why);
    await page.close();
  });

  await step('a database that was never applied says so rather than blaming the account', async () => {
    const page = await open(browser, { isAdmin: 404 });
    if (await visible(page, '#view-noadmin')) throw new Error('blamed the account for a 404');
    if (!(await visible(page, '#view-trouble'))) throw new Error('no trouble view');
    await page.close();
  });

  await step('an expired session goes back to sign-in, not to "not an admin"', async () => {
    const page = await open(browser, { isAdmin: 401 });
    if (await visible(page, '#view-noadmin')) throw new Error('a dead end: noadmin with no way to sign in');
    if (!(await visible(page, '#view-signin'))) throw new Error('sign-in not shown');
    await page.close();
  });

  await step('Try again recovers once the database answers', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await page.route(HOST, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
    let down = true;
    await page.route('**/rest/v1/rpc/is_admin', (r) => (down
      ? r.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: 'true' })));
    for (const table of ['profile_photos', 'reports', 'events']) {
      await page.route(`**/rest/v1/${table}**`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    }
    await page.addInitScript(([key, s]) => { sessionStorage.setItem(key, s); },
      [TOKEN_KEY, JSON.stringify({ access_token: 'jwt', expires_at: 9e9, email: 'founder@example.com' })]);
    await page.goto(HOST);
    await page.waitForTimeout(300);
    if (!(await visible(page, '#view-trouble'))) throw new Error('did not report the outage');
    down = false;
    await page.click('#trouble-retry');
    await page.waitForTimeout(300);
    if (!(await visible(page, '#view-desk'))) throw new Error('retry did not get in');
    await page.close();
  });

  await step('signed out entirely, the desk asks for an email', async () => {
    const page = await open(browser, { isAdmin: true, signedIn: false });
    if (!(await visible(page, '#view-signin'))) throw new Error('sign-in not shown');
    if (await visible(page, '#view-desk')) throw new Error('desk shown without a session');
    await page.close();
  });

  // Suspension is the only thing the desk does that changes someone's account.
  await step('Suspend asks first, calls suspend_member, and closes the report', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await page.route(HOST, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
    await page.route('**/rest/v1/rpc/is_admin', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'true' }));
    await page.route('**/rest/v1/profile_photos**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/rest/v1/events**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    let served = false;
    await page.route('**/rest/v1/reports**', (r) => {
      if (r.request().method() === 'PATCH') { patched = r.request().postDataJSON(); return r.fulfill({ status: 204, body: '' }); }
      const rows = served ? [] : [{
        id: 'rep-1', reason: 'kept messaging after I said no', context: 'chat',
        created_at: new Date().toISOString(), target_id: 'target-uuid-9',
        reporter: { first_name: 'Elena' }, target: { first_name: 'Jordan' },
      }];
      served = true;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });
    let suspended = null;
    let patched = null;
    await page.route('**/rest/v1/rpc/suspend_member', (r) => {
      suspended = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
    });
    await page.addInitScript(([key, s2]) => { sessionStorage.setItem(key, s2); },
      [TOKEN_KEY, JSON.stringify({ access_token: 'jwt', expires_at: 9e9, email: 'founder@example.com' })]);

    // Refuse the confirm the first time: nothing may happen.
    page.once('dialog', (d) => d.dismiss());
    await page.goto(HOST);
    await page.waitForTimeout(300);
    await page.click('#tab-reports');
    await page.click('#report-list button[data-act="suspend"]');
    await page.waitForTimeout(200);
    if (suspended) throw new Error('suspended without being confirmed');

    // Accept it, and answer the note prompt.
    page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('kept messaging') : d.accept()));
    await page.click('#report-list button[data-act="suspend"]');
    await page.waitForTimeout(400);
    if (!suspended) throw new Error('confirmed but suspend_member was never called');
    if (suspended.p_user !== 'target-uuid-9') throw new Error('suspended the wrong member: ' + JSON.stringify(suspended));
    if (suspended.p_reason !== 'kept messaging') throw new Error('note not passed: ' + JSON.stringify(suspended));
    if (!patched || patched.status !== 'actioned') throw new Error('report not closed: ' + JSON.stringify(patched));
    await page.close();
  });

  await finish(browser);
})();
