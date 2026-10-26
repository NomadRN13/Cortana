const { launch, step, fail, watch, finish, serve, REPO } = require('./lib/harness');
const fs = require('fs');
const zlib = require('zlib');

// 8x8 solid-color PNG built from raw pixels (no external assets)
function makePng(path, rgb = [0xd6, 0xf4, 0x4f]) {
  const w = 8, h = 8;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
}

const OUT = require('path').join(__dirname, '.artifacts');
require('fs').mkdirSync(OUT, { recursive: true });
const out = (n) => require('path').join(OUT, n);

(async () => {
  makePng(out('avatar.png'));
  makePng(out('avatar2.png'), [0x2e, 0x8b, 0xd0]);
  const site = await serve();
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const shot = (n) => page.screenshot({ path: out(`flow-${n}.png`) });
  const cardName = () => page.textContent('#deck-card .card-name');

  await page.goto(site.url('app/index.html'));

  await step('welcome -> create profile', async () => {
    await page.click('#btn-create');
    await page.waitForSelector('#screen-ob1.active', { timeout: 3000 });
  });
  await step('photo upload previews', async () => {
    await page.setInputFiles('#photo-input', out('avatar.png'));
    await page.waitForSelector('#photo-preview.has', { timeout: 3000 });
  });
  await step('onboarding requires gender, then to home (first card Maya)', async () => {
    await page.fill('#ob-name', 'Aaron');
    await page.fill('#ob-age', '34');
    await page.click('#ob1-next');
    // still on step 1: gender not chosen yet
    if (!(await page.isVisible('#screen-ob1.active'))) throw new Error('advanced without gender');
    await page.click('#ob-gender [data-gender="man"]');
    await page.click('#ob1-next');
    // phone verification step: gated until a code is sent + verified
    await page.waitForSelector('#screen-obphone.active', { timeout: 3000 });
    await page.click('#obphone-next');
    if (!(await page.isVisible('#screen-obphone.active'))) throw new Error('advanced without phone verification');
    await page.click('#phone-send');
    if (await page.isVisible('#phone-code-box')) throw new Error('code box shown without a valid number');
    await page.fill('#ob-phone', '317-555-0142');
    await page.click('#phone-send');
    await page.waitForSelector('#phone-code-box:not([hidden])', { timeout: 3000 });
    await page.fill('#ob-phone-code', '123456');
    await page.click('#phone-verify');
    await page.waitForSelector('#phone-verified-row:not([hidden])', { timeout: 3000 });
    await page.click('#obphone-next');
    await page.waitForSelector('#screen-ob2.active', { timeout: 3000 });
    await page.click('[data-sport="Tennis"]');
    await page.click('[data-sport="Pickleball"]');
    await page.click('#ob2-next');
    await page.click('[data-skill="Advanced"]');
    await page.fill('#ob-rating', 'NTRP 4.0');
    await page.click('#ob3-next');
    await page.click('#ob-modes .mode-row[data-mode="play"]');
    // date mode is on → seeking box visible and required
    if (!(await page.isVisible('#seeking-box'))) throw new Error('seeking box not visible with date mode on');
    // pick-one preference chips must actually stick (they live inside the
    // multi-toggling #ob-modes container — regression guard)
    const pressed = (group) => page.$$eval(`#${group} .chip`, (els) =>
      els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.getAttribute('data-pref')));
    await page.click('#ob-playpref [data-pref="women"]');
    let sel = await pressed('ob-playpref');
    if (sel.length !== 1 || sel[0] !== 'women') throw new Error('play "with" pref did not stick: ' + JSON.stringify(sel));
    await page.click('#ob-playpref [data-pref="everyone"]');
    await page.click('#ob-modes .mode-row[data-mode="friends"]');
    await page.click('#ob-friendspref [data-pref="men"]');
    sel = await pressed('ob-friendspref');
    if (sel.length !== 1 || sel[0] !== 'men') throw new Error('friends "meet" pref did not stick: ' + JSON.stringify(sel));
    await page.click('#ob-friendspref [data-pref="everyone"]');
    await page.click('#ob-modes .mode-row[data-mode="friends"]'); // back off — rest of the suite expects date+play
    // multi-select in the same container must still toggle
    await page.click('#ob-playgames [data-game="singles"]');
    if ((await page.getAttribute('#ob-playgames [data-game="singles"]', 'aria-pressed')) !== 'false') {
      throw new Error('multi-select game chips stopped toggling');
    }
    await page.click('#ob-playgames [data-game="singles"]');
    await page.click('#ob4-done');
    if (!(await page.isVisible('#screen-ob4.active'))) throw new Error('advanced without seeking selection');
    await page.click('#ob-seeking [data-seek="woman"]');
    await page.click('#ob4-done');
    await page.waitForSelector('#screen-home.active', { timeout: 3000 });
    await page.waitForSelector('#deck-card', { timeout: 3000 });
    if (!(await cardName()).includes('Maya')) throw new Error('expected Maya first, got ' + await cardName());
  });
  await step('top picks panel ranks up to 5 with a reason each', async () => {
    const n = await page.locator('#picks-strip .pick').count();
    if (n < 1 || n > 5) throw new Error('expected 1-5 picks, got ' + n);
    if (!(await page.isVisible('#picks-panel'))) throw new Error('picks panel hidden');
    if (await page.isVisible('#topmatch-panel')) throw new Error('placeholder still showing alongside picks');
    const firstReason = (await page.textContent('#picks-strip .pick .pr')).trim();
    if (!firstReason) throw new Error('pick has no reason');
    // tapping a pick opens that player's profile sheet
    const pickName = (await page.textContent('#picks-strip .pick .pn')).trim();
    await page.click('#picks-strip .pick');
    await page.waitForSelector('#psheet-overlay.open', { timeout: 2000 });
    const sheetName = await page.textContent('#psheet-name');
    if (!sheetName.includes(pickName.split(' ')[0])) throw new Error('pick opened the wrong profile');
    await page.click('#psheet-close');
  });
  await step('discovery prefs survive a reload', async () => {
    await page.click('#menu-btn');
    await page.$eval('#radius', (el) => { el.value = 27; el.dispatchEvent(new Event('input')); });
    await page.fill('#age-min', '31');
    await page.dispatchEvent('#age-min', 'change');
    await page.fill('#age-max', '46');
    await page.dispatchEvent('#age-max', 'change');
    await page.reload();
    await page.waitForSelector('#screen-welcome.active, #screen-home.active', { timeout: 3000 });
    if (await page.isVisible('#screen-welcome.active')) await page.click('#btn-continue');
    await page.click('#menu-btn');
    const got = {
      r: await page.inputValue('#radius'),
      lo: await page.inputValue('#age-min'),
      hi: await page.inputValue('#age-max'),
    };
    if (got.r !== '27' || got.lo !== '31' || got.hi !== '46') {
      throw new Error('prefs reset on reload: ' + JSON.stringify(got));
    }
    // out-of-range entry is clamped and echoed back, never silently ignored
    await page.fill('#age-min', '4');
    await page.dispatchEvent('#age-min', 'change');
    if ((await page.inputValue('#age-min')) !== '18') throw new Error('age not clamped to 18');
    // reversed range is corrected rather than left impossible
    await page.fill('#age-min', '60');
    await page.dispatchEvent('#age-min', 'change');
    const lo = await page.inputValue('#age-min');
    const hi = await page.inputValue('#age-max');
    if (Number(lo) > Number(hi)) throw new Error('reversed age range left as-is: ' + lo + '-' + hi);
    // restore for the tests that follow
    await page.fill('#age-min', '25');
    await page.dispatchEvent('#age-min', 'change');
    await page.fill('#age-max', '55');
    await page.dispatchEvent('#age-max', 'change');
    await page.click('#settings-back');
  });
  await step('radius filter hides Maya (1.2mi), shows Priya (0.8mi)', async () => {
    await page.click('#menu-btn');
    await page.waitForSelector('#screen-settings.active', { timeout: 2000 });
    await page.$eval('#radius', (el) => { el.value = 1; el.dispatchEvent(new Event('input')); });
    await page.click('#settings-back');
    await page.waitForSelector('#deck-card', { timeout: 2000 });
    if (!(await cardName()).includes('Priya')) throw new Error('expected Priya, got ' + await cardName());
  });
  await step('widening radius brings Maya back (non-destructive)', async () => {
    await page.click('#menu-btn');
    await page.$eval('#radius', (el) => { el.value = 50; el.dispatchEvent(new Event('input')); });
    await page.click('#settings-back');
    await page.waitForSelector('#deck-card', { timeout: 2000 });
    if (!(await cardName()).includes('Maya')) throw new Error('expected Maya back, got ' + await cardName());
  });
  await step('bookmark Maya', async () => {
    await page.click('#bookmark-btn');
    await page.waitForSelector('#bookmark-btn.saved', { timeout: 2000 });
  });
  await step('rewind brings back the passed card', async () => {
    const before = await cardName();
    await page.click('#act-pass');
    await page.waitForFunction((prev) => {
      const el = document.querySelector('#deck-card .card-name');
      return el && el.textContent !== prev;
    }, before, { timeout: 2000 });
    await page.click('#act-rewind');
    await page.waitForFunction((prev) => {
      const el = document.querySelector('#deck-card .card-name');
      return el && el.textContent === prev;
    }, before, { timeout: 2000 });
  });
  await step('deck shows next card behind + tap opens profile sheet', async () => {
    if (!(await page.isVisible('.card-behind'))) throw new Error('no card peeking behind the top card');
    await page.click('#deck-card .card-photo');
    await page.waitForSelector('#psheet-overlay.open', { timeout: 2000 });
    const name = await page.textContent('#psheet-name');
    if (!name.includes('Maya')) throw new Error('sheet shows wrong profile: ' + name);
    if (!(await page.textContent('#psheet-rows')).includes('miles away')) throw new Error('sheet missing detail rows');
    await page.click('#psheet-close');
    await page.waitForFunction(() => !document.querySelector('#psheet-overlay.open'), { timeout: 2000 });
  });
  await step('date deck hides men + non-mutual seekers (pass -> Priya, not Diego)', async () => {
    await page.click('#act-pass');
    await page.waitForFunction(() => document.querySelector('#deck-card .card-name').textContent.includes('Priya'), { timeout: 3000 });
    await page.click('#act-rewind');
    await page.waitForFunction(() => document.querySelector('#deck-card .card-name').textContent.includes('Maya'), { timeout: 3000 });
    await page.click('#act-pass');
    await page.waitForFunction(() => document.querySelector('#deck-card .card-name').textContent.includes('Priya'), { timeout: 3000 });
  });
  await step('play mode shows everyone (Diego appears), date re-hides him', async () => {
    await page.click('.mode-pill[data-mode="play"]');
    await page.waitForFunction(() => document.querySelector('#deck-card .card-name').textContent.includes('Diego'), { timeout: 3000 });
    await page.click('.mode-pill[data-mode="date"]');
    await page.waitForFunction(() => document.querySelector('#deck-card .card-name').textContent.includes('Priya'), { timeout: 3000 });
  });
  await step('report Priya advances to Sam', async () => {
    await page.click('#card-more');
    await page.waitForSelector('#more-overlay.open', { timeout: 2000 });
    await page.click('#sheet-report');
    await page.waitForFunction(() => document.querySelector('#deck-card .card-name').textContent.includes('Sam'), { timeout: 3000 });
  });
  await step('block Sam advances to Elena, removes her thread', async () => {
    await page.click('#card-more');
    await page.waitForSelector('#more-overlay.open', { timeout: 2000 });
    await page.click('#sheet-block');
    await page.waitForFunction(() => document.querySelector('#deck-card .card-name').textContent.includes('Elena'), { timeout: 3000 });
    await page.click('.tab[data-screen="screen-chat"]');
    const txt = await page.textContent('#thread-list');
    if (txt.includes('Sam')) throw new Error('Sam thread still visible after block');
    await page.click('.tab[data-screen="screen-home"]');
  });
  await step('ace Elena -> match modal with confetti -> conversation', async () => {
    await page.waitForSelector('#deck-card', { timeout: 2000 });
    await page.click('#act-ace');
    await page.waitForSelector('#match-overlay.open', { timeout: 3000 });
    await page.waitForSelector('.confetti', { timeout: 2000 });
    await page.click('#match-message');
    await page.waitForSelector('#screen-convo.active', { timeout: 3000 });
  });
  await step('chat: typing indicator, then reply + court card', async () => {
    await page.fill('#chat-text', 'Great ace earlier! Rematch?');
    await page.click('#chat-sendbtn');
    await page.waitForSelector('#chat-log .is-typing', { timeout: 2500 });
    await page.waitForFunction(
      () => !document.querySelector('#chat-log .is-typing') && document.querySelectorAll('#chat-log .msg.them').length >= 1,
      { timeout: 4000 }
    );
    // their reply marks my message read — receipt shows on my last message
    await page.waitForFunction(() => {
      const mine = document.querySelectorAll('#chat-log .msg.me .when');
      return mine.length && mine[mine.length - 1].textContent.includes('Read');
    }, { timeout: 2000 });
    await page.click('#suggest-time');
    await page.waitForFunction(() => document.querySelectorAll('#chat-log .courtcard').length >= 1, { timeout: 2000 });
    if (!(await page.isVisible('#chat-more'))) throw new Error('chat more button missing');
    await page.click('#chat-back');
  });
  await step('saved strip shows Maya, like from saved', async () => {
    await page.click('.tab[data-screen="screen-matches"]');
    await page.waitForSelector('.saved-cell', { timeout: 2000 });
    await page.click('.saved-like');
    await page.waitForFunction(() => !document.querySelector('.saved-cell') || document.querySelector('#match-overlay.open'), { timeout: 3000 });
    if (await page.isVisible('#match-overlay.open')) await page.click('#match-keep');
  });
  await shot('matches');
  await step('notifications open, clear all hides dot', async () => {
    await page.click('.tab[data-screen="screen-home"]');
    await page.click('#bell-btn');
    await page.waitForSelector('#notif-overlay.open', { timeout: 2000 });
    await page.waitForSelector('.notif-item', { timeout: 2000 });
    await page.click('#notif-clear');
    await page.waitForSelector('.notif-empty', { timeout: 2000 });
    await page.click('#notif-overlay', { position: { x: 8, y: 8 } });
    await page.waitForFunction(() => !document.querySelector('#notif-overlay.open'), { timeout: 2000 });
    const dot = await page.$eval('#bell-btn .bell-dot', (el) => getComputedStyle(el).display);
    if (dot !== 'none') throw new Error('bell dot still visible');
  });
  await step('my-sports filter toggle', async () => {
    await page.click('#menu-btn');
    await page.click('#sw-mysports');
    const v = await page.getAttribute('#sw-mysports', 'aria-checked');
    if (v !== 'true') throw new Error('toggle did not flip');
    await page.click('#sw-mysports');
    await page.click('#settings-back');
  });
  await step('settings dating prefs: gender preselected, seeking editable', async () => {
    await page.click('#menu-btn');
    const g = await page.getAttribute('#set-gender [data-gender="man"]', 'aria-pressed');
    if (g !== 'true') throw new Error('gender not synced in settings');
    const s = await page.getAttribute('#set-seeking [data-seek="woman"]', 'aria-pressed');
    if (s !== 'true') throw new Error('seeking not synced in settings');
    await page.click('#set-seeking [data-seek="man"]');
    if ((await page.getAttribute('#set-seeking [data-seek="man"]', 'aria-pressed')) !== 'true') throw new Error('seeking chip did not toggle');
    await page.click('#set-seeking [data-seek="man"]');
    // play prefs synced with onboarding defaults and editable
    if ((await page.getAttribute('#set-playgames [data-game="doubles"]', 'aria-pressed')) !== 'true') throw new Error('game types not synced');
    if ((await page.getAttribute('#set-playpref [data-pref="everyone"]', 'aria-pressed')) !== 'true') throw new Error('play-with not synced');
    await page.click('#set-playpref [data-pref="women"]');
    if ((await page.getAttribute('#set-playpref [data-pref="women"]', 'aria-pressed')) !== 'true') throw new Error('play-with did not switch');
    if ((await page.getAttribute('#set-playpref [data-pref="everyone"]', 'aria-pressed')) === 'true') throw new Error('play-with not single-select');
    await page.click('#set-playpref [data-pref="everyone"]');
    if ((await page.getAttribute('#set-friendspref [data-pref="everyone"]', 'aria-pressed')) !== 'true') throw new Error('friends pref not synced');
    await page.click('#settings-back');
  });
  await step('3rd like triggers match modal', async () => {
    await page.waitForSelector('#deck-card', { timeout: 2000 });
    await page.click('#act-like');
    await page.waitForSelector('#match-overlay.open', { timeout: 3000 });
    await page.click('#match-keep');
  });
  await step('event card expands with details + attendees', async () => {
    await page.click('.tab[data-screen="screen-events"]');
    await page.click('#event-list .event');
    await page.waitForSelector('#event-list .event.expanded', { timeout: 2000 });
    if (!(await page.isVisible('#event-list .event.expanded .going-row'))) throw new Error('attendees row not shown');
  });
  await step('events join flips (without collapsing expand)', async () => {
    await page.click('#event-list .event.expanded .join-btn');
    await page.waitForSelector('#event-list .join-btn.going', { timeout: 2000 });
    if (!(await page.isVisible('#event-list .event.expanded'))) throw new Error('expansion lost on join');
  });
  await step('profile shows uploaded photo + bio saves', async () => {
    await page.click('.tab[data-screen="screen-profile"]');
    await page.waitForSelector('#profile-body .ava.has-photo', { timeout: 2000 });
    await page.fill('#bio-text', 'Riverside regular, post-match taco enthusiast.');
    await page.click('#screen-profile .appbar-title');
    if ((await page.locator('#pgrid .ptile[data-i]').count()) !== 1) throw new Error('expected 1 photo tile');
    if (!(await page.isVisible('#ptile-add'))) throw new Error('add-photo tile missing');
    // all six slots visible, so the room to add more is obvious
    const slots = await page.locator('#pgrid .ptile').count();
    if (slots !== 6) throw new Error('expected 6 photo slots, got ' + slots);
    if (!(await page.textContent('#profile-body')).includes('1 of 6')) throw new Error('photo count label missing');
  });
  await step('photo grid: add, make main, remove', async () => {
    await page.setInputFiles('#photo-input', out('avatar2.png'));
    await page.waitForSelector('#pgrid .ptile[data-i="1"]', { timeout: 2000 });
    const mainBefore = await page.getAttribute('#pgrid .ptile[data-i="0"]', 'style');
    await page.click('#pgrid .ptile[data-i="1"]');
    await page.waitForFunction((prev) => {
      const t = document.querySelector('#pgrid .ptile[data-i="0"]');
      return t && t.getAttribute('style') !== prev;
    }, mainBefore, { timeout: 2000 });
    if (!(await page.isVisible('#pgrid .ptile[data-i="0"] .ptag'))) throw new Error('Main tag missing after swap');
    await page.click('#pgrid .ptile[data-i="1"] .pdel');
    await page.waitForFunction(() => document.querySelectorAll('#pgrid .ptile[data-i]').length === 1, { timeout: 2000 });
    if (!(await page.isVisible('#profile-body .ava.has-photo'))) throw new Error('avatar lost its photo');
  });
  await shot('profile');
  await step('sign out resets, reload fresh', async () => {
    await page.click('#open-settings');
    await page.click('#sign-out');
    await page.waitForSelector('#screen-welcome.active', { timeout: 2000 });
    const saved = await page.evaluate(() => localStorage.getItem('40love.profile'));
    if (saved) throw new Error('profile not cleared');
    await page.reload();
    await page.waitForSelector('#screen-welcome.active', { timeout: 3000 });
  });

  site.close();
  await finish(browser, errors);
})();
