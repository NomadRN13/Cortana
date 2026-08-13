// Shared Night Court UI primitives
import React from 'react';
import { Text, View, Pressable, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii, gradientFor, initials } from '../theme';
import { Bouncy } from './motion';

// The O in 40/LOVE is a pickleball, rendered from the same source as the
// website's wordmark (scripts/lib/ball.js → scripts/make-icons.js) so the two
// can't drift apart. It arrives as an image rather than a stack of Views
// because the modelling that makes it read as a ball — nineteen holes, each
// foreshortened into an ellipse because it is drilled into a sphere, each with
// a lit far wall and a bright chamfer on the near lip — is a lot of layers to
// rebuild at every size, and would look approximately right at best.
const BALL = require('../../assets/ball.png');

export function Pickleball({ size = 20 }) {
  return <Image source={BALL} style={{ width: size, height: size }} resizeMode="contain" />;
}

export function Wordmark({ size = 24, bounce = false }) {
  const ball = (
    <View style={{ marginHorizontal: 1 }}>
      <Pickleball size={size * 0.80} />
    </View>
  );
  const letter = { fontSize: size, fontWeight: '800', color: colors.text, letterSpacing: -0.5 };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={letter}>40/L</Text>
      {bounce ? <Bouncy>{ball}</Bouncy> : ball}
      <Text style={letter}>VE</Text>
    </View>
  );
}

export function Avatar({ id, name, photo, size = 52, borderColor }) {
  const tints = gradientFor(id || name || 'you');
  const base = {
    width: size,
    height: size,
    borderRadius: size / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: borderColor ? 3 : 0,
    borderColor: borderColor || 'transparent',
  };
  if (photo) return <Image source={{ uri: photo }} style={base} />;
  return (
    <LinearGradient colors={tints} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={base}>
      <Text style={{ fontSize: size * 0.36, fontWeight: '900', color: 'rgba(10,11,13,0.6)' }}>
        {initials(name || '?')}
      </Text>
    </LinearGradient>
  );
}

export function Btn({ label, onPress, kind = 'primary', style }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        kind === 'primary' ? styles.btnPrimary : kind === 'danger' ? styles.btnDanger : styles.btnGhost,
        pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
        style,
      ]}
    >
      <Text
        style={[
          styles.btnLabel,
          kind === 'primary' ? { color: colors.ink } : kind === 'danger' ? { color: colors.danger } : { color: colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { transform: [{ scale: 0.95 }] }]}
    >
      <Text style={[styles.chipLabel, active && { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Tag({ label, accent }) {
  return (
    <View style={[styles.tag, accent && { borderColor: colors.optic }]}>
      <Text style={[styles.tagLabel, accent && { color: colors.optic }]}>{label}</Text>
    </View>
  );
}

export function Row({ children, style }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: { paddingVertical: 15, paddingHorizontal: 18, borderRadius: radii.md, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.optic },
  btnGhost: { borderWidth: 2, borderColor: colors.line },
  btnDanger: { borderWidth: 2, borderColor: colors.danger },
  btnLabel: { fontSize: 16, fontWeight: '800' },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.optic, borderColor: colors.optic },
  chipLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  tag: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.line,
  },
  tagLabel: { fontSize: 11, fontWeight: '700', color: colors.dim },
});
