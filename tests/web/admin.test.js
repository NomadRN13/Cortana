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

  await step('tournaments tab: create one, fill it to 72, and the draw builds the bracket', async () => {
    await page.click('#tab-tournaments');
    await page.waitForSelector('#pane-tournaments:not([hidden])', { timeout: 3000 });
    await page.click('#tn-create');
    if (!/required/.test(await page.textContent('#tn-msg'))) throw new Error('missing-title validation absent');
    await page.fill('#tn-title', 'Test Cup');
    const d = new Date(Date.now() + 4 * 86400000);
    await page.fill('#tn-date', d.toISOString().slice(0, 10));
    await page.selectOption('#tn-city', 'bakersfield');
    await page.fill('#tn-max', '73');
    await page.click('#tn-create');
    if (!/from 2 to 72/.test(await page.textContent('#tn-msg'))) throw new Error('a 73-entry tournament was accepted');
    await page.fill('#tn-max', '72');
    await page.click('#tn-create');
    const card = '#tournament-list .item >> nth=0';
    if (!(await page.textContent(card)).includes('Test Cup')) throw new Error('tournament not created');
    if (!(await page.isDisabled(card + ' >> button[data-act="draw"]'))) throw new Error('a draw was offered with no entries');
    await page.click(card + ' >> button[data-act="fill"]');
    if (!/72 of 72 entered/.test(await page.textContent(card))) throw new Error('not filled to 72');
    await page.click(card + ' >> button[data-act="draw"]');
    const info = await page.evaluate(() => {
      const c = document.querySelector('#tournament-list .item');
      const rounds = [...c.querySelectorAll('.br-round')];
      const names = (round) => [...round.querySelectorAll('.br-p:not(.empty-slot)')].map((e) => e.textContent.replace(' ✓', '').trim());
      const r1 = names(rounds[0]), r2 = names(rounds[1]);
      return {
        heads: rounds.map((r) => r.querySelector('h3').textContent).join('|'),
        shown: c.querySelectorAll('.br-match').length, r1players: r1.length, byePlayers: r2.length,
        unique: new Set(r1.concat(r2)).size,
        byes: (rounds[0].querySelector('.br-byes') || { getAttribute: () => null }).getAttribute('data-byes'),
        byeLine: (rounds[0].querySelector('.br-byes') || { textContent: '' }).textContent,
        r1buttons: rounds[0].querySelectorAll('button.br-p[data-act="win"]').length,
      };
    });
    if (!/^56 players have a bye and start in the Round of 64\.$/.test(info.byeLine.trim())) throw new Error('byes line: ' + info.byeLine);
    // every round-1 player is waiting on a result the desk can record
    if (info.r1buttons !== 16) throw new Error('round-1 players not clickable: ' + info.r1buttons);
    if (info.heads.toLowerCase() !== 'round of 128|round of 64|round of 32|round of 16|quarterfinals|semifinals|final') throw new Error('rounds: ' + info.heads);
    // 127 matches in a bracket of 128, less the 56 byes that are counted, not listed
    if (info.shown !== 71 || info.r1players !== 16 || info.byePlayers !== 56 || info.unique !== 72 || info.byes !== '56') throw new Error(JSON.stringify(info));
  });

  await step('tournaments tab: the desk records results through to a champion, and can correct one', async () => {
    for (let guard = 0; guard < 200; guard++) {
      // first match that has both players and no winner yet
      const next = await page.evaluate(() => {
        const c = document.querySelector('#tournament-list .item');
        const m = [...c.querySelectorAll('.br-match')].find((x) => x.querySelectorAll('button.br-p').length === 2 && !x.querySelector('.won'));
        if (!m) return null;
        const b = m.querySelector('button.br-p');
        return { match: b.getAttribute('data-match'), winner: b.getAttribute('data-winner') };
      });
      if (!next) break;
      await page.click('#tournament-list .item >> nth=0 >> button[data-match="' + next.match + '"][data-winner="' + next.winner + '"]');
    }
    const text = await page.textContent('#tournament-list .item >> nth=0');
    if (!/Champion: \S/.test(text)) throw new Error('no champion after playing every match');
    // correcting the final changes the champion
    const fin = await page.evaluate(() => {
      const c = document.querySelector('#tournament-list .item');
      const rounds = [...c.querySelectorAll('.br-round')];
      const loser = rounds[rounds.length - 1].querySelector('button.br-p.lost');
      return { match: loser.getAttribute('data-match'), winner: loser.getAttribute('data-winner'), name: loser.textContent.trim() };
    });
    await page.click('#tournament-list .item >> nth=0 >> button[data-match="' + fin.match + '"][data-winner="' + fin.winner + '"]');
    const after = await page.textContent('#tournament-list .item >> nth=0');
    if (!after.includes('Champion: ' + fin.name)) throw new Error('correcting the final did not change the champion');
    // Every earlier match now has its next match played, so it is locked: no
    // clickable players (the desk never asks for a score and then refuses), and
    // the winner says why.
    const locked = await page.evaluate(() => {
      const c = document.querySelector('#tournament-list .item');
      const rounds = [...c.querySelectorAll('.br-round')];
      const early = rounds.slice(0, -1);
      const won = rounds[0].querySelector('.br-match .br-p.won');
      return {
        buttons: early.reduce((n, r) => n + r.querySelectorAll('button.br-p').length, 0),
        finalButtons: rounds[rounds.length - 1].querySelectorAll('button.br-p').length,
        title: won ? won.getAttribute('title') || '' : null,
      };
    });
    if (locked.buttons !== 0) throw new Error('locked matches still clickable: ' + locked.buttons);
    if (locked.finalButtons !== 2) throw new Error('the final should stay correctable: ' + locked.finalButtons);
    if (!/next round has been played/.test(locked.title || '')) throw new Error('locked winner has no explanation: ' + locked.title);
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
