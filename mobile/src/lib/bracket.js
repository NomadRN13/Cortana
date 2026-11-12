// Single-elimination brackets for 2 to 72 entries — the same rules as the
// database (supabase/migrations/20260806000027_tournaments.sql), in JavaScript.
//
// The live app never builds a bracket itself: the server does, and the app
// draws what it is given. This file is for the demo build, which has no
// server, and it is copied (between the BRACKET-LIB markers) into
// app/index.html and admin/index.html so their demos behave identically. It is
// written in plain ES5 for that reason — keep it that way, and keep the three
// copies in step: tests/web/events.test.js fails if they drift apart.
//
// A match is { id, round, slot, a, b, winner, score, bye, reported }. `round`
// starts at 1; `slot` counts down the round from 0; a and b are player ids or
// null. `reported` is true once a result has been recorded — it stays true
// even if the winner later deletes their account and `winner` goes back to
// null, which is how a played match is told apart from an unplayed one.

// BRACKET-LIB:START
function bracketSizeFor(n) {
  var size = 2;
  while (size < n) size *= 2;
  return size;
}

// The seed in each first-round slot, top to bottom. 8 -> [1,8,4,5,2,7,3,6].
// Built by doubling: seed s in a bracket of n becomes the pair (s, 2n+1-s).
// Top seeds get the byes, byes never meet, and 1 and 2 can only meet last.
function bracketSeedOrder(size) {
  var cur = [1];
  var n = 1;
  while (n < size) {
    var next = [];
    for (var i = 0; i < cur.length; i++) { next.push(cur[i]); next.push(2 * n + 1 - cur[i]); }
    cur = next;
    n *= 2;
  }
  return cur;
}

function bracketRounds(size) {
  var r = 0;
  while ((1 << r) < size) r++;
  return r;
}

function bracketFind(bracket, round, slot) {
  for (var i = 0; i < bracket.matches.length; i++) {
    var m = bracket.matches[i];
    if (m.round === round && m.slot === slot) return m;
  }
  return null;
}

// Put a match's winner into the next round (slot s feeds slot s/2: top when s
// is even, bottom when odd). The final's winner is the champion.
function bracketAdvance(bracket, m) {
  if (m.round >= bracket.rounds) { bracket.champion = m.winner; return; }
  var next = bracketFind(bracket, m.round + 1, Math.floor(m.slot / 2));
  if (m.slot % 2 === 0) next.a = m.winner; else next.b = m.winner;
}

// players: ids in seed order (index 0 is seed 1). Returns the whole bracket,
// every round present, byes already advanced.
function buildBracket(players) {
  var n = players.length;
  var size = bracketSizeFor(n);
  var rounds = bracketRounds(size);
  var bracket = { size: size, rounds: rounds, matches: [], champion: null };
  var r, s;
  for (r = 1; r <= rounds; r++) {
    for (s = 0; s < size / Math.pow(2, r); s++) {
      bracket.matches.push({ id: 'r' + r + 's' + s, round: r, slot: s, a: null, b: null, winner: null, score: '', bye: false, reported: false });
    }
  }
  var order = bracketSeedOrder(size);
  for (s = 0; s < size / 2; s++) {
    var m = bracketFind(bracket, 1, s);
    var sa = order[2 * s];
    var sb = order[2 * s + 1];
    m.a = sa <= n ? players[sa - 1] : null;
    m.b = sb <= n ? players[sb - 1] : null;
    if (m.a === null || m.b === null) {
      m.bye = true;
      m.winner = m.a === null ? m.b : m.a;
      bracketAdvance(bracket, m);
    }
  }
  return bracket;
}

// Record (or, with force, correct) a result. Returns null on success or a
// sentence saying why not. A correction is refused once the next match has
// been played, so nobody is shown advancing from a match they lost.
function bracketRecord(bracket, matchId, winner, score, force) {
  var m = null;
  for (var i = 0; i < bracket.matches.length; i++) if (bracket.matches[i].id === matchId) m = bracket.matches[i];
  if (!m) return 'That match doesn’t exist.';
  if (m.bye) return 'A bye has no result to record.';
  if (m.a === null || m.b === null) return 'This match is still waiting for its players.';
  if (winner !== m.a && winner !== m.b) return 'The winner has to be one of the two players in the match.';
  if (m.winner !== null) {
    if (!force) return 'This result is already in — ask the organiser to correct it.';
    if (m.round < bracket.rounds) {
      var next = bracketFind(bracket, m.round + 1, Math.floor(m.slot / 2));
      if (next.winner !== null) return 'The next round has already been played — correct that result first.';
    }
    bracket.champion = null;
  }
  m.winner = winner;
  m.score = String(score || '').slice(0, 40);
  m.reported = true;
  bracketAdvance(bracket, m);
  return null;
}

// "Final", "Semifinals", "Quarterfinals", "Round of 16", "Round 1" …
function bracketRoundName(round, rounds) {
  var left = rounds - round;
  if (left === 0) return 'Final';
  if (left === 1) return 'Semifinals';
  if (left === 2) return 'Quarterfinals';
  return 'Round of ' + Math.pow(2, left + 1);
}
// A uniform random order (Fisher-Yates). The order is the seeding, so it has to
// be fair: sorting with a random comparator is not, and favours some places.
function bracketShuffle(list) {
  var a = list.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function bracketMatchAt(matches, round, slot) {
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].round === round && matches[i].slot === slot) return matches[i];
  }
  return null;
}

// What one side ('a' or 'b') of a match holds, for drawing and for deciding
// whether the organiser may settle it:
//   'player'    someone is there
//   'bye'       a first-round bye
//   'withdrawn' someone was, and left (deleted their account) — the desk can
//               give the match to the other player
//   'pending'   an earlier match that fills it hasn't been played yet
// The same rule as report_match_result in the database.
function bracketSide(matches, m, side) {
  if (side === 'a' ? m.a : m.b) return 'player';
  if (m.bye) return 'bye';
  if (m.round === 1) return 'withdrawn';
  var f = bracketMatchAt(matches, m.round - 1, m.slot * 2 + (side === 'a' ? 0 : 1));
  if (f && (f.reported || f.bye || (f.round === 1 && !f.a && !f.b))) return 'withdrawn';
  return 'pending';
}

// A match whose result is settled for good: the next match in its line has a
// result of its own, so changing this one would show someone advancing from a
// match they lost.
function bracketLocked(matches, m) {
  var next = bracketMatchAt(matches, m.round + 1, Math.floor(m.slot / 2));
  return !!(next && next.reported);
}

// Whether the organiser may record (or correct) this match now: not a bye, not
// locked, and either both players are there or the empty side was vacated.
function bracketDeskCanRecord(matches, m) {
  if (m.bye || bracketLocked(matches, m)) return false;
  if (m.a && m.b) return true;
  if (!m.a && !m.b) return false;
  return bracketSide(matches, m, m.a ? 'b' : 'a') === 'withdrawn';
}

// "56 players have a bye and start in the Round of 64."
function bracketByeLine(byes, rounds) {
  if (!byes) return '';
  return byes + (byes === 1 ? ' player has a bye and starts' : ' players have a bye and start') +
    ' in the ' + bracketRoundName(2, rounds) + '.';
}
// BRACKET-LIB:END

export {
  bracketSizeFor, bracketSeedOrder, bracketRounds, buildBracket, bracketRecord, bracketRoundName,
  bracketShuffle, bracketSide, bracketLocked, bracketDeskCanRecord, bracketByeLine,
};
