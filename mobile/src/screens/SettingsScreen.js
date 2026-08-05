import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Pressable, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { useApp } from '../state';

export default function SettingsScreen({ navigation }) {
  const app = useApp();
  const u = app.user;
  const [radiusText, setRadiusText] = useState(String(app.prefs.radius));

  const modeOn = (m) => u && u.modes.includes(m);
  const toggleMode = (m) => {
    if (!u) return;
    if (modeOn(m) && u.modes.length === 1) {
      Alert.alert('Keep at least one mode on');
      return;
    }
    const modes = modeOn(m) ? u.modes.filter((x) => x !== m) : [...u.modes, m];
    app.saveUser({ ...u, modes });
  };

  const setRadius = (t) => {
    setRadiusText(t.replace(/[^0-9]/g, ''));
    const v = parseInt(t, 10);
    if (v >= 1 && v <= 50) app.setPrefs({ ...app.prefs, radius: v });
  };

  const signOut = () => {
    Alert.alert('Sign out?', 'Your local demo profile will be cleared.', [
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

        <Group title="Discovery">
          <Row label="Distance (miles)" sub="How far away players can be">
            <TextInput style={styles.numInput} value={radiusText} onChangeText={setRadius} keyboardType="number-pad" maxLength={2} />
          </Row>
          <Row label="Age range">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                style={styles.numInput}
                defaultValue={String(app.prefs.ageMin)}
                keyboardType="number-pad"
                maxLength={2}
                onEndEditing={(e) => {
                  const v = parseInt(e.nativeEvent.text, 10);
                  if (v >= 18 && v <= 99) app.setPrefs({ ...app.prefs, ageMin: v });
                }}
              />
              <Text style={{ color: colors.dim }}>–</Text>
              <TextInput
                style={styles.numInput}
                defaultValue={String(app.prefs.ageMax)}
                keyboardType="number-pad"
                maxLength={2}
                onEndEditing={(e) => {
                  const v = parseInt(e.nativeEvent.text, 10);
                  if (v >= 18 && v <= 99) app.setPrefs({ ...app.prefs, ageMax: v });
                }}
              />
            </View>
          </Row>
          <Row label="Only my sports" sub="Show only players who share a sport with you">
            <Switch
              value={app.prefs.mySportsOnly}
              onValueChange={(v) => app.setPrefs({ ...app.prefs, mySportsOnly: v })}
              trackColor={{ true: colors.opticDim }}
              thumbColor={app.prefs.mySportsOnly ? colors.optic : colors.dim}
            />
          </Row>
        </Group>

        <Pressable style={styles.danger} onPress={signOut}>
          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 15 }}>Sign out</Text>
        </Pressable>
        <Text style={[type.hint, { textAlign: 'center' }]}>40/Love · Indianapolis · demo build — not a real account</Text>
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
});
