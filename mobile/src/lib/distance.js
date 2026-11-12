// How far away someone is, in words. The deck hands back whole miles between
// the centres of ~2.5-mile grid squares (migration 20260806000030): 1 means the
// same square, so it reads as "nearby" rather than as a precise mile, and null
// means another metro or over 100 miles — no distance shown at all.
//
// Pure functions; numeric strings (Postgres numerics can arrive as text) work.

function miles(mi) {
  if (mi == null || mi === '') return null;
  const n = Number(mi);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.round(n));
}

// Long form, for cards and sheets: "Nearby" / "About 12 miles away".
export function distanceLabel(mi) {
  const n = miles(mi);
  if (n == null) return null;
  return n <= 1 ? 'Nearby' : `About ${n} miles away`;
}

// Short form, after a middle dot in alerts and headers: "nearby" / "~12 mi".
export function distanceShort(mi) {
  const n = miles(mi);
  if (n == null) return null;
  return n <= 1 ? 'nearby' : `~${n} mi`;
}

// The "why you're seeing them" line, only for someone close (3 miles or less).
export function distanceReason(mi) {
  const n = miles(mi);
  if (n == null || n > 3) return null;
  return n <= 1 ? 'Plays nearby' : `About ${n} miles away`;
}
