import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { confirm, notify } from '@/lib/officials/confirm';
import { parseMetres } from '@/lib/officials/heats';
import { HeatHeader } from './HeatHeader';
import { afterFinalize } from './finalize';
import { entryName, type EntryPerson } from './entry';
import { Cell, PrintSheetButton, SheetGrid, SheetInfo, SheetNote, SheetRow, SheetTitle, type Col } from './ScoreSheet';
import { Button, Card, Muted, OfflineBanner, colors } from '@/components/ui';
import { CallRoomGate, callRoomClosed, canEnterResults, notifyCallRoomOpen } from './CallRoomGate';

type Vert = { bar_height_meters: number; attempt_number: number; result: 'O' | 'X' | '-' };
type Entry = EntryPerson & {
  id: string;
  lane_number: number;
  call_room_reported: boolean;
  call_room_inspections: { reported_status: string } | { reported_status: string }[] | null;
  vertical_jump_attempts: Vert[] | null;
};
type HeatData = {
  heat: { id: string; heat_number: number; stage: string; status: string; events: { id: string; name: string; code: string; gender: string | null; category: string } };
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
export function VerticalReferee({ heatId, startAt }: { heatId: string; startAt?: string | null }) {
  const { submitOp, staff } = useOfficialSession();
  const [selId, setSelId] = useState<string | null>(null);
  const { data, offline, savedAt, error, reload, pending } = useHeat<HeatData>(heatId, `/field/heats/${heatId}`, 20000);
  const [busy, setBusy] = useState(false);

  // Strict call room: once it has closed, anyone who did not report is out (DNS) and locked
  const entries = useMemo(() => data?.athletes || [], [data]);
  const status = data?.heat.status;
  const closed = callRoomClosed(status);
  const allowed = canEnterResults(status, offline);
  const out = useMemo(() => new Set(closed ? entries.filter((e) => !e.call_room_reported).map((e) => e.id) : []), [entries, closed]);

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
  const [barDraft, setBar] = useState('');
  // Until the referee sets the bar, use the highest bar recorded so far
  const bar = barDraft || heights[heights.length - 1] || '';
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
    if (!allowed) return notifyCallRoomOpen();
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
    setSelId(null);
  }

  async function finalize() {
    if (!data) return;
    if (!allowed) return notifyCallRoomOpen();
    const final = data.heat.stage === 'FINAL';
    if (!(await confirm('Finish this heat?', final ? 'This is the final: championship points are awarded now.' : 'The flight will be marked done.', 'Finish & save'))) return;
    setBusy(true);
    const r = await submitOp({ path: '/field/finalize', heatId, label: 'Results finalized', body: { heatId, eventId: data.heat.events.id, stage: data.heat.stage } }, { queueable: false });
    setBusy(false);
    if (r.status === 'ok') {
      afterFinalize(r.data, heatId);
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

  /** Heights on the card: every height used so far plus the bar now set, padded to 7 like the paper card */
  const cardHeights = [...new Set([...heights, ...(barN != null ? [h2(barN)] : [])])].sort((x, y) => Number(x) - Number(y));
  const columns: (string | null)[] = [...cardHeights, ...Array(Math.max(0, 7 - cardHeights.length)).fill(null)];

  const W = { sn: 40, name: 190, bib: 62, col: 74, try: 30, best: 72, tr: 78, tf: 72, pos: 72 };
  const cols: Col[] = [
    { key: 'sn', title: 'S.N.', width: W.sn },
    { key: 'name', title: 'NAME of the ATHLETES', width: W.name },
    { key: 'bib', title: 'BIB No.', width: W.bib },
    { key: 'col', title: 'COLLEGE', width: W.col },
    ...columns.flatMap((h, i) => [1, 2, 3].map((n) => ({ key: `h${i}-${n}`, title: String(n), width: W.try }))),
    { key: 'best', title: 'BEST', sub: 'JUMP', width: W.best },
    { key: 'tr', title: 'TRIALS at', sub: 'HEIGHT CLEARED', width: W.tr },
    { key: 'tf', title: 'TOTAL', sub: 'FAILURE', width: W.tf },
    { key: 'pos', title: 'FINAL', sub: 'POSITION', width: W.pos },
  ];
  const groups = [
    { title: '', span: 4 },
    ...columns.map((h) => ({ title: h ? `${h} M.` : 'M.', span: 3 })),
    { title: '', span: 4 },
  ];

  const sel = selId ? entries.find((e) => e.id === selId) : null;
  const selAtBar = sel && barN != null ? summaries.get(sel.id)!.byH.get(h2(barN)) || [] : [];

  const jumpCard = !done && (
    <Card style={{ gap: 10, borderColor: colors.blue, borderWidth: 2 }}>
      <Text style={s.label}>Bar height (m)</Text>
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
      {sel && barN != null ? (
        <View style={{ gap: 8 }}>
          <Text style={s.selTitle} numberOfLines={1}>
            {entryName(sel)} · {h2(barN)} m · try {selAtBar.length + 1}
          </Text>
          <View style={s.jumpRow}>
            <Button title="O  Cleared" onPress={() => jump(sel, 'O')} style={{ flex: 2 }} />
            <Button title="X  Failure" variant="danger" onPress={() => jump(sel, 'X')} style={{ flex: 2 }} />
            <Button title="–  Pass" variant="secondary" onPress={() => jump(sel, '-')} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <Muted style={{ fontSize: 13 }}>Tap the athlete&apos;s next box under the bar height on the card, then record O, X or –.</Muted>
      )}
    </Card>
  );

  const sheet = (
    <SheetGrid groups={groups} cols={cols}>
      {entries.map((e, i) => {
        const sm = summaries.get(e.id)!;
        const isOut = out.has(e.id);
        const rank = ranks.get(e.id);
        const trialsAtBest = sm.best != null ? (sm.byH.get(h2(sm.best)) || []).length : null;
        return (
          <SheetRow key={e.id} style={isOut ? { opacity: 0.5 } : undefined}>
            <Cell width={W.sn} text={e.lane_number ?? i + 1} textStyle={{ fontWeight: '900' }} />
            <Cell width={W.name} align="left" text={isOut ? `${entryName(e)} (DNS)` : sm.eliminated ? `${entryName(e)} (out)` : entryName(e)} />
            <Cell width={W.bib} text={e.profiles?.bid_number ?? ''} />
            <Cell width={W.col} text={e.profiles?.squads?.colleges?.code || ''} />
            {columns.flatMap((h, ci) =>
              [1, 2, 3].map((n) => {
                const arr = h ? sm.byH.get(h) || [] : [];
                const a = arr.find((x) => x.attempt_number === n);
                const isBar = h != null && barN != null && h === h2(barN);
                const settled = arr.some((x) => x.result === 'O' || x.result === '-');
                const isNext = isBar && !done && !isOut && !sm.eliminated && !settled && arr.length + 1 === n;
                return (
                  <Cell
                    key={`${ci}-${n}`}
                    width={W.try}
                    text={a ? (a.result === '-' ? '–' : a.result) : ''}
                    shaded={!h}
                    selected={isNext && selId === e.id}
                    onPress={isNext ? () => (allowed ? setSelId(e.id) : notifyCallRoomOpen()) : undefined}
                    label={isNext ? `${entryName(e)}, ${h} m try ${n}` : undefined}
                    textStyle={a?.result === 'X' ? { color: colors.red, fontWeight: '900' } : a?.result === 'O' ? { color: colors.green, fontWeight: '900' } : undefined}
                  />
                );
              })
            )}
            <Cell width={W.best} text={isOut ? 'DNS' : sm.best != null ? h2(sm.best) : sm.byH.size ? 'NM' : ''} textStyle={s.computed} />
            <Cell width={W.tr} text={trialsAtBest ?? ''} textStyle={s.computed} />
            <Cell width={W.tf} text={sm.best != null ? sm.failsUpToBest : ''} textStyle={s.computed} />
            <Cell width={W.pos} text={rank ?? ''} textStyle={[s.computed, { color: colors.blue, fontSize: 16 }]} />
          </SheetRow>
        );
      })}
    </SheetGrid>
  );

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Entries are saved on this device and sent when the network is back." />
      <HeatHeader data={data.heat} />
      <CallRoomGate heatId={heatId} status={data.heat.status} offline={offline} onClosed={reload} />
      <SheetTitle title={`RESULT CARD  *  ${data.heat.events.code.startsWith('PV') ? 'POLE VAULT' : 'HIGH JUMP'}`} />
      <SheetInfo heat={data.heat} startAt={startAt} />
      {jumpCard}
      <SheetNote>LEGEND: O cleared · – pass · X failure. Three failures in a row and the athlete is out. Best jump, trials at the height cleared, total failures (up to the best height) and position fill in automatically.</SheetNote>
      {sheet}
      <PrintSheetButton
        build={() => ({
          title: `RESULT CARD  *  ${data.heat.events.code.startsWith('PV') ? 'POLE VAULT' : 'HIGH JUMP'}`,
          heat: data.heat,
          startAt,
          referee: staff?.displayName || '',
          signatures: ['REFEREE', 'JUDGES'],
          note: 'LEGEND: O cleared · – pass · X failure. Three failures in a row and the athlete is out.',
          tables: [
            {
              groups,
              cols: cols.map((c) => ({ title: c.title, sub: c.sub })),
              rows: entries.map((e, i) => {
                const sm = summaries.get(e.id)!;
                const isOut = out.has(e.id);
                const trialsAtBest = sm.best != null ? (sm.byH.get(h2(sm.best)) || []).length : '';
                const tries = columns.flatMap((h) =>
                  [1, 2, 3].map((n) => {
                    const a = h ? (sm.byH.get(h) || []).find((x) => x.attempt_number === n) : undefined;
                    return a ? (a.result === '-' ? '–' : a.result) : '';
                  })
                );
                return {
                  dim: isOut,
                  cells: [e.lane_number ?? i + 1, isOut ? `${entryName(e)} (DNS)` : sm.eliminated ? `${entryName(e)} (out)` : entryName(e), e.profiles?.bid_number ?? '', e.profiles?.squads?.colleges?.code || '',
                    ...tries, isOut ? 'DNS' : sm.best != null ? h2(sm.best) : sm.byH.size ? 'NM' : '', trialsAtBest, sm.best != null ? sm.failsUpToBest : '', ranks.get(e.id) ?? ''],
                  // Unused height columns stay white on paper so judges can write heights in by hand
                };
              }),
            },
          ],
        })}
      />
      {!done ? (
        <Button title="Finish heat & save results" icon="check" variant="gold" onPress={finalize} loading={busy} />
      ) : (
        <Card style={{ backgroundColor: colors.greenSoft, borderColor: colors.greenSoft }}>
          <Text style={{ color: colors.green, fontWeight: '800' }}>Results are finalized.</Text>
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '800', color: colors.text },
  barRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  barInput: { flex: 1, minWidth: 0, minHeight: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 12, fontSize: 30, fontWeight: '900', textAlign: 'center', color: colors.navy, backgroundColor: '#fff' },
  selTitle: { fontSize: 17, fontWeight: '900', color: colors.navy },
  jumpRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  computed: { fontWeight: '900', color: '#111827' },
});
