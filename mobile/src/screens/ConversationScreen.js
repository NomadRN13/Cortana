import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Pressable, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Avatar } from '../components/ui';
import { useApp } from '../state';
import { COURTS } from '../data/seed';

export default function ConversationScreen({ route, navigation }) {
  const { id } = route.params;
  const app = useApp();
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const p = app.profileById(id);
  const thread = app.threads.find((t) => t.id === id);

  useEffect(() => {
    app.markRead(id);
  }, [id]);

  useEffect(() => {
    if (listRef.current && thread && thread.msgs.length) {
      setTimeout(() => listRef.current && listRef.current.scrollToEnd({ animated: true }), 60);
    }
  }, [thread && thread.msgs.length]);

  if (!p) return null;

  const send = () => {
    const t = text.trim();
    if (!t) return;
    app.sendMessage(id, { who: 'me', text: t, when: 'Just now' });
    setText('');
  };

  const suggestCourt = () => {
    app.sendMessage(id, {
      who: 'me',
      kind: 'court',
      court: COURTS[0],
      day: 'Sat',
      time: '10:00 AM',
      sport: p.sports[0] || 'Tennis',
      when: 'Just now',
    });
  };

  const more = () => {
    Alert.alert(p.name, `${p.sports.join(' & ')} · ${p.dist.toFixed(1)} mi`, [
      { text: `Report ${p.name}`, onPress: () => Alert.alert('Thank you', `Our safety team will review ${p.name}'s profile.`) },
      {
        text: `Block ${p.name}`,
        style: 'destructive',
        onPress: () => {
          app.block(id);
          navigation.goBack();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top', 'bottom']}>
      <View style={styles.head}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Avatar id={p.id} name={p.name} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>{p.name}</Text>
          <Text style={[type.hint, { fontSize: 12 }]}>{p.sports.join(' & ')} · {p.dist.toFixed(1)} mi</Text>
        </View>
        <Pressable onPress={more} hitSlop={8} accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <FlatList
          ref={listRef}
          data={thread ? thread.msgs : []}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: 14, gap: 10 }}
          ListEmptyComponent={
            <Text style={[type.hint, { textAlign: 'center' }]}>It's a Match Point! Serve first — say hi. 🎾</Text>
          }
          renderItem={({ item: m }) => {
            const mine = m.who === 'me';
            if (m.kind === 'court') {
              return (
                <View style={[styles.msg, mine ? styles.mine : styles.theirs]}>
                  <View style={styles.courtCard}>
                    <View style={styles.courtTop}>
                      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 11, letterSpacing: 0.8 }}>COURT TIME</Text>
                    </View>
                    <View style={{ padding: 12, gap: 3 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{m.court}</Text>
                      <Text style={[type.hint, { fontSize: 13 }]}>{m.day} · {m.time} · {m.sport}</Text>
                    </View>
                  </View>
                  <Text style={styles.when}>{m.when}</Text>
                </View>
              );
            }
            return (
              <View style={[styles.msg, mine ? styles.mine : styles.theirs]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={{ color: mine ? colors.ink : colors.text, fontSize: 14, lineHeight: 20, fontWeight: mine ? '600' : '400' }}>
                    {m.text}
                  </Text>
                </View>
                <Text style={styles.when}>{m.when}</Text>
              </View>
            );
          }}
        />

        <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingTop: 4 }}>
          <Pressable style={styles.toolChip} onPress={suggestCourt}>
            <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 12 }}>🎾 Suggest court time</Text>
          </Pressable>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Your serve…"
            placeholderTextColor="rgba(244,246,240,0.35)"
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable style={styles.sendBtn} onPress={send} accessibilityLabel="Send">
            <Text style={{ color: colors.ink, fontWeight: '800' }}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 2, borderBottomColor: colors.line,
  },
  msg: { maxWidth: '78%', gap: 3 },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: { paddingVertical: 10, paddingHorizontal: 13, borderRadius: 16 },
  bubbleMine: { backgroundColor: colors.optic, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: colors.card2, borderBottomLeftRadius: 6 },
  when: { fontSize: 11, color: colors.dim },
  courtCard: { borderWidth: 2, borderColor: colors.optic, borderRadius: 14, overflow: 'hidden', minWidth: 200, backgroundColor: colors.card },
  courtTop: { backgroundColor: colors.optic, paddingVertical: 7, paddingHorizontal: 12 },
  toolChip: { borderWidth: 2, borderColor: colors.optic, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13 },
  inputRow: { flexDirection: 'row', gap: 8, padding: 14 },
  input: {
    flex: 1, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card,
    borderRadius: 999, paddingVertical: 11, paddingHorizontal: 16, fontSize: 16, color: colors.text,
  },
  sendBtn: { backgroundColor: colors.optic, borderRadius: 999, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
});
