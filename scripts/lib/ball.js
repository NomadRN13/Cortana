// Build the pickleball mark as SVG. One source of truth for the geometry so
// the preview, the wordmarks and the icon generator can't drift apart.
//
// The realism work is mostly two things:
//  - the holes are drilled into a SPHERE, so off-centre ones are seen at an
//    angle: they project to ellipses, squashed along the radius by cos(theta)
//    where sin(theta) = distance/radius. Seven equal circles read as a flat
//    disc with dots painted on it.
//  - a hole is a hole, not a black spot. You see through it to the far inner
//    wall, which catches the light, so the interior is dark on the side the
//    light comes from and lifts to olive on the far side. The drilled lip
//    picks up a bright chamfer on the lit side.
//
// Everything is expressed in the 24-unit box the wordmark uses (ball centred
// on 12,12 with r=11) and scaled by the callers.

const R = 11;          // ball radius
const RING = 6.2;      // how far the ring of holes sits from the centre
const HOLE = 1.75;     // hole radius, as drilled (i.e. face-on)
const ANGLES = [0, 60, 120, 180, 240, 300];

const rad = (deg) => (deg * Math.PI) / 180;

// A hole at projected distance d from the centre of a sphere of radius R is
// tilted away from us by theta, where sin(theta) = d/R. Its outline projects
// to an ellipse: full width across the tilt, cos(theta) along it.
function foreshorten(d) {
  const s = Math.min(d / R, 1);
  return Math.sqrt(1 - s * s);
}

function hole(cx, cy, angleDeg, d) {
  const squash = foreshorten(d);
  const rx = (HOLE * squash).toFixed(3); // along the radius — the tilted axis
  const ry = HOLE.toFixed(3);            // across it — unaffected
  const rot = angleDeg.toFixed(2);
  const t = d === 0 ? '' : ` transform="rotate(${rot} ${cx} ${cy})"`;
  // A gradient in objectBoundingBox units rotates with the shape it fills, so
  // a rotated hole would have its light coming from a different direction than
  // its neighbours. Each rotation gets a gradient pre-rotated the opposite way
  // so every hole is lit from the same place.
  const g = d === 0 ? '0' : String(angleDeg);
  return (
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${t} fill="url(#pb-hole-${g})"/>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${t} fill="none" stroke="url(#pb-lip-${g})" stroke-width=".26"/>`
  );
}

// A real ball shows a second ring out near the limb, and because those holes
// are seen almost edge-on they squash into slivers. They are the strongest
// sphere cue there is — far more convincing than shading alone.
const OUTER = 9.25;
const OUTER_ANGLES = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 0];

function holes(withCentre) {
  const out = [];
  if (withCentre) out.push(hole(12, 12, 0, 0));
  for (const a of ANGLES) {
    const cx = +(12 + RING * Math.cos(rad(a))).toFixed(3);
    const cy = +(12 + RING * Math.sin(rad(a))).toFixed(3);
    out.push(hole(cx, cy, a, RING));
  }
  for (const a of OUTER_ANGLES) {
    const cx = +(12 + OUTER * Math.cos(rad(a))).toFixed(3);
    const cy = +(12 + OUTER * Math.sin(rad(a))).toFixed(3);
    out.push(hole(cx, cy, a, OUTER));
  }
  return out.join('');
}

// Glossy moulded plastic: a broad sheen over the lit quadrant plus a small
// tight hot spot where the source actually reflects.
const SHEEN =
  '<ellipse cx="8.4" cy="7.6" rx="5.6" ry="4.3" fill="url(#pb-sheen)" transform="rotate(-30 8.4 7.6)"/>';
const HOTSPOT =
  '<ellipse cx="7.5" cy="6.6" rx="2.2" ry="1.5" fill="url(#pb-hot)" transform="rotate(-30 7.5 6.6)"/>';
// Light bouncing back into the shadow side keeps the far edge from going flat
// and black — without it the ball reads as a disc with a gradient on it.
const BOUNCE = '<circle cx="12" cy="12" r="11" fill="url(#pb-bounce)"/>';
// The terminator: a soft dark band just inside the unlit edge.
const TERM = '<circle cx="12" cy="12" r="11" fill="url(#pb-term)"/>';

// A hole's interior and its drilled lip, defined once and then emitted once
// per hole rotation with the rotation cancelled out (see hole()).
function holeGradients() {
  const out = [];
  for (const a of [...new Set([0, ...ANGLES, ...OUTER_ANGLES])]) {
    const gt = a === 0 ? '' : ` gradientTransform="rotate(${-a} .5 .5)"`;
    out.push(
      `<linearGradient id="pb-hole-${a}" x1="22%" y1="12%" x2="82%" y2="94%"${gt}>` +
        '<stop offset="0%" stop-color="#04060A"/><stop offset="54%" stop-color="#0F1507"/>' +
        '<stop offset="100%" stop-color="#44551A"/></linearGradient>',
      `<linearGradient id="pb-lip-${a}" x1="22%" y1="12%" x2="82%" y2="94%"${gt}>` +
        '<stop offset="0%" stop-color="#F7FFD2" stop-opacity=".45"/>' +
        '<stop offset="38%" stop-color="#F7FFD2" stop-opacity="0"/>' +
        '<stop offset="100%" stop-color="#1E2708" stop-opacity=".5"/></linearGradient>'
    );
  }
  return out.join('');
}

const DEFS = `
<radialGradient id="pb-body" cx="33%" cy="27%" r="80%">
  <stop offset="0%" stop-color="#F6FFB0"/><stop offset="20%" stop-color="#E7FB74"/>
  <stop offset="46%" stop-color="#D2F048"/><stop offset="72%" stop-color="#A9CE2F"/>
  <stop offset="90%" stop-color="#74911E"/><stop offset="100%" stop-color="#516A14"/>
</radialGradient>
<radialGradient id="pb-term" cx="70%" cy="74%" r="48%">
  <stop offset="0%" stop-color="#2E3C0C" stop-opacity=".3"/>
  <stop offset="70%" stop-color="#2E3C0C" stop-opacity=".1"/>
  <stop offset="100%" stop-color="#2E3C0C" stop-opacity="0"/>
</radialGradient>
<radialGradient id="pb-bounce" cx="78%" cy="82%" r="30%">
  <stop offset="0%" stop-color="#CFE85E" stop-opacity="0"/>
  <stop offset="78%" stop-color="#CFE85E" stop-opacity=".16"/>
  <stop offset="100%" stop-color="#DDF17E" stop-opacity=".34"/>
</radialGradient>
<radialGradient id="pb-sheen" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".4"/>
  <stop offset="55%" stop-color="#FFFFFF" stop-opacity=".12"/>
  <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
</radialGradient>
<radialGradient id="pb-hot" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".92"/>
  <stop offset="45%" stop-color="#FFFFFF" stop-opacity=".4"/>
  <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
</radialGradient>
<linearGradient id="pb-rim" x1="18%" y1="8%" x2="84%" y2="96%">
  <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".45"/>
  <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0"/>
  <stop offset="100%" stop-color="#FFFFFF" stop-opacity=".12"/>
</linearGradient>
${holeGradients()}`;

// The ball, drawn in the 24-unit box. Order matters: the sphere is shaded
// first, then the holes punch through it — a highlight drawn over a hole
// makes it look like a grey dot rather than a void.
function ball({ heart = false } = {}) {
  return [
    '<circle cx="12" cy="12" r="11" fill="url(#pb-body)"/>',
    TERM,
    BOUNCE,
    SHEEN,
    HOTSPOT,
    '<circle cx="12" cy="12" r="10.7" fill="none" stroke="url(#pb-rim)" stroke-width=".7"/>',
    heart ? heartPath() : '',
    holes(!heart),
  ].join('');
}

// Heart in the middle hole's place, for the app icon. Same treatment as a
// hole: it is a shape punched through the surface.
function heartPath() {
  const d =
    'M12 20.5S3.5 15 3.5 9.1C3.5 6.3 5.7 4 8.4 4c1.5 0 2.8.7 3.6 1.8C12.8 4.7 14.1 4 15.6 4c2.7 0 4.9 2.3 4.9 5.1 0 5.9-8.5 11.4-8.5 11.4z';
  const s = (5.6 / 17).toFixed(4);
  return (
    `<g transform="translate(12 12) scale(${s}) translate(-12 -12)">` +
    `<path d="${d}" fill="url(#pb-hole-0)"/>` +
    `<path d="${d}" fill="none" stroke="url(#pb-lip-0)" stroke-width="${(0.26 / s).toFixed(3)}"/></g>`
  );
}

module.exports = { DEFS, ball };
