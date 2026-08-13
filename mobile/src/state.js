// App-wide state, dual-mode:
//  - DEMO: no backend configured (or not signed in) → seeded local data.
//  - LIVE: Supabase configured + session → every action reads/writes the
//    real backend (schema in supabase/migrations/, client in src/api/backend.js).
// Screens call the same actions in both modes.
// This revision addresses the QA findings in outreach/launch/bugs.md
// (B-01…B-17); fixes are tagged inline.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROFILES, THREADS, CANNED_REPLIES, NOTIFICATIONS, EVENTS } from './data/seed';
import { supabase, isBackendConfigured } from './lib/supabase';
import * as api from './api/backend';
import * as social from './lib/socialAuth';
import { CITIES, DEFAULT_CITY, cityBySlug, cityLabel, nearestCity } from './data/cities';
import { getDeviceKey, getDeviceName, getPlatform } from './lib/device';
import { registerForPush } from './lib/push';
import { getCoarseLocation } from './lib/location';

const STORE_KEY = '40love.profile';
const SAVED_KEY = '40love.saved';
// Discovery prefs used to live only in memory, so a member set their age
// range and distance, reopened the app, and found the defaults again.
const PREFS_KEY = '40love.prefs';
const DEFAULT_PREFS = { radius: 15, ageMin: 25, ageMax: 55, mySportsOnly: false };
const AppState = createContext(null);

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
    verified: !!p.verified_at,
    avail: p.availability_note || '',
    bio: p.bio || '',
    isTeam: !!p.is_team,
    partnerName: p.partner_name || '',
    partnerAge: p.is_team ? (p.partner_age != null ? p.partner_age : ageFromBirthdate(p.partner_birthdate)) : null,
  };
}

function mapMsgRow(row, myId) {
  const cp = row.court_payload || {};
  const base = { id: row.id, who: row.sender_id === myId ? 'me' : 'them', when: fmtWhen(row.sent_at), read: !!row.read_at };
  if (row.kind === 'court_time') {
    return { ...base, kind: 'court', court: cp.venue, day: cp.day, time: cp.time, sport: cap(cp.sport), status: cp.status || 'proposed' };
  }
  return { ...base, text: row.body };
}

const NOTIF_ICONS = { match: 'heart', message: 'chatbubble', court_time: 'tennisball', event_reminder: 'calendar', system: 'notifications' };
const ALL_MODES = ['date', 'play', 'friends'];
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
  const [mode, setMode] = useState('date');

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
  const [seen, setSeen] = useState({});
  const [matches, setMatches] = useState(['maya', 'sam', 'priya']);
  const [threads, setThreads] = useState(THREADS);
  const [joined, setJoined] = useState({});
  const [replied, setReplied] = useState({});
  const [notifs, setNotifs] = useState(NOTIFICATIONS.map((n) => ({ ...n })));
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [liveEvents, setLiveEvents] = useState(null);
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

  const cacheRef = useRef({});        // userId → mapped profile (live)
  const matchIdsRef = useRef({});     // otherUserId → matchId (live; B-01)
  const threadsRef = useRef(threads); // avoid stale closures in async sends (B-01)
  const deckReqRef = useRef(0);       // refresh staleness guard (B-16)
  const prefsTimerRef = useRef(null); // debounce pref-driven deck refresh (B-12)
  const celebratedRef = useRef({});   // matchId → true (Match Point modal already shown; B-21 dedupe)

  useEffect(() => { threadsRef.current = threads; }, [threads]);

  const live = isBackendConfigured && !!session;
  const myId = session && session.user ? session.user.id : null;

  // ---------- hydration ----------

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(STORE_KEY), AsyncStorage.getItem(SAVED_KEY), AsyncStorage.getItem(PREFS_KEY)])
      .then(([rawUser, rawSaved, rawPrefs]) => {
        if (rawPrefs) {
          const p = JSON.parse(rawPrefs);
          if (p && typeof p === 'object') setPrefs({ ...DEFAULT_PREFS, ...p });
        }
        if (rawUser) {
          const u = JSON.parse(rawUser);
          if (u && typeof u.name === 'string') {
            setUser(u);
            if (u.modes && u.modes.length) setMode(u.modes[0]);
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
    AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)).catch(() => {});
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
    if (!live || user || !hydrated) return;
    let alive = true;
    bootstrapAfterSignIn()
      .then((r) => { if (alive && !r.hasProfile) setNeedsOnboarding(true); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, hydrated, user]);

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
    try {
      const rows = await api.listEvents((user && user.city) || DEFAULT_CITY);
      const week = (ts) => {
        const days = (new Date(ts) - new Date()) / 86400000;
        return days <= 7 ? 'This week' : days <= 14 ? 'Next week' : 'Coming up';
      };
      setLiveEvents(rows.map((e) => {
        const d = new Date(e.starts_at);
        const rsvps = e.event_rsvps || [];
        const going = rsvps.filter((r) => r.status === 'going' || r.status === 'checked_in');
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
          spotsLeft: Math.max(0, e.capacity - going.length), // B-13
          going: going.some((r) => r.user_id === myId),
          goingCount: going.length,
          desc: '',
        };
      }));
    } catch (e) { /* keep current state */ }
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
          : 'Update from 40/LOVE.';
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
    api.updateMyProfile({ last_active_at: new Date().toISOString() }).catch(() => {});
    getDeviceKey().then((key) => registerForPush((t, p) => api.registerPushToken(t, p, key))).catch(() => {});
    // Refresh coarse (~1 km) location so distances and the radius filter work;
    // refetch the deck once it lands.
    getCoarseLocation().then((loc) => {
      if (loc) {
        api.updateMyProfile({ approx_lat: loc.lat, approx_lng: loc.lng })
          .then(() => refreshDeck(mode))
          .catch(() => {});
      }
    });
    refreshMatchesAndThreads().then(refreshNotifs);
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
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(u)).catch(() => {});
  };

  const updateBio = (bio) => {
    if (user) saveUser({ ...user, bio });
    if (live) api.updateMyProfile({ bio }).catch(() => {});
  };

  const updatePhoto = (uri) => {
    if (user) saveUser({ ...user, photo: uri, photos: [uri, ...((user.photos || []).slice(1))] });
    if (live) api.uploadProfilePhoto(uri, 0).then(refreshMyPhotos).catch(() => {});
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
        AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
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
    if (user) saveUser({ ...user, gender, seeking });
    if (live) {
      api.updateMyProfile({ gender: gender || null, seeking: seeking || [] }).catch(() => {});
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(mode), 700);
    }
  };

  const updatePlay = (playGames, playPref) => {
    const games = playGames && playGames.length ? playGames : ALL_GAMES;
    if (user) saveUser({ ...user, playGames: games, playPref: playPref || 'everyone' });
    if (live) {
      api.updateMyProfile({ play_games: games, play_pref: playPref || 'everyone' }).catch(() => {});
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

  const updateCity = (citySlug) => {
    if (!cityBySlug(citySlug) || !user) return;
    saveUser({ ...user, city: citySlug });
    if (live) {
      api.updateMyProfile({ city: citySlug }).catch(() => {});
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => { refreshDeck(mode); refreshEvents(); }, 700);
    }
  };

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
    saveUser(next);
    if (next.modes.indexOf(mode) === -1 && next.modes.length) setMode(next.modes[0]);
    if (live) {
      api.updateMyProfile({
        is_team: next.isTeam,
        partner_name: next.partnerName,
        partner_birthdate: next.partnerBirthdate,
        partner_gender: next.partnerGender,
        modes: next.modes,
      }).catch(() => {});
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(next.modes[0] || mode), 700);
    }
  };

  const updateFriendsPref = (friendsPref) => {
    if (user) saveUser({ ...user, friendsPref: friendsPref || 'everyone' });
    if (live) {
      api.updateMyProfile({ friends_pref: friendsPref || 'everyone' }).catch(() => {});
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(mode), 700);
    }
  };

  const updateModes = (modes) => {
    if (user) saveUser({ ...user, modes });
    if (live) api.updateMyProfile({ modes }).catch(() => {});
    if (!modes.includes(mode) && modes.length) setMode(modes[0]);
  };

  const updatePrefs = (next) => {
    // B-11: keep the range valid so the server write can't be rejected
    const ageMin = Math.min(next.ageMin, next.ageMax);
    const ageMax = Math.max(next.ageMin, next.ageMax);
    const clean = { ...next, ageMin, ageMax };
    setPrefs(clean);
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify(clean)).catch(() => {});
    if (live) {
      api.updateMyProfile({
        radius_mi: clean.radius,
        age_min: clean.ageMin,
        age_max: clean.ageMax,
        same_sports_only: clean.mySportsOnly,
      }).catch(() => {});
      // B-12: refetch the deck under the new prefs (debounced — sliders/typing)
      if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current);
      prefsTimerRef.current = setTimeout(() => refreshDeck(mode), 700);
    }
  };

  const signOut = () => {
    if (isBackendConfigured) api.signOut().catch(() => {});
    // Also clear the native Google session, so the next sign-in offers the
    // account picker instead of silently reusing the last account.
    social.signOutProviders().catch(() => {});
    AsyncStorage.removeItem(STORE_KEY).catch(() => {});
    AsyncStorage.removeItem(SAVED_KEY).catch(() => {});
    setUser(null);
    setMode('date');
    setDeckPos(0);
    setHistory([]);
    setLikeCount(0);
    setLiveDeck([]);
    setLiveIndex(0);
    setDeckError(false);
    setSaved({});
    setBlocked({});
    setSeen({});
    setMatches(['maya', 'sam', 'priya']);
    setThreads(THREADS);
    setNotifs(NOTIFICATIONS.map((n) => ({ ...n })));
    setPrefs(DEFAULT_PREFS);
    AsyncStorage.removeItem(PREFS_KEY).catch(() => {});
    setLiveEvents(null);
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
    if (isBackendConfigured) await api.startPhoneVerification(e164);
    // Demo mode: no SMS is sent; any 6-digit code verifies.
    return e164;
  };

  const verifyPhoneCode = async (e164, code) => {
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code.');
    if (isBackendConfigured) {
      const ok = await api.confirmPhoneVerification(e164, code);
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
      city: remote.city || DEFAULT_CITY,
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
    if (remote.modes && remote.modes.length) setMode(remote.modes[0]);
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
        approxLat: loc ? loc.lat : null,
        approxLng: loc ? loc.lng : null,
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
      await api.setMySports(
        draft.sports.map((s) => ({ sport: s.toLowerCase(), level: draft.skill.toLowerCase(), ratingLabel: draft.rating || '' }))
      );
      // The phone was verified before this profile row existed — stamp it now.
      if (draft.phoneVerified) await api.syncPhoneVerification().catch(() => {});
      if (draft.photo) api.uploadProfilePhoto(draft.photo, 0).catch(() => {});
      // Push tokens reference the profile row, so the attempt made at sign-in
      // (before onboarding) could not have succeeded — retry now that it exists.
      getDeviceKey().then((key) => registerForPush((t, p) => api.registerPushToken(t, p, key))).catch(() => {});
    }
    saveUser(draft);
    setMode(draft.modes[0]);
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
    appendMsg(id, msg);
    if (live) {
      // B-01: never fall into the demo branch while live — resolve and send
      resolveMatchId(id).then((matchId) => {
        if (!matchId) return;
        if (msg.kind === 'court') {
          api.proposeCourtTime(matchId, { venue: msg.court, day: msg.day, time: msg.time, sport: (msg.sport || 'tennis').toLowerCase() }).catch(() => {});
        } else {
          api.sendTextMessage(matchId, msg.text).catch(() => {});
        }
      });
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
    setThreads((ts) => ts.map((t) => (t.id === threadId
      ? { ...t, msgs: t.msgs.map((m, i) => (i === msgIndex ? { ...m, status: accept ? 'accepted' : 'declined' } : m)) }
      : t)));
    if (live && msg.id) api.respondCourtTime(msg.id, accept).catch(() => {});
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

  const block = (id) => {
    setBlocked((b) => ({ ...b, [id]: true }));
    persistSaved({ ...saved, [id]: false });
    setMatches((m) => m.filter((x) => x !== id));
    setThreads((ts) => ts.filter((t) => t.id !== id));
    if (live) api.blockUser(id).then(() => refreshDeck(mode)).catch(() => {});
  };

  const report = (id, fromDeck) => {
    if (fromDeck) setSeen((s) => ({ ...s, [id]: true }));
    if (live) {
      api.reportUser(id, 'Reported in-app', fromDeck ? 'deck' : 'chat').catch(() => {});
      // B-04: permanently hide a reported profile from the reporter's deck
      ALL_MODES.forEach((m) => api.swipe(id, m, 'pass').catch(() => {}));
    }
  };

  // ---------- events ----------

  const demoEvents = EVENTS.map((e, idx) => ({
    id: e.id, week: e.week, dow: e.dow, dom: e.dom, title: e.title, venue: e.venue,
    time: e.time, sport: e.sport, level: e.level,
    spotsLeft: joined[e.id] ? e.spots - 1 : e.spots,
    going: !!joined[e.id],
    goingCount: 3 + ((idx * 5) % 7) + (joined[e.id] ? 1 : 0),
    desc: e.desc || '',
  }));

  // Demo-only attendee preview for expanded event cards (live shows counts).
  const eventAttendees = (eventId) => {
    if (live) return [];
    const idx = EVENTS.findIndex((e) => e.id === eventId);
    if (idx === -1) return [];
    return [0, 4, 8].map((o) => PROFILES[(idx * 3 + o) % PROFILES.length]);
  };
  const events = live ? (liveEvents || []) : demoEvents;

  const toggleJoin = (id) => {
    if (live) {
      if (!liveEvents) return;
      const ev = liveEvents.find((e) => e.id === id);
      if (!ev) return;
      const going = !ev.going;
      setLiveEvents((list) => list.map((e) => (e.id === id
        ? { ...e, going, spotsLeft: Math.max(0, e.spotsLeft + (going ? -1 : 1)) }
        : e)));
      api.rsvp(id, going).catch(() => {});
      return;
    }
    setJoined((j) => ({ ...j, [id]: !j[id] }));
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
    if (p.dist != null && p.dist <= 3) return `Just ${p.dist.toFixed(1)} miles away`;
    if (p.isNew) return 'New to 40/LOVE this week';
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

  const value = {
    user, hydrated, bootRoute, saveUser, signOut,
    session, live, isBackendConfigured,
    requestCode, verifyCode, signInWithProvider, finishOnboarding,
    requestPhoneCode, verifyPhoneCode,
    updateBio, updatePhoto, updatePrefs, updateModes, updateDating, updatePlay, updateFriendsPref, updateTeam,
    photos, addPhoto, removePhoto, makePrimary,
    topPicks,
    cities: CITIES, cityLabel, updateCity, detectCity,
    devices, deviceKey, refreshDevices, signOutDevice, revokedHere,
    mode, setMode,
    currentProfile, advance, rewind, deckError, peekNext, resetDeck,
    retryDeck: () => refreshDeck(mode),
    swipeLike, swipePass, likeSaved, registerLike,
    saved, setSaved: persistSaved, seen, setSeen, blocked, block, report,
    matches, threads, profileById, ensureThread,
    sendMessage, subscribeThread, respondCourt, markRead,
    pendingMatch, clearPendingMatch: () => setPendingMatch(null),
    events, toggleJoin, joined, eventAttendees,
    notifs, clearNotifs, prefs,
  };

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}

export const useApp = () => useContext(AppState);
