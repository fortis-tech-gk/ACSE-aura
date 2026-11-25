import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAthleteSession } from '@/lib/athlete-session';
import { useCachedFetch } from '@/lib/useCachedFetch';
import { fmtDay, fmtMark, medal, ordinal, stageLabel } from '@/lib/format';
import type { AthletePerformance, PerformanceResult } from '@/lib/types';
import { AppHeader, Card, Muted, OfflineBanner, Pill, Screen, SectionLabel, Stat, colors, fonts } from '@/components/ui';

const STATUS_LABEL: Record<string, string> = { DNF: 'Did not finish', DQ: 'Disqualified', DNS: 'Did not start', NM: 'No mark', NC: 'Not classified' };

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

/** Decathlon / heptathlon: mark and points for each discipline, grouped by day */
function Disciplines({ r }: { r: PerformanceResult }) {
  if (!r.combined?.length) return null;
  const days = [...new Set(r.combined.map((d) => d.day))];
  return (
    <View style={{ gap: 6 }}>
      {days.map((day) => (
        <View key={day} style={{ gap: 2 }}>
          <Text style={s.attemptTop}>DAY {day}</Text>
          {r.combined!.filter((d) => d.day === day).map((d) => (
            <View key={d.code} style={s.discRow}>
              <Text style={s.discName}>{d.name}</Text>
              <Text style={s.discMark}>
                {d.status == null ? '—' : d.status === 'FINISHED' && d.mark != null ? (d.kind === 'track' ? fmtMark(d.mark, 'seconds') : `${d.mark.toFixed(2)} m`) : d.status}
              </Text>
              <Text style={s.discPts}>{d.points != null ? `${d.points} pts` : ''}</Text>
            </View>
          ))}
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
    <Screen refreshing={loading} onRefresh={reload} header={<AppHeader eyebrow="AURA Athletes" title="My Results" subtitle="Your rounds, marks, medals and points" />}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} />

      {!data && (
        <Card>
          <Muted>{error || (loading ? 'Loading your results…' : 'Pull down to load your results.')}</Muted>
        </Card>
      )}

      {data && sum && (
        <Card style={s.summary}>
          <View style={s.medals}>
            <MedalCount label="Gold" color="#d9b24c" n={sum.golds} />
            <MedalCount label="Silver" color="#c3c8d2" n={sum.silvers} />
            <MedalCount label="Bronze" color="#c4844f" n={sum.bronzes} />
          </View>
          <View style={s.statsRow}>
            <Stat tone="navy" label="WA score" value={sum.waPoints != null ? String(sum.waPoints) : '—'} />
            <Stat tone="navy" label="College" value={cs?.overallRank ? `#${cs.overallRank}` : '—'} />
            <Stat tone="navy" label="Division" value={cs?.divisionRank ? `#${cs.divisionRank}` : '—'} />
          </View>
          <Muted style={{ color: colors.onNavyMuted, fontSize: 12 }}>
            {sum.bestAthleteRank ? `Best Athlete ranking: #${sum.bestAthleteRank}${sum.bestAthleteEvent ? ` (${sum.bestAthleteEvent})` : ''}. ` : ''}
            WA score = World Athletics points of your best final. Your college scores 5 / 3 / 1 for an individual 1st–3rd, 10 / 6 / 2 for combined events and relays.
          </Muted>
        </Card>
      )}

      {data && data.official.length > 0 && (
        <Card style={{ gap: 10 }}>
          <SectionLabel>Official placings</SectionLabel>
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
          <SectionLabel>Rounds</SectionLabel>
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
                  <Text style={[s.result, line.tone !== 'green' && s.resultSoft, { color: line.tone === 'green' ? colors.navy : line.tone === 'red' ? colors.red : colors.muted }]}>{line.main}</Text>
                  {r.status === 'DQ' && !!r.dqRule && <Pill label={r.dqRule} tone="red" />}
                </View>
                <View style={s.metaRow}>
                  {r.reactionMs != null && <Pill label={`Reaction ${(r.reactionMs / 1000).toFixed(3)} s`} tone="grey" />}
                  {r.placeInHeat != null && <Pill label={`${r.finishers} with a result`} tone="grey" />}
                </View>
                <Attempts r={r} />
                <Disciplines r={r} />
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

function MedalCount({ label, color, n }: { label: string; color: string; n: number }) {
  return (
    <View style={{ alignItems: 'center', flex: 1, gap: 4 }}>
      <View style={[s.disc, { backgroundColor: color }]}>
        <Text style={s.discN}>{n}</Text>
      </View>
      <Text style={s.discL}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  discRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discName: { flex: 1, fontSize: 14, color: colors.text },
  discMark: { width: 90, textAlign: 'right', fontSize: 14, fontWeight: '700', color: colors.text },
  discPts: { width: 70, textAlign: 'right', fontSize: 14, fontWeight: '800', color: colors.blue },
  summary: { backgroundColor: colors.navy, borderColor: 'rgba(233,199,104,0.4)', gap: 16 },
  medals: { flexDirection: 'row' },
  disc: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)' },
  discN: { color: colors.navy, fontFamily: fonts.display, fontSize: 24 },
  discL: { color: colors.onNavyMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', gap: 10 },
  officialRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  officialPlace: { fontSize: 24, width: 40, textAlign: 'center', fontWeight: '800', color: colors.navy },
  officialEvent: { fontSize: 15, fontWeight: '800', color: colors.text },
  officialPts: { fontSize: 15, fontWeight: '900', color: colors.goldDeep },
  rowTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  event: { fontSize: 18, fontWeight: '900', color: colors.navy },
  placeBadge: { alignItems: 'center', backgroundColor: colors.navy, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, minWidth: 60 },
  placeText: { fontSize: 18, fontWeight: '900', color: colors.goldBright },
  placeSub: { fontSize: 10, fontWeight: '800', color: colors.onNavyMuted },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  result: { fontSize: 30, fontWeight: '900' },
  resultSoft: { fontSize: 17, fontWeight: '800' },
  metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  attemptRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  attempt: { flexGrow: 1, flexBasis: 40, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 5, alignItems: 'center', backgroundColor: '#fbf8f1' },
  attemptTop: { fontSize: 10, fontWeight: '800', color: colors.muted },
  attemptVal: { fontSize: 14, fontWeight: '800' },
});
