import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { APP_VARIANT } from '@/lib/config';

export default function PedLayout() {
  // The PED screens are part of the AURA Athletes app only
  if (APP_VARIANT === 'officials') return <Redirect href="/officials" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f6f3ec' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
    </Stack>
  );
}
