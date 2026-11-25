import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useOfficialSession } from '@/lib/officials/session';
import { RollCall } from '@/components/officials/RollCall';
import { SyncPill } from '@/components/officials/ScanPanel';
import { AppHeader, Screen, colors } from '@/components/ui';

/** Event roll call (first round): everyone reports, then the call room prepares the heats */
export default function RollCallScreen() {
  const { eventId, stage, title } = useLocalSearchParams<{ eventId: string; stage?: string; title?: string }>();
  const { status, staff, pendingCount, sessionExpired, syncing } = useOfficialSession();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.blue} size="large" />
      </View>
    );
  }
  if (status === 'signedOut' || !staff) return <Redirect href="/officials/login" />;

  return (
    <Screen
      edges={['bottom']}
      maxWidth={1280}
      header={
        <AppHeader
          back="Call room"
          eyebrow="Call room · roll call"
          title={title || 'Roll call'}
          maxWidth={1280}
          right={<SyncPill pending={pendingCount} expired={sessionExpired} syncing={syncing} onPress={() => router.push('/officials/history')} />}
        />
      }
    >
      <RollCall eventId={eventId} stage={stage || 'HEATS'} />
    </Screen>
  );
}
