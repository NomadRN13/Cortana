import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Pressable, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, type } from '../theme';
import { Avatar, Tag } from '../components/ui';
import { CountUpText } from '../components/motion';
import { useApp } from '../state';

// One main photo plus five more. Matches profile_photos.position 0..5.
const PHOTO_SLOTS = 6;

export default function ProfileScreen({ navigation }) {
  const app = useApp();
  const u = app.user;
  const [bio, setBio] = useState(u ? u.bio : '');
  if (!u) return null;

  const joinedCount = app.events.filter((e) => e.going).length;

  const addPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (app.photos.length >= PHOTO_SLOTS) {
      return Alert.alert('All slots full', `You can have up to ${PHOTO_SLOTS} photos — remove one to add another.`);
    }
    if (res.canceled || !res.assets || !res.assets[0]) return;
    try {
      await app.addPhoto(res.assets[0].uri);
    } catch (e) {
      Alert.alert('Couldn’t add photo', (e && e.message) || 'Check your connection and try again.');
    }
  };

  const photoMenu = (ph) => {
    const fail = (e) => Alert.alert('Couldn’t update photo', (e && e.message) || 'Try again.');
    const buttons = [];
    if (ph.position > 0) {
      buttons.push({ text: 'Make main photo', onPress: () => { app.makePrimary(ph.position).catch(fail); } });
    }
    buttons.push({ text: 'Remove', style: 'destructive', onPress: () => { app.removePhoto(ph.position).catch(fail); } });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(
      ph.position === 0 ? 'Main photo' : 'Photo',
      ph.status === 'pending' ? 'Waiting for review — only you can see it right now.' : undefined,
      buttons
    );
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
          {u.phoneVerified && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Ionicons name="checkmark-circle" size={15} color={colors.ok} />
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.ok }}>Phone verified</Text>
            </View>
          )}
        </View>

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.dim }}>Photos</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.dim }}>{app.photos.length} of {PHOTO_SLOTS}</Text>
          </View>
          {/* Every slot is drawn, filled or not, so the room to add more is
              visible rather than something you have to discover. */}
          <View style={styles.photoGrid}>
            {Array.from({ length: PHOTO_SLOTS }, (_, i) => {
              const ph = app.photos.find((x) => x.position === i);
              if (!ph) {
                const isNext = i === app.photos.length;
                return (
                  <Pressable
                    key={`empty-${i}`}
                    style={[styles.photoCell, styles.photoCellEmpty]}
                    onPress={addPhoto}
                    accessibilityLabel={`Add photo ${i + 1} of ${PHOTO_SLOTS}`}
                  >
                    <Ionicons name="add" size={26} color={isNext ? colors.optic : colors.dim} />
                  </Pressable>
                );
              }
              return (
                <Pressable
                  key={`${ph.position}-${ph.url}`}
                  style={styles.photoCell}
                  onPress={() => photoMenu(ph)}
                  accessibilityLabel={ph.position === 0 ? 'Main photo — tap for options' : `Photo ${ph.position + 1} — tap for options`}
                >
                  <Image source={{ uri: ph.url }} style={{ width: '100%', height: '100%' }} />
                  {ph.position === 0 && <Text style={[styles.photoTag, styles.photoTagMain]}>Main</Text>}
                  {ph.status === 'pending' && <Text style={[styles.photoTag, styles.photoTagPending]}>In review</Text>}
                </Pressable>
              );
            })}
          </View>
          <Text style={type.hint}>
            Your main photo is your card — add up to {PHOTO_SLOTS - 1} more and players can swipe through them. Profiles with several photos get noticeably more matches. New photos are reviewed before anyone else sees them.
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat num={app.matches.length} label="Matches" />
          <Stat num={joinedCount} label="Events" />
          <Stat num={Object.values(app.saved).filter(Boolean).length} label="Saved" />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.dim }}>Bio</Text>
          <TextInput
            style={styles.bio}
            value={bio}
            onChangeText={setBio}
            onBlur={() => app.updateBio(bio.trim())}
            multiline
            placeholder="Tell players what you're about — favorite courts, playing style, best post-match snack…"
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
      <CountUpText value={num} style={{ fontSize: 22, fontWeight: '900', color: colors.optic }} />
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
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoCell: {
    width: '31%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden',
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line,
  },
  photoCellEmpty: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  photoTag: {
    position: 'absolute', left: 5, fontSize: 10, fontWeight: '800',
    paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, overflow: 'hidden',
  },
  photoTagMain: { bottom: 5, backgroundColor: colors.optic, color: colors.ink },
  photoTagPending: { top: 5, backgroundColor: 'rgba(10,11,13,0.75)', color: colors.text },
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
