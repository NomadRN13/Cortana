import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, type, gradientFor, initials } from '../theme';
import { Wordmark, Avatar, Btn } from '../components/ui';
import { useApp } from '../state';

const MODE_META = {
  date: { label: 'Date Mode', icon: 'heart-outline', likeVerb: 'Like' },
  play: { label: 'Play Mode', icon: 'tennisball-outline', likeVerb: 'Request to hit' },
  friends: { label: 'Friends Mode', icon: 'people-outline', likeVerb: 'Wave' },
};

export default function HomeScreen({ navigation }) {
  const app = useApp();
  const [matchWith, setMatchWith] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const p = app.currentProfile();

  const greeting = () => {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    return `Good ${part}${app.user ? `, ${app.user.name}` : ''} 👋`;
  };

  const onLike = async (ace) => {
    if (!p) return;
    const matched = await app.swipeLike(p, ace);
    if (matched) setMatchWith(p);
  };

  const onRewind = () => {
    if (!app.rewind()) {
      Alert.alert('Rewind', app.live ? 'Live swipes can’t be taken back — rewind is coming with premium.' : 'Nothing to rewind yet.');
    }
  };

  const onMore = () => {
    if (!p) return;
    Alert.alert(p.name, `${p.sports.join(' & ')}${p.dist != null ? ` · ${p.dist.toFixed(1)} mi` : ''}`, [
      {
        text: `Report ${p.name}`,
        onPress: () => {
          app.report(p.id, true);
          Alert.alert('Thank you', `Our safety team will review ${p.name}'s profile.`);
        },
      },
      {
        text: `Block ${p.name}`,
        style: 'destructive',
        onPress: () => app.block(p.id),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => navigation.navigate('Settings')} accessibilityLabel="Menu and settings" hitSlop={8}>
          <Ionicons name="menu" size={24} color={colors.text} />
        </Pressable>
        <Wordmark size={24} />
        <Pressable onPress={() => setNotifOpen(true)} accessibilityLabel="Notifications" hitSlop={8}>
          <Ionicons name="notifications-outline" size={23} color={colors.text} />
          {app.notifs.length > 0 && <View style={styles.bellDot} />}
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 18 }}>
        <Text style={[type.display, { fontSize: 24 }]}>{greeting()}</Text>
        <Text style={[type.hint, { marginTop: 3 }]}>Ready to rally?</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.pills}>
        {Object.keys(MODE_META).map((m) => {
          const on = app.mode === m;
          return (
            <Pressable key={m} onPress={() => app.setMode(m)} style={[styles.pill, on && styles.pillOn]}>
              <Ionicons name={MODE_META[m].icon} size={16} color={on ? colors.ink : colors.text} />
              <Text style={[styles.pillLabel, on && { color: colors.ink }]}>{MODE_META[m].label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, gap: 14 }}>
        <View style={styles.topmatch}>
          <View style={{ flex: 1 }}>
            <Text style={[type.display, { fontSize: 19 }]}>Top Match</Text>
            <Text style={[type.hint, { marginVertical: 8, maxWidth: 170 }]}>A great match is just a game away.</Text>
            <Pressable style={styles.topmatchBtn} onPress={() => navigation.navigate('Matches')}>
              <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 13.5 }}>View Matches</Text>
            </Pressable>
          </View>
          <Ionicons name="tennisball" size={64} color={colors.optic} />
        </View>

        {p ? (
          <DeckCard p={p} app={app} onLike={() => onLike(false)} onMore={onMore} />
        ) : app.live && app.deckError ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>📡</Text>
            <Text style={[type.display, { fontSize: 20 }]}>Can't reach the court</Text>
            <Text style={[type.hint, { textAlign: 'center' }]}>
              We couldn't load players — check your connection and try again.
            </Text>
            <Pressable style={styles.retryBtn} onPress={() => app.retryDeck()}>
              <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 13.5 }}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>🎾</Text>
            <Text style={[type.display, { fontSize: 20 }]}>That's everyone nearby</Text>
            <Text style={[type.hint, { textAlign: 'center' }]}>
              You've seen all the players in range. Check back soon, or widen your radius in Settings.
            </Text>
          </View>
        )}

        {p && (
          <View style={styles.actions}>
            <ActionBtn icon="refresh" label="Rewind last card" onPress={onRewind} />
            <ActionBtn icon="close" label={`Pass on ${p.name}`} onPress={() => app.swipePass(p)} />
            <ActionBtn
              icon="heart"
              label={`${MODE_META[app.mode].likeVerb} ${p.name}`}
              big
              onPress={() => onLike(false)}
            />
            <ActionBtn icon="star-outline" label={`Ace — super like ${p.name}`} onPress={() => onLike(true)} />
          </View>
        )}
      </ScrollView>

      {/* Match Point modal */}
      <Modal visible={!!matchWith} transparent animationType="fade" onRequestClose={() => setMatchWith(null)}>
        <View style={styles.overlay}>
          <View style={styles.matchModal}>
            <Text style={{ color: colors.optic, fontWeight: '800', letterSpacing: 2, fontSize: 13 }}>40 – LOVE</Text>
            <Text style={[type.display, { fontSize: 27 }]}>
              It's a <Text style={{ color: colors.optic }}>Match Point!</Text>
            </Text>
            <View style={{ flexDirection: 'row' }}>
              <Avatar id="me" name={app.user ? app.user.name : 'You'} photo={app.user && app.user.photo} size={68} borderColor={colors.optic} />
              <View style={{ marginLeft: -14 }}>
                {matchWith && <Avatar id={matchWith.id} name={matchWith.name} size={68} borderColor={colors.optic} />}
              </View>
            </View>
            <Text style={[type.hint, { textAlign: 'center' }]}>
              You and {matchWith ? matchWith.name : ''} matched. Skip the small talk — the court is the icebreaker.
            </Text>
            <Btn
              label="Send a message"
              style={{ alignSelf: 'stretch' }}
              onPress={() => {
                const id = matchWith.id;
                setMatchWith(null);
                navigation.navigate('Chat', { screen: 'Conversation', params: { id }, initial: false });
              }}
            />
            <Btn label="Keep playing" kind="ghost" style={{ alignSelf: 'stretch' }} onPress={() => setMatchWith(null)} />
          </View>
        </View>
      </Modal>

      {/* Notifications */}
      <Modal visible={notifOpen} transparent animationType="fade" onRequestClose={() => setNotifOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setNotifOpen(false)}>
          <Pressable style={styles.notifPanel} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[type.display, { fontSize: 18 }]}>Notifications</Text>
              <Pressable onPress={() => app.clearNotifs()} hitSlop={8}>
                <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 12.5 }}>Clear all</Text>
              </Pressable>
            </View>
            {app.notifs.length ? (
              <FlatList
                data={app.notifs}
                keyExtractor={(_, i) => String(i)}
                renderItem={({ item }) => (
                  <View style={styles.notifItem}>
                    <View style={styles.notifIco}>
                      <Ionicons name={item.ico} size={16} color={colors.optic} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={type.body}>{item.txt}</Text>
                      <Text style={[type.hint, { fontSize: 11.5, marginTop: 2 }]}>{item.sub}</Text>
                    </View>
                  </View>
                )}
              />
            ) : (
              <Text style={[type.hint, { textAlign: 'center', paddingVertical: 18 }]}>You're all caught up 🎾</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function DeckCard({ p, app, onLike, onMore }) {
  const tints = gradientFor(p.id);
  const isSaved = !!app.saved[p.id];
  return (
    <View style={styles.card}>
      <LinearGradient colors={tints} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardPhoto}>
        <Text style={styles.cardInitials}>{initials(p.name)}</Text>
      </LinearGradient>
      {p.isNew && (
        <View style={styles.badgeNew}>
          <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 11, letterSpacing: 1 }}>NEW</Text>
        </View>
      )}
      <Pressable
        style={[styles.roundBtn, { right: 58 }]}
        onPress={onMore}
        accessibilityLabel={`More options for ${p.name}`}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
      </Pressable>
      <Pressable
        style={[styles.roundBtn, { right: 10 }]}
        onPress={() => app.setSaved({ ...app.saved, [p.id]: !isSaved })}
        accessibilityLabel={`Save ${p.name}`}
      >
        <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={18} color={isSaved ? colors.optic : colors.text} />
      </Pressable>
      <Pressable style={styles.cardLike} onPress={onLike} accessibilityLabel={`Like ${p.name}`}>
        <Ionicons name="heart" size={26} color={colors.ink} />
      </Pressable>
      <View style={{ padding: 16, gap: 7 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[type.display, { fontSize: 23 }]}>{p.name}</Text>
          <Text style={{ fontSize: 23, fontWeight: '600', color: colors.dim }}>{p.age}</Text>
          {p.verified && (
            <View style={styles.verified}>
              <Ionicons name="checkmark" size={11} color={colors.ink} />
            </View>
          )}
        </View>
        <InfoRow icon="tennisball-outline" text={p.sports.join(' & ')} />
        {p.dist != null && <InfoRow icon="location-outline" text={`${p.dist.toFixed(1)} miles away`} />}
        <InfoRow icon="stats-chart" text={p.rating ? `${p.rating} Skill Level` : p.skill} />
        <Text style={[type.hint, { marginTop: 3 }]}>{p.bio}</Text>
      </View>
    </View>
  );
}

function InfoRow({ icon, text }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name={icon} size={15} color={colors.optic} />
      <Text style={[type.hint, { fontSize: 14 }]}>{text}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, big }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={[styles.act, big && styles.actBig]}
    >
      <Ionicons name={icon} size={big ? 30 : 22} color={big ? colors.ink : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  bellDot: { position: 'absolute', top: -1, right: -1, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.optic },
  pills: { gap: 8, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card,
  },
  pillOn: { backgroundColor: colors.optic, borderColor: colors.optic },
  pillLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  topmatch: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line,
    borderRadius: 18, padding: 18,
  },
  topmatchBtn: { alignSelf: 'flex-start', backgroundColor: colors.optic, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  card: { borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card },
  cardPhoto: { height: 330, alignItems: 'center', justifyContent: 'center' },
  cardInitials: { fontSize: 84, fontWeight: '900', color: 'rgba(10,11,13,0.55)' },
  badgeNew: { position: 'absolute', top: 14, left: 14, backgroundColor: colors.optic, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999 },
  roundBtn: {
    position: 'absolute', top: 10, width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(10,11,13,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  cardLike: {
    position: 'absolute', right: 14, top: 296, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.optic, alignItems: 'center', justifyContent: 'center', elevation: 6,
  },
  verified: { width: 19, height: 19, borderRadius: 10, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 4 },
  act: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: colors.card2, borderWidth: 2, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  actBig: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.optic, borderColor: colors.optic },
  empty: {
    alignItems: 'center', gap: 12, padding: 44,
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 20,
  },
  retryBtn: { backgroundColor: colors.optic, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18, marginTop: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(4,5,6,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  matchModal: {
    backgroundColor: colors.panel, borderWidth: 3, borderColor: colors.optic, borderRadius: 22,
    padding: 26, alignItems: 'center', gap: 14, width: '100%', maxWidth: 320,
  },
  notifPanel: {
    backgroundColor: colors.panel, borderWidth: 2, borderColor: colors.line, borderRadius: 20,
    padding: 16, width: '100%', maxWidth: 340, maxHeight: '70%', gap: 10,
  },
  notifItem: { flexDirection: 'row', gap: 11, paddingVertical: 11, borderTopWidth: 2, borderTopColor: colors.line },
  notifIco: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.opticDim, alignItems: 'center', justifyContent: 'center' },
});
