import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, type } from '../theme';
import { Tag, Avatar } from '../components/ui';
import { useApp } from '../state';

export default function EventsScreen() {
  const app = useApp();
  const [expanded, setExpanded] = useState({});
  const weeks = [...new Set(app.events.map((e) => e.week))];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <Text style={[type.display, { fontSize: 18, paddingHorizontal: 18, paddingVertical: 14 }]}>Events</Text>
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4 }}>
        {app.events.length === 0 && (
          <Text style={[type.hint, { textAlign: 'center', paddingVertical: 30 }]}>
            No upcoming events yet — check back soon. 🎾
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
