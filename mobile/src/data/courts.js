// Places to play, city by city — the copy BUNDLED with the app.
//
// This is not the source of truth. The live list is the public.courts table
// (supabase/migrations/20260806000026_courts.sql), which the founder edits from
// the moderation desk at /admin → Places, so a new court reaches members
// without an app release. This file is what the demo build shows, and what a
// live build falls back to when it can't reach the database.
//
// It starts out identical to the rows that migration inserts, and to the
// COURTS_BY_CITY block of app/index.html. When a venue is added on the desk,
// nothing here has to change; refresh this file at the next release so the
// offline fallback doesn't drift too far.
//
// Every entry here was checked against at least one source that says pickleball
// is playable there today (researched November 2026). What the sources did NOT
// agree on is left out rather than guessed:
//   courts: null  → a court count we couldn't pin down
//   lights: null  → nobody reliable says either way
// `access` is who can walk on:
//   'public'  — free public park, first come first served
//   'paid'    — open to anyone, but you pay (drop-in, punch card or court rental)
//   'members' — members or residents only; listed so a member knows it exists
//
// Deliberately not listed (as of November 2026): PickleRage Bakersfield, an
// indoor club that has been announced but is not open; Dr. Martin Luther King
// Jr. Park, where pickleball is in the renovation plans but not built; and
// several parks that directories list but no reliable source confirms
// (Fruitvale Norris, Silver Oak, Westdale, Silver Creek, Mesa Marin).
export const COURTS_BY_CITY = {
  bakersfield: [
    { name: 'Greenacres Park PicklePlex', address: '2014 Calloway Dr', setting: 'outdoor', courts: 8, lights: true, access: 'public', note: 'Bakersfield’s biggest public complex — eight dedicated courts at Greenacres Community Center & Park. Open 6am–10pm.' },
    { name: 'Jastro Park', address: '2900 Truxtun Ave', setting: 'outdoor', courts: 6, lights: true, access: 'public', note: 'Six dedicated courts downtown, beside the tennis courts. First come, first served.' },
    { name: 'Stockdale River Ranch Community Park', address: '16303 Stockdale Ranch Dr', setting: 'outdoor', courts: 4, lights: null, access: 'public', note: 'The newest park in town (opened November 2025), far southwest.' },
    { name: 'Haggin Oaks Park', address: '9200 McInnes Blvd', setting: 'outdoor', courts: 3, lights: true, access: 'public', note: 'Three courts in southwest Bakersfield; lights run on a timer.' },
    { name: 'Campus Park South', address: '4445 Pin Oak Park Blvd', setting: 'outdoor', courts: 3, lights: true, access: 'public', note: 'Three dedicated courts in the southwest.' },
    { name: 'Beale Park', address: '500 Oleander Ave', setting: 'outdoor', courts: null, lights: null, access: 'public', note: 'Free play in the Oleander neighborhood. Go in daylight — reports on the lights disagree.' },
    { name: 'Farm Park (Gossamer Grove)', address: 'Parkdale Way, Shafter', setting: 'outdoor', courts: null, lights: null, access: 'public', note: 'Small neighborhood park in Shafter, northwest of town.' },
    { name: 'Dignity Health Sports Complex — GSA Pickleball', address: '3101 Gilmore Ave, Suite 100', setting: 'indoor', courts: null, lights: true, access: 'paid', note: 'Indoor, air-conditioned play on multi-sport courts. Open play three days a week, plus memberships, punch cards and court rentals — call ahead for the schedule.' },
    { name: 'Sportsplex Bakersfield', address: '6825 Ming Ave', setting: 'outdoor', courts: 4, lights: null, access: 'paid', note: 'Pay-to-play complex with weekly drop-in open play, leagues, clinics and court rentals you book online.' },
    { name: 'Bakersfield Racquet Club', address: '1660 Pine St', setting: 'outdoor', courts: 4, lights: true, access: 'members', note: 'Private member-owned club downtown. Membership required; guests come with a member.' },
    { name: 'Seven Oaks Country Club', address: '2000 Grand Lakes Ave', setting: 'outdoor', courts: 4, lights: true, access: 'members', note: 'Private country club — four dedicated courts with LED lights. Members and their guests.' },
    { name: 'Stockdale Country Club', address: '7001 Stockdale Hwy', setting: 'outdoor', courts: 4, lights: null, access: 'members', note: 'Private country club. Members and their guests.' },
    { name: 'Highgate at Seven Oaks', address: '2200 Highbury St', setting: 'outdoor', courts: 2, lights: true, access: 'members', note: 'Courts inside a gated community — residents and their guests only.' },
  ],
};

export const ACCESS_LABELS = { public: 'Free · public', paid: 'Pay to play', members: 'Members only' };

export function courtsFor(citySlug) {
  return COURTS_BY_CITY[citySlug] || [];
}

// A court worth proposing to someone you have just matched with: somewhere
// both of you can simply turn up. Null when we have no list for the city.
export function suggestedCourt(citySlug) {
  const open = courtsFor(citySlug).filter((c) => c.access === 'public');
  return open.length ? open[0].name : null;
}
