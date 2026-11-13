import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Tag } from '../components/ui';
import { EventCard } from '../components/events';
import { useApp } from '../state';
import { cityLabel } from '../data/cities';
import { ACCESS_LABELS } from '../data/courts';
import { bracketRoundName, bracketSide, bracketByeLine } from '../lib/bracket';

// What an empty side of a match says: a player who has left the tournament
// isn't a place still to be decided.
const EMPTY_SIDE = { bye: '— bye —', withdrawn: 'Withdrawn', pending: 'To be decided' };

// Each city runs its own meetups. You see the calendar for the cities on your
// profile — one or several — and nothing else. So this is a label, not a
// picker: the way to see another city's meetups is to add that city in Settings.
function citiesText(cities) {
  return cities.length === 1 ? cityLabel(cities[0]) : `${cities.length} cities`;
}

function CityBadge({ cities }) {
  return (
    <View style={styles.picker} accessibilityLabel={`Meetups in ${cities.map(cityLabel).join(', ')}`}>
      <Ionicons name="location-outline" size={15} color={colors.optic} />
      <Text style={styles.pickerText} numberOfLines={1}>{citiesText(cities)}</Text>
    </View>
  );
}

// One row of a match card: a player. The winner's row is lit in optic with the
// score at its right-hand edge; the member's own row carries a "You" tag; and
// when this member is allowed to record the match, a button to say this player won.
function BracketRow({ app, t, m, side }) {
  const id = side === 'a' ? m.a : m.b;
  const won = !!m.winner && m.winner === id;
  const lost = !!m.winner && m.winner !== id;
  const name = id ? app.playerName(id) : (EMPTY_SIDE[bracketSide(t.matches, m, side)] || 'To be decided');
  const isFinal = m.round >= t.rounds;
  const record = () => {
    Alert.alert(
      `${app.playerName(id)} won?`,
      `This goes straight into the bracket and ${isFinal ? 'makes them the champion' : 'moves them to the next round'}. `
        + 'It can’t be changed afterwards except by the organiser, so only record a match that has been played.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Record result', onPress: () => app.reportMatch(t.id, m.id, id, '') }]
    );
  };
  return (
    <View style={[styles.brRow, won && styles.brRowWon]}>
      <Text
        style={[styles.brName, won && { color: colors.optic, fontWeight: '800' }, (lost || !id) && { color: colors.dim }]}
        numberOfLines={1}
      >
        {name}
      </Text>
      {!!id && app.isMe(id) && (
        <View style={styles.youTag}><Text style={styles.youTagLabel}>You</Text></View>
      )}
      {won && (m.score
        ? <Text style={styles.brScore} numberOfLines={1} accessibilityLabel={`Won ${m.score}`}>{m.score}</Text>
        : <Ionicons name="checkmark-circle" size={16} color={colors.optic} accessibilityLabel="Won" />)}
      {!!id && app.canReportMatch(m) && (
        <Pressable onPress={record} style={styles.brWon} accessibilityRole="button" accessibilityLabel={`Record ${app.playerName(id)} as the winner`}>
          <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 11.5 }}>Won</Text>
        </Pressable>
      )}
    </View>
  );
}

// One match: two rows, one per player. The member's own matches are outlined.
function BracketMatch({ app, t, m }) {
  const mine = app.isMe(m.a) || app.isMe(m.b);
  return (
    <View style={[styles.brMatch, mine && { borderColor: colors.optic }]}>
      <BracketRow app={app} t={t} m={m} side="a" />
      <View style={styles.brRule} />
      <BracketRow app={app} t={t} m={m} side="b" />
      {/* Played, but the winner has since left: the score still stands. */}
      {!!m.score && !m.winner && <Text style={[styles.brScore, { paddingHorizontal: 10, paddingBottom: 6 }]}>{m.score}</Text>}
    </View>
  );
}

// The bracket, drawn as a bracket: one column per round, left to right, each
// headed by the round's name, with every match a two-row card. Later rounds
// spread down the column so a match sits between the two that feed it. Every
// round is there from the moment of the draw; later rounds fill in as results
// come in. It scrolls sideways — a draw of 64 doesn't fit a phone any other way.
function Bracket({ app, t }) {
  const rounds = [];
  for (let r = 1; r <= t.rounds; r += 1) rounds.push(r);
  // A bye isn't a match anyone plays — with 72 entries in a bracket of 128
  // there are 56 of them — so they are counted in one line, not listed.
  const byes = t.matches.filter((m) => m.round === 1 && m.bye).length;
  return (
    <View style={{ marginTop: 8 }}>
      {byes > 0 && (
        <Text style={[type.hint, { fontSize: 12, marginBottom: 6 }]}>{bracketByeLine(byes, t.rounds)}</Text>
      )}
      {rounds.length > 1 && (
        <Text style={[type.hint, { fontSize: 11.5, marginBottom: 2 }]}>Swipe sideways to follow the rounds.</Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
        {rounds.map((r) => {
          const matches = t.matches.filter((m) => m.round === r && !m.bye);
          return (
            <View key={r} style={styles.brRound}>
              <Text style={[type.eyebrow, { marginTop: 8, marginBottom: 6 }]}>{bracketRoundName(r, t.rounds)}</Text>
              <View style={{ flex: 1, justifyContent: 'space-around', gap: 8 }}>
                {matches.map((m) => <BracketMatch key={m.id} app={app} t={t} m={m} />)}
                {matches.length === 0 && <Text style={[type.hint, { fontSize: 12 }]}>No matches in this round.</Text>}
              </View>
            </View>
          );
        })}
        {t.status === 'completed' && !!t.championId && (
          <View style={styles.brRound}>
            <Text style={[type.eyebrow, { marginTop: 8, marginBottom: 6 }]}>Champion</Text>
            <View style={{ flex: 1, justifyContent: 'space-around' }}>
              <View style={[styles.brMatch, { borderColor: colors.optic }]}>
                <View style={[styles.brRow, styles.brRowWon]}>
                  <Ionicons name="trophy" size={15} color={colors.optic} />
                  <Text style={[styles.brName, { color: colors.optic, fontWeight: '800' }]} numberOfLines={1}>{app.playerName(t.championId)}</Text>
                  {app.isMe(t.championId) && <View style={styles.youTag}><Text style={styles.youTagLabel}>You</Text></View>}
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// Tournaments in the member's cities: enter while entries are open, then
// follow the bracket and record your own results once the draw is made.
function Tournaments({ app }) {
  const [open, setOpen] = useState({});
  const list = app.tournaments;
  if (!list.length) return null;
  const many = app.eventCities.length > 1;
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={[type.display, { fontSize: 18 }]}>Tournaments</Text>
      {list.map((t) => {
        const isOpen = !!open[t.id];
        // entryCount, not the entry list: the list leaves out anyone you have a
        // block with, and would show a full tournament as having room.
        const full = t.entryCount >= t.max;
        const status = t.status === 'registration'
          ? `${t.entryCount} of ${t.max} entered`
          : t.status === 'completed'
            // A champion who has since deleted their account leaves no name.
            ? (t.championId ? `Champion: ${app.playerName(t.championId)}` : 'Completed')
            : `In progress · ${t.entryCount} players`;
        return (
          <View key={t.id} style={[styles.tourney, isOpen && { borderColor: colors.optic }]}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{t.title}</Text>
            <Text style={[type.hint, { fontSize: 12.5 }]}>{t.venue ? `${t.venue} · ` : ''}{t.when}</Text>
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
              <Tag label={t.sport} accent />
              <Tag label={t.level} />
              <Tag label={status} />
              {many && <Tag label={cityLabel(t.city)} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              {t.status === 'registration' && (
                t.entered ? (
                  <Pressable style={[styles.join, styles.joinGoing]} onPress={() => app.leaveTournament(t.id)} accessibilityRole="button">
                    <Text style={{ fontWeight: '800', fontSize: 13, color: colors.optic }}>Entered ✓</Text>
                  </Pressable>
                ) : full ? (
                  <Text style={[type.hint, { fontSize: 12.5 }]}>Full</Text>
                ) : (
                  <Pressable style={styles.join} onPress={() => app.joinTournament(t.id)} accessibilityRole="button">
                    <Text style={{ fontWeight: '800', fontSize: 13, color: colors.ink }}>Enter</Text>
                  </Pressable>
                )
              )}
              <Pressable onPress={() => setOpen((o) => ({ ...o, [t.id]: !o[t.id] }))} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13 }}>
                  {t.status === 'registration' ? (isOpen ? 'Hide entries' : 'See who’s in') : (isOpen ? 'Hide bracket' : 'See the bracket')}
                </Text>
              </Pressable>
              {!app.live && t.status === 'registration' && t.entryCount >= 2 && (
                <Pressable onPress={() => { app.drawTournament(t.id); setOpen((o) => ({ ...o, [t.id]: true })); }} accessibilityRole="button">
                  <Text style={{ color: colors.dim, fontWeight: '700', fontSize: 12.5 }}>Make the draw (demo)</Text>
                </Pressable>
              )}
            </View>
            {isOpen && t.status === 'registration' && (
              <View style={{ marginTop: 8 }}>
                <Text style={[type.hint, { fontSize: 12.5 }]}>
                  {t.entries.length
                    ? t.entries.map((e) => app.playerName(e.id)).join(' · ')
                    : t.entryCount ? `${t.entryCount} entered.` : 'Nobody yet — be the first.'}
                </Text>
                <Text style={[type.hint, { fontSize: 11.5, marginTop: 6 }]}>
                  When entries close the organiser makes the draw: the bracket is built for however many have entered, up to {t.max}, and everyone is placed in it automatically. Players record their own results, the organiser’s decisions are final, and there are no prizes. You play at your own risk.
                </Text>
              </View>
            )}
            {isOpen && t.status !== 'registration' && <Bracket app={app} t={t} />}
          </View>
        );
      })}
    </View>
  );
}

// One rung of a ladder: the rung number, the player, their record at the
// right, and whatever this member can do about them — challenge them, or record
// the result of a challenge the two of them still have to play.
function LadderRow({ app, l, row }) {
  const me = l.standings.find((r) => r.isMe) || null;
  const open = me && !row.isMe ? app.leagueChallengeWith(l, row) : null;
  const result = (iWon) => {
    const winner = iWon ? me : row;
    Alert.alert(
      iWon ? `You beat ${row.name}?` : `${row.name} won?`,
      'This goes straight onto the ladder. If the challenger won, they take the other player’s rung and everyone between moves down one. '
        + 'It can’t be changed afterwards, so only record a match that has been played.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Record result', onPress: () => app.reportLeagueResult(l.id, open.id, winner.id) }]
    );
  };
  const challenge = () => {
    Alert.alert(
      `Challenge ${row.name}?`,
      `They’re on rung ${row.rung}; you’re on rung ${l.myRung}. Win and you take their rung. Arrange the match between you, then either of you records who won.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Challenge', onPress: () => app.challengeInLeague(l.id, row.id) }]
    );
  };
  return (
    <View style={[styles.ladderRow, row.isMe && styles.ladderRowMe]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={styles.rung}>{row.rung}</Text>
        <Text style={[styles.brName, row.isMe && { color: colors.optic, fontWeight: '800' }, !row.id && !row.isMe && { color: colors.dim }]} numberOfLines={1}>
          {row.name}
        </Text>
        {row.isMe && <View style={styles.youTag}><Text style={styles.youTagLabel}>You</Text></View>}
        <Text style={styles.record} accessibilityLabel={`${row.wins} wins, ${row.losses} losses`}>{row.wins}–{row.losses}</Text>
        {!open && app.canChallenge(l, row) && (
          <Pressable onPress={challenge} style={styles.brWon} accessibilityRole="button" accessibilityLabel={`Challenge ${row.name}`}>
            <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 11.5 }}>Challenge</Text>
          </Pressable>
        )}
      </View>
      {!!open && (
        <View style={styles.challengeBar}>
          <Text style={[type.hint, { fontSize: 12, flex: 1 }]}>
            {open.challengedId === row.id ? 'You challenged them' : 'They challenged you'} — played it?
          </Text>
          <Pressable onPress={() => result(true)} style={styles.brWon} accessibilityRole="button" accessibilityLabel={`Record that you beat ${row.name}`}>
            <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 11.5 }}>I won</Text>
          </Pressable>
          <Pressable onPress={() => result(false)} style={styles.lost} accessibilityRole="button" accessibilityLabel={`Record that ${row.name} won`}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5 }}>They won</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Ladder leagues in the member's cities: join and take the bottom rung,
// challenge anyone up to two rungs above, and record the result. The server
// keeps the ladder; this draws it.
function Leagues({ app }) {
  const [open, setOpen] = useState({});
  const list = app.leagues;
  if (!list.length) return null;
  const many = app.eventCities.length > 1;
  const leave = (l) => Alert.alert(
    `Leave ${l.title}?`,
    'You give up your rung — everyone below you moves up one — and any challenge you still have to play is dropped. If you join again you start from the bottom.',
    [{ text: 'Stay', style: 'cancel' }, { text: 'Leave the ladder', style: 'destructive', onPress: () => app.leaveLeague(l.id) }]
  );
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={[type.display, { fontSize: 18 }]}>Ladder leagues</Text>
      {!app.live && (
        <Text style={[type.hint, { fontSize: 11.5, marginTop: 4 }]}>Demo: sample players and made-up records. You record both sides’ results yourself.</Text>
      )}
      {list.map((l) => {
        const isOpen = !!open[l.id];
        const count = l.standings.length;
        return (
          <View key={l.id} style={[styles.tourney, isOpen && { borderColor: colors.optic }]}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{l.title}</Text>
            <Text style={[type.hint, { fontSize: 12.5 }]}>
              {[l.venue, l.when, l.weeks ? `${l.weeks} weeks` : ''].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
              <Tag label={l.sport} accent />
              <Tag label={l.level} />
              <Tag label={l.joined ? `You’re on rung ${l.myRung} of ${count}` : `${count} on the ladder`} />
              {many && <Tag label={cityLabel(l.city)} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              {l.joined ? (
                <Pressable style={[styles.join, styles.joinGoing]} onPress={() => leave(l)} accessibilityRole="button" accessibilityLabel={`On the ladder for ${l.title}. Tap to leave`}>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: colors.optic }}>On the ladder ✓</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.join} onPress={() => { app.joinLeague(l.id); setOpen((o) => ({ ...o, [l.id]: true })); }} accessibilityRole="button" accessibilityLabel={`Join ${l.title}`}>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: colors.ink }}>Join</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setOpen((o) => ({ ...o, [l.id]: !o[l.id] }))} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13 }}>{isOpen ? 'Hide the ladder' : 'See the ladder'}</Text>
              </Pressable>
            </View>
            {isOpen && (
              <View style={{ marginTop: 8, gap: 6 }}>
                {count === 0 && <Text style={[type.hint, { fontSize: 12.5 }]}>Nobody on the ladder yet — join and take the top rung.</Text>}
                {l.standings.map((row) => <LadderRow key={`${row.rung}-${row.id || 'hidden'}`} app={app} l={l} row={row} />)}
                <Text style={[type.hint, { fontSize: 11.5, marginTop: 4 }]}>
                  Join and you take the bottom rung. You can challenge anyone up to two rungs above you: win and you take their rung, lose and nothing moves. Either player records the result. There are no prizes, and you play at your own risk.
                </Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const SETTING_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'indoor', label: 'Indoor' },
];

// Places to play in the member's cities, under the meetups. The list comes
// from the database (app.courtsFor), so the desk can add a court without an app
// release, and is fetched again whenever this tab is opened. Only cities with a
// list appear; a city with none has no section. Pickleball is the default, so
// only other sports get a sport tag.
function PlacesToPlay({ cities, courtsFor }) {
  const [filter, setFilter] = useState('all');
  const withCourts = cities.filter((c) => courtsFor(c).length > 0);
  if (!withCourts.length) return null;
  const fits = (c) => filter === 'all' || c.setting === filter || c.setting === 'both';
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={[type.display, { fontSize: 18 }]}>Places to play</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {SETTING_FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filter, on && styles.filterOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={{ fontWeight: '800', fontSize: 13, color: on ? colors.ink : colors.text }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {withCourts.map((city) => {
        const list = courtsFor(city).filter(fits);
        return (
          <View key={city}>
            <Text style={[type.eyebrow, { marginTop: 16, marginBottom: 8 }]}>
              {cityLabel(city)} · {list.length} {list.length === 1 ? 'place' : 'places'}
            </Text>
            {list.length === 0 && (
              <Text style={[type.hint, { paddingVertical: 8 }]}>
                {filter === 'indoor' ? 'No indoor courts listed here yet.' : 'No outdoor courts listed here yet.'}
              </Text>
            )}
            {list.map((c) => (
              <View key={c.id || c.name} style={styles.place}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{c.name}</Text>
                <Text style={[type.hint, { fontSize: 12.5 }]}>{c.address}</Text>
                <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
                  <Tag label={c.setting === 'indoor' ? 'Indoor' : c.setting === 'both' ? 'Indoor + outdoor' : 'Outdoor'} accent />
                  <Tag label={ACCESS_LABELS[c.access]} />
                  {!!c.sport && c.sport !== 'pickleball' && <Tag label={c.sport.charAt(0).toUpperCase() + c.sport.slice(1)} />}
                  {c.courts != null && <Tag label={`${c.courts} ${c.courts === 1 ? 'court' : 'courts'}`} />}
                  {c.lights === true && c.setting !== 'indoor' && <Tag label="Lights" />}
                </View>
                {!!c.note && <Text style={[type.hint, { fontSize: 12.5, marginTop: 4 }]}>{c.note}</Text>}
              </View>
            ))}
          </View>
        );
      })}
      <Text style={[type.hint, { fontSize: 11.5, marginTop: 6 }]}>
        Courts change — hours, fees and nets are the venue's call. Check before you make the drive. RSVPlay isn't affiliated with any venue listed.
      </Text>
    </View>
  );
}

export default function EventsScreen({ navigation }) {
  const app = useApp();
  // Places are edited on the desk at any time; fetch them again each time the
  // Events tab is opened, so a court added this morning is there this evening
  // without restarting the app.
  const reloadRef = useRef(app.reloadCourts);
  reloadRef.current = app.reloadCourts;
  useEffect(() => {
    if (!navigation || !navigation.addListener) return undefined;
    return navigation.addListener('focus', () => reloadRef.current && reloadRef.current());
  }, [navigation]);
  const [expanded, setExpanded] = useState({});
  const weeks = [...new Set(app.events.map((e) => e.week))];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <View style={styles.head}>
        <Text style={[type.display, { fontSize: 18 }]}>Events</Text>
        <CityBadge cities={app.eventCities} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {app.events.length === 0 && app.eventsLoading && (
          <Text style={[type.hint, { textAlign: 'center', paddingVertical: 30 }]}>Loading meetups…</Text>
        )}
        {app.events.length === 0 && app.eventsError && (
          <View style={{ alignItems: 'center', paddingVertical: 30, gap: 12 }}>
            <Text style={[type.hint, { textAlign: 'center' }]}>
              Couldn't load meetups — check your connection and try again.
            </Text>
            <Pressable style={styles.join} onPress={() => app.retryEvents()} accessibilityRole="button">
              <Text style={{ fontWeight: '800', fontSize: 13, color: colors.ink }}>Try again</Text>
            </Pressable>
          </View>
        )}
        {app.events.length === 0 && !app.eventsLoading && !app.eventsError && (
          <Text style={[type.hint, { textAlign: 'center', paddingVertical: 30 }]}>
            {app.eventCities.length === 1
              ? `Nothing on in ${cityLabel(app.eventCities[0])} yet — check back soon. 🎾`
              : `Nothing on in any of your ${app.eventCities.length} cities yet — check back soon. 🎾`}
          </Text>
        )}
        {weeks.map((w) => (
          <View key={w}>
            <Text style={[type.eyebrow, { marginTop: 14, marginBottom: 8 }]}>{w}</Text>
            {app.events.filter((e) => e.week === w).map((e) => (
              <EventCard
                key={e.id}
                app={app}
                e={e}
                expanded={!!expanded[e.id]}
                onToggle={() => setExpanded((x) => ({ ...x, [e.id]: !x[e.id] }))}
                showCity={app.eventCities.length > 1}
                onSeeCrew={() => navigation.navigate('Matches')}
              />
            ))}
          </View>
        ))}
        <Tournaments app={app} />
        <Leagues app={app} />
        <PlacesToPlay cities={app.eventCities} courtsFor={app.courtsFor} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingHorizontal: 18, paddingVertical: 14,
  },
  picker: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 999, borderWidth: 2, borderColor: colors.line,
    backgroundColor: colors.card, maxWidth: 210,
  },
  pickerText: { color: colors.text, fontWeight: '700', fontSize: 13.5, flexShrink: 1 },
  filter: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card,
  },
  filterOn: { backgroundColor: colors.optic, borderColor: colors.optic },
  tourney: {
    gap: 3, padding: 13, marginTop: 10,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 16,
  },
  brRound: { width: 214 },
  brMatch: {
    overflow: 'hidden',
    backgroundColor: colors.card2, borderWidth: 2, borderColor: colors.line, borderRadius: 12,
  },
  brRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36,
    paddingVertical: 5, paddingHorizontal: 10,
    borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  // The winner's row: lit in optic.
  brRowWon: { backgroundColor: colors.opticDim, borderLeftColor: colors.optic },
  brName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  brScore: { color: colors.optic, fontSize: 12.5, fontWeight: '800', textAlign: 'right', fontVariant: ['tabular-nums'] },
  brRule: { height: 1, backgroundColor: colors.line },
  brWon: { backgroundColor: colors.optic, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  youTag: { borderWidth: 2, borderColor: colors.optic, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 7 },
  youTagLabel: { color: colors.optic, fontSize: 10.5, fontWeight: '800' },
  ladderRow: {
    gap: 6, paddingVertical: 7, paddingHorizontal: 10,
    backgroundColor: colors.card2, borderWidth: 2, borderColor: colors.line, borderRadius: 12,
  },
  ladderRowMe: { borderColor: colors.optic },
  rung: { width: 22, color: colors.optic, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  record: { color: colors.dim, fontSize: 12.5, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  challengeBar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  lost: { borderWidth: 2, borderColor: colors.line, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 10 },
  place: {
    gap: 3, padding: 13, marginBottom: 10,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 16,
  },
  join: { backgroundColor: colors.optic, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  joinGoing: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.optic },
});
