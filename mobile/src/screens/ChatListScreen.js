import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, type } from '../theme';
import { Avatar } from '../components/ui';
import { useApp } from '../state';

function preview(t) {
  if (!t.msgs.length) return 'New match — say hi!';
  const m = t.msgs[t.msgs.length - 1];
  if (m.typing) return 'typing…';
  if (m.kind === 'court') return `🎾 ${m.court} · ${m.day} ${m.time}`;
  return `${m.who === 'me' ? 'You: ' : ''}${m.text}`;
}

export default function ChatListScreen({ navigation }) {
  const app = useApp();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <Text style={[type.display, { fontSize: 18, paddingHorizontal: 18, paddingVertical: 14 }]}>Chat</Text>
      <FlatList
        data={app.threads}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>💬</Text>
            <Text style={[type.display, { fontSize: 20 }]}>No chats yet</Text>
            <Text style={type.hint}>Match with someone first — then it's your serve.</Text>
          </View>
        }
        renderItem={({ item: t }) => {
          const p = app.profileById(t.id);
          if (!p) return null;
          return (
            <Pressable style={styles.thread} onPress={() => navigation.navigate('Conversation', { id: t.id })}>
              <Avatar id={p.id} name={p.name} size={52} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{p.name}</Text>
                <Text style={[type.hint, { marginTop: 2 }]} numberOfLines={1}>{preview(t)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                {t.yourServe && (
                  <View style={styles.serveBadge}>
                    <Text style={{ color: colors.optic, fontWeight: '800', fontSize: 10, letterSpacing: 0.8 }}>YOUR SERVE</Text>
                  </View>
                )}
                {t.unread && <View style={styles.unread} />}
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  thread: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: colors.line,
  },
  serveBadge: { borderWidth: 2, borderColor: colors.optic, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 7 },
  unread: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.optic },
  empty: { alignItems: 'center', gap: 12, padding: 44 },
});
