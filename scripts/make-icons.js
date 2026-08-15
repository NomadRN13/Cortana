// Regenerate the app icons, the website favicon, and the ball the phone app
// draws in its wordmark.
//
//   node scripts/make-icons.js
//
// Needs playwright-core and a chromium (set CHROMIUM to override the path).
// The outputs are committed, so you only need this to CHANGE the mark — and
// the mark itself lives in scripts/lib/ball.js, shared with scripts/sync-mark.js
// so the app and the website can't drift apart.

const { chromium } = require('playwright-core');
const path = require('path');
const { DEFS, ball } = require('./lib/ball');

const NIGHT = '#0A0B0D';
const CHALK = '#F4F6F0';
const DIM = '#6E7167';
const OPTIC = '#D6F44F';

const defs = `<defs>${DEFS}</defs>`;

// The ball drawn into a box of the given size, centred, at the given radius.
// The mark is authored in a 24-unit box with the ball at r=11, so it scales
// as a group rather than needing every coordinate recomputed.
function mark(box, ballRadius, opts) {
  const s = (ballRadius / 11) * (24 / 24);
  const off = box / 2 - 12 * s;
  return `<g transform="translate(${off} ${off}) scale(${s})">${ball(opts)}</g>`;
}

// ---- icon.png / adaptive-icon.png ----------------------------------------
// The Android adaptive icon gets a smaller ball: the launcher masks the outer
// ~25%, so anything near the edge is cropped on some devices.
function ballIcon(ballRadius, box = 1024) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">
  ${defs}
  <rect width="${box}" height="${box}" fill="${NIGHT}"/>
  ${mark(box, ballRadius, { heart: true })}
</svg>`;
}

// ---- ball.png: what the phone app puts in its wordmark ---------------------
// Transparent, no heart — this is the letter O, not the app icon. Rendered
// rather than rebuilt out of Views so it matches the website exactly.
function ballAsset(box = 256) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">
  ${defs}
  ${mark(box, box / 2 - 1, {})}
</svg>`;
}

// ---- og.png: the card shown when a link is shared -------------------------
// 1200x630 is the size every platform crops from. Text sits well inside the
// safe area because Twitter, iMessage and Slack all crop the edges differently.
function ogCard() {
  const cx = 600, cy = 250, r = 62;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${defs}
  <rect width="1200" height="630" fill="${NIGHT}"/>
  <radialGradient id="og-glow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${OPTIC}" stop-opacity=".13"/>
    <stop offset="100%" stop-color="${OPTIC}" stop-opacity="0"/>
  </radialGradient>
  <circle cx="1080" cy="70" r="420" fill="url(#og-glow)"/>
  <text x="600" y="132" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="26" font-weight="bold" letter-spacing="8" fill="${OPTIC}">SERVE. RALLY. CONNECT.</text>
  <text id="ogL" x="0" y="290" font-family="Helvetica, Arial, sans-serif" font-size="150" font-weight="bold" fill="${CHALK}">40/L</text>
  <g id="ogBall" transform="translate(0 0)"></g>
  <text id="ogR" x="0" y="290" font-family="Helvetica, Arial, sans-serif" font-size="150" font-weight="bold" fill="${CHALK}">VE</text>
  <text x="600" y="392" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="34" fill="${CHALK}" opacity=".72">The dating app for racquet sports people.</text>
  <text x="600" y="446" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="34" fill="${CHALK}" opacity=".72">The first date is a game, not dinner.</text>
  <g font-family="Helvetica, Arial, sans-serif" font-size="25" font-weight="bold" fill="${OPTIC}" text-anchor="middle">
    <text x="330" y="545">DATE</text><text x="600" y="545">PLAY</text><text x="870" y="545">FRIENDS</text>
  </g>
  <rect x="150" y="500" width="900" height="2" fill="${CHALK}" opacity=".14"/>
</svg>`;
}

// The wordmark is laid out from the measured text, same as the splash, so the
// ball lands in the O rather than near it.
async function ogMeasured(page) {
  const R = 62, GAP = 4;
  await page.setContent(`<style>html,body{margin:0}</style>` + ogCard());
  const m = await page.evaluate(() => ({
    l: document.getElementById('ogL').getBBox().width,
    r: document.getElementById('ogR').getBBox().width,
  }));
  const total = m.l + GAP + R * 2 + GAP + m.r;
  const startX = 600 - total / 2;
  const ballCx = startX + m.l + GAP + R;
  return ogCard()
    .replace('id="ogL" x="0"', `id="ogL" x="${startX}"`)
    .replace('id="ogR" x="0"', `id="ogR" x="${ballCx + R + GAP}"`)
    .replace('<g id="ogBall" transform="translate(0 0)"></g>',
      `<g transform="translate(${ballCx - R} ${250 - R}) scale(${R / 12})">${ball()}</g>`);
}

// ---- splash-icon.png: the wordmark, 1200x400 ------------------------------
// Positions are measured from the rendered text rather than guessed, so the
// ball sits tight in place of the O instead of floating in a gap.
// Matches the wordmark's 1.04em ball against the 128px type below.
const BALL_R = 49;
const CY = 172;

function splashSvg(leftX, ballCx, veX) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  ${defs}
  <rect width="1200" height="400" fill="${NIGHT}"/>
  <text id="left" x="${leftX}" y="205" font-family="Helvetica, Arial, sans-serif" font-size="128" font-weight="bold" fill="${CHALK}">40/L</text>
  <g transform="translate(${ballCx - BALL_R} ${CY - BALL_R}) scale(${BALL_R / 12})">${ball()}</g>
  <text id="right" x="${veX}" y="205" font-family="Helvetica, Arial, sans-serif" font-size="128" font-weight="bold" fill="${CHALK}">VE</text>
  <text x="600" y="285" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="bold" letter-spacing="7" fill="${DIM}">SERVE. RALLY. CONNECT.</text>
</svg>`;
}

async function splash(page) {
  const GAP = 3; // the ball is the letter, so it hugs its neighbours
  await page.setContent(`<style>html,body{margin:0;background:${NIGHT}}</style>` + splashSvg(0, 200, 400));
  const m = await page.evaluate(() => ({
    leftW: document.getElementById('left').getBBox().width,
    rightW: document.getElementById('right').getBBox().width,
  }));
  const total = m.leftW + GAP + BALL_R * 2 + GAP + m.rightW;
  const startX = 600 - total / 2;
  const ballCx = startX + m.leftW + GAP + BALL_R;
  return splashSvg(startX, ballCx, ballCx + BALL_R + GAP);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const out = path.join(__dirname, '..', 'mobile', 'assets') + path.sep;
  const measurePage = await browser.newPage({ viewport: { width: 1200, height: 400 } });
  const splashMarkup = await splash(measurePage);
  const ogMarkup = await ogMeasured(measurePage);
  await measurePage.close();

  const jobs = [
    ['icon.png', ballIcon(238), 1024, 1024, false],
    ['adaptive-icon.png', ballIcon(190), 1024, 1024, false],
    ['splash-icon.png', splashMarkup, 1200, 400, false],
    // Rendered small rather than shipping the 1024px store icon to every page
    // load, and nearly edge-to-edge: it is displayed at 16px, where the store
    // icon's generous margin would leave a speck.
    ['favicon.png', ballIcon(90, 192), 192, 192, false],
    ['ball.png', ballAsset(256), 256, 256, true],
    // Shared-link preview card; scripts/build-site.sh copies it to site/og.png.
    ['og.png', ogMarkup, 1200, 630, false],
  ];

  for (const [name, svg, w, h, transparent] of jobs) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:${transparent ? 'transparent' : NIGHT}}svg{display:block}</style>${svg}`
    );
    await page.screenshot({ path: out + name, omitBackground: transparent });
    await page.close();
    console.log('wrote', name, `${w}x${h}`);
  }
  await browser.close();
})();
