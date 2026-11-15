import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useOfficialSession, type Outcome } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { useOfficialsLayout } from '@/lib/officials/layout';
import { athleteIdFromQr } from '@/lib/officials/scan-logic';
import { confirm, notify } from '@/lib/officials/confirm';
import { one } from '@/lib/officials/heats';
import type { AthleteRef, OpPayload } from '@/lib/officials/types';
import { ScanPanel } from './ScanPanel';
import { HeatHeader } from './HeatHeader';
import { callRoomClosed } from './CallRoomGate';
import { Button, Card, Muted, OfflineBanner, Pill, colors, shadow } from '@/components/ui';

type Member = { id: string; leg_order: number | null; is_reserve: boolean; profiles: { id: string; sslc_name: string; bid_number: number | null; squads: { gender: string } | null } | null };
type Entry = {
  id: string;
  lane_number: number;
  call_room_reported: boolean;
  profiles: { id: string; sslc_name: string; bid_number: number | null; photo_url: string | null; squads: { colleges: { code: string } | null } | null } | null;
  relay_teams: { id: string; squads: { colleges: { code: string; name: string } | null } | null; relay_members: Member[] } | null;
  call_room_inspections: { reported_status: string } | { reported_status: string }[] | null;
};
type HeatData = {
  heat: { id: string; heat_number: number; stage: string; status: string; events: { id: string; name: string; code: string; category: string } };
  athletes: Entry[];
  /** Accredited reserves of the same college, per entry that has not reported (individual events) */
  reserves?: Record<string, { id: string; name: string; bib: number | null }[]>;
};

type CrStatus = 'REPORTED' | 'SCRATCH' | 'DNS' | 'DISQUALIFIED' | null;
const STATUS_UI: Record<string, { label: string; tone: 'green' | 'grey' | 'red' | 'amber' }> = {
  REPORTED: { label: 'Reported', tone: 'green' },
  NONE: { label: 'Not yet', tone: 'grey' },
  SCRATCH: { label: 'Scratched', tone: 'amber' },
  DNS: { label: 'DNS', tone: 'red' },
  DISQUALIFIED: { label: 'Disqualified', tone: 'red' },
};

export function CallRoomHeat({ heatId }: { heatId: string }) {
  const { submitOp, rosterIndex } = useOfficialSession();
  const { wide, cameraHeight, large } = useOfficialsLayout();
  const path = `/callroom/heats/${heatId}`;
  const { data, offline, savedAt, error, reload, pending } = useHeat<HeatData>(heatId, path, 10000);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entries = useMemo(() => data?.athletes || [], [data]);

  /** Server status, then any entry saved on the device but not sent yet */
  const statusOf = useMemo(() => {
    const m = new Map<string, CrStatus>();
    for (const e of entries) {
      const insp = one(e.call_room_inspections);
      m.set(e.id, (insp?.reported_status as CrStatus) || (e.call_room_reported ? 'REPORTED' : null));
    }
    for (const op of pending) {
      if (op.path === '/callroom/inspect') {
        const st = op.body.reportedStatus as string;
        m.set(op.body.heatAthleteId as string, st === 'NOT_REPORTED' ? null : (st as CrStatus));
      } else if (op.path === '/callroom/scan') {
        const e = findEntry(entries, op.body as any, rosterIndex.byBib);
        if (e) m.set(e.id, 'REPORTED');
      }
    }
    return m;
  }, [entries, pending, rosterIndex]);

  const counts = useMemo(() => {
    let reported = 0, missing = 0, out = 0;
    for (const e of entries) {
      const st = statusOf.get(e.id);
      if (st === 'REPORTED') reported++;
      else if (!st) missing++;
      else out++;
    }
    return { reported, missing, out };
  }, [entries, statusOf]);

  const run = useCallback(
    async (op: OpPayload, queueable = true) => {
      const r = await submitOp(op, { queueable });
      if (r.status === 'ok') reload();
      if (r.status === 'rejected' || r.status === 'offline') notify('Not done', r.message);
      return r;
    },
    [submitOp, reload]
  );

  /**
   * Strict call room: nothing before "Open call room", nothing after "Close & send to track".
   * Opening can be done offline — it counts as open here as soon as it is saved on the tablet.
   */
  const serverStatus = data?.heat.status || 'SCHEDULED';
  const openPending = pending.some((op) => op.path === `/schedule/heats/${heatId}/status` && (op.body as any).status === 'CALL_ROOM');
  const st = openPending && ['SCHEDULED', 'DELAYED'].includes(serverStatus) ? 'CALL_ROOM' : serverStatus;
  const isOpen = st === 'CALL_ROOM';
  const isClosed = callRoomClosed(st);

  const onScan = useCallback(
    async (ref: AthleteRef): Promise<Outcome> => {
      if (!isOpen) {
        return isClosed
          ? { tone: 'red', title: 'Call room is closed', detail: 'Athletes who did not report are DNS. Corrections are made in the list below.', athlete: null, offline: false }
          : { tone: 'red', title: 'Open the call room first', detail: 'Tap "Open call room" above. Scanning starts when the call room is open.', athlete: null, offline: false };
      }
      const local = findEntry(entries, ref as any, rosterIndex.byBib);
      const known = 'qrToken' in ref ? rosterIndex.byId.get(athleteIdFromQr(ref.qrToken) || '') : rosterIndex.byBib.get(Number(ref.bib));
      const fallbackAthlete = known ? { name: known.name, bib: known.bib, college: known.collegeCode, photoUrl: known.photoUrl } : null;
      if ('qrToken' in ref && !athleteIdFromQr(ref.qrToken)) {
        return { tone: 'red', title: 'Not an AURA ID card', athlete: null, offline: false };
      }
      // actedAt: when it was scanned — a scan saved offline still counts if it was made before the close
      const r = await submitOp({ path: '/callroom/scan', body: { heatId, ...ref, actedAt: new Date().toISOString() }, label: 'Call room check-in', heatId });
      if (r.status === 'ok') {
        reload();
        const d = r.data;
        const where = d.lane ? `${data && isField(data) ? 'Order' : 'Lane'} ${d.lane}` : '';
        return {
          tone: d.alreadyReported ? 'amber' : 'green',
          title: d.alreadyReported ? 'Already reported' : 'Reported',
          detail: [where, d.relayRole].filter(Boolean).join(' · '),
          athlete: d.athlete,
          offline: false,
        };
      }
      if (r.status === 'rejected') return { tone: 'red', title: 'Not allowed', detail: r.message, athlete: r.data?.athlete || fallbackAthlete, offline: false };
      // Saved on the device
      if (local) return { tone: 'green', title: 'Reported', detail: `${data && isField(data) ? 'Order' : 'Lane'} ${local.lane_number}`, athlete: fallbackAthlete, offline: true };
      return { tone: 'amber', title: 'Saved — will check when online', detail: 'Not found in this heat on the saved list.', athlete: fallbackAthlete, offline: true };
    },
    [entries, rosterIndex, submitOp, heatId, reload, data, isOpen, isClosed]
  );

  async function openCallRoom() {
    setBusy(true);
    await run({ path: `/schedule/heats/${heatId}/status`, method: 'PATCH', body: { status: 'CALL_ROOM' }, label: 'Call room opened', heatId });
    setBusy(false);
  }

  async function sendToTrack() {
    const msg = counts.missing
      ? `${counts.missing} ${counts.missing === 1 ? 'entry has' : 'entries have'} not reported and will be marked DNS (did not start).`
      : 'Everyone has reported.';
    if (!(await confirm('Close the call room?', `${msg} The heat goes to the track.`, 'Close and send'))) return;
    setBusy(true);
    const r = await run({ path: `/callroom/advance/${heatId}`, body: {}, label: 'Sent to track', heatId }, false);
    setBusy(false);
    if (r.status === 'ok') notify('Sent to the track', `${r.data?.result?.reported_athletes ?? counts.reported} reported · ${r.data?.result?.dns_athletes ?? 0} marked DNS.`);
  }

  function setStatus(e: Entry, st: CrStatus | 'NOT_REPORTED') {
    setOpen(null);
    run({ path: '/callroom/inspect', body: { heatAthleteId: e.id, reportedStatus: st, actedAt: new Date().toISOString() }, label: `${entryName(e)}: ${st === 'NOT_REPORTED' ? 'not reported' : STATUS_UI[st || 'NONE'].label}`, heatId });
  }

  async function useReserve(e: Entry, reserve: { id: string; name: string; bib: number | null }) {
    const lane = `${laneLabel(data!)} ${e.lane_number}`;
    if (!(await confirm('Use the reserve?', `${reserve.name} comes in for ${entryName(e)} in ${lane}. ${entryName(e)} will not run this event.`, 'Use reserve'))) return;
    setOpen(null);
    const r = await run({ path: '/callroom/reserve-swap', body: { heatAthleteId: e.id, reserveProfileId: reserve.id }, label: `${lane}: reserve ${reserve.name} in`, heatId }, false);
    if (r.status === 'ok') notify('Reserve in', `${reserve.name} runs in ${lane} and is marked reported.`);
  }

  async function swap(team: NonNullable<Entry['relay_teams']>, leg: number, reserve: Member) {
    const out = team.relay_members.find((m) => m.leg_order === leg && !m.is_reserve);
    if (!(await confirm('Swap runner?', `Leg ${leg}: ${reserve.profiles?.sslc_name} comes in for ${out?.profiles?.sslc_name}.`, 'Swap'))) return;
    await run({ path: '/callroom/relay-swap', body: { relayTeamId: team.id, legOrder: leg, reserveProfileId: reserve.profiles?.id }, label: `Relay leg ${leg} swapped`, heatId }, false);
  }

  if (!data) {
    return (
      <Card>
        <Muted>{error || 'Loading the heat…'}</Muted>
      </Card>
    );
  }

  const scanner = <ScanPanel onScan={onScan} hint="Scan ID card to check in" cameraHeight={wide ? cameraHeight : Math.min(cameraHeight, 320)} large={large} />;

  const list = (
    <View style={{ gap: 10 }}>
      <View style={s.counts}>
        <Count label="Reported" n={counts.reported} tone={colors.green} />
        <Count label="Not yet" n={counts.missing} tone={colors.muted} />
        <Count label="Out" n={counts.out} tone={colors.red} />
      </View>

      {entries.map((e) => {
        const status = statusOf.get(e.id) ?? null;
        const ui = STATUS_UI[status || 'NONE'];
        const team = e.relay_teams;
        return (
          <Card key={e.id} style={{ gap: 8, padding: 12 }}>
            <Pressable onPress={() => setOpen(open === e.id ? null : e.id)} style={s.entry} accessibilityRole="button" accessibilityLabel={`${laneLabel(data)} ${e.lane_number}, ${entryName(e)}, ${ui.label}. Tap to change.`}>
              <View style={s.lane}>
                <Text style={s.laneN}>{e.lane_number}</Text>
                <Text style={s.laneL}>{laneLabel(data)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{entryName(e)}</Text>
                <Muted style={{ fontSize: 13 }}>{entrySub(e)}</Muted>
              </View>
              <Pill label={ui.label} tone={ui.tone} />
            </Pressable>

            {team && (
              <View style={s.members}>
                {[1, 2, 3, 4].map((leg) => {
                  const m = team.relay_members.find((x) => x.leg_order === leg && !x.is_reserve);
                  return (
                    <Text key={leg} style={s.member} numberOfLines={1}>
                      Leg {leg}: {m?.profiles?.sslc_name || '—'}
                      {m?.profiles?.bid_number != null ? ` (${m.profiles.bid_number})` : ''}
                    </Text>
                  );
                })}
                {team.relay_members.filter((x) => x.is_reserve).map((r) => (
                  <Text key={r.id} style={[s.member, { color: colors.muted }]} numberOfLines={1}>
                    Reserve: {r.profiles?.sslc_name}
                    {r.profiles?.bid_number != null ? ` (${r.profiles.bid_number})` : ''}
                  </Text>
                ))}
              </View>
            )}

            {open === e.id && (
              <View style={{ gap: 8 }}>
                <View style={s.actions}>
                  <Chip label="Reported" onPress={() => setStatus(e, 'REPORTED')} />
                  {!isClosed && <Chip label="Not yet" onPress={() => setStatus(e, 'NOT_REPORTED')} />}
                  <Chip label="Scratch" onPress={() => setStatus(e, 'SCRATCH')} />
                  <Chip label="DNS" onPress={() => setStatus(e, 'DNS')} />
                </View>
                {!team && (!status || status === 'DNS') && !isClosed && (data.reserves?.[e.id]?.length ?? 0) > 0 && (
                  <View style={{ gap: 6 }}>
                    <Muted style={{ fontSize: 13 }}>Not here? A reserve from the same college can take this {laneLabel(data).toLowerCase()}:</Muted>
                    <View style={s.actions}>
                      {data.reserves![e.id].map((r) => (
                        <Chip key={r.id} label={`Use reserve: ${r.name}${r.bib != null ? ` (${r.bib})` : ''}`} onPress={() => useReserve(e, r)} />
                      ))}
                    </View>
                  </View>
                )}
                {team && team.relay_members.some((x) => x.is_reserve) && (
                  <View style={{ gap: 6 }}>
                    <Muted style={{ fontSize: 13 }}>Substitute: tap the reserve and the leg they run</Muted>
                    {team.relay_members.filter((x) => x.is_reserve).map((r) => (
                      <View key={r.id} style={s.actions}>
                        <Text style={s.swapName} numberOfLines={1}>{r.profiles?.sslc_name}</Text>
                        {[1, 2, 3, 4].map((leg) => (
                          <Chip key={leg} label={`→ Leg ${leg}`} onPress={() => swap(team, leg, r)} />
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </Card>
        );
      })}
      {entries.length === 0 && (
        <Card>
          <Muted>No athletes in this heat.</Muted>
        </Card>
      )}
    </View>
  );

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Entries are saved on this device and sent when the network is back." />
      <HeatHeader data={data.heat} />

      <View style={s.buttons}>
        {!isOpen && !isClosed && <Button title="Open call room" icon="door" variant="gold" onPress={openCallRoom} loading={busy} style={{ flexGrow: 1 }} />}
        {isOpen && <Button title="Close & send to track" variant="primary" onPress={sendToTrack} loading={busy} style={{ flexGrow: 1 }} />}
      </View>
      {!isOpen && !isClosed && (
        <Muted style={{ fontSize: 13 }}>Scanning starts when the call room is open. Opening it sends a notification to every athlete in this heat.</Muted>
      )}

      {isClosed ? (
        <>
          <Muted style={{ fontSize: 13 }}>
            The call room for this heat is closed: athletes who did not report are DNS. If a scan was missed by mistake, correct that athlete in the list (it is recorded with your name).
          </Muted>
          {list}
        </>
      ) : wide ? (
        <View style={s.wideRow}>
          <View style={{ flex: 3, minWidth: 0 }}>{scanner}</View>
          <View style={{ flex: 2, minWidth: 0 }}>{list}</View>
        </View>
      ) : (
        <>
          {scanner}
          {list}
        </>
      )}
    </View>
  );
}

function findEntry(entries: Entry[], ref: { qrToken?: string; bib?: string }, byBib: Map<number, { id: string }>): Entry | null {
  const id = ref.qrToken ? athleteIdFromQr(ref.qrToken) : ref.bib ? byBib.get(Number(ref.bib))?.id ?? null : null;
  if (!id) return null;
  return (
    entries.find((e) => e.profiles?.id === id) ||
    entries.find((e) => e.relay_teams?.relay_members.some((m) => m.profiles?.id === id)) ||
    null
  );
}

const isField = (d: HeatData | null) => !!d && d.heat.events.category.startsWith('field');
const laneLabel = (d: HeatData) => (isField(d) ? 'Order' : 'Lane');

function entryName(e: Entry): string {
  if (e.profiles) return e.profiles.sslc_name;
  const c = e.relay_teams?.squads?.colleges;
  return c ? `${c.code} relay team` : 'Relay team';
}

function entrySub(e: Entry): string {
  if (e.profiles) return [e.profiles.bid_number != null ? `Bib ${e.profiles.bid_number}` : null, e.profiles.squads?.colleges?.code].filter(Boolean).join(' · ');
  return e.relay_teams?.squads?.colleges?.name || '';
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}>
      <Text style={s.chipText}>{label}</Text>
    </Pressable>
  );
}

function Count({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <View style={s.count}>
      <Text style={[s.countN, { color: tone }]}>{n}</Text>
      <Text style={s.countL}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  wideRow: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  counts: { flexDirection: 'row', gap: 8 },
  count: { flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 10, alignItems: 'center', ...shadow },
  countN: { fontSize: 22, fontWeight: '900' },
  countL: { fontSize: 11, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lane: { width: 48, alignItems: 'center', backgroundColor: colors.navy, borderRadius: 12, paddingVertical: 5, borderBottomWidth: 3, borderBottomColor: colors.gold },
  laneN: { color: colors.goldBright, fontSize: 20, fontWeight: '900' },
  laneL: { color: colors.onNavyMuted, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  members: { gap: 2, paddingLeft: 58 },
  member: { fontSize: 13, color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: '#ead9ac' },
  chipText: { color: colors.navy, fontWeight: '800', fontSize: 14 },
  swapName: { fontSize: 14, fontWeight: '700', color: colors.text, minWidth: 90, flexShrink: 1 },
});
