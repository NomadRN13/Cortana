// Shared Night Court UI primitives
import React from 'react';
import { Text, View, Pressable, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii, gradientFor, initials } from '../theme';
import { Bouncy } from './motion';

// The "o" in 40/Love is a pickleball. Drawn from Views and gradients rather
// than an icon font or SVG so it needs no extra dependency, and shaded so it
// reads as a lit sphere instead of a flat disc: light falls from the upper
// left, the holes darken at the top and catch a little bounce at the bottom,
// and a specular blob sits where the light hits.
// Geometry matches the web wordmark (24-unit circle, holes at r=6.2, ø3.5).
const HOLES = [[12, 12], [18.2, 12], [15.1, 17.37], [8.9, 17.37], [5.8, 12], [8.9, 6.63], [15.1, 6.63]];

// Same stops as the #pb-body / #pb-hole gradients in the web wordmark.
const BODY = ['#F4FDB4', '#DCF75F', '#C2E23C', '#7E9A26'];
const BODY_STOPS = [0, 0.34, 0.68, 1];
const RIM = ['rgba(255,255,255,.34)', 'rgba(255,255,255,0)', 'rgba(45,56,14,.55)'];
const RIM_STOPS = [0, 0.26, 1];
const HOLE = ['#05060A', '#161A0B', '#46551A'];
const HOLE_STOPS = [0, 0.6, 1];
const LIT = { x: 0.14, y: 0.04 };
const SHADE = { x: 0.9, y: 1 };

export function Pickleball({ size = 20 }) {
  const hole = size * (3.5 / 24);
  const glossW = size * 0.38;
  const glossH = size * 0.27;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <LinearGradient
        colors={BODY}
        locations={BODY_STOPS}
        start={LIT}
        end={SHADE}
        style={StyleSheet.absoluteFill}
      />
      {/* Specular highlight, angled to match the light direction. */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.15,
          top: size * 0.17,
          width: glossW,
          height: glossH,
          borderRadius: glossW / 2,
          overflow: 'hidden',
          transform: [{ rotate: '-28deg' }],
        }}
      >
        <LinearGradient
          colors={['rgba(255,255,255,.92)', 'rgba(255,255,255,.28)', 'rgba(255,255,255,0)']}
          locations={[0, 0.45, 1]}
          start={{ x: 0.3, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      {/* Rim light along the lit edge, contact shade along the far one. */}
      <LinearGradient
        colors={RIM}
        locations={RIM_STOPS}
        start={LIT}
        end={SHADE}
        style={StyleSheet.absoluteFill}
      />
      {/* Holes last: they are voids punched through the surface, so neither
          the highlight nor the rim light plays across them. */}
      {HOLES.map(([cx, cy]) => (
        <LinearGradient
          key={`${cx}-${cy}`}
          colors={HOLE}
          locations={HOLE_STOPS}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{
            position: 'absolute',
            width: hole,
            height: hole,
            borderRadius: hole / 2,
            left: (cx / 24) * size - hole / 2,
            top: (cy / 24) * size - hole / 2,
          }}
        />
      ))}
    </View>
  );
}

export function Wordmark({ size = 24, bounce = false }) {
  const ball = (
    <View style={{ marginHorizontal: 1 }}>
      <Pickleball size={size * 0.82} />
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ fontSize: size, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>40/L</Text>
      {bounce ? <Bouncy>{ball}</Bouncy> : ball}
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
