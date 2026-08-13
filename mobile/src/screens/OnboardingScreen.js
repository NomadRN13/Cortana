import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Btn, Chip, Avatar } from '../components/ui';
import { useApp, ageFromBirthdate } from '../state';
import { SPORTS, SKILLS } from '../data/seed';

// "MM/DD/YYYY" → "YYYY-MM-DD", or null if not a real calendar date
function parseBirthdate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== Number(mm) || d.getUTCDate() !== Number(dd)) return null;
  return iso;
}

const MODES = [
  { key: 'date', icon: 'heart-outline', name: 'Date Mode', desc: 'Find your perfect match' },
  { key: 'play', icon: 'tennisball-outline', name: 'Play Mode', desc: 'Find players for your next match' },
  { key: 'friends', icon: 'people-outline', name: 'Friends Mode', desc: 'Expand your circle on and off the court' },
];

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
  { key: 'everyone', label: 'Everyone' },
];

export default function OnboardingScreen({ navigation, route }) {
  const app = useApp();
  const [step, setStep] = useState(0);
  // Apple hands over a first name only on the very first sign-in — if we got
  // one, start with it filled in rather than asking again.
  const [name, setName] = useState((route && route.params && route.params.firstName) || '');
  const [birthdateText, setBirthdateText] = useState('');
  const [photo, setPhoto] = useState(null);
  const [sports, setSports] = useState([]);
  const [skill, setSkill] = useState(null);
  const [rating, setRating] = useState('');
  const [modes, setModes] = useState(['date']);
  const [gender, setGender] = useState(null);
  const [seeking, setSeeking] = useState([]);
  const [playGames, setPlayGames] = useState(['singles', 'doubles', 'mixed_doubles']);
  const [playPref, setPlayPref] = useState('everyone');
  const [friendsPref, setFriendsPref] = useState('everyone');
  const [saving, setSaving] = useState(false);
  const [phoneText, setPhoneText] = useState('');
  const [phoneE164, setPhoneE164] = useState(null); // set once a code has been sent
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!res.canceled && res.assets && res.assets[0]) setPhoto(res.assets[0].uri);
  };

  const sendPhoneCode = async () => {
    if (phoneBusy) return;
    setPhoneBusy(true);
    try {
      const e164 = await app.requestPhoneCode(phoneText);
      setPhoneE164(e164);
      setPhoneCode('');
    } catch (e) {
      Alert.alert('Couldn’t send the code', (e && e.message) || 'Check the number and try again.');
    } finally {
      setPhoneBusy(false);
    }
  };

  const confirmPhoneCode = async () => {
    if (phoneBusy) return;
    setPhoneBusy(true);
    try {
      await app.verifyPhoneCode(phoneE164, phoneCode);
      setPhoneVerified(true);
    } catch (e) {
      Alert.alert('Couldn’t verify', (e && e.message) || 'Check the code and try again.');
    } finally {
      setPhoneBusy(false);
    }
  };

  const next = async () => {
    if (step === 0) {
      if (!name.trim()) return Alert.alert('Almost there', 'Add your first name to continue.');
      const iso = parseBirthdate(birthdateText);
      const a = iso ? ageFromBirthdate(iso) : null;
      if (!iso) return Alert.alert('Almost there', 'Enter your birthdate as MM/DD/YYYY.');
      if (a < 18) return Alert.alert('40/Love is 18+', 'You must be 18 or older to join.');
      if (a > 99) return Alert.alert('Almost there', 'Check that birthdate — that can’t be right.');
      if (!gender) return Alert.alert('Almost there', 'Tell us who you are so matching works.');
    }
    if (step === 1 && !phoneVerified) {
      return Alert.alert('Almost there', 'Verify your phone number to continue — it keeps 40/Love real people only.');
    }
    if (step === 2 && !sports.length) return Alert.alert('Almost there', 'Pick at least one sport.');
    if (step === 3 && !skill) return Alert.alert('Almost there', 'Pick your skill level.');
    if (step === 4) {
      if (!modes.length) return Alert.alert('Almost there', 'Pick at least one mode.');
      if (modes.includes('date') && !seeking.length) {
        return Alert.alert('Almost there', 'Tell us who you’d like to date — pick at least one.');
      }
      if (modes.includes('play') && !playGames.length) {
        return Alert.alert('Almost there', 'Pick at least one game type for Play mode.');
      }
      if (saving) return;
      const iso = parseBirthdate(birthdateText);
      const draft = {
        name: name.trim(),
        birthdate: iso,
        age: ageFromBirthdate(iso),
        gender,
        seeking: modes.includes('date') ? seeking : [],
        playGames,
        playPref,
        friendsPref,
        phone: phoneE164,
        phoneVerified,
        photo, sports, skill,
        rating: rating.trim(),
        modes,
        bio: '',
      };
      setSaving(true);
      try {
        await app.finishOnboarding(draft);
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      } catch (e) {
        setSaving(false);
        Alert.alert('Couldn’t save your profile', (e && e.message) || 'Check your connection and try again.');
      }
      return;
    }
    setStep(step + 1);
  };

  const toggle = (list, setList, item) =>
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const titles = ['First things first', 'Prove you’re real', 'What do you play?', "How's your game?", 'What are you here for?'];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }}>
      <View style={styles.head}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.dot, i <= step && { backgroundColor: colors.optic }]} />
          ))}
        </View>
        <Text style={[type.display, { fontSize: 26 }]}>{titles[step]}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {step === 0 && (
          <>
            <Field label="First name">
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Aaron" placeholderTextColor="rgba(244,246,240,0.35)" />
            </Field>
            <Field label="Birthdate">
              <TextInput style={styles.input} value={birthdateText} onChangeText={setBirthdateText} keyboardType="number-pad" placeholder="MM/DD/YYYY" placeholderTextColor="rgba(244,246,240,0.35)" maxLength={10} />
            </Field>
            <Field label="I am">
              <View style={styles.chips}>
                {GENDERS.map((g) => (
                  <Chip key={g.key} label={g.label} active={gender === g.key} onPress={() => setGender(g.key)} />
                ))}
              </View>
            </Field>
            <Field label="Profile photo (optional)">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {photo ? (
                  <Avatar id="me" name={name || 'Me'} photo={photo} size={74} borderColor={colors.optic} />
                ) : (
                  <View style={styles.photoEmpty}>
                    <Ionicons name="camera-outline" size={26} color={colors.dim} />
                  </View>
                )}
                <Pressable onPress={pickPhoto} style={styles.photoBtn}>
                  <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13.5 }}>
                    {photo ? 'Change photo' : 'Add photo'}
                  </Text>
                </Pressable>
              </View>
            </Field>
            <Text style={type.hint}>Your name, age, and photo appear on your player card — your exact birthdate never does. You must be 18 or older.</Text>
          </>
        )}

        {step === 1 && (
          <>
            {!phoneVerified ? (
              <>
                <Field label="Mobile number">
                  <TextInput
                    style={styles.input}
                    value={phoneText}
                    onChangeText={setPhoneText}
                    keyboardType="phone-pad"
                    placeholder="(317) 555-0142"
                    placeholderTextColor="rgba(244,246,240,0.35)"
                    editable={!phoneE164}
                  />
                </Field>
                {!phoneE164 ? (
                  <Btn label={phoneBusy ? 'Sending…' : 'Text me a code'} onPress={sendPhoneCode} />
                ) : (
                  <>
                    <Field label={`Enter the 6-digit code we texted ${phoneE164}`}>
                      <TextInput
                        style={styles.input}
                        value={phoneCode}
                        onChangeText={setPhoneCode}
                        keyboardType="number-pad"
                        placeholder="••••••"
                        placeholderTextColor="rgba(244,246,240,0.35)"
                        maxLength={6}
                      />
                    </Field>
                    <Btn label={phoneBusy ? 'Checking…' : 'Verify'} onPress={confirmPhoneCode} />
                    <View style={{ flexDirection: 'row', gap: 22, justifyContent: 'center' }}>
                      <Pressable onPress={sendPhoneCode} disabled={phoneBusy} accessibilityRole="button">
                        <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13.5 }}>Resend code</Text>
                      </Pressable>
                      <Pressable onPress={() => { setPhoneE164(null); setPhoneCode(''); }} accessibilityRole="button">
                        <Text style={{ color: colors.dim, fontWeight: '800', fontSize: 13.5 }}>Change number</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            ) : (
              <View style={styles.verifiedRow}>
                <Ionicons name="checkmark-circle" size={22} color={colors.ok} />
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>Phone verified — {phoneE164}</Text>
              </View>
            )}
            <Text style={type.hint}>
              A one-time text keeps 40/Love real people only. Your number is never shown to other members and never used for marketing.
            </Text>
            {!app.isBackendConfigured && (
              <Text style={[type.hint, { color: colors.optic }]}>Demo mode: no text is actually sent — enter any 6-digit code.</Text>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <View style={styles.chips}>
              {SPORTS.map((s) => (
                <Chip key={s} label={s} active={sports.includes(s)} onPress={() => toggle(sports, setSports, s)} />
              ))}
            </View>
            <Text style={type.hint}>Pick everything you play — you'll match with people who share at least one sport.</Text>
          </>
        )}

        {step === 3 && (
          <>
            <View style={styles.chips}>
              {SKILLS.map((s) => (
                <Chip key={s} label={s} active={skill === s} onPress={() => setSkill(s)} />
              ))}
            </View>
            <Field label="Official rating (optional)">
              <TextInput style={styles.input} value={rating} onChangeText={setRating} placeholder="e.g. NTRP 3.5 or DUPR 4.0" placeholderTextColor="rgba(244,246,240,0.35)" />
            </Field>
            <Text style={type.hint}>Honest levels make better matches — nobody enjoys a 6–0, 6–0 first date.</Text>
          </>
        )}

        {step === 4 && (
          <>
            {MODES.map((m) => {
              const on = modes.includes(m.key);
              return (
                <View key={m.key}>
                  <Pressable
                    onPress={() => toggle(modes, setModes, m.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.modeRow, on && { borderColor: colors.optic, backgroundColor: colors.opticDim }]}
                  >
                    <Ionicons name={m.icon} size={22} color={colors.text} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{m.name}</Text>
                      <Text style={type.hint}>{m.desc}</Text>
                    </View>
                    {on && <Ionicons name="checkmark" size={20} color={colors.optic} />}
                  </Pressable>
                  {m.key === 'date' && on && (
                    <View style={styles.seekingBox}>
                      <Text style={styles.boxLabel}>Looking to date</Text>
                      <View style={styles.chips}>
                        {SEEKING.map((s) => (
                          <Chip key={s.key} label={s.label} active={seeking.includes(s.key)} onPress={() => toggle(seeking, setSeeking, s.key)} />
                        ))}
                      </View>
                      <Text style={[type.hint, { marginTop: 8 }]}>
                        Pick everyone you're open to — you'll only match with people looking for someone like you, too.
                      </Text>
                    </View>
                  )}
                  {m.key === 'play' && on && (
                    <View style={styles.seekingBox}>
                      <Text style={styles.boxLabel}>Game types</Text>
                      <View style={styles.chips}>
                        {GAMES.map((g) => (
                          <Chip key={g.key} label={g.label} active={playGames.includes(g.key)} onPress={() => toggle(playGames, setPlayGames, g.key)} />
                        ))}
                      </View>
                      <Text style={[styles.boxLabel, { marginTop: 12 }]}>Play singles/doubles with</Text>
                      <View style={styles.chips}>
                        {PARTNER_PREFS.map((p) => (
                          <Chip key={p.key} label={p.label} active={playPref === p.key} onPress={() => setPlayPref(p.key)} />
                        ))}
                      </View>
                      <Text style={[type.hint, { marginTop: 8 }]}>
                        Mixed doubles is open to everyone by nature.
                      </Text>
                    </View>
                  )}
                  {m.key === 'friends' && on && (
                    <View style={styles.seekingBox}>
                      <Text style={styles.boxLabel}>Meet</Text>
                      <View style={styles.chips}>
                        {PARTNER_PREFS.map((p) => (
                          <Chip key={p.key} label={p.label} active={friendsPref === p.key} onPress={() => setFriendsPref(p.key)} />
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
            <Text style={type.hint}>Pick at least one — you can switch modes anytime from Home. Play and Friends are for everyone, whatever your dating preference.</Text>
          </>
        )}
      </ScrollView>

      <View style={styles.foot}>
        {step > 0 && <Btn label="Back" kind="ghost" style={{ flex: 0, paddingHorizontal: 22 }} onPress={() => setStep(step - 1)} />}
        <Btn label={step === 4 ? (saving ? 'Saving…' : 'Step on court') : 'Next'} style={{ flex: 1 }} onPress={next} />
      </View>
    </SafeAreaView>
  );
}

function Field({ label, children }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.dim }}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 18, paddingTop: 20, gap: 14 },
  dot: { width: 26, height: 5, borderRadius: 3, backgroundColor: colors.line },
  body: { padding: 18, gap: 16 },
  input: {
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoEmpty: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: colors.optic,
    borderRadius: 999,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 14,
  },
  seekingBox: {
    marginTop: 8,
    marginLeft: 14,
    padding: 14,
    borderLeftWidth: 2,
    borderLeftColor: colors.optic,
    backgroundColor: colors.card,
    borderRadius: 12,
  },
  boxLabel: { fontSize: 13, fontWeight: '700', color: colors.dim, marginBottom: 8 },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.ok,
    borderRadius: 14,
  },
  foot: { flexDirection: 'row', gap: 10, padding: 18 },
});
