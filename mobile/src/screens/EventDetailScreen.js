// One event, full screen: opened by tapping an event card on Home or Events.
// Everything the member can do here — RSVP with the waiver, cancel, check in
// with the host's code, see the crew — is the card's own action
// (useEventAction in components/events.js), so the rules live in one place.
// The event is looked up from app.events by id on every render, so an RSVP
// made here shows on the card on Home, and the other way round.
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type, radii } from '../theme';
import { Avatar } from '../components/ui';
import { useEventAction, priceLabel, clubSavingLabel } from '../components/events';
import { cityLabel } from '../data/cities';
import { useApp } from '../state';

// The organiser's description, as numbered steps — split only where a
// sentence ends (".", "!" or "?" then a space and a capital or digit), so
// "NTRP 3.0" and "Int. and up" stay whole. Never padded with invented steps.
export function descSteps(desc) {
  const text = String(desc || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!'.!?'.includes(text[i])) continue;
    let j = i + 1;
    while (j < text.length && '.!?"”’)'.includes(text[j])) j += 1;
    if (j < text.length && text[j] === ' ' && /[A-Z0-9"“‘(]/.test(text[j + 1] || '')) {
      out.push(text.slice(start, j).trim());
      start = j + 1;
      i = j;
    }
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// What Share sends: words only. There is no public page per event yet, so
// there is no link to put in it.
export function shareText(e) {
  const when = [e.dow, e.dom].filter(Boolean).join(' ');
  return `${e.title} — ${when}${e.time ? ` · ${e.time}` : ''} at ${e.venue}. Found on RSVPlay.`;
}

function Missing({ onBack }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <View style={styles.missingBar}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
      </View>
      <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
        <Text style={[type.display, { fontSize: 18, textAlign: 'center' }]}>This event isn’t on your list any more</Text>
        <Text style={[type.hint, { textAlign: 'center' }]}>It may have been moved, or your cities changed. The Events tab has everything that’s on.</Text>
      </View>
    </SafeAreaView>
  );
}

function Detail({ app, e, navigation }) {
  const { side, below, sheet } = useEventAction({
    app, e, onSeeCrew: () => navigation.navigate('Main', { screen: 'Matches' }),
  });
  const steps = descSteps(e.desc);
  // Names and faces only where the app already shows them (the demo's sample
  // players); live shows the count. Blocked and reported people are left out
  // by app.eventAttendees itself.
  const attendees = app.eventAttendees(e.id);
  const price = priceLabel(e.priceCents);
  const saving = clubSavingLabel(e.clubDiscountPct);
  const back = () => navigation.goBack();
  const share = () => Share.share({ message: shareText(e) }).catch(() => {});

  return (
    <View style={{ flex: 1, backgroundColor: colors.night }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <SafeAreaView edges={['top']} style={styles.head}>
          <View style={styles.headBar}>
            <Pressable onPress={back} style={styles.round} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
            <Pressable onPress={share} style={styles.round} hitSlop={6} accessibilityRole="button" accessibilityLabel="Share event">
              <Ionicons name="share-outline" size={20} color={colors.text} />
            </Pressable>
          </View>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {/* Optic never sits directly on Court blue: the sport chip is Ink. */}
              <Text style={[styles.chip, { backgroundColor: colors.ink, color: colors.optic }]}>{e.sport}</Text>
              {!!e.level && <Text style={[styles.chip, { backgroundColor: colors.text, color: colors.ink }]}>{e.level}</Text>}
            </View>
            <Text style={styles.title} accessibilityRole="header">{e.title}</Text>
            <Text style={styles.when}>{[e.dow, e.dom].filter(Boolean).join(' ')}{e.time ? ` · ${e.time}` : ''}</Text>
          </View>
        </SafeAreaView>

        <View style={{ padding: 20, gap: 16 }}>
          <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <View style={styles.pin}>
              <Ionicons name="location-outline" size={22} color={colors.optic} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{e.venue}</Text>
              {!!e.city && <Text style={[type.hint, { fontSize: 13 }]}>{cityLabel(e.city)}</Text>}
            </View>
          </View>

          {steps.length > 0 && (
            <View style={{ gap: 10 }}>
              <Text style={[type.display, { fontSize: 18 }]} accessibilityRole="header">How the night works</Text>
              {steps.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  {steps.length > 1 && (
                    <View style={styles.num}><Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13 }}>{i + 1}</Text></View>
                  )}
                  <Text style={[type.hint, { flex: 1, fontSize: 14, lineHeight: 20 }]}>{s}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} accessibilityLabel="Who’s going">
              {attendees.map((a, i) => (
                <View key={a.id} style={{ marginLeft: i ? -10 : 0 }}>
                  <Avatar id={a.id} name={a.name} size={36} borderColor={colors.card} />
                </View>
              ))}
              <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14, marginLeft: attendees.length ? 10 : 0, flexShrink: 1 }}>
                {e.goingCount || 0} going{e.going ? ' · including you' : ''}
              </Text>
            </View>
            <Text style={[type.hint, { fontSize: 13, fontWeight: '600' }]}>{e.spotsLeft} spots left</Text>
          </View>

          <Text style={[type.hint, { fontSize: 13 }]}>RSVP means show up. Check in with the host’s code when you arrive.</Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {below}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            {!!price && <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>{price}</Text>}
            {!!saving && <Text style={{ color: colors.optic, fontWeight: '700', fontSize: 12.5 }}>{saving}</Text>}
          </View>
          {side}
        </View>
      </SafeAreaView>
      {sheet}
    </View>
  );
}

export default function EventDetailScreen({ navigation, route }) {
  const app = useApp();
  const id = route && route.params && route.params.id;
  const e = app.events.find((x) => x.id === id);
  if (!e) return <Missing onBack={() => navigation.goBack()} />;
  // keyed by id, so the action's open step never carries over to another event
  return <Detail key={e.id} app={app} e={e} navigation={navigation} />;
}

const styles = StyleSheet.create({
  head: {
    backgroundColor: colors.courtBlue, paddingHorizontal: 20, paddingBottom: 28, paddingTop: 12,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 22,
  },
  headBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  round: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  chip: { fontSize: 11, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 10, overflow: 'hidden' },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6, lineHeight: 32, color: colors.text },
  when: { fontSize: 15, fontWeight: '600', color: colors.text },
  card: { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 16, padding: 14 },
  pin: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card2, alignItems: 'center', justifyContent: 'center' },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.card2, alignItems: 'center', justifyContent: 'center' },
  bar: {
    backgroundColor: colors.panel, borderTopWidth: 2, borderTopColor: colors.line,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14, gap: 12, borderRadius: radii.lg,
    borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
  },
  missingBar: { paddingHorizontal: 14, paddingVertical: 12 },
});
