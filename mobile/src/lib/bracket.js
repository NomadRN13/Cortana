// Single-elimination brackets for 2 to 24 entries — the same rules as the
// database (supabase/migrations/20260806000027_tournaments.sql), in JavaScript.
//
// The live app never builds a bracket itself: the server does, and the app
// draws what it is given. This file is for the demo build, which has no
// server, and it is copied (between the BRACKET-LIB markers) into
// app/index.html and admin/index.html so their demos behave identically. It is
// written in plain ES5 for that reason — keep it that way, and keep the three
// copies in step: tests/web/events.test.js fails if they drift apart.
//
// A match is { id, round, slot, a, b, winner, score, bye }. `round` starts at
// 1; `slot` counts down the round from 0; a and b are player ids or null.

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
      bracket.matches.push({ id: 'r' + r + 's' + s, round: r, slot: s, a: null, b: null, winner: null, score: '', bye: false });
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
// BRACKET-LIB:END

export { bracketSizeFor, bracketSeedOrder, bracketRounds, buildBracket, bracketRecord, bracketRoundName };
