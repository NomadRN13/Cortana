import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, type } from '../theme';
import { Wordmark, Btn } from '../components/ui';
import { useApp } from '../state';

export default function WelcomeScreen({ navigation }) {
  const { user } = useApp();
  return (
    <SafeAreaView style={styles.wrap}>
      <View style={{ gap: 14 }}>
        <Text style={[type.eyebrow, { color: colors.optic }]}>Serve. Rally. Connect.</Text>
        <Wordmark size={54} bounce />
        <Text style={styles.line}>
          Meet Indy's racquet-sports people — the first date is a game, not dinner.
        </Text>
        <View style={styles.score}>
          <Text style={styles.scoreText}>40 – LOVE</Text>
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <Btn label="Get started" onPress={() => navigation.navigate('SignIn')} />
        <Btn
          label={user ? `Continue as ${user.name}` : 'I already have an account'}
          kind="ghost"
          onPress={() => navigation.navigate(user ? 'Main' : 'SignIn')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.night,
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 54,
    paddingBottom: 36,
  },
  line: {
    ...type.body,
    color: colors.dim,
    maxWidth: 280,
    marginTop: 10,
    paddingTop: 18,
    borderTopWidth: 2,
    borderTopColor: colors.line,
  },
  score: {
    alignSelf: 'flex-start',
    marginTop: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 999,
  },
  scoreText: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2, color: colors.optic },
});
