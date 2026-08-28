import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert, FlatList, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, type, gradientFor, initials } from '../theme';
import { Wordmark, Avatar, Btn, Tag } from '../components/ui';
import { SwipeableCard, Confetti, useReduceMotion } from '../components/motion';
import { useApp } from '../state';

const GAME_LABELS = { singles: 'Singles', doubles: 'Doubles', mixed_doubles: 'Mixed doubles' };

const MODE_META = {
  date: { label: 'Date Mode', icon: 'heart-outline', likeVerb: 'Like' },
  play: { label: 'Play Mode', icon: 'tennisball-outline', likeVerb: 'Request to hit' },
  friends: { label: 'Friends Mode', icon: 'people-outline', likeVerb: 'Wave' },
};

export default function HomeScreen({ navigation }) {
  const app = useApp();
  const [matchWith, setMatchWith] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [sheetP, setSheetP] = useState(null);
  const reducedMotion = useReduceMotion();
  const p = app.currentProfile();
  const nextP = app.peekNext();

  // B-21: someone you liked earlier just liked you back — celebrate live.
  useEffect(() => {
    if (app.pendingMatch) {
      setMatchWith(app.pendingMatch);
      app.clearPendingMatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.pendingMatch]);

  const greeting = () => {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    return `Good ${part}${app.user ? `, ${app.user.name}` : ''} 👋`;
  };

  const likeProfile = async (prof, ace) => {
    const matched = await app.swipeLike(prof, ace);
    if (matched) setMatchWith(prof);
  };
  const onLike = (ace) => { if (p) likeProfile(p, ace); };
  const sheetAction = (fn) => {
    const prof = sheetP;
    setSheetP(null);
    if (prof) fn(prof);
  };

  const onRewind = async () => {
    const ok = await app.rewind();
    if (!ok) {
      Alert.alert('Rewind', app.live
        ? 'Nothing to rewind — and a match with a conversation can’t be taken back.'
        : 'Nothing to rewind yet.');
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
        {Object.keys(MODE_META).filter((m) => !app.user || !app.user.modes || app.user.modes.includes(m)).map((m) => {
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
        {app.topPicks.length > 0 ? (
          <View style={styles.picks}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={[type.display, { fontSize: 19 }]}>Your top {app.topPicks.length}</Text>
              <Text style={[type.hint, { fontSize: 12 }]}>Best fits right now</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {app.topPicks.map((pick, i) => (
                  <Pressable key={pick.id} style={styles.pick} onPress={() => setSheetP(pick)} accessibilityLabel={`Top pick ${i + 1}: ${pick.name}`}>
                    <View style={styles.pickRank}>
                      <Text style={{ color: colors.ink, fontWeight: '900', fontSize: 11 }}>{i + 1}</Text>
                    </View>
                    <Avatar id={pick.id} name={pick.name} photo={pick.photo} size={54} />
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13.5 }} numberOfLines={1}>
                      {pick.isTeam && pick.partnerName ? `${pick.name} & ${pick.partnerName}` : pick.name}
                    </Text>
                    <Text style={[type.hint, { fontSize: 11, textAlign: 'center' }]} numberOfLines={2}>{pick.reason}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : (
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
        )}

        {p ? (
          <View>
            {nextP && (
              <View style={styles.cardBehind} pointerEvents="none">
                {nextP.photo ? (
                  <Image source={{ uri: nextP.photo }} style={styles.cardPhoto} resizeMode="cover" />
                ) : (
                  <LinearGradient colors={gradientFor(nextP.id)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardPhoto}>
                    <Text style={styles.cardInitials}>{initials(nextP.name)}</Text>
                  </LinearGradient>
                )}
                <View style={{ padding: 16 }}>
                  <Text style={[type.display, { fontSize: 23 }]}>{nextP.name} <Text style={{ color: colors.dim, fontWeight: '600' }}>{nextP.age}</Text></Text>
                </View>
              </View>
            )}
            <SwipeableCard
              key={p.id}
              onSwipeRight={() => onLike(false)}
              onSwipeLeft={() => app.swipePass(p)}
              onTap={() => setSheetP(p)}
            >
              <DeckCard p={p} app={app} onLike={() => onLike(false)} onMore={onMore} />
            </SwipeableCard>
          </View>
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
            <Pressable style={styles.retryBtn} onPress={() => app.resetDeck()}>
              <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 13.5 }}>
                {app.live ? 'Check again' : 'New balls — reset the deck'}
              </Text>
            </Pressable>
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
          {!reducedMotion && <Confetti />}
          <View style={styles.matchModal}>
            <Text style={{ color: colors.optic, fontWeight: '800', letterSpacing: 2, fontSize: 13 }}>40 – LOVE</Text>
            <Text style={[type.display, { fontSize: 27 }]}>
              It's a <Text style={{ color: colors.optic }}>Match Point!</Text>
            </Text>
            <View style={{ flexDirection: 'row' }}>
              <Avatar id="me" name={app.user ? app.user.name : 'You'} photo={app.user && app.user.photo} size={68} borderColor={colors.optic} />
              <View style={{ marginLeft: -14 }}>
                {matchWith && <Avatar id={matchWith.id} name={matchWith.name} photo={matchWith.photo} size={68} borderColor={colors.optic} />}
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

      {/* Profile detail sheet */}
      <Modal visible={!!sheetP} transparent animationType="slide" onRequestClose={() => setSheetP(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetP(null)}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            {sheetP && (
              <ScrollView>
                {sheetP.photo ? (
                  <Image source={{ uri: sheetP.photo }} style={styles.sheetPhoto} resizeMode="cover" />
                ) : (
                  <LinearGradient colors={gradientFor(sheetP.id)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sheetPhoto}>
                    <Text style={[styles.cardInitials, { fontSize: 64 }]}>{initials(sheetP.name)}</Text>
                  </LinearGradient>
                )}
                <View style={{ padding: 16, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={[type.display, { fontSize: 23 }]}>
                      {sheetP.isTeam && sheetP.partnerName ? `${sheetP.name} & ${sheetP.partnerName}` : sheetP.name}
                    </Text>
                    <Text style={{ fontSize: 23, fontWeight: '600', color: colors.dim }}>
                      {sheetP.isTeam && sheetP.partnerAge != null ? `${sheetP.age} & ${sheetP.partnerAge}` : sheetP.age}
                    </Text>
                    {sheetP.isTeam && <Tag label="Doubles team" accent />}
                    {sheetP.verified && (
                      <View style={styles.verified}>
                        <Ionicons name="checkmark" size={11} color={colors.ink} />
                      </View>
                    )}
                  </View>
                  <InfoRow icon="tennisball-outline" text={`${sheetP.sports.join(' & ')} · ${sheetP.rating ? `${sheetP.rating} Skill Level` : sheetP.skill}`} />
                  {sheetP.dist != null && <InfoRow icon="location-outline" text={`${sheetP.dist.toFixed(1)} miles away`} />}
                  {!!sheetP.avail && <InfoRow icon="time-outline" text={sheetP.avail} />}
                  <InfoRow
                    icon="stats-chart"
                    text={((sheetP.playGames && sheetP.playGames.length ? sheetP.playGames : ['singles', 'doubles', 'mixed_doubles']).map((g) => GAME_LABELS[g]).join(' · '))}
                  />
                  <Text style={[type.hint, { marginTop: 4 }]}>{sheetP.bio}</Text>
                  {sheetP.photos && sheetP.photos.length > 1 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {sheetP.photos.slice(1).map((u) => (
                          <Image key={u} source={{ uri: u }} style={styles.sheetThumb} resizeMode="cover" />
                        ))}
                      </View>
                    </ScrollView>
                  )}
                  <View style={styles.sheetActions}>
                    <ActionBtn icon="close" label={`Pass on ${sheetP.name}`} onPress={() => sheetAction((prof) => app.swipePass(prof))} />
                    <ActionBtn icon="heart" label={`Like ${sheetP.name}`} big onPress={() => sheetAction((prof) => likeProfile(prof, false))} />
                    <ActionBtn icon="star-outline" label={`Ace ${sheetP.name}`} onPress={() => sheetAction((prof) => likeProfile(prof, true))} />
                  </View>
                  <Pressable onPress={() => setSheetP(null)} style={{ alignSelf: 'center', padding: 10 }}>
                    <Text style={{ color: colors.dim, fontWeight: '700', fontSize: 13 }}>Close</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
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
  // Tap the right/left half of the photo to page through their photos —
  // the standard gesture, and it keeps the swipe handler free.
  const gallery = (p.photos && p.photos.length ? p.photos : (p.photo ? [p.photo] : []));
  const [shot, setShot] = useState(0);
  useEffect(() => { setShot(0); }, [p.id]);
  const idx = Math.min(shot, Math.max(0, gallery.length - 1));
  return (
    <View style={styles.card}>
      {gallery.length ? (
        <View>
          <Image source={{ uri: gallery[idx] }} style={styles.cardPhoto} resizeMode="cover" />
          {gallery.length > 1 && (
            <>
              <View style={styles.shotDots} pointerEvents="none">
                {gallery.map((u, i) => (
                  <View key={u} style={[styles.shotDot, i === idx && styles.shotDotOn]} />
                ))}
              </View>
              <Pressable
                style={[styles.shotTap, { left: 0 }]}
                onPress={() => setShot(Math.max(0, idx - 1))}
                accessibilityLabel={`Previous photo of ${p.name}`}
              />
              <Pressable
                style={[styles.shotTap, { right: 0 }]}
                onPress={() => setShot(Math.min(gallery.length - 1, idx + 1))}
                accessibilityLabel={`Next photo of ${p.name}`}
              />
            </>
          )}
        </View>
      ) : (
        <LinearGradient colors={tints} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardPhoto}>
          <Text style={styles.cardInitials}>{initials(p.name)}</Text>
        </LinearGradient>
      )}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={[type.display, { fontSize: 23 }]}>
            {p.isTeam && p.partnerName ? `${p.name} & ${p.partnerName}` : p.name}
          </Text>
          <Text style={{ fontSize: 23, fontWeight: '600', color: colors.dim }}>
            {p.isTeam && p.partnerAge != null ? `${p.age} & ${p.partnerAge}` : p.age}
          </Text>
          {p.verified && (
            <View style={styles.verified}>
              <Ionicons name="checkmark" size={11} color={colors.ink} />
            </View>
          )}
          {p.isTeam && <Tag label="Doubles team" accent />}
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
  cardBehind: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card,
    opacity: 0.55, transform: [{ scale: 0.94 }, { translateY: 16 }],
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(4,5,6,0.7)', justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: colors.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 2, borderColor: colors.line, maxHeight: '86%', overflow: 'hidden',
  },
  sheetPhoto: { height: 190, alignItems: 'center', justifyContent: 'center', width: '100%' },
  sheetThumb: { width: 108, height: 108, borderRadius: 12, backgroundColor: colors.card },
  shotDots: {
    position: 'absolute', top: 10, left: 12, right: 12,
    flexDirection: 'row', gap: 4,
  },
  shotDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(244,246,240,0.35)' },
  shotDotOn: { backgroundColor: colors.optic },
  shotTap: { position: 'absolute', top: 0, bottom: 0, width: '32%' },
  picks: {
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line,
    borderRadius: 18, padding: 16,
  },
  pick: {
    width: 108, alignItems: 'center', gap: 6, padding: 10,
    backgroundColor: colors.card2, borderRadius: 14,
  },
  pickRank: {
    position: 'absolute', top: 6, left: 6, zIndex: 2,
    width: 18, height: 18, borderRadius: 9, backgroundColor: colors.optic,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 8 },
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
