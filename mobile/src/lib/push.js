// Push notification registration. Safe everywhere: in Expo Go (which can't
// do remote push since SDK 53), on simulators, or with permission denied,
// it quietly does nothing — the in-app notifications panel still works.
import { Platform } from 'react-native';

export async function registerForPush(registerToken) {
  try {
    const Notifications = require('expo-notifications');
    const Device = require('expo-device');
    const Constants = require('expo-constants').default;

    if (!Device.isDevice) return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Matches & messages',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#D6F44F',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return false;

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId && projectId !== 'REPLACE_AFTER_RUNNING_eas_init' ? { projectId } : {}
    );
    if (!tokenResult || !tokenResult.data) return false;

    await registerToken(tokenResult.data, Platform.OS === 'ios' ? 'ios' : 'android');
    return true;
  } catch (e) {
    return false;
  }
}
