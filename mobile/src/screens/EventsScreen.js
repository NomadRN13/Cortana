import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Tag, Avatar } from '../components/ui';
import { useApp } from '../state';
import { cityLabel } from '../data/cities';
import { ACCESS_LABELS } from '../data/courts';
import { bracketRoundName } from '../lib/bracket';

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

// One line of a match: a player, highlighted if they won, with a button to
// record them as the winner when this member is allowed to.
function BracketPlayer({ app, t, m, id }) {
  const won = !!m.winner && m.winner === id;
  const lost = !!m.winner && m.winner !== id;
  const name = id ? app.playerName(id) : (m.bye ? '— bye —' : 'To be decided');
  const record = () => {
    Alert.alert(
      `${app.playerName(id)} won?`,
      'This goes straight into the bracket and moves them to the next round. Only record a match that has been played.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Record result', onPress: () => app.reportMatch(t.id, m.id, id, '') }]
    );
  };
  return (
    <View style={styles.brPlayer}>
      <Text
        style={[styles.brName, won && { color: colors.optic, fontWeight: '800' }, (lost || !id) && { color: colors.dim }]}
        numberOfLines={1}
      >
        {name}{id && app.isMe(id) ? '  (you)' : ''}
      </Text>
      {won && <Ionicons name="checkmark-circle" size={16} color={colors.optic} />}
      {!!id && app.canReportMatch(m) && (
        <Pressable onPress={record} style={styles.brWon} accessibilityRole="button" accessibilityLabel={`Record ${app.playerName(id)} as the winner`}>
          <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 11.5 }}>Won</Text>
        </Pressable>
      )}
    </View>
  );
}

// The bracket, round by round, top to bottom — the shape that fits a phone.
// Every round is there from the moment of the draw; later rounds fill in as
// results come in.
function Bracket({ app, t }) {
  const rounds = [];
  for (let r = 1; r <= t.rounds; r += 1) rounds.push(r);
  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      {rounds.map((r) => (
        <View key={r}>
          <Text style={[type.eyebrow, { marginTop: 8, marginBottom: 6 }]}>{bracketRoundName(r, t.rounds)}</Text>
          {t.matches.filter((m) => m.round === r).map((m) => (
            <View key={m.id} style={[styles.brMatch, (app.isMe(m.a) || app.isMe(m.b)) && { borderColor: colors.optic }]}>
              <BracketPlayer app={app} t={t} m={m} id={m.a} />
              <View style={styles.brRule} />
              <BracketPlayer app={app} t={t} m={m} id={m.b} />
              {!!m.score && <Text style={[type.hint, { fontSize: 11.5, marginTop: 4 }]}>{m.score}</Text>}
            </View>
          ))}
        </View>
      ))}
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
        const full = t.entries.length >= t.max;
        const status = t.status === 'registration'
          ? `${t.entries.length} of ${t.max} entered`
          : t.status === 'completed'
            ? `Champion: ${app.playerName(t.championId)}`
            : `In progress · ${t.entries.length} players`;
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
              {!app.live && t.status === 'registration' && t.entries.length >= 2 && (
                <Pressable onPress={() => { app.drawTournament(t.id); setOpen((o) => ({ ...o, [t.id]: true })); }} accessibilityRole="button">
                  <Text style={{ color: colors.dim, fontWeight: '700', fontSize: 12.5 }}>Make the draw (demo)</Text>
                </Pressable>
              )}
            </View>
            {isOpen && t.status === 'registration' && (
              <View style={{ marginTop: 8 }}>
                <Text style={[type.hint, { fontSize: 12.5 }]}>
                  {t.entries.length ? t.entries.map((e) => app.playerName(e.id)).join(' · ') : 'Nobody yet — be the first.'}
                </Text>
                <Text style={[type.hint, { fontSize: 11.5, marginTop: 6 }]}>
                  When entries close the organiser makes the draw: the bracket is built for however many have entered, up to {t.max}, and everyone is placed in it automatically.
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
        Courts change — hours, fees and nets are the venue's call. Check before you make the drive.
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
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4 }}>
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
            {app.events.filter((e) => e.week === w).map((e) => {
              const open = !!expanded[e.id];
              const attendees = open ? app.eventAttendees(e.id) : [];
              return (
                <Pressable
                  key={e.id}
                  style={[styles.event, open && { borderColor: colors.optic }]}
                  onPress={() => setExpanded((x) => ({ ...x, [e.id]: !x[e.id] }))}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                >
                  <View style={styles.date}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: colors.dim, letterSpacing: 0.6 }}>{e.dow.toUpperCase()}</Text>
                    <Text style={{ fontSize: 20, fontWeight: '900', color: colors.optic }}>{e.dom}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{e.title}</Text>
                    <Text style={[type.hint, { fontSize: 12.5 }]}>{e.venue} · {e.time}</Text>
                    <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                      <Tag label={e.sport} accent />
                      <Tag label={e.level} />
                      {/* which city, once the list spans more than one */}
                      {app.eventCities.length > 1 && !!e.city && <Tag label={cityLabel(e.city)} />}
                    </View>
                    {open && (
                      <View style={{ gap: 8, marginTop: 6 }}>
                        {!!e.desc && <Text style={[type.hint, { fontSize: 12.5 }]}>{e.desc}</Text>}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {attendees.map((a, i) => (
                            <View key={a.id} style={{ marginLeft: i ? -10 : 0 }}>
                              <Avatar id={a.id} name={a.name} size={26} />
                            </View>
                          ))}
                          <Text style={[type.hint, { fontSize: 12, marginLeft: 6 }]}>
                            +{e.goingCount || 0} going{e.going ? ' · including you' : ''}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={[type.hint, { fontSize: 11 }]}>{e.spotsLeft} spots left</Text>
                    <Pressable style={[styles.join, e.going && styles.joinGoing]} onPress={() => app.toggleJoin(e.id)}>
                      <Text style={{ fontWeight: '800', fontSize: 13, color: e.going ? colors.optic : colors.ink }}>
                        {e.going ? 'Going ✓' : 'Join'}
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        <Tournaments app={app} />
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
  brMatch: {
    padding: 10, marginBottom: 8,
    backgroundColor: colors.card2, borderWidth: 2, borderColor: colors.line, borderRadius: 12,
  },
  brPlayer: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 26 },
  brName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  brRule: { height: 1, backgroundColor: colors.line, marginVertical: 5 },
  brWon: { backgroundColor: colors.optic, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  place: {
    gap: 3, padding: 13, marginBottom: 10,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 16,
  },
  event: {
    flexDirection: 'row', gap: 12, padding: 13, marginBottom: 10,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 16,
  },
  date: {
    width: 52, borderWidth: 2, borderColor: colors.optic, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
  },
  join: { backgroundColor: colors.optic, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  joinGoing: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.optic },
});
