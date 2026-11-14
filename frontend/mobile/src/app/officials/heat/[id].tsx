import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useOfficialSession } from '@/lib/officials/session';
import type { HeatKind } from '@/lib/officials/types';
import { CallRoomHeat } from '@/components/officials/CallRoomHeat';
import { TrackReferee } from '@/components/officials/TrackReferee';
import { FieldReferee } from '@/components/officials/FieldReferee';
import { VerticalReferee } from '@/components/officials/VerticalReferee';
import { SyncPill } from '@/components/officials/ScanPanel';
import { AppHeader, Screen, colors } from '@/components/ui';

/** One heat / flight: the call room view or the referee's result entry, by duty and event type */
export default function HeatScreen() {
  const { id, kind, startAt, title } = useLocalSearchParams<{ id: string; kind?: HeatKind; startAt?: string; title?: string }>();
  const { status, staff, pendingCount, sessionExpired, syncing } = useOfficialSession();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.blue} size="large" />
      </View>
    );
  }
  if (status === 'signedOut' || !staff) return <Redirect href="/officials/login" />;

  const isCallRoom = staff.role === 'call_room_official';
  return (
    <Screen
      edges={['bottom']}
      maxWidth={1280}
      header={
        <AppHeader
          back="All heats"
          eyebrow={isCallRoom ? 'Call room' : kind === 'field' ? 'Referee · distance card' : kind === 'vertical' ? 'Referee · result card' : 'Referee · track'}
          title={title || 'Heat'}
          maxWidth={1280}
          right={<SyncPill pending={pendingCount} expired={sessionExpired} syncing={syncing} onPress={() => router.push('/officials/history')} />}
        />
      }
    >
      {isCallRoom ? (
        <CallRoomHeat heatId={id} />
      ) : kind === 'field' ? (
        <FieldReferee heatId={id} startAt={startAt || null} />
      ) : kind === 'vertical' ? (
        <VerticalReferee heatId={id} startAt={startAt || null} />
      ) : (
        <TrackReferee heatId={id} startAt={startAt || null} />
      )}
    </Screen>
  );
}
