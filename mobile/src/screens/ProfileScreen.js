import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, type } from '../theme';
import { Avatar, Tag } from '../components/ui';
import { useApp } from '../state';

export default function ProfileScreen({ navigation }) {
  const app = useApp();
  const u = app.user;
  const [bio, setBio] = useState(u ? u.bio : '');
  if (!u) return null;

  const joinedCount = app.events.filter((e) => e.going).length;

  const changePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!res.canceled && res.assets && res.assets[0]) {
      app.updatePhoto(res.assets[0].uri);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <View style={styles.bar}>
        <Text style={[type.display, { fontSize: 18 }]}>Profile</Text>
        <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={8} accessibilityLabel="Settings">
          <Ionicons name="settings-outline" size={22} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
        <View style={styles.card}>
          <Avatar id="me" name={u.name} photo={u.photo} size={84} />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={[type.display, { fontSize: 23 }]}>{u.name}</Text>
            <Text style={{ fontSize: 23, fontWeight: '600', color: colors.dim }}>{u.age}</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {u.sports.map((s) => <Tag key={s} label={s} accent />)}
            <Tag label={u.rating ? `${u.skill} · ${u.rating}` : u.skill} />
          </View>
          <Pressable onPress={changePhoto} style={styles.photoBtn}>
            <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13.5 }}>
              {u.photo ? 'Change photo' : 'Add photo'}
            </Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat num={app.matches.length} label="Matches" />
          <Stat num={joinedCount} label="Events" />
          <Stat num={128} label="Rallies" />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.dim }}>Bio</Text>
          <TextInput
            style={styles.bio}
            value={bio}
            onChangeText={setBio}
            onBlur={() => app.updateBio(bio.trim())}
            multiline
            placeholder="Tell players what you're about — favorite Indy courts, playing style, best post-match snack…"
            placeholderTextColor="rgba(244,246,240,0.35)"
          />
          <Text style={type.hint}>Saved automatically when you tap away.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ num, label }) {
  return (
    <View style={styles.stat}>
      <Text style={{ fontSize: 22, fontWeight: '900', color: colors.optic }}>{num}</Text>
      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.dim, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  card: {
    alignItems: 'center', gap: 10, padding: 22,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 18,
  },
  photoBtn: { borderWidth: 2, borderColor: colors.optic, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  stat: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 14,
  },
  bio: {
    minHeight: 84, textAlignVertical: 'top',
    borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card, borderRadius: 12,
    padding: 14, fontSize: 15, color: colors.text,
  },
});
