import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAthleteSession } from '@/lib/athlete-session';
import { fmtTime } from '@/lib/format';
import { AppHeader, Card, Icon, Muted, OfflineBanner, Pill, Screen, SectionLabel, colors } from '@/components/ui';

const MEALS: { key: string; label: string }[] = [
  { key: 'BREAKFAST', label: 'Breakfast' },
  { key: 'LUNCH', label: 'Lunch' },
  { key: 'SNACKS', label: 'Snacks' },
  { key: 'DINNER', label: 'Dinner' },
];

export default function StayScreen() {
  const { status, me, refreshing, refresh, offline, lastSyncedAt } = useAthleteSession();
  const hostel = me?.hostel;
  const claimed = new Map((me?.meals.claimed || []).map((m) => [m.mealType, m.at]));

  if (status === 'signedOut') return <Redirect href="/login" />;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']} header={<AppHeader back="More" eyebrow="AURA Athletes" title="Stay & Meals" />}>
      <OfflineBanner offline={offline} lastSyncedAt={lastSyncedAt} />

      <Card style={{ gap: 8 }}>
        <SectionLabel>Accommodation</SectionLabel>
        {hostel ? (
          <>
            <Text style={s.big}>{hostel.name || 'Hostel allotted'}</Text>
            <Muted>{hostel.room || hostel.roomRange || 'Room details at the hostel desk'}</Muted>
            {!!hostel.notes && <Muted>{hostel.notes}</Muted>}
            <Pill
              icon={hostel.checkedIn ? 'check' : 'info'}
              label={hostel.checkedIn ? `Checked in${hostel.checkedInAt ? ` at ${fmtTime(hostel.checkedInAt)}` : ''}` : 'Not checked in yet — show your pass to the warden'}
              tone={hostel.checkedIn ? 'green' : 'amber'}
            />
          </>
        ) : (
          <Muted>Accommodation has not been allotted to your college yet. Your team manager will be informed.</Muted>
        )}
      </Card>

      <Card style={{ gap: 10 }}>
        <SectionLabel>Today’s meals</SectionLabel>
        <Muted>Show your pass QR at the dining hall. Each meal can be claimed once per day.</Muted>
        <View style={s.grid}>
          {MEALS.map((m) => {
            const at = claimed.get(m.key);
            return (
              <View key={m.key} style={[s.meal, at ? s.mealDone : null]}>
                <View style={s.mealTop}>
                  <Icon name="food" size={18} color={at ? colors.green : colors.goldDeep} />
                  <Text style={s.mealName}>{m.label}</Text>
                </View>
                <Text style={[s.mealState, { color: at ? colors.green : colors.muted }]}>{at ? `Claimed ${fmtTime(at)}` : 'Not claimed'}</Text>
              </View>
            );
          })}
        </View>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 21, fontWeight: '900', color: colors.navy },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meal: { width: '47%', flexGrow: 1, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, backgroundColor: '#fbf8f1', gap: 4 },
  mealDone: { backgroundColor: colors.greenSoft, borderColor: '#a8e2c5' },
  mealTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mealName: { fontSize: 15, fontWeight: '800', color: colors.text },
  mealState: { fontSize: 13, fontWeight: '700', marginTop: 2 },
});
