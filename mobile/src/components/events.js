// One event card, used by Home ("This week on the courts") and by the Events
// tab — the same card and the same RSVP in both, so the two can't drift apart.
// Under the card sits whichever step comes next:
//   RSVP        → the waiver line, which has to be ticked before it counts
//   Going       → Check in, with the code the host reads out at the event
//   Checked in  → a way through to the crew
// Everything it does goes through the state layer (rsvpWithWaiver,
// acceptWaiver, checkIn), which is where the server's answers are handled.
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, type, radii } from '../theme';
import { Tag, Avatar, Btn } from './ui';
import { cityLabel } from '../data/cities';
import { WAIVER_INTRO, WAIVER_POINTS, WAIVER_VERSION } from '../data/waiver';

// "$12", "$12.50", "Free" — and nothing at all when no price was given.
export function priceLabel(cents) {
  if (typeof cents !== 'number' || cents < 0) return '';
  if (cents === 0) return 'Free';
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

// "Club members save 15%", only when there is a saving to speak of.
export function clubSavingLabel(pct) {
  return pct > 0 ? `Club members save ${pct}%` : '';
}

// When an event opens to everyone, if it hasn't yet: before general_opens_at
// only Club members can RSVP. Worked out at draw time rather than when the
// list loaded, so a card left on screen unlocks when the moment passes.
// Null once it is open to all (or always was).
export function earlyAccessUntil(e) {
  if (!e || !e.generalOpensAt) return null;
  const d = new Date(e.generalOpensAt);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return null;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

// The waiver itself, to read before ticking the box.
export function WaiverSheet({ visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <Text style={[type.display, { fontSize: 18 }]}>Event waiver and code of conduct</Text>
          <ScrollView style={{ marginTop: 10 }} contentContainerStyle={{ gap: 10, paddingBottom: 6 }}>
            <Text style={type.body}>{WAIVER_INTRO}</Text>
            {WAIVER_POINTS.map((pt, i) => (
              <View key={pt.head} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={[type.body, { color: colors.optic, fontWeight: '800' }]}>{i + 1}.</Text>
                <Text style={[type.body, { flex: 1 }]}>
                  <Text style={{ fontWeight: '800' }}>{pt.head}</Text> {pt.body}
                </Text>
              </View>
            ))}
            <Text style={[type.hint, { fontSize: 11.5 }]}>Version {WAIVER_VERSION}.</Text>
          </ScrollView>
          <Btn label="Close" kind="ghost" onPress={onClose} style={{ marginTop: 10 }} />
        </View>
      </View>
    </Modal>
  );
}

// The tick box and its line. Ticking is what lets an RSVP (or a check-in on an
// RSVP that has no waiver on record yet) through.
function WaiverLine({ ticked, onToggle, onRead }) {
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={onToggle}
        style={styles.waiverRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked }}
        accessibilityLabel="I’ve read the event waiver and code of conduct"
      >
        <Ionicons name={ticked ? 'checkbox' : 'square-outline'} size={22} color={ticked ? colors.optic : colors.dim} />
        <Text style={[type.body, { flex: 1, fontWeight: '600' }]}>I’ve read the event waiver and code of conduct</Text>
      </Pressable>
      <Pressable onPress={onRead} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
        <Text style={styles.link}>Read the waiver</Text>
      </Pressable>
    </View>
  );
}

export function EventCard({ app, e, expanded, onToggle, showCity, onSeeCrew }) {
  // Which step is open under the card: 'rsvp' (waiver line, not going yet) or
  // 'checkin' (waiver line if there's none on record, then the code).
  const [step, setStep] = useState(null);
  const [ticked, setTicked] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);

  const attendees = expanded ? app.eventAttendees(e.id) : [];
  const price = priceLabel(e.priceCents);
  const saving = clubSavingLabel(e.clubDiscountPct);
  const opensToAll = earlyAccessUntil(e);
  // Club members can RSVP during early access; everyone else waits. The
  // server enforces it — this only saves a tap that would be refused.
  const locked = !!opensToAll && app.tier !== 'club' && !e.going;
  const needsTick = () => Alert.alert('Tick the box first', 'Every RSVP comes with the event waiver and code of conduct.');

  const close = () => { setStep(null); setTicked(false); setCode(''); };

  const confirmRsvp = async () => {
    if (busy) return;
    if (!ticked) { needsTick(); return; }
    setBusy(true);
    await app.rsvpWithWaiver(e.id);
    setBusy(false);
    close();
  };

  const acceptForCheckIn = async () => {
    if (busy) return;
    if (!ticked) { needsTick(); return; }
    setBusy(true);
    await app.acceptWaiver(e.id);
    setBusy(false);
    setTicked(false);
  };

  const confirmCheckIn = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await app.checkIn(e.id, code);
    setBusy(false);
    if (ok) close();
  };

  let side;
  if (e.checkedIn) {
    side = <Tag label="Checked in ✓" accent />;
  } else if (locked) {
    side = <Text style={[type.hint, { fontSize: 11.5, textAlign: 'right' }]}>Club only{'\n'}for now</Text>;
  } else if (e.going) {
    side = (
      <Pressable
        style={[styles.join, styles.joinGoing]}
        onPress={() => { close(); app.toggleJoin(e.id); }}
        accessibilityRole="button"
        accessibilityLabel={`Going to ${e.title}. Tap to cancel your RSVP`}
      >
        <Text style={{ fontWeight: '800', fontSize: 13, color: colors.optic }}>Going ✓</Text>
      </Pressable>
    );
  } else {
    side = (
      <Pressable
        style={styles.join}
        onPress={() => { setTicked(false); setStep(step === 'rsvp' ? null : 'rsvp'); }}
        accessibilityRole="button"
        accessibilityLabel={`RSVP to ${e.title}`}
      >
        <Text style={{ fontWeight: '800', fontSize: 13, color: colors.ink }}>RSVP</Text>
      </Pressable>
    );
  }

  let below = null;
  if (e.checkedIn) {
    below = (
      <View style={styles.below}>
        <Text style={[type.hint, { fontSize: 12.5 }]}>You’re checked in. The people you shared a court with are in your crew.</Text>
        {!!onSeeCrew && (
          <Pressable onPress={onSeeCrew} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
            <Text style={styles.link}>See your crew</Text>
          </Pressable>
        )}
      </View>
    );
  } else if (e.going && step === 'checkin' && !e.waiverAccepted) {
    // On the list, but no waiver on record (it didn't save, or the RSVP was
    // made before waivers): it comes first — the server refuses check-in without it.
    below = (
      <View style={styles.below}>
        <Text style={[type.hint, { fontSize: 12.5 }]}>One thing before you check in:</Text>
        <WaiverLine ticked={ticked} onToggle={() => setTicked((t) => !t)} onRead={() => setReading(true)} />
        <View style={styles.actions}>
          <Pressable style={[styles.go, busy && { opacity: 0.6 }]} onPress={acceptForCheckIn} accessibilityRole="button">
            <Text style={styles.goLabel}>Accept and continue</Text>
          </Pressable>
          <Pressable onPress={close} hitSlop={6} accessibilityRole="button"><Text style={styles.quiet}>Not now</Text></Pressable>
        </View>
      </View>
    );
  } else if (e.going && step === 'checkin') {
    below = (
      <View style={styles.below}>
        <Text style={styles.label}>Host’s check-in code</Text>
        <View style={styles.actions}>
          <TextInput
            style={styles.code}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            placeholder="••••"
            placeholderTextColor="rgba(245,244,238,0.35)"
            accessibilityLabel={`Check-in code for ${e.title}`}
            onSubmitEditing={confirmCheckIn}
            returnKeyType="done"
          />
          <Pressable style={[styles.go, busy && { opacity: 0.6 }]} onPress={confirmCheckIn} accessibilityRole="button">
            <Text style={styles.goLabel}>{busy ? 'Checking…' : 'Check in'}</Text>
          </Pressable>
          <Pressable onPress={close} hitSlop={6} accessibilityRole="button"><Text style={styles.quiet}>Not now</Text></Pressable>
        </View>
        <Text style={[type.hint, { fontSize: 11.5 }]}>
          {app.live
            ? 'The host reads it out at the event. Check-in opens an hour before the start.'
            : 'Demo: there’s no host and no real code — enter any 4 to 8 letters or digits. Nothing is recorded.'}
        </Text>
      </View>
    );
  } else if (e.going) {
    below = (
      <View style={[styles.below, styles.actions]}>
        <Pressable onPress={() => { setTicked(false); setCode(''); setStep('checkin'); }} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Check in to ${e.title}`}>
          <Text style={styles.link}>Check in</Text>
        </Pressable>
        <Text style={[type.hint, { fontSize: 12, flex: 1 }]}>At the event? The host reads out a code.</Text>
      </View>
    );
  } else if (locked) {
    below = (
      <View style={styles.below}>
        <Text style={[type.hint, { fontSize: 12.5 }]}>Club members can RSVP now. It opens to everyone {opensToAll}.</Text>
      </View>
    );
  } else if (step === 'rsvp') {
    below = (
      <View style={styles.below}>
        <WaiverLine ticked={ticked} onToggle={() => setTicked((t) => !t)} onRead={() => setReading(true)} />
        <View style={styles.actions}>
          <Pressable style={[styles.go, busy && { opacity: 0.6 }]} onPress={confirmRsvp} accessibilityRole="button">
            <Text style={styles.goLabel}>{busy ? 'Saving…' : 'Confirm RSVP'}</Text>
          </Pressable>
          <Pressable onPress={close} hitSlop={6} accessibilityRole="button"><Text style={styles.quiet}>Not now</Text></Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.event, (expanded || !!step) && { borderColor: colors.optic }]}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable
          style={{ flex: 1, flexDirection: 'row', gap: 12 }}
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: !!expanded }}
        >
          <View style={styles.date}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: colors.dim, letterSpacing: 0.6 }}>{String(e.dow || '').toUpperCase()}</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: colors.optic }}>{e.dom}</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{e.title}</Text>
            <Text style={[type.hint, { fontSize: 12.5 }]}>{e.venue} · {e.time}</Text>
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
              <Tag label={e.sport} accent />
              <Tag label={e.level} />
              {!!price && <Tag label={price} />}
              {/* which city, once the list spans more than one */}
              {showCity && !!e.city && <Tag label={cityLabel(e.city)} />}
              {!!opensToAll && <Tag label="Club early access" />}
            </View>
            {!!saving && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="pricetag-outline" size={13} color={colors.optic} />
                <Text style={{ color: colors.optic, fontWeight: '700', fontSize: 12.5 }}>{saving}</Text>
              </View>
            )}
            {expanded && (
              <View style={{ gap: 8, marginTop: 6 }}>
                {!!e.desc && <Text style={[type.hint, { fontSize: 12.5 }]}>{e.desc}</Text>}
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {attendees.map((a, i) => (
                    <View key={a.id} style={{ marginLeft: i ? -10 : 0 }}>
                      <Avatar id={a.id} name={a.name} size={26} />
                    </View>
                  ))}
                  <Text style={[type.hint, { fontSize: 12, marginLeft: attendees.length ? 6 : 0 }]}>
                    {attendees.length ? '+' : ''}{e.goingCount || 0} going{e.going ? ' · including you' : ''}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </Pressable>
        <View style={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[type.hint, { fontSize: 11 }]}>{e.spotsLeft} spots left</Text>
          {side}
        </View>
      </View>
      {below}
      <WaiverSheet visible={reading} onClose={() => setReading(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  event: {
    gap: 10, padding: 13, marginBottom: 10,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, borderRadius: 16,
  },
  date: {
    width: 52, borderWidth: 2, borderColor: colors.optic, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 8, alignSelf: 'flex-start',
  },
  join: { backgroundColor: colors.optic, borderRadius: radii.pill, paddingVertical: 8, paddingHorizontal: 14 },
  joinGoing: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.optic },
  below: { gap: 8, paddingTop: 10, borderTopWidth: 2, borderTopColor: colors.line },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  waiverRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  go: { backgroundColor: colors.optic, borderRadius: radii.pill, paddingVertical: 9, paddingHorizontal: 16 },
  goLabel: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  link: { color: colors.optic, fontWeight: '800', fontSize: 13 },
  quiet: { color: colors.dim, fontWeight: '700', fontSize: 12.5 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.dim },
  code: {
    minWidth: 104, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 2, borderColor: colors.line, borderRadius: radii.sm, backgroundColor: colors.card2,
    color: colors.text, fontSize: 16, fontWeight: '800', letterSpacing: 3,
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(4,5,6,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 2, borderColor: colors.line, padding: 18, maxHeight: '86%',
  },
});
