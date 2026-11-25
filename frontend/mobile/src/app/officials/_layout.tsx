import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { OfficialSessionProvider } from '@/lib/officials/session';
import { APP_VARIANT } from '@/lib/config';

export default function OfficialsLayout() {
  // The officials screens exist only in the AURA Officials app (one codebase builds both apps)
  if (APP_VARIANT !== 'officials') return <Redirect href="/" />;
  return (
    <OfficialSessionProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="history" />
        <Stack.Screen name="heat/[id]" />
        <Stack.Screen name="rollcall/[eventId]" />
      </Stack>
    </OfficialSessionProvider>
  );
}
