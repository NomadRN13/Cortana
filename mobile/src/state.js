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
import { registerForPush } from './lib/push';
import { getCoarseLocation } from './lib/location';

const STORE_KEY = '40love.profile';
const SAVED_KEY = '40love.saved';
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
  };
}

function mapProfileRow(p) {
  const sports = p.user_sports || [];
  return {
    id: p.id,
    name: p.first_name,
    age: ageFromBirthdate(p.birthdate),
    dist: null,
    sports: sports.map((s) => cap(s.sport)),
    skill: sports[0] ? cap(sports[0].level) : 'Intermediate',
    rating: sports[0] ? sports[0].rating_label : '',
    isNew: false,
    verified: !!p.verified_at,
    avail: p.availability_note || '',
    bio: p.bio || '',
  };
}

function mapMsgRow(row, myId) {
  const cp = row.court_payload || {};
  const base = { id: row.id, who: row.sender_id === myId ? 'me' : 'them', when: fmtWhen(row.sent_at) };
  if (row.kind === 'court_time') {
    return { ...base, kind: 'court', court: cp.venue, day: cp.day, time: cp.time, sport: cap(cp.sport), status: cp.status || 'proposed' };
  }
  return { ...base, text: row.body };
}

const NOTIF_ICONS = { match: 'heart', message: 'chatbubble', court_time: 'tennisball', event_reminder: 'calendar', system: 'notifications' };
const ALL_MODES = ['date', 'play', 'friends'];
const ALL_GAMES = ['singles', 'doubles', 'mixed_doubles'];

const prefOk = (pref, g) =>
  !pref || pref === 'everyone' || (pref === 'men' && g === 'man') || (pref === 'women' && g === 'woman');

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
  const [prefs, setPrefs] = useState({ radius: 15, ageMin: 25, ageMax: 55, mySportsOnly: false });
  const [liveEvents, setLiveEvents] = useState(null);

  const cacheRef = useRef({});        // userId → mapped profile (live)
  const matchIdsRef = useRef({});     // otherUserId → matchId (live; B-01)
  const threadsRef = useRef(threads); // avoid stale closures in async sends (B-01)
  const deckReqRef = useRef(0);       // refresh staleness guard (B-16)
  const prefsTimerRef = useRef(null); // debounce pref-driven deck refresh (B-12)

  useEffect(() => { threadsRef.current = threads; }, [threads]);

  const live = isBackendConfigured && !!session;
  const myId = session && session.user ? session.user.id : null;

  // ---------- hydration ----------

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(STORE_KEY), AsyncStorage.getItem(SAVED_KEY)])
      .then(([rawUser, rawSaved]) => {
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
    if (!isBackendConfigured) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- live loaders ----------

  const refreshDeck = async (m = mode) => {
    const req = ++deckReqRef.current; // B-16: drop out-of-order responses
    try {
      const rows = await api.fetchDeck(m, 20);
      if (req !== deckReqRef.current) return;
      const mapped = rows.map(mapDeckRow);
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
      // B-01 path 2: all awaits done — commit state atomically at the end
      profs.forEach((p) => {
        const prevDist = cacheRef.current[p.id] ? cacheRef.current[p.id].dist : null;
        cacheRef.current[p.id] = { ...mapProfileRow(p), dist: prevDist };
      });
      deduped.forEach((m) => { matchIdsRef.current[m.otherId] = m.id; });
      setMatches(deduped.map((m) => m.otherId));
      setThreads(deduped.map((m, i) => {
        const msgs = msgLists[i].map((r) => mapMsgRow(r, myId));
        const last = msgs[msgs.length - 1];
        return { id: m.otherId, matchId: m.id, unread: false, yourServe: !!last && last.who === 'them', msgs };
      }));
    } catch (e) { /* offline: keep current (empty in live — see live boot) */ }
  };

  const refreshEvents = async () => {
    try {
      const rows = await api.listEvents();
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
          : 'Update from 40/Love.';
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
    registerForPush(api.registerPushToken).catch(() => {});
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => {
    if (live) refreshDeck(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
    if (user) saveUser({ ...user, photo: uri });
    if (live) api.uploadProfilePhoto(uri, 0).catch(() => {});
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
    setPrefs({ radius: 15, ageMin: 25, ageMax: 55, mySportsOnly: false });
    setLiveEvents(null);
    cacheRef.current = {};
    matchIdsRef.current = {};
  };

  // ---------- auth ----------

  const requestCode = async (email) => {
    if (isBackendConfigured) await api.signInWithEmail(email);
  };

  const verifyCode = async (email, code) => {
    if (isBackendConfigured) {
      await api.verifyOtp(email, code);
      const remote = await api.getMyProfile();
      if (remote) {
        const localUser = {
          name: remote.first_name,
          age: ageFromBirthdate(remote.birthdate),
          birthdate: remote.birthdate,
          gender: remote.gender || null,
          seeking: remote.seeking || [],
          playGames: remote.play_games || ALL_GAMES,
          playPref: remote.play_pref || 'everyone',
          friendsPref: remote.friends_pref || 'everyone',
          photo: user && user.photo ? user.photo : null,
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
      }
      return { hasProfile: false };
    }
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code.');
    return { hasProfile: !!user };
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
        approxLat: loc ? loc.lat : null,
        approxLng: loc ? loc.lng : null,
        gender: draft.gender,
        seeking: draft.seeking,
        playGames: draft.playGames,
        playPref: draft.playPref,
        friendsPref: draft.friendsPref,
      });
      await api.setMySports(
        draft.sports.map((s) => ({ sport: s.toLowerCase(), level: draft.skill.toLowerCase(), ratingLabel: draft.rating || '' }))
      );
      if (draft.photo) api.uploadProfilePhoto(draft.photo, 0).catch(() => {});
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
    if (mode === 'date' && user && user.gender && user.seeking && user.seeking.length) {
      if (!p.gender || !p.seeking) return false;
      if (!user.seeking.includes(p.gender)) return false;
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

  const rewind = () => {
    if (live) return false; // server has already recorded the swipe
    if (!history.length) return false;
    setDeckPos(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    return true;
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
    if (!replied[id]) {
      setReplied((r) => ({ ...r, [id]: true }));
      setTimeout(() => {
        appendMsg(id, { who: 'them', text: CANNED_REPLIES[id] || 'Sounds great — see you on the court! 🎾', when: 'Just now' });
      }, 1500);
    }
  };

  const subscribeThread = (id) => {
    const thread = threadsRef.current.find((t) => t.id === id);
    const matchId = (thread && thread.matchId) || matchIdsRef.current[id];
    if (!live || !matchId) return () => {};
    return api.subscribeToMessages(matchId, (eventType, row) => {
      if (eventType === 'INSERT' && row.sender_id === myId) return; // own optimistic append shown already
      upsertMsgById(id, row); // B-08: UPDATEs (court accept/decline) land too
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

  const demoEvents = EVENTS.map((e) => ({
    id: e.id, week: e.week, dow: e.dow, dom: e.dom, title: e.title, venue: e.venue,
    time: e.time, sport: e.sport, level: e.level,
    spotsLeft: joined[e.id] ? e.spots - 1 : e.spots,
    going: !!joined[e.id],
  }));
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

  const value = {
    user, hydrated, saveUser, signOut,
    session, live, isBackendConfigured,
    requestCode, verifyCode, finishOnboarding,
    updateBio, updatePhoto, updatePrefs, updateModes, updateDating, updatePlay, updateFriendsPref,
    mode, setMode,
    currentProfile, advance, rewind, deckError,
    retryDeck: () => refreshDeck(mode),
    swipeLike, swipePass, likeSaved, registerLike,
    saved, setSaved: persistSaved, seen, setSeen, blocked, block, report,
    matches, threads, profileById, ensureThread,
    sendMessage, subscribeThread, respondCourt, markRead,
    events, toggleJoin, joined,
    notifs, clearNotifs, prefs,
  };

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}

export const useApp = () => useContext(AppState);
