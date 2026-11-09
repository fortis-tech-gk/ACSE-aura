import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { useOfficialsLayout } from '@/lib/officials/layout';
import { confirm, notify } from '@/lib/officials/confirm';
import { needsWind, one, parseTime, showTime } from '@/lib/officials/heats';
import { ordinal } from '@/lib/format';
import { HeatHeader } from './HeatHeader';
import { entryName, entrySub, type EntryPerson } from './entry';
import { Button, Card, Muted, OfflineBanner, colors } from '@/components/ui';

type Result = { time_seconds: number | null; status: 'FINISHED' | 'DNF' | 'DQ' | 'DNS'; dq_rule: string | null };
type Entry = EntryPerson & {
  id: string;
  lane_number: number;
  call_room_inspections: { reported_status: string } | { reported_status: string }[] | null;
  track_results: Result | Result[] | null;
};
type HeatData = {
  heat: { id: string; heat_number: number; stage: string; status: string; wind_reading: number | null; events: { id: string; name: string; code: string; category: string; start_type: string } };
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
export function TrackReferee({ heatId }: { heatId: string }) {
  const { submitOp } = useOfficialSession();
  const { wide } = useOfficialsLayout();
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
  const [wind, setWind] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.heat.wind_reading != null) setWind((w) => w || String(data.heat.wind_reading));
  }, [data?.heat.wind_reading]);

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

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Entries are saved on this device and sent when the network is back." />
      <HeatHeader data={data.heat} />

      {needsWind(data.heat.events.code) && (
        <Card style={s.windRow}>
          <Text style={s.label}>Wind (m/s)</Text>
          <TextInput value={wind} onChangeText={setWind} placeholder="+1.2" placeholderTextColor="#94a3b8" keyboardType="numbers-and-punctuation" style={[s.input, { width: 100 }]} accessibilityLabel="Wind reading" />
          <Button title="Save wind" variant="secondary" onPress={saveWind} />
        </Card>
      )}

      <Muted style={{ fontSize: 13 }}>Type times like 10.42 or 1:52.34. Results are saved on the device first and sent when there is internet.</Muted>

      <View style={wide ? s.grid : { gap: 10 }}>
        {entries.map((e) => {
          const v = valueOf(e.id);
          const place = places.get(e.id);
          const dirty = isDirty(e.id);
          const waiting = pending.some((p) => (p.body as any).heatAthleteId === e.id);
          return (
            <Card key={e.id} style={[{ gap: 10, padding: 12 }, wide && s.cell, dirty && { borderColor: colors.amber }]}>
              <View style={s.top}>
                <View style={s.lane}>
                  <Text style={s.laneN}>{e.lane_number}</Text>
                  <Text style={s.laneL}>{lanes ? 'Lane' : 'No.'}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={1}>{entryName(e)}</Text>
                  <Muted style={{ fontSize: 13 }}>{entrySub(e)}</Muted>
                </View>
                {place != null && <Text style={s.place}>{ordinal(place)}</Text>}
              </View>

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
                    <Text style={[s.stText, v.status === st.key && s.stTextOn]}>{st.label}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={s.entryRow}>
                {v.status === 'FINISHED' ? (
                  <TextInput
                    value={v.time}
                    editable={!done}
                    onChangeText={(t) => setDrafts((x) => ({ ...x, [e.id]: { ...v, time: t.replace(/[^0-9.:,]/g, '') } }))}
                    placeholder="Time"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numbers-and-punctuation"
                    style={[s.input, s.timeInput]}
                    accessibilityLabel={`Time for ${entryName(e)}`}
                  />
                ) : v.status === 'DQ' ? (
                  <TextInput
                    value={v.dq}
                    editable={!done}
                    onChangeText={(t) => setDrafts((x) => ({ ...x, [e.id]: { ...v, dq: t } }))}
                    placeholder="Rule (e.g. TR 16.8 false start)"
                    placeholderTextColor="#94a3b8"
                    style={[s.input, { flex: 1, minWidth: 0 }]}
                    accessibilityLabel={`Disqualification rule for ${entryName(e)}`}
                  />
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                {!done && (
                  <Button
                    title={dirty ? 'Save' : waiting ? 'Waiting' : saved.has(e.id) ? 'Saved ✓' : 'Save'}
                    onPress={() => save(e)}
                    disabled={!dirty}
                    variant={dirty ? 'primary' : 'secondary'}
                    style={{ minWidth: 92 }}
                  />
                )}
              </View>
            </Card>
          );
        })}
      </View>

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
  windRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  label: { fontSize: 15, fontWeight: '800', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexBasis: '48%', flexGrow: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lane: { width: 46, alignItems: 'center', backgroundColor: colors.navy, borderRadius: 10, paddingVertical: 4 },
  laneN: { color: '#fff', fontSize: 20, fontWeight: '900' },
  laneL: { color: '#c7d2fe', fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  place: { fontSize: 20, fontWeight: '900', color: colors.blue },
  statuses: { flexDirection: 'row', gap: 6 },
  st: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 2, borderColor: colors.border, backgroundColor: '#fff' },
  stOn: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  stText: { fontSize: 13, fontWeight: '800', color: colors.muted },
  stTextOn: { color: colors.blue },
  entryRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 18, fontWeight: '700', color: colors.text, backgroundColor: '#fff' },
  timeInput: { flex: 1, minWidth: 0, fontSize: 24, letterSpacing: 1 },
  footer: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
});
