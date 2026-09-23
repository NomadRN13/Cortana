// What a link to 40/LOVE looks like when someone pastes it into a message.
// Facebook, LinkedIn and iMessage don't resolve a relative og:image, so a site
// built without an absolute one has no preview card anywhere — and the failure
// is invisible until someone shares a link and gets a grey box.
//
// This reads the built site rather than driving a browser: scrapers aren't
// browsers, and what they see is the markup.
const fs = require('fs');
const path = require('path');
const { step, finish, REPO } = require('./lib/harness');

const SITE = path.join(REPO, 'site');
const PAGES = ['index.html', 'demo/index.html'];

(async () => {
  await step('the site has been built', async () => {
    if (!fs.existsSync(SITE)) throw new Error('no site/ — run scripts/build-site.sh');
  });

  for (const rel of PAGES) {
    const html = fs.readFileSync(path.join(SITE, rel), 'utf8');
    const tags = [...html.matchAll(/<meta (?:property|name)="(og:image|twitter:image)" content="([^"]*)"/g)];

    await step(`${rel}: has both preview images`, async () => {
      const names = tags.map((m) => m[1]);
      if (!names.includes('og:image')) throw new Error('no og:image');
      if (!names.includes('twitter:image')) throw new Error('no twitter:image');
    });

    await step(`${rel}: preview images are absolute URLs`, async () => {
      const relative = tags.filter((m) => !/^https?:\/\//.test(m[2]));
      if (relative.length) throw new Error(relative.map((m) => `${m[1]}=${m[2]}`).join(', '));
    });

    await step(`${rel}: the image it points at exists in the build`, async () => {
      const url = tags[0][2];
      const file = path.join(SITE, new URL(url).pathname.replace(/^\/+/, ''));
      if (!fs.existsSync(file)) throw new Error(url + ' → no ' + path.relative(SITE, file));
    });

    await step(`${rel}: says what it is and where`, async () => {
      for (const tag of ['og:title', 'og:description', 'twitter:card']) {
        if (!html.includes(`"${tag}"`)) throw new Error('missing ' + tag);
      }
    });
  }

  // Play rejects a submission whose account-deletion or privacy URL 404s, and
  // these live in a markdown file nobody rebuilds. Check every site URL the
  // launch docs hand a reviewer actually resolves to a page in the build.
  const DOCS = ['outreach/launch/store-listing.md', 'docs/google-play.md', 'docs/launch-runbook.html'];
  const SITE_ORIGIN = 'https://40-love.netlify.app';
  const claimed = new Map();
  for (const doc of DOCS) {
    const text = fs.readFileSync(path.join(REPO, doc), 'utf8');
    for (const m of text.matchAll(/https:\/\/40-?love[a-z0-9.-]*\.(?:netlify\.app|app)(\/[a-z0-9/-]*)?/gi)) {
      if (!claimed.has(m[0])) claimed.set(m[0], doc);
    }
  }

  await step('the launch docs name at least the two URLs Play asks for', async () => {
    const urls = [...claimed.keys()].join(' ');
    if (!urls.includes('/delete-account/')) throw new Error('no account-deletion URL is documented');
    if (!urls.includes('/privacy/')) throw new Error('no privacy-policy URL is documented');
  });

  for (const [url, doc] of claimed) {
    await step(`${url} (${path.basename(doc)}) is a page that exists`, async () => {
      if (!url.startsWith(SITE_ORIGIN)) {
        throw new Error('points at a domain we do not own — the build is served from ' + SITE_ORIGIN);
      }
      const rel = new URL(url).pathname.replace(/^\/+/, '');
      const target = rel === '' ? 'index.html' : (rel.endsWith('/') || !path.extname(rel) ? path.join(rel, 'index.html') : rel);
      if (!fs.existsSync(path.join(SITE, target))) throw new Error('no site/' + target);
    });
  }

  await step('the moderation desk stays out of search results', async () => {
    const robots = fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8');
    if (!/Disallow:\s*\/admin\//.test(robots)) throw new Error('admin is not disallowed');
  });

  await finish(null, null);
})();
