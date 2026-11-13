import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { confirm, notify } from '@/lib/officials/confirm';
import { needsWind, one, parseTime, showTime } from '@/lib/officials/heats';
import { ordinal } from '@/lib/format';
import { HeatHeader } from './HeatHeader';
import { entryName, type EntryPerson } from './entry';
import { Cell, POSITION_WORD, SheetGrid, SheetInfo, SheetNote, SheetRow, SheetSignatures, SheetTitle, type Col } from './ScoreSheet';
import { Button, Card, Muted, OfflineBanner, colors } from '@/components/ui';

type Result = { time_seconds: number | null; status: 'FINISHED' | 'DNF' | 'DQ' | 'DNS'; dq_rule: string | null };
type Entry = EntryPerson & {
  id: string;
  lane_number: number;
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

  /** Did not start / scratched in the call room: pre-filled as DNS, still needs saving */
  const prefill = useMemo(() => {
    const m = new Map<string, Draft>();
    for (const e of entries) {
      const cr = one(e.call_room_inspections)?.reported_status;
      if (cr === 'DNS' || cr === 'SCRATCH') m.set(e.id, { time: '', status: 'DNS', dq: '' });
    }
    return m;
  }, [entries]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [windDraft, setWind] = useState('');
  const [busy, setBusy] = useState(false);
  // Show the saved wind reading until the referee types a new one
  const wind = windDraft || (data?.heat.wind_reading != null ? String(data.heat.wind_reading) : '');

  const valueOf = (id: string): Draft => drafts[id] ?? saved.get(id) ?? prefill.get(id) ?? { time: '', status: 'FINISHED', dq: '' };
  const isDirty = (id: string) => {
    const d = drafts[id] ?? (!saved.has(id) ? prefill.get(id) : undefined);
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
    async (e: Entry): Promise<boolean> => {
      const d = valueOf(e.id);
      const t = d.status === 'FINISHED' ? parseTime(d.time) : null;
      if (d.status === 'FINISHED' && t == null) {
        notify('Check the time', `${entryName(e)}: type the time like 10.42 or 1:52.34`);
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
      setDrafts((x) => {
        const n = { ...x };
        delete n[e.id];
        return n;
      });
      if (r.status === 'ok') reload();
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, saved, prefill, submitOp, heatId, reload]
  );

  async function saveAll() {
    for (const e of entries) if (isDirty(e.id)) if (!(await save(e))) return;
  }

  async function saveWind() {
    const w = Number(wind.replace(',', '.'));
    if (!Number.isFinite(w) || Math.abs(w) > 9.9) return notify('Check the wind', 'Type the wind like +1.2 or -0.4 (m/s).');
    await submitOp({ path: `/schedule/heats/${heatId}/status`, method: 'PATCH', body: { windReading: w }, label: `Wind ${w > 0 ? '+' : ''}${w.toFixed(1)} m/s`, heatId });
  }

  async function finalize() {
    if (!data) return;
    const dirty = entries.filter((e) => isDirty(e.id)).length;
    if (dirty) return notify('Save first', `${dirty} result${dirty === 1 ? ' is' : 's are'} typed but not saved.`);
    const missing = entries.filter((e) => !saved.has(e.id)).length;
    const final = data.heat.stage === 'FINAL';
    const msg = `${missing ? `${missing} lane${missing === 1 ? ' has' : 's have'} no result. ` : ''}${final ? 'This is the final: championship points are awarded now.' : 'The heat will be marked done.'}`;
    if (!(await confirm('Finalize results?', msg, 'Finalize'))) return;
    setBusy(true);
    const r = await submitOp(
      { path: '/track/finalize', heatId, label: 'Results finalized', body: { heatId, eventId: data.heat.events.id, stage: data.heat.stage } },
      { queueable: false }
    );
    setBusy(false);
    if (r.status === 'ok') {
      reload();
      notify('Results finalized', final ? 'Points have been added to the championship standings.' : 'The heat is marked done.');
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
    .map((e) => ({ e, v: drafts[e.id] ?? saved.get(e.id), place: places.get(e.id) }))
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
    ...(!done ? [{ key: 'save', title: 'SAVE', width: W.save }] : []),
  ];
  const resultCols: Col[] = [
    { key: 'pos', title: 'POSITION', width: 104 },
    { key: 'bib', title: 'BIB No.', width: W.bib },
    { key: 'name', title: 'NAME of the ATHLETES', width: W.name },
    { key: 'unit', title: 'UNIT', width: W.unit },
    { key: 'perf', title: 'PERFORMANCE', width: W.perf },
    { key: 'rem', title: 'REMARKS', width: W.rem },
  ];

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Entries are saved on this device and sent when the network is back." />
      <HeatHeader data={data.heat} />

      <SheetTitle title="REPORT of REFEREE TRACK" />
      <SheetInfo
        heat={data.heat}
        startAt={startAt}
        extra={
          needsWind(data.heat.events.code) ? (
            <View style={s.windBox}>
              <Text style={s.windLabel}>WIND (m/s)</Text>
              <View style={s.windRow}>
                <TextInput value={wind} editable={!done} onChangeText={setWind} placeholder="+1.2" placeholderTextColor="#94a3b8" keyboardType="numbers-and-punctuation" style={s.windInput} accessibilityLabel="Wind reading" />
                {!done && <Button title="Save" variant="secondary" onPress={saveWind} />}
              </View>
            </View>
          ) : undefined
        }
      />

      <SheetNote>Type times like 10.42 or 1:52.34. Results are saved on the device first and sent when there is internet. Places and the FINAL RESULT fill in automatically.</SheetNote>

      <SheetGrid cols={entryCols}>
        {entries.map((e) => {
          const v = valueOf(e.id);
          const dirty = isDirty(e.id);
          const waiting = pending.some((p) => (p.body as any).heatAthleteId === e.id);
          return (
            <SheetRow key={e.id} style={dirty ? { backgroundColor: colors.amberSoft } : undefined}>
              <Cell width={W.lane} text={e.lane_number} textStyle={{ fontWeight: '900' }} />
              <Cell width={W.bib} text={bibOf(e)} />
              <Cell width={W.name} text={entryName(e)} align="left" />
              <Cell width={W.unit} text={unitOf(e)} />
              <Cell width={W.status}>
                <View style={s.statuses}>
                  {STATUSES.map((st) => (
                    <Pressable
                      key={st.key}
                      disabled={done}
                      onPress={() => setDrafts((x) => ({ ...x, [e.id]: { ...v, status: st.key } }))}
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
                    onChangeText={(t) => setDrafts((x) => ({ ...x, [e.id]: { ...v, time: t.replace(/[^0-9.:,]/g, '') } }))}
                    placeholder="time"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numbers-and-punctuation"
                    style={s.cellInput}
                    accessibilityLabel={`Time for ${entryName(e)}`}
                  />
                ) : (
                  <Text style={s.cellStatus}>{v.status}</Text>
                )}
              </Cell>
              <Cell width={W.rem}>
                {v.status === 'DQ' ? (
                  <TextInput
                    value={v.dq}
                    editable={!done}
                    onChangeText={(t) => setDrafts((x) => ({ ...x, [e.id]: { ...v, dq: t } }))}
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
                  <Button
                    title={dirty ? 'Save' : waiting ? 'Waiting' : saved.has(e.id) ? 'Saved ✓' : 'Save'}
                    onPress={() => save(e)}
                    disabled={!dirty}
                    variant={dirty ? 'primary' : 'secondary'}
                    style={{ minHeight: 36, paddingVertical: 4, paddingHorizontal: 6 }}
                  />
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

      <SheetSignatures referee={staffName} roles={['REFEREE TRACK', 'CHIEF JUDGE - TRACK', 'CHIEF TIME-KEEPER']} />

      {!done ? (
        <View style={s.footer}>
          {dirtyCount > 0 && <Button title={`Save all (${dirtyCount})`} onPress={saveAll} style={{ flexGrow: 1 }} />}
          <Button title="Finalize results" variant={dirtyCount ? 'secondary' : 'primary'} onPress={finalize} loading={busy} style={{ flexGrow: 1 }} />
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
  windBox: { flexBasis: 200, flexGrow: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#374151', paddingHorizontal: 8, paddingVertical: 5 },
  windLabel: { fontSize: 10, fontWeight: '800', color: colors.muted },
  windRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  windInput: { width: 90, minHeight: 38, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, fontSize: 16, fontWeight: '800', color: colors.text, backgroundColor: '#fff' },
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
});
