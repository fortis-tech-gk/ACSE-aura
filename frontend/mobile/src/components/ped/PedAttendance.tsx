import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PedHeatEntry, PedUnit } from '@/lib/ped-session';
import { fmtDay, fmtTime, stageLabel } from '@/lib/format';
import { Card, Muted, Pill, SectionLabel, colors, useNow } from '@/components/ui';

const HEAT_OPEN = ['SCHEDULED', 'DELAYED', 'CALL_ROOM'];
type Tone = 'green' | 'amber' | 'red' | 'grey' | 'gold' | 'navy' | 'blue';

export function heatTitle(h: { eventName: string; stage: string; heatNumber: number | null }): string {
  if (h.stage === 'FINAL') return `${h.eventName} · Final`;
  const stage = (stageLabel(h.stage) || 'Heats').replace(/s$/, '');
  return h.heatNumber ? `${h.eventName} · ${stage} ${h.heatNumber}` : `${h.eventName} · ${stage === 'Heat' ? 'Round 1' : stage}`;
}

/** Still to come or in the call room now */
function isOpen(u: PedUnit): boolean {
  if (u.mode === 'NOT_OPEN') return true;
  if (u.mode === 'ROLL_CALL') return u.status === 'ROLL_CALL_OPEN';
  return HEAT_OPEN.includes(u.status);
}

function stateTone(state: string, open: boolean): { label: string; tone: Tone } {
  switch (state) {
    case 'REPORTED':
      return { label: 'Reported', tone: 'green' };
    case 'NOT_REPORTED':
      return { label: 'Not reported', tone: open ? 'amber' : 'red' };
    case 'DNS':
      return { label: 'DNS', tone: 'red' };
    case 'SCRATCH':
    case 'SCRATCHED':
      return { label: 'Scratched', tone: 'grey' };
    case 'REPLACED':
      return { label: 'Reserve came in', tone: 'grey' };
    case 'NOT_ACCREDITED':
      return { label: 'Not accredited', tone: 'red' };
    case 'PAYMENT_PENDING':
      return { label: 'Payment pending', tone: 'red' };
    case 'NOT_ON_ROLL_CALL':
      return { label: 'Not on roll call', tone: 'red' };
    default:
      return { label: state.replace(/_/g, ' '), tone: 'grey' };
  }
}

function unitPill(u: PedUnit): { label: string; tone: Tone } {
  if (u.mode === 'NOT_OPEN') return { label: 'Roll call not open', tone: 'grey' };
  if (u.mode === 'ROLL_CALL') return u.status === 'ROLL_CALL_OPEN' ? { label: 'Roll call open', tone: 'gold' } : { label: 'Heats drawn', tone: 'green' };
  if (u.status === 'CALL_ROOM') return { label: 'Call room open', tone: 'gold' };
  if (u.status === 'ON_TRACK' || u.status === 'IN_PROGRESS') return { label: 'On track', tone: 'navy' };
  if (u.status === 'COMPLETED' || u.status === 'OFFICIAL') return { label: 'Finished', tone: 'green' };
  return { label: 'Scheduled', tone: 'grey' };
}

function EntryRow({ e, open }: { e: PedHeatEntry; open: boolean }) {
  const st = stateTone(e.state, open);
  return (
    <View style={s.row}>
      <Text style={s.lane}>{e.lane ?? '·'}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={2}>
          {e.name}
        </Text>
        {e.bib != null ? <Muted style={s.bib}>Bib {e.bib}</Muted> : null}
      </View>
      <Pill label={st.label} tone={st.tone} />
    </View>
  );
}

const NEEDS_ACTION = new Set(['NOT_REPORTED', 'NOT_ACCREDITED', 'PAYMENT_PENDING', 'NOT_ON_ROLL_CALL']);

function UnitCard({ u, now }: { u: PedUnit; now: number }) {
  const open = isOpen(u);
  const missing = u.entries.filter((e) => NEEDS_ACTION.has(e.state)).length;
  const mins = u.callRoomAt ? Math.round((new Date(u.callRoomAt).getTime() - now) / 60000) : null;
  const pill = unitPill(u);
  return (
    <Card style={[s.card, open && missing > 0 && mins != null && mins <= 30 && s.urgent]}>
      <View style={s.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title}>{heatTitle(u)}</Text>
          <Muted style={s.sub}>
            {u.callRoomAt ? `${fmtDay(u.callRoomAt)} · Call room ${fmtTime(u.callRoomAt)}${u.callRoomEstimated ? ' (approx.)' : ''}` : 'Time to be announced'}
            {open && mins != null && mins > 0 && mins <= 120 ? ` · in ${mins} min` : ''}
          </Muted>
        </View>
        <Pill label={pill.label} tone={pill.tone} />
      </View>
      {u.entries.map((e) => (
        <EntryRow key={e.heatAthleteId} e={e} open={open} />
      ))}
    </Card>
  );
}

export function PedAttendance({ data }: { data: { units?: PedUnit[] } | null }) {
  const now = useNow(30_000);
  if (!data?.units) return <Muted style={{ textAlign: 'center', marginTop: 24 }}>Loading…</Muted>;
  const live = data.units.filter(isOpen);
  const done = data.units.filter((u) => !isOpen(u)).reverse();
  const missingSoon = live
    .filter((u) => u.callRoomAt && new Date(u.callRoomAt).getTime() - now < 60 * 60000)
    .reduce((n, u) => n + u.entries.filter((e) => NEEDS_ACTION.has(e.state)).length, 0);

  if (!data.units.length) {
    return (
      <Card>
        <Text style={s.title}>Nothing to show yet</Text>
        <Muted>Your athletes appear here once their events are on the schedule. You get alerts 30, 20 and 10 minutes before the call room for anyone who has not reported, and when the call room closes.</Muted>
      </Card>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {missingSoon > 0 ? (
        <Card style={s.alert}>
          <Text style={s.alertText}>
            {missingSoon} athlete{missingSoon === 1 ? '' : 's'} not reported for call rooms in the next hour
          </Text>
        </Card>
      ) : null}
      <Muted style={{ fontSize: 13 }}>First rounds use the event roll call; later rounds report heat by heat.</Muted>
      <SectionLabel>UPCOMING & LIVE</SectionLabel>
      {live.length ? live.map((u) => <UnitCard key={u.key} u={u} now={now} />) : <Muted>Nothing left to run.</Muted>}
      {done.length ? (
        <>
          <SectionLabel>DONE</SectionLabel>
          {done.map((u) => (
            <UnitCard key={u.key} u={u} now={now} />
          ))}
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: 8 },
  urgent: { borderWidth: 2, borderColor: colors.amber },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 2 },
  title: { fontSize: 16, fontWeight: '900', color: colors.navy },
  sub: { fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  lane: { width: 26, textAlign: 'center', fontWeight: '900', color: colors.muted },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  bib: { fontSize: 12 },
  alert: { backgroundColor: colors.amberSoft },
  alertText: { color: colors.amber, fontWeight: '900' },
});
