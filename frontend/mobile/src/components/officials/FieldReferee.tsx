import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { confirm, notify } from '@/lib/officials/confirm';
import { one, parseMetres } from '@/lib/officials/heats';
import { HeatHeader } from './HeatHeader';
import { afterFinalize } from './finalize';
import { entryName, entrySub, type EntryPerson } from './entry';
import { Cell, PrintSheetButton, SheetGrid, SheetInfo, SheetNote, SheetRow, SheetTitle, type Col } from './ScoreSheet';
import { Button, Card, Muted, OfflineBanner, colors } from '@/components/ui';

type Attempt = { round_number: number; attempt_type: 'VALID' | 'FOUL' | 'PASS'; mark_meters: number | null; wind_reading: number | null };
type Entry = EntryPerson & {
  id: string;
  lane_number: number;
  call_room_inspections: { reported_status: string } | { reported_status: string }[] | null;
  field_attempts: Attempt[] | null;
};
type HeatData = {
  heat: { id: string; heat_number: number; stage: string; status: string; events: { id: string; name: string; code: string; gender: string | null; category: string } };
  athletes: Entry[];
};

const ROUNDS = [1, 2, 3, 4, 5, 6];

/** Long jump, triple jump and throws: up to 6 rounds, best valid mark counts */
export function FieldReferee({ heatId, startAt }: { heatId: string; startAt?: string | null }) {
  const { submitOp, staff } = useOfficialSession();
  const { data, offline, savedAt, error, reload, pending } = useHeat<HeatData>(heatId, `/field/heats/${heatId}`, 20000);
  const [sel, setSel] = useState<{ id: string; round: number } | null>(null);
  const [mark, setMark] = useState('');
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

  /** Valid marks from rounds 1..upTo, best first (the tie-break compares the next best mark) */
  const marksUpTo = (id: string, upTo: number) =>
    [...(attempts.get(id)?.values() || [])]
      .filter((a) => a.round_number <= upTo && a.attempt_type === 'VALID' && a.mark_meters != null)
      .map((a) => Number(a.mark_meters))
      .sort((x, y) => y - x);

  /** Positions after 3, 5 and all 6 trials, as on the Distance Score Card (ties share a place) */
  const positions = useMemo(() => {
    const after = (upTo: number) => {
      const rows = active.map((e) => ({ id: e.id, marks: marksUpTo(e.id, upTo) })).filter((r) => r.marks.length);
      rows.sort((x, y) => {
        for (let i = 0; i < Math.max(x.marks.length, y.marks.length); i++) {
          const d = (y.marks[i] ?? 0) - (x.marks[i] ?? 0);
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
    };
    return { 3: after(3), 5: after(5), 6: after(6) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, attempts]);

  // Trials 4–6: only the best 8 after three trials (everyone when 8 or fewer compete)
  const threeDone = active.every((e) => [1, 2, 3].every((r) => attempts.get(e.id)?.has(r)));
  const eligible = (id: string, round: number) => round <= 3 || active.length <= 8 || !threeDone || (positions[3].get(id) ?? 99) <= 8;

  const currentRound = ROUNDS.find((r) => active.some((e) => eligible(e.id, r) && !attempts.get(e.id)?.has(r))) ?? 6;

  function select(id: string, round: number) {
    setSel({ id, round });
    const a = attempts.get(id)?.get(round);
    setMark(a?.attempt_type === 'VALID' && a.mark_meters != null ? Number(a.mark_meters).toFixed(2) : '');
  }

  /** After saving, jump to the next athlete in the order for the same round */
  function next(afterId: string, round: number) {
    const i = active.findIndex((e) => e.id === afterId);
    const nxt = active.slice(i + 1).find((e) => eligible(e.id, round) && !attempts.get(e.id)?.has(round));
    if (nxt) select(nxt.id, round);
    else {
      const first = active.find((e) => eligible(e.id, round + 1) && !attempts.get(e.id)?.has(round + 1));
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
    const r = await submitOp({
      path: '/field/attempt',
      heatId,
      label: `${entryName(e)} R${sel.round}: ${type === 'VALID' ? `${m!.toFixed(2)} m` : type === 'FOUL' ? 'foul' : 'pass'}`,
      body: { heatAthleteId: e.id, roundNumber: sel.round, attemptType: type, markMeters: m },
    });
    if (r.status === 'rejected') return notify('Not saved', r.message);
    if (r.status === 'ok') reload();
    setMark('');
    next(e.id, sel.round);
  }

  async function finalize() {
    if (!data) return;
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
  const selEntry = sel ? entries.find((e) => e.id === sel.id) : null;

  const editor = !done && (
    <Card style={[s.editor, !selEntry && { opacity: 0.85 }]}>
      {selEntry ? (
        <>
          <Text style={s.edTitle} numberOfLines={1}>
            Trial {sel!.round} · {entryName(selEntry)}
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
          </View>
          <View style={s.edRow}>
            <Button title="✓ Save mark" onPress={() => record('VALID')} style={{ flex: 2 }} />
            <Button title="X Foul" variant="danger" onPress={() => record('FOUL')} style={{ flex: 1 }} />
            <Button title="– Pass" variant="secondary" onPress={() => record('PASS')} style={{ flex: 1 }} />
          </View>
        </>
      ) : (
        <Muted>Tap a trial box on the score card to enter an attempt. Trial {currentRound} is next.</Muted>
      )}
    </Card>
  );

  const show = (a: Attempt | undefined) => (!a ? '' : a.attempt_type === 'VALID' ? Number(a.mark_meters).toFixed(2) : a.attempt_type === 'FOUL' ? 'X' : '–');
  const bestText = (id: string, upTo: number) => {
    const m = marksUpTo(id, upTo)[0];
    if (m != null) return m.toFixed(2);
    const tried = [...(attempts.get(id)?.values() || [])].some((a) => a.round_number <= upTo);
    return tried ? 'NM' : '';
  };

  const W = { sn: 40, name: 190, bib: 62, col: 74, trial: 74, best: 78, pos: 74 };
  const cols: Col[] = [
    { key: 'sn', title: 'S.N.', width: W.sn },
    { key: 'name', title: 'NAME of the ATHLETES', width: W.name },
    { key: 'bib', title: 'BIB NUMBER', width: W.bib },
    { key: 'col', title: 'COLLEGE', width: W.col },
    { key: 't1', title: 'FIRST', width: W.trial },
    { key: 't2', title: 'SECOND', width: W.trial },
    { key: 't3', title: 'THIRD', width: W.trial },
    { key: 'b3', title: 'BEST OF THREE', sub: 'TRIALS', width: W.best },
    { key: 'p3', title: 'POSITION', sub: 'After Three Trials', width: W.pos },
    { key: 't4', title: 'FOURTH', width: W.trial },
    { key: 't5', title: 'FIFTH', width: W.trial },
    { key: 'b5', title: 'BEST OF Five', sub: 'TRIALS', width: W.best },
    { key: 'p5', title: 'POSITION', sub: 'After Five Trials', width: W.pos },
    { key: 't6', title: 'SIXTH', width: W.trial },
    { key: 'ba', title: 'BEST OF ALL', sub: 'TRIALS', width: W.best },
    { key: 'pf', title: 'FINAL', sub: 'POSITION', width: W.pos },
  ];
  const groups = [
    { title: '', span: 4 },
    { title: 'TRIALS', span: 3 },
    { title: '', span: 2 },
    { title: 'TRIALS', span: 2 },
    { title: '', span: 2 },
    { title: '', span: 3 },
  ];

  const trialCell = (e: Entry, r: number, isOut: boolean) => {
    const a = attempts.get(e.id)?.get(r);
    const can = !done && !isOut && eligible(e.id, r);
    return (
      <Cell
        key={r}
        width={W.trial}
        text={show(a)}
        shaded={!isOut && !eligible(e.id, r)}
        selected={sel?.id === e.id && sel.round === r}
        onPress={can ? () => select(e.id, r) : undefined}
        label={`${entryName(e)}, trial ${r}${a ? `: ${show(a)}` : ''}`}
        textStyle={a?.attempt_type === 'FOUL' ? { color: colors.red, fontWeight: '900' } : undefined}
      />
    );
  };

  const sheet = (
    <SheetGrid groups={groups} cols={cols}>
      {entries.map((e, i) => {
        const isOut = out.has(e.id);
        const p = (n: 3 | 5 | 6) => (isOut ? '' : positions[n].get(e.id) ?? '');
        return (
          <SheetRow key={e.id} style={isOut ? { opacity: 0.5 } : undefined}>
            <Cell width={W.sn} text={e.lane_number ?? i + 1} textStyle={{ fontWeight: '900' }} />
            <Cell width={W.name} align="left" text={isOut ? `${entryName(e)} (DNS)` : entryName(e)} />
            <Cell width={W.bib} text={e.profiles?.bid_number ?? ''} />
            <Cell width={W.col} text={e.profiles?.squads?.colleges?.code || ''} />
            {[1, 2, 3].map((r) => trialCell(e, r, isOut))}
            <Cell width={W.best} text={isOut ? '' : bestText(e.id, 3)} textStyle={s.computed} />
            <Cell width={W.pos} text={p(3)} textStyle={s.computed} />
            {[4, 5].map((r) => trialCell(e, r, isOut))}
            <Cell width={W.best} text={isOut ? '' : bestText(e.id, 5)} textStyle={s.computed} />
            <Cell width={W.pos} text={p(5)} textStyle={s.computed} />
            {trialCell(e, 6, isOut)}
            <Cell width={W.best} text={isOut ? 'DNS' : bestText(e.id, 6)} textStyle={s.computed} />
            <Cell width={W.pos} text={p(6)} textStyle={[s.computed, { color: colors.blue, fontSize: 16 }]} />
          </SheetRow>
        );
      })}
    </SheetGrid>
  );

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Entries are saved on this device and sent when the network is back." />
      <HeatHeader data={data.heat} />
      <SheetTitle title="* DISTANCE SCORE CARD *" />
      <SheetInfo heat={data.heat} startAt={startAt} />
      {editor}
      <SheetNote>Tap a trial box to enter it: the mark in metres, X for a foul, – for a pass. Best marks and positions fill in automatically. Trials 4–6 are for the best 8 after three trials (grey boxes are not used).</SheetNote>
      {sheet}
      <PrintSheetButton
        build={() => ({
          title: '* DISTANCE SCORE CARD *',
          heat: data.heat,
          startAt,
          referee: staff?.displayName || '',
          signatures: ['REFEREE', 'CHIEF JUDGE'],
          note: 'X foul · – pass · NM no valid mark. Trials 4–6 for the best 8 after three trials (grey boxes not used).',
          tables: [
            {
              groups,
              cols: cols.map((c) => ({ title: c.title, sub: c.sub })),
              rows: entries.map((e, i) => {
                const isOut = out.has(e.id);
                const p = (n: 3 | 5 | 6) => (isOut ? '' : positions[n].get(e.id) ?? '');
                const t = (r: number) => (isOut ? '' : show(attempts.get(e.id)?.get(r)));
                const sh = (r: number) => !isOut && !eligible(e.id, r);
                return {
                  dim: isOut,
                  cells: [e.lane_number ?? i + 1, isOut ? `${entryName(e)} (DNS)` : entryName(e), e.profiles?.bid_number ?? '', e.profiles?.squads?.colleges?.code || '',
                    t(1), t(2), t(3), isOut ? '' : bestText(e.id, 3), p(3), t(4), t(5), isOut ? '' : bestText(e.id, 5), p(5), t(6), isOut ? 'DNS' : bestText(e.id, 6), p(6)],
                  shaded: [false, false, false, false, sh(1), sh(2), sh(3), false, false, sh(4), sh(5), false, false, sh(6), false, false],
                };
              }),
            },
          ],
        })}
      />
      {!done ? (
        <Button title="Finish heat & save results" onPress={finalize} loading={busy} />
      ) : (
        <Card style={{ backgroundColor: colors.greenSoft, borderColor: colors.greenSoft }}>
          <Text style={{ color: colors.green, fontWeight: '800' }}>Results are finalized.</Text>
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  editor: { gap: 10, borderColor: colors.blue, borderWidth: 2 },
  edTitle: { fontSize: 18, fontWeight: '900', color: colors.navy },
  edRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 18, fontWeight: '700', color: colors.text, backgroundColor: '#fff' },
  computed: { fontWeight: '900', color: '#111827' },
});
