// Meetups follow the cities on the member's profile: one city or several, and
// no others. There is no nationwide list and no picker on the Events screen —
// choosing cities in Settings is the only thing that changes what is shown.
const { launch, step, fail, watch, finish, fileUrl, REPO } = require('./lib/harness');
(async () => {
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(fileUrl('app/index.html'));
  // straight into the app
  await p.click('#btn-create');
  await p.fill('#ob-name','Sam'); await p.fill('#ob-age','32');
  await p.click('#ob-gender [data-gender="woman"]');
  await p.selectOption('#ob-city','indianapolis');
  await p.click('#ob1-next');
  await p.fill('#ob-phone','3175550142'); await p.click('#phone-send');
  await p.fill('#ob-phone-code','123456'); await p.click('#phone-verify'); await p.click('#obphone-next');
  await p.click('[data-sport="Pickleball"]'); await p.click('#ob2-next');
  await p.click('[data-skill="Intermediate"]'); await p.click('#ob3-next');
  await p.click('#ob-seeking [data-seek="man"]'); await p.click('#ob4-done');
  await p.waitForSelector('#screen-home.active');

  const openEvents = async () => {
    await p.click('.tab[data-screen="screen-events"]');
    await p.waitForSelector('#screen-events.active');
  };
  const titles = async () => p.$$eval('#event-list .event-title', els => els.map(e => e.textContent));
  const label = async () => (await p.textContent('#event-city-label')).trim();
  // Cities are a multi-select in Settings: each tap adds or drops one.
  const tapCities = async (...slugs) => {
    await p.evaluate(() => document.getElementById('open-settings').click());
    await p.waitForSelector('#screen-settings.active');
    for (const slug of slugs) await p.click('#set-city [data-city="' + slug + '"]');
    const on = await p.$$eval('#set-city .chip[aria-pressed="true"]', els => els.map(e => e.getAttribute('data-city')));
    await p.click('#settings-back');
    await p.waitForSelector('#screen-home.active');
    await openEvents();
    return on;
  };

  await openEvents();
  const indy = await titles();

  await step('there is no city picker and no nationwide option', async () => {
    if (await p.$('#event-city')) throw new Error('#event-city still exists');
    const txt = await p.textContent('#screen-events');
    if (/all cities/i.test(txt)) throw new Error('"All cities" is still offered');
  });
  await step('the screen says which city it is showing', async () => {
    if (!/Indianapolis/.test(await label())) throw new Error('label is ' + JSON.stringify(await label()));
  });
  await step('the home city has meetups', async () => {
    if (!indy.length) throw new Error('Indianapolis showed nothing');
  });

  // ---- more than one city at a time ----
  let on = await tapCities('seattle');
  const both = await titles();
  await step('a second city can be selected alongside the first', async () => {
    if (on.sort().join(',') !== 'indianapolis,seattle') throw new Error('selected: ' + on.join(','));
  });
  await step('meetups from every selected city are shown', async () => {
    if (!(both.length > indy.length)) throw new Error(both.length + ' with two cities vs ' + indy.length + ' with one');
    const missing = indy.filter((t) => both.indexOf(t) === -1);
    if (missing.length) throw new Error('home city meetups went missing: ' + missing.join(', '));
    if (!/2 cities/.test(await label())) throw new Error('label is ' + JSON.stringify(await label()));
  });
  await step('with several cities, each meetup says which city it is in', async () => {
    const tags = await p.$$eval('#event-list .tag-city', els => els.map(e => e.textContent));
    if (tags.length !== both.length) throw new Error(tags.length + ' city tags for ' + both.length + ' meetups');
    if (!tags.some((t) => /Seattle/.test(t)) || !tags.some((t) => /Indianapolis/.test(t))) throw new Error(tags.join(' | '));
  });

  // ---- and still nothing from a city that is not selected ----
  on = await tapCities('indianapolis');   // drop the first city, leaving Seattle
  const sea = await titles();
  await step('dropping a city takes its meetups away', async () => {
    if (on.join(',') !== 'seattle') throw new Error('selected: ' + on.join(','));
    if (!sea.length) throw new Error('Seattle showed nothing');
    const shared = sea.filter((t) => indy.indexOf(t) !== -1);
    if (shared.length) throw new Error('still showing: ' + shared.join(', '));
    if (!/Seattle/.test(await label())) throw new Error('label is ' + JSON.stringify(await label()));
    if (await p.$('#event-list .tag-city')) throw new Error('city tags shown for a single city');
  });

  on = await tapCities('dallas', 'seattle');   // add Dallas, drop Seattle
  await step('a city with no meetups says so, names the city, and points nowhere else', async () => {
    if ((await titles()).length !== 0) throw new Error('Dallas should be empty');
    const msg = (await p.textContent('#event-list')).trim();
    if (!/Dallas/.test(msg)) throw new Error('city name missing from the message: ' + msg);
    if (/all cities|elsewhere/i.test(msg)) throw new Error('empty state still points at other cities: ' + msg);
  });

  on = await tapCities('dallas');   // try to drop the only city left
  await step('the last city cannot be dropped', async () => {
    if (on.join(',') !== 'dallas') throw new Error('selected: ' + JSON.stringify(on));
  });

  on = await tapCities('indianapolis', 'dallas');
  await step('going back to the original city restores its list exactly', async () => {
    const again = await titles();
    if (again.join('|') !== indy.join('|')) throw new Error(again.length + ' vs ' + indy.length);
  });

  // ---- places to play ----
  await step('a city with no court list shows no places section', async () => {
    if (await p.$('#places-list .place')) throw new Error('places shown for Indianapolis, which has no list');
  });
  on = await tapCities('bakersfield');
  await step('Bakersfield lists its places to play under the meetups', async () => {
    if (on.sort().join(',') !== 'bakersfield,indianapolis') throw new Error('selected: ' + on.join(','));
    const n = (await p.$$('#places-list .place')).length;
    if (n !== 13) throw new Error(n + ' places listed, expected 13');
    const head = (await p.textContent('#places-list [data-places-city="bakersfield"]')).trim();
    if (!/Bakersfield, CA/.test(head) || !/13 places/.test(head)) throw new Error('heading: ' + head);
  });
  await step('the Indoor and Outdoor filters split the list, and add up to all of it', async () => {
    await p.click('#places-list [data-filter="indoor"]');
    const indoor = await p.$$eval('#places-list .place', els => els.map(e => e.getAttribute('data-setting')));
    if (!indoor.length || indoor.some((x) => x === 'outdoor')) throw new Error('indoor filter shows: ' + indoor.join(','));
    await p.click('#places-list [data-filter="outdoor"]');
    const outdoor = await p.$$eval('#places-list .place', els => els.map(e => e.getAttribute('data-setting')));
    if (!outdoor.length || outdoor.some((x) => x === 'indoor')) throw new Error('outdoor filter shows: ' + outdoor.join(','));
    if (indoor.length + outdoor.length !== 13) throw new Error(indoor.length + ' indoor + ' + outdoor.length + ' outdoor');
    await p.click('#places-list [data-filter="all"]');
  });
  await step('every place says who can play there', async () => {
    const access = await p.$$eval('#places-list .place', els => els.map(e => e.getAttribute('data-access')));
    if (access.some((a) => ['public', 'paid', 'members'].indexOf(a) === -1)) throw new Error(access.join(','));
    if (access.indexOf('public') === -1) throw new Error('no free public court listed');
  });
  on = await tapCities('bakersfield');
  await step('dropping the city takes its places away', async () => {
    if (await p.$('#places-list .place')) throw new Error('places still listed');
  });

  // ---- tournaments and brackets ----
  await step('the three copies of the bracket rules are identical', async () => {
    const fs = require('fs'), path = require('path');
    const cut = (f) => {
      const t = fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
      return t.slice(t.indexOf('// BRACKET-LIB:START'), t.indexOf('// BRACKET-LIB:END')).split('\n').map((l) => l.trim()).join('\n');
    };
    const lib = cut('mobile/src/lib/bracket.js');
    if (lib.length < 500) throw new Error('bracket lib markers not found');
    for (const f of ['app/index.html', 'admin/index.html']) if (cut(f) !== lib) throw new Error(f + ' has drifted from mobile/src/lib/bracket.js');
  });
  const tcard = (id) => '#tournament-list [data-tourney="' + id + '"]';
  await step('a tournament under way shows its bracket, round by round', async () => {
    if (await p.$(tcard('t1'))) throw new Error('a Bakersfield tournament is shown to an Indianapolis member');
    await p.click(tcard('t2') + ' [data-t-act="toggle"]');
    const heads = await p.$$eval(tcard('t2') + ' .br-head', els => els.map(e => e.textContent));
    if (heads.join('|') !== 'Round of 16|Quarterfinals|Semifinals|Final') throw new Error('rounds: ' + heads.join('|'));
    const n = (await p.$$(tcard('t2') + ' .br-match')).length;
    if (n !== 15) throw new Error(n + ' matches in a bracket of 16');
  });
  on = await tapCities('bakersfield');
  await step('entering fills the last place: 24 of 24', async () => {
    const before = (await p.textContent(tcard('t1') + ' .t-status')).trim();
    if (!/23 of 24/.test(before)) throw new Error('before: ' + before);
    await p.click(tcard('t1') + ' [data-t-act="join"]');
    const after = (await p.textContent(tcard('t1') + ' .t-status')).trim();
    if (!/24 of 24/.test(after)) throw new Error('after: ' + after);
    if (await p.$(tcard('t1') + ' [data-t-act="join"]')) throw new Error('still offering Enter when entered');
  });
  await step('the draw builds a bracket of 32 with everyone placed once and 8 byes', async () => {
    await p.click(tcard('t1') + ' [data-t-act="draw"]');
    const info = await p.evaluate((sel) => {
      const card = document.querySelector(sel);
      const r1 = [...card.querySelectorAll('.br-match[data-round="1"]')];
      const names = r1.flatMap((m) => [...m.querySelectorAll('.br-player:not(.tbd) .nm')].map((e) => e.textContent.replace(/\s*✓/g, '').trim()));   // "(you)" stays, so a member who shares a sample player's name still counts once
      return {
        heads: [...card.querySelectorAll('.br-head')].map((e) => e.textContent).join('|'),
        matches: card.querySelectorAll('.br-match').length,
        r1: r1.length, placed: names.length, unique: new Set(names).size,
        byes: r1.filter((m) => /bye/.test(m.textContent)).length,
        me: !!card.querySelector('.br-match.mine'),
      };
    }, tcard('t1'));
    if (info.heads !== 'Round of 32|Round of 16|Quarterfinals|Semifinals|Final') throw new Error('rounds: ' + info.heads);
    if (info.matches !== 31 || info.r1 !== 16) throw new Error(JSON.stringify(info));
    if (info.placed !== 24 || info.unique !== 24) throw new Error('placed ' + info.placed + ', unique ' + info.unique);
    if (info.byes !== 8) throw new Error(info.byes + ' byes');
    if (!info.me) throw new Error('my own match is not marked');
  });
  await step('recording results fills the next round until there is a champion', async () => {
    for (let guard = 0; guard < 40; guard++) {
      const btn = await p.$(tcard('t1') + ' .br-won');
      if (!btn) break;
      await btn.click();
    }
    const status = (await p.textContent(tcard('t1') + ' .t-status')).trim();
    if (!/^Champion: \S/.test(status)) throw new Error('status: ' + status);
    if (await p.$(tcard('t1') + ' .br-player.tbd .nm:text("To be decided")')) throw new Error('an unfilled slot remains');
  });
  on = await tapCities('bakersfield');

  await finish(b, errs);
})();
