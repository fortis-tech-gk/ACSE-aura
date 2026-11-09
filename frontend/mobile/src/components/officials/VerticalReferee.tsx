import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { useOfficialsLayout } from '@/lib/officials/layout';
import { confirm, notify } from '@/lib/officials/confirm';
import { one, parseMetres } from '@/lib/officials/heats';
import { ordinal } from '@/lib/format';
import { HeatHeader } from './HeatHeader';
import { entryName, entrySub, type EntryPerson } from './entry';
import { Button, Card, Muted, OfflineBanner, colors } from '@/components/ui';

type Vert = { bar_height_meters: number; attempt_number: number; result: 'O' | 'X' | '-' };
type Entry = EntryPerson & {
  id: string;
  lane_number: number;
  call_room_inspections: { reported_status: string } | { reported_status: string }[] | null;
  vertical_jump_attempts: Vert[] | null;
};
type HeatData = {
  heat: { id: string; heat_number: number; stage: string; status: string; events: { id: string; name: string; code: string; category: string } };
  athletes: Entry[];
};

const h2 = (n: number) => Number(n).toFixed(2);

/** One athlete's jumps: by height, best cleared, failures, and whether they are out (3 failures in a row) */
function summarize(list: Vert[]) {
  const byH = new Map<string, Vert[]>();
  for (const a of [...list].sort((x, y) => x.bar_height_meters - y.bar_height_meters || x.attempt_number - y.attempt_number)) {
    const k = h2(a.bar_height_meters);
    byH.set(k, [...(byH.get(k) || []), a]);
  }
  let best: number | null = null;
  let failsAtBest = 0;
  let totalFails = 0;
  let failsUpToBest = 0;
  let consecutive = 0;
  for (const [k, arr] of byH) {
    const fails = arr.filter((a) => a.result === 'X').length;
    totalFails += fails;
    if (arr.some((a) => a.result === 'O')) {
      best = Number(k);
      failsAtBest = fails;
      failsUpToBest = totalFails;
    }
    for (const a of arr) {
      if (a.result === 'X') consecutive++;
      else if (a.result === 'O') consecutive = 0;
    }
  }
  return { byH, best, failsAtBest, failsUpToBest, totalFails, eliminated: consecutive >= 3 };
}

/** High jump and pole vault: O cleared, X failed, – passed; three failures in a row ends the competition */
export function VerticalReferee({ heatId }: { heatId: string }) {
  const { submitOp } = useOfficialSession();
  const { wide } = useOfficialsLayout();
  const { data, offline, savedAt, error, reload, pending } = useHeat<HeatData>(heatId, `/field/heats/${heatId}`, 20000);
  const [busy, setBusy] = useState(false);

  const entries = useMemo(() => data?.athletes || [], [data]);
  const out = useMemo(() => new Set(entries.filter((e) => ['DNS', 'SCRATCH'].includes(one(e.call_room_inspections)?.reported_status || '')).map((e) => e.id)), [entries]);

  const jumps = useMemo(() => {
    const m = new Map<string, Vert[]>();
    for (const e of entries) m.set(e.id, [...(e.vertical_jump_attempts || [])]);
    for (const op of pending) {
      if (op.path !== '/field/vertical-attempt') continue;
      const b = op.body as any;
      const arr = (m.get(b.heatAthleteId) || []).filter((a) => !(h2(a.bar_height_meters) === h2(b.barHeight) && a.attempt_number === b.attemptNumber));
      arr.push({ bar_height_meters: Number(b.barHeight), attempt_number: b.attemptNumber, result: b.result });
      m.set(b.heatAthleteId, arr);
    }
    return m;
  }, [entries, pending]);

  const summaries = useMemo(() => new Map(entries.map((e) => [e.id, summarize(jumps.get(e.id) || [])])), [entries, jumps]);

  const heights = useMemo(() => {
    const set = new Set<string>();
    for (const list of jumps.values()) for (const a of list) set.add(h2(a.bar_height_meters));
    return [...set].sort((a, b) => Number(a) - Number(b));
  }, [jumps]);

  const step = data?.heat.events.code.startsWith('PV') ? 0.1 : 0.05;
  const [bar, setBar] = useState('');
  useEffect(() => {
    if (!bar && heights.length) setBar(heights[heights.length - 1]);
  }, [heights, bar]);
  const barN = parseMetres(bar);

  // Rank: best height, then fewer failures at that height, then fewer failures overall
  const ranks = useMemo(() => {
    const rows = entries
      .filter((e) => !out.has(e.id))
      .map((e) => ({ id: e.id, s: summaries.get(e.id)! }))
      .filter((r) => r.s.best != null)
      .sort((a, b) => b.s.best! - a.s.best! || a.s.failsAtBest - b.s.failsAtBest || a.s.failsUpToBest - b.s.failsUpToBest);
    const m = new Map<string, number>();
    rows.forEach((r, i) => {
      const p = rows[i - 1];
      const tie = p && p.s.best === r.s.best && p.s.failsAtBest === r.s.failsAtBest && p.s.failsUpToBest === r.s.failsUpToBest;
      m.set(r.id, tie ? m.get(p.id)! : i + 1);
    });
    return m;
  }, [entries, out, summaries]);

  async function jump(e: Entry, result: 'O' | 'X' | '-') {
    if (barN == null) return notify('Set the bar', 'Type the bar height in metres first, like 1.65');
    const atBar = (jumps.get(e.id) || []).filter((a) => h2(a.bar_height_meters) === h2(barN));
    const attemptNumber = atBar.length + 1;
    if (attemptNumber > 3) return;
    const r = await submitOp({
      path: '/field/vertical-attempt',
      heatId,
      label: `${entryName(e)} ${h2(barN)} m: ${result === 'O' ? 'cleared' : result === 'X' ? 'failed' : 'passed'}`,
      body: { heatAthleteId: e.id, barHeight: barN, attemptNumber, result },
    });
    if (r.status === 'rejected') return notify('Not saved', r.message);
    if (r.status === 'ok') reload();
  }

  async function finalize() {
    if (!data) return;
    const final = data.heat.stage === 'FINAL';
    if (!(await confirm('Finalize results?', final ? 'This is the final: championship points are awarded now.' : 'The flight will be marked done.', 'Finalize'))) return;
    setBusy(true);
    const r = await submitOp({ path: '/field/finalize', heatId, label: 'Results finalized', body: { heatId, eventId: data.heat.events.id, stage: data.heat.stage } }, { queueable: false });
    setBusy(false);
    if (r.status === 'ok') {
      reload();
      notify('Results finalized', final ? 'Points have been added to the championship standings.' : 'The flight is marked done.');
    } else notify('Not finalized', (r as any).message || 'Try again.');
  }

  if (!data) {
    return (
      <Card>
        <Muted>{error || 'Loading the flight…'}</Muted>
      </Card>
    );
  }
  const done = ['COMPLETED', 'OFFICIAL'].includes(data.heat.status);

  const barCard = !done && (
    <Card style={{ gap: 10, borderColor: colors.blue, borderWidth: 2 }}>
      <Text style={s.label}>Bar height</Text>
      <View style={s.barRow}>
        <Button title={`−${step.toFixed(2)}`} variant="secondary" onPress={() => barN && setBar(h2(Math.max(0.5, barN - step)))} />
        <TextInput
          value={bar}
          onChangeText={(t) => setBar(t.replace(/[^0-9.,]/g, ''))}
          placeholder="1.60"
          placeholderTextColor="#94a3b8"
          keyboardType="decimal-pad"
          style={s.barInput}
          accessibilityLabel="Bar height in metres"
        />
        <Button title={`+${step.toFixed(2)}`} onPress={() => setBar(h2((barN ?? 1) + step))} />
      </View>
      {heights.length > 0 && <Muted style={{ fontSize: 12 }}>Heights so far: {heights.join(' · ')}</Muted>}
    </Card>
  );

  const list = (
    <View style={{ gap: 8 }}>
      {entries.map((e) => {
        const sm = summaries.get(e.id)!;
        const isOut = out.has(e.id);
        const atBar = barN != null ? sm.byH.get(h2(barN)) || [] : [];
        const clearedHere = atBar.some((a) => a.result === 'O');
        const passedHere = atBar.some((a) => a.result === '-');
        const canJump = !done && !isOut && !sm.eliminated && barN != null && !clearedHere && !passedHere && atBar.length < 3;
        const rank = ranks.get(e.id);
        return (
          <Card key={e.id} style={[{ gap: 8, padding: 12 }, (isOut || sm.eliminated) && { opacity: 0.6 }]}>
            <View style={s.top}>
              <Text style={s.order}>{e.lane_number}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{entryName(e)}</Text>
                <Muted style={{ fontSize: 12 }}>{isOut ? 'Did not start' : sm.eliminated ? 'Out — 3 failures in a row' : entrySub(e)}</Muted>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.best}>{sm.best != null ? `${h2(sm.best)} m` : '—'}</Text>
                {rank != null && <Text style={s.rank}>{ordinal(rank)}</Text>}
              </View>
            </View>
            {sm.byH.size > 0 && (
              <Text style={s.history} numberOfLines={2}>
                {[...sm.byH.entries()].map(([k, arr]) => `${k} ${arr.map((a) => (a.result === '-' ? '–' : a.result)).join('')}`).join('   ')}
              </Text>
            )}
            {canJump && (
              <View style={s.jumpRow}>
                <Text style={s.attemptN}>Try {atBar.length + 1}</Text>
                <Button title="O  Cleared" onPress={() => jump(e, 'O')} style={{ flex: 2 }} />
                <Button title="X  Failed" variant="danger" onPress={() => jump(e, 'X')} style={{ flex: 2 }} />
                <Button title="–  Pass" variant="secondary" onPress={() => jump(e, '-')} style={{ flex: 1 }} />
              </View>
            )}
            {!canJump && !isOut && !sm.eliminated && barN != null && (clearedHere || passedHere) && (
              <Muted style={{ fontSize: 13 }}>{clearedHere ? `Cleared ${h2(barN)} — waits for the next height` : `Passed ${h2(barN)}`}</Muted>
            )}
          </Card>
        );
      })}
    </View>
  );

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Entries are saved on this device and sent when the network is back." />
      <HeatHeader data={data.heat} />
      <Muted style={{ fontSize: 13 }}>Set the bar, then record each try: O cleared, X failed, – pass. Three failures in a row and the athlete is out. Entries are saved on the device first.</Muted>
      {wide ? (
        <View style={s.wideRow}>
          <View style={{ flex: 3, minWidth: 0 }}>{list}</View>
          <View style={{ flex: 2, minWidth: 0 }}>{barCard}</View>
        </View>
      ) : (
        <>
          {barCard}
          {list}
        </>
      )}
      {!done ? (
        <Button title="Finalize results" onPress={finalize} loading={busy} />
      ) : (
        <Card style={{ backgroundColor: colors.greenSoft, borderColor: colors.greenSoft }}>
          <Text style={{ color: colors.green, fontWeight: '800' }}>Results are finalized.</Text>
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wideRow: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  label: { fontSize: 15, fontWeight: '800', color: colors.text },
  barRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  barInput: { flex: 1, minWidth: 0, minHeight: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 12, fontSize: 30, fontWeight: '900', textAlign: 'center', color: colors.navy, backgroundColor: '#fff' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  order: { width: 30, textAlign: 'center', fontSize: 18, fontWeight: '900', color: colors.navy },
  name: { fontSize: 15, fontWeight: '800', color: colors.text },
  best: { fontSize: 18, fontWeight: '900', color: colors.text },
  rank: { fontSize: 13, fontWeight: '800', color: colors.blue },
  history: { fontSize: 13, color: colors.text, fontWeight: '600', letterSpacing: 0.5 },
  jumpRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  attemptN: { fontSize: 12, fontWeight: '800', color: colors.muted, width: 38 },
});
