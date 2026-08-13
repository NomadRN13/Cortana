// Regenerate the app icons and the website favicon.
//
//   node scripts/make-icons.js
//
// Needs playwright-core and a chromium (set CHROMIUM to override the path).
// The icons are committed, so you only need this to CHANGE the mark.
// Rendered from SVG in headless chromium so the mark matches the wordmark
// geometry exactly (24-unit circle, holes at r=6.2, ø3.5) and carries the
// same shading — lit from the upper left, holes dark at the top with a
// little bounce at the bottom, specular blob where the light lands.
const { chromium } = require('playwright-core');
const path = require('path');

const NIGHT = '#0A0B0D';
const OPTIC = '#D6F44F';
const CHALK = '#F4F6F0';
const DIM = '#6E7167';

// Gradients are in objectBoundingBox units, so one set of defs serves every
// ball size. These stops are the same ones the web wordmark uses.
const DEFS = `
<defs>
  <radialGradient id="pb-body" cx="34%" cy="28%" r="78%">
    <stop offset="0%" stop-color="#F4FDB4"/><stop offset="38%" stop-color="#DCF75F"/>
    <stop offset="72%" stop-color="#C2E23C"/><stop offset="100%" stop-color="#7E9A26"/>
  </radialGradient>
  <radialGradient id="pb-gloss" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".9"/>
    <stop offset="60%" stop-color="#FFFFFF" stop-opacity=".22"/>
    <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="pb-hole" cx="50%" cy="34%" r="72%">
    <stop offset="0%" stop-color="#05060A"/><stop offset="70%" stop-color="#161A0B"/>
    <stop offset="100%" stop-color="#46551A"/>
  </radialGradient>
  <linearGradient id="pb-rim" x1="20%" y1="10%" x2="80%" y2="95%">
    <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".45"/>
    <stop offset="45%" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="100%" stop-color="#3F4D14" stop-opacity=".75"/>
  </linearGradient>
</defs>`;

// Ring of holes around the middle; the heart takes the center position.
function holes(cx, cy, r, hr, skipCenter) {
  const out = [];
  if (!skipCenter) out.push(`<circle cx="${cx}" cy="${cy}" r="${hr}" fill="url(#pb-hole)"/>`);
  for (let a = 0; a < 360; a += 60) {
    const x = cx + r * Math.cos((a * Math.PI) / 180);
    const y = cy + r * Math.sin((a * Math.PI) / 180);
    out.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${hr}" fill="url(#pb-hole)"/>`);
  }
  return out.join('');
}

// The lit side of the sphere: a soft specular blob where the light lands, and
// a rim that brightens the near edge and darkens the far one. Both are placed
// from the 24-unit wordmark geometry, so they scale with the ball. Drawn
// before the holes — a hole is a void, so nothing shines off it.
function shading(cx, cy, R) {
  const u = R / 11; // wordmark units -> pixels
  return `
  <ellipse cx="${(cx - 3.9 * u).toFixed(2)}" cy="${(cy - 4.8 * u).toFixed(2)}"
           rx="${(4.4 * u).toFixed(2)}" ry="${(3.3 * u).toFixed(2)}" fill="url(#pb-gloss)"
           transform="rotate(-28 ${(cx - 3.9 * u).toFixed(2)} ${(cy - 4.8 * u).toFixed(2)})"/>
  <circle cx="${cx}" cy="${cy}" r="${(R - 0.65 * u).toFixed(2)}" fill="none"
          stroke="url(#pb-rim)" stroke-width="${(1.3 * u).toFixed(2)}"/>`;
}

// Heart, drawn in a 24-unit box centered on (12,12). The path spans ~17
// units wide, so scale = desiredWidth / 17 — sized to leave clear air
// between the heart and the ring of holes. Filled like a hole: it is a void
// punched through the surface, so it takes the same light.
function heart(cx, cy, scale) {
  const d = 'M12 20.5S3.5 15 3.5 9.1C3.5 6.3 5.7 4 8.4 4c1.5 0 2.8.7 3.6 1.8C12.8 4.7 14.1 4 15.6 4c2.7 0 4.9 2.3 4.9 5.1 0 5.9-8.5 11.4-8.5 11.4z';
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)"><path d="${d}" fill="url(#pb-hole)"/></g>`;
}

// ---- icon.png / adaptive-icon.png: ball + heart, 1024x1024 -----------------
// The Android adaptive icon gets a smaller ball: the launcher masks the outer
// ~25%, so anything near the edge is cropped on some devices.
function ballIcon(ballRadius, box = 1024) {
  const C = box / 2;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">
  ${DEFS}
  <rect width="${box}" height="${box}" fill="${NIGHT}"/>
  <circle cx="${C}" cy="${C}" r="${ballRadius}" fill="url(#pb-body)"/>
  ${shading(C, C, ballRadius)}
  ${holes(C, C, ballRadius * (6.2 / 11), ballRadius * (1.75 / 11), true)}
  ${heart(C, C, (ballRadius * 0.55) / 17)}
</svg>`;
}

// ---- splash-icon.png: the wordmark, 1200x400 ------------------------------
// Positions are measured from the rendered text rather than guessed, so the
// ball sits tight in place of the "o" instead of floating in a gap.
function splashSvg(leftX, ballCx, veX) {
  const ballR = 39;
  const cy = 172;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  ${DEFS}
  <rect width="1200" height="400" fill="${NIGHT}"/>
  <text id="left" x="${leftX}" y="205" font-family="Helvetica, Arial, sans-serif" font-size="128" font-weight="bold" fill="${CHALK}">40/L</text>
  <circle cx="${ballCx}" cy="${cy}" r="${ballR}" fill="url(#pb-body)"/>
  ${shading(ballCx, cy, ballR)}
  ${holes(ballCx, cy, ballR * (6.2 / 11), ballR * (1.75 / 11), false)}
  <text id="right" x="${veX}" y="205" font-family="Helvetica, Arial, sans-serif" font-size="128" font-weight="bold" fill="${CHALK}">ve</text>
  <text x="600" y="285" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="bold" letter-spacing="7" fill="${DIM}">SERVE. RALLY. CONNECT.</text>
</svg>`;
}

async function splash(page) {
  const BALL_R = 39;
  const GAP = 3; // the ball is the letter, so it hugs its neighbours
  // measure once at an arbitrary origin
  await page.setContent(`<style>html,body{margin:0;background:${NIGHT}}</style>` + splashSvg(0, 200, 400));
  const m = await page.evaluate(() => {
    const l = document.getElementById('left').getBBox();
    const r = document.getElementById('right').getBBox();
    return { leftW: l.width, rightW: r.width };
  });
  // lay the three pieces out centred on x=600
  const total = m.leftW + GAP + BALL_R * 2 + GAP + m.rightW;
  const startX = 600 - total / 2;
  const ballCx = startX + m.leftW + GAP + BALL_R;
  const veX = ballCx + BALL_R + GAP;
  return splashSvg(startX, ballCx, veX);
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
    ['icon.png', ballIcon(238), 1024, 1024],
    ['adaptive-icon.png', ballIcon(190), 1024, 1024],
    ['splash-icon.png', splashMarkup, 1200, 400],
    // The website's favicon. Rendered small rather than shipping the 1024px
    // store icon to every page load — the shaded ball no longer compresses
    // the way the old flat art did. Nearly edge-to-edge: it is displayed at
    // 16px, where the store icon's generous margin would leave a speck.
    ['favicon.png', ballIcon(90, 192), 192, 192],
  ];
  for (const [name, svg, w, h] of jobs) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:${NIGHT}}svg{display:block}</style>${svg}`
    );
    await page.screenshot({ path: out + name, omitBackground: false });
    await page.close();
    console.log('wrote', name, `${w}x${h}`);
  }
  await browser.close();
})();
