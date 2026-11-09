import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAthleteSession } from '@/lib/athlete-session';
import { useCachedFetch } from '@/lib/useCachedFetch';
import { fmtDay, fmtMark, medal, ordinal, stageLabel } from '@/lib/format';
import type { AthletePerformance, PerformanceResult } from '@/lib/types';
import { Card, Muted, OfflineBanner, Pill, Screen, Title, colors } from '@/components/ui';

const STATUS_LABEL: Record<string, string> = { DNF: 'Did not finish', DQ: 'Disqualified', DNS: 'Did not start', NM: 'No mark' };

function resultLine(r: PerformanceResult): { main: string; tone: 'green' | 'red' | 'grey' | 'blue' } {
  if (r.status) return { main: STATUS_LABEL[r.status] || r.status, tone: 'red' };
  if (r.value != null) return { main: fmtMark(r.value, r.unit), tone: 'green' };
  if (r.heatStatus === 'COMPLETED' || r.heatStatus === 'OFFICIAL') return { main: 'Result awaited', tone: 'grey' };
  return { main: 'Not yet competed', tone: 'blue' };
}

function Attempts({ r }: { r: PerformanceResult }) {
  if (!r.attempts.length) return null;
  if (r.category === 'field_vertical_jump') {
    // Group by bar height: "1.70  XO"
    const byHeight = new Map<number, string>();
    for (const a of r.attempts) byHeight.set(a.height!, (byHeight.get(a.height!) || '') + (a.result === '-' ? '–' : a.result));
    return (
      <View style={s.attemptRow}>
        {[...byHeight.entries()].map(([h, seq]) => (
          <View key={h} style={s.attempt}>
            <Text style={s.attemptTop}>{h.toFixed(2)}</Text>
            <Text style={[s.attemptVal, { color: seq.includes('O') ? colors.green : colors.red }]}>{seq}</Text>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={s.attemptRow}>
      {r.attempts.map((a) => (
        <View key={a.round} style={s.attempt}>
          <Text style={s.attemptTop}>R{a.round}</Text>
          <Text style={[s.attemptVal, { color: a.type === 'VALID' ? colors.text : colors.red }]}>
            {a.type === 'VALID' ? a.mark?.toFixed(2) : a.type === 'FOUL' ? 'X' : '–'}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function PerformanceScreen() {
  const { token } = useAthleteSession();
  const { data, loading, offline, savedAt, error, reload } = useCachedFetch<AthletePerformance>('@aura/performance', '/athlete/performance', {
    token,
    enabled: !!token,
    pollMs: 60_000,
  });

  const sum = data?.summary;
  const cs = data?.collegeStanding;

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} />
      <Title>My Performance</Title>

      {!data && (
        <Card>
          <Muted>{error || (loading ? 'Loading your results…' : 'Pull down to load your results.')}</Muted>
        </Card>
      )}

      {data && sum && (
        <Card style={s.summary}>
          <View style={s.medals}>
            <MedalCount glyph="🥇" n={sum.golds} />
            <MedalCount glyph="🥈" n={sum.silvers} />
            <MedalCount glyph="🥉" n={sum.bronzes} />
          </View>
          <View style={s.statsRow}>
            <Stat label="My points" value={String(sum.individualPoints)} />
            <Stat label="College" value={cs?.overallRank ? `#${cs.overallRank}` : '—'} />
            <Stat label="Division" value={cs?.divisionRank ? `#${cs.divisionRank}` : '—'} />
          </View>
          <Muted style={{ color: '#c7d2fe', fontSize: 12 }}>
            Points: 5 / 3 / 1 for individual 1st–3rd. Relay points count for your college only.
          </Muted>
        </Card>
      )}

      {data && data.official.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={s.cardTitle}>Official placings</Text>
          {data.official.map((o) => (
            <View key={`${o.eventId}-${o.place}`} style={s.officialRow}>
              <Text style={s.officialPlace}>{medal(o.place) || ordinal(o.place)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.officialEvent}>{o.eventName}</Text>
                <Muted style={{ fontSize: 12 }}>
                  {ordinal(o.place)} place{o.isRelay ? ' · relay (college points)' : ''}
                </Muted>
              </View>
              <Text style={s.officialPts}>{o.isMixed ? '—' : `${o.points} pts`}</Text>
            </View>
          ))}
        </Card>
      )}

      {data && (
        <>
          <Text style={s.section}>Rounds</Text>
          {data.results.length === 0 && (
            <Card>
              <Muted>No heats yet. Your results will appear here as soon as the officials record them.</Muted>
            </Card>
          )}
          {data.results.map((r) => {
            const line = resultLine(r);
            const detail = [stageLabel(r.stage), r.heatNumber ? `Heat ${r.heatNumber}` : '', r.lane ? `Lane ${r.lane}` : '', r.relayLeg ? `Leg ${r.relayLeg}` : '']
              .filter(Boolean)
              .join(' · ');
            return (
              <Card key={r.key} style={{ gap: 8 }}>
                <View style={s.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.event}>{r.eventName}</Text>
                    <Muted style={{ fontSize: 13 }}>
                      {detail}
                      {r.startAt ? ` · ${fmtDay(r.startAt)}` : ''}
                    </Muted>
                  </View>
                  {r.placeInHeat != null && (
                    <View style={s.placeBadge}>
                      <Text style={s.placeText}>{medal(r.placeInHeat) || ordinal(r.placeInHeat)}</Text>
                      <Text style={s.placeSub}>in heat</Text>
                    </View>
                  )}
                </View>
                <View style={s.resultRow}>
                  <Text style={[s.result, { color: line.tone === 'green' ? colors.text : line.tone === 'red' ? colors.red : colors.muted }]}>{line.main}</Text>
                  {r.status === 'DQ' && !!r.dqRule && <Pill label={r.dqRule} tone="red" />}
                </View>
                <View style={s.metaRow}>
                  {r.reactionMs != null && <Pill label={`Reaction ${(r.reactionMs / 1000).toFixed(3)} s`} tone="grey" />}
                  {r.wind != null && <Pill label={`Wind ${r.wind > 0 ? '+' : ''}${r.wind.toFixed(1)} m/s`} tone="grey" />}
                  {r.placeInHeat != null && <Pill label={`${r.finishers} with a result`} tone="grey" />}
                </View>
                <Attempts r={r} />
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

function MedalCount({ glyph, n }: { glyph: string; n: number }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 30 }}>{glyph}</Text>
      <Text style={s.medalN}>{n}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  summary: { backgroundColor: colors.navy, borderColor: colors.navy, gap: 14 },
  medals: { flexDirection: 'row' },
  medalN: { color: '#fff', fontSize: 22, fontWeight: '900' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '900' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  officialRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  officialPlace: { fontSize: 24, width: 40, textAlign: 'center', fontWeight: '800', color: colors.navy },
  officialEvent: { fontSize: 15, fontWeight: '800', color: colors.text },
  officialPts: { fontSize: 15, fontWeight: '800', color: colors.blue },
  section: { fontSize: 15, fontWeight: '800', color: colors.navy, marginTop: 4 },
  rowTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  event: { fontSize: 18, fontWeight: '800', color: colors.text },
  placeBadge: { alignItems: 'center', backgroundColor: colors.blueSoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, minWidth: 58 },
  placeText: { fontSize: 18, fontWeight: '900', color: colors.blue },
  placeSub: { fontSize: 10, fontWeight: '700', color: colors.blue },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  result: { fontSize: 28, fontWeight: '900' },
  metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  attemptRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  attempt: { flexGrow: 1, flexBasis: 40, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 4, paddingVertical: 4, alignItems: 'center' },
  attemptTop: { fontSize: 10, fontWeight: '800', color: colors.muted },
  attemptVal: { fontSize: 14, fontWeight: '800' },
});
