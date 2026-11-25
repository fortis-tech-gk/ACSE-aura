import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { notify } from '@/lib/confirm';
import { usePedSession, type Gender, type PedEntries, type PedRelay, type PedRelayMember } from '@/lib/ped-session';
import { Button, Card, Icon, Muted, Pill, SectionLabel, colors } from '@/components/ui';
import { deadlineText } from './PedReserves';

const who = (a: { name: string; bib: number | null }) => (a.bib != null ? `${a.name} (#${a.bib})` : a.name);
/** Mixed 4x400m: legs 1 & 3 women, legs 2 & 4 men */
const mixedLegGender = (leg: number): Gender => (leg === 1 || leg === 3 ? 'women' : 'men');

function RunnersSheet({ team, onClose, onDone }: { team: PedRelay; onClose: () => void; onDone: () => void }) {
  const { call } = usePedSession();
  // legs[0..3] = profile id on leg 1..4; start from the current line-up (a withdrawn runner's leg
  // starts empty — they cannot run and are not in the list to tap off)
  const [legs, setLegs] = useState<(string | null)[]>(() =>
    [1, 2, 3, 4].map((l) => team.members.find((m) => !m.isReserve && !m.withdrawn && m.leg === l)?.id ?? null)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = team.members.filter((m) => !m.withdrawn);

  function tap(m: PedRelayMember) {
    setError(null);
    const at = legs.indexOf(m.id);
    if (at >= 0) {
      setLegs(legs.map((x, i) => (i === at ? null : x)));
      return;
    }
    const free = legs.findIndex((x, i) => x === null && (!team.isMixed || mixedLegGender(i + 1) === m.gender));
    if (free < 0) {
      setError(team.isMixed ? `No free ${m.gender === 'women' ? 'women' : 'men'}'s leg. Tap a runner to take them off first.` : 'All 4 legs are taken. Tap a runner to take them off first.');
      return;
    }
    setLegs(legs.map((x, i) => (i === free ? m.id : x)));
  }

  async function save() {
    if (legs.some((x) => !x)) return setError('Choose a runner for every leg.');
    setSaving(true);
    setError(null);
    try {
      await call('/ped/relay-runners', { method: 'POST', body: { relayTeamId: team.teamId, runnerIds: legs } });
      notify('Relay runners saved', `${team.eventName}: the 4 runners are set. The others stay as reserves; the call room can still swap a reserve in on the day.`);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const byId = new Map(team.members.map((m) => [m.id, m]));
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={s.sheet} onPress={() => {}}>
          <ScrollView contentContainerStyle={{ gap: 12 }}>
            <Text style={s.sheetTitle}>Running 4 · {team.eventName}</Text>
            <Muted>
              Tap athletes in running order: the first tap runs leg 1, the next leg 2, and so on. Tap again to take them off.
              {team.isMixed ? ' Mixed relay: legs 1 & 3 women, legs 2 & 4 men.' : ''}
            </Muted>

            <View style={s.legs}>
              {legs.map((id, i) => {
                const m = id ? byId.get(id) : null;
                return (
                  <View key={i} style={[s.leg, m && s.legSet]}>
                    <Text style={s.legNo}>Leg {i + 1}{team.isMixed ? ` · ${mixedLegGender(i + 1) === 'women' ? 'W' : 'M'}` : ''}</Text>
                    <Text style={s.legName} numberOfLines={1}>{m ? m.name : '—'}</Text>
                  </View>
                );
              })}
            </View>

            {eligible.map((m) => {
              const leg = legs.indexOf(m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => tap(m)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: leg >= 0 }}
                  style={({ pressed }) => [s.option, leg >= 0 && s.optionOn, pressed && { opacity: 0.8 }]}
                >
                  <View style={[s.badge, leg >= 0 && s.badgeOn]}>
                    <Text style={[s.badgeText, leg >= 0 && { color: colors.goldBright }]}>{leg >= 0 ? leg + 1 : ''}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{who(m)}</Text>
                    {team.isMixed && m.gender ? <Muted style={{ fontSize: 12 }}>{m.gender === 'women' ? 'Woman' : 'Man'}</Muted> : null}
                  </View>
                  {leg >= 0 ? <Icon name="check" size={20} color={colors.gold} /> : null}
                </Pressable>
              );
            })}

            {error ? <Text style={s.error}>{error}</Text> : null}
            <Button title="Save running 4" variant="gold" onPress={save} loading={saving} disabled={legs.some((x) => !x)} />
            <Button title="Cancel" variant="ghost" onPress={onClose} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function PedRelays({ data, onChanged }: { data: PedEntries | null; gender: Gender; onChanged: () => void }) {
  const [editing, setEditing] = useState<PedRelay | null>(null);
  if (!data?.relays) return <Muted style={{ textAlign: 'center', marginTop: 24 }}>Loading…</Muted>;

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 6 }}>
        <Text style={s.title}>Choose the running 4</Text>
        <Muted>Until 10 PM the day before the relay. Pick the 4 runners and their legs; the rest stay as reserves.</Muted>
      </Card>

      <SectionLabel>RELAY TEAMS</SectionLabel>
      {data.relays.length === 0 ? <Muted>No relay nominations in this squad.</Muted> : null}
      {data.relays.map((t) => {
        const runners = t.members.filter((m) => !m.isReserve).sort((a, b) => (a.leg ?? 9) - (b.leg ?? 9));
        const reserves = t.members.filter((m) => m.isReserve);
        return (
          <Card key={t.teamId} style={s.card}>
            <View style={s.head}>
              <Text style={[s.title, { flex: 1 }]}>{t.eventName}</Text>
              <Pill label={t.open ? 'Open' : 'Closed'} tone={t.open ? 'green' : 'grey'} />
            </View>
            <Muted style={{ fontSize: 13 }}>{deadlineText(t.deadline, t.open)}</Muted>
            <Text style={s.label}>Running</Text>
            {runners.length ? (
              runners.map((m) => (
                <Text key={m.id} style={s.name}>
                  <Text style={s.small}>Leg {m.leg} · </Text>
                  {who(m)}
                </Text>
              ))
            ) : (
              <Muted>Not chosen yet</Muted>
            )}
            {reserves.length ? (
              <>
                <Text style={s.label}>Reserves</Text>
                {reserves.map((m) => (
                  <Text key={m.id} style={s.name}>
                    {who(m)}
                    {m.withdrawn ? <Text style={s.small}> · withdrawn</Text> : null}
                  </Text>
                ))}
              </>
            ) : null}
            {t.members.length < 4 ? <Muted style={{ color: colors.amber }}>Only {t.members.length} nominated — a team needs 4.</Muted> : null}
            {t.open && t.members.length >= 4 ? <Button title="Choose running 4" icon="relay" variant="secondary" onPress={() => setEditing(t)} /> : null}
          </Card>
        );
      })}

      {editing ? (
        <RunnersSheet
          team={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
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
  legs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  leg: { flexBasis: '47%', flexGrow: 1, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 10, backgroundColor: colors.card },
  legSet: { borderColor: colors.gold },
  legNo: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' },
  legName: { fontSize: 15, fontWeight: '800', color: colors.navy },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border },
  optionOn: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  badge: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  badgeOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  badgeText: { fontWeight: '900', color: colors.navy },
  error: { color: colors.red, fontWeight: '700' },
});
