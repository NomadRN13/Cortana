// The native UI packages the screens import, reduced to what a render in Node
// needs: plain host elements, no animation, no gestures, no pickers.
import React from 'react';

// react-native-safe-area-context
export const SafeAreaView = 'SafeAreaView';
// @expo/vector-icons
export const Ionicons = 'Ionicons';
// expo-linear-gradient
export const LinearGradient = 'LinearGradient';
// expo-image-picker
export const requestMediaLibraryPermissionsAsync = () => Promise.resolve({ granted: false });
export const launchImageLibraryAsync = () => Promise.resolve({ canceled: true });

// mobile/src/components/motion.js — the card without the swipe, numbers
// without the count-up, and reduced motion on so no confetti is drawn.
export const SwipeableCard = ({ children }) => React.createElement('SwipeableCard', null, children);
export const Confetti = () => null;
export const Bouncy = ({ children }) => children;
export const CountUpText = ({ value, style }) => React.createElement('Text', { style }, String(value));
export const useReduceMotion = () => true;
