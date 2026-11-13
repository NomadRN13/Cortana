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
  const toastText = async () => (await page.textContent('#toast')).trim();
  const ACCENT = 'rgb(200, 240, 74)';   // Optic, #C8F04A
  // Home, on its events (leaving the deck if it was left open)
  const homeFeed = async () => {
    await page.click('.tab[data-screen="screen-home"]');
    if (await page.isVisible('#close-deck')) await page.click('#close-deck');
    await page.waitForSelector('#home-feed:not([hidden])', { timeout: 2000 });
  };
  // Settings by way of the Profile tab; its Back button lands on Home
  const openSettings = async () => {
    await page.click('.tab[data-screen="screen-profile"]');
    await page.click('#open-settings');
    await page.waitForSelector('#screen-settings.active', { timeout: 2000 });
  };
  const backToMatches = async () => {
    await page.click('#settings-back');
    await page.click('.tab[data-screen="screen-matches"]');
    await page.waitForSelector('#screen-matches.active', { timeout: 2000 });
  };

  await page.goto(site.url('app/index.html'));

  await step('welcome lists the modes Play, Date, Friends; no deposit promise, no retired name', async () => {
    const modes = await page.$$eval('#screen-welcome .wm-row strong', (els) => els.map((e) => e.textContent.trim()).join('|'));
    if (modes !== 'Play Mode|Date Mode|Friends Mode') throw new Error('welcome modes: ' + modes);
    // Payments do not exist, so nothing on the page may promise a deposit —
    // and the retired name stays retired. The whole document, scripts included.
    const html = await page.content();
    if (/deposit/i.test(html)) throw new Error('the page mentions a deposit');
    if (/40\s*[\/–-]\s*love|first date is a game|love at first serve/i.test(html)) throw new Error('the retired name is back');
  });
  await step('welcome -> create profile', async () => {
    await page.click('#btn-create');
    await page.waitForSelector('#screen-ob1.active', { timeout: 3000 });
  });
  await step('photo upload previews', async () => {
    await page.setInputFiles('#photo-input', out('avatar.png'));
    await page.waitForSelector('#photo-preview.has', { timeout: 3000 });
  });
  await step('onboarding requires gender, then to home', async () => {
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
  });
  await step('home leads with events near you; the deck is not on screen yet', async () => {
    if (!(await page.isVisible('#home-feed'))) throw new Error('the events feed is not showing');
    const head = (await page.textContent('#home-events-title')).trim();
    if (head !== 'This week on the courts') throw new Error('heading: ' + head);
    if (!/Events near you/.test(await page.textContent('#screen-home .home-events'))) throw new Error('no "Events near you"');
    const titles = await page.$$eval('#home-event-list .event-title', (els) => els.map((e) => e.textContent));
    if (titles.length < 2 || titles.length > 3) throw new Error('expected the next 2-3 events, got ' + titles.length);
    if (titles[0] !== 'Sunset Doubles Social') throw new Error('first event: ' + titles[0]);
    const btns = await page.$$eval('#home-event-list .join-btn', (els) => els.map((e) => e.textContent.trim()));
    if (btns.length !== titles.length || btns.some((t) => t !== 'RSVP')) throw new Error('RSVP buttons: ' + btns.join('|'));
    // events first, then "Find a game" — and the deck stays behind it
    const order = await page.evaluate(() => {
      const ev = document.querySelector('#screen-home .home-events');
      const fg = document.querySelector('#find-game');
      return !!(ev.compareDocumentPosition(fg) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    if (!order) throw new Error('"Find a game" comes before the events');
    if (!(await page.isVisible('#find-game #open-deck'))) throw new Error('no way into the deck');
    for (const sel of ['#deck', '#mode-pills', '#picks-panel', '#sw-mysports']) {
      if (await page.isVisible(sel)) throw new Error(sel + ' is on screen before "Find a game" is tapped');
    }
    // the card shows the modes that are on, in Play-Date-Friends order
    const mine = await page.$$eval('#find-game-modes .tag', (els) => els.map((e) => e.textContent).join('|'));
    if (mine !== 'Play|Date') throw new Error('modes on the card: ' + mine);
  });
  await shot('home');
  await step('RSVP on Home needs the waiver tick before it is accepted', async () => {
    const card = '#home-event-list .event[data-id="e2"]';
    const spotsBefore = (await page.textContent(card + ' .spots')).trim();
    await page.click(card + ' .join-btn');
    await page.waitForSelector(card + ' .waiver-row', { timeout: 2000 });
    const line = (await page.textContent(card + ' .waiver-row')).trim();
    if (line !== 'I’ve read the event waiver and code of conduct') throw new Error('waiver line: ' + line);
    // the tick box is a real, labelled checkbox
    const labelled = await page.$eval(card + ' .waiver-row input', (el) => el.type === 'checkbox' && !!el.labels.length && !el.checked);
    if (!labelled) throw new Error('waiver checkbox is not an unticked, labelled checkbox');
    // no tick, no RSVP
    await page.click(card + ' [data-act="rsvp-confirm"]');
    if (await page.$(card + ' .join-btn.going')) throw new Error('RSVP accepted without the waiver tick');
    if (!/Tick the box/.test(await toastText())) throw new Error('no explanation: ' + await toastText());
    if ((await page.textContent(card + ' .spots')).trim() !== spotsBefore) throw new Error('a spot was taken without the tick');
    // "Not now" backs out without an RSVP, and the tick does not carry over
    await page.check(card + ' .waiver-row input');
    await page.click(card + ' [data-act="rsvp-cancel"]');
    if (await page.$(card + ' .join-btn.going')) throw new Error('"Not now" made an RSVP');
    await page.click(card + ' .join-btn');
    if (await page.isChecked(card + ' .waiver-row input')) throw new Error('the tick carried over');
    // ticked: accepted
    await page.check(card + ' .waiver-row input');
    await page.click(card + ' [data-act="rsvp-confirm"]');
    await page.waitForSelector(card + ' .join-btn.going', { timeout: 2000 });
    if ((await page.textContent(card + ' .join-btn')).trim() !== 'Going ✓') throw new Error('joined label: ' + await page.textContent(card + ' .join-btn'));
    if (await page.$(card + ' .waiver-row')) throw new Error('waiver line still showing after the RSVP');
    if (!(await page.isVisible(card + ' [data-act="checkin-open"]'))) throw new Error('a joined event has no Check in');
  });
  await step('"Find a game" opens the deck in one tap (first card Maya)', async () => {
    await page.click('#open-deck');
    await page.waitForSelector('#deck-card', { timeout: 3000 });
    if (!(await cardName()).includes('Maya')) throw new Error('expected Maya first, got ' + await cardName());
    if (await page.isVisible('#home-feed')) throw new Error('events feed still showing behind the deck');
    for (const sel of ['#mode-pills', '#picks-panel', '#sw-mysports', '#deck .deck-actions']) {
      if (!(await page.isVisible(sel))) throw new Error(sel + ' missing once the deck is open');
    }
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
    // a fresh visit opens on the events again, not on the deck
    if (!(await page.isVisible('#home-feed')) || (await page.isVisible('#deck'))) throw new Error('reload did not open Home on events');
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
    await page.click('#open-deck');   // back into the deck for the steps that follow
    await page.waitForSelector('#deck-card', { timeout: 2000 });
  });
  await step('radius filter hides Maya (2mi), shows Priya (1mi, nearby)', async () => {
    await page.click('#menu-btn');
    await page.waitForSelector('#screen-settings.active', { timeout: 2000 });
    await page.$eval('#radius', (el) => { el.value = 1; el.dispatchEvent(new Event('input')); });
    await page.click('#settings-back');
    await page.waitForSelector('#deck-card', { timeout: 2000 });
    if (!(await cardName()).includes('Priya')) throw new Error('expected Priya, got ' + await cardName());
    // same grid square reads as "Nearby", never a decimal distance
    const line = await page.textContent('#deck-card');
    if (!line.includes('Nearby')) throw new Error('Priya card should say Nearby');
    if (/\d\.\d+ mi/.test(line)) throw new Error('card shows a decimal distance: ' + line);
  });
  await step('widening radius brings Maya back (non-destructive)', async () => {
    await page.click('#menu-btn');
    await page.$eval('#radius', (el) => { el.value = 50; el.dispatchEvent(new Event('input')); });
    await page.click('#settings-back');
    await page.waitForSelector('#deck-card', { timeout: 2000 });
    if (!(await cardName()).includes('Maya')) throw new Error('expected Maya back, got ' + await cardName());
  });
  await step('back to events and into the deck again: it is where it was left', async () => {
    await page.click('#close-deck');
    await page.waitForSelector('#home-event-list .event', { timeout: 2000 });
    if (await page.isVisible('#deck')) throw new Error('deck still showing after going back to events');
    await page.click('#open-deck');
    await page.waitForSelector('#deck-card', { timeout: 2000 });
    if (!(await cardName()).includes('Maya')) throw new Error('deck lost its place: ' + await cardName());
    // tapping the Home tab while on Home is the other way back to the events
    await page.click('.tab[data-screen="screen-home"]');
    await page.waitForSelector('#home-feed:not([hidden])', { timeout: 2000 });
    await page.click('#open-deck');
    await page.waitForSelector('#deck-card', { timeout: 2000 });
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
    const rows = await page.textContent('#psheet-rows');
    // Maya is 2 miles away: whole miles, "About N miles away"
    if (!/About \d+ miles away|Nearby/.test(rows)) throw new Error('sheet missing detail rows');
    if (!rows.includes('About 2 miles away')) throw new Error('expected whole-mile distance for Maya: ' + rows);
    await page.click('#psheet-close');
    await page.waitForFunction(() => !document.querySelector('#psheet-overlay.open'), { timeout: 2000 });
  });
  await step('home opens on the first mode chosen, in Play-Date-Friends order', async () => {
    const pills = await page.$$eval('.mode-pill', (els) => els.map((e) => e.getAttribute('data-mode')).join());
    if (pills !== 'play,date,friends') throw new Error('mode pills out of order: ' + pills);
    const on = await page.getAttribute('.mode-pill.on', 'data-mode');
    if (on !== 'play') throw new Error('expected Play selected after signing up for Date + Play, got ' + on);
  });
  await step('date deck hides men + non-mutual seekers (pass -> Priya, not Diego)', async () => {
    await page.click('.mode-pill[data-mode="date"]');
    await page.waitForFunction(() => document.querySelector('#deck-card .card-name').textContent.includes('Maya'), { timeout: 3000 });
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
  await step('my-sports filter toggle is on Home, above the deck it filters', async () => {
    // It used to be the last row of Settings; it now sits where it is used.
    if (!(await page.isVisible('#screen-home #sw-mysports'))) throw new Error('filter is not visible on Home');
    await page.click('#sw-mysports');
    const v = await page.getAttribute('#sw-mysports', 'aria-checked');
    if (v !== 'true') throw new Error('toggle did not flip');
    const note = (await page.textContent('#mysports-note')).trim();
    if (!/^Showing .+ players$/.test(note) || /every sport/.test(note)) throw new Error('note did not change: ' + note);
    await page.click('#sw-mysports');
    if ((await page.getAttribute('#sw-mysports', 'aria-checked')) !== 'false') throw new Error('toggle did not flip back');
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
  await step('RSVP in the expanded event needs the waiver tick too (and keeps it expanded)', async () => {
    const card = '#event-list .event[data-id="e1"]';
    if ((await page.textContent(card + ' .join-btn')).trim() !== 'RSVP') throw new Error('button says ' + await page.textContent(card + ' .join-btn'));
    await page.click(card + '.expanded .join-btn');
    await page.waitForSelector(card + ' .waiver-row', { timeout: 2000 });
    if (!(await page.isVisible(card + '.expanded'))) throw new Error('expansion lost on RSVP');
    await page.click(card + ' [data-act="rsvp-confirm"]');
    if (await page.$(card + ' .join-btn.going')) throw new Error('RSVP accepted without the waiver tick');
    // ticking the box must not collapse the card it sits in
    await page.check(card + ' .waiver-row input');
    if (!(await page.isVisible(card + '.expanded'))) throw new Error('ticking the waiver collapsed the event');
    await page.click(card + ' [data-act="rsvp-confirm"]');
    await page.waitForSelector(card + ' .join-btn.going', { timeout: 2000 });
    if ((await page.textContent(card + ' .join-btn')).trim() !== 'Going ✓') throw new Error('joined label wrong');
    if (!(await page.isVisible(card + '.expanded'))) throw new Error('expansion lost on join');
    if (!/including you/.test(await page.textContent(card + ' .going-label'))) throw new Error('going row does not count you');
  });
  await step('an RSVP made on Home shows on Events; cancelling asks for the waiver again', async () => {
    // (the one made earlier went with the reload: RSVPs live in memory, like the rest of the demo)
    await homeFeed();
    const home = '#home-event-list .event[data-id="e2"]';
    if (!(await page.$('#home-event-list .event[data-id="e1"] .join-btn.going'))) throw new Error('the Events RSVP is not reflected on Home');
    await page.click(home + ' .join-btn');
    await page.check(home + ' .waiver-row input');
    await page.click(home + ' [data-act="rsvp-confirm"]');
    await page.waitForSelector(home + ' .join-btn.going', { timeout: 2000 });
    await page.click('#home-all-events');
    await page.waitForSelector('#screen-events.active', { timeout: 2000 });
    const card = '#event-list .event[data-id="e2"]';
    if (!(await page.$(card + ' .join-btn.going'))) throw new Error('Home RSVP is not reflected on the Events tab');
    await page.click(card + ' .join-btn');   // Going -> cancel
    if (await page.$(card + ' .join-btn.going')) throw new Error('could not cancel the RSVP');
    if (await page.$(card + ' [data-act="checkin-open"]')) throw new Error('Check in offered for an event not joined');
    await page.click(card + ' .join-btn');
    if (!(await page.isVisible(card + ' .waiver-row'))) throw new Error('a second RSVP skipped the waiver');
    await page.click(card + ' [data-act="rsvp-cancel"]');
  });
  await step('no crew before a check-in', async () => {
    await page.click('.tab[data-screen="screen-matches"]');
    if (await page.$('#match-grid-wrap .crew')) throw new Error('a crew is shown before anyone checked in');
    await page.click('.tab[data-screen="screen-events"]');
  });
  await step('check in asks for the host code; the demo takes any 4 digits and says so', async () => {
    const card = '#event-list .event[data-id="e1"]';
    await page.click(card + ' [data-act="checkin-open"]');
    await page.waitForSelector(card + ' .checkin-code', { timeout: 2000 });
    const labelled = await page.$eval(card + ' .checkin-code', (el) => el.labels.length === 1 && /host/i.test(el.labels[0].textContent));
    if (!labelled) throw new Error('the code field has no label');
    const hint = (await page.textContent(card + ' .demo-hint')).trim();
    if (!/^Demo:/.test(hint) || !/any 4 digits/.test(hint)) throw new Error('demo hint: ' + hint);
    // not a code: refused
    await page.click(card + ' [data-act="checkin-confirm"]');
    if (await page.$(card + ' .checked-tag')) throw new Error('checked in with no code');
    await page.fill(card + ' .checkin-code', '12');
    await page.click(card + ' [data-act="checkin-confirm"]');
    if (await page.$(card + ' .checked-tag')) throw new Error('checked in with a 2-digit code');
    if (!/4-digit code/.test(await toastText())) throw new Error('no explanation: ' + await toastText());
    // letters never make it into the field
    await page.fill(card + ' .checkin-code', '');
    await page.type(card + ' .checkin-code', 'ab4821');
    if ((await page.inputValue(card + ' .checkin-code')) !== '4821') throw new Error('field holds ' + await page.inputValue(card + ' .checkin-code'));
    await page.press(card + ' .checkin-code', 'Enter');
    await page.waitForSelector(card + ' .checked-tag', { timeout: 2000 });
    if (!/Checked in/.test(await page.textContent(card + ' .checked-tag'))) throw new Error('no checked-in mark');
    const said = await toastText();
    if (!/crew/i.test(said) || !/Matches/.test(said)) throw new Error('toast does not mention the crew: ' + said);
    if (await page.$(card + ' .join-btn')) throw new Error('a checked-in event can still be un-RSVPed');
    if (!(await page.isVisible(card + '.expanded'))) throw new Error('expansion lost on check-in');
  });
  await step('crew appears on top of Matches after check-in: the people from that event', async () => {
    await page.click('#event-list .event[data-id="e1"] [data-act="crew"]');
    await page.waitForSelector('#screen-matches.active', { timeout: 2000 });
    await page.waitForSelector('#match-grid-wrap .crew', { timeout: 2000 });
    const first = await page.$eval('#match-grid-wrap', (el) => el.firstElementChild.id);
    if (first !== 'crew') throw new Error('crew is not at the top of Matches');
    if ((await page.textContent('#crew-title')).trim() !== 'Your crew') throw new Error('heading: ' + await page.textContent('#crew-title'));
    if (!/shared a court/.test(await page.textContent('#crew'))) throw new Error('no "shared a court" line');
    // the same three faces the event showed as going
    const names = await page.$$eval('#crew .crew-row .n', (els) => els.map((e) => e.textContent).join('|'));
    if (names !== 'Maya|Elena|Grace & Rosa') throw new Error('crew: ' + names);
    const where = await page.$$eval('#crew .crew-row .s', (els) => els.map((e) => e.textContent));
    if (where.some((t) => !/Sunset Doubles Social/.test(t))) throw new Error('crew rows do not name the event: ' + where.join('|'));
  });
  await step('crew: "Play again" adds, and toggles back', async () => {
    const btn = '#crew .crew-row[data-crew="maya"] .crew-add';
    if ((await page.textContent(btn)).trim() !== 'Play again') throw new Error('button says ' + await page.textContent(btn));
    await page.click(btn);
    await page.waitForFunction((s) => document.querySelector(s).textContent.trim() === 'Added ✓', btn, { timeout: 2000 });
    if (!/Added Maya/.test(await toastText())) throw new Error('toast: ' + await toastText());
    // one add is one add
    const others = await page.$$eval('#crew .crew-add', (els) => els.filter((e) => e.textContent.trim() === 'Added ✓').length);
    if (others !== 1) throw new Error(others + ' rows marked Added');
    // it survives leaving the tab and coming back
    await page.click('.tab[data-screen="screen-chat"]');
    await page.click('.tab[data-screen="screen-matches"]');
    if ((await page.textContent(btn)).trim() !== 'Added ✓') throw new Error('the add was lost');
    await page.click(btn);
    await page.waitForFunction((s) => document.querySelector(s).textContent.trim() === 'Play again', btn, { timeout: 2000 });
    await page.click(btn);
    await page.waitForFunction((s) => document.querySelector(s).textContent.trim() === 'Added ✓', btn, { timeout: 2000 });
  });
  await step('"Also open to dating" shows only with Date mode on and a mutual fit', async () => {
    const tagged = () => page.$$eval('#crew .crew-row', (rows) => rows
      .filter((r) => r.querySelector('.crew-date')).map((r) => r.getAttribute('data-crew')).join('|'));
    // Aaron (man, looking to date women, Date mode on): Maya and Elena are
    // women looking to date men. Grace & Rosa are a team — never.
    if ((await tagged()) !== 'maya|elena') throw new Error('with Date on: ' + await tagged());
    if ((await page.textContent('#crew .crew-row[data-crew="maya"] .crew-date')).trim() !== 'Also open to dating') throw new Error('tag text');
    // not mutual any more: he now looks to date men only
    await openSettings();
    await page.click('#set-seeking [data-seek="man"]');
    await page.click('#set-seeking [data-seek="woman"]');
    await backToMatches();
    if ((await tagged()) !== '') throw new Error('tag shown without a mutual fit: ' + await tagged());
    await openSettings();
    await page.click('#set-seeking [data-seek="woman"]');
    await page.click('#set-seeking [data-seek="man"]');
    // Date mode off: no tag for anyone, though everything else still fits
    await page.click('#sw-date');
    if ((await page.getAttribute('#sw-date', 'aria-checked')) !== 'false') throw new Error('Date mode did not switch off');
    await backToMatches();
    await page.waitForSelector('#crew .crew-row', { timeout: 2000 });
    if (await page.$('#crew .crew-date')) throw new Error('dating tag shown with Date mode off: ' + await tagged());
    if (/dating/i.test(await page.textContent('#crew'))) throw new Error('the crew mentions dating with Date mode off');
    // and "Find a game" stops listing Date
    await homeFeed();
    const mine = await page.$$eval('#find-game-modes .tag', (els) => els.map((e) => e.textContent).join('|'));
    if (mine !== 'Play') throw new Error('modes on the card with Date off: ' + mine);
    // back on for the steps that follow
    await openSettings();
    await page.click('#sw-date');
    if ((await page.getAttribute('#sw-date', 'aria-checked')) !== 'true') throw new Error('Date mode did not switch back on');
    await backToMatches();
    if ((await tagged()) !== 'maya|elena') throw new Error('with Date back on: ' + await tagged());
  });
  await shot('crew');
  await step('blocking someone from the crew takes them out of it, and out of the going row', async () => {
    await page.click('#crew .crew-row[data-crew="elena"] .crew-more');
    await page.waitForSelector('#more-overlay.open', { timeout: 2000 });
    await page.click('#sheet-block');
    await page.waitForFunction(() => !document.querySelector('#crew .crew-row[data-crew="elena"]'), { timeout: 2000 });
    const names = await page.$$eval('#crew .crew-row .n', (els) => els.map((e) => e.textContent).join('|'));
    if (names !== 'Maya|Grace & Rosa') throw new Error('crew after the block: ' + names);
    if (/Elena/.test(await page.textContent('#match-grid-wrap'))) throw new Error('Elena still on Matches after the block');
    await page.click('.tab[data-screen="screen-events"]');
    const faces = await page.$$eval('#event-list .event[data-id="e1"] .going-row .ava', (els) => els.map((e) => e.textContent).join('|'));
    if (faces !== 'M|G') throw new Error('going row after the block: ' + faces);
  });
  await step('a tournament bracket is drawn as rounds: cards, winner in the accent colour, scores at the right', async () => {
    const t = '#tournament-list [data-tourney="t2"]';
    await page.click(t + ' [data-t-act="toggle"]');
    await page.waitForSelector(t + ' .br-rounds', { timeout: 2000 });
    const info = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const rounds = [...card.querySelectorAll('.br-rounds > .br-round')];
      const box = (el) => el.getBoundingClientRect();
      const m = card.querySelector('.br-match[data-round="1"]');
      const won = m.querySelector('.br-player.won');
      const lost = m.querySelector('.br-player.lost');
      const score = won.querySelector('.br-score');
      return {
        heads: rounds.map((r) => r.querySelector('.br-head').textContent).join('|'),
        perRound: rounds.map((r) => r.querySelectorAll('.br-match').length).join(','),
        // side by side: every round starts to the right of the one before it, level with it
        columns: rounds.every((r, i) => i === 0 || (box(r).left > box(rounds[i - 1]).left && Math.abs(box(r).top - box(rounds[0]).top) < 2)),
        twoRows: [...card.querySelectorAll('.br-match')].every((x) => x.querySelectorAll('.br-player').length === 2),
        wonColor: getComputedStyle(won).color,
        lostColor: getComputedStyle(lost).color,
        wonName: won.querySelector('.nm').textContent.trim(),
        wonPts: [...won.querySelectorAll('.br-score i')].map((e) => e.textContent).join(' '),
        lostPts: [...lost.querySelectorAll('.br-score i')].map((e) => e.textContent).join(' '),
        // right-aligned: the score ends at the card's right edge, after the name
        gapRight: box(m).right - box(score).right,
        afterName: box(score).left >= box(won.querySelector('.nm')).right - 1,
        lostGapRight: box(m).right - box(lost.querySelector('.br-score')).right,
        scrolls: card.querySelector('.br-rounds').scrollWidth > card.querySelector('.br-rounds').clientWidth,
        pageWide: document.querySelector('#events-scroll').scrollWidth > document.querySelector('#events-scroll').clientWidth,
        semis: [...rounds[2].querySelectorAll('.br-player.tbd .nm')].map((e) => e.textContent).join('|'),
        wonButtons: rounds[1].querySelectorAll('.br-won').length,
      };
    }, t);
    if (info.heads !== 'Round of 16|Quarterfinals|Semifinals|Final') throw new Error('rounds: ' + info.heads);
    if (info.perRound !== '4,4,2,1') throw new Error('matches per round: ' + info.perRound);
    if (!info.columns) throw new Error('rounds are not laid out as columns');
    if (!info.twoRows) throw new Error('a match card does not have exactly two rows');
    if (info.wonColor !== ACCENT) throw new Error('winner colour ' + info.wonColor);
    if (info.lostColor === ACCENT) throw new Error('loser is in the accent colour too');
    if (!/✓/.test(info.wonName)) throw new Error('winner is marked by colour alone: ' + info.wonName);
    if (info.wonPts !== '11 11' || info.lostPts !== '8 6') throw new Error('scores: ' + info.wonPts + ' / ' + info.lostPts);
    if (info.gapRight < 0 || info.gapRight > 16 || !info.afterName) throw new Error('score is not right-aligned: ' + JSON.stringify(info));
    if (Math.abs(info.gapRight - info.lostGapRight) > 1) throw new Error('the two scores do not line up');
    if (!info.scrolls) throw new Error('later rounds are not reachable by scrolling the bracket');
    if (info.pageWide) throw new Error('the bracket made the whole screen scroll sideways');
    if (info.semis !== 'To be decided|To be decided|To be decided|To be decided') throw new Error('semifinals: ' + info.semis);
    if (info.wonButtons !== 8) throw new Error(info.wonButtons + ' "Won" buttons in the quarterfinals');
  });
  await shot('bracket');
  await step('recording a result still fills the next round, and keeps the bracket where it was scrolled', async () => {
    const t = '#tournament-list [data-tourney="t2"]';
    const res = await page.evaluate((sel) => {
      const card = () => document.querySelector(sel);
      // one round along (the bracket snaps to its columns, so read back where it settled)
      card().querySelector('.br-rounds').scrollLeft = 214;
      const before = card().querySelector('.br-rounds').scrollLeft;
      const btn = card().querySelector('.br-match[data-round="2"][data-slot="0"] .br-won');
      const who = btn.getAttribute('aria-label').replace(/^Record | as the winner$/g, '');
      btn.click();
      const semi = card().querySelector('.br-match[data-round="3"][data-slot="0"] .br-player:not(.tbd) .nm');
      const qf = card().querySelector('.br-match[data-round="2"][data-slot="0"] .br-player.won .nm');
      return { who, semi: semi && semi.textContent.trim(), qf: qf && qf.textContent, before, left: card().querySelector('.br-rounds').scrollLeft };
    }, t);
    if (res.semi !== res.who) throw new Error('winner ' + res.who + ' did not reach the semifinal: ' + res.semi);
    if (!res.qf || !res.qf.includes(res.who)) throw new Error('quarterfinal winner not marked');
    if (res.before < 100) throw new Error('the bracket did not scroll: ' + res.before);
    if (Math.abs(res.left - res.before) > 2) throw new Error('bracket jumped from ' + res.before + ' to ' + res.left);
    // a result already in cannot be recorded again: its buttons are gone
    if (await page.$(t + ' .br-match[data-round="2"][data-slot="0"] .br-won')) throw new Error('a decided match still offers "Won"');
    await page.click(t + ' [data-t-act="toggle"]');
    if (await page.$(t + ' .br-rounds')) throw new Error('"Hide bracket" did not hide it');
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
    const saved = await page.evaluate(() => localStorage.getItem('rsvplay.profile'));
    if (saved) throw new Error('profile not cleared');
    // RSVPs, the check-in and the crew went with the account
    const left = await page.evaluate(() => ({
      going: document.querySelectorAll('.join-btn.going, .checked-tag').length,
      crew: document.querySelectorAll('#crew .crew-row').length,
    }));
    if (left.going || left.crew) throw new Error('left behind for the next person: ' + JSON.stringify(left));
    await page.reload();
    await page.waitForSelector('#screen-welcome.active', { timeout: 3000 });
  });

  site.close();
  await finish(browser, errors);
})();
