import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Tag, Avatar } from '../components/ui';
import { useApp } from '../state';
import { cityLabel } from '../data/cities';
import { courtsFor, ACCESS_LABELS } from '../data/courts';

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

const SETTING_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'indoor', label: 'Indoor' },
];

// Places to play in the member's cities, under the meetups. Only cities we
// have a list for appear; a city with none simply has no section.
function PlacesToPlay({ cities }) {
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
              <View key={c.name} style={styles.place}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{c.name}</Text>
                <Text style={[type.hint, { fontSize: 12.5 }]}>{c.address}</Text>
                <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
                  <Tag label={c.setting === 'indoor' ? 'Indoor' : c.setting === 'both' ? 'Indoor + outdoor' : 'Outdoor'} accent />
                  <Tag label={ACCESS_LABELS[c.access]} />
                  {c.courts != null && <Tag label={`${c.courts} courts`} />}
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

export default function EventsScreen() {
  const app = useApp();
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
        <PlacesToPlay cities={app.eventCities} />
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
