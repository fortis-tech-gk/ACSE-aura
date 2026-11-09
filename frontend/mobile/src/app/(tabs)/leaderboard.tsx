import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAthleteSession } from '@/lib/athlete-session';
import { useCachedFetch } from '@/lib/useCachedFetch';
import type { BestAthleteRow, LiveLeaderboard, StandingRow } from '@/lib/types';
import { Card, Muted, OfflineBanner, Screen, Title, colors } from '@/components/ui';

type View_ = 'overall' | 'men' | 'women' | 'athletes';
const TABS: { key: View_; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'men', label: 'Men' },
  { key: 'women', label: 'Women' },
  { key: 'athletes', label: 'Athletes' },
];

const pts = (v: number | string) => {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

export default function LeaderboardScreen() {
  const { me } = useAthleteSession();
  const [view, setView] = useState<View_>('overall');
  const { data, loading, offline, savedAt, error, reload } = useCachedFetch<LiveLeaderboard>('@aura/leaderboard', '/live/leaderboard', {
    pollMs: 30_000,
  });
  const myCollegeId = me?.athlete.college?.id;
  const st = useMemo(() => data?.standings || {}, [data]);

  const rows: StandingRow[] = useMemo(() => {
    const list = view === 'overall' ? st.combined : view === 'men' ? st.mens : view === 'women' ? st.womens : [];
    return list || [];
  }, [st, view]);

  const athletes: { title: string; list: BestAthleteRow[] }[] = useMemo(
    () => [
      { title: 'Best Male Athlete', list: st.best_male_athletes || [] },
      { title: 'Best Female Athlete', list: st.best_female_athletes || [] },
    ],
    [st]
  );

  // Show the top 25, plus my college if it is further down
  const scored = rows.filter((r) => Number(r.total_points) > 0);
  const top = scored.slice(0, 25);
  const mine = rows.find((r) => r.college_id === myCollegeId);
  const showMineBelow = mine && !top.some((r) => r.college_id === myCollegeId);
  const updated = savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} />
      <View style={s.header}>
        <Title>Leaderboard</Title>
        <View style={s.live}>
          <View style={[s.dot, { backgroundColor: offline ? colors.amber : colors.green }]} />
          <Text style={s.liveText}>{offline ? 'Offline' : 'Live'}</Text>
        </View>
      </View>
      <Muted>Championship points · updates every 30 s{updated ? ` · last ${updated}` : ''}</Muted>

      <View style={s.segment} accessibilityRole="tablist">
        {TABS.map((t) => {
          const active = view === t.key;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setView(t.key)}
              style={[s.segBtn, active && s.segActive]}
            >
              <Text style={[s.segText, active && s.segTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {!data && (
        <Card>
          <Muted>{error || (loading ? 'Loading standings…' : 'Pull down to load the leaderboard.')}</Muted>
        </Card>
      )}

      {data && view !== 'athletes' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={[s.row, s.headRow]}>
            <Text style={[s.rank, s.headText]}>#</Text>
            <Text style={[s.name, s.headText]}>College</Text>
            <Text style={[s.medalCol, s.headText]}>🥇</Text>
            <Text style={[s.medalCol, s.headText]}>🥈</Text>
            <Text style={[s.medalCol, s.headText]}>🥉</Text>
            <Text style={[s.pts, s.headText]}>Pts</Text>
          </View>
          {top.length === 0 && (
            <View style={{ padding: 16 }}>
              <Muted>No points scored yet. Standings appear once the first finals are official.</Muted>
            </View>
          )}
          {top.map((r) => (
            <CollegeRow key={r.college_id} r={r} mine={r.college_id === myCollegeId} />
          ))}
          {showMineBelow && mine && (
            <>
              <View style={s.gap}>
                <Text style={s.gapText}>⋯</Text>
              </View>
              <CollegeRow r={mine} mine />
            </>
          )}
        </Card>
      )}

      {data && view === 'athletes' &&
        athletes.map((group) => (
          <Card key={group.title} style={{ gap: 8 }}>
            <Text style={s.groupTitle}>{group.title}</Text>
            {group.list.length === 0 && <Muted>No individual points yet.</Muted>}
            {group.list.slice(0, 10).map((a) => {
              const isMe = a.profile_id === me?.athlete.id;
              return (
                <View key={a.profile_id} style={[s.athRow, isMe && s.mineRow]}>
                  <Text style={s.athRank}>{a.rank}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.athName} numberOfLines={1}>
                      {a.athlete_name}
                      {isMe ? '  (you)' : ''}
                    </Text>
                    <Muted style={{ fontSize: 12 }} >
                      {a.college_code}
                      {a.bid_number ? ` · Bib ${a.bid_number}` : ''} · 🥇{a.golds} 🥈{a.silvers} 🥉{a.bronzes}
                    </Muted>
                  </View>
                  <Text style={s.athPts}>{pts(a.total_points)}</Text>
                </View>
              );
            })}
          </Card>
        ))}

      {data && view !== 'athletes' && (
        <Muted style={{ fontSize: 12 }}>
          {view === 'overall'
            ? 'Overall includes individual and relay points (Mixed Relay does not score).'
            : `${view === 'men' ? "Men's" : "Women's"} team: individual events of the division only.`}
        </Muted>
      )}
    </Screen>
  );
}

function CollegeRow({ r, mine }: { r: StandingRow; mine: boolean }) {
  return (
    <View style={[s.row, mine && s.mineRow]}>
      <Text style={[s.rank, r.rank <= 3 && { color: colors.gold }]}>{r.rank}</Text>
      <View style={s.name}>
        <Text style={s.collegeCode} numberOfLines={1}>
          {r.college_code}
          {mine ? '  ★ you' : ''}
        </Text>
        <Text style={s.collegeName} numberOfLines={1}>{r.college_name}</Text>
      </View>
      <Text style={s.medalCol}>{r.golds}</Text>
      <Text style={s.medalCol}>{r.silvers}</Text>
      <Text style={s.medalCol}>{r.bronzes}</Text>
      <Text style={s.pts}>{pts(r.total_points)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 12, fontWeight: '800', color: colors.text },
  segment: { flexDirection: 'row', backgroundColor: '#e7ebf3', borderRadius: 12, padding: 4, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segActive: { backgroundColor: '#fff' },
  segText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  segTextActive: { color: colors.navy },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  headRow: { backgroundColor: '#f8fafc', borderTopWidth: 0 },
  headText: { fontSize: 11, fontWeight: '800', color: colors.muted },
  mineRow: { backgroundColor: '#fff7d6' },
  rank: { width: 26, fontSize: 15, fontWeight: '900', color: colors.navy, textAlign: 'center' },
  name: { flex: 1, minWidth: 0 },
  collegeCode: { fontSize: 15, fontWeight: '800', color: colors.text },
  collegeName: { fontSize: 11, color: colors.muted },
  medalCol: { width: 26, textAlign: 'center', fontSize: 13, fontWeight: '700', color: colors.text },
  pts: { width: 40, textAlign: 'right', fontSize: 16, fontWeight: '900', color: colors.blue },
  gap: { alignItems: 'center', paddingVertical: 2, borderTopWidth: 1, borderTopColor: colors.border },
  gapText: { color: colors.muted, fontWeight: '900' },
  groupTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  athRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderRadius: 10, paddingHorizontal: 4 },
  athRank: { width: 22, textAlign: 'center', fontSize: 15, fontWeight: '900', color: colors.navy },
  athName: { fontSize: 15, fontWeight: '800', color: colors.text },
  athPts: { fontSize: 16, fontWeight: '900', color: colors.blue },
});
