import { Linking, Alert } from 'react-native';

// Public pages on the RSVPlay website. EXPO_PUBLIC_SITE_URL overrides the
// domain for a preview build; production uses the real one.
const SITE = String(process.env.EXPO_PUBLIC_SITE_URL || 'https://rsvplayapp.com').replace(/\/+$/, '');

export const LINKS = {
  terms: `${SITE}/terms/`,
  privacy: `${SITE}/privacy/`,
  safety: `${SITE}/safety/`,
};

export function openLink(url) {
  Linking.openURL(url).catch(() => {
    Alert.alert('Couldn’t open that page', `It’s at ${url}`);
  });
}
