import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAthleteSession } from '@/lib/athlete-session';
import { dayKey, fmtDay, fmtTime, kindLabel, stageLabel } from '@/lib/format';
import { isRemindable } from '@/lib/reminders';
import { REMINDER_OFFSETS_MIN } from '@/lib/config';
import type { ScheduleEntry } from '@/lib/types';
import { AppHeader, Card, Icon, Muted, OfflineBanner, Pill, Screen, SectionLabel, colors } from '@/components/ui';

function statusPill(e: ScheduleEntry) {
  if (e.reported) return <Pill label="Reported" icon="check" tone="green" />;
  switch (e.status) {
    case 'CALL_ROOM':
    case 'CALL_ROOM_OPEN':
      return <Pill label="Call room OPEN" tone="red" />;
    case 'ON_TRACK':
    case 'IN_PROGRESS':
      return <Pill label="In progress" tone="amber" />;
    case 'COMPLETED':
    case 'OFFICIAL':
      return <Pill label="Completed" tone="grey" />;
    case 'DELAYED':
      return <Pill label="Delayed" tone="amber" />;
    default:
      return <Pill label="Scheduled" tone="blue" />;
  }
}

export default function EventsScreen() {
  const { me, refreshing, refresh, offline, lastSyncedAt } = useAthleteSession();
  const schedule = me?.schedule || [];

  const groups: { key: string; label: string; items: ScheduleEntry[] }[] = [];
  for (const e of schedule) {
    const k = dayKey(e.startAt || e.callRoomAt);
    let g = groups.find((x) => x.key === k);
    if (!g) {
      g = { key: k, label: k === 'tba' ? 'Time to be announced' : fmtDay(e.startAt || e.callRoomAt), items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={refresh}
      header={<AppHeader eyebrow="AURA Athletes" title="My Events" subtitle={`Reminders ${REMINDER_OFFSETS_MIN.join(', ')} min before each call room`} />}
    >
      <OfflineBanner offline={offline} lastSyncedAt={lastSyncedAt} />

      {schedule.length === 0 && (
        <Card>
          <Muted>No events found for you yet. If this looks wrong, contact your college PED.</Muted>
        </Card>
      )}

      {groups.map((g) => (
        <View key={g.key} style={{ gap: 10 }}>
          <SectionLabel>{g.label}</SectionLabel>
          {g.items.map((e) => {
            const tag = e.isRelayReserve ? 'Relay reserve' : kindLabel(e.kind);
            const detail = [stageLabel(e.stage), e.heatNumber ? `Heat ${e.heatNumber}` : '', e.lane ? `Lane ${e.lane}` : '', e.relayLeg ? `Leg ${e.relayLeg}` : '']
              .filter(Boolean)
              .join(' · ');
            return (
              <Card key={e.key} style={{ gap: 8 }}>
                <View style={s.rowTop}>
                  <Text style={s.event}>{e.eventName}</Text>
                  {statusPill(e)}
                </View>
                {!!tag && <Pill label={tag} tone="gold" />}
                <Muted>
                  {detail || stageLabel(e.stage) || 'Event'}
                  {!e.heatNumber && !e.lane ? ' · Heat & lane to be announced' : ''}
                </Muted>
                <View style={s.times}>
                  <View style={[s.timeBox, s.timeBoxNavy]}>
                    <Text style={[s.timeLabel, { color: colors.onNavyMuted }]}>CALL ROOM</Text>
                    <Text style={[s.timeValue, { color: colors.goldBright }]}>
                      {fmtTime(e.callRoomAt)}
                      {e.callRoomEstimated ? '*' : ''}
                    </Text>
                  </View>
                  <View style={s.timeBox}>
                    <Text style={s.timeLabel}>START</Text>
                    <Text style={s.timeValue}>{fmtTime(e.startAt)}</Text>
                  </View>
                </View>
                {e.callRoomEstimated && <Muted style={{ fontSize: 12 }}>* Approximate — report 30 minutes before the start.</Muted>}
                {isRemindable(e) ? (
                  <View style={s.reminderRow}>
                    <Icon name="bell" size={15} color={colors.green} />
                    <Text style={s.reminder}>Reminders set</Text>
                  </View>
                ) : e.kind === 'reserve' || e.isRelayReserve ? (
                  <Muted style={{ fontSize: 12 }}>No reminders for reserve entries — your team manager will call you if needed.</Muted>
                ) : null}
              </Card>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  event: { fontSize: 18, fontWeight: '900', color: colors.navy, flex: 1 },
  times: { flexDirection: 'row', gap: 10 },
  timeBox: { flex: 1, backgroundColor: '#fbf8f1', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: colors.border },
  timeBoxNavy: { backgroundColor: colors.navy, borderColor: colors.navy },
  timeLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 1 },
  timeValue: { fontSize: 21, fontWeight: '900', color: colors.navy },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reminder: { color: colors.green, fontWeight: '800', fontSize: 13 },
});
