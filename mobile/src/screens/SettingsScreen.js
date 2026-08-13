import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Pressable, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Chip } from '../components/ui';
import { useApp } from '../state';
import { CITIES, DEFAULT_CITY } from '../data/cities';
import { isBackendConfigured } from '../lib/supabase';
import * as api from '../api/backend';

const GENDERS = [
  { key: 'woman', label: 'Woman' },
  { key: 'man', label: 'Man' },
  { key: 'nonbinary', label: 'Nonbinary' },
];
const SEEKING = [
  { key: 'woman', label: 'Women' },
  { key: 'man', label: 'Men' },
  { key: 'nonbinary', label: 'Nonbinary people' },
];
const GAMES = [
  { key: 'singles', label: 'Singles' },
  { key: 'doubles', label: 'Doubles' },
  { key: 'mixed_doubles', label: 'Mixed doubles' },
];
const PARTNER_PREFS = [
  { key: 'women', label: 'Women' },
  { key: 'men', label: 'Men' },
  { key: 'nonbinary', label: 'Nonbinary people' },
  { key: 'everyone', label: 'Everyone' },
];

export default function SettingsScreen({ navigation }) {
  const app = useApp();
  const u = app.user;
  // Local text so a half-typed number isn't clamped mid-entry; the value is
  // committed (and clamped, and echoed back) when the field is done.
  const [radiusText, setRadiusText] = useState(String(app.prefs.radius));
  const [minText, setMinText] = useState(String(app.prefs.ageMin));
  const [maxText, setMaxText] = useState(String(app.prefs.ageMax));

  const clamp = (raw, lo, hi, fallback) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };

  const commitRadius = () => {
    const v = clamp(radiusText, 1, 50, app.prefs.radius);
    setRadiusText(String(v));
    app.updatePrefs({ ...app.prefs, radius: v });
  };

  const commitAges = () => {
    let lo = clamp(minText, 18, 99, app.prefs.ageMin);
    let hi = clamp(maxText, 18, 99, app.prefs.ageMax);
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    setMinText(String(lo));
    setMaxText(String(hi));
    app.updatePrefs({ ...app.prefs, ageMin: lo, ageMax: hi });
  };

  const modeOn = (m) => u && u.modes.includes(m);
  const toggleMode = (m) => {
    if (!u) return;
    if (m === 'date' && u.isTeam && !modeOn('date')) {
      Alert.alert('Teams can’t use Date mode', 'A shared profile is for Play and Friends. If you want to date, each of you needs your own profile.');
      return;
    }
    if (modeOn(m) && u.modes.length === 1) {
      Alert.alert('Keep at least one mode on');
      return;
    }
    const modes = modeOn(m) ? u.modes.filter((x) => x !== m) : [...u.modes, m];
    app.updateModes(modes);
  };

  const signOut = () => {
    // Don't promise an email code: an Apple "Hide My Email" member can't
    // receive one at an address they've never seen.
    Alert.alert('Sign out?', app.live ? 'Sign back in anytime the same way you signed up.' : 'Your local demo profile will be cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          app.signOut();
          navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
        },
      },
    ]);
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your profile, matches, and messages. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isBackendConfigured) await api.deleteAccount();
              app.signOut();
              navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
            } catch (e) {
              Alert.alert('Couldn’t delete your account', (e && e.message) || 'Check your connection and try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <View style={styles.bar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[type.display, { fontSize: 18 }]}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, gap: 20 }}>
        <Group title="Modes">
          <Row label="Date Mode" sub="Find your perfect match">
            <Switch value={modeOn('date')} onValueChange={() => toggleMode('date')} trackColor={{ true: colors.opticDim }} thumbColor={modeOn('date') ? colors.optic : colors.dim} />
          </Row>
          <Row label="Play Mode" sub="Find players for your next match">
            <Switch value={modeOn('play')} onValueChange={() => toggleMode('play')} trackColor={{ true: colors.opticDim }} thumbColor={modeOn('play') ? colors.optic : colors.dim} />
          </Row>
          <Row label="Friends Mode" sub="Expand your circle">
            <Switch value={modeOn('friends')} onValueChange={() => toggleMode('friends')} trackColor={{ true: colors.opticDim }} thumbColor={modeOn('friends') ? colors.optic : colors.dim} />
          </Row>
        </Group>

        <Group title="Dating">
          <View style={styles.datingBox}>
            <Text style={styles.datingLabel}>I am</Text>
            <View style={styles.chipRow}>
              {GENDERS.map((g) => (
                <Chip
                  key={g.key}
                  label={g.label}
                  active={u && u.gender === g.key}
                  onPress={() => app.updateDating(g.key, (u && u.seeking) || [])}
                />
              ))}
            </View>
            <Text style={[styles.datingLabel, { marginTop: 14 }]}>Looking to date</Text>
            <View style={styles.chipRow}>
              {SEEKING.map((s) => {
                const cur = (u && u.seeking) || [];
                const on = cur.includes(s.key);
                return (
                  <Chip
                    key={s.key}
                    label={s.label}
                    active={on}
                    onPress={() => {
                      const next = on ? cur.filter((x) => x !== s.key) : [...cur, s.key];
                      if (!next.length) {
                        return Alert.alert('Keep at least one', 'Date mode needs to know who you’d like to meet — otherwise there’s nobody to show you.');
                      }
                      app.updateDating((u && u.gender) || null, next);
                    }}
                  />
                );
              })}
            </View>
            <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
              Date mode only shows people who fit what you're looking for — and who are looking for someone like you.
            </Text>
          </View>
        </Group>

        <Group title="Play">
          <View style={styles.datingBox}>
            <Text style={styles.datingLabel}>Game types</Text>
            <View style={styles.chipRow}>
              {GAMES.map((g) => {
                const cur = (u && u.playGames) || ['singles', 'doubles', 'mixed_doubles'];
                const on = cur.includes(g.key);
                return (
                  <Chip
                    key={g.key}
                    label={g.label}
                    active={on}
                    onPress={() => app.updatePlay(on ? cur.filter((x) => x !== g.key) : [...cur, g.key], (u && u.playPref) || 'everyone')}
                  />
                );
              })}
            </View>
            <Text style={[styles.datingLabel, { marginTop: 14 }]}>Play singles/doubles with</Text>
            <View style={styles.chipRow}>
              {PARTNER_PREFS.map((p) => (
                <Chip
                  key={p.key}
                  label={p.label}
                  active={((u && u.playPref) || 'everyone') === p.key}
                  onPress={() => app.updatePlay((u && u.playGames) || ['singles', 'doubles', 'mixed_doubles'], p.key)}
                />
              ))}
            </View>
            <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
              Play mode shows players who want the same game types. Mixed doubles is open to everyone by nature.
            </Text>
          </View>
        </Group>

        <Group title="Friends">
          <View style={styles.datingBox}>
            <Text style={styles.datingLabel}>Meet</Text>
            <View style={styles.chipRow}>
              {PARTNER_PREFS.map((p) => (
                <Chip
                  key={p.key}
                  label={p.label}
                  active={((u && u.friendsPref) || 'everyone') === p.key}
                  onPress={() => app.updateFriendsPref(p.key)}
                />
              ))}
            </View>
          </View>
        </Group>

        <Group title="City">
          <View style={styles.datingBox}>
            <View style={styles.chipRow}>
              {CITIES.map((c) => (
                <Chip
                  key={c.slug}
                  label={`${c.name}, ${c.state}`}
                  active={((u && u.city) || DEFAULT_CITY) === c.slug}
                  onPress={() => app.updateCity(c.slug)}
                />
              ))}
            </View>
            <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
              You match with players in your city. Moving, or splitting time between two? Switch any time — your matches and messages come with you.
            </Text>
          </View>
        </Group>

        <Group title="Doubles team">
          <View style={styles.datingBox}>
            <Row label="We're a doubles team" sub="Two of you, one profile">
              <Switch
                value={!!(u && u.isTeam)}
                onValueChange={(on) => {
                  if (!on) return app.updateTeam({ isTeam: false });
                  if (!u || !u.partnerName) {
                    return Alert.alert(
                      'Add your partner first',
                      'A team profile needs your partner’s first name, birthdate, and gender. Tell us those and we’ll switch it on.',
                      [{ text: 'OK' }]
                    );
                  }
                  app.updateTeam({ isTeam: true, partnerName: u.partnerName, partnerBirthdate: u.partnerBirthdate, partnerGender: u.partnerGender });
                }}
                trackColor={{ true: colors.opticDim }}
                thumbColor={u && u.isTeam ? colors.optic : colors.dim}
              />
            </Row>
            {u && u.isTeam ? (
              <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
                Playing as {u.name} & {u.partnerName}. Team profiles are for Play and Friends — Date mode is off, because a shared profile can't date. To change your partner's details, contact support.
              </Text>
            ) : (
              <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
                Set this up when you create your profile. Both people must be 18+, and you stay responsible for the account.
              </Text>
            )}
          </View>
        </Group>

        <Group title="Discovery">
          <Row label="Distance (miles)" sub="How far away players can be">
            <TextInput
              style={styles.numInput}
              value={radiusText}
              onChangeText={(t) => setRadiusText(t.replace(/[^0-9]/g, ''))}
              onEndEditing={commitRadius}
              onBlur={commitRadius}
              keyboardType="number-pad"
              maxLength={2}
            />
          </Row>
          <Row label="Age range">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                style={styles.numInput}
                value={minText}
                onChangeText={(t) => setMinText(t.replace(/[^0-9]/g, ''))}
                onEndEditing={commitAges}
                onBlur={commitAges}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={{ color: colors.dim }}>–</Text>
              <TextInput
                style={styles.numInput}
                value={maxText}
                onChangeText={(t) => setMaxText(t.replace(/[^0-9]/g, ''))}
                onEndEditing={commitAges}
                onBlur={commitAges}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
          </Row>
          <Row label="Only my sports" sub="Show only players who share a sport with you">
            <Switch
              value={app.prefs.mySportsOnly}
              onValueChange={(v) => app.updatePrefs({ ...app.prefs, mySportsOnly: v })}
              trackColor={{ true: colors.opticDim }}
              thumbColor={app.prefs.mySportsOnly ? colors.optic : colors.dim}
            />
          </Row>
        </Group>

        <Pressable style={styles.danger} onPress={signOut}>
          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 15 }}>Sign out</Text>
        </Pressable>
        <Pressable style={styles.deleteLink} onPress={deleteAccount}>
          <Text style={{ color: colors.dim, fontWeight: '700', fontSize: 13 }}>Delete my account</Text>
        </Pressable>
        <Text style={[type.hint, { textAlign: 'center' }]}>
          {`40/Love · ${app.cityLabel((u && u.city) || DEFAULT_CITY)} · ${app.live ? 'beta' : 'demo build — not a real account'}`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ title, children }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={type.eyebrow}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, sub, children }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{label}</Text>
        {sub ? <Text style={[type.hint, { fontSize: 12, marginTop: 2 }]}>{sub}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 13, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line,
    borderRadius: 14, marginBottom: 8,
  },
  numInput: {
    width: 62, textAlign: 'center',
    borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card2, borderRadius: 10,
    paddingVertical: 8, fontSize: 16, color: colors.text,
  },
  danger: {
    alignItems: 'center', padding: 14,
    borderWidth: 2, borderColor: colors.danger, borderRadius: 14,
  },
  deleteLink: { alignItems: 'center', paddingVertical: 6 },
  datingBox: {
    padding: 13, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line,
    borderRadius: 14, marginBottom: 8,
  },
  datingLabel: { color: colors.text, fontWeight: '700', fontSize: 14, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
