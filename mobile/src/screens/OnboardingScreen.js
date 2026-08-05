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

export default function OnboardingScreen({ navigation }) {
  const app = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [birthdateText, setBirthdateText] = useState('');
  const [photo, setPhoto] = useState(null);
  const [sports, setSports] = useState([]);
  const [skill, setSkill] = useState(null);
  const [rating, setRating] = useState('');
  const [modes, setModes] = useState(['date']);
  const [saving, setSaving] = useState(false);

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

  const next = async () => {
    if (step === 0) {
      if (!name.trim()) return Alert.alert('Almost there', 'Add your first name to continue.');
      const iso = parseBirthdate(birthdateText);
      const a = iso ? ageFromBirthdate(iso) : null;
      if (!iso) return Alert.alert('Almost there', 'Enter your birthdate as MM/DD/YYYY.');
      if (a < 18) return Alert.alert('40/Love is 18+', 'You must be 18 or older to join.');
      if (a > 99) return Alert.alert('Almost there', 'Check that birthdate — that can’t be right.');
    }
    if (step === 1 && !sports.length) return Alert.alert('Almost there', 'Pick at least one sport.');
    if (step === 2 && !skill) return Alert.alert('Almost there', 'Pick your skill level.');
    if (step === 3) {
      if (!modes.length) return Alert.alert('Almost there', 'Pick at least one mode.');
      if (saving) return;
      const iso = parseBirthdate(birthdateText);
      const draft = {
        name: name.trim(),
        birthdate: iso,
        age: ageFromBirthdate(iso),
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

  const titles = ['First things first', 'What do you play?', "How's your game?", 'What are you here for?'];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }}>
      <View style={styles.head}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[0, 1, 2, 3].map((i) => (
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
            <View style={styles.chips}>
              {SPORTS.map((s) => (
                <Chip key={s} label={s} active={sports.includes(s)} onPress={() => toggle(sports, setSports, s)} />
              ))}
            </View>
            <Text style={type.hint}>Pick everything you play — you'll match with people who share at least one sport.</Text>
          </>
        )}

        {step === 2 && (
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

        {step === 3 && (
          <>
            {MODES.map((m) => {
              const on = modes.includes(m.key);
              return (
                <Pressable
                  key={m.key}
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
              );
            })}
            <Text style={type.hint}>Pick at least one — you can switch modes anytime from Home.</Text>
          </>
        )}
      </ScrollView>

      <View style={styles.foot}>
        {step > 0 && <Btn label="Back" kind="ghost" style={{ flex: 0, paddingHorizontal: 22 }} onPress={() => setStep(step - 1)} />}
        <Btn label={step === 3 ? (saving ? 'Saving…' : 'Step on court') : 'Next'} style={{ flex: 1 }} onPress={next} />
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
  foot: { flexDirection: 'row', gap: 10, padding: 18 },
});
