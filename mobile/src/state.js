// App-wide state. In production each action here becomes a Supabase call —
// see docs/system-architecture.md §11 (prototype → production map).
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROFILES, THREADS, CANNED_REPLIES, NOTIFICATIONS } from './data/seed';

const STORE_KEY = '40love.profile';
const AppState = createContext(null);

export function AppStateProvider({ children }) {
  const [user, setUser] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState('date');
  const [deckPos, setDeckPos] = useState(0);
  const [history, setHistory] = useState([]);
  const [likeCount, setLikeCount] = useState(0);
  const [saved, setSaved] = useState({});
  const [blocked, setBlocked] = useState({});
  const [seen, setSeen] = useState({});
  const [matches, setMatches] = useState(['maya', 'sam', 'priya']);
  const [threads, setThreads] = useState(THREADS);
  const [joined, setJoined] = useState({});
  const [replied, setReplied] = useState({});
  const [notifs, setNotifs] = useState(NOTIFICATIONS);
  const [prefs, setPrefs] = useState({ radius: 15, ageMin: 25, ageMax: 55, mySportsOnly: false });

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

  const saveUser = (u) => {
    setUser(u);
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(u)).catch(() => {});
  };

  const signOut = () => {
    AsyncStorage.removeItem(STORE_KEY).catch(() => {});
    setUser(null);
    setMode('date');
    setDeckPos(0);
    setHistory([]);
    setLikeCount(0);
    setSaved({});
    setBlocked({});
    setSeen({});
    setPrefs({ radius: 15, ageMin: 25, ageMax: 55, mySportsOnly: false });
  };

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
    const i = nextEligibleIndex(deckPos);
    return i < PROFILES.length ? PROFILES[i] : null;
  };

  const advance = () => {
    setHistory((h) => [...h, deckPos]);
    setDeckPos(nextEligibleIndex(deckPos) + 1);
  };

  const rewind = () => {
    if (!history.length) return false;
    setDeckPos(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    return true;
  };

  const profileById = (id) => PROFILES.find((p) => p.id === id) || null;

  const ensureThread = (id) => {
    setThreads((ts) => (ts.some((t) => t.id === id) ? ts : [{ id, unread: false, yourServe: true, msgs: [] }, ...ts]));
  };

  const addMatch = (id) => {
    setMatches((m) => (m.includes(id) ? m : [id, ...m]));
    ensureThread(id);
  };

  // Returns true when this like completes a match (demo: every 3rd like, or an ace)
  const registerLike = (id, ace) => {
    const n = likeCount + 1;
    setLikeCount(n);
    const isMatch = ace || n % 3 === 0;
    if (isMatch) addMatch(id);
    return isMatch;
  };

  const sendMessage = (id, msg) => {
    setThreads((ts) =>
      ts.map((t) => (t.id === id ? { ...t, yourServe: false, msgs: [...t.msgs, msg] } : t))
    );
    if (!replied[id]) {
      setReplied((r) => ({ ...r, [id]: true }));
      setTimeout(() => {
        setThreads((ts) =>
          ts.map((t) =>
            t.id === id
              ? {
                  ...t,
                  yourServe: true,
                  msgs: [
                    ...t.msgs,
                    { who: 'them', text: CANNED_REPLIES[id] || 'Sounds great — see you on the court! 🎾', when: 'Just now' },
                  ],
                }
              : t
          )
        );
      }, 1500);
    }
  };

  const markRead = (id) => {
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, unread: false } : t)));
  };

  const block = (id) => {
    setBlocked((b) => ({ ...b, [id]: true }));
    setSaved((s) => ({ ...s, [id]: false }));
    setMatches((m) => m.filter((x) => x !== id));
    setThreads((ts) => ts.filter((t) => t.id !== id));
  };

  const report = (id, fromDeck) => {
    if (fromDeck) setSeen((s) => ({ ...s, [id]: true }));
  };

  const value = useMemo(
    () => ({
      user, hydrated, saveUser, signOut,
      mode, setMode,
      currentProfile, advance, rewind, historyLength: history.length,
      registerLike,
      saved, setSaved, seen, setSeen, blocked, block, report,
      matches, threads, profileById, ensureThread, sendMessage, markRead,
      joined, setJoined, notifs, setNotifs, prefs, setPrefs,
    }),
    [user, hydrated, mode, deckPos, history, likeCount, saved, blocked, seen, matches, threads, joined, replied, notifs, prefs]
  );

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}

export const useApp = () => useContext(AppState);
