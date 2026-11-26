import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { confirm, notify } from '@/lib/officials/confirm';
import { one, parseMetres, parseTime, showTime } from '@/lib/officials/heats';
import { previewPoints, standingsOf, type CombinedMark, type CombinedStatus, type Discipline } from '@/lib/officials/combined';
import { ordinal } from '@/lib/format';
import { HeatHeader } from './HeatHeader';
import { afterFinalize } from './finalize';
import { entryName, type EntryPerson } from './entry';
import { Cell, POSITION_WORD, PrintSheetButton, SheetGrid, SheetInfo, SheetNote, SheetRow, SheetTitle, type Col } from './ScoreSheet';
import { Button, Card, Muted, OfflineBanner, colors } from '@/components/ui';
import { CallRoomGate, callRoomClosed, canEnterResults, notifyCallRoomOpen } from './CallRoomGate';

type Saved = { discipline: string; mark: number | string | null; status: CombinedStatus; points: number };
type Entry = EntryPerson & {
  id: string;
  lane_number: number;
  call_room_reported: boolean;
  call_room_inspections: { reported_status: string } | { reported_status: string }[] | null;
  combined_results: Saved[] | null;
};
type HeatData = {
  heat: { id: string; heat_number: number; stage: string; status: string; events: { id: string; name: string; code: string; gender: string | null; category: string } };
  disciplines: Discipline[];
  athletes: Entry[];
};
type Draft = { mark: string; status: CombinedStatus };

const STATUS_LABEL: Record<CombinedStatus, string> = { FINISHED: 'FIN', NM: 'NM', DNF: 'DNF', DQ: 'DQ', DNS: 'DNS' };

const parseFor = (d: Discipline, text: string): number | null => (d.kind === 'track' ? parseTime(text) : parseMetres(text));
const showMark = (d: Discipline, v: number | null): string => (v == null ? '' : d.kind === 'track' ? showTime(v) : v.toFixed(2));

/**
 * Decathlon and Heptathlon: the referee picks a discipline, types each athlete's mark, and the
 * World Athletics points and the running total fill in. Marks save themselves (and queue offline).
 */
export function CombinedReferee({ heatId, startAt }: { heatId: string; startAt?: string | null }) {
  const { submitOp, staff } = useOfficialSession();
  const { data, offline, savedAt, error, reload, pending } = useHeat<HeatData>(heatId, `/combined/heats/${heatId}`, 20000);
  const entries = useMemo(() => data?.athletes || [], [data]);
  const discs = useMemo(() => data?.disciplines || [], [data]);
  const [disc, setDisc] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);

  const status = data?.heat.status;
  const closed = callRoomClosed(status);
  const allowed = canEnterResults(status, offline);
  const notReported = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) {
      if (e.call_room_reported) continue;
      const cr = one(e.call_room_inspections)?.reported_status;
      m.set(e.id, cr === 'SCRATCH' ? 'Scratched' : cr === 'DISQUALIFIED' ? 'Disqualified' : 'DNS');
    }
    return m;
  }, [entries]);
  const locked = (id: string) => closed && notReported.has(id);
  const active = entries.filter((e) => !locked(e.id));

  const discOf = useCallback((code: string) => discs.find((d) => d.code === code)!, [discs]);
  const key = (id: string, code: string) => `${id}|${code}`;

  /** What is stored: server marks, then marks waiting on the device (points previewed) */
  const saved = useMemo(() => {
    const m = new Map<string, CombinedMark & { waiting?: boolean }>();
    for (const e of entries) {
      for (const r of e.combined_results || []) m.set(key(e.id, r.discipline), { status: r.status, mark: r.mark != null ? Number(r.mark) : null, points: r.points });
    }
    for (const op of pending) {
      if (op.path !== '/combined/result') continue;
      const b = op.body as any;
      const d = discs.find((x) => x.code === b.discipline);
      if (!d) continue;
      const mk = b.mark != null ? Number(b.mark) : null;
      m.set(key(b.heatAthleteId, b.discipline), { status: b.status, mark: mk, points: b.status === 'FINISHED' ? previewPoints(d, mk) : 0, waiting: true });
    }
    return m;
  }, [entries, pending, discs]);

  /** The first discipline that still has an athlete without a mark (or the first one) */
  const current =
    disc && discs.some((d) => d.code === disc) ? disc : discs.find((d) => active.some((e) => !saved.has(key(e.id, d.code))))?.code ?? discs[0]?.code ?? null;
  const cur = current ? discOf(current) : null;

  const valueOf = (id: string): Draft => {
    if (!cur) return { mark: '', status: 'FINISHED' };
    if (locked(id)) return { mark: '', status: 'DNS' };
    const d = drafts[key(id, cur.code)];
    if (d) return d;
    const sv = saved.get(key(id, cur.code));
    return sv ? { mark: showMark(cur, sv.mark), status: sv.status } : { mark: '', status: 'FINISHED' };
  };
  const isDirty = (id: string) => {
    if (!cur || locked(id)) return false;
    const d = drafts[key(id, cur.code)];
    if (!d) return false;
    const sv = saved.get(key(id, cur.code));
    return !sv || showMark(cur, sv.mark) !== d.mark || sv.status !== d.status;
  };
  const dirtyAll = useMemo(
    () => Object.keys(drafts).filter((k) => {
      const code = k.split('|')[1];
      const sv = saved.get(k);
      const d = drafts[k];
      const dd = discs.find((x) => x.code === code);
      return !!dd && (!sv || showMark(dd, sv.mark) !== d.mark || sv.status !== d.status);
    }).length,
    [drafts, saved, discs]
  );

  /** Points shown for an entry: typed mark previewed, else what is saved */
  const pointsOf = (id: string, code: string): CombinedMark | undefined => {
    const d = drafts[key(id, code)];
    const dd = discs.find((x) => x.code === code);
    if (d && dd) {
      if (d.status !== 'FINISHED') return { status: d.status, mark: null, points: 0 };
      const mk = parseFor(dd, d.mark);
      return mk == null ? saved.get(key(id, code)) : { status: 'FINISHED', mark: mk, points: previewPoints(dd, mk) };
    }
    return saved.get(key(id, code));
  };

  const table = useMemo(
    () => standingsOf(entries.map((e) => e.id), discs, pointsOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, discs, saved, drafts]
  );

  const save = useCallback(
    async (e: Entry, override?: Draft, quiet = false): Promise<boolean> => {
      if (!cur) return false;
      const d = override ?? valueOf(e.id);
      const mk = d.status === 'FINISHED' ? parseFor(cur, d.mark) : null;
      if (d.status === 'FINISHED' && mk == null) {
        if (!quiet) notify('Check the mark', `${entryName(e)}: type the ${cur.kind === 'track' ? 'time like 10.42 or 1:52.34' : 'distance or height in metres, like 7.42'}.`);
        return false;
      }
      const k = key(e.id, cur.code);
      const r = await submitOp({
        path: '/combined/result',
        heatId,
        label: `${entryName(e)} · ${cur.name}: ${d.status === 'FINISHED' ? showMark(cur, mk) : d.status}`,
        body: { heatAthleteId: e.id, discipline: cur.code, mark: mk, status: d.status },
      });
      if (r.status === 'rejected') {
        notify('Not saved', r.message);
        return false;
      }
      setDrafts((x) => {
        const c = x[k];
        if (c && (c.mark !== d.mark || c.status !== d.status)) return x;
        const n = { ...x };
        delete n[k];
        return n;
      });
      if (r.status === 'ok') reload();
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, saved, submitOp, heatId, reload, cur, closed, notReported]
  );

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function edit(e: Entry, d: Draft, delayMs: number) {
    if (!cur) return;
    if (!allowed) return notifyCallRoomOpen();
    if (locked(e.id)) return notify('Did not report', `${entryName(e)} did not report to the call room, so no mark can be entered. The call room official can correct it if that is a mistake.`);
    const k = key(e.id, cur.code);
    setDrafts((x) => ({ ...x, [k]: d }));
    const old = timers.current.get(k);
    if (old) clearTimeout(old);
    timers.current.set(
      k,
      setTimeout(() => {
        timers.current.delete(k);
        save(e, d, true);
      }, delayMs)
    );
  }
  function flush(e: Entry) {
    if (!cur) return;
    const k = key(e.id, cur.code);
    const old = timers.current.get(k);
    if (old) clearTimeout(old);
    timers.current.delete(k);
    if (isDirty(e.id)) save(e, undefined, false);
  }
  async function saveAll() {
    for (const e of entries) if (isDirty(e.id)) if (!(await save(e))) return;
  }

  async function finalize() {
    if (!data) return;
    if (dirtyAll) return notify('Save first', `${dirtyAll} mark${dirtyAll === 1 ? ' is' : 's are'} typed but not saved.`);
    if (!allowed) return notifyCallRoomOpen();
    const missing = active.reduce((n, e) => n + discs.filter((d) => !saved.has(key(e.id, d.code))).length, 0);
    const msg = `${missing ? `${missing} mark${missing === 1 ? ' is' : 's are'} still missing, so those athletes will not be ranked. ` : ''}Final places and championship points are awarded now.`;
    if (!(await confirm('Finish the event?', msg, 'Finish & save'))) return;
    setBusy(true);
    const r = await submitOp(
      { path: '/combined/finalize', heatId, label: 'Results finalized', body: { heatId, eventId: data.heat.events.id, stage: data.heat.stage } },
      { queueable: false, flushFirst: true }
    );
    setBusy(false);
    if (r.status === 'ok') afterFinalize(r.data, heatId);
    else notify('Not finalized', (r as any).message || 'Try again.');
  }

  if (!data) {
    return (
      <Card>
        <Muted>{error || 'Loading the event…'}</Muted>
      </Card>
    );
  }

  const done = ['COMPLETED', 'OFFICIAL'].includes(data.heat.status);
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const unitOf = (e: Entry) => e.profiles?.squads?.colleges?.code || '';
  const bibOf = (e: Entry) => e.profiles?.bid_number ?? '';
  const days = [...new Set(discs.map((d) => d.day))];

  const W = { ord: 54, bib: 64, name: 210, unit: 80, status: 270, mark: 120, pts: 90, save: 100 };
  const entryCols: Col[] = [
    { key: 'ord', title: 'ORDER', width: W.ord },
    { key: 'bib', title: 'BIB No.', width: W.bib },
    { key: 'name', title: 'NAME of the ATHLETES', width: W.name },
    { key: 'unit', title: 'UNIT', sub: 'College', width: W.unit },
    { key: 'status', title: 'STATUS', width: W.status },
    { key: 'mark', title: 'PERFORMANCE', sub: cur?.kind === 'track' ? 'Time' : 'Metres', width: W.mark },
    { key: 'pts', title: 'POINTS', width: W.pts },
    ...(!done ? [{ key: 'save', title: 'SAVED', sub: 'automatic', width: W.save }] : []),
  ];
  const standCols: Col[] = [
    { key: 'pos', title: 'POSITION', width: 96 },
    { key: 'bib', title: 'BIB No.', width: W.bib },
    { key: 'name', title: 'NAME of the ATHLETES', width: W.name },
    { key: 'unit', title: 'UNIT', width: W.unit },
    ...discs.map((d) => ({ key: d.code, title: d.code, width: 62 })),
    { key: 'total', title: 'TOTAL', width: 84 },
  ];

  /** The paper copy: one table per day (marks with points in brackets), the grand total and the position */
  const markText = (id: string, d: Discipline): string => {
    const p = pointsOf(id, d.code);
    if (!p) return '';
    if (p.status === 'FINISHED') return `${showMark(d, p.mark)} (${p.points})`;
    return p.status === 'NM' ? 'NM (0)' : p.status;
  };
  const dayTotal = (id: string, day: number) => discs.filter((d) => d.day === day).reduce((n, d) => n + (pointsOf(id, d.code)?.points ?? 0), 0);
  const placeText = (id: string) => {
    const r = table.find((x) => x.id === id);
    return r?.rank ? POSITION_WORD[r.rank - 1] || ordinal(r.rank) : r && r.done === discs.length ? 'NC' : '';
  };
  const printable = () => ({
    title: `REPORT of REFEREE - ${data.heat.events.name.toUpperCase()}`,
    heat: data.heat,
    startAt,
    referee: staff?.displayName || '',
    signatures: ['REFEREE', 'CHIEF JUDGE'],
    tables: days.map((day, i) => ({
      heading: `DAY ${day}${i === days.length - 1 ? '  -  with the grand total' : ''}`,
      cols: [
        { title: 'ORDER' },
        { title: 'BIB No.' },
        { title: 'NAME of the ATHLETES' },
        { title: 'UNIT', sub: 'College' },
        ...discs.filter((d) => d.day === day).map((d) => ({ title: d.name.toUpperCase(), sub: d.kind === 'track' ? 'time (points)' : 'metres (points)' })),
        { title: `DAY ${day}`, sub: 'points' },
        ...(i === days.length - 1 ? [{ title: 'GRAND TOTAL' }, { title: 'POSITION' }] : []),
      ],
      rows: entries.map((e) => ({
        cells: [
          e.lane_number,
          bibOf(e),
          entryName(e),
          unitOf(e),
          ...discs.filter((d) => d.day === day).map((d) => markText(e.id, d)),
          dayTotal(e.id, day),
          ...(i === days.length - 1 ? [table.find((x) => x.id === e.id)?.total ?? '', placeText(e.id)] : []),
        ],
      })),
    })),
  });

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Marks are saved on this device and sent when the network is back." />
      <HeatHeader data={data.heat} />
      <CallRoomGate heatId={heatId} status={data.heat.status} offline={offline} onClosed={reload} />

      <SheetTitle title={`REPORT of REFEREE — ${data.heat.events.name.toUpperCase()}`} />
      <SheetInfo heat={data.heat} startAt={startAt} />

      <SheetNote>
        Pick the discipline, then type each athlete’s mark (times like 10.42 or 1:52.34, distances and heights in metres like 7.42). World Athletics points and the total fill in by themselves and each mark saves itself.
      </SheetNote>

      <View style={{ gap: 6 }}>
        {days.map((day) => (
          <View key={day} style={s.dayRow}>
            <Text style={s.dayLabel}>DAY {day}</Text>
            {discs
              .filter((d) => d.day === day)
              .map((d) => {
                const n = active.filter((e) => saved.has(key(e.id, d.code))).length;
                const on = d.code === current;
                return (
                  <Pressable key={d.code} onPress={() => setDisc(d.code)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.tab, on && s.tabOn]}>
                    <Text style={[s.tabText, on && s.tabTextOn]}>{d.name}</Text>
                    <Text style={[s.tabSub, on && s.tabTextOn]}>{n}/{active.length}</Text>
                  </Pressable>
                );
              })}
          </View>
        ))}
      </View>

      {cur && (
        <SheetGrid cols={entryCols}>
          {entries.map((e) => {
            const v = valueOf(e.id);
            const dirty = isDirty(e.id);
            const sv = saved.get(key(e.id, cur.code));
            const pts = pointsOf(e.id, cur.code);
            const statuses = (['FINISHED', ...(cur.kind === 'field' ? ['NM'] : []), 'DNF', 'DQ', 'DNS'] as CombinedStatus[]);
            return (
              <SheetRow key={e.id} style={dirty ? { backgroundColor: colors.amberSoft } : locked(e.id) ? { opacity: 0.55 } : undefined}>
                <Cell width={W.ord} text={e.lane_number} textStyle={{ fontWeight: '900' }} />
                <Cell width={W.bib} text={bibOf(e)} />
                <Cell width={W.name} text={entryName(e)} align="left" />
                <Cell width={W.unit} text={unitOf(e)} />
                <Cell width={W.status}>
                  <View style={s.statuses}>
                    {statuses.map((st) => (
                      <Pressable
                        key={st}
                        disabled={done || locked(e.id)}
                        onPress={() => edit(e, { ...v, status: st }, st === 'FINISHED' ? 1200 : 0)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: v.status === st }}
                        style={[s.st, v.status === st && s.stOn]}
                      >
                        <Text style={[s.stText, v.status === st && s.stTextOn]}>{STATUS_LABEL[st]}</Text>
                      </Pressable>
                    ))}
                  </View>
                </Cell>
                <Cell width={W.mark}>
                  {v.status === 'FINISHED' ? (
                    <TextInput
                      value={v.mark}
                      editable={!done}
                      onChangeText={(t) => edit(e, { ...v, mark: t.replace(/[^0-9.:,]/g, '') }, 1200)}
                      onBlur={() => flush(e)}
                      onSubmitEditing={() => flush(e)}
                      placeholder={cur.kind === 'track' ? 'time' : 'metres'}
                      placeholderTextColor="#94a3b8"
                      keyboardType="numbers-and-punctuation"
                      style={s.cellInput}
                      accessibilityLabel={`${cur.name} mark for ${entryName(e)}`}
                    />
                  ) : (
                    <Text style={s.cellStatus}>{locked(e.id) ? notReported.get(e.id) : v.status}</Text>
                  )}
                </Cell>
                <Cell width={W.pts} text={pts ? pts.points : ''} textStyle={{ fontWeight: '900', color: colors.blue, fontSize: 17 }} />
                {!done && (
                  <Cell width={W.save}>
                    {dirty && v.status === 'FINISHED' && v.mark && parseFor(cur, v.mark) == null ? (
                      <Text style={[s.saveState, { color: colors.red }]}>Check mark</Text>
                    ) : (
                      <Text style={[s.saveState, { color: dirty || sv?.waiting ? colors.amber : sv ? colors.green : colors.muted }]}>
                        {locked(e.id) ? 'Not reported' : dirty ? 'Saving…' : sv?.waiting ? 'Queued' : sv ? 'Saved ✓' : '—'}
                      </Text>
                    )}
                  </Cell>
                )}
              </SheetRow>
            );
          })}
        </SheetGrid>
      )}

      <Text style={s.blockTitle}>POINTS & STANDINGS</Text>
      <SheetGrid cols={standCols}>
        {table.map((r) => {
          const e = entryById.get(r.id)!;
          const label = r.rank ? POSITION_WORD[r.rank - 1] || ordinal(r.rank) : locked(e.id) ? 'DNS' : r.done === discs.length ? 'NC' : '—';
          return (
            <SheetRow key={r.id}>
              <Cell width={96} align="left" text={label} textStyle={{ fontWeight: '900' }} />
              <Cell width={W.bib} text={bibOf(e)} />
              <Cell width={W.name} align="left" text={entryName(e)} />
              <Cell width={W.unit} text={unitOf(e)} />
              {discs.map((d) => {
                const p = pointsOf(e.id, d.code);
                return <Cell key={d.code} width={62} text={p ? (p.status === 'FINISHED' || p.status === 'NM' ? p.points : p.status) : ''} textStyle={{ fontSize: 13 }} />;
              })}
              <Cell width={84} text={r.done ? r.total : ''} textStyle={{ fontWeight: '900', fontSize: 16 }} />
            </SheetRow>
          );
        })}
      </SheetGrid>
      <PrintSheetButton build={printable} />
      <Text style={s.legend}>NC = not classified (a discipline is missing, or DNS / DNF / DQ). Equal totals: the athlete with the higher score in more disciplines ranks first.</Text>

      {!done ? (
        <View style={s.footer}>
          {dirtyAll > 0 && <Button title={`Save all (${dirtyAll})`} onPress={saveAll} style={{ flexGrow: 1 }} />}
          <Button title="Finish event & award points" icon="check" variant={dirtyAll ? 'secondary' : 'gold'} onPress={finalize} loading={busy} style={{ flexGrow: 1 }} />
        </View>
      ) : (
        <Card style={{ backgroundColor: colors.greenSoft, borderColor: colors.greenSoft }}>
          <Text style={{ color: colors.green, fontWeight: '800' }}>Results are finalized. Ask the meet office to reopen the heat if something must change.</Text>
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  dayLabel: { width: 54, fontSize: 11, fontWeight: '900', color: colors.goldDeep, letterSpacing: 1.2 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff', alignItems: 'center' },
  tabOn: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  tabText: { fontSize: 13, fontWeight: '800', color: colors.text },
  tabTextOn: { color: colors.blue },
  tabSub: { fontSize: 10, fontWeight: '700', color: colors.muted },
  statuses: { flexDirection: 'row', gap: 4 },
  st: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  stOn: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  stText: { fontSize: 11, fontWeight: '800', color: colors.muted },
  stTextOn: { color: colors.blue },
  cellInput: { minHeight: 36, fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center', paddingVertical: 2, backgroundColor: '#fffbea' },
  cellStatus: { fontSize: 15, fontWeight: '900', color: colors.red, textAlign: 'center' },
  blockTitle: { textAlign: 'center', fontSize: 15, fontWeight: '900', fontStyle: 'italic', color: '#111827' },
  legend: { fontSize: 12, color: colors.muted },
  footer: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  saveState: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
});
