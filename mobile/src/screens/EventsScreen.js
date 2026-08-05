import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, type } from '../theme';
import { Tag } from '../components/ui';
import { useApp } from '../state';
import { EVENTS } from '../data/seed';

export default function EventsScreen() {
  const app = useApp();
  const weeks = [...new Set(EVENTS.map((e) => e.week))];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <Text style={[type.display, { fontSize: 18, paddingHorizontal: 18, paddingVertical: 14 }]}>Events</Text>
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4 }}>
        {weeks.map((w) => (
          <View key={w}>
            <Text style={[type.eyebrow, { marginTop: 14, marginBottom: 8 }]}>{w}</Text>
            {EVENTS.filter((e) => e.week === w).map((e) => {
              const going = !!app.joined[e.id];
              return (
                <View key={e.id} style={styles.event}>
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
                  </View>
                  <View style={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={[type.hint, { fontSize: 11 }]}>{going ? e.spots - 1 : e.spots} spots left</Text>
                    <Pressable
                      style={[styles.join, going && styles.joinGoing]}
                      onPress={() => app.setJoined({ ...app.joined, [e.id]: !going })}
                    >
                      <Text style={{ fontWeight: '800', fontSize: 13, color: going ? colors.optic : colors.ink }}>
                        {going ? 'Going ✓' : 'Join'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
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
