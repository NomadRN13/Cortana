// Ladder-league rules for the demo build — the same rules the database
// implements (supabase/migrations, "ladder leagues"). The live app never moves
// anyone on a ladder itself: the server does, and the app draws what it is
// given. These exist so the demo behaves the same way with no backend.
//
// A ladder is a list of { id, name, rung, wins, losses }, rung 1 at the top.
// Every function returns a new list and leaves the one it was given alone.

export const LADDER_REACH = 2; // you may challenge at most this many rungs above you

function sorted(list) {
  return list.slice().sort((a, b) => a.rung - b.rung);
}

// The newest member takes the bottom rung. Joining twice changes nothing.
export function ladderJoin(list, id, name) {
  if (list.some((m) => m.id === id)) return sorted(list);
  const bottom = list.reduce((max, m) => Math.max(max, m.rung), 0);
  return sorted([...list, { id, name, rung: bottom + 1, wins: 0, losses: 0 }]);
}

// Leaving closes the gap: everyone below moves up one.
export function ladderLeave(list, id) {
  const me = list.find((m) => m.id === id);
  if (!me) return sorted(list);
  return sorted(list.filter((m) => m.id !== id).map((m) => (m.rung > me.rung ? { ...m, rung: m.rung - 1 } : m)));
}

// Why `challengerId` may not challenge `targetId`, in the server's words, or
// null when they may. `open` is the list of challenges still to be played
// ({ challengerId, challengedId }); a pair has one at a time.
export function ladderChallengeProblem(list, challengerId, targetId, open) {
  const me = list.find((m) => m.id === challengerId);
  if (!me) return 'Join the league before you challenge anyone.';
  const them = list.find((m) => m.id === targetId);
  if (!them || !targetId || targetId === challengerId) return 'That isn’t someone you can challenge.';
  if (them.rung > me.rung || me.rung - them.rung > LADDER_REACH) return 'You can challenge up to two rungs above you.';
  const taken = (open || []).some((c) => (
    (c.challengerId === challengerId && c.challengedId === targetId)
    || (c.challengerId === targetId && c.challengedId === challengerId)));
  if (taken) return 'You two already have a challenge to play.';
  return null;
}

// A challenge is played. The winner gets a win and the loser a loss. If the
// challenger won from below they take the challenged player's rung and
// everyone between moves down one; if the challenged player won, nothing moves.
// Returns { list, problem }: problem is a sentence when nothing was recorded.
export function ladderRecord(list, challengerId, challengedId, winnerId) {
  const challenger = list.find((m) => m.id === challengerId);
  const challenged = list.find((m) => m.id === challengedId);
  if (!challenger || !challenged) return { list: sorted(list), problem: 'One of you has left the league.' };
  if (winnerId !== challengerId && winnerId !== challengedId) {
    return { list: sorted(list), problem: 'The winner has to be one of the two players.' };
  }
  const loserId = winnerId === challengerId ? challengedId : challengerId;
  const hi = challenged.rung; // numerically smaller: higher up the ladder
  const lo = challenger.rung;
  const moved = list.map((m) => {
    let next = m;
    if (m.id === winnerId) next = { ...next, wins: next.wins + 1 };
    if (m.id === loserId) next = { ...next, losses: next.losses + 1 };
    if (winnerId === challengerId && lo > hi) {
      if (m.id === challengerId) next = { ...next, rung: hi };
      else if (m.rung >= hi && m.rung < lo) next = { ...next, rung: m.rung + 1 };
    }
    return next;
  });
  return { list: sorted(moved), problem: null };
}
