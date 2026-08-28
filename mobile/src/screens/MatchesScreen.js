import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, type, gradientFor, initials } from '../theme';
import { Avatar } from '../components/ui';
import { useApp } from '../state';

export default function MatchesScreen({ navigation }) {
  const app = useApp();
  const savedIds = Object.keys(app.saved).filter((k) => app.saved[k] && !app.blocked[k]);

  const likeFromSaved = async (id) => {
    const p = app.profileById(id);
    const matched = await app.likeSaved(id);
    if (matched) {
      Alert.alert("It's a Match Point!", `You and ${p.name} matched. The court is the icebreaker.`, [
        { text: 'Send a message', onPress: () => navigation.navigate('Chat', { screen: 'Conversation', params: { id }, initial: false }) },
        { text: 'Keep playing', style: 'cancel' },
      ]);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={['top']}>
      <Text style={[type.display, { fontSize: 18, paddingHorizontal: 18, paddingVertical: 14 }]}>Matches</Text>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
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
                    <Text style={{ fontSize: 38, fontWeight: '900', color: 'rgba(10,11,13,0.55)' }}>{initials(p.name)}</Text>
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
            <Text style={type.hint}>Head Home and start swinging.</Text>
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
  empty: {
    alignItems: 'center', gap: 12, padding: 44,
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 20,
  },
});
