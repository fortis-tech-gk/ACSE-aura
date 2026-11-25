import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { usePedSession, type Gender } from '@/lib/ped-session';
import { confirm } from '@/lib/confirm';
import { AppHeader, Icon, Screen, Segmented, colors } from '@/components/ui';
import { usePedData } from '@/components/ped/usePedData';
import { PedAttendance } from '@/components/ped/PedAttendance';
import { PedReserves } from '@/components/ped/PedReserves';
import { PedRelays } from '@/components/ped/PedRelays';
import { PedResults } from '@/components/ped/PedResults';

type Section = 'callroom' | 'reserves' | 'relays' | 'results';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'callroom', label: 'Call room' },
  { key: 'reserves', label: 'Reserves' },
  { key: 'relays', label: 'Relays' },
  { key: 'results', label: 'Results' },
];
const PATHS: Record<Section, string> = {
  callroom: '/ped/attendance',
  reserves: '/ped/entries',
  relays: '/ped/entries',
  results: '/ped/results',
};

export default function PedHome() {
  const { status, info, gender, setGender, logout } = usePedSession();
  const [section, setSection] = useState<Section>('callroom');
  // Attendance refreshes every 30 s while open; the others on pull / after a change
  const data = usePedData<any>(`${PATHS[section]}?gender=${gender}`, section === 'callroom' ? 30_000 : 0);

  // A college with one squad only: never sit on the empty one (e.g. a remembered choice)
  const genders = (info?.squads || []).map((s) => s.gender);
  useEffect(() => {
    if (genders.length && !genders.includes(gender)) setGender(genders[0]);
  }, [genders.join(','), gender, setGender]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'signedOut') return <Redirect href="/login" />;

  const genderOptions: { key: Gender; label: string }[] = (['men', 'women'] as Gender[])
    .filter((g) => genders.length === 0 || genders.includes(g))
    .map((g) => ({ key: g, label: g === 'men' ? 'Men' : 'Women' }));

  async function onLogout() {
    if (await confirm('Log out?', 'You will stop getting call room and result alerts on this phone.', 'Log out')) {
      await logout();
      router.replace('/login');
    }
  }

  return (
    <Screen
      refreshing={data.loading}
      onRefresh={data.reload}
      maxWidth={720}
      header={
        <AppHeader
          eyebrow="PED · AURA Athletes"
          title={info?.college.name || 'College PED'}
          subtitle={info?.college.code}
          maxWidth={720}
          right={
            <Pressable onPress={onLogout} accessibilityRole="button" accessibilityLabel="Log out" hitSlop={12} style={s.logout}>
              <Icon name="logout" size={20} color={colors.goldBright} />
            </Pressable>
          }
        >
          {genderOptions.length > 1 ? (
            <View style={{ marginTop: 10 }}>
              <Segmented value={gender} options={genderOptions} onChange={setGender} />
            </View>
          ) : null}
        </AppHeader>
      }
    >
      <Segmented value={section} options={SECTIONS} onChange={setSection} />

      {data.error ? (
        <View style={s.error}>
          <Icon name="warning" size={18} color={colors.red} />
          <Text style={s.errorText}>{data.error}</Text>
        </View>
      ) : null}

      {section === 'callroom' && <PedAttendance data={data.data} />}
      {section === 'reserves' && <PedReserves data={data.data} gender={gender} onChanged={data.reload} />}
      {section === 'relays' && <PedRelays data={data.data} gender={gender} onChanged={data.reload} />}
      {section === 'results' && <PedResults data={data.data} />}
    </Screen>
  );
}

const s = StyleSheet.create({
  logout: { padding: 6 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.redSoft, borderRadius: 12, padding: 12 },
  errorText: { flex: 1, color: colors.red, fontWeight: '700', lineHeight: 20 },
});
