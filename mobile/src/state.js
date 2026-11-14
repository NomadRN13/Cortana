// App-wide state, dual-mode:
//  - DEMO: no backend configured (or not signed in) → seeded local data.
//  - LIVE: Supabase configured + session → every action reads/writes the
//    real backend (schema in supabase/migrations/, client in src/api/backend.js).
// Screens call the same actions in both modes.
// This revision addresses the QA findings in outreach/launch/bugs.md
// (B-01…B-17); fixes are tagged inline.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
// The cached profile, saved list and settings are about the member, so they go
// in the phone's encrypted store, not plain storage (lib/secureStorage.js).
import storage from './lib/secureStorage';
import { PROFILES, THREADS, CANNED_REPLIES, NOTIFICATIONS, EVENTS, TOURNAMENTS, TOURNAMENT_PLAYERS, LEAGUES, DEMO_DATE_MODE_ON } from './data/seed';
import { buildBracket, bracketRecord, bracketShuffle } from './lib/bracket';
import { ladderJoin, ladderLeave, ladderChallengeProblem, ladderRecord, LADDER_REACH } from './lib/ladder';
import { supabase, isBackendConfigured } from './lib/supabase';
import * as api from './api/backend';
import * as social from './lib/socialAuth';
import { CITIES, DEFAULT_CITY, cityBySlug, cityLabel, nearestCity } from './data/cities';
import { COURTS_BY_CITY } from './data/courts';
import { getDeviceKey, getDeviceName, getPlatform, getDeviceTimezone } from './lib/device';
import { registerForPush } from './lib/push';
import { getCoarseLocation } from './lib/location';
import { distanceReason } from './lib/distance';

const STORE_KEY = 'rsvplay.profile';
const SAVED_KEY = 'rsvplay.saved';
// Discovery prefs used to live only in memory, so a member set their age
// range and distance, reopened the app, and found the defaults again.
const PREFS_KEY = 'rsvplay.prefs';
const DEFAULT_PREFS = { radius: 15, ageMin: 25, ageMax: 55, mySportsOnly: false };
const AppState = createContext(null);

// Every city a member plays in, home city first. A profile always has a home
// city (`city`); `cities` is the full list when they have picked more than
// one. Unknown slugs and repeats are dropped, and it is never empty.
export function citiesOf(u) {
  const raw = u && Array.isArray(u.cities) && u.cities.length ? u.cities : [(u && u.city) || DEFAULT_CITY];
  const list = raw.filter((c, i) => !!cityBySlug(c) && raw.indexOf(c) === i);
  return list.length ? list : [DEFAULT_CITY];
}

// B-10: compare calendar parts directly — no UTC/local drift.
export function ageFromBirthdate(birthdate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthdate));
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function fmtWhen(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function mapDeckRow(row) {
  const sports = Array.isArray(row.sports) ? row.sports : [];
  return {
    id: row.user_id,
    name: row.first_name,
    age: row.age,
    dist: row.distance_mi != null ? Number(row.distance_mi) : null,
    sports: sports.map((s) => cap(s.sport)),
    skill: sports[0] ? cap(sports[0].level) : 'Intermediate',
    rating: sports[0] && sports[0].rating ? sports[0].rating : '',
    isNew: !!row.is_new,
    verified: !!row.verified,
    avail: row.availability_note || '',
    bio: row.bio || '',
    isTeam: !!row.is_team,
    partnerName: row.partner_name || '',
    partnerAge: row.partner_age != null ? row.partner_age : null,
    gender: row.gender || null,
    partnerGender: row.is_team ? (row.partner_gender || null) : null,
    // Absent → undefined, which the card reads as "plays every format".
    playGames: Array.isArray(row.play_games) && row.play_games.length ? row.play_games : undefined,
  };
}

// Cards from get_profile_cards arrive with an age already worked out, because
// other members' birthdates are not readable — the server does the arithmetic
// and hands back only the result. Falls back to computing it for a row that
// still carries a birthdate, which is only ever your own.
function mapProfileRow(p) {
  const sports = p.user_sports || [];
  return {
    id: p.id,
    name: p.first_name,
    age: p.age != null ? p.age : ageFromBirthdate(p.birthdate),
    dist: null,
    sports: sports.map((s) => cap(s.sport)),
    skill: sports[0] ? cap(sports[0].level) : 'Intermediate',
    rating: sports[0] ? sports[0].rating_label : '',
    isNew: false,
    // Cards carry a verified flag; your own row still has the timestamp.
    verified: !!(p.verified || p.verified_at),
    avail: p.availability_note || '',
    bio: p.bio || '',
    gender: p.gender || null,
    isTeam: !!p.is_team,
    partnerName: p.partner_name || '',
    partnerGender: p.is_team ? (p.partner_gender || null) : null,
    partnerAge: p.is_team ? (p.partner_age != null ? p.partner_age : ageFromBirthdate(p.partner_birthdate)) : null,
    playGames: Array.isArray(p.play_games) && p.play_games.length ? p.play_games : undefined,
  };
}

// A row of public.courts, in the shape the bundled list in data/courts.js uses,
// so the screen draws either without knowing which it was given.
function mapCourtRow(row) {
  return {
    id: row.id,
    city: row.city,
    name: row.name,
    address: row.address || '',
    sport: row.sport || 'pickleball',
    setting: row.setting,
    access: row.access,
    courts: row.courts != null ? row.courts : null,
    lights: row.lights === true ? true : row.lights === false ? false : null,
    note: row.note || '',
  };
}

// A tournament row from the database, in the one shape the screen draws —
// the same shape the demo tournaments are built in.
function mapTournamentRow(row, myId) {
  const d = new Date(row.starts_at);
  const entries = (row.tournament_entries || []).map((e) => ({ id: e.user_id, seed: e.seed }));
  entries.sort((x, y) => (x.seed || 99) - (y.seed || 99));
  const matches = (row.tournament_matches || []).map((m) => ({
    id: m.id, round: m.round, slot: m.slot, a: m.player_a, b: m.player_b,
    winner: m.winner, score: m.score || '', bye: !!m.is_bye,
    // Played even when the winner has since deleted their account and left
    // `winner` empty.
    reported: !!m.reported_at,
  }));
  matches.sort((x, y) => (x.round - y.round) || (x.slot - y.slot));
  const size = row.bracket_size || 0;
  let rounds = 0;
  while (size && (1 << rounds) < size) rounds += 1;
  return {
    id: row.id,
    city: row.city,
    title: row.title,
    venue: row.venue || '',
    sport: cap(row.sport),
    level: row.level_range,
    when: `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
    max: row.max_entries,
    status: row.status,
    size,
    rounds,
    championId: row.champion_id || null,
    completedAt: row.completed_at || null,
    entries,
    // The true count, kept by the database. The entry list leaves out anyone
    // the member has a block with, so its length can't say how full it is.
    entryCount: typeof row.entry_count === 'number' ? row.entry_count : entries.length,
    matches,
    entered: entries.some((e) => e.id === myId),
  };
}

// The demo tournaments, built once: sample players entered, and for one that
// is under way, a real bracket with its first few results played.
function buildDemoTournaments() {
  return TOURNAMENTS.map((t) => {
    const entries = TOURNAMENT_PLAYERS.slice(0, t.entrants).map((pl, i) => ({ id: pl.id, seed: t.status === 'registration' ? null : i + 1 }));
    const base = {
      id: t.id, city: t.city, title: t.title, venue: t.venue, sport: t.sport, level: t.level, when: t.when,
      max: t.max, status: t.status, size: 0, rounds: 0, championId: null, completedAt: null,
      entries, entryCount: entries.length, matches: [], entered: false,
    };
    if (t.status === 'registration') return base;
    const br = buildBracket(entries.map((e) => e.id));
    let left = t.played;
    br.matches.forEach((m) => {
      if (left > 0 && !m.bye && m.round === 1) { bracketRecord(br, m.id, m.a, '11-8, 11-6'); left -= 1; }
    });
    return { ...base, size: br.size, rounds: br.rounds, matches: br.matches };
  });
}

// A row of get_my_crew — someone who checked in to the same event as the
// member. `alsoOpenToDating` is the server's answer, copied and nothing more:
// it is true only when the server said true. The app never works it out from
// modes, genders or anything else it happens to know.
function mapCrewRow(row) {
  const d = row.event_starts_at ? new Date(row.event_starts_at) : null;
  return {
    id: row.user_id,
    name: row.first_name || 'Player',
    eventId: row.event_id || null,
    eventTitle: row.event_title || '',
    eventWhen: d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '',
    added: row.added === true,
    alsoOpenToDating: row.also_open_to_dating === true,
  };
}

// A league row plus its standings, in the one shape the screen draws — the
// same shape the demo leagues are built in. `challenges` are the member's own
// challenges still to be played on this ladder.
function mapLeagueRow(row, standings, challenges) {
  const d = new Date(row.starts_at);
  const ladder = (Array.isArray(standings) ? standings : []).map((r) => ({
    rung: r.rung,
    // The server leaves out anyone hidden from the member, so every row has an
    // id and a name; the fallbacks only guard against a malformed row.
    id: r.user_id || null,
    name: r.first_name || 'Player',
    wins: r.wins || 0,
    losses: r.losses || 0,
    isMe: r.is_me === true,
  })).sort((a, b) => a.rung - b.rung);
  const me = ladder.find((r) => r.isMe) || null;
  return {
    id: row.id,
    city: row.city,
    title: row.title,
    venue: row.venue || '',
    sport: cap(row.sport),
    level: row.level_range || 'All levels',
    when: Number.isNaN(d.getTime()) ? '' : `Starts ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`,
    weeks: row.weeks || 0,
    standings: ladder,
    joined: !!me,
    myRung: me ? me.rung : null,
    challenges: challenges || [],
  };
}

// The demo ladders, built once: sample players on the rungs, each with a
// made-up record. Nothing here is anyone's real result.
function buildDemoLeagues() {
  return LEAGUES.map((l, li) => ({
    id: l.id, city: l.city, title: l.title, venue: l.venue, sport: l.sport, level: l.level, when: l.when, weeks: l.weeks,
    standings: TOURNAMENT_PLAYERS.slice(li * 7, li * 7 + l.players).map((pl, i) => ({
      id: pl.id, name: pl.name, rung: i + 1, wins: Math.max(0, l.players - i - 1), losses: i, isMe: false,
    })),
    joined: false, myRung: null, challenges: [],
  }));
}

// The membership tier on a profile row. Set by the desk and read-only here;
// anything the app doesn't recognise is treated as free rather than guessed at.
const tierOf = (row) => (row && ['free', 'plus', 'club'].includes(row.tier) ? row.tier : 'free');

// What the database said, when it refused something on purpose. Functions
// raise with an SQLSTATE (22023, 42501, P0002, 23505…) and a sentence written
// to be shown; a dropped connection has neither, and gets our own words.
function serverSaid(e) {
  const code = String((e && e.code) || '');
  const msg = (e && e.message) || '';
  return /^(22|23|42|54|P0)/.test(code) && msg ? msg : null;  // 54000 = a rate limit, in the server's words
}

function mapMsgRow(row, myId) {
  const cp = row.court_payload || {};
  const base = { id: row.id, who: row.sender_id === myId ? 'me' : 'them', when: fmtWhen(row.sent_at), read: !!row.read_at };
  if (row.kind === 'court_time') {
    return { ...base, kind: 'court', court: cp.venue, day: cp.day, time: cp.time, sport: cap(cp.sport), status: cp.status || 'proposed' };
  }
  return { ...base, text: row.body };
}

const BOOT_TIMEOUT_MS = 12000;
const PHOTO_TIMEOUT_MS = 30000;

// Supabase reports "there is no SMS provider configured" through the same
// channel as "that isn't a real phone number", and the raw text reads like the
// number is at fault. Since the phone step is a hard gate, an unconfigured
// provider blocks every signup — and a tester who believes it's their number
// retypes it three times and gives up without telling anyone. Name the cases
// apart so the failure reaches the person who can actually fix it.
const RATE_LIMITED = /rate limit|too many|only request this after|429/i;
const PROVIDER_FAULT = /provider|not enabled|disabled|unsupported|configur|sending sms|sending confirmation|twilio|messagebird|vonage/i;
const NOT_CONFIGURED = 'Text messages aren’t switched on for RSVPlay yet — that’s on us, not your number. Email hello@rsvplayapp.com and we’ll get you in.';

function phoneError(e, fallback) {
  const text = `${(e && (e.message || e.msg)) || ''} ${(e && (e.code || e.error_code)) || ''}`;
  if (RATE_LIMITED.test(text)) return 'Too many tries just now — give it a minute, then tap send again.';
  if (PROVIDER_FAULT.test(text)) return NOT_CONFIGURED;
  return (e && e.message) || fallback;
}

const NOTIF_ICONS = { match: 'heart', message: 'chatbubble', court_time: 'tennisball', event_reminder: 'calendar', system: 'notifications' };
// The one order modes appear in, everywhere: Play, Date, Friends. Dating is a
// mode you opt into, so it is never the one the app opens on by default.
const ALL_MODES = ['play', 'date', 'friends'];
// The mode to open on: the first of the member's modes, in that order.
const firstMode = (modes) => ALL_MODES.find((m) => (modes || []).includes(m)) || (modes && modes[0]) || 'play';
const ALL_GAMES = ['singles', 'doubles', 'mixed_doubles'];

const prefOk = (pref, g) =>
  !pref
  || pref === 'everyone'
  || (pref === 'men' && g === 'man')
  || (pref === 'women' && g === 'woman')
  || (pref === 'nonbinary' && g === 'nonbinary');

export function AppStateProvider({ children }) {
  const [user, setUser] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState(null);
  const [mode, setMode] = useState('play');

  // demo deck state
  const [deckPos, setDeckPos] = useState(0);
  const [history, setHistory] = useState([]);
  const [likeCount, setLikeCount] = useState(0);

  // live deck state
  const [liveDeck, setLiveDeck] = useState([]);
  const [liveIndex, setLiveIndex] = useState(0);
  const [deckError, setDeckError] = useState(false);

  const [saved, setSaved] = useState({});
  const [blocked, setBlocked] = useState({});
  // People this member has reported this session: gone from the crew at once.
  // (The server leaves them out of get_my_crew() from then on.)
  const [reported, setReported] = useState({});
  const [seen, setSeen] = useState({});
  const [matches, setMatches] = useState(['maya', 'sam', 'priya']);
  const [threads, setThreads] = useState(THREADS);
  // Messages the server refused. They are deliberately NOT kept in `threads`:
  // a bubble sitting in the conversation with no row behind it tells the
  // member they said something they never said. They live here instead, so
  // they survive a thread refresh, stay visibly marked "not sent", and can be
  // retried or thrown away. Keyed by thread id.
  const [outbox, setOutbox] = useState({});
  const [joined, setJoined] = useState({});
  const [replied, setReplied] = useState({});
  const [notifs, setNotifs] = useState(NOTIFICATIONS.map((n) => ({ ...n })));
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [liveEvents, setLiveEvents] = useState(null);
  // null liveEvents means "not loaded", which is not the same as "none": the
  // screen must not say a city has no meetups while it is still asking, or
  // after the question failed.
  const [eventsError, setEventsError] = useState(false);
  // Places to play, from the database, stamped with the city selection they
  // were fetched for: { key, rows }. A list is trusted only for that selection,
  // so after a city change the bundled list stands in until the new answer
  // arrives, never the old cities' rows. null means nothing has loaded. An
  // empty rows array is a real answer: the desk has listed nothing there.
  const [liveCourts, setLiveCourts] = useState(null);
  // Tournaments: from the database when live ({ key, rows }, stamped with the
  // city selection like the places list); built locally in the demo.
  const [liveTournaments, setLiveTournaments] = useState(null);
  const [demoTournaments, setDemoTournaments] = useState(buildDemoTournaments);
  // Names for bracket lines, fetched afresh with every tournament refresh rather
  // than read from the shared profile cache — that cache never forgets a card,
  // so it would go on naming someone after a block in either direction.
  const [tournamentNames, setTournamentNames] = useState({});
  const tournamentSeqRef = useRef(0); // only the latest tournament refresh may land
  // The crew: people who checked in to the same event as the member. Live it is
  // whatever get_my_crew returns (null until it has answered); in the demo it
  // is made up from the sample players once the member "checks in".
  const [liveCrew, setLiveCrew] = useState(null);
  const crewSeqRef = useRef(0);
  // Demo stand-ins for what only the server can write: the waiver stamp, the
  // check-in, and who has been added to the crew.
  const [demoWaivers, setDemoWaivers] = useState({});
  const [demoCheckins, setDemoCheckins] = useState({});
  const [demoCrewAdded, setDemoCrewAdded] = useState({});
  // A waiver accepted a moment ago, before the event list has re-rendered with
  // it — so "accept, then check in" works without waiting on a render.
  const waiverRef = useRef({});
  // Ladder leagues: from the database when live ({ key, rows }, stamped with
  // the city selection like tournaments); built locally in the demo.
  const [liveLeagues, setLiveLeagues] = useState(null);
  const [demoLeagues, setDemoLeagues] = useState(buildDemoLeagues);
  const leagueSeqRef = useRef(0);
  // Challenges this phone has made this session, by id — kept so a result can
  // still be recorded if the list of open challenges can't be read.
  const madeChallengesRef = useRef([]);
  const demoChallengeSeqRef = useRef(0);
  // Meetups belong to one city each, and a member sees the meetups for the
  // cities on their profile — one city or several — and no others. There is no
  // nationwide list; choosing cities in Settings is what changes it. Kept in a
  // ref as well, because the fetch outlives the render that started it.
  const eventCities = citiesOf(user);
  const eventCityKey = eventCities.join(',');
  const eventCityRef = useRef({ key: eventCityKey, list: eventCities });
  const cityWriteSeqRef = useRef(0);                     // latest city selection sent
  const cityWriteChainRef = useRef(Promise.resolve());   // city writes go one at a time, in order
  const cityConfirmedRef = useRef(null);                 // the selection the server last accepted
  eventCityRef.current = { key: eventCityKey, list: eventCities };
  const [myPhotos, setMyPhotos] = useState(null); // live: [{position, url, status}]
  const [pendingMatch, setPendingMatch] = useState(null); // B-21: match made by THEIR like, waiting to celebrate
  const [devices, setDevices] = useState([]);
  const [deviceKey, setDeviceKey] = useState(null);
  // Set when the server says this device was signed out from another one.
  const [revokedHere, setRevokedHere] = useState(false);
  // Boot gating: we can only decide Welcome vs Main once we know whether a
  // session exists, not just whether local storage had a profile.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  // Set when we know the phone is signed in but couldn't fetch the profile.
  // Without this the app waits for an answer that never comes, on black.
  const [bootError, setBootError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);

  const cacheRef = useRef({});        // userId → mapped profile (live)
  const matchIdsRef = useRef({});     // otherUserId → matchId (live; B-01)
  const threadsRef = useRef(threads); // avoid stale closures in async sends (B-01)
  const deckReqRef = useRef(0);       // refresh staleness guard (B-16)
  const prefsTimerRef = useRef(null); // debounce pref-driven deck refresh (B-12)
  const celebratedRef = useRef({});   // matchId → true (Match Point modal already shown; B-21 dedupe)
  const localSeqRef = useRef(0);      // ids for optimistic messages, so a failed one can be found again

  useEffect(() => { threadsRef.current = threads; }, [threads]);

  const live = isBackendConfigured && !!session;
  const myId = session && session.user ? session.user.id : null;

  // ---------- hydration ----------

  useEffect(() => {
    Promise.all([storage.getItem(STORE_KEY), storage.getItem(SAVED_KEY), storage.getItem(PREFS_KEY)])
      .then(([rawUser, rawSaved, rawPrefs]) => {
        if (rawPrefs) {
          const p = JSON.parse(rawPrefs);
          if (p && typeof p === 'object') setPrefs({ ...DEFAULT_PREFS, ...p });
        }
        if (rawUser) {
          const u = JSON.parse(rawUser);
          if (u && typeof u.name === 'string') {
            setUser(u);
            if (u.modes && u.modes.length) setMode(firstMode(u.modes));
          }
        }
        if (rawSaved) {
          const s = JSON.parse(rawSaved);
          if (s && typeof s === 'object') setSaved(s); // B-15
        }
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const persistSaved = (next) => {
    setSaved(next);
    storage.setItem(SAVED_KEY, JSON.stringify(next)).catch(() => {});
  };

  useEffect(() => {
    if (!isBackendConfigured) { setSessionChecked(true); return undefined; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // A phone that's still signed in but has lost its local copy of the
  // profile (reinstall, storage cleared, signed in on a second device) used
  // to land back on the welcome screen as if it were a stranger. Rebuild
  // the profile from the server instead.
  useEffect(() => {
    if (!live || user || !hydrated) return undefined;
    let alive = true;
    setBootError(false);
    // A request that hangs is the same problem as one that fails: the app is
    // waiting on black either way, so give it a deadline.
    const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BOOT_TIMEOUT_MS));
    Promise.race([bootstrapAfterSignIn(), deadline])
      .then((r) => { if (alive && !r.hasProfile) setNeedsOnboarding(true); })
      .catch(() => { if (alive) setBootError(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, hydrated, user, bootAttempt]);

  const retryBoot = () => { setBootError(false); setBootAttempt((n) => n + 1); };

  // ---------- live loaders ----------

  const refreshDeck = async (m = mode) => {
    const req = ++deckReqRef.current; // B-16: drop out-of-order responses
    try {
      const rows = await api.fetchDeck(m, 20);
      if (req !== deckReqRef.current) return;
      const mapped = rows.map(mapDeckRow);
      try {
        // Photos are progressive enhancement: a failure here still shows the deck.
        const photoMap = await api.getApprovedPhotoMap(mapped.map((p) => p.id));
        if (req !== deckReqRef.current) return;
        mapped.forEach((p) => {
          const ph = photoMap[p.id];
          if (ph && ph.length) { p.photo = ph[0]; p.photos = ph; }
        });
      } catch (e) { /* cards fall back to initials */ }
      mapped.forEach((p) => { cacheRef.current[p.id] = p; });
      setLiveDeck(mapped);
      setLiveIndex(0);
      setDeckError(false);
    } catch (e) {
      if (req === deckReqRef.current) setDeckError(true); // B-17
    }
  };

  const refreshMatchesAndThreads = async () => {
    try {
      const rows = await api.listMatches();
      // B-06: a pair matched in two modes → one thread, newest match wins
      const deduped = [];
      const taken = new Set();
      rows.forEach((m) => {
        const otherId = m.user_a === myId ? m.user_b : m.user_a;
        if (taken.has(otherId)) return;
        taken.add(otherId);
        deduped.push({ ...m, otherId });
      });
      const profs = await api.getProfilesByIds(deduped.map((m) => m.otherId));
      const msgLists = await Promise.all(deduped.map((m) => api.listMessages(m.id).catch(() => [])));
      let photoMap = {};
      try { photoMap = await api.getApprovedPhotoMap(profs.map((p) => p.id)); } catch (e) { /* initials fallback */ }
      // B-01 path 2: all awaits done — commit state atomically at the end
      profs.forEach((p) => {
        const prevDist = cacheRef.current[p.id] ? cacheRef.current[p.id].dist : null;
        const mappedP = { ...mapProfileRow(p), dist: prevDist };
        const ph = photoMap[p.id];
        if (ph && ph.length) { mappedP.photo = ph[0]; mappedP.photos = ph; }
        cacheRef.current[p.id] = mappedP;
      });
      deduped.forEach((m) => { matchIdsRef.current[m.otherId] = m.id; });
      setMatches(deduped.map((m) => m.otherId));
      setThreads(deduped.map((m, i) => {
        const msgs = msgLists[i].map((r) => mapMsgRow(r, myId));
        const last = msgs[msgs.length - 1];
        return {
          id: m.otherId,
          matchId: m.id,
          unread: !!last && last.who === 'them' && !last.read, // B-14: real unread state
          yourServe: !!last && last.who === 'them',
          msgs,
        };
      }));
    } catch (e) { /* offline: keep current (empty in live — see live boot) */ }
  };

  const refreshEvents = async () => {
    const asked = eventCityRef.current;
    setEventsError(false);
    try {
      const rows = await api.listEvents(asked.list);
      // The member changed cities while this was in flight: a newer fetch is
      // on its way, and this answer is for a selection they no longer have.
      if (asked.key !== eventCityRef.current.key) return;
      const week = (ts) => {
        const days = (new Date(ts) - new Date()) / 86400000;
        return days <= 7 ? 'This week' : days <= 14 ? 'Next week' : 'Coming up';
      };
      setLiveEvents(rows.map((e) => {
        const d = new Date(e.starts_at);
        const rsvps = e.event_rsvps || [];
        const going = rsvps.filter((r) => r.status === 'going' || r.status === 'checked_in');
        // The member's own RSVP: it carries the waiver and check-in stamps,
        // which only the server writes.
        const mine = rsvps.find((r) => r.user_id === myId) || null;
        const discount = Math.round(Number(e.club_discount_pct));
        return {
          id: e.id,
          week: week(e.starts_at),
          dow: d.toLocaleDateString([], { weekday: 'short' }),
          dom: String(d.getDate()),
          title: e.title,
          venue: e.venue,
          time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          sport: cap(e.sport),
          level: e.level_range,
          city: e.city || null,
          spotsLeft: Math.max(0, e.capacity - going.length), // B-13
          going: going.some((r) => r.user_id === myId),
          goingCount: going.length,
          desc: '',
          startsAt: e.starts_at,
          // null: nothing to pay, or the organiser hasn't said.
          priceCents: typeof e.price_cents === 'number' ? e.price_cents : null,
          clubDiscountPct: discount > 0 ? discount : 0,
          // Before this moment only Club members can RSVP; null means open to all.
          generalOpensAt: e.general_opens_at || null,
          // On record with the server — or accepted a moment ago on this phone,
          // while this list was already on its way back without it.
          waiverAccepted: !!mine && (!!mine.waiver_accepted_at || !!waiverRef.current[e.id]),
          checkedIn: !!(mine && (mine.status === 'checked_in' || mine.checked_in_at)),
        };
      }));
    } catch (e) {
      // Only if this is still the question being asked — a failure for a
      // selection they have since changed is not worth reporting.
      if (asked.key === eventCityRef.current.key) setEventsError(true);
    }
  };

  const refreshCourts = async () => {
    const asked = eventCityRef.current;
    try {
      const rows = await api.listCourts(asked.list);
      if (asked.key !== eventCityRef.current.key) return; // they changed cities meanwhile
      if (!Array.isArray(rows)) throw new Error('no list');
      setLiveCourts({ key: asked.key, rows: rows.map(mapCourtRow) });
    } catch (e) {
      // Couldn't reach the list. Keep the last good one for these same cities
      // (a refresh that fails shouldn't swap real data for the bundled copy);
      // otherwise fall back to the bundled list rather than telling a member
      // their city has nowhere to play.
      setLiveCourts((cur) => (cur && cur.key === asked.key ? cur : null));
    }
  };

  const refreshTournaments = async () => {
    const asked = eventCityRef.current;
    // Refreshes overlap (a result recorded while the list is loading); an older
    // answer arriving last must not put back what the newer one replaced.
    const seq = ++tournamentSeqRef.current;
    const stale = () => seq !== tournamentSeqRef.current || asked.key !== eventCityRef.current.key;
    try {
      const rows = await api.listTournaments(asked.list);
      if (stale()) return;
      if (!Array.isArray(rows)) throw new Error('no list');
      const mapped = rows.map((r) => mapTournamentRow(r, myId));
      // Brackets are drawn from ids. Ask for every card each time, not just the
      // ones we haven't seen: the server withholds a card when there is a block
      // either way, and that has to take effect here too. Anyone it doesn't
      // return shows as an unnamed player.
      const ids = {};
      mapped.forEach((t) => {
        t.entries.forEach((e) => { ids[e.id] = true; });
        t.matches.forEach((m) => { if (m.a) ids[m.a] = true; if (m.b) ids[m.b] = true; });
      });
      const others = Object.keys(ids).filter((id) => id !== myId);
      let names = null;
      if (others.length) {
        try {
          const cards = await api.getProfilesByIds(others);
          names = {};
          (Array.isArray(cards) ? cards : []).forEach((c) => {
            const p = mapProfileRow(c);
            names[p.id] = p.isTeam && p.partnerName ? `${p.name} & ${p.partnerName}` : p.name;
          });
        } catch (e) { /* names are a nicety; keep the last ones and the bracket still draws */ }
      } else {
        names = {};
      }
      if (stale()) return;
      if (names) setTournamentNames(names);
      setLiveTournaments({ key: asked.key, rows: mapped });
    } catch (e) {
      if (stale()) return;
      setLiveTournaments((cur) => (cur && cur.key === asked.key ? cur : null));
    }
  };

  // The crew: everyone who checked in to the same event as the member, as the
  // server lists them. A failure keeps the last list rather than emptying it.
  const refreshCrew = async () => {
    const seq = ++crewSeqRef.current;
    try {
      const rows = await api.fetchCrew();
      if (seq !== crewSeqRef.current) return;
      setLiveCrew((Array.isArray(rows) ? rows : []).filter((r) => r && r.user_id).map(mapCrewRow));
    } catch (e) { /* keep what we have; the next check-in or launch asks again */ }
  };

  // Ladder leagues for the member's cities, each with its standings. Whether
  // the member is on a ladder, and on which rung, is read from the standings
  // (the row the server marks is_me) — nothing is worked out here.
  const refreshLeagues = async () => {
    const asked = eventCityRef.current;
    const seq = ++leagueSeqRef.current;
    const stale = () => seq !== leagueSeqRef.current || asked.key !== eventCityRef.current.key;
    try {
      const rows = await api.fetchLeagues();
      if (stale()) return;
      if (!Array.isArray(rows)) throw new Error('no list');
      const mine = rows.filter((r) => asked.list.includes(r.city));
      const [standings, open] = await Promise.all([
        Promise.all(mine.map((r) => api.fetchLeagueStandings(r.id).catch(() => null))),
        // Open challenges are a nicety on top of the ladder: if they can't be
        // read, the ones made on this phone this session still stand.
        api.fetchMyLeagueChallenges().catch(() => null),
      ]);
      if (stale()) return;
      const challenges = Array.isArray(open)
        ? open.map((c) => ({ id: c.id, leagueId: c.league_id, challengerId: c.challenger_id, challengedId: c.challenged_id }))
        : madeChallengesRef.current;
      if (Array.isArray(open)) madeChallengesRef.current = challenges;
      setLiveLeagues({
        key: asked.key,
        rows: mine.map((r, i) => mapLeagueRow(r, standings[i], challenges.filter((c) => c.leagueId === r.id))),
      });
    } catch (e) {
      if (stale()) return;
      setLiveLeagues((cur) => (cur && cur.key === asked.key ? cur : null));
    }
  };

  // Changing cities swaps the whole list: the old selection's meetups are
  // cleared at once rather than left on screen until the new ones arrive, so
  // nothing from a city you dropped is ever shown — or joinable — afterwards.
  useEffect(() => {
    if (!live) return;
    setLiveEvents(null);
    refreshEvents();
    refreshCourts();
    refreshTournaments();
    refreshLeagues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCityKey, live]);

  // Quietly: never an alert, never awaited by boot or signup. Skipped when the
  // profile already holds this zone, and when the phone can't name one.
  const sendTimezone = (known) => {
    let tz = null;
    try { tz = getDeviceTimezone(); } catch (e) { tz = null; }
    if (!tz || tz === known) return;
    try {
      Promise.resolve(api.setMyTimezone(tz)).then(() => {
        setUser((u) => {
          if (!u || u.timezone === tz) return u;
          const next = { ...u, timezone: tz };
          storage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      }).catch(() => {});
    } catch (e) { /* next launch tries again */ }
  };

  const refreshNotifs = async () => {
    try {
      const rows = await api.listNotifications();
      setNotifs(rows.filter((n) => !n.read_at).map((n) => {
        const other = n.payload && (n.payload.with || n.payload.from);
        const name = other && cacheRef.current[other] ? cacheRef.current[other].name : 'someone';
        const txt = n.kind === 'match' ? `It's a Match Point! You matched with ${name}.`
          : n.kind === 'message' ? `Your serve — ${name} sent you a message.`
          : n.kind === 'court_time' ? `${name} proposed a court time.`
          : n.kind === 'event_reminder' ? 'An event you joined is coming up.'
          : 'Update from RSVPlay.';
        return { ico: NOTIF_ICONS[n.kind] || 'notifications', txt, sub: fmtWhen(n.sent_at) };
      }));
    } catch (e) { /* keep current state */ }
  };

  useEffect(() => {
    if (!live) return;
    // B-05: live mode starts clean — no demo people for signed-in users
    cacheRef.current = {};
    matchIdsRef.current = {};
    setMatches([]);
    setThreads([]);
    setNotifs([]);
    setLiveEvents(null);
    setLiveCourts(null);
    setLiveTournaments(null);
    setTournamentNames({});
    setLiveCrew(null);
    setLiveLeagues(null);
    waiverRef.current = {};
    madeChallengesRef.current = [];
    api.updateMyProfile({ last_active_at: new Date().toISOString() }).catch(() => {});
    getDeviceKey().then((key) => registerForPush((t, p) => api.registerPushToken(t, p, key))).catch(() => {});
    // Refresh coarse (~1 km) location so distances and the radius filter work;
    // refetch the deck once it lands. Position can only be set through
    // set_my_location, which allows a move to a new ~2.5-mile square once every
    // 6 hours — a refusal (accepted: false) or a failure just leaves the old
    // position standing, so neither is surfaced.
    getCoarseLocation().then((loc) => {
      if (loc) {
        api.setMyLocation(loc.lat, loc.lng)
          .then(() => refreshDeck(mode))
          .catch(() => {});
      }
    }).catch(() => {});
    // And the phone's timezone, so the server can keep notifications quiet
    // from 10pm to 8am where the member actually is. Same posture as the
    // position: a refusal or a failure is never surfaced and never holds
    // anything up — the old timezone (or none) just stands until next launch.
    sendTimezone(user && user.timezone);
    refreshMatchesAndThreads().then(refreshNotifs);
    refreshCrew();
    refreshEvents();
    refreshDeck(mode);
    refreshMyPhotos();
    // Remember this device on the account — and honour a sign-out issued
    // from one of their other devices.
    getDeviceKey().then(async (key) => {
      setDeviceKey(key);
      try {
        const stillAllowed = await api.touchDevice(key, getDeviceName(), getPlatform());
        if (!stillAllowed) {
          setRevokedHere(true);
          signOut();
          return;
        }
        refreshDevices();
      } catch (e) { /* offline: try again next launch */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // A profile cached on the phone is not fetched again at launch, so the one
  // thing on it that only the desk changes — the membership tier — would stay
  // as it was at the last sign-in, and a member just made Club would still be
  // held out of Club early access. Read it again, quietly; a failure leaves
  // the cached tier standing. (With no cached profile, boot fetches the whole
  // row anyway.) Its own effect because it needs the cache to have been read:
  // the session can be known before local storage is.
  useEffect(() => {
    if (!live || !hydrated || !user) return;
    api.getMyProfile().then((remote) => {
      if (!remote) return;
      setUser((u) => {
        if (!u || u.tier === tierOf(remote)) return u;
        const next = { ...u, tier: tierOf(remote) };
        storage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, hydrated]);

  useEffect(() => {
    if (live) refreshDeck(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // B-21: the first liker learns about a match the moment the second like
  // lands — the match trigger writes a notification row for both players,
  // and this subscription turns it into the Match Point celebration. Also
  // keeps the chat list fresh when messages arrive outside an open thread.
  useEffect(() => {
    if (!live || !myId) return undefined;
    const unsubscribe = api.subscribeToNotifications(myId, async (n) => {
      refreshNotifs();
      const payload = n.payload || {};
      if (n.kind === 'match') {
        refreshMatchesAndThreads();
        const withId = payload.with;
        const matchId = payload.match_id;
        if (!withId || (matchId && celebratedRef.current[matchId])) return; // own swipe already celebrated
        if (matchId) {
          celebratedRef.current[matchId] = true;
          matchIdsRef.current[withId] = matchId;
        }
        try {
          if (!cacheRef.current[withId]) {
            const profs = await api.getProfilesByIds([withId]);
            if (profs[0]) {
              const mappedP = mapProfileRow(profs[0]);
              try {
                const pm = await api.getApprovedPhotoMap([withId]);
                if (pm[withId] && pm[withId].length) { mappedP.photo = pm[withId][0]; mappedP.photos = pm[withId]; }
              } catch (e) { /* initials fallback */ }
              cacheRef.current[withId] = mappedP;
            }
          }
        } catch (e) { /* celebrate with what we have */ }
        addMatch(withId);
        if (cacheRef.current[withId]) setPendingMatch(cacheRef.current[withId]);
      } else if (n.kind === 'message' || n.kind === 'court_time') {
        refreshMatchesAndThreads();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, myId]);

  // ---------- persistence ----------

  const saveUser = (u) => {
    setUser(u);
    storage.setItem(STORE_KEY, JSON.stringify(u)).catch(() => {});
  };

  // A settings write the server refused is worse than one that never happened:
  // the app goes on showing the new value, so someone believes they've left
  // Date mode, or changed city, while the server still has the old answer and
  // keeps showing them to people on the old terms. Put it back and say so.
  const saveSetting = (patch, revert, what) => {
    if (!live) return;
    api.updateMyProfile(patch).catch((e) => {
      revert();
      // 42501: the database refused the change on purpose (a birthdate, or a
      // second gender change within 30 days) and says why in plain words.
      if (e && e.code === '42501' && e.message) {
        Alert.alert('Couldn\u2019t save that', e.message);
        return;
      }
      Alert.alert('Couldn\u2019t save that', `${what} didn\u2019t save, so nothing changed. Check your connection and try again.`);
    });
  };

  const updateBio = (bio) => {
    const prev = user;
    if (user) saveUser({ ...user, bio });
    saveSetting({ bio }, () => saveUser(prev), 'Your bio');
  };

  // ---------- photo management (up to 6; slot 0 is the main photo) ----------

  const demoPhotoList = (u) => (u && (u.photos || (u.photo ? [u.photo] : []))) || [];

  const refreshMyPhotos = async () => {
    try {
      const list = await api.listMyPhotos();
      setMyPhotos(list);
      // Keep the local primary in sync so avatars stay fresh (signed URLs
      // are re-issued on every live boot).
      setUser((u) => {
        if (!u) return u;
        const next = { ...u, photo: list[0] ? list[0].url : null };
        storage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    } catch (e) { /* keep current */ }
  };

  const addPhoto = async (uri) => {
    if (live) {
      const count = (myPhotos || []).length;
      if (count >= 6) throw new Error('You can have up to 6 photos — remove one first.');
      await api.uploadProfilePhoto(uri, count);
      await refreshMyPhotos();
      return;
    }
    const list = demoPhotoList(user);
    if (list.length >= 6) throw new Error('You can have up to 6 photos — remove one first.');
    const photos = [...list, uri];
    saveUser({ ...user, photos, photo: photos[0] });
  };

  const removePhoto = async (position) => {
    if (live) {
      await api.deleteProfilePhoto(position);
      await refreshMyPhotos();
      return;
    }
    const photos = demoPhotoList(user).filter((_, i) => i !== position);
    saveUser({ ...user, photos, photo: photos[0] || null });
  };

  const makePrimary = async (position) => {
    if (live) {
      await api.makePhotoPrimary(position);
      await refreshMyPhotos();
      return;
    }
    const photos = [...demoPhotoList(user)];
    if (position < 1 || position >= photos.length) return;
    const tmp = photos[0];
    photos[0] = photos[position];
    photos[position] = tmp;
    saveUser({ ...user, photos, photo: photos[0] });
  };

  const updateDating = (gender, seeking) => {
    const prev = user;
    if (user) saveUser({ ...user, gender, seeking });
    if (live) {
      saveSetting({ gender: gender || null, seeking: seeking || [] }, () => saveUser(prev), 'Your dating settings');
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(mode), 700);
    }
  };

  const updatePlay = (playGames, playPref) => {
    const games = playGames && playGames.length ? playGames : ALL_GAMES;
    const prev = user;
    if (user) saveUser({ ...user, playGames: games, playPref: playPref || 'everyone' });
    if (live) {
      saveSetting({ play_games: games, play_pref: playPref || 'everyone' }, () => saveUser(prev), 'Your Play settings');
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(mode), 700);
    }
  };

  // Where a member plays. Auto-suggested from coarse location at signup,
  // changeable in Settings (people move, and plenty of players split time
  // between two cities).
  const refreshDevices = async () => {
    try { setDevices(await api.listDevices()); } catch (e) { /* keep what we have */ }
  };

  const signOutDevice = async (id) => {
    const ok = await api.revokeDevice(id);
    if (ok) await refreshDevices();
    return ok;
  };

  // The first city in the list is the home city — the one a profile card
  // names and the one the database keys on; the rest ride along as extras.
  // Matching and meetups use all of them.
  const updateCities = (list) => {
    if (!user) return;
    const clean = (list || []).filter((c, i) => !!cityBySlug(c) && list.indexOf(c) === i);
    if (!clean.length) return; // a profile always plays somewhere
    saveUser({ ...user, city: clean[0], cities: clean });
    if (live) {
      // Cities are tapped one after another, so several writes can be in the
      // air at once. Sent bare, they could land out of order, and a failed
      // early one would "revert" to a snapshot older than a later one that
      // succeeded — leaving the app showing one selection and the server
      // holding another. So: one at a time, in order; a write that has been
      // overtaken is skipped; and a failure puts back the last selection the
      // server is known to hold, not whatever this tap happened to start from.
      if (!cityConfirmedRef.current) cityConfirmedRef.current = citiesOf(user);
      const seq = ++cityWriteSeqRef.current;
      cityWriteChainRef.current = cityWriteChainRef.current.then(() => {
        if (seq !== cityWriteSeqRef.current) return null; // a newer selection is queued behind this one
        return api.updateMyProfile({ city: clean[0], extra_cities: clean.slice(1) }).then(
          () => { cityConfirmedRef.current = clean; },
          () => {
            if (seq !== cityWriteSeqRef.current) return; // a newer write will settle it
            const back = cityConfirmedRef.current || clean;
            setUser((u) => {
              if (!u) return u;
              const next = { ...u, city: back[0], cities: back };
              storage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
              return next;
            });
            Alert.alert('Couldn\u2019t save that', `${back.length > 1 ? 'Your cities' : 'Your city'} didn\u2019t save, so nothing changed. Check your connection and try again.`);
          },
        );
      });
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      // Events refetch on their own when the city changes — see the effect
      // beside refreshEvents.
      prefsTimerRef.current = setTimeout(() => refreshDeck(mode), 700);
    }
  };

  // Add a city if it isn't selected, drop it if it is. Returns false when that
  // would leave no city at all, so the screen can say why nothing happened.
  const toggleCity = (citySlug) => {
    if (!user || !cityBySlug(citySlug)) return false;
    // A city opened on the server after this build shipped is a slug this app
    // can't name. citiesOf() leaves it out, so writing the list back would
    // quietly delete it — or replace a home city with the default. Refuse, and
    // let the screen say the app needs updating.
    const stored = Array.isArray(user.cities) && user.cities.length ? user.cities : [user.city];
    if (stored.some((c) => c && !cityBySlug(c))) return 'unknown-city';
    const cur = citiesOf(user);
    const next = cur.includes(citySlug) ? cur.filter((c) => c !== citySlug) : [...cur, citySlug];
    if (!next.length) return false;
    updateCities(next);
    return true;
  };

  // Replace the whole selection with one city.
  const updateCity = (citySlug) => updateCities([citySlug]);

  // Best guess at the member's city from their coarse location; null when
  // we're not open where they are, so the app can say so instead of
  // dropping them into a city they've never been to.
  const detectCity = async () => {
    try {
      const loc = await getCoarseLocation();
      return loc ? nearestCity(loc.lat, loc.lng) : null;
    } catch (e) {
      return null;
    }
  };

  const updateTeam = (team) => {
    if (!user) return;
    const next = {
      ...user,
      isTeam: !!team.isTeam,
      partnerName: team.isTeam ? team.partnerName : '',
      partnerBirthdate: team.isTeam ? team.partnerBirthdate : null,
      partnerGender: team.isTeam ? team.partnerGender : null,
      // A shared profile is never a dating profile.
      modes: team.isTeam ? (user.modes || []).filter((m) => m !== 'date') : user.modes,
    };
    if (team.isTeam && !next.modes.length) next.modes = ['play'];
    const prev = user;
    const prevMode = mode;
    saveUser(next);
    const nextMode = next.modes.indexOf(mode) === -1 && next.modes.length ? firstMode(next.modes) : mode;
    if (nextMode !== mode) setMode(nextMode);
    if (live) {
      saveSetting({
        is_team: next.isTeam,
        partner_name: next.partnerName,
        partner_birthdate: next.partnerBirthdate,
        partner_gender: next.partnerGender,
        modes: next.modes,
      }, () => { saveUser(prev); setMode(prevMode); }, 'Your team profile');
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(nextMode), 700);
    }
  };

  const updateFriendsPref = (friendsPref) => {
    const prev = user;
    if (user) saveUser({ ...user, friendsPref: friendsPref || 'everyone' });
    if (live) {
      saveSetting({ friends_pref: friendsPref || 'everyone' }, () => saveUser(prev), 'Your Friends settings');
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(mode), 700);
    }
  };

  const updateModes = (modes) => {
    const prev = user;
    const prevMode = mode;
    if (user) saveUser({ ...user, modes });
    // Modes decide which decks you appear in. Turning Date off and having the
    // write fail leaves you in strangers' dating decks with the app telling
    // you otherwise, which is the one version of this that really matters.
    saveSetting({ modes }, () => { saveUser(prev); setMode(prevMode); }, 'What you\u2019re here for');
    if (!modes.includes(mode) && modes.length) setMode(firstMode(modes));
  };

  const updatePrefs = (next) => {
    // B-11: keep the range valid so the server write can't be rejected
    const ageMin = Math.min(next.ageMin, next.ageMax);
    const ageMax = Math.max(next.ageMin, next.ageMax);
    const clean = { ...next, ageMin, ageMax };
    const prev = prefs;
    const persist = (p) => {
      setPrefs(p);
      storage.setItem(PREFS_KEY, JSON.stringify(p)).catch(() => {});
    };
    persist(clean);
    if (live) {
      saveSetting({
        radius_mi: clean.radius,
        age_min: clean.ageMin,
        age_max: clean.ageMax,
        same_sports_only: clean.mySportsOnly,
      }, () => persist(prev), 'Your filters');
      // B-12: refetch the deck under the new prefs (debounced — sliders/typing)
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(mode), 700);
    }
  };

  const signOut = () => {
    setBootError(false);
    if (isBackendConfigured) api.signOut().catch(() => {});
    // Also clear the native Google session, so the next sign-in offers the
    // account picker instead of silently reusing the last account.
    social.signOutProviders().catch(() => {});
    storage.removeItem(STORE_KEY).catch(() => {});
    storage.removeItem(SAVED_KEY).catch(() => {});
    setUser(null);
    setMode('play');
    setDeckPos(0);
    setHistory([]);
    setLikeCount(0);
    setLiveDeck([]);
    setLiveIndex(0);
    setDeckError(false);
    setSaved({});
    setBlocked({});
    setReported({});
    setSeen({});
    setMatches(['maya', 'sam', 'priya']);
    setThreads(THREADS);
    setNotifs(NOTIFICATIONS.map((n) => ({ ...n })));
    setPrefs(DEFAULT_PREFS);
    storage.removeItem(PREFS_KEY).catch(() => {});
    setLiveEvents(null);
    setLiveCourts(null);
    setLiveTournaments(null);
    setTournamentNames({});
    tournamentSeqRef.current += 1; // a refresh still in flight belongs to the old account
    setLiveCrew(null);
    crewSeqRef.current += 1;
    setLiveLeagues(null);
    leagueSeqRef.current += 1;
    setDemoWaivers({});
    setDemoCheckins({});
    setDemoCrewAdded({});
    setDemoLeagues(buildDemoLeagues());
    setJoined({});
    waiverRef.current = {};
    madeChallengesRef.current = [];
    cacheRef.current = {};
    matchIdsRef.current = {};
  };

  // ---------- auth ----------

  const requestCode = async (email) => {
    if (isBackendConfigured) await api.signInWithEmail(email);
  };

  // US numbers → E.164 (+1XXXXXXXXXX); null if it isn't a real-looking number
  const toE164 = (raw) => {
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
    return null;
  };

  const requestPhoneCode = async (raw) => {
    const e164 = toE164(raw);
    if (!e164) throw new Error('Enter a 10-digit US phone number.');
    if (isBackendConfigured) {
      try {
        await api.startPhoneVerification(e164);
      } catch (e) {
        throw new Error(phoneError(e, 'Check the number and try again.'));
      }
    }
    // Demo mode: no SMS is sent; any 6-digit code verifies.
    return e164;
  };

  const verifyPhoneCode = async (e164, code) => {
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code.');
    if (isBackendConfigured) {
      let ok = false;
      try {
        ok = await api.confirmPhoneVerification(e164, code);
      } catch (e) {
        throw new Error(phoneError(e, 'That code didn’t match — check the newest text or resend.'));
      }
      if (!ok) throw new Error('That code didn’t match — check the newest text or resend.');
    }
    if (user) saveUser({ ...user, phoneVerified: true });
    return true;
  };

  // Shared by every sign-in route (email code, Apple, Google): once a session
  // exists, pull the profile and decide Onboarding vs Main.
  const bootstrapAfterSignIn = async () => {
    const remote = await api.getMyProfile();
    if (!remote) return { hasProfile: false };
    const { data: { user: authUser } } = await supabase.auth.getUser();
    // Only carry a cached photo forward for the SAME account — otherwise
    // signing in as someone else inherits the previous person's photo.
    const sameAccount = user && authUser && user.authId === authUser.id;
    // What the server holds right now — the selection a failed city save goes back to.
    cityConfirmedRef.current = [remote.city || DEFAULT_CITY].concat(remote.extra_cities || []).filter((c) => !!cityBySlug(c));
    const localUser = {
      authId: authUser ? authUser.id : null,
      name: remote.first_name,
      age: ageFromBirthdate(remote.birthdate),
      birthdate: remote.birthdate,
      gender: remote.gender || null,
      seeking: remote.seeking || [],
      playGames: remote.play_games || ALL_GAMES,
      playPref: remote.play_pref || 'everyone',
      friendsPref: remote.friends_pref || 'everyone',
      phoneVerified: !!remote.phone_verified_at,
      suspendedAt: remote.suspended_at || null,
      suspendedReason: remote.suspended_reason || '',
      tier: tierOf(remote),
      timezone: remote.timezone || null,
      city: remote.city || DEFAULT_CITY,
      cities: [remote.city || DEFAULT_CITY].concat(remote.extra_cities || []),
      isTeam: !!remote.is_team,
      partnerName: remote.partner_name || '',
      partnerBirthdate: remote.partner_birthdate || null,
      partnerGender: remote.partner_gender || null,
      photo: sameAccount && user.photo ? user.photo : null,
      sports: (remote.user_sports || []).map((s) => cap(s.sport)),
      skill: remote.user_sports && remote.user_sports[0] ? cap(remote.user_sports[0].level) : 'Intermediate',
      rating: remote.user_sports && remote.user_sports[0] ? remote.user_sports[0].rating_label : '',
      modes: remote.modes,
      bio: remote.bio,
    };
    saveUser(localUser);
    if (remote.modes && remote.modes.length) setMode(firstMode(remote.modes));
    setPrefs({ radius: remote.radius_mi, ageMin: remote.age_min, ageMax: remote.age_max, mySportsOnly: remote.same_sports_only });
    return { hasProfile: true };
  };

  const verifyCode = async (email, code) => {
    if (isBackendConfigured) {
      await api.verifyOtp(email, code);
      return bootstrapAfterSignIn();
    }
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code.');
    return { hasProfile: !!user };
  };

  // Apple / Google. The native credential exchange lives in lib/socialAuth;
  // from here on the flow is identical to the email-code route.
  const signInWithProvider = async (provider) => {
    if (!isBackendConfigured) throw new Error('Connect the backend to use social sign-in.');
    const result = provider === 'apple' ? await social.signInWithApple() : await social.signInWithGoogle();
    if (!result) return null; // the person dismissed the sheet
    const boot = await bootstrapAfterSignIn();
    // Apple hands over a first name exactly once, on the very first sign-in.
    // Keep it to prefill onboarding rather than making them type it again.
    return { ...boot, firstName: result.firstName || '' };
  };

  const finishOnboarding = async (draft) => {
    if (isBackendConfigured) {
      const loc = await getCoarseLocation();
      await api.upsertMyProfile({
        firstName: draft.name,
        birthdate: draft.birthdate,
        bio: draft.bio || '',
        availabilityNote: '',
        modes: draft.modes,
        radiusMi: prefs.radius,
        ageMin: prefs.ageMin,
        ageMax: prefs.ageMax,
        sameSportsOnly: prefs.mySportsOnly,
        city: draft.city || DEFAULT_CITY,
        extraCities: citiesOf(draft).filter((c) => c !== (draft.city || DEFAULT_CITY)),
        gender: draft.gender,
        seeking: draft.seeking,
        playGames: draft.playGames,
        playPref: draft.playPref,
        friendsPref: draft.friendsPref,
        isTeam: draft.isTeam,
        partnerName: draft.partnerName,
        partnerBirthdate: draft.partnerBirthdate,
        partnerGender: draft.partnerGender,
      });
      // A new profile starts with no position; set it now the row exists.
      // Signup never fails over this — the next launch tries again.
      if (loc) {
        try { await api.setMyLocation(loc.lat, loc.lng); } catch (e) { /* retried at next launch */ }
      }
      // The timezone too, now there is a row to hold it. Not awaited: quiet
      // hours are never a reason to hold up, or fail, a signup.
      sendTimezone();
      await api.setMySports(
        draft.sports.map((s) => ({ sport: s.toLowerCase(), level: draft.skill.toLowerCase(), ratingLabel: draft.rating || '' }))
      );
      // The phone was verified before this profile row existed — stamp it now.
      if (draft.phoneVerified) await api.syncPhoneVerification().catch(() => {});
      // The first photo is the one that decides whether anyone swipes right.
      // Dropping its failure left the new member looking at their own photo on
      // their own profile while everyone else saw initials, for the whole
      // session — so wait for it, and say what happened.
      let photoTrouble = null;
      if (draft.photo) {
        try {
          await Promise.race([
            api.uploadProfilePhoto(draft.photo, 0),
            new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), PHOTO_TIMEOUT_MS)),
          ]);
        } catch (e) {
          photoTrouble = (e && e.message) === 'slow' ? 'slow' : 'failed';
        }
      }
      // Push tokens reference the profile row, so the attempt made at sign-in
      // (before onboarding) could not have succeeded — retry now that it exists.
      getDeviceKey().then((key) => registerForPush((t, p) => api.registerPushToken(t, p, key))).catch(() => {});
      // Live: photos come from the server, never from the local file the picker
      // handed us — that URI exists on this phone and nowhere else.
      saveUser({ ...draft, photo: null });
      setMode(firstMode(draft.modes));
      refreshMyPhotos();
      if (photoTrouble === 'failed') {
        Alert.alert(
          'Your photo didn’t upload',
          'You’re in — everything else saved. Add one from the Profile tab when you have a better connection. A profile with a photo gets far more matches.'
        );
      } else if (photoTrouble === 'slow') {
        Alert.alert(
          'We couldn’t confirm your photo',
          'You’re in — everything else saved. Open the Profile tab and check; if the photo isn’t there, add it again.'
        );
      }
      return;
    }
    saveUser(draft);
    setMode(firstMode(draft.modes));
  };

  // ---------- deck ----------

  const eligible = (p) => {
    if (blocked[p.id] || seen[p.id]) return false;
    if (p.dist > prefs.radius) return false;
    if (p.age < prefs.ageMin || p.age > prefs.ageMax) return false;
    // Date mode: the fit must be mutual — they're what I'm looking for AND
    // I'm what they're looking for. Play/Friends are for everyone.
    // An empty "looking to date" fails closed (matches nobody) rather than
    // skipping the filter, which would show people the member ruled out —
    // and it's what the server already does.
    if (mode === 'date' && user && user.gender) {
      const seeking = user.seeking || [];
      if (!seeking.length) return false;
      if (!p.gender || !p.seeking) return false;
      if (!seeking.includes(p.gender)) return false;
      if (!p.seeking.includes(user.gender)) return false;
    }
    // Play mode: shared game type; singles/doubles honor both players'
    // play-with preference; mixed doubles is open by nature.
    if (mode === 'play' && user) {
      const myGames = (user.playGames && user.playGames.length ? user.playGames : ALL_GAMES);
      const theirGames = (p.playGames && p.playGames.length ? p.playGames : ALL_GAMES);
      const overlap = myGames.filter((g) => theirGames.includes(g));
      if (!overlap.length) return false;
      const ok = overlap.some((g) =>
        g === 'mixed_doubles' || (prefOk(user.playPref, p.gender) && prefOk(p.playPref, user.gender)));
      if (!ok) return false;
    }
    // Friends mode: mutual meet preference (defaults to everyone).
    if (mode === 'friends' && user) {
      if (!(prefOk(user.friendsPref, p.gender) && prefOk(p.friendsPref, user.gender))) return false;
    }
    if (prefs.mySportsOnly && user && user.sports) {
      if (!p.sports.some((s) => user.sports.includes(s))) return false;
    }
    return true;
  };

  const nextEligibleIndex = (from) => {
    let i = from;
    while (i < PROFILES.length && !eligible(PROFILES[i])) i += 1;
    return i;
  };

  // B-03: the index of the card actually being rendered (skips blocked/seen)
  const liveSkipFrom = (from) => {
    let i = from;
    while (i < liveDeck.length && (blocked[liveDeck[i].id] || seen[liveDeck[i].id])) i += 1;
    return i;
  };

  const currentProfile = () => {
    if (live) {
      const i = liveSkipFrom(liveIndex);
      return i < liveDeck.length ? liveDeck[i] : null;
    }
    const i = nextEligibleIndex(deckPos);
    return i < PROFILES.length ? PROFILES[i] : null;
  };

  const advance = () => {
    if (live) {
      const next = liveSkipFrom(liveIndex) + 1; // B-03: advance past the rendered card
      setLiveIndex(next);
      if (liveSkipFrom(next) >= liveDeck.length) refreshDeck(mode);
      return;
    }
    setHistory((h) => [...h, deckPos]);
    setDeckPos(nextEligibleIndex(deckPos) + 1);
  };

  const rewind = async () => {
    if (live) {
      if (liveIndex === 0) return false; // nothing swiped since the last refresh
      const prev = liveDeck[liveIndex - 1];
      if (!prev) return false;
      try {
        const ok = await api.undoSwipe(prev.id, mode);
        if (!ok) return false; // a conversation exists — the server refused
      } catch (e) {
        return false;
      }
      setLiveIndex(liveIndex - 1);
      // If that like had just matched, the match is dissolved server-side.
      setMatches((m) => m.filter((id) => id !== prev.id));
      setThreads((ts) => ts.filter((t) => t.id !== prev.id));
      refreshMatchesAndThreads();
      return true;
    }
    if (!history.length) return false;
    setDeckPos(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    return true;
  };

  // The card peeking out behind the top one.
  const peekNext = () => {
    if (live) {
      const cur = liveSkipFrom(liveIndex);
      const next = liveSkipFrom(cur + 1);
      return next < liveDeck.length ? liveDeck[next] : null;
    }
    const cur = nextEligibleIndex(deckPos);
    const next = nextEligibleIndex(cur + 1);
    return next < PROFILES.length ? PROFILES[next] : null;
  };

  // Demo: refill the deck so a demo never dead-ends. Live: just refetch.
  const resetDeck = () => {
    if (live) { refreshDeck(mode); return; }
    setSeen({});
    setDeckPos(0);
    setHistory([]);
  };

  const profileById = (id) => cacheRef.current[id] || (!live && PROFILES.find((p) => p.id === id)) || null;

  // ---------- matching ----------

  const ensureThread = (id) => {
    setThreads((ts) => (ts.some((t) => t.id === id)
      ? ts
      : [{ id, matchId: matchIdsRef.current[id] || null, unread: false, yourServe: true, msgs: [] }, ...ts]));
  };

  const addMatch = (id) => {
    setMatches((m) => (m.includes(id) ? m : [id, ...m]));
    ensureThread(id);
  };

  const registerLike = (id, ace) => {
    const n = likeCount + 1;
    setLikeCount(n);
    const isMatch = ace || n % 3 === 0;
    if (isMatch) addMatch(id);
    return isMatch;
  };

  const swipeLike = async (p, ace) => {
    if (live) {
      advance();
      try {
        const match = await api.swipe(p.id, mode, ace ? 'ace' : 'like');
        if (match) {
          cacheRef.current[p.id] = p;
          matchIdsRef.current[p.id] = match.id; // B-01: matchId known immediately
          celebratedRef.current[match.id] = true; // B-21: don't celebrate twice via the notification
          addMatch(p.id);
          refreshMatchesAndThreads();
          return true;
        }
      } catch (e) { /* offline: deck refresh will resurface them */ }
      return false;
    }
    const matched = registerLike(p.id, ace);
    advance();
    return matched;
  };

  const swipePass = (p) => {
    advance();
    if (live) api.swipe(p.id, mode, 'pass').catch(() => {});
  };

  const likeSaved = async (id) => {
    persistSaved({ ...saved, [id]: false });
    setSeen((s) => ({ ...s, [id]: true }));
    if (live) {
      try {
        const match = await api.swipe(id, mode, 'like');
        if (match) {
          matchIdsRef.current[id] = match.id;
          celebratedRef.current[match.id] = true; // B-21 dedupe
          addMatch(id);
          refreshMatchesAndThreads();
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    }
    return registerLike(id, false);
  };

  // ---------- chat ----------

  // B-01: creates the thread if it doesn't exist yet, so a first message
  // right after a match is never dropped.
  const appendMsg = (id, msg) => {
    setThreads((ts) => {
      if (ts.some((t) => t.id === id)) {
        return ts.map((t) => (t.id === id ? { ...t, yourServe: msg.who === 'them', msgs: [...t.msgs, msg] } : t));
      }
      return [{ id, matchId: matchIdsRef.current[id] || null, unread: false, yourServe: msg.who === 'them', msgs: [msg] }, ...ts];
    });
  };

  const upsertMsgById = (id, row) => {
    setThreads((ts) => ts.map((t) => {
      if (t.id !== id) return t;
      const mapped = mapMsgRow(row, myId);
      const exists = t.msgs.some((m) => m.id === mapped.id);
      return {
        ...t,
        yourServe: exists ? t.yourServe : mapped.who === 'them',
        msgs: exists ? t.msgs.map((m) => (m.id === mapped.id ? mapped : m)) : [...t.msgs, mapped],
      };
    }));
  };

  const resolveMatchId = async (id) => {
    const t = threadsRef.current.find((x) => x.id === id);
    if (t && t.matchId) return t.matchId;
    if (matchIdsRef.current[id]) return matchIdsRef.current[id];
    try {
      const rows = await api.listMatches();
      const row = rows.find((r) => r.user_a === id || r.user_b === id);
      if (row) { matchIdsRef.current[id] = row.id; return row.id; }
    } catch (e) { /* offline */ }
    return null;
  };

  const sendMessage = (id, msg) => {
    const localId = `local-${(localSeqRef.current += 1)}`;
    appendMsg(id, { ...msg, localId });
    if (live) {
      // If the send doesn't land, take the bubble back out of the thread and
      // put it in the outbox marked "not sent". Failing quietly here would let
      // someone arrange a court time that the other person never received.
      const failed = () => {
        setThreads((ts) => ts.map((t) => (t.id === id
          ? { ...t, msgs: t.msgs.filter((m) => m.localId !== localId) }
          : t)));
        setOutbox((o) => ({ ...o, [id]: [...(o[id] || []), { ...msg, localId, failed: true }] }));
      };
      // B-01: never fall into the demo branch while live — resolve and send
      resolveMatchId(id).then((matchId) => {
        if (!matchId) { failed(); return; }
        const sent = msg.kind === 'court'
          ? api.proposeCourtTime(matchId, { venue: msg.court, day: msg.day, time: msg.time, sport: (msg.sport || 'tennis').toLowerCase() })
          : api.sendTextMessage(matchId, msg.text);
        sent.catch(failed);
      }).catch(failed);
      return;
    }
    // demo: they "type" for a moment, then one canned reply per thread
    if (!replied[id]) {
      setReplied((r) => ({ ...r, [id]: true }));
      setTimeout(() => {
        appendMsg(id, { who: 'them', typing: true });
      }, 500);
      setTimeout(() => {
        setThreads((ts) => ts.map((t) => (t.id === id
          ? {
              ...t,
              yourServe: true,
              msgs: [
                // they replied — so they read everything you'd sent (B-14 demo)
                ...t.msgs.filter((m) => !m.typing).map((m) => (m.who === 'me' ? { ...m, read: true } : m)),
                { who: 'them', text: CANNED_REPLIES[id] || 'Sounds great — see you on the court! 🎾', when: 'Just now' },
              ],
            }
          : t)));
      }, 1800);
    }
  };

  // Tapping a "not sent" message: send it again, or throw it away. Nothing
  // else clears the outbox — an unsent message stays on screen until the
  // member decides what to do with it.
  const retryMessage = (threadId, localId) => {
    const queued = (outbox[threadId] || []).find((m) => m.localId === localId);
    if (!queued) return;
    discardMessage(threadId, localId);
    const { localId: _id, failed: _failed, ...body } = queued;
    sendMessage(threadId, body);
  };

  const discardMessage = (threadId, localId) => {
    setOutbox((o) => ({ ...o, [threadId]: (o[threadId] || []).filter((m) => m.localId !== localId) }));
  };

  const subscribeThread = (id) => {
    const thread = threadsRef.current.find((t) => t.id === id);
    const matchId = (thread && thread.matchId) || matchIdsRef.current[id];
    if (!live || !matchId) return () => {};
    return api.subscribeToMessages(matchId, (eventType, row) => {
      if (eventType === 'INSERT' && row.sender_id === myId) return; // own optimistic append shown already
      upsertMsgById(id, row); // B-08: UPDATEs (court accept/decline + read receipts) land too
      // The conversation is open on screen — their new message is read on arrival.
      if (eventType === 'INSERT' && row.sender_id !== myId) {
        api.markMessagesRead(matchId).catch(() => {});
      }
    });
  };

  const respondCourt = (threadId, msgIndex, accept) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    if (!thread) return;
    const msg = thread.msgs[msgIndex];
    if (!msg || msg.kind !== 'court') return;
    const setStatus = (status) => setThreads((ts) => ts.map((t) => (t.id === threadId
      ? { ...t, msgs: t.msgs.map((m, i) => (i === msgIndex ? { ...m, status } : m)) }
      : t)));
    const before = msg.status || 'proposed';
    setStatus(accept ? 'accepted' : 'declined');
    // The other person is being told whether to show up somewhere. If the
    // answer never reaches the server, put the card back the way it was and
    // say so, rather than leaving them waiting at a court.
    if (live && msg.id) {
      api.respondCourtTime(msg.id, accept).catch(() => {
        setStatus(before);
        Alert.alert('Couldn\u2019t send your answer', 'Check your connection and tap Accept or Decline again.');
      });
    }
  };

  const markRead = (id) => {
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, unread: false } : t)));
    if (live) {
      resolveMatchId(id).then((matchId) => {
        if (matchId) api.markMessagesRead(matchId).catch(() => {});
      });
    }
  };

  // ---------- safety ----------

  // Blocking and reporting are the two things in here that absolutely must not
  // fail quietly. Someone who taps Block and sees the person disappear will
  // believe they are protected; if the call failed, they are not, and they have
  // no way of knowing. The same goes for a report that never reaches the queue.
  // Everything else in this file can afford to be fire-and-forget. These can't.
  const block = (id) => {
    const wasSaved = saved[id];
    setBlocked((b) => ({ ...b, [id]: true }));
    persistSaved({ ...saved, [id]: false });
    setMatches((m) => m.filter((x) => x !== id));
    setThreads((ts) => ts.filter((t) => t.id !== id));
    if (!live) return;
    api.blockUser(id)
      .then(() => refreshDeck(mode))
      .catch(() => {
        // Put them back rather than leave a block that only exists on screen.
        setBlocked((b) => { const next = { ...b }; delete next[id]; return next; });
        if (wasSaved) persistSaved({ ...saved, [id]: true });
        refreshMatchesAndThreads();
        Alert.alert(
          'Couldn’t block them',
          'Nothing was saved, so they can still see you. Check your connection and try again — if it keeps failing, email hello@rsvplayapp.com and we’ll do it for you.'
        );
      });
  };

  // `where`: true (or 'deck') from the deck, 'event' for someone met at an
  // event (the crew list), anything else from a conversation.
  const report = (id, where) => {
    const fromDeck = where === true || where === 'deck';
    if (fromDeck) setSeen((s) => ({ ...s, [id]: true }));
    // Wherever the report came from, they leave the crew list at once.
    setReported((r) => ({ ...r, [id]: true }));
    if (!live) return;
    api.reportUser(id, 'Reported in-app', fromDeck ? 'deck' : where === 'event' ? 'event' : 'chat')
      .catch(() => {
        Alert.alert(
          'Couldn’t send the report',
          'It didn’t reach us, so nobody has seen it. Try again, or email hello@rsvplayapp.com — include their name and we’ll take it from there.'
        );
      });
    // B-04: permanently hide a reported profile from the reporter's deck.
    // Best-effort on purpose: this is a convenience, not the safety action.
    ALL_MODES.forEach((m) => api.swipe(id, m, 'pass').catch(() => {}));
  };

  // ---------- events ----------

  // ---------- places to play ----------

  // The database list when it has loaded for the cities selected now;
  // otherwise the list bundled with the app (always, in the demo build).
  // Returned per city so the screen can group.
  const courtsFor = (citySlug) => (
    live && liveCourts && liveCourts.key === eventCityKey
      ? liveCourts.rows.filter((c) => c.city === citySlug)
      : (COURTS_BY_CITY[citySlug] || []).map((c) => ({ sport: 'pickleball', ...c }))
  );
  // A court worth proposing to someone you've just matched with: a free public
  // court for the sport you're proposing, so nobody turns up with a tennis
  // racquet at a pickleball-only park. Null when the city has none listed.
  const suggestedCourt = (citySlug, sport) => {
    const want = sport ? String(sport).toLowerCase() : null;
    const open = courtsFor(citySlug).filter((c) => c.access === 'public' && (!want || c.sport === want));
    return open.length ? open[0].name : null;
  };

  // ---------- tournaments ----------

  const tournaments = live
    ? (liveTournaments && liveTournaments.key === eventCityKey ? liveTournaments.rows : [])
    // As live: one you've entered stays listed after you drop its city.
    : demoTournaments.filter((t) => t.entered || eventCities.includes(t.city));

  // A name for a bracket line. Teams show both names, as on their card.
  const playerName = (id) => {
    if (!id) return '';
    if (id === 'me' || (live && id === myId)) return (user && (user.isTeam && user.partnerName ? `${user.name} & ${user.partnerName}` : user.name)) || 'You';
    if (!live) {
      const pl = TOURNAMENT_PLAYERS.find((x) => x.id === id);
      return pl ? pl.name : 'Player';
    }
    // Someone you've blocked goes unnamed at once, before the next refresh.
    if (blocked[id]) return 'Player';
    return tournamentNames[id] || 'Player';
  };
  const isMe = (id) => !!id && (live ? id === myId : id === 'me');

  const tournamentError = (err, fallback) => {
    const msg = (err && err.message) || '';
    // The server's own sentences are written to be shown; anything else isn't.
    Alert.alert(fallback, /full|closed|draw|suspended|organiser|players|winner|already|cancelled|exist|profile|sign in|bye|waiting/i.test(msg) ? msg : 'Check your connection and try again.');
  };

  const joinTournament = (id) => {
    if (live) {
      api.joinTournament(id).then(refreshTournaments).catch((e) => { tournamentError(e, 'Couldn\u2019t enter you'); refreshTournaments(); });
      return;
    }
    setDemoTournaments((list) => list.map((t) => {
      if (t.id !== id || t.entered || t.status !== 'registration' || t.entryCount >= t.max) return t;
      return { ...t, entered: true, entries: [...t.entries, { id: 'me', seed: null }], entryCount: t.entryCount + 1 };
    }));
  };

  const leaveTournament = (id) => {
    if (live) {
      api.leaveTournament(id).then(refreshTournaments).catch((e) => { tournamentError(e, 'Couldn\u2019t withdraw you'); refreshTournaments(); });
      return;
    }
    setDemoTournaments((list) => list.map((t) => (
      t.id === id && t.status === 'registration' && t.entered
        ? { ...t, entered: false, entries: t.entries.filter((e) => e.id !== 'me'), entryCount: Math.max(0, t.entryCount - 1) }
        : t)));
  };

  // Demo only: there is no organiser to make the draw, so the member can.
  // Live, the desk does it (start_tournament) and this does nothing.
  const drawTournament = (id) => {
    if (live) return;
    setDemoTournaments((list) => list.map((t) => {
      if (t.id !== id || t.status !== 'registration' || t.entries.length < 2) return t;
      // A fair shuffle: sorting on a random comparator favours some orders.
      const order = bracketShuffle(t.entries);
      const br = buildBracket(order.map((e) => e.id));
      return {
        ...t, status: 'in_progress', size: br.size, rounds: br.rounds, matches: br.matches,
        entries: order.map((e, i) => ({ ...e, seed: i + 1 })), entryCount: order.length,
      };
    }));
  };

  // Who may record a match: live, only its two players (the server enforces
  // it); in the demo anyone, since the sample players can't.
  const canReportMatch = (m) => !m.bye && !m.winner && !m.reported && !!m.a && !!m.b && (!live || isMe(m.a) || isMe(m.b));

  const reportMatch = (tournamentId, matchId, winnerId, score) => {
    if (live) {
      api.reportMatchResult(matchId, winnerId, score).then(refreshTournaments)
        .catch((e) => { tournamentError(e, 'Couldn\u2019t record that result'); refreshTournaments(); });
      return;
    }
    setDemoTournaments((list) => list.map((t) => {
      if (t.id !== tournamentId) return t;
      const br = { size: t.size, rounds: t.rounds, champion: null, matches: t.matches.map((m) => ({ ...m })) };
      const problem = bracketRecord(br, matchId, winnerId, score, false);
      if (problem) { Alert.alert('Couldn\u2019t record that result', problem); return t; }
      return {
        ...t, matches: br.matches, championId: br.champion, status: br.champion ? 'completed' : t.status,
        completedAt: br.champion ? new Date().toISOString() : t.completedAt,
      };
    }));
  };

  // Demo meetups are scoped the same way as live ones: your cities' only.
  const demoEvents = EVENTS.map((e, idx) => ({ e, idx })).filter(({ e }) => eventCities.includes(e.city || DEFAULT_CITY)).map(({ e, idx }) => ({
    id: e.id, week: e.week, dow: e.dow, dom: e.dom, title: e.title, venue: e.venue,
    time: e.time, sport: e.sport, level: e.level, city: e.city || DEFAULT_CITY,
    spotsLeft: joined[e.id] ? e.spots - 1 : e.spots,
    going: !!joined[e.id],
    goingCount: 3 + ((idx * 5) % 7) + (joined[e.id] ? 1 : 0),
    desc: e.desc || '',
    startsAt: null,
    priceCents: typeof e.priceCents === 'number' ? e.priceCents : null,
    clubDiscountPct: e.clubDiscountPct > 0 ? e.clubDiscountPct : 0,
    generalOpensAt: null,
    waiverAccepted: !!joined[e.id] && !!demoWaivers[e.id],
    checkedIn: !!joined[e.id] && !!demoCheckins[e.id],
  }));

  // Demo-only attendee preview for the event detail screen (live shows counts).
  // Someone the member blocked or reported is never shown, here or anywhere.
  const eventAttendees = (eventId) => {
    if (live) return [];
    const idx = EVENTS.findIndex((e) => e.id === eventId);
    if (idx === -1) return [];
    return [0, 4, 8].map((o) => PROFILES[(idx * 3 + o) % PROFILES.length])
      .filter((p) => !blocked[p.id] && !reported[p.id]);
  };
  const events = live ? (liveEvents || []) : demoEvents;

  // One event in the live list, patched in place. A list that has been cleared
  // meanwhile (a city change) stays cleared.
  const patchEvent = (id, fn) => setLiveEvents((list) => (list ? list.map((e) => (e.id === id ? fn(e) : e)) : list));

  // Set the member's RSVP and say whether it landed. The button flips at once
  // so it feels instant, but the server has the last word — an event can fill
  // up between loading the list and tapping. Swallowing the failure used to
  // leave the card saying "Going" for an RSVP that was refused, which is how
  // someone shows up to an event they were never on the list for.
  const setRsvp = (id, going) => {
    if (!liveEvents) return Promise.resolve(false);
    const ev = liveEvents.find((e) => e.id === id);
    if (!ev) return Promise.resolve(false);
    if (ev.going === going) return Promise.resolve(true);
    const hadWaiver = ev.waiverAccepted;
    // Leaving deletes the RSVP row, and the waiver stamp goes with it.
    const apply = (g, waiver) => patchEvent(id, (e) => ({
      ...e, going: g, spotsLeft: Math.max(0, e.spotsLeft + (g ? -1 : 1)), waiverAccepted: waiver,
    }));
    apply(going, going ? hadWaiver : false);
    if (!going) delete waiverRef.current[id];
    return api.rsvp(id, going).then(() => true, (err) => {
      apply(!going, hadWaiver);
      const full = /full/i.test((err && err.message) || '');
      Alert.alert(
        full ? 'That event just filled up' : 'Couldn’t update your RSVP',
        full
          ? 'Someone took the last spot first. Nothing was booked — try another event, or check back in case a spot opens.'
          // The database's own reason when it refused on purpose (Club early
          // access, a suspension); otherwise it was the connection.
          : serverSaid(err) || 'Check your connection and try again.'
      );
      return false;
    });
  };

  const toggleJoin = (id) => {
    if (live) {
      const ev = liveEvents && liveEvents.find((e) => e.id === id);
      // Checked in is a record that you were there; it isn't un-RSVP'd.
      if (!ev || ev.checkedIn) return;
      setRsvp(id, !ev.going);
      return;
    }
    if (demoCheckins[id]) return;
    if (joined[id]) {
      // As live: leaving takes the waiver acceptance with it.
      setDemoWaivers((w) => ({ ...w, [id]: false }));
    }
    setJoined((j) => ({ ...j, [id]: !j[id] }));
  };

  // ---------- waiver, check-in, crew ----------

  // The member has read and accepted the event waiver. The stamp is the
  // server's to write (accept_event_waiver); check-in is refused without it.
  // Resolves true once it is on record.
  const acceptWaiver = async (id) => {
    if (!live) {
      setDemoWaivers((w) => ({ ...w, [id]: true }));
      waiverRef.current[id] = true;
      return true;
    }
    try {
      await api.acceptEventWaiver(id);
    } catch (e) {
      Alert.alert(
        'Couldn’t save your waiver',
        serverSaid(e) || 'It didn’t reach us, so it isn’t on record. You’ll be asked again before you check in.'
      );
      return false;
    }
    waiverRef.current[id] = true;
    patchEvent(id, (e) => ({ ...e, waiverAccepted: true }));
    return true;
  };

  // RSVP, having accepted the waiver on screen: the RSVP first (the waiver is
  // stamped onto it), then the waiver. If the RSVP lands and the waiver
  // doesn't, the member is still going — and is asked again at check-in.
  // Resolves true when the member is on the list.
  const rsvpWithWaiver = async (id) => {
    if (!live) {
      setJoined((j) => ({ ...j, [id]: true }));
      await acceptWaiver(id);
      return true;
    }
    const ok = await setRsvp(id, true);
    if (!ok) return false;
    await acceptWaiver(id);
    return true;
  };

  // Check in with the code the host reads out. Resolves true once checked in.
  // The waiver comes first: without it on record nothing is sent, because the
  // server would only refuse. Anything the server does refuse is shown in its
  // own words — "That code isn't right.", "Check-in opens an hour before the
  // event." — rather than blamed on the connection.
  const checkIn = async (id, code) => {
    const title = 'Couldn’t check you in';
    const ev = (live ? (liveEvents || []) : demoEvents).find((e) => e.id === id);
    if (!ev) return false;
    if (ev.checkedIn) return true;
    if (!ev.going) { Alert.alert(title, 'RSVP before you check in.'); return false; }
    if (!ev.waiverAccepted && !waiverRef.current[id]) { Alert.alert(title, 'Accept the event waiver first.'); return false; }
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) { Alert.alert(title, 'Enter the code the host reads out.'); return false; }
    if (!live) {
      // Demo: there is no host and no real code, so any 4 to 8 letters or
      // digits stands in for one. Nothing is recorded anywhere.
      if (!/^[0-9A-Z]{4,8}$/.test(clean)) { Alert.alert(title, 'That code isn’t right.'); return false; }
      setDemoCheckins((c) => ({ ...c, [id]: true }));
      return true;
    }
    try {
      await api.checkInToEvent(id, clean);
    } catch (e) {
      const said = serverSaid(e);
      // The server has no waiver on record after all: ask for it again next time.
      if (said && /waiver/i.test(said)) {
        delete waiverRef.current[id];
        patchEvent(id, (x) => ({ ...x, waiverAccepted: false }));
      }
      Alert.alert(title, said || 'Check your connection and try again.');
      return false;
    }
    patchEvent(id, (e) => ({ ...e, checkedIn: true, going: true }));
    // Now there is a crew to show: everyone else who checked in.
    refreshCrew();
    return true;
  };

  // Demo crew: for each event the member has "checked in" to, the sample
  // players shown as attending it, in the shape get_my_crew returns. There is
  // no server in the demo, so this plays its part — including its rule for the
  // dating flag: both people in Date mode, each what the other is looking
  // for, and inside the member's age range, or false. Everything downstream (mapCrewRow, the screens) only ever
  // reads the flag, exactly as it does live.
  const demoCrew = (() => {
    const mutual = (p) => (
      !!user && !user.isTeam && (user.modes || []).includes('date') && !!user.gender
      && DEMO_DATE_MODE_ON[p.id] === true && !!p.gender
      && (user.seeking || []).includes(p.gender) && (p.seeking || []).includes(user.gender)
      && (typeof p.age !== 'number' || (p.age >= prefs.ageMin && p.age <= prefs.ageMax))
    );
    const rows = [];
    const taken = {};
    EVENTS.forEach((e) => {
      if (!joined[e.id] || !demoCheckins[e.id]) return;
      eventAttendees(e.id).forEach((p) => {
        if (taken[p.id]) return;
        taken[p.id] = true;
        rows.push({
          user_id: p.id, first_name: p.name, event_id: e.id, event_title: e.title, event_starts_at: null,
          added: !!demoCrewAdded[p.id],
          also_open_to_dating: mutual(p),
        });
      });
    });
    return rows.map(mapCrewRow);
  })();

  // Someone you block leaves the list at once, before the next refresh.
  const crew = (live ? (liveCrew || []) : demoCrew).filter((c) => !blocked[c.id] && !reported[c.id]);

  // Keep someone on the crew list, or take them off. Shown at once; put back,
  // with the reason, if the server refuses.
  const setCrewAdded = (id, added) => {
    if (!live) { setDemoCrewAdded((a) => ({ ...a, [id]: added })); return; }
    const flip = (v) => setLiveCrew((list) => (list ? list.map((c) => (c.id === id ? { ...c, added: v } : c)) : list));
    flip(added);
    (added ? api.addToCrew(id) : api.removeFromCrew(id)).catch((e) => {
      flip(!added);
      Alert.alert(
        added ? 'Couldn’t add them to your crew' : 'Couldn’t take them off your crew',
        serverSaid(e) || 'Check your connection and try again.'
      );
    });
  };
  const addToCrew = (id) => setCrewAdded(id, true);
  const removeFromCrew = (id) => setCrewAdded(id, false);

  // ---------- leagues ----------

  const leagues = live
    ? (liveLeagues && liveLeagues.key === eventCityKey ? liveLeagues.rows : [])
    // Like the live list, the member's cities' ladders only. (Unlike
    // tournaments, a ladder in a city you have dropped is not listed even if
    // you are still on it: the server has no "my ladders" list to ask. Add the
    // city back and it is there, rung intact.)
    : demoLeagues.filter((l) => eventCities.includes(l.city));

  const leagueError = (err, fallback) => {
    Alert.alert(fallback, serverSaid(err) || 'Check your connection and try again.');
  };

  // The member's open challenge with this player on this ladder, if any.
  const leagueChallengeWith = (league, row) => (
    (row && row.id && (league.challenges || []).find((c) => c.challengerId === row.id || c.challengedId === row.id)) || null
  );

  // Whether "Challenge" belongs on this row: you're on the ladder, they're
  // above you by no more than two rungs, they aren't hidden from you, and the
  // two of you don't already have a challenge to play. The server checks all
  // of it again.
  const canChallenge = (league, row) => (
    !!league && !!row && league.joined && !row.isMe && !!row.id
    && row.rung < league.myRung && league.myRung - row.rung <= LADDER_REACH
    && !leagueChallengeWith(league, row)
  );

  const demoMe = () => (user && user.name) || 'You';
  const patchDemoLeague = (id, fn) => setDemoLeagues((list) => list.map((l) => {
    if (l.id !== id) return l;
    const next = fn(l);
    const standings = next.standings.map((r) => ({ ...r, isMe: r.id === 'me', name: r.id === 'me' ? demoMe() : r.name }));
    const me = standings.find((r) => r.isMe) || null;
    return { ...next, standings, joined: !!me, myRung: me ? me.rung : null };
  }));

  const joinLeague = (id) => {
    if (live) {
      api.joinLeague(id).then(refreshLeagues).catch((e) => { leagueError(e, 'Couldn’t add you to the ladder'); refreshLeagues(); });
      return;
    }
    patchDemoLeague(id, (l) => ({ ...l, standings: ladderJoin(l.standings, 'me', demoMe()) }));
  };

  const leaveLeague = (id) => {
    if (live) {
      api.leaveLeague(id).then(refreshLeagues).catch((e) => { leagueError(e, 'Couldn’t take you off the ladder'); refreshLeagues(); });
      return;
    }
    // As the server: open challenges go with you.
    patchDemoLeague(id, (l) => ({ ...l, standings: ladderLeave(l.standings, 'me'), challenges: [] }));
  };

  const challengeInLeague = (leagueId, targetId) => {
    if (live) {
      api.challengeInLeague(leagueId, targetId).then((challengeId) => {
        if (challengeId) {
          madeChallengesRef.current = madeChallengesRef.current
            .filter((c) => c.id !== challengeId)
            .concat([{ id: challengeId, leagueId, challengerId: myId, challengedId: targetId }]);
        }
        return refreshLeagues();
      }).catch((e) => { leagueError(e, 'Couldn’t send that challenge'); refreshLeagues(); });
      return;
    }
    const league = demoLeagues.find((l) => l.id === leagueId);
    if (!league) return;
    const problem = ladderChallengeProblem(league.standings, 'me', targetId, league.challenges);
    if (problem) { Alert.alert('Couldn’t send that challenge', problem); return; }
    const cid = `demo-challenge-${(demoChallengeSeqRef.current += 1)}`;
    patchDemoLeague(leagueId, (l) => ({ ...l, challenges: [...l.challenges, { id: cid, leagueId, challengerId: 'me', challengedId: targetId }] }));
  };

  // Either player records who won; the server moves the rungs.
  const reportLeagueResult = (leagueId, challengeId, winnerId) => {
    if (live) {
      api.reportLeagueResult(challengeId, winnerId).then(() => {
        madeChallengesRef.current = madeChallengesRef.current.filter((c) => c.id !== challengeId);
        return refreshLeagues();
      }).catch((e) => { leagueError(e, 'Couldn’t record that result'); refreshLeagues(); });
      return;
    }
    const league = demoLeagues.find((l) => l.id === leagueId);
    const ch = league && league.challenges.find((c) => c.id === challengeId);
    if (!ch) return;
    const res = ladderRecord(league.standings, ch.challengerId, ch.challengedId, winnerId);
    if (res.problem) { Alert.alert('Couldn’t record that result', res.problem); return; }
    patchDemoLeague(leagueId, (l) => ({ ...l, standings: res.list, challenges: l.challenges.filter((c) => c.id !== challengeId) }));
  };

  // ---------- notifications ----------

  const clearNotifs = () => {
    setNotifs([]);
    if (live) api.markNotificationsRead().catch(() => {});
  };

  // ---------- top picks ----------
  // The deck is already ranked by the matching score (ace received, shared
  // sport, skill closeness, recent activity, proximity, verified), so the
  // best candidates are simply the top of it. This surfaces the first five
  // as explicit picks, each with the reason it was chosen — otherwise the
  // ranking is invisible and reads as a random order.
  const pickReason = (p) => {
    const mine = (user && user.sports) || [];
    const shared = (p.sports || []).filter((s) => mine.includes(s));
    if (mode === 'play' && shared.length && user && p.skill === user.skill) {
      return `${shared[0]} at your level — an even match`;
    }
    if (shared.length > 1) return `Plays ${shared.slice(0, 2).join(' and ')} like you`;
    if (shared.length) return `Also plays ${shared[0]}`;
    const near = distanceReason(p.dist);
    if (near) return near;
    if (p.isNew) return 'New to RSVPlay this week';
    if (p.verified) return 'Verified player nearby';
    return 'Worth a look';
  };

  const TOP_PICK_COUNT = 5;
  const topPicks = (() => {
    const source = live
      ? liveDeck.slice(liveSkipFrom(liveIndex))
      : PROFILES.slice(nextEligibleIndex(deckPos)).filter(eligible);
    return source
      .filter((p) => !blocked[p.id] && !seen[p.id])
      .slice(0, TOP_PICK_COUNT)
      .map((p) => ({ ...p, reason: pickReason(p) }));
  })();

  // Unified photo list for the Profile grid: live = server rows (with
  // moderation status); demo = the local list, always "approved".
  const photos = live
    ? (myPhotos || [])
    : demoPhotoList(user).map((u, i) => ({ position: i, url: u, status: 'approved' }));

  // Where the app should open. Waits for both the local cache and the
  // session check, so a signed-in phone never flashes the welcome screen.
  const bootRoute = (() => {
    if (!hydrated || !sessionChecked) return null;   // still deciding
    if (isBackendConfigured && session) return user ? 'Main' : (needsOnboarding ? 'Onboarding' : null);
    return user && !isBackendConfigured ? 'Main' : 'Welcome';
  })();

  // What the screens read: the real thread plus anything stranded in the
  // outbox, appended at the end. Internals keep using `threads` — the raw
  // list is what matches the server, and respondCourt indexes into it.
  const visibleThreads = useMemo(() => {
    if (!Object.keys(outbox).some((k) => (outbox[k] || []).length)) return threads;
    return threads.map((t) => ((outbox[t.id] || []).length
      ? { ...t, msgs: [...t.msgs, ...outbox[t.id]] }
      : t));
  }, [threads, outbox]);

  const value = {
    user, hydrated, bootRoute, saveUser, signOut,
    session, live, isBackendConfigured,
    requestCode, verifyCode, signInWithProvider, finishOnboarding,
    requestPhoneCode, verifyPhoneCode,
    updateBio, updatePrefs, updateModes, updateDating, updatePlay, updateFriendsPref, updateTeam,
    photos, addPhoto, removePhoto, makePrimary,
    topPicks,
    cities: CITIES, cityLabel, updateCity, updateCities, toggleCity, detectCity,
    devices, deviceKey, refreshDevices, signOutDevice, revokedHere,
    // A profile that arrives after the deadline still counts: showing the
    // error over a loaded profile would be its own kind of lie.
    bootError: bootError && !user, retryBoot,
    // A suspended member gets an empty deck and a wall of refused writes. Say
    // what happened instead of letting the app look broken.
    suspended: !!(live && user && user.suspendedAt),
    suspendedReason: (user && user.suspendedReason) || '',
    mode, setMode,
    currentProfile, advance, rewind, deckError, peekNext, resetDeck,
    retryDeck: () => refreshDeck(mode),
    swipeLike, swipePass, likeSaved, registerLike,
    saved, setSaved: persistSaved, seen, setSeen, blocked, block, report,
    matches, threads: visibleThreads, profileById, ensureThread,
    sendMessage, retryMessage, discardMessage, subscribeThread, respondCourt, markRead,
    pendingMatch, clearPendingMatch: () => setPendingMatch(null),
    events, toggleJoin, joined, eventAttendees, eventCities, courtsFor, suggestedCourt,
    reloadCourts: () => { if (live) { refreshCourts(); refreshTournaments(); refreshLeagues(); } },
    rsvpWithWaiver, acceptWaiver, checkIn,
    crew, addToCrew, removeFromCrew, reloadCrew: () => { if (live) refreshCrew(); },
    leagues, joinLeague, leaveLeague, challengeInLeague, reportLeagueResult, canChallenge, leagueChallengeWith,
    // 'free' | 'plus' | 'club'. Read-only: the desk sets it, the app shows it.
    tier: (user && user.tier) || 'free',
    tournaments, playerName, isMe, joinTournament, leaveTournament, drawTournament, canReportMatch, reportMatch,
    eventsLoading: live && liveEvents === null && !eventsError, eventsError: live && eventsError, retryEvents: () => refreshEvents(),
    notifs, clearNotifs, prefs,
  };

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}

export const useApp = () => useContext(AppState);
