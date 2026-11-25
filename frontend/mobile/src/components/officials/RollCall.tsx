import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useOfficialSession, type Outcome } from '@/lib/officials/session';
import { useHeat } from '@/lib/officials/useHeat';
import { useOfficialsLayout } from '@/lib/officials/layout';
import { athleteIdFromQr } from '@/lib/officials/scan-logic';
import { confirm, notify } from '@/lib/officials/confirm';
import type { AthleteRef, OpPayload } from '@/lib/officials/types';
import { ScanPanel } from './ScanPanel';
import { Button, Card, Muted, OfflineBanner, Pill, colors, shadow } from '@/components/ui';

type Status = 'PENDING' | 'REPORTED' | 'SCRATCH' | 'DNS';
type Entry = {
  id: string;
  status: Status;
  notes: string;
  substituted_for: string | null;
  profiles: { id: string; sslc_name: string; bid_number: number | null; squads: { colleges: { code: string; name: string } | null } | null } | null;
  relay_teams: {
    id: string;
    squads: { colleges: { code: string; name: string } | null } | null;
    relay_members: { id: string; leg_order: number | null; is_reserve: boolean; profiles: { id: string; sslc_name: string; bid_number: number | null } | null }[];
  } | null;
};
type Data = {
  event: { id: string; name: string; code: string; category: string; max_lanes: number | null };
  stage: string;
  rollCall: { id: string; status: 'OPEN' | 'DRAWN'; num_heats: number | null } | null;
  entries: Entry[];
  reserves: Record<string, { id: string; name: string; bib: number | null }[]>;
};

const UI: Record<Status, { label: string; tone: 'green' | 'grey' | 'red' | 'amber' }> = {
  REPORTED: { label: 'Present', tone: 'green' },
  PENDING: { label: 'Not yet', tone: 'grey' },
  SCRATCH: { label: 'Scratched', tone: 'amber' },
  DNS: { label: 'DNS', tone: 'red' },
};

/**
 * Event roll call: every entrant of the event's first round reports here, then the call room
 * prepares the heats from the athletes who are present and they go straight to the referee.
 */
export function RollCall({ eventId, stage }: { eventId: string; stage: string }) {
  const { submitOp, rosterIndex } = useOfficialSession();
  const { wide, cameraHeight, large } = useOfficialsLayout();
  const tag = `rc:${eventId}:${stage}`;
  const path = `/callroom/rollcalls/${eventId}?stage=${stage}`;
  const { data, offline, savedAt, error, reload, pending } = useHeat<Data>(tag, path, 10000);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entries = useMemo(() => data?.entries || [], [data]);
  const rc = data?.rollCall || null;
  const isOpen = rc?.status === 'OPEN';
  const drawn = rc?.status === 'DRAWN';
  const field = !!data?.event.category.startsWith('field');
  const relay = data?.event.category === 'relay';

  /** Server status, then what is saved on the device but not sent yet */
  const statusOf = useMemo(() => {
    const m = new Map<string, Status>();
    for (const e of entries) m.set(e.id, e.status);
    for (const op of pending) {
      if (op.path === '/callroom/rollcalls/mark') m.set(op.body.entryId as string, op.body.status as Status);
      else if (op.path === '/callroom/rollcalls/scan') {
        const e = findEntry(entries, op.body as any, rosterIndex.byBib);
        if (e && m.get(e.id) !== 'SCRATCH') m.set(e.id, 'REPORTED');
      }
    }
    return m;
  }, [entries, pending, rosterIndex]);

  const counts = useMemo(() => {
    let present = 0, missing = 0, out = 0;
    for (const e of entries) {
      const st = statusOf.get(e.id);
      if (st === 'REPORTED') present++;
      else if (st === 'PENDING') missing++;
      else out++;
    }
    return { present, missing, out };
  }, [entries, statusOf]);

  const run = useCallback(
    async (op: OpPayload, queueable = true) => {
      const r = await submitOp({ ...op, heatId: tag }, { queueable });
      if (r.status === 'ok') reload();
      if (r.status === 'rejected' || r.status === 'offline') notify('Not done', r.message);
      return r;
    },
    [submitOp, reload, tag]
  );

  const onScan = useCallback(
    async (ref: AthleteRef): Promise<Outcome> => {
      if (!isOpen) {
        return drawn
          ? { tone: 'red', title: 'Heats already prepared', detail: 'Athletes who did not report are DNS.', athlete: null, offline: false }
          : { tone: 'red', title: 'Open the roll call first', detail: 'Tap "Open roll call" above.', athlete: null, offline: false };
      }
      if ('qrToken' in ref && !athleteIdFromQr(ref.qrToken)) return { tone: 'red', title: 'Not an AURA ID card', athlete: null, offline: false };
      const known = 'qrToken' in ref ? rosterIndex.byId.get(athleteIdFromQr(ref.qrToken) || '') : rosterIndex.byBib.get(Number(ref.bib));
      const fallback = known ? { name: known.name, bib: known.bib, college: known.collegeCode, photoUrl: known.photoUrl } : null;
      const r = await submitOp({ path: '/callroom/rollcalls/scan', body: { eventId, stage, ...ref, actedAt: new Date().toISOString() }, label: 'Roll call check-in', heatId: tag });
      if (r.status === 'ok') {
        reload();
        return { tone: r.data.alreadyReported ? 'amber' : 'green', title: r.data.alreadyReported ? 'Already present' : 'Present', detail: r.data.relayRole || '', athlete: r.data.athlete, offline: false };
      }
      if (r.status === 'rejected') return { tone: 'red', title: 'Not allowed', detail: r.message, athlete: r.data?.athlete || fallback, offline: false };
      const local = findEntry(entries, ref as any, rosterIndex.byBib);
      return local
        ? { tone: 'green', title: 'Present', detail: 'Saved on this device', athlete: fallback, offline: true }
        : { tone: 'amber', title: 'Saved — will check when online', detail: 'Not on the saved list of this event.', athlete: fallback, offline: true };
    },
    [isOpen, drawn, rosterIndex, submitOp, eventId, stage, tag, reload, entries]
  );

  async function openRollCall() {
    setBusy(true);
    await run({ path: '/callroom/rollcalls/open', body: { eventId, stage }, label: 'Roll call opened' }, false);
    setBusy(false);
  }

  async function prepareHeats() {
    const lanes = data?.event.max_lanes || 8;
    const heats = field ? 1 : Math.max(1, Math.ceil(counts.present / lanes));
    const msg = [
      `${counts.present} present${field ? '' : ` → about ${heats} heat${heats === 1 ? '' : 's'}`}.`,
      counts.missing ? `${counts.missing} not reported will be DNS (did not start).` : 'Everyone on the list has reported.',
      'The heats go straight to the referee and cannot be redrawn here.',
    ].join(' ');
    if (!(await confirm('Prepare the heats?', msg, 'Prepare heats'))) return;
    setBusy(true);
    const r = await run({ path: '/callroom/rollcalls/prepare', body: { eventId, stage }, label: 'Heats prepared' }, false);
    setBusy(false);
    if (r.status === 'ok') {
      const res = r.data?.result || {};
      notify('Heats prepared', `${res.num_heats ?? '?'} heat${res.num_heats === 1 ? '' : 's'} · ${res.reported ?? counts.present} ${relay ? 'teams' : 'athletes'} · ${res.dns ?? 0} DNS. Sent to the referee.`);
    }
  }

  function mark(e: Entry, status: Status) {
    setOpen(null);
    run({ path: '/callroom/rollcalls/mark', body: { entryId: e.id, status }, label: `${entryName(e)}: ${UI[status].label}` });
  }

  async function bringReserve(e: Entry, reserve: { id: string; name: string; bib: number | null }) {
    if (!(await confirm('Use the reserve?', `${reserve.name} comes in for ${entryName(e)}, who will not compete in this event.`, 'Use reserve'))) return;
    setOpen(null);
    const r = await run({ path: '/callroom/rollcalls/reserve-swap', body: { entryId: e.id, reserveProfileId: reserve.id }, label: `Reserve ${reserve.name} in` }, false);
    if (r.status === 'ok') notify('Reserve in', `${reserve.name} is on the roll call and marked present.`);
  }

  if (!data) {
    return (
      <Card>
        <Muted>{error || 'Loading the roll call…'}</Muted>
      </Card>
    );
  }

  const scanner = <ScanPanel onScan={onScan} hint="Scan ID card — roll call" cameraHeight={wide ? cameraHeight : Math.min(cameraHeight, 320)} large={large} />;

  const list = (
    <View style={{ gap: 10 }}>
      <View style={s.counts}>
        <Count label="Present" n={counts.present} tone={colors.green} />
        <Count label="Not yet" n={counts.missing} tone={colors.muted} />
        <Count label="Out" n={counts.out} tone={colors.red} />
      </View>
      {entries.map((e) => {
        const st = statusOf.get(e.id) || 'PENDING';
        const ui = UI[st];
        const res = data.reserves?.[e.id] || [];
        return (
          <Card key={e.id} style={{ gap: 8, padding: 12 }}>
            <Pressable
              onPress={() => isOpen && setOpen(open === e.id ? null : e.id)}
              style={s.entry}
              accessibilityRole="button"
              accessibilityLabel={`${entryName(e)}, ${ui.label}${isOpen ? '. Tap to change.' : ''}`}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{entryName(e)}</Text>
                <Muted style={{ fontSize: 13 }}>{[entrySub(e), e.notes].filter(Boolean).join(' · ')}</Muted>
              </View>
              <Pill label={ui.label} tone={ui.tone} />
            </Pressable>
            {open === e.id && isOpen && (
              <View style={{ gap: 8 }}>
                <View style={s.actions}>
                  <Chip label="Present" onPress={() => mark(e, 'REPORTED')} />
                  <Chip label="Not yet" onPress={() => mark(e, 'PENDING')} />
                  <Chip label="Scratch" onPress={() => mark(e, 'SCRATCH')} />
                </View>
                {e.profiles && st !== 'REPORTED' && res.length > 0 && (
                  <View style={{ gap: 6 }}>
                    <Muted style={{ fontSize: 13 }}>Not here? A reserve from the same college can come in:</Muted>
                    <View style={s.actions}>
                      {res.map((r) => (
                        <Chip key={r.id} label={`Use reserve: ${r.name}${r.bib != null ? ` (${r.bib})` : ''}`} onPress={() => bringReserve(e, r)} />
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
          </Card>
        );
      })}
      {rc && entries.length === 0 && (
        <Card>
          <Muted>No eligible entrants (accredited, college fees verified) for this event.</Muted>
        </Card>
      )}
    </View>
  );

  return (
    <View style={{ gap: 14 }}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} note="Scans are saved on this device and sent when the network is back. Preparing heats needs the internet." />
      <View style={s.head}>
        <Text style={s.title}>{data.event.name}</Text>
        <Muted>{`${data.stage === 'FINAL' ? 'Final' : 'First round'} · roll call`}</Muted>
      </View>

      {!rc && (
        <>
          <Button title="Open roll call" icon="door" variant="gold" onPress={openRollCall} loading={busy} />
          <Muted style={{ fontSize: 13 }}>
            Every athlete entered in this event comes to the call room and scans in. When the last call is done, tap &ldquo;Prepare heats&rdquo;: the heats are drawn from the athletes who are present and go straight to the referee.
          </Muted>
        </>
      )}
      {isOpen && (
        <View style={s.buttons}>
          <Button title={`Prepare heats (${counts.present} present)`} variant="primary" onPress={prepareHeats} loading={busy} disabled={counts.present === 0} style={{ flexGrow: 1 }} />
          <Button title="Refresh list" variant="secondary" onPress={openRollCall} loading={busy} />
        </View>
      )}
      {drawn && (
        <Card style={{ backgroundColor: colors.greenSoft, borderColor: colors.greenSoft, gap: 8 }}>
          <Text style={{ color: colors.green, fontWeight: '800' }}>
            Heats prepared{rc?.num_heats ? ` (${rc.num_heats})` : ''} and sent to the referee. Athletes who did not report are DNS.
          </Text>
          <Button title="Back to the call room list" variant="secondary" onPress={() => router.back()} />
        </Card>
      )}

      {isOpen ? (
        wide ? (
          <View style={s.wideRow}>
            <View style={{ flex: 3, minWidth: 0 }}>{scanner}</View>
            <View style={{ flex: 2, minWidth: 0 }}>{list}</View>
          </View>
        ) : (
          <>
            {scanner}
            {list}
          </>
        )
      ) : (
        rc && list
      )}
    </View>
  );
}

function findEntry(entries: Entry[], ref: { qrToken?: string; bib?: string }, byBib: Map<number, { id: string }>): Entry | null {
  const id = ref.qrToken ? athleteIdFromQr(ref.qrToken) : ref.bib ? byBib.get(Number(ref.bib))?.id ?? null : null;
  if (!id) return null;
  return entries.find((e) => e.profiles?.id === id) || entries.find((e) => e.relay_teams?.relay_members.some((m) => m.profiles?.id === id)) || null;
}

function entryName(e: Entry): string {
  if (e.profiles) return e.profiles.sslc_name;
  const c = e.relay_teams?.squads?.colleges;
  return c ? `${c.code} relay team` : 'Relay team';
}

function entrySub(e: Entry): string {
  if (e.profiles) return [e.profiles.bid_number != null ? `Bib ${e.profiles.bid_number}` : null, e.profiles.squads?.colleges?.code].filter(Boolean).join(' · ');
  const runners = (e.relay_teams?.relay_members || []).filter((m) => !m.is_reserve).map((m) => m.profiles?.sslc_name).filter(Boolean);
  return [e.relay_teams?.squads?.colleges?.name, runners.join(', ')].filter(Boolean).join(' · ');
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
  head: { gap: 2 },
  title: { fontSize: 22, fontWeight: '900', color: colors.navy },
  buttons: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  wideRow: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  counts: { flexDirection: 'row', gap: 8 },
  count: { flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 10, alignItems: 'center', ...shadow },
  countN: { fontSize: 22, fontWeight: '900' },
  countL: { fontSize: 11, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: '#ead9ac' },
  chipText: { color: colors.navy, fontWeight: '800', fontSize: 14 },
});
