import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { useOfficialsLayout } from '@/lib/officials/layout';
import { confirm, notify } from '@/lib/officials/confirm';
import { needsWind, one, parseMetres } from '@/lib/officials/heats';
import { ordinal } from '@/lib/format';
import { HeatHeader } from './HeatHeader';
import { entryName, entrySub, type EntryPerson } from './entry';
import { Button, Card, Muted, OfflineBanner, colors } from '@/components/ui';

type Attempt = { round_number: number; attempt_type: 'VALID' | 'FOUL' | 'PASS'; mark_meters: number | null; wind_reading: number | null };
type Entry = EntryPerson & {
  id: string;
  lane_number: number;
  call_room_inspections: { reported_status: string } | { reported_status: string }[] | null;
  field_attempts: Attempt[] | null;
};
type HeatData = {
  heat: { id: string; heat_number: number; stage: string; status: string; events: { id: string; name: string; code: string; category: string } };
  athletes: Entry[];
};

const ROUNDS = [1, 2, 3, 4, 5, 6];

/** Long jump, triple jump and throws: up to 6 rounds, best valid mark counts */
export function FieldReferee({ heatId }: { heatId: string }) {
  const { submitOp } = useOfficialSession();
  const { wide } = useOfficialsLayout();
  const { data, offline, savedAt, error, reload, pending } = useHeat<HeatData>(heatId, `/field/heats/${heatId}`, 20000);
  const [sel, setSel] = useState<{ id: string; round: number } | null>(null);
  const [mark, setMark] = useState('');
  const [wind, setWind] = useState('');
  const [busy, setBusy] = useState(false);

  // Out of the competition before it starts (DNS / scratched in the call room)
  const entries = useMemo(() => data?.athletes || [], [data]);
  const out = useMemo(() => new Set(entries.filter((e) => ['DNS', 'SCRATCH'].includes(one(e.call_room_inspections)?.reported_status || '')).map((e) => e.id)), [entries]);
  const active = entries.filter((e) => !out.has(e.id));

  /** attempts[entryId][round] — server, then attempts waiting on the device */
  const attempts = useMemo(() => {
    const m = new Map<string, Map<number, Attempt>>();
    for (const e of entries) {
      const r = new Map<number, Attempt>();
      for (const a of e.field_attempts || []) r.set(a.round_number, a);
      m.set(e.id, r);
    }
    for (const op of pending) {
      if (op.path !== '/field/attempt') continue;
      const b = op.body as any;
      m.get(b.heatAthleteId)?.set(b.roundNumber, { round_number: b.roundNumber, attempt_type: b.attemptType, mark_meters: b.markMeters ?? null, wind_reading: b.windReading ?? null });
    }
    return m;
  }, [entries, pending]);

  const best = (id: string) => {
    const marks = [...(attempts.get(id)?.values() || [])].filter((a) => a.attempt_type === 'VALID' && a.mark_meters != null).map((a) => Number(a.mark_meters)).sort((a, b) => b - a);
    return marks;
  };

  // Rank: best mark, then second best, and so on
  const ranks = useMemo(() => {
    const rows = active.map((e) => ({ id: e.id, marks: best(e.id) })).filter((r) => r.marks.length);
    rows.sort((a, b) => {
      for (let i = 0; i < Math.max(a.marks.length, b.marks.length); i++) {
        const d = (b.marks[i] ?? 0) - (a.marks[i] ?? 0);
        if (d) return d;
      }
      return 0;
    });
    const m = new Map<string, number>();
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      m.set(r.id, prev && prev.marks.join() === r.marks.join() ? m.get(prev.id)! : i + 1);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, attempts]);

  const currentRound = ROUNDS.find((r) => active.some((e) => !attempts.get(e.id)?.has(r))) ?? 6;

  function select(id: string, round: number) {
    setSel({ id, round });
    const a = attempts.get(id)?.get(round);
    setMark(a?.attempt_type === 'VALID' && a.mark_meters != null ? Number(a.mark_meters).toFixed(2) : '');
  }

  /** After saving, jump to the next athlete in the order for the same round */
  function next(afterId: string, round: number) {
    const i = active.findIndex((e) => e.id === afterId);
    const nxt = active.slice(i + 1).find((e) => !attempts.get(e.id)?.has(round));
    if (nxt) select(nxt.id, round);
    else {
      const first = active.find((e) => !attempts.get(e.id)?.has(round + 1));
      if (round < 6 && first) select(first.id, round + 1);
      else setSel(null);
    }
  }

  async function record(type: 'VALID' | 'FOUL' | 'PASS') {
    if (!sel || !data) return;
    const e = entries.find((x) => x.id === sel.id)!;
    let m: number | null = null;
    if (type === 'VALID') {
      m = parseMetres(mark);
      if (m == null) return notify('Check the mark', 'Type the distance in metres, like 7.42');
    }
    const w = wind.trim() ? Number(wind.replace(',', '.')) : null;
    const r = await submitOp({
      path: '/field/attempt',
      heatId,
      label: `${entryName(e)} R${sel.round}: ${type === 'VALID' ? `${m!.toFixed(2)} m` : type === 'FOUL' ? 'foul' : 'pass'}`,
      body: { heatAthleteId: e.id, roundNumber: sel.round, attemptType: type, markMeters: m, windReading: Number.isFinite(w as number) ? w : null },
    });
    if (r.status === 'rejected') return notify('Not saved', r.message);
    if (r.status === 'ok') reload();
    setMark('');
    next(e.id, sel.round);
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
  const windy = needsWind(data.heat.events.code);
  const selEntry = sel ? entries.find((e) => e.id === sel.id) : null;

  const editor = !done && (
    <Card style={[s.editor, !selEntry && { opacity: 0.85 }]}>
      {selEntry ? (
        <>
          <Text style={s.edTitle} numberOfLines={1}>
            Round {sel!.round} · {entryName(selEntry)}
          </Text>
          <Muted style={{ fontSize: 13 }}>{entrySub(selEntry)}</Muted>
          <View style={s.edRow}>
            <TextInput
              value={mark}
              onChangeText={(t) => setMark(t.replace(/[^0-9.,]/g, ''))}
              placeholder="Mark (m)"
              placeholderTextColor="#94a3b8"
              keyboardType="decimal-pad"
              style={[s.input, { flex: 1, minWidth: 0, fontSize: 26 }]}
              accessibilityLabel="Mark in metres"
              onSubmitEditing={() => record('VALID')}
            />
            {windy && (
              <TextInput value={wind} onChangeText={setWind} placeholder="Wind" placeholderTextColor="#94a3b8" keyboardType="numbers-and-punctuation" style={[s.input, { width: 90 }]} accessibilityLabel="Wind" />
            )}
          </View>
          <View style={s.edRow}>
            <Button title="✓ Save mark" onPress={() => record('VALID')} style={{ flex: 2 }} />
            <Button title="✕ Foul" variant="danger" onPress={() => record('FOUL')} style={{ flex: 1 }} />
            <Button title="– Pass" variant="secondary" onPress={() => record('PASS')} style={{ flex: 1 }} />
          </View>
        </>
      ) : (
        <Muted>Tap a round box next to an athlete to enter their attempt. Round {currentRound} is next.</Muted>
      )}
    </Card>
  );

  const table = (
    <View style={{ gap: 8 }}>
      {entries.map((e) => {
        const isOut = out.has(e.id);
        const b = best(e.id)[0];
        const rank = ranks.get(e.id);
        return (
          <Card key={e.id} style={[{ gap: 8, padding: 12 }, isOut && { opacity: 0.5 }]}>
            <View style={s.top}>
              <Text style={s.order}>{e.lane_number}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{entryName(e)}</Text>
                <Muted style={{ fontSize: 12 }}>{isOut ? 'Did not start' : entrySub(e)}</Muted>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.best}>{b != null ? `${b.toFixed(2)} m` : '—'}</Text>
                {rank != null && <Text style={s.rank}>{ordinal(rank)}</Text>}
              </View>
            </View>
            {!isOut && (
              <View style={s.rounds}>
                {ROUNDS.map((r) => {
                  const a = attempts.get(e.id)?.get(r);
                  const on = sel?.id === e.id && sel.round === r;
                  const txt = !a ? '' : a.attempt_type === 'VALID' ? Number(a.mark_meters).toFixed(2) : a.attempt_type === 'FOUL' ? '✕' : '–';
                  return (
                    <Pressable
                      key={r}
                      disabled={done}
                      onPress={() => select(e.id, r)}
                      accessibilityRole="button"
                      accessibilityLabel={`Round ${r}${txt ? `: ${txt}` : ''}`}
                      style={[s.cellBox, on && s.cellOn, a?.attempt_type === 'FOUL' && { backgroundColor: colors.redSoft }]}
                    >
                      <Text style={s.cellR}>R{r}</Text>
                      <Text style={[s.cellV, a?.attempt_type === 'FOUL' && { color: colors.red }]}>{txt || ' '}</Text>
                    </Pressable>
                  );
                })}
              </View>
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
      <Muted style={{ fontSize: 13 }}>Rounds 4–6 are for the best 8 after round 3. Fouls are ✕, passes are –. Entries are saved on the device first.</Muted>
      {wide ? (
        <View style={s.wideRow}>
          <View style={{ flex: 3, minWidth: 0 }}>{table}</View>
          <View style={{ flex: 2, minWidth: 0, gap: 12 }}>{editor}</View>
        </View>
      ) : (
        <>
          {editor}
          {table}
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
  editor: { gap: 10, borderColor: colors.blue, borderWidth: 2 },
  edTitle: { fontSize: 18, fontWeight: '900', color: colors.navy },
  edRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 18, fontWeight: '700', color: colors.text, backgroundColor: '#fff' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  order: { width: 30, textAlign: 'center', fontSize: 18, fontWeight: '900', color: colors.navy },
  name: { fontSize: 15, fontWeight: '800', color: colors.text },
  best: { fontSize: 18, fontWeight: '900', color: colors.text },
  rank: { fontSize: 13, fontWeight: '800', color: colors.blue },
  rounds: { flexDirection: 'row', gap: 4 },
  cellBox: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  cellOn: { borderColor: colors.blue, borderWidth: 2, backgroundColor: colors.blueSoft },
  cellR: { fontSize: 10, fontWeight: '800', color: colors.muted },
  cellV: { fontSize: 14, fontWeight: '800', color: colors.text },
});
