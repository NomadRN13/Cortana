// House rules & safety, reached from Settings. Seven rules, each one true of
// this app as built — checked against docs/rules-and-stops.md. Where the
// approved mockup promised more than the app does (hosts removing players,
// the desk re-rating sandbaggers) the line says what actually happens.
// Account deletion goes through the same flow Settings uses (lib/account.js).
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { useApp } from '../state';
import { LINKS, openLink } from '../lib/links';
import { confirmDeleteAccount } from '../lib/account';

export const HOUSE_RULES = [
  {
    head: '18 and over, no exceptions.',
    body: 'Every member is an adult. Teams count as two members, and both must be 18+.',
  },
  {
    head: 'Real people only.',
    body: 'Every account is phone-verified. New photos are reviewed before other players see them. Your number is never shown and never used for marketing.',
  },
  {
    head: 'Play the level you say.',
    body: 'Honest ratings make honest games. If someone’s sandbagging, report it and a person on the desk will look into it.',
  },
  {
    head: 'Dating is opt-in.',
    body: 'Date Mode is off unless you turn it on, and only people who have it on too can see you there. Play and Friends work the same either way.',
  },
  {
    head: 'RSVP means show up.',
    body: 'Accept the event waiver when you RSVP and check in with the host’s code when you arrive. Can’t make it? Give the spot back so someone else can play.',
  },
  {
    head: 'Respect the court.',
    body: 'Report or block anyone from their card, your chat or your crew. Blocks work both ways, at once. Reports go to a person on the desk, who aims to act within 24 hours. Nobody checks in without accepting the event waiver.',
  },
  {
    head: 'Your data is yours.',
    body: 'Delete your account from Settings any time. Your profile, photos, matches and messages go with it.',
  },
];

export default function RulesScreen({ navigation }) {
  const app = useApp();
  const rows = [
    { label: 'Privacy policy', icon: 'lock-closed-outline', onPress: () => openLink(LINKS.privacy), role: 'link' },
    { label: 'Terms of use', icon: 'document-text-outline', onPress: () => openLink(LINKS.terms), role: 'link' },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <View style={styles.bar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[type.display, { fontSize: 18 }]} accessibilityRole="header">House rules & safety</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, gap: 12 }}>
        <Text style={type.hint}>Short, plain, and the same in every city. Break them and the desk can suspend or ban your account.</Text>

        {HOUSE_RULES.map((r, i) => (
          <View key={r.head} style={styles.rule}>
            <View style={styles.num}><Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13 }}>{i + 1}</Text></View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{r.head}</Text>
              <Text style={[type.hint, { fontSize: 13.5 }]}>{r.body}</Text>
            </View>
          </View>
        ))}

        <View style={{ marginTop: 8 }}>
          {rows.map((l) => (
            <Pressable key={l.label} onPress={l.onPress} accessibilityRole={l.role} style={styles.row}>
              <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: 14 }}>{l.label}</Text>
              <Ionicons name={l.icon} size={18} color={colors.dim} />
            </Pressable>
          ))}
          <Pressable onPress={() => confirmDeleteAccount({ app, navigation })} accessibilityRole="button" style={styles.row}>
            <Text style={{ flex: 1, color: colors.danger, fontWeight: '700', fontSize: 14 }}>Delete account</Text>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  rule: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    padding: 14, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 16,
  },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.card2, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 13, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line,
    borderRadius: 14, marginBottom: 8,
  },
});
