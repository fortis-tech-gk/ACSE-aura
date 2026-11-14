import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import Constants from 'expo-constants';
import { useAthleteSession } from '@/lib/athlete-session';
import {
  getExactAlarmGranted,
  getNotificationPermission,
  getRemindersEnabled,
  requestExactAlarm,
  requestNotificationPermission,
  setRemindersEnabled,
  type PermissionState,
} from '@/lib/reminders';
import { REMINDER_OFFSETS_MIN } from '@/lib/config';
import { AppHeader, Button, Card, Muted, Pill, Screen, SectionLabel, colors } from '@/components/ui';

export default function SettingsScreen() {
  const { status, me, logout, refresh, refreshing, lastSyncedAt, remindersScheduled, resyncReminders } = useAthleteSession();
  const [enabled, setEnabled] = useState(true);
  const [perm, setPerm] = useState<PermissionState>('undetermined');
  const [exact, setExact] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setEnabled(await getRemindersEnabled());
    setPerm(await getNotificationPermission());
    setExact(await getExactAlarmGranted());
  }, []);

  useEffect(() => {
    // load() sets state only after awaiting the network / storage
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Permission screens open outside the app: re-check when the athlete comes back
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load().then(() => resyncReminders());
    });
    return () => sub.remove();
  }, [load, resyncReminders]);

  async function toggle(v: boolean) {
    setEnabled(v);
    await setRemindersEnabled(v);
    if (v && perm !== 'granted') {
      const p = await requestNotificationPermission();
      setPerm(p);
    }
    await resyncReminders();
  }

  async function askNotifications() {
    const p = await requestNotificationPermission();
    setPerm(p);
    if (p === 'denied') {
      Alert.alert('Notifications are blocked', 'Open Settings and allow notifications for AURA Athletes to get call room reminders.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
    }
    await resyncReminders();
  }

  async function askExact() {
    await requestExactAlarm();
    setExact(await getExactAlarmGranted());
    await resyncReminders();
  }

  function confirmLogout() {
    Alert.alert('Log out?', 'Your reminders on this phone will be cancelled.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  }

  if (status === 'signedOut') return <Redirect href="/login" />;

  const synced = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'never';

  return (
    <Screen edges={['bottom']} header={<AppHeader back="More" eyebrow="AURA Athletes" title="Settings" />}>
      <SectionLabel>Reminders</SectionLabel>

      <Card style={{ gap: 12 }}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Call room reminders</Text>
            <Muted>{REMINDER_OFFSETS_MIN.join(', ')} minutes before each call room time</Muted>
          </View>
          <Switch value={enabled} onValueChange={toggle} accessibilityLabel="Call room reminders" />
        </View>

        <View style={s.row}>
          <Text style={[s.rowTitle, { flex: 1 }]}>Notifications</Text>
          <Pill label={perm === 'granted' ? 'Allowed' : perm === 'denied' ? 'Blocked' : 'Not allowed yet'} tone={perm === 'granted' ? 'green' : 'red'} />
        </View>
        {perm !== 'granted' && <Button title="Allow notifications" onPress={askNotifications} />}

        {Platform.OS === 'android' && exact !== null && (
          <>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>On-time reminders</Text>
                <Muted>Lets Android deliver reminders at the exact minute, even in battery saver.</Muted>
              </View>
              <Pill label={exact ? 'On' : 'Off'} tone={exact ? 'green' : 'amber'} />
            </View>
            {!exact && <Button title="Turn on on-time reminders" variant="secondary" onPress={askExact} />}
          </>
        )}

        <Muted>
          {remindersScheduled === null ? 'Reminders not synced yet.' : `${remindersScheduled} reminder${remindersScheduled === 1 ? '' : 's'} scheduled on this phone.`}
        </Muted>
      </Card>

      <SectionLabel>Data</SectionLabel>
      <Card style={{ gap: 10 }}>
        <Muted>Last updated at {synced}. Your pass and schedule are saved on this phone and work offline.</Muted>
        <Button title="Refresh now" icon="refresh" variant="secondary" loading={refreshing} onPress={refresh} />
      </Card>

      <SectionLabel>Account</SectionLabel>
      <Card style={{ gap: 10 }}>
        <Muted>
          Logged in as {me?.athlete.name} (bib {me?.athlete.bibNumber ?? '—'})
        </Muted>
        <Button title="Log out" icon="logout" variant="danger" onPress={confirmLogout} />
      </Card>

      <Muted style={{ textAlign: 'center', fontSize: 12 }}>
        AURA Athletes v{Constants.expoConfig?.version} · Dr. ACS College of Engineering, Bengaluru
      </Muted>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 16, fontWeight: '900', color: colors.navy },
});
