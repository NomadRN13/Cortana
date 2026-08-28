import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppStateProvider, useApp } from './src/state';
import { colors, type } from './src/theme';
import WelcomeScreen from './src/screens/WelcomeScreen';
import SignInScreen from './src/screens/SignInScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import MatchesScreen from './src/screens/MatchesScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ConversationScreen from './src/screens/ConversationScreen';
import EventsScreen from './src/screens/EventsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const ChatStackNav = createNativeStackNavigator();

const TAB_ICONS = {
  Home: 'home-outline',
  Matches: 'heart-outline',
  Chat: 'chatbubble-outline',
  Events: 'calendar-outline',
  Profile: 'person-outline',
};

function ChatStack() {
  return (
    <ChatStackNav.Navigator screenOptions={{ headerShown: false }}>
      <ChatStackNav.Screen name="ChatList" component={ChatListScreen} />
      <ChatStackNav.Screen name="Conversation" component={ConversationScreen} />
    </ChatStackNav.Navigator>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.optic,
        tabBarInactiveTintColor: colors.dim,
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopWidth: 2,
          borderTopColor: colors.line,
          height: 62,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700' },
        tabBarIcon: ({ color, size, focused }) => {
          const base = TAB_ICONS[route.name];
          const name = focused ? base.replace('-outline', '') : base;
          return <Ionicons name={name} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Matches" component={MatchesScreen} />
      <Tabs.Screen name="Chat" component={ChatStack} />
      <Tabs.Screen name="Events" component={EventsScreen} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.night,
    card: colors.panel,
    text: colors.text,
    primary: colors.optic,
    border: colors.line,
  },
};

// Signed in, but the profile wouldn't load. Without a way out of this the app
// waits on a black screen forever — the state a reinstall on a bad connection
// lands in, with no error, no retry and no way to sign out.
function CantLoad({ onRetry, onSignOut }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
      <Text style={{ fontSize: 40 }}>🎾</Text>
      <Text style={[type.display, { fontSize: 20, textAlign: 'center' }]}>Couldn’t load your profile</Text>
      <Text style={[type.hint, { textAlign: 'center' }]}>
        You’re still signed in — this is your connection, not your account. Nothing has been lost.
      </Text>
      <Pressable
        onPress={onRetry}
        style={{ backgroundColor: colors.optic, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 30, marginTop: 14 }}
      >
        <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 15 }}>Try again</Text>
      </Pressable>
      <Pressable onPress={onSignOut} hitSlop={8} style={{ marginTop: 6 }}>
        <Text style={{ color: colors.dim, fontWeight: '700', fontSize: 13 }}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function Root() {
  const { bootRoute, bootError, retryBoot, signOut } = useApp();
  if (bootError) return <CantLoad onRetry={retryBoot} onSignOut={signOut} />;
  // Hold the splash until we know whether this device is still signed in —
  // deciding from local storage alone made a signed-in phone with no cached
  // profile look like a brand new visitor.
  if (!bootRoute) return <View style={{ flex: 1, backgroundColor: colors.night }} />;
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={bootRoute}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" backgroundColor={colors.night} />
          <Root />
        </NavigationContainer>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
