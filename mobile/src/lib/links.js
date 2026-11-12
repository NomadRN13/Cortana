import { Linking, Alert } from 'react-native';

// Public pages on the 40/LOVE website. Set EXPO_PUBLIC_SITE_URL once the site
// moves to its own domain; until then it lives on Netlify.
const SITE = String(process.env.EXPO_PUBLIC_SITE_URL || 'https://40-love.netlify.app').replace(/\/+$/, '');

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
