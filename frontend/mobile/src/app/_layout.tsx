import React, { useEffect } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { Cinzel_700Bold, Cinzel_900Black } from '@expo-google-fonts/cinzel';
import { AthleteSessionProvider, useAthleteSession } from '@/lib/athlete-session';
import { APP_VARIANT } from '@/lib/config';

// Show reminders and pushes even while the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** A server push about the schedule (call room open, delay, re-draw) → refetch and reschedule reminders */
function PushRefresh() {
  const { status, refresh } = useAthleteSession();
  useEffect(() => {
    if (status !== 'signedIn') return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const kind = (n.request.content.data as any)?.kind;
      if (kind && kind !== 'call-room-reminder') refresh();
    });
    return () => sub.remove();
  }, [status, refresh]);
  return null;
}

/**
 * One codebase builds both apps: keep each app on its own screens. Covers the top-level athlete
 * screens (login, scan, stay, settings); the officials and tab layouts guard themselves too.
 */
function VariantGuard() {
  const segments = useSegments();
  const top = segments[0] as string | undefined;
  useEffect(() => {
    if (!top) return; // the index screen redirects by variant itself
    const inOfficials = top === 'officials';
    if (APP_VARIANT === 'officials' && !inOfficials) router.replace('/officials');
    else if (APP_VARIANT !== 'officials' && inOfficials) router.replace('/');
  }, [top]);
  return null;
}

export default function RootLayout() {
  // Titles use Cinzel (the ID card's display face); until it loads they show in the system serif
  useFonts({ Cinzel_700Bold, Cinzel_900Black });
  return (
    <SafeAreaProvider>
      <AthleteSessionProvider>
        <PushRefresh />
        <VariantGuard />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f6f3ec' } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
          <Stack.Screen name="(tabs)" />
          {/* Opened from More, on top of the tabs, so Back returns to More */}
          <Stack.Screen name="stay" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="officials" />
        </Stack>
      </AthleteSessionProvider>
    </SafeAreaProvider>
  );
}
