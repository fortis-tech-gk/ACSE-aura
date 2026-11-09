import React from 'react';
import { Stack } from 'expo-router';
import { OfficialSessionProvider } from '@/lib/officials/session';

export default function OfficialsLayout() {
  return (
    <OfficialSessionProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="history" />
        <Stack.Screen name="heat/[id]" />
      </Stack>
    </OfficialSessionProvider>
  );
}
