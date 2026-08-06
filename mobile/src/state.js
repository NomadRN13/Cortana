// App-wide state, dual-mode:
//  - DEMO: no backend configured (or not signed in) → seeded local data.
//  - LIVE: Supabase configured + session → every action reads/writes the
//    real backend (schema in supabase/migrations/, client in src/api/backend.js).
// Screens call the same actions in both modes.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROFILES, THREADS, CANNED_REPLIES, NOTIFICATIONS, EVENTS } from './data/seed';
import { supabase, isBackendConfigured } from './lib/supabase';
import * as api from './api/backend';

const STORE_KEY = '40love.profile';
const AppState = createContext(null);

export function ageFromBirthdate(birthdate) {
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
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

// RPC row → the profile shape screens render
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

// profiles table row (+user_sports) → same shape (no distance available)
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
  const cacheRef = useRef({}); // live: userId → mapped profile

  const live = isBackendConfigured && !!session;
  const myId = session && session.user ? session.user.id : null;

  // ---------- hydration ----------

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (raw) {
          const u = JSON.parse(raw);
          if (u && typeof u.name === 'string') {
            setUser(u);
            if (u.modes && u.modes.length) setMode(u.modes[0]);
          }
        }
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!isBackendConfigured) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- live loaders ----------

  const refreshDeck = async (m = mode) => {
    try {
      const rows = await api.fetchDeck(m, 20);
      const mapped = rows.map(mapDeckRow);
      mapped.forEach((p) => { cacheRef.current[p.id] = p; });
      setLiveDeck(mapped);
      setLiveIndex(0);
    } catch (e) { /* offline or RLS hiccup: keep the current deck */ }
  };

  const refreshMatchesAndThreads = async () => {
    try {
      const rows = await api.listMatches();
      const otherIds = rows.map((m) => (m.user_a === myId ? m.user_b : m.user_a));
      const profs = await api.getProfilesByIds(otherIds);
      profs.forEach((p) => { cacheRef.current[p.id] = { ...mapProfileRow(p), ...(cacheRef.current[p.id] && { dist: cacheRef.current[p.id].dist }) }; });
      setMatches(otherIds);
      const msgLists = await Promise.all(rows.map((m) => api.listMessages(m.id).catch(() => [])));
      setThreads(rows.map((m, i) => {
        const otherId = m.user_a === myId ? m.user_b : m.user_a;
        const msgs = msgLists[i].map((r) => mapMsgRow(r, myId));
        const last = msgs[msgs.length - 1];
        return { id: otherId, matchId: m.id, unread: false, yourServe: !!last && last.who === 'them', msgs };
      }));
    } catch (e) { /* keep current state */ }
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
          spotsLeft: Math.max(0, e.capacity - rsvps.length),
          going: rsvps.some((r) => r.user_id === myId),
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
    api.updateMyProfile({ last_active_at: new Date().toISOString() }).catch(() => {});
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

  const updateModes = (modes) => {
    if (user) saveUser({ ...user, modes });
    if (live) api.updateMyProfile({ modes }).catch(() => {});
    if (!modes.includes(mode) && modes.length) setMode(modes[0]);
  };

  const updatePrefs = (next) => {
    setPrefs(next);
    if (live) {
      api.updateMyProfile({
        radius_mi: next.radius,
        age_min: next.ageMin,
        age_max: next.ageMax,
        same_sports_only: next.mySportsOnly,
      }).catch(() => {});
    }
  };

  const signOut = () => {
    if (isBackendConfigured) api.signOut().catch(() => {});
    AsyncStorage.removeItem(STORE_KEY).catch(() => {});
    setUser(null);
    setMode('date');
    setDeckPos(0);
    setHistory([]);
    setLikeCount(0);
    setLiveDeck([]);
    setLiveIndex(0);
    setSaved({});
    setBlocked({});
    setSeen({});
    setMatches(['maya', 'sam', 'priya']);
    setThreads(THREADS);
    setNotifs(NOTIFICATIONS.map((n) => ({ ...n })));
    setPrefs({ radius: 15, ageMin: 25, ageMax: 55, mySportsOnly: false });
    cacheRef.current = {};
  };

  // ---------- auth ----------

  const requestCode = async (email) => {
    if (isBackendConfigured) await api.signInWithEmail(email);
    // Demo mode: no email is sent; any 6-digit code verifies.
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
          photo: user && user.photo ? user.photo : null,
          sports: (remote.user_sports || []).map((s) => cap(s.sport)),
          skill: remote.user_sports && remote.user_sports[0] ? cap(remote.user_sports[0].level) : 'Intermediate',
          rating: remote.user_sports && remote.user_sports[0] ? remote.user_sports[0].rating_label : '',
          modes: remote.modes,
          bio: remote.bio,
        };
        saveUser(localUser);
        if (remote.modes && remote.modes.length) setMode(remote.modes[0]);
        setPrefs({
          radius: remote.radius_mi, ageMin: remote.age_min, ageMax: remote.age_max, mySportsOnly: remote.same_sports_only,
        });
        return { hasProfile: true };
      }
      return { hasProfile: false };
    }
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code.');
    return { hasProfile: !!user };
  };

  const finishOnboarding = async (draft) => {
    if (isBackendConfigured) {
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

  const currentProfile = () => {
    if (live) {
      let i = liveIndex;
      while (i < liveDeck.length && (blocked[liveDeck[i].id] || seen[liveDeck[i].id])) i += 1;
      return i < liveDeck.length ? liveDeck[i] : null;
    }
    const i = nextEligibleIndex(deckPos);
    return i < PROFILES.length ? PROFILES[i] : null;
  };

  const advance = () => {
    if (live) {
      const next = liveIndex + 1;
      setLiveIndex(next);
      if (next >= liveDeck.length) refreshDeck(mode);
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

  const profileById = (id) => cacheRef.current[id] || PROFILES.find((p) => p.id === id) || null;

  const ensureThread = (id) => {
    setThreads((ts) => (ts.some((t) => t.id === id) ? ts : [{ id, unread: false, yourServe: true, msgs: [] }, ...ts]));
  };

  const addMatch = (id) => {
    setMatches((m) => (m.includes(id) ? m : [id, ...m]));
    ensureThread(id);
  };

  // demo-only: every 3rd like (or an ace) is a match
  const registerLike = (id, ace) => {
    const n = likeCount + 1;
    setLikeCount(n);
    const isMatch = ace || n % 3 === 0;
    if (isMatch) addMatch(id);
    return isMatch;
  };

  // Like/ace the current deck card. Resolves true when it's a Match Point.
  const swipeLike = async (p, ace) => {
    if (live) {
      advance();
      try {
        const match = await api.swipe(p.id, mode, ace ? 'ace' : 'like');
        if (match) {
          cacheRef.current[p.id] = p;
          refreshMatchesAndThreads();
          return true;
        }
      } catch (e) { /* swipe lost offline — deck refresh will resurface them */ }
      return false;
    }
    const matched = registerLike(p.id, ace);
    advance();
    return matched;
  };

  const swipePass = (p) => {
    if (live) {
      advance();
      api.swipe(p.id, mode, 'pass').catch(() => {});
      return;
    }
    advance();
  };

  // Like someone from the Saved strip (not the current deck card).
  const likeSaved = async (id) => {
    setSaved((s) => ({ ...s, [id]: false }));
    setSeen((s) => ({ ...s, [id]: true }));
    if (live) {
      try {
        const match = await api.swipe(id, mode, 'like');
        if (match) { refreshMatchesAndThreads(); return true; }
      } catch (e) { /* ignore */ }
      return false;
    }
    return registerLike(id, false);
  };

  // ---------- chat ----------

  const appendMsg = (id, msg) => {
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, yourServe: msg.who === 'them', msgs: [...t.msgs, msg] } : t)));
  };

  const sendMessage = (id, msg) => {
    const thread = threads.find((t) => t.id === id);
    appendMsg(id, msg);
    if (live && thread && thread.matchId) {
      if (msg.kind === 'court') {
        api.proposeCourtTime(thread.matchId, { venue: msg.court, day: msg.day, time: msg.time, sport: (msg.sport || 'tennis').toLowerCase() }).catch(() => {});
      } else {
        api.sendTextMessage(thread.matchId, msg.text).catch(() => {});
      }
      return;
    }
    // demo: one canned reply per thread
    if (!replied[id]) {
      setReplied((r) => ({ ...r, [id]: true }));
      setTimeout(() => {
        appendMsg(id, { who: 'them', text: CANNED_REPLIES[id] || 'Sounds great — see you on the court! 🎾', when: 'Just now' });
      }, 1500);
    }
  };

  // Live: new incoming messages for an open conversation
  const subscribeThread = (id) => {
    const thread = threads.find((t) => t.id === id);
    if (!live || !thread || !thread.matchId) return () => {};
    return api.subscribeToMessages(thread.matchId, (row) => {
      if (row.sender_id === myId) return; // own optimistic append already shown
      appendMsg(id, mapMsgRow(row, myId));
    });
  };

  const respondCourt = (threadId, msgIndex, accept) => {
    const thread = threads.find((t) => t.id === threadId);
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
    setSaved((s) => ({ ...s, [id]: false }));
    setMatches((m) => m.filter((x) => x !== id));
    setThreads((ts) => ts.filter((t) => t.id !== id));
    if (live) api.blockUser(id).then(() => refreshDeck(mode)).catch(() => {});
  };

  const report = (id, fromDeck) => {
    if (fromDeck) setSeen((s) => ({ ...s, [id]: true }));
    if (live) api.reportUser(id, 'Reported in-app', fromDeck ? 'deck' : 'chat').catch(() => {});
  };

  // ---------- events ----------

  const demoEvents = EVENTS.map((e) => ({
    id: e.id, week: e.week, dow: e.dow, dom: e.dom, title: e.title, venue: e.venue,
    time: e.time, sport: e.sport, level: e.level,
    spotsLeft: joined[e.id] ? e.spots - 1 : e.spots,
    going: !!joined[e.id],
  }));
  const events = live && liveEvents ? liveEvents : demoEvents;

  const toggleJoin = (id) => {
    if (live && liveEvents) {
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
    updateBio, updatePhoto, updatePrefs, updateModes,
    mode, setMode,
    currentProfile, advance, rewind,
    swipeLike, swipePass, likeSaved, registerLike,
    saved, setSaved, seen, setSeen, blocked, block, report,
    matches, threads, profileById, ensureThread,
    sendMessage, subscribeThread, respondCourt, markRead,
    events, toggleJoin, joined,
    notifs, clearNotifs, prefs,
  };

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}

export const useApp = () => useContext(AppState);
