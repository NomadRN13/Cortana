// Shared Night Court UI primitives
import React from 'react';
import { Text, View, Pressable, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, gradientFor, initials } from '../theme';

export function Wordmark({ size = 24 }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ fontSize: size, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>40/L</Text>
      <Ionicons name="tennisball" size={size * 0.82} color={colors.optic} style={{ marginHorizontal: 1 }} />
      <Text style={{ fontSize: size, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>ve</Text>
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
        pressed && { opacity: 0.85 },
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
      style={[styles.chip, active && styles.chipActive]}
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
