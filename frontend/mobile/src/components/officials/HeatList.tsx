import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useOfficialSession } from '@/lib/officials/session';
import { useCachedFetch } from '@/lib/useCachedFetch';
import { HEAT_STATUS, heatTitle, whenLine } from '@/lib/officials/heats';
import { useOfficialsLayout } from '@/lib/officials/layout';
import { dayKey, fmtDay } from '@/lib/format';
import type { HeatSummary } from '@/lib/officials/types';
import { Card, Muted, OfflineBanner, Pill, colors } from '@/components/ui';

const KIND_ICON: Record<HeatSummary['kind'], string> = { track: '🏃', relay: '🔁', field: '🥏', vertical: '🪜' };

/** Heats / flights to pick from — call room officials and referees */
export function HeatList({ mode }: { mode: 'callroom' | 'referee' }) {
  const { token } = useOfficialSession();
  const { wide } = useOfficialsLayout();
  const { data, loading, offline, savedAt, error, reload } = useCachedFetch<{ heats: HeatSummary[] }>('@aura/off-heats', '/officials/heats', {
    token,
    enabled: !!token,
    pollMs: 30_000,
  });
  const heats = useMemo(() => data?.heats || [], [data]);
  const today = dayKey(new Date().toISOString());

  const days = useMemo(() => {
    const set = new Set(heats.map((h) => dayKey(h.startAt)));
    return [...set].sort((a, b) => (a === 'tba' ? 1 : b === 'tba' ? -1 : a.localeCompare(b)));
  }, [heats]);
  const [day, setDay] = useState<string | null>(null);
  const activeDay = day ?? (days.includes(today) ? today : days.find((d) => d !== 'tba') ?? days[0] ?? null);
  const [showDone, setShowDone] = useState(false);

  const list = heats.filter(
    (h) => dayKey(h.startAt) === activeDay && (showDone || !['COMPLETED', 'OFFICIAL'].includes(h.status))
  );
  const doneCount = heats.filter((h) => dayKey(h.startAt) === activeDay && ['COMPLETED', 'OFFICIAL'].includes(h.status)).length;

  return (
    <View style={{ gap: 12 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Entries are saved on this device and sent when the network is back." />

      {days.length > 1 && (
        <View style={s.days}>
          {days.map((d) => (
            <Pressable key={d} onPress={() => setDay(d)} accessibilityRole="tab" accessibilityState={{ selected: d === activeDay }} style={[s.day, d === activeDay && s.dayActive]}>
              <Text style={[s.dayText, d === activeDay && s.dayTextActive]}>{d === 'tba' ? 'No time yet' : `${fmtDay(`${d}T06:00:00Z`)}${d === today ? ' · Today' : ''}`}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {!data && (
        <Card>
          <Muted>{error || (loading ? 'Loading heats…' : 'Pull down to load the heats.')}</Muted>
        </Card>
      )}

      {data && list.length === 0 && (
        <Card style={{ gap: 6 }}>
          <Text style={s.cardTitle}>{heats.length ? 'Nothing left on this day' : 'No heats yet'}</Text>
          <Muted>
            {heats.length
              ? 'Every heat on this day has its results.'
              : 'Heats appear here once the meet office has made the heat draw for an event.'}
          </Muted>
        </Card>
      )}

      <View style={wide ? s.grid : { gap: 10 }}>
        {list.map((h) => {
          const st = HEAT_STATUS[h.status] || HEAT_STATUS.SCHEDULED;
          return (
            <Pressable
              key={h.id}
              onPress={() => router.push({ pathname: '/officials/heat/[id]', params: { id: h.id, mode, kind: h.kind, startAt: h.startAt || '' } } as unknown as Href)}
              accessibilityRole="button"
              style={({ pressed }) => [s.heat, wide && s.heatWide, pressed && { opacity: 0.8 }]}
            >
              <Text style={s.icon}>{KIND_ICON[h.kind]}</Text>
              <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={2}>{heatTitle(h)}</Text>
                <Muted style={{ fontSize: 13 }}>{whenLine(h)}</Muted>
                <View style={s.row}>
                  <Pill label={st.label} tone={st.tone} />
                  {mode === 'callroom' && <Pill label={`${h.reported}/${h.entries} reported`} tone={h.entries && h.reported === h.entries ? 'green' : 'grey'} />}
                  {mode === 'referee' && <Pill label={`${h.entries} ${h.kind === 'relay' ? 'teams' : 'athletes'}`} tone="grey" />}
                </View>
              </View>
              <Text style={s.chev}>›</Text>
            </Pressable>
          );
        })}
      </View>

      {doneCount > 0 && (
        <Pressable onPress={() => setShowDone((v) => !v)} accessibilityRole="button">
          <Text style={s.toggle}>{showDone ? 'Hide finished heats' : `Show ${doneCount} finished heat${doneCount === 1 ? '' : 's'}`}</Text>
        </Pressable>
      )}
      <Pressable onPress={reload} accessibilityRole="button">
        <Muted style={{ textAlign: 'center', fontSize: 12 }}>{loading ? 'Refreshing…' : 'Tap to refresh · updates every 30 s'}</Muted>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  day: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 2, borderColor: colors.border },
  dayActive: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  dayText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  dayTextActive: { color: colors.blue },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  heat: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  heatWide: { flexBasis: '48%', flexGrow: 1 },
  icon: { fontSize: 28 },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chev: { fontSize: 28, color: colors.muted },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  toggle: { color: colors.blue, fontWeight: '700', textAlign: 'center' },
});
