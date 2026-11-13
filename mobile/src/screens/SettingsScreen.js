import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Pressable, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Chip } from '../components/ui';
import { useApp, ageFromBirthdate, citiesOf } from '../state';
import { parseBirthdate, formatBirthdateInput, birthdateToText } from '../lib/birthdate';
import { CITIES, DEFAULT_CITY } from '../data/cities';
import { LINKS, openLink } from '../lib/links';
import { confirmDeleteAccount } from '../lib/account';

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
// "3 minutes ago" / "yesterday" — precise enough to recognise a device,
// vague enough not to read like surveillance.
function sinceLabel(ts) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs === 1 ? 'an hour ago' : `${hrs} hours ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

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

  // Adding (or editing) a doubles partner after signup. The fields are local
  // until Save, so a half-typed partner never reaches the profile.
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [pName, setPName] = useState('');
  const [pBirth, setPBirth] = useState('');
  const [pGender, setPGender] = useState(null);

  const openPartnerForm = () => {
    setPName((u && u.partnerName) || '');
    setPBirth(birthdateToText(u && u.partnerBirthdate));
    setPGender((u && u.partnerGender) || null);
    setPartnerOpen(true);
  };

  const savePartner = () => {
    if (!u) return;
    const nm = pName.trim();
    if (!nm) return Alert.alert('Almost there', 'Add your partner’s first name.');
    const iso = parseBirthdate(pBirth);
    if (!iso) return Alert.alert('Almost there', 'Enter your partner’s birthdate as MM/DD/YYYY.');
    const age = ageFromBirthdate(iso);
    if (age < 18) return Alert.alert('RSVPlay is 18+', 'Both people on a team must be 18 or older.');
    if (age > 99) return Alert.alert('Almost there', 'Check that birthdate — that can’t be right.');
    if (!pGender) return Alert.alert('Almost there', 'Tell us your partner’s gender so matching works.');
    const apply = () => {
      app.updateTeam({ isTeam: true, partnerName: nm, partnerBirthdate: iso, partnerGender: pGender });
      setPartnerOpen(false);
    };
    // Becoming a team takes the profile out of Date mode. Say so before it
    // happens rather than letting someone find their dating deck gone.
    if (!u.isTeam && (u.modes || []).includes('date')) {
      return Alert.alert(
        'This turns Date mode off',
        'A shared profile is for Play and Friends — it can’t date. Adding a partner takes you out of Date mode. You can remove your partner later to get it back.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Add partner', onPress: apply }]
      );
    }
    apply();
  };

  const removePartner = () => {
    Alert.alert(
      `Remove ${(u && u.partnerName) || 'your partner'}?`,
      'Your profile goes back to being just you. After your first hour, a partner can only be added once every 30 days, so only remove them if you mean to.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { app.updateTeam({ isTeam: false }); setPartnerOpen(false); } },
      ]
    );
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

  useEffect(() => {
    if (app.live) app.refreshDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.live]);

  const confirmSignOutDevice = (d) => {
    Alert.alert(
      `Sign out ${d.name || 'this device'}?`,
      'It stops receiving your notifications immediately, and is signed out the next time it opens RSVPlay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign it out',
          style: 'destructive',
          onPress: async () => {
            try {
              const ok = await app.signOutDevice(d.id);
              if (!ok) Alert.alert('Already signed out', 'That device had already been signed out.');
            } catch (e) {
              Alert.alert('Couldn’t sign it out', (e && e.message) || 'Check your connection and try again.');
            }
          },
        },
      ]
    );
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

  const deleteAccount = () => confirmDeleteAccount({ app, navigation });

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
          <Row label="Play Mode" sub="Find players for your next match">
            <Switch value={modeOn('play')} onValueChange={() => toggleMode('play')} trackColor={{ true: colors.opticDim }} thumbColor={modeOn('play') ? colors.optic : colors.dim} />
          </Row>
          <Row label="Date Mode" sub="Opt-in — meet people you’d like to date">
            <Switch value={modeOn('date')} onValueChange={() => toggleMode('date')} trackColor={{ true: colors.opticDim }} thumbColor={modeOn('date') ? colors.optic : colors.dim} />
          </Row>
          <Row label="Friends Mode" sub="Expand your circle">
            <Switch value={modeOn('friends')} onValueChange={() => toggleMode('friends')} trackColor={{ true: colors.opticDim }} thumbColor={modeOn('friends') ? colors.optic : colors.dim} />
          </Row>
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

        {app.live && (
          <Group title="Devices">
            <View style={styles.datingBox}>
              {app.devices.length === 0 ? (
                <Text style={[type.hint, { fontSize: 12 }]}>Just this one so far.</Text>
              ) : app.devices.map((d) => {
                const isThis = d.device_key === app.deviceKey;
                return (
                  <View key={d.id} style={styles.deviceRow}>
                    <Ionicons name={d.platform === 'android' ? 'phone-portrait-outline' : 'phone-portrait'} size={20} color={colors.dim} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                        {d.name || 'Unnamed device'}{isThis ? '  ·  This device' : ''}
                      </Text>
                      <Text style={type.hint}>Last used {sinceLabel(d.last_seen_at)}</Text>
                    </View>
                    {!isThis && (
                      <Pressable onPress={() => confirmSignOutDevice(d)} hitSlop={6} accessibilityLabel={`Sign out ${d.name || 'this device'}`}>
                        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>Sign out</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
              <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
                Every phone you sign in on shows up here. Lost one, or shared your passcode with someone you'd rather not have? Sign it out — it stops getting your notifications straight away, and it's signed out the next time it opens the app.
              </Text>
            </View>
          </Group>
        )}

        <Group title="Cities">
          <View style={styles.datingBox}>
            <View style={styles.chipRow}>
              {CITIES.map((c) => (
                <Chip
                  key={c.slug}
                  label={`${c.name}, ${c.state}`}
                  active={citiesOf(u).includes(c.slug)}
                  onPress={() => {
                    const res = app.toggleCity(c.slug);
                    if (res === 'unknown-city') {
                      Alert.alert('Update RSVPlay to change cities', 'One of your cities is newer than this version of the app. Update the app and you can change them here.');
                    } else if (!res) {
                      Alert.alert('Keep at least one city', 'Pick another city first, then you can drop this one.');
                    }
                  }}
                />
              ))}
            </View>
            <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
              {citiesOf(u).length > 1
                ? `You match with players and see meetups in all ${citiesOf(u).length} of your cities. Tap a city to add or drop it — your matches and messages stay either way.`
                : 'You match with players and see meetups in your city. Split your time between two or more? Tap every city you play in.'}
            </Text>
          </View>
        </Group>

        <Group title="Doubles team">
          <View style={styles.datingBox}>
            <Row label="We're a doubles team" sub="Two of you, one profile">
              <Switch
                value={!!(u && u.isTeam) || partnerOpen}
                onValueChange={(on) => {
                  if (on) return openPartnerForm();
                  if (u && u.isTeam) return removePartner();
                  setPartnerOpen(false);
                }}
                trackColor={{ true: colors.opticDim }}
                thumbColor={(u && u.isTeam) || partnerOpen ? colors.optic : colors.dim}
              />
            </Row>

            {partnerOpen ? (
              <View style={{ marginTop: 4 }}>
                <Text style={styles.datingLabel}>Your partner</Text>
                <TextInput
                  style={styles.textInput}
                  value={pName}
                  onChangeText={setPName}
                  placeholder="Their first name"
                  placeholderTextColor="rgba(245,244,238,0.35)"
                  maxLength={40}
                  accessibilityLabel="Partner's first name"
                />
                <TextInput
                  style={[styles.textInput, { marginTop: 8 }]}
                  value={pBirth}
                  onChangeText={(t) => setPBirth(formatBirthdateInput(t))}
                  keyboardType="number-pad"
                  placeholder="Their birthdate — MM/DD/YYYY"
                  placeholderTextColor="rgba(245,244,238,0.35)"
                  maxLength={10}
                  accessibilityLabel="Partner's birthdate"
                />
                <Text style={[styles.datingLabel, { marginTop: 12 }]}>They are</Text>
                <View style={styles.chipRow}>
                  {GENDERS.map((g) => (
                    <Chip key={g.key} label={g.label} active={pGender === g.key} onPress={() => setPGender(g.key)} />
                  ))}
                </View>
                <Text style={[type.hint, { fontSize: 12, marginTop: 8 }]}>
                  By adding a partner you confirm they're 18 or older and agreed to be on your profile. Their first name, age and gender appear on your shared card. After your first hour, a partner can be added, or their gender changed, once every 30 days.
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <Pressable style={styles.partnerSave} onPress={savePartner} accessibilityRole="button">
                    <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 14 }}>
                      {u && u.isTeam ? 'Save partner' : 'Add partner'}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.partnerCancel} onPress={() => setPartnerOpen(false)} accessibilityRole="button">
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Cancel</Text>
                  </Pressable>
                </View>
                <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
                  Both of you must be 18+. Ask before you add someone — their name and age go on a public profile. You stay responsible for the account.
                </Text>
              </View>
            ) : u && u.isTeam ? (
              <>
                <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
                  Playing as {u.name} & {u.partnerName}. Team profiles are for Play and Friends — Date mode is off, because a shared profile can't date.
                </Text>
                <Pressable onPress={openPartnerForm} style={{ paddingTop: 10 }} accessibilityRole="button">
                  <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13.5 }}>Edit partner's details</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[type.hint, { fontSize: 12, marginTop: 10 }]}>
                  Found a doubles partner since you signed up? Add them here and the two of you share one profile for Play and Friends.
                </Text>
                <Pressable onPress={openPartnerForm} style={{ paddingTop: 10 }} accessibilityRole="button">
                  <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13.5 }}>Add a partner</Text>
                </Pressable>
              </>
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
          <Text style={[type.hint, { fontSize: 12 }]}>
            Looking for “Only my sports”? It's on the Home screen now, right above the players it filters.
          </Text>
        </Group>

        <Group title="Safety and legal">
          <Pressable onPress={() => navigation.navigate('Rules')} accessibilityRole="button" accessibilityLabel="House rules & safety">
            <Row label="House rules & safety" sub="Seven rules, the same in every city">
              <Ionicons name="chevron-forward" size={18} color={colors.dim} />
            </Row>
          </Pressable>
          {[
            { label: 'Safety tips', url: LINKS.safety, icon: 'shield-checkmark-outline' },
            { label: 'Terms of Service', url: LINKS.terms, icon: 'document-text-outline' },
            { label: 'Privacy Policy', url: LINKS.privacy, icon: 'lock-closed-outline' },
          ].map((l) => (
            <Pressable key={l.label} onPress={() => openLink(l.url)} accessibilityRole="link">
              <Row label={l.label}>
                <Ionicons name={l.icon} size={18} color={colors.dim} />
              </Row>
            </Pressable>
          ))}
        </Group>

        <Pressable style={styles.danger} onPress={signOut}>
          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 15 }}>Sign out</Text>
        </Pressable>
        <Pressable style={styles.deleteLink} onPress={deleteAccount}>
          <Text style={{ color: colors.dim, fontWeight: '700', fontSize: 13 }}>Delete my account</Text>
        </Pressable>
        <Text style={[type.hint, { textAlign: 'center' }]}>
          {`RSVPlay · ${citiesOf(u).length > 1 ? `${citiesOf(u).length} cities` : app.cityLabel((u && u.city) || DEFAULT_CITY)} · ${app.live ? 'beta' : 'demo build — not a real account'}`}
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
  textInput: {
    borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card2, borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 13, fontSize: 16, color: colors.text,
  },
  partnerSave: { flex: 1, alignItems: 'center', backgroundColor: colors.optic, borderRadius: 12, paddingVertical: 12 },
  partnerCancel: { alignItems: 'center', borderWidth: 2, borderColor: colors.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18 },
  danger: {
    alignItems: 'center', padding: 14,
    borderWidth: 2, borderColor: colors.danger, borderRadius: 14,
  },
  deleteLink: { alignItems: 'center', paddingVertical: 6 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  datingBox: {
    padding: 13, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line,
    borderRadius: 14, marginBottom: 8,
  },
  datingLabel: { color: colors.text, fontWeight: '700', fontSize: 14, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
