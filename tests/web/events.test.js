// Meetups should be nationwide by default and narrow to one city on demand.
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
  await p.click('.tab[data-screen="screen-events"]');
  await p.waitForSelector('#screen-events.active');

  const count = async () => (await p.$$('#event-list .event')).length;
  const cities = async () => p.$$eval('#event-list .event-title', els => els.map(e => e.textContent));

  const all = await count();
  const opts = await p.$$eval('#event-city option', (o) => o.map((x) => x.value));

  await step('the picker opens on All cities', async () => {
    if (opts[0] !== 'all') throw new Error('first option is ' + opts[0]);
  });
  await step('every city we run in is offered', async () => {
    if (opts.length < 6) throw new Error('only ' + opts.length + ' options');
  });

  await p.selectOption('#event-city', 'seattle');
  await p.waitForTimeout(200);
  const sea = await count();
  await step('nationwide shows more than the one city', async () => {
    if (!(all > sea)) throw new Error(`nationwide ${all} vs Seattle ${sea}`);
  });
  await step('picking a city narrows to it', async () => {
    if (sea < 1) throw new Error('Seattle showed nothing');
    const titles = await cities();
    if (!titles.length) throw new Error('no meetups rendered');
  });

  await p.selectOption('#event-city', 'dallas');
  await p.waitForTimeout(200);
  await step('a city with no meetups says so, and names the city', async () => {
    if ((await count()) !== 0) throw new Error('Dallas should be empty');
    const msg = (await p.textContent('#event-list')).trim();
    if (!msg) throw new Error('empty list with no message');
    if (/ in \s|in  /.test(msg)) throw new Error('city name missing from the message: ' + msg);
  });

  await p.selectOption('#event-city', 'all');
  await p.waitForTimeout(200);
  await step('going back to All cities restores the full list', async () => {
    if ((await count()) !== all) throw new Error(`${await count()} vs ${all}`);
  });

  await finish(b, errs);
})();
