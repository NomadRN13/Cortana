// Deleting an account, asked once and done one way. Settings and the house
// rules screen both call this, so there is one delete flow in the app: the
// confirmation, the hard delete on the server (delete_account(), which takes
// profile, photos, matches and messages with it), then back to Welcome.
import { Alert } from 'react-native';
import { isBackendConfigured } from './supabase';
import * as api from '../api/backend';

export function confirmDeleteAccount({ app, navigation }) {
  Alert.alert(
    'Delete your account?',
    'This permanently deletes your profile, matches, and messages. It cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete forever',
        style: 'destructive',
        onPress: async () => {
          try {
            if (isBackendConfigured) await api.deleteAccount();
            app.signOut();
            navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
          } catch (e) {
            Alert.alert('Couldn’t delete your account', (e && e.message) || 'Check your connection and try again.');
          }
        },
      },
    ]
  );
}
