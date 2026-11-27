import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { confirm, notify } from '@/lib/confirm';
import { usePedSession, type Gender, type PedEntries, type PedEvent } from '@/lib/ped-session';
import { fmtDay, fmtTime } from '@/lib/format';
import { Button, Card, Muted, Pill, SectionLabel, Select, colors } from '@/components/ui';

export function deadlineText(deadline: string | null, open: boolean): string {
  if (!open) return 'Changes closed';
  if (!deadline) return 'Open — deadline set when the schedule is published';
  return `Change until ${fmtTime(deadline)}, ${fmtDay(deadline)}`;
}

const who = (a: { name: string; bib: number | null }) => (a.bib != null ? `${a.name} (#${a.bib})` : a.name);

function SwapSheet({ event, onClose, onDone }: { event: PedEvent; onClose: () => void; onDone: () => void }) {
  const { call } = usePedSession();
  const [outId, setOutId] = useState<string | null>(event.entries.length === 1 ? event.entries[0].id : null);
  const [inId, setInId] = useState<string | null>(event.reserves.length === 1 ? event.reserves[0].id : null);
  const [giveUp, setGiveUp] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const out = event.entries.find((a) => a.id === outId) || null;
  const res = event.reserves.find((a) => a.id === inId) || null;
  const needsGiveUp = !!res && res.regulars.length >= 2;
  const giveUpEvent = res?.regulars.find((r) => r.id === giveUp) || null;
  const ready = !!out && !!res && (!needsGiveUp || !!giveUpEvent);

  async function save() {
    if (!out || !res) return;
    const lines = [
      `${res.name} runs ${event.name} in place of ${out.name}.`,
      `${out.name} is removed from ${event.name}.`,
      !res.accredited ? `${res.name} is not accredited yet — they must be accredited before the event.` : '',
      needsGiveUp && giveUpEvent ? `${res.name} gives up ${giveUpEvent.name}.` : '',
      'This cannot be undone from the app.',
    ].filter(Boolean);
    if (!(await confirm('Swap the reserve in?', lines.join('\n'), 'Swap'))) return;
    setSaving(true);
    setError(null);
    try {
      const r = await call<{ result: { lane: number | null; droppedReserve: string | null } }>('/ped/reserve-swap', {
        method: 'POST',
        body: { eventId: event.id, outProfileId: out.id, reserveProfileId: res.id, giveUpEventId: needsGiveUp ? giveUp : null },
      });
      const extra = [
        r.result.lane ? `${res.name} takes lane / order ${r.result.lane}.` : '',
        r.result.droppedReserve ? `${out.name} has no individual event left, so their reserve entry for ${r.result.droppedReserve} was removed (Rule 36).` : '',
      ].filter(Boolean);
      notify('Reserve swapped in', [`${res.name} is now entered in ${event.name}.`, ...extra].join('\n'));
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={s.sheet} onPress={() => {}}>
          <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
            <Text style={s.sheetTitle}>Swap reserve · {event.name}</Text>
            <Select
              label="Athlete going out"
              value={outId}
              options={event.entries.map((a) => ({ value: a.id, label: who(a) }))}
              onChange={setOutId}
            />
            <Select
              label="Reserve coming in"
              value={inId}
              options={event.reserves.map((a) => ({
                value: a.id,
                label: who(a),
                sub: a.regulars.length ? `Own events: ${a.regulars.map((r) => r.name).join(', ')}` : 'No other individual event',
              }))}
              onChange={(v) => {
                setInId(v);
                setGiveUp(null);
              }}
            />
            {res && !res.accredited ? (
              <Text style={s.warn}>
                {res.name} is not accredited yet. The call room roll call lists accredited athletes only — get {res.name} accredited before the event, or they cannot compete.
              </Text>
            ) : null}
            {needsGiveUp && res ? (
              <View style={{ gap: 6 }}>
                <Muted>{res.name} already has 2 individual events. An athlete can run at most 2, so pick one to give up.</Muted>
                <Select
                  label="Event to give up"
                  value={giveUp}
                  options={res.regulars.filter((r) => r.open).map((r) => ({ value: r.id, label: r.name }))}
                  onChange={setGiveUp}
                />
                {res.regulars.every((r) => !r.open) ? <Muted style={{ color: colors.red }}>Both of their events are already closed for changes.</Muted> : null}
              </View>
            ) : null}
            {error ? <Text style={s.error}>{error}</Text> : null}
            {needsGiveUp && res && !giveUpEvent ? <Muted style={{ color: colors.amber }}>Choose the event to give up, then tap Swap in.</Muted> : null}
            <Button title="Swap in" variant="gold" onPress={save} loading={saving} disabled={!ready} />
            <Button title="Cancel" variant="ghost" onPress={onClose} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function PedReserves({ data, gender, onChanged }: { data: PedEntries | null; gender: Gender; onChanged: () => void }) {
  const [swapping, setSwapping] = useState<PedEvent | null>(null);
  if (!data?.events) return <Muted style={{ textAlign: 'center', marginTop: 24 }}>Loading…</Muted>;
  const withReserves = data.events.filter((e) => e.reserves.length > 0);
  const others = data.events.filter((e) => e.reserves.length === 0 && e.entries.length > 0);

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 6 }}>
        <Text style={s.title}>Bring a reserve into an event</Text>
        <Muted>
          Until 10 PM the day before the event. The reserve takes the athlete&apos;s place (and lane, if heats are drawn). An athlete can be in at most 2 individual events — a reserve who already has 2 must give one up.
        </Muted>
      </Card>

      <SectionLabel>{gender === 'men' ? "MEN'S" : "WOMEN'S"} EVENTS WITH A RESERVE</SectionLabel>
      {withReserves.length === 0 ? <Muted>No reserves nominated in this squad.</Muted> : null}
      {withReserves.map((e) => (
        <Card key={e.id} style={s.card}>
          <View style={s.head}>
            <Text style={[s.title, { flex: 1 }]}>{e.name}</Text>
            <Pill label={e.open ? 'Open' : 'Closed'} tone={e.open ? 'green' : 'grey'} />
          </View>
          <Muted style={{ fontSize: 13 }}>{deadlineText(e.deadline, e.open)}</Muted>
          <Text style={s.label}>Entered</Text>
          {e.entries.length ? e.entries.map((a) => <Text key={a.id} style={s.name}>{who(a)}</Text>) : <Muted>None</Muted>}
          <Text style={s.label}>Reserve</Text>
          {e.reserves.map((a) => (
            <Text key={a.id} style={s.name}>
              {who(a)}
              <Text style={s.small}>
                {a.regulars.length >= 2 ? '  · has 2 events' : ''}
                {!a.accredited ? '  · not accredited' : ''}
              </Text>
            </Text>
          ))}
          {e.open && e.entries.length > 0 ? <Button title="Swap reserve in" icon="refresh" variant="secondary" onPress={() => setSwapping(e)} /> : null}
        </Card>
      ))}

      {others.length ? (
        <>
          <SectionLabel>OTHER EVENTS</SectionLabel>
          <Card style={{ gap: 4 }}>
            {others.map((e) => (
              <Text key={e.id} style={s.name}>
                {e.name}
                <Text style={s.small}>  · {e.entries.map((a) => a.name).join(', ')}</Text>
              </Text>
            ))}
          </Card>
        </>
      ) : null}

      {swapping ? (
        <SwapSheet
          event={swapping}
          onClose={() => setSwapping(null)}
          onDone={() => {
            setSwapping(null);
            onChanged();
          }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 16, fontWeight: '900', color: colors.navy },
  label: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  small: { fontSize: 13, fontWeight: '600', color: colors.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,30,61,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 32, maxHeight: '90%', width: '100%', maxWidth: 720, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: colors.navy },
  error: { color: colors.red, fontWeight: '700' },
  warn: { color: colors.amber, fontWeight: '700', backgroundColor: colors.amberSoft, padding: 10, borderRadius: 10, lineHeight: 20 },
});
