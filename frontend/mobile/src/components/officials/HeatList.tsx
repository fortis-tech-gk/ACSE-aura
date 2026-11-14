import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useOfficialSession } from '@/lib/officials/session';
import { useCachedFetch } from '@/lib/useCachedFetch';
import { HEAT_STATUS, heatTitle, whenLine } from '@/lib/officials/heats';
import { useOfficialsLayout } from '@/lib/officials/layout';
import { dayKey, fmtDay } from '@/lib/format';
import type { HeatSummary } from '@/lib/officials/types';
import { Button, Card, Icon, Muted, OfflineBanner, Pill, SectionLabel, colors, shadow, type IconName } from '@/components/ui';
import { entryName, type EntryPerson } from './entry';

const KIND_ICON: Record<HeatSummary['kind'], IconName> = { track: 'run', relay: 'relay', field: 'disc', vertical: 'height' };

const DONE = ['COMPLETED', 'OFFICIAL'];

/** Open one heat / flight screen */
export function openHeat(h: Pick<HeatSummary, 'id' | 'kind' | 'startAt' | 'eventName' | 'stage' | 'heatNumber'>, mode: 'callroom' | 'referee', replace = false) {
  const href = { pathname: '/officials/heat/[id]', params: { id: h.id, mode, kind: h.kind, startAt: h.startAt || '', title: heatTitle(h) } } as unknown as Href;
  if (replace) router.replace(href);
  else router.push(href);
}

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
  // The next heat to work on: earliest by start time that is drawn and not finished.
  // `finished` = the heat just finalized (the saved list may not know yet)
  const { finished } = useLocalSearchParams<{ finished?: string }>();
  const next = useMemo(() => heats.find((h) => h.id !== finished && !DONE.includes(h.status) && h.entries > 0) || null, [heats, finished]);

  const today = dayKey(new Date().toISOString());

  const days = useMemo(() => {
    const set = new Set(heats.map((h) => dayKey(h.startAt)));
    return [...set].sort((a, b) => (a === 'tba' ? 1 : b === 'tba' ? -1 : a.localeCompare(b)));
  }, [heats]);
  const [day, setDay] = useState<string | null>(null);
  const activeDay = day ?? (days.includes(today) ? today : days.find((d) => d !== 'tba') ?? days[0] ?? null);
  const [showDone, setShowDone] = useState(false);

  const list = heats.filter(
    (h) => dayKey(h.startAt) === activeDay && (showDone || (!['COMPLETED', 'OFFICIAL'].includes(h.status) && h.id !== finished))
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

      {mode === 'referee' && next && <NextHeatBrief heat={next} />}
      {mode === 'referee' && data && !next && heats.length > 0 && (
        <Card style={{ backgroundColor: colors.greenSoft, borderColor: colors.greenSoft }}>
          <Text style={{ color: colors.green, fontWeight: '800' }}>All your heats are finalized. New rounds appear here as soon as they are drawn.</Text>
        </Card>
      )}

      {!data && (
        <Card>
          <Muted>{error || (loading ? 'Loading heats…' : 'Pull down to load the heats.')}</Muted>
        </Card>
      )}

      {data && list.length > 0 && <SectionLabel>{mode === 'referee' ? 'Heats & flights' : 'Call room'}</SectionLabel>}

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
              onPress={() => openHeat(h, mode)}
              accessibilityRole="button"
              style={({ pressed }) => [s.heat, wide && s.heatWide, pressed && { opacity: 0.8 }]}
            >
              <View style={s.iconTile}>
                <Icon name={KIND_ICON[h.kind]} size={22} color={colors.navy} />
              </View>
              <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={2}>{heatTitle(h)}</Text>
                <Muted style={{ fontSize: 13 }}>{whenLine(h)}</Muted>
                <View style={s.row}>
                  <Pill label={st.label} tone={st.tone} />
                  {mode === 'callroom' && <Pill label={`${h.reported}/${h.entries} reported`} tone={h.entries && h.reported === h.entries ? 'green' : 'grey'} />}
                  {mode === 'referee' && <Pill label={`${h.entries} ${h.kind === 'relay' ? 'teams' : 'athletes'}`} tone="grey" />}
                </View>
              </View>
              <Icon name="chevron" size={22} color={colors.muted} />
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

type BriefEntry = EntryPerson & { id: string; lane_number: number; call_room_reported?: boolean };

/**
 * The referee's next heat at a glance — event, round, times and the start list — with one
 * button to open its score sheet. Also saves the heat on the phone for offline use.
 */
function NextHeatBrief({ heat }: { heat: HeatSummary }) {
  const { token } = useOfficialSession();
  const path = heat.kind === 'field' || heat.kind === 'vertical' ? `/field/heats/${heat.id}` : `/track/heats/${heat.id}`;
  const { data } = useCachedFetch<{ athletes: BriefEntry[] }>(`@aura/off-heat:${path}`, path, { token, enabled: !!token });
  const entries = [...(data?.athletes || [])].sort((a, b) => a.lane_number - b.lane_number);
  const st = HEAT_STATUS[heat.status] || HEAT_STATUS.SCHEDULED;
  const order = heat.kind === 'field' || heat.kind === 'vertical' ? 'Order' : 'Lane';
  return (
    <View style={s.next}>
      <View style={s.nextTop}>
        <Text style={s.nextLabel}>NEXT HEAT</Text>
        <Pill label={st.label} tone={st.tone} />
      </View>
      <Text style={s.nextTitle} numberOfLines={2}>{heatTitle(heat)}</Text>
      <Text style={s.nextWhen}>{whenLine(heat)}</Text>
      <Text style={s.nextWhen}>
        {heat.entries} {heat.kind === 'relay' ? 'teams' : 'athletes'} · {heat.reported} reported to the call room
      </Text>
      {entries.length > 0 && (
        <View style={s.startList}>
          <View style={[s.slRow, s.slHead]}>
            <Text style={[s.slLane, s.slHeadText]}>{order}</Text>
            <Text style={[s.slBib, s.slHeadText]}>Bib</Text>
            <Text style={[s.slName, s.slHeadText]}>Name</Text>
            <Text style={[s.slCol, s.slHeadText]}>College</Text>
          </View>
          {entries.map((e) => (
            <View key={e.id} style={s.slRow}>
              <Text style={s.slLane}>{e.lane_number}</Text>
              <Text style={s.slBib}>{e.profiles?.bid_number ?? ''}</Text>
              <Text style={s.slName} numberOfLines={1}>{entryName(e)}</Text>
              <Text style={s.slCol}>{e.profiles?.squads?.colleges?.code || e.relay_teams?.squads?.colleges?.code || ''}</Text>
            </View>
          ))}
        </View>
      )}
      <Button title="Go to next heat" iconRight="chevron" variant="gold" onPress={() => openHeat(heat, 'referee')} style={{ marginTop: 4 }} />
    </View>
  );
}

const s = StyleSheet.create({
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  day: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border },
  dayActive: { borderColor: colors.navy, backgroundColor: colors.navy },
  dayText: { fontSize: 13, fontWeight: '800', color: colors.muted },
  dayTextActive: { color: colors.goldBright },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  heat: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 14, ...shadow },
  heatWide: { flexBasis: '48%', flexGrow: 1 },
  iconTile: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  toggle: { color: colors.blue, fontWeight: '700', textAlign: 'center' },
  next: { backgroundColor: colors.navy, borderRadius: 20, padding: 18, gap: 6, borderWidth: 1, borderColor: 'rgba(233,199,104,0.35)', ...shadow },
  nextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextLabel: { color: colors.goldBright, fontWeight: '900', letterSpacing: 2.4, fontSize: 12 },
  nextTitle: { color: '#fff', fontSize: 23, fontWeight: '900' },
  nextWhen: { color: colors.onNavyMuted, fontSize: 14 },
  startList: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', marginVertical: 6 },
  slRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  slHead: { backgroundColor: colors.goldSoft },
  slHeadText: { fontSize: 11, fontWeight: '900', color: colors.goldDeep, textTransform: 'uppercase' },
  slLane: { width: 44, fontSize: 15, fontWeight: '900', color: colors.navy, textAlign: 'center' },
  slBib: { width: 50, fontSize: 14, fontWeight: '700', color: colors.text, textAlign: 'center' },
  slName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: colors.text },
  slCol: { width: 64, fontSize: 13, fontWeight: '800', color: colors.muted, textAlign: 'center' },
});
