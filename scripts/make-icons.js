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

// ---- splash-icon.png: the wordmark, 1200x400 ------------------------------
// Positions are measured from the rendered text rather than guessed, so the
// ball sits tight in place of the O instead of floating in a gap.
const BALL_R = 39;
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
