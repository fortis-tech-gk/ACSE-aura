import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { confirm, notify } from '@/lib/officials/confirm';
import { one, parseTime, showTime } from '@/lib/officials/heats';
import { ordinal } from '@/lib/format';
import { HeatHeader } from './HeatHeader';
import { afterFinalize } from './finalize';
import { entryName, type EntryPerson } from './entry';
import { Cell, POSITION_WORD, PrintSheetButton, SheetGrid, SheetInfo, SheetNote, SheetRow, SheetTitle, type Col } from './ScoreSheet';
import { Button, Card, Muted, OfflineBanner, colors } from '@/components/ui';
import { CallRoomGate, callRoomClosed, canEnterResults, notifyCallRoomOpen } from './CallRoomGate';

type Result = { time_seconds: number | null; status: 'FINISHED' | 'DNF' | 'DQ' | 'DNS'; dq_rule: string | null };
type Entry = EntryPerson & {
  id: string;
  lane_number: number;
  call_room_reported: boolean;
  call_room_inspections: { reported_status: string } | { reported_status: string }[] | null;
  track_results: Result | Result[] | null;
};
type HeatData = {
  heat: { id: string; heat_number: number; stage: string; status: string; wind_reading: number | null; events: { id: string; name: string; code: string; gender: string | null; category: string; start_type: string } };
  athletes: Entry[];
};

type Status = Result['status'];
type Draft = { time: string; status: Status; dq: string };
const STATUSES: { key: Status; label: string }[] = [
  { key: 'FINISHED', label: 'Finished' },
  { key: 'DNF', label: 'DNF' },
  { key: 'DQ', label: 'DQ' },
  { key: 'DNS', label: 'DNS' },
];

/** Track and relay heats: one time (or DNF / DQ / DNS) per lane, then finalize */
export function TrackReferee({ heatId, startAt }: { heatId: string; startAt?: string | null }) {
  const { submitOp, staff } = useOfficialSession();
  const staffName = staff?.displayName || '';
  const { data, offline, savedAt, error, reload, pending } = useHeat<HeatData>(heatId, `/track/heats/${heatId}`, 20000);
  const entries = useMemo(() => data?.athletes || [], [data]);

  /** What is stored (server, then entries waiting on the device) */
  const saved = useMemo(() => {
    const m = new Map<string, Draft>();
    for (const e of entries) {
      const r = one(e.track_results);
      if (r) m.set(e.id, { time: r.time_seconds != null ? showTime(Number(r.time_seconds)) : '', status: r.status, dq: r.dq_rule || '' });
    }
    for (const op of pending) {
      if (op.path !== '/track/result') continue;
      const b = op.body as any;
      m.set(b.heatAthleteId, { time: b.timeSeconds != null ? showTime(Number(b.timeSeconds)) : '', status: b.status, dq: b.dqRule || '' });
    }
    return m;
  }, [entries, pending]);

  /**
   * Strict call room: once it has closed, an entry that did not report is DNS and locked — no
   * result can be entered for it (the server refuses too). Corrections are made by the call room.
   */
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

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);

  const valueOf = (id: string): Draft =>
    locked(id) ? { time: '', status: 'DNS', dq: '' } : drafts[id] ?? saved.get(id) ?? { time: '', status: 'FINISHED', dq: '' };
  const isDirty = (id: string) => {
    if (locked(id)) return false;
    const d = drafts[id];
    if (!d) return false;
    const sv = saved.get(id);
    return !sv || sv.time !== d.time || sv.status !== d.status || sv.dq !== d.dq;
  };

  // Places from the times entered so far (ties share a place)
  const places = useMemo(() => {
    const timed = entries
      .map((e) => {
        const v = drafts[e.id] ?? saved.get(e.id);
        return { id: e.id, t: v && v.status === 'FINISHED' ? parseTime(v.time) : null };
      })
      .filter((x) => x.t != null)
      .sort((a, b) => a.t! - b.t!);
    const m = new Map<string, number>();
    timed.forEach((x, i) => m.set(x.id, i > 0 && timed[i - 1].t === x.t ? m.get(timed[i - 1].id)! : i + 1));
    return m;
  }, [entries, drafts, saved]);

  const save = useCallback(
    async (e: Entry, override?: Draft, quiet = false): Promise<boolean> => {
      const d = override ?? valueOf(e.id);
      const t = d.status === 'FINISHED' ? parseTime(d.time) : null;
      if (d.status === 'FINISHED' && t == null) {
        if (!quiet) notify('Check the time', `${entryName(e)}: type the time like 10.42 or 1:52.34`);
        return false;
      }
      const r = await submitOp({
        path: '/track/result',
        heatId,
        label: `${entryName(e)}: ${d.status === 'FINISHED' ? showTime(t) : d.status}`,
        body: { heatAthleteId: e.id, timeSeconds: t, status: d.status, dqRule: d.status === 'DQ' ? d.dq.trim() || 'DQ' : '' },
      });
      if (r.status === 'rejected') {
        notify('Not saved', r.message);
        return false;
      }
      // Drop the draft only if nothing newer was typed while it was being sent
      setDrafts((x) => {
        const cur = x[e.id];
        if (cur && (cur.time !== d.time || cur.status !== d.status || cur.dq !== d.dq)) return x;
        const n = { ...x };
        delete n[e.id];
        return n;
      });
      if (r.status === 'ok') reload();
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, saved, submitOp, heatId, reload, closed, notReported]
  );

  /** Autosave: a typed time is sent 1.2 s after the referee stops typing (or when they leave the box) */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function edit(e: Entry, d: Draft, delayMs: number) {
    if (!allowed) return notifyCallRoomOpen();
    if (locked(e.id)) return notify('Did not report', `${entryName(e)} did not report to the call room, so no result can be entered. The call room official can correct it if that is a mistake.`);
    setDrafts((x) => ({ ...x, [e.id]: d }));
    const old = timers.current.get(e.id);
    if (old) clearTimeout(old);
    timers.current.set(
      e.id,
      setTimeout(() => {
        timers.current.delete(e.id);
        save(e, d, true);
      }, delayMs)
    );
  }
  function flush(e: Entry) {
    const old = timers.current.get(e.id);
    if (old) clearTimeout(old);
    timers.current.delete(e.id);
    if (isDirty(e.id)) save(e, undefined, false);
  }

  async function saveAll() {
    for (const e of entries) if (isDirty(e.id)) if (!(await save(e))) return;
  }

  async function finalize() {
    if (!data) return;
    const dirty = entries.filter((e) => isDirty(e.id)).length;
    if (dirty) return notify('Save first', `${dirty} result${dirty === 1 ? ' is' : 's are'} typed but not saved.`);
    if (!allowed) return notifyCallRoomOpen();
    const missing = entries.filter((e) => !saved.has(e.id) && !locked(e.id)).length;
    const final = data.heat.stage === 'FINAL';
    const msg = `${missing ? `${missing} lane${missing === 1 ? ' has' : 's have'} no result. ` : ''}${final ? 'This is the final: championship points are awarded now.' : 'The heat will be marked done.'}`;
    if (!(await confirm('Finish this heat?', msg, 'Finish & save'))) return;
    setBusy(true);
    const r = await submitOp(
      { path: '/track/finalize', heatId, label: 'Results finalized', body: { heatId, eventId: data.heat.events.id, stage: data.heat.stage } },
      { queueable: false, flushFirst: true }
    );
    setBusy(false);
    if (r.status === 'ok') {
      afterFinalize(r.data, heatId);
    } else notify('Not finalized', (r as any).message || 'Try again.');
  }

  if (!data) {
    return (
      <Card>
        <Muted>{error || 'Loading the heat…'}</Muted>
      </Card>
    );
  }

  const done = ['COMPLETED', 'OFFICIAL'].includes(data.heat.status);
  const dirtyCount = entries.filter((e) => isDirty(e.id)).length;
  const lanes = data.heat.events.start_type === 'lanes';

  const unitOf = (e: Entry) => e.profiles?.squads?.colleges?.code || e.relay_teams?.squads?.colleges?.code || '';
  const bibOf = (e: Entry) => e.profiles?.bid_number ?? '';

  // FINAL RESULT block: finishers by place, then DNF / DQ / DNS (no position)
  const resultRows = entries
    .map((e) => ({ e, v: locked(e.id) ? ({ time: '', status: 'DNS', dq: '' } as Draft) : drafts[e.id] ?? saved.get(e.id), place: places.get(e.id) }))
    .filter((r) => r.v)
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || a.e.lane_number - b.e.lane_number);

  const W = { lane: 54, bib: 64, name: 210, unit: 80, status: 220, perf: 120, rem: 180, save: 112 };
  const entryCols: Col[] = [
    { key: 'lane', title: lanes ? 'LANE No.' : 'ORDER', width: W.lane },
    { key: 'bib', title: 'BIB No.', width: W.bib },
    { key: 'name', title: 'NAME of the ATHLETES', width: W.name },
    { key: 'unit', title: 'UNIT', sub: 'College', width: W.unit },
    { key: 'status', title: 'STATUS', width: W.status },
    { key: 'perf', title: 'PERFORMANCE', sub: 'Time', width: W.perf },
    { key: 'rem', title: 'REMARKS', sub: 'DQ rule', width: W.rem },
    ...(!done ? [{ key: 'save', title: 'SAVED', sub: 'automatic', width: W.save }] : []),
  ];
  const resultCols: Col[] = [
    { key: 'pos', title: 'POSITION', width: 104 },
    { key: 'bib', title: 'BIB No.', width: W.bib },
    { key: 'name', title: 'NAME of the ATHLETES', width: W.name },
    { key: 'unit', title: 'UNIT', width: W.unit },
    { key: 'perf', title: 'PERFORMANCE', width: W.perf },
    { key: 'rem', title: 'REMARKS', width: W.rem },
  ];

  const perfText = (v: Draft | undefined) => (!v ? '' : v.status === 'FINISHED' ? v.time : v.status);
  const printable = () => ({
    title: 'REPORT of REFEREE TRACK',
    heat: data.heat,
    startAt,
    referee: staffName,
    signatures: ['REFEREE TRACK', 'CHIEF JUDGE - TRACK', 'CHIEF TIME-KEEPER'],
    tables: [
      {
        cols: [
          { title: lanes ? 'LANE No.' : 'ORDER' },
          { title: 'BIB No.' },
          { title: 'NAME of the ATHLETES' },
          { title: 'UNIT', sub: 'College' },
          { title: 'PERFORMANCE', sub: 'Time' },
          { title: 'PLACE' },
          { title: 'REMARKS', sub: 'DQ rule' },
        ],
        rows: entries.map((e) => {
          const v = drafts[e.id] ?? saved.get(e.id);
          const pl = places.get(e.id);
          return { cells: [e.lane_number, bibOf(e), entryName(e), unitOf(e), perfText(v), pl ? ordinal(pl) : '', v?.status === 'DQ' ? v.dq : ''] };
        }),
      },
      {
        heading: 'FINAL RESULT',
        cols: [{ title: 'POSITION' }, { title: 'BIB No.' }, { title: 'NAME of the ATHLETES' }, { title: 'UNIT' }, { title: 'PERFORMANCE' }, { title: 'REMARKS' }],
        // At least 8 rows like the paper card, so a sheet printed early can be filled in by hand
        rows: Array.from({ length: Math.max(8, resultRows.length) }, (_, i) => {
          const r = resultRows[i];
          if (!r) return { cells: [resultRows.length ? '' : POSITION_WORD[i] || '', '', '', '', '', ''] };
          return { cells: [r.place ? POSITION_WORD[r.place - 1] || ordinal(r.place) : '—', bibOf(r.e), entryName(r.e), unitOf(r.e), perfText(r.v), r.v?.status === 'DQ' ? r.v.dq : ''] };
        }),
      },
    ],
  });

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Entries are saved on this device and sent when the network is back." />
      <HeatHeader data={data.heat} />
      <CallRoomGate heatId={heatId} status={data.heat.status} offline={offline} onClosed={reload} />

      <SheetTitle title="REPORT of REFEREE TRACK" />
      <SheetInfo heat={data.heat} startAt={startAt} />

      <SheetNote>Type times like 10.42 or 1:52.34 — each result saves itself. Places and the FINAL RESULT fill in automatically. Finalize when every lane has a result.</SheetNote>

      <SheetGrid cols={entryCols}>
        {entries.map((e) => {
          const v = valueOf(e.id);
          const dirty = isDirty(e.id);
          const waiting = pending.some((p) => (p.body as any).heatAthleteId === e.id);
          return (
            <SheetRow key={e.id} style={dirty ? { backgroundColor: colors.amberSoft } : locked(e.id) ? { opacity: 0.55 } : undefined}>
              <Cell width={W.lane} text={e.lane_number} textStyle={{ fontWeight: '900' }} />
              <Cell width={W.bib} text={bibOf(e)} />
              <Cell width={W.name} text={entryName(e)} align="left" />
              <Cell width={W.unit} text={unitOf(e)} />
              <Cell width={W.status}>
                <View style={s.statuses}>
                  {STATUSES.map((st) => (
                    <Pressable
                      key={st.key}
                      disabled={done || locked(e.id)}
                      onPress={() => edit(e, { ...v, status: st.key }, st.key === 'FINISHED' ? 1200 : 0)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: v.status === st.key }}
                      style={[s.st, v.status === st.key && s.stOn]}
                    >
                      <Text style={[s.stText, v.status === st.key && s.stTextOn]}>{st.key === 'FINISHED' ? 'FIN' : st.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </Cell>
              <Cell width={W.perf}>
                {v.status === 'FINISHED' ? (
                  <TextInput
                    value={v.time}
                    editable={!done}
                    onChangeText={(t) => edit(e, { ...v, time: t.replace(/[^0-9.:,]/g, '') }, 1200)}
                    onBlur={() => flush(e)}
                    onSubmitEditing={() => flush(e)}
                    placeholder="time"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numbers-and-punctuation"
                    style={s.cellInput}
                    accessibilityLabel={`Time for ${entryName(e)}`}
                  />
                ) : (
                  <Text style={s.cellStatus}>{locked(e.id) ? notReported.get(e.id) : v.status}</Text>
                )}
              </Cell>
              <Cell width={W.rem}>
                {v.status === 'DQ' ? (
                  <TextInput
                    value={v.dq}
                    editable={!done}
                    onChangeText={(t) => edit(e, { ...v, dq: t }, 1200)}
                    onBlur={() => flush(e)}
                    placeholder="Rule, e.g. TR 16.8"
                    placeholderTextColor="#94a3b8"
                    style={[s.cellInput, { fontSize: 13, textAlign: 'left' }]}
                    accessibilityLabel={`Disqualification rule for ${entryName(e)}`}
                  />
                ) : (
                  <Text style={s.cellRemark}>{places.get(e.id) ? ordinal(places.get(e.id)!) : ''}</Text>
                )}
              </Cell>
              {!done && (
                <Cell width={W.save}>
                  {dirty && v.status === 'FINISHED' && v.time && parseTime(v.time) == null ? (
                    <Text style={[s.saveState, { color: colors.red }]}>Check time</Text>
                  ) : (
                    <Text style={[s.saveState, { color: dirty ? colors.amber : waiting ? colors.amber : saved.has(e.id) ? colors.green : colors.muted }]}>
                      {locked(e.id) ? 'Not reported' : dirty ? 'Saving…' : waiting ? 'Queued' : saved.has(e.id) ? 'Saved ✓' : '—'}
                    </Text>
                  )}
                </Cell>
              )}
            </SheetRow>
          );
        })}
      </SheetGrid>

      <Text style={s.blockTitle}>FINAL RESULT</Text>
      <SheetGrid cols={resultCols}>
        {Array.from({ length: Math.max(8, resultRows.length) }, (_, i) => {
          const r = resultRows[i];
          const pos = r?.place;
          return (
            <SheetRow key={i}>
              <Cell width={104} align="left" text={r ? (pos ? POSITION_WORD[pos - 1] || ordinal(pos) : '—') : resultRows.length ? '' : POSITION_WORD[i] || ''} textStyle={{ fontWeight: '900' }} />
              <Cell width={W.bib} text={r ? bibOf(r.e) : ''} />
              <Cell width={W.name} align="left" text={r ? entryName(r.e) : ''} />
              <Cell width={W.unit} text={r ? unitOf(r.e) : ''} />
              <Cell width={W.perf} text={r ? (r.v!.status === 'FINISHED' ? r.v!.time : r.v!.status) : ''} textStyle={{ fontWeight: '900' }} />
              <Cell width={W.rem} text={r ? (r.v!.status === 'DQ' ? r.v!.dq : drafts[r.e.id] && isDirty(r.e.id) ? 'not saved' : '') : ''} textStyle={{ fontSize: 12 }} />
            </SheetRow>
          );
        })}
      </SheetGrid>

      <PrintSheetButton build={printable} />

      {!done ? (
        <View style={s.footer}>
          {dirtyCount > 0 && <Button title={`Save all (${dirtyCount})`} onPress={saveAll} style={{ flexGrow: 1 }} />}
          <Button title="Finish heat & save results" icon="check" variant={dirtyCount ? 'secondary' : 'gold'} onPress={finalize} loading={busy} style={{ flexGrow: 1 }} />
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
  statuses: { flexDirection: 'row', gap: 4 },
  st: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  stOn: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  stText: { fontSize: 11, fontWeight: '800', color: colors.muted },
  stTextOn: { color: colors.blue },
  cellInput: { minHeight: 36, fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center', paddingVertical: 2, backgroundColor: '#fffbea' },
  cellStatus: { fontSize: 15, fontWeight: '900', color: colors.red, textAlign: 'center' },
  cellRemark: { fontSize: 13, fontWeight: '800', color: colors.blue, textAlign: 'center' },
  blockTitle: { textAlign: 'center', fontSize: 15, fontWeight: '900', fontStyle: 'italic', color: '#111827' },
  footer: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  saveState: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
});
