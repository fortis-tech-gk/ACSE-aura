import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useOfficialSession } from '@/lib/officials/session';
import { MEALS, currentMeal, istDate } from '@/lib/officials/scan-logic';
import type { AthleteRef, MealType } from '@/lib/officials/types';
import { api } from '@/lib/api';
import { useOfficialsLayout } from '@/lib/officials/layout';
import { RosterNote, ScanPanel, SyncPill } from '@/components/officials/ScanPanel';
import { HeatList } from '@/components/officials/HeatList';
import { AppHeader, Card, Icon, Muted, Screen, SectionLabel, Stat, colors } from '@/components/ui';

const ROLE_TITLE: Record<string, string> = {
  food_volunteer: 'Food counter',
  warden: 'Hostel warden',
  accreditation_volunteer: 'Accreditation desk',
  call_room_official: 'Call room',
  referee: 'Referee',
  meet_admin: 'Meet admin',
};

export default function OfficialsHome() {
  const session = useOfficialSession();
  const { status, staff, token, sessionExpired, pendingCount, syncing, roster, rosterAt, logout } = session;

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.blue} size="large" />
      </View>
    );
  }
  if (status === 'signedOut' || !staff) return <Redirect href="/officials/login" />;

  function confirmLogout() {
    Alert.alert(
      'Log out?',
      pendingCount
        ? `${pendingCount} scan${pendingCount === 1 ? ' is' : 's are'} not sent yet. They stay on this device and are sent after the next login.`
        : 'You can log in again with your PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: () => logout().then(() => router.replace('/officials/login')) },
      ]
    );
  }

  return (
    <Screen
      maxWidth={1280}
      header={
        <AppHeader
          eyebrow="AURA Officials"
          title={ROLE_TITLE[staff.role] || staff.role}
          subtitle={staff.displayName}
          maxWidth={1280}
          right={
            <View style={s.headerRight}>
              <SyncPill pending={pendingCount} expired={sessionExpired} syncing={syncing} onPress={() => router.push('/officials/history')} />
              <Pressable onPress={confirmLogout} accessibilityRole="button" accessibilityLabel="Log out" hitSlop={10} style={s.logout}>
                <Icon name="logout" size={20} color={colors.goldBright} />
              </Pressable>
            </View>
          }
        />
      }
    >

      {sessionExpired && (
        <Pressable onPress={() => logout().then(() => router.replace('/officials/login'))} style={s.expired} accessibilityRole="button">
          <Icon name="warning" size={18} color={colors.red} />
          <Text style={s.expiredText}>Your login has expired. Tap to log in again — saved scans will be sent after.</Text>
        </Pressable>
      )}

      {staff.role === 'food_volunteer' && <FoodDesk token={token} />}
      {staff.role === 'warden' && <WardenDesk token={token} />}
      {staff.role === 'accreditation_volunteer' && <AccreditationDesk token={token} />}
      {staff.role === 'call_room_official' && <HeatList mode="callroom" />}
      {staff.role === 'referee' && <HeatList mode="referee" />}
      {!['food_volunteer', 'warden', 'accreditation_volunteer', 'call_room_official', 'referee'].includes(staff.role) && (
        <Card>
          <Muted>This duty is not available in the app. Log out and choose another duty.</Muted>
        </Card>
      )}

      {['food_volunteer', 'warden', 'accreditation_volunteer'].includes(staff.role) && <RosterNote count={roster.length} at={rosterAt} />}
    </Screen>
  );
}

/** Live counters from the server (skipped quietly when offline) */
function useStats<T>(path: string, token: string | null, everyMs = 30000) {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await api<T>(path, { token, timeoutMs: 8000 }));
    } catch {
      // offline — keep the last numbers
    }
  }, [path, token]);
  useEffect(() => {
    // load() sets state only after awaiting the network / storage
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, reload: load };
}

function FoodDesk({ token }: { token: string | null }) {
  const { submit, queue } = useOfficialSession();
  const [auto, setAuto] = useState(true);
  const [picked, setPicked] = useState<MealType>(currentMeal());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const meal = auto ? currentMeal(new Date(now)) : picked;
  const { data, reload } = useStats<Record<string, number>>('/catering/stats', token);

  const today = istDate(new Date(now));
  const mine = useMemo(
    () => queue.filter((q) => q.kind === 'meal' && q.mealType === meal && q.mealDate === today && q.status !== 'rejected').length,
    [queue, meal, today]
  );
  const served = data ? data[`${meal.toLowerCase()}_served`] : null;

  const onScan = useCallback(
    async (ref: AthleteRef) => {
      const out = await submit({ kind: 'meal', ref, mealType: meal });
      reload();
      return out;
    },
    [submit, meal, reload]
  );

  const controls = (
    <View style={{ gap: 10 }}>
      <SectionLabel>Meal</SectionLabel>
      <View style={s.chips} accessibilityRole="radiogroup">
        {MEALS.map((m) => {
          const active = m.key === meal;
          return (
            <Pressable
              key={m.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => {
                setAuto(false);
                setPicked(m.key);
              }}
              style={[s.chip, active && s.chipActive]}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {!auto && (
        <Pressable onPress={() => setAuto(true)} accessibilityRole="button">
          <Muted style={{ fontSize: 13, color: colors.blue, fontWeight: '700' }}>Meal picked by hand · tap to follow the clock again</Muted>
        </Pressable>
      )}
    </View>
  );

  return (
    <DeskLayout
      controls={controls}
      scanner={(l) => <ScanPanel onScan={onScan} hint={`Scan ID card for ${MEALS.find((m) => m.key === meal)!.label}`} {...l} />}
      stats={
        <View style={s.stats}>
          <Stat label={`${MEALS.find((m) => m.key === meal)!.label} served`} value={served != null ? String(served) : '—'} />
          <Stat label="By this device" value={String(mine)} />
          <Stat label="All meals today" value={data?.total_meals_today != null ? String(data.total_meals_today) : '—'} />
        </View>
      }
    />
  );
}

function WardenDesk({ token }: { token: string | null }) {
  const { submit, hostels } = useOfficialSession();
  const [hostelId, setHostelId] = useState<string | null>(null); // null = the hostel allotted to the college
  const [room, setRoom] = useState('');
  const { data, reload } = useStats<{ checkedInAthletes: number; totalAthletes: number; menCheckedIn: number; womenCheckedIn: number }>(
    '/accommodation/stats',
    token
  );

  const onScan = useCallback(
    async (ref: AthleteRef) => {
      const out = await submit({ kind: 'checkin', ref, hostelId: hostelId || undefined, room });
      if (out.tone !== 'red') setRoom('');
      reload();
      return out;
    },
    [submit, hostelId, room, reload]
  );

  const controls = (
      <Card style={{ gap: 10 }}>
        <SectionLabel>Hostel</SectionLabel>
        <View style={s.chips}>
          <HostelChip label="Allotted to college" active={hostelId === null} onPress={() => setHostelId(null)} />
          {hostels.map((h) => (
            <HostelChip key={h.id} label={`${h.name} (${h.available} free)`} active={hostelId === h.id} onPress={() => setHostelId(h.id)} />
          ))}
        </View>
        <TextInput
          value={room}
          onChangeText={setRoom}
          placeholder="Room no. (optional)"
          placeholderTextColor="#94a3b8"
          style={s.input}
          maxLength={20}
          accessibilityLabel="Room number"
        />
      </Card>
  );

  return (
    <DeskLayout
      controls={controls}
      scanner={(l) => <ScanPanel onScan={onScan} hint="Scan ID card to check in" {...l} />}
      stats={
        <View style={s.stats}>
          <Stat label="Checked in" value={data ? `${data.checkedInAthletes}/${data.totalAthletes}` : '—'} />
          <Stat label="Men" value={data ? String(data.menCheckedIn) : '—'} />
          <Stat label="Women" value={data ? String(data.womenCheckedIn) : '—'} />
        </View>
      }
    />
  );
}

function AccreditationDesk({ token }: { token: string | null }) {
  const { submit } = useOfficialSession();
  const { data, reload } = useStats<{ accreditedAthletes: number; totalAthletes: number; pendingAccreditation: number }>('/accreditation/stats', token);
  const onScan = useCallback(
    async (ref: AthleteRef) => {
      const out = await submit({ kind: 'accreditation', ref });
      reload();
      return out;
    },
    [submit, reload]
  );
  return (
    <DeskLayout
      scanner={(l) => <ScanPanel onScan={onScan} hint="Scan ID card to accredit" {...l} />}
      stats={
        <View style={s.stats}>
          <Stat label="Accredited" value={data ? String(data.accreditedAthletes) : '—'} />
          <Stat label="Still to come" value={data ? String(data.pendingAccreditation) : '—'} />
          <Stat label="Registered" value={data ? String(data.totalAthletes) : '—'} />
        </View>
      }
    />
  );
}

/**
 * Phone (portrait): controls, camera, counters stacked.
 * Tablet / landscape: camera on the left, controls and counters on the right.
 */
function DeskLayout({
  controls,
  scanner,
  stats,
}: {
  controls?: React.ReactNode;
  scanner: (l: { cameraHeight: number; large: boolean }) => React.ReactNode;
  stats: React.ReactNode;
}) {
  const { wide, cameraHeight, large } = useOfficialsLayout();
  if (!wide) {
    return (
      <>
        {controls}
        {scanner({ cameraHeight, large })}
        {stats}
      </>
    );
  }
  return (
    <View style={s.wideRow}>
      <View style={{ flex: 3, minWidth: 0 }}>{scanner({ cameraHeight, large })}</View>
      <View style={{ flex: 2, minWidth: 0, gap: 14 }}>
        {controls}
        {stats}
      </View>
    </View>
  );
}

function HostelChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: active }} style={[s.hChip, active && s.chipActive]}>
      <Text style={[s.hChipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logout: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(233,199,104,0.45)', alignItems: 'center', justifyContent: 'center' },
  expired: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.redSoft, borderRadius: 14, padding: 12 },
  expiredText: { flex: 1, color: colors.red, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexGrow: 1, flexBasis: '22%', alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border },
  chipActive: { borderColor: colors.navy, backgroundColor: colors.navy },
  chipText: { fontSize: 14, fontWeight: '800', color: colors.muted },
  chipTextActive: { color: colors.goldBright },
  hChip: { maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border },
  hChipText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  input: { minHeight: 50, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, fontWeight: '700', color: colors.text, backgroundColor: '#fffdf8' },
  stats: { flexDirection: 'row', gap: 8 },
  wideRow: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
});
