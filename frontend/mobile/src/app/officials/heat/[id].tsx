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
import { Screen, colors } from '@/components/ui';

/** One heat / flight: the call room view or the referee's result entry, by duty and event type */
export default function HeatScreen() {
  const { id, kind, startAt } = useLocalSearchParams<{ id: string; kind?: HeatKind; startAt?: string }>();
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
    <Screen edges={['top', 'bottom']} maxWidth={1280}>
      <View style={{ alignItems: 'flex-end', marginBottom: -8 }}>
        <SyncPill pending={pendingCount} expired={sessionExpired} syncing={syncing} onPress={() => router.push('/officials/history')} />
      </View>
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
