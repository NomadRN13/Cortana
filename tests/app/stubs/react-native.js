export const alerts = [];
export const Alert = {
  alert(title, message, buttons) { alerts.push({ title, message, buttons: buttons || [] }); },
};
export const Platform = { OS: 'ios', select: (o) => o.ios };

// Host components for the screens. The state layer needs none of these; the
// screens are rendered with react-test-renderer, which is happy with a plain
// string as a component type and keeps every prop (onPress, style, value…) on
// the node where a test can find it.
import React from 'react';

export const View = 'View';
export const Text = 'Text';
export const ScrollView = 'ScrollView';
export const Pressable = 'Pressable';
export const TextInput = 'TextInput';
export const Image = 'Image';
export const Switch = 'Switch';
// A modal that isn't visible renders nothing, as on a phone.
export const Modal = ({ visible, children }) => (visible ? React.createElement('Modal', null, children) : null);
export const FlatList = ({ data, renderItem, keyExtractor }) => React.createElement(
  'FlatList', null,
  (data || []).map((item, index) => React.createElement(
    React.Fragment, { key: keyExtractor ? keyExtractor(item, index) : index }, renderItem({ item, index })
  ))
);
export const StyleSheet = { create: (styles) => styles, flatten: (s) => Object.assign({}, ...[].concat(s || []).flat(Infinity).filter(Boolean)) };
export const Linking = { openURL: () => Promise.resolve() };
