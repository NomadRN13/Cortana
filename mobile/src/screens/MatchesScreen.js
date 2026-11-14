import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, type, gradientFor, initials } from '../theme';
import { Avatar, Tag } from '../components/ui';
import { useApp } from '../state';

export default function MatchesScreen({ navigation }) {
  const app = useApp();
  const savedIds = Object.keys(app.saved).filter((k) => app.saved[k] && !app.blocked[k]);
  // The crew changes when someone else checks in to an event you were at, so
  // ask again each time this tab is opened.
  const reloadRef = useRef(app.reloadCrew);
  reloadRef.current = app.reloadCrew;
  useEffect(() => {
    if (!navigation || !navigation.addListener) return undefined;
    return navigation.addListener('focus', () => reloadRef.current && reloadRef.current());
  }, [navigation]);

  // The same two safety actions as everywhere else a person appears.
  const crewMenu = (c) => {
    Alert.alert(c.name, c.eventTitle ? `You both checked in to ${c.eventTitle}.` : undefined, [
      {
        text: `Report ${c.name}`,
        onPress: () => {
          app.report(c.id, 'event');
          Alert.alert('Thank you', `Our safety team will review ${c.name}'s profile.`);
        },
      },
      { text: `Block ${c.name}`, style: 'destructive', onPress: () => app.block(c.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const likeFromSaved = async (id) => {
    const p = app.profileById(id);
    const matched = await app.likeSaved(id);
    if (matched === 'limited') {
      Alert.alert('That’s today’s likes', `You get ${app.dateLikes.allowance} likes a day in Date mode. ${p ? p.name : 'They'} stays in your saved list for tomorrow.`);
      return;
    }
    if (matched) {
      Alert.alert("It's a Match Point!", `You and ${p.name} matched. The court is the icebreaker.`, [
        { text: 'Send a message', onPress: () => navigation.navigate('Chat', { screen: 'Conversation', params: { id }, initial: false }) },
        { text: 'Keep playing', style: 'cancel' },
      ]);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <Text style={[type.display, { fontSize: 18, paddingHorizontal: 18, paddingVertical: 14 }]}>Crew & matches</Text>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
        {/* Your crew: the people who checked in to the same event as you.
            Events come first in RSVPlay, so this sits above the matches. */}
        <View style={{ gap: 8 }}>
          <Text style={[type.display, { fontSize: 18 }]} accessibilityRole="header">Your crew</Text>
          <Text style={type.hint}>The people you shared a court with.</Text>
          {!app.live && app.crew.length > 0 && (
            <Text style={[type.hint, { fontSize: 11.5 }]}>Demo: these are sample players, not real people you’ve met.</Text>
          )}
          {app.crew.length === 0 && (
            <View style={styles.crewEmpty}>
              <Text style={[type.hint, { textAlign: 'center' }]}>
                Nobody yet. RSVP to an event, check in with the host’s code when you get there, and everyone else who checked in shows up here.
              </Text>
              <Pressable onPress={() => navigation.navigate('Events')} accessibilityRole="button" hitSlop={6}>
                <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 13 }}>See what’s on →</Text>
              </Pressable>
            </View>
          )}
          {app.crew.map((c) => (
            <View key={c.id} style={styles.crewRow}>
              <Avatar id={c.id} name={c.name} size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{c.name}</Text>
                {!!c.eventTitle && (
                  <Text style={[type.hint, { fontSize: 12 }]} numberOfLines={1}>
                    {c.eventTitle}{c.eventWhen ? ` · ${c.eventWhen}` : ''}
                  </Text>
                )}
                {/* Shown only when the server said so. It is mutual by the
                    time it gets here; the app never works it out itself. */}
                {c.alsoOpenToDating === true && (
                  <View style={{ alignSelf: 'flex-start' }}><Tag label="Also open to dating" accent /></View>
                )}
              </View>
              <Pressable
                style={[styles.crewAdd, c.added && styles.crewAdded]}
                onPress={() => (c.added ? app.removeFromCrew(c.id) : app.addToCrew(c.id))}
                accessibilityRole="button"
                accessibilityState={{ selected: !!c.added }}
                accessibilityLabel={c.added ? `${c.name} is in your crew. Tap to remove` : `Add ${c.name} to your crew`}
              >
                <Text style={{ fontWeight: '800', fontSize: 13, color: c.added ? colors.optic : colors.ink }}>
                  {c.added ? 'Added ✓' : 'Add'}
                </Text>
              </Pressable>
              <Pressable onPress={() => crewMenu(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More options for ${c.name}`}>
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.dim} />
              </Pressable>
            </View>
          ))}
        </View>

        <Text style={[type.display, { fontSize: 18 }]} accessibilityRole="header">Matches</Text>
        {savedIds.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={type.eyebrow}>Saved for later</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {savedIds.map((id) => {
                const p = app.profileById(id);
                if (!p) return null;
                return (
                  <View key={id} style={styles.savedCell}>
                    <Avatar id={p.id} name={p.name} photo={p.photo} size={44} />
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Pressable style={styles.savedLike} onPress={() => likeFromSaved(id)} accessibilityLabel={`Like ${p.name}`}>
                      <Ionicons name="heart" size={14} color={colors.ink} />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {app.matches.length ? (
          <View style={styles.grid}>
            {app.matches.map((id) => {
              const p = app.profileById(id);
              if (!p) return null;
              return (
                <Pressable
                  key={id}
                  style={styles.cell}
                  onPress={() => {
                    app.ensureThread(id);
                    navigation.navigate('Chat', { screen: 'Conversation', params: { id }, initial: false });
                  }}
                >
                  <LinearGradient colors={gradientFor(p.id)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cellPhoto}>
                    <Text style={{ fontSize: 38, fontWeight: '900', color: 'rgba(20,22,28,0.55)' }}>{initials(p.name)}</Text>
                  </LinearGradient>
                  <View style={{ padding: 12, gap: 3 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{p.name}, {p.age}</Text>
                    <Text style={[type.hint, { fontSize: 12 }]}>{p.sports.join(' & ')}</Text>
                    <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 12.5, marginTop: 5 }}>Message →</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>🎾</Text>
            <Text style={[type.display, { fontSize: 20 }]}>No matches yet</Text>
            <Text style={type.hint}>Head Home and find a game.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: {
    width: '47%', flexGrow: 1, backgroundColor: colors.card,
    borderWidth: 2, borderColor: colors.line, borderRadius: 16, overflow: 'hidden',
  },
  cellPhoto: { height: 120, alignItems: 'center', justifyContent: 'center' },
  savedCell: {
    width: 86, alignItems: 'center', gap: 6, padding: 10,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 14,
  },
  savedLike: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.optic, alignItems: 'center', justifyContent: 'center' },
  crewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 16,
  },
  crewAdd: { backgroundColor: colors.optic, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.optic },
  crewAdded: { backgroundColor: 'transparent' },
  crewEmpty: {
    alignItems: 'center', gap: 10, padding: 18,
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 16,
  },
  empty: {
    alignItems: 'center', gap: 12, padding: 44,
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 20,
  },
});
