// The cities 40/Love is open in. Mirrors public.cities in
// supabase/migrations/20260806000014_cities.sql — keep the two in step; the
// database is the authority and its foreign key will reject anything here
// that doesn't exist there.
//
// Coordinates are city centers and metroRadius is how far the metro
// reasonably reaches, which is how a new member gets placed automatically.
export const CITIES = [
  { slug: 'indianapolis',  name: 'Indianapolis', state: 'IN', lat: 39.768, lng: -86.158, metroRadius: 40 },
  { slug: 'los-angeles',   name: 'Los Angeles',  state: 'CA', lat: 34.052, lng: -118.244, metroRadius: 60 },
  { slug: 'san-diego',     name: 'San Diego',    state: 'CA', lat: 32.716, lng: -117.161, metroRadius: 40 },
  { slug: 'phoenix',       name: 'Phoenix',      state: 'AZ', lat: 33.448, lng: -112.074, metroRadius: 50 },
  { slug: 'seattle',       name: 'Seattle',      state: 'WA', lat: 47.606, lng: -122.332, metroRadius: 40 },
  { slug: 'spokane',       name: 'Spokane',      state: 'WA', lat: 47.659, lng: -117.426, metroRadius: 35 },
  { slug: 'dallas',        name: 'Dallas',       state: 'TX', lat: 32.777, lng: -96.797, metroRadius: 50 },
  { slug: 'houston',       name: 'Houston',      state: 'TX', lat: 29.760, lng: -95.370, metroRadius: 50 },
  { slug: 'orlando',       name: 'Orlando',      state: 'FL', lat: 28.538, lng: -81.379, metroRadius: 40 },
  { slug: 'miami',         name: 'Miami',        state: 'FL', lat: 25.762, lng: -80.192, metroRadius: 45 },
  { slug: 'washington-dc', name: 'Washington',   state: 'DC', lat: 38.907, lng: -77.037, metroRadius: 40 },
];

export const DEFAULT_CITY = 'indianapolis';

export function cityBySlug(slug) {
  return CITIES.find((c) => c.slug === slug) || null;
}

export function cityLabel(slug) {
  const c = cityBySlug(slug);
  return c ? `${c.name}, ${c.state}` : '';
}

// Great-circle miles, same formula as the database's miles_between().
function milesBetween(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 7917.5 * Math.asin(Math.min(1, Math.sqrt(a))) / 2;
}

// Nearest city whose metro actually reaches this point, or null — null means
// "we're not open where you are yet", which the app says out loud rather than
// quietly dropping someone into the wrong city.
export function nearestCity(lat, lng) {
  if (lat == null || lng == null) return null;
  let best = null;
  let bestDist = Infinity;
  CITIES.forEach((c) => {
    const d = milesBetween(lat, lng, c.lat, c.lng);
    if (d <= c.metroRadius && d < bestDist) { best = c; bestDist = d; }
  });
  return best ? best.slug : null;
}
