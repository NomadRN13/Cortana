import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Tag, Avatar } from '../components/ui';
import { useApp } from '../state';
import { CITIES, cityLabel } from '../data/cities';

// Meetups are nationwide by default. React Native has no <select>, so the
// picker is a button that opens a sheet — the same thing a dropdown does, and
// it behaves identically on both platforms without another dependency.
function CityPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const label = value === 'all' ? 'All cities' : cityLabel(value);
  const options = [{ slug: 'all', label: 'All cities' }]
    .concat(CITIES.map((c) => ({ slug: c.slug, label: `${c.name}, ${c.state}` })));

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.picker}
        accessibilityRole="button"
        accessibilityLabel={`Showing meetups in ${label}. Change city.`}
      >
        <Ionicons name="location-outline" size={15} color={colors.optic} />
        <Text style={styles.pickerText} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={15} color={colors.dim} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={[type.eyebrow, { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }]}>
              Show meetups in
            </Text>
            <ScrollView>
              {options.map((o) => {
                const on = o.slug === value;
                return (
                  <Pressable
                    key={o.slug}
                    onPress={() => { onChange(o.slug); setOpen(false); }}
                    style={[styles.option, on && { backgroundColor: colors.card2 }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={{ color: on ? colors.optic : colors.text, fontWeight: on ? '800' : '600', fontSize: 15 }}>
                      {o.label}
                    </Text>
                    {on && <Ionicons name="checkmark" size={17} color={colors.optic} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
        <CityPicker value={app.eventCity} onChange={app.setEventCity} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4 }}>
        {app.events.length === 0 && (
          <Text style={[type.hint, { textAlign: 'center', paddingVertical: 30 }]}>
            {app.eventCity === 'all'
              ? 'No upcoming events anywhere yet — check back soon. 🎾'
              : `Nothing on in ${cityLabel(app.eventCity)} yet. Try All cities to see what's happening elsewhere. 🎾`}
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
                      {app.eventCity === 'all' && !!e.city && <Tag label={cityLabel(e.city)} />}
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
  backdrop: {
    flex: 1, backgroundColor: 'rgba(4,5,6,0.7)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  sheet: {
    width: '100%', maxWidth: 340, maxHeight: '70%',
    backgroundColor: colors.panel, borderRadius: 20,
    borderWidth: 2, borderColor: colors.line, overflow: 'hidden',
  },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 16,
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
