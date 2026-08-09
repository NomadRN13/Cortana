// Motion + interactivity toolkit — React Native core APIs only (Animated,
// PanResponder), no extra native dependencies. Everything here honors the
// device's Reduce Motion accessibility setting via useReduceMotion().
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export function useReduceMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (mounted) setReduced(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(!!v));
    return () => { mounted = false; if (sub && sub.remove) sub.remove(); };
  }, []);
  return reduced;
}

// Drag-to-swipe wrapper for the top deck card. Children render the card
// itself; LIKE/PASS stamps fade in with the drag. Taps (no movement) call
// onTap, so buttons inside the card keep working.
export function SwipeableCard({ children, onSwipeRight, onSwipeLeft, onTap, disabled }) {
  const pan = useRef(new Animated.ValueXY()).current;
  const moved = useRef(false);

  const fling = (dir, cb) => {
    Animated.timing(pan, {
      toValue: { x: dir * 480, y: 40 },
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => { if (cb) cb(); });
  };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => !disabled && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => { moved.current = false; },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) > 8) moved.current = true;
        pan.setValue({ x: g.dx, y: g.dy * 0.15 });
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 110) fling(1, onSwipeRight);
        else if (g.dx < -110) fling(-1, onSwipeLeft);
        else Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: true }).start();
      },
    })
  ).current;

  const rotate = pan.x.interpolate({ inputRange: [-200, 200], outputRange: ['-12deg', '12deg'] });
  const likeOpacity = pan.x.interpolate({ inputRange: [30, 110], outputRange: [0, 1], extrapolate: 'clamp' });
  const passOpacity = pan.x.interpolate({ inputRange: [-110, -30], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Animated.View
      {...responder.panHandlers}
      style={{ transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }}
    >
      <Pressable onPress={() => { if (!moved.current && onTap) onTap(); }}>
        {children}
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLike, { opacity: likeOpacity }]}>
          <Text style={[styles.stampText, { color: colors.optic, borderColor: colors.optic }]}>LIKE</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampPass, { opacity: passOpacity }]}>
          <Text style={[styles.stampText, { color: colors.danger, borderColor: colors.danger }]}>PASS</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

// Tennis-ball + heart confetti burst for the Match Point modal.
export function Confetti({ count = 12 }) {
  const parts = useRef(
    Array.from({ length: count }, (_, i) => ({
      a: new Animated.Value(0),
      dx: Math.random() * 300 - 150,
      dy: Math.random() * -240 + 30,
      rot: `${Math.round(Math.random() * 540 - 270)}deg`,
      emoji: ['🎾', '❤️', '✨'][i % 3],
      delay: Math.round(Math.random() * 150),
    }))
  ).current;

  useEffect(() => {
    const anims = parts.map((p) =>
      Animated.timing(p.a, { toValue: 1, duration: 1100, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {parts.map((p, i) => (
        <Animated.Text
          key={i}
          style={{
            position: 'absolute',
            top: '42%',
            left: '50%',
            fontSize: 22,
            opacity: p.a.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: p.a.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
              { translateY: p.a.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] }) },
              { rotate: p.a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', p.rot] }) },
            ],
          }}
        >
          {p.emoji}
        </Animated.Text>
      ))}
    </View>
  );
}

// "They're typing…" — three blinking dots.
export function TypingDots() {
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const anims = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay((2 - i) * 150),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View accessibilityLabel="Typing" style={styles.typing}>
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7, height: 7, borderRadius: 4, backgroundColor: colors.dim,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
            transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
          }}
        />
      ))}
    </View>
  );
}

// Number that counts up when it first appears (profile stats).
export function CountUpText({ value, style, duration = 600 }) {
  const reduced = useReduceMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced || !value) { setN(value || 0); return undefined; }
    const start = Date.now();
    const t = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / duration);
      setN(Math.round(value * k));
      if (k >= 1) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  }, [value, reduced, duration]);
  return <Text style={style}>{n}</Text>;
}

// Gentle idle bounce (the welcome-screen tennis ball).
export function Bouncy({ children, amount = 7, period = 2400 }) {
  const reduced = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  return (
    <Animated.View style={{ transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -amount] }) }] }}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stamp: { position: 'absolute', top: 24 },
  stampLike: { left: 16, transform: [{ rotate: '-12deg' }] },
  stampPass: { right: 16, transform: [{ rotate: '12deg' }] },
  stampText: {
    fontSize: 20, fontWeight: '900', letterSpacing: 1.2,
    borderWidth: 3, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 12,
    backgroundColor: 'rgba(10,11,13,0.5)', overflow: 'hidden',
  },
  typing: {
    flexDirection: 'row', gap: 4, padding: 14, alignSelf: 'flex-start',
    backgroundColor: colors.card2, borderRadius: 16, borderBottomLeftRadius: 6,
  },
});
