/**
 * Strict call room, referee side: results can be entered only after the call room has closed,
 * and only for entries that reported. While the call room is still open the sheet is visible
 * (start list) but locked, with a way out when the call room tablet has no internet: the call
 * room official types their own PIN on this tablet and the call room is closed from here.
 */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { notify } from '@/lib/officials/confirm';
import { Button, Card, Icon, Muted, colors, fonts, styles as ui } from '@/components/ui';

const OPEN_STATES = ['SCHEDULED', 'DELAYED', 'CALL_ROOM'];

/** True once the call room has closed (heat sent to the track, or results done) */
export function callRoomClosed(status: string | undefined | null): boolean {
  return !!status && !OPEN_STATES.includes(status);
}

/**
 * Can the referee type a result now? Online: only after the close. Offline: the tablet can't
 * know, so typing is allowed and the server checks every entry when it is sent.
 */
export function canEnterResults(status: string | undefined | null, offline: boolean): boolean {
  return callRoomClosed(status) || offline;
}

export function notifyCallRoomOpen() {
  notify("Call room isn't closed yet", 'Results can be entered after the call room closes and sends this heat to the track.');
}

/** Shown above the sheet while the call room is still open */
export function CallRoomGate({ heatId, status, offline, onClosed }: { heatId: string; status: string; offline: boolean; onClosed: () => void }) {
  const { submitOp } = useOfficialSession();
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (callRoomClosed(status)) return null;

  async function closeHere() {
    if (!/^\d{4,8}$/.test(pin)) return setError("Type the call room official's PIN.");
    setBusy(true);
    setError(null);
    const r = await submitOp({ path: '/callroom/override-close', body: { heatId, pin }, label: 'Call room closed from the referee tablet', heatId }, { queueable: false });
    setBusy(false);
    if (r.status === 'ok') {
      setAsking(false);
      setPin('');
      notify('Call room closed', `Closed with ${r.data?.closedBy || 'the call room'}'s PIN. Athletes who did not report are DNS.`);
      onClosed();
    } else {
      setError((r as any).message || 'Could not close the call room.');
    }
  }

  return (
    <Card style={s.card}>
      <View style={s.row}>
        <View style={s.icon}>
          <Icon name="door" size={22} color={colors.goldBright} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.title}>{offline ? 'Offline — call room status unknown' : 'Waiting for the call room'}</Text>
          <Muted style={{ fontSize: 13 }}>
            {offline
              ? 'You can type results; each one is checked when it is sent. Results for athletes who did not report will be refused.'
              : status === 'CALL_ROOM'
                ? 'The call room is open. Results can be entered after it closes and sends this heat to the track.'
                : 'The call room has not opened yet. Results can be entered after it closes.'}
          </Muted>
        </View>
      </View>
      {!offline && (
        <Pressable onPress={() => setAsking(true)} accessibilityRole="button" style={s.link}>
          <Text style={s.linkText}>Call room tablet offline? Close it here</Text>
        </Pressable>
      )}

      <Modal visible={asking} transparent animationType="fade" onRequestClose={() => setAsking(false)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Close the call room here</Text>
            <Muted>
              Use this only when the call room tablet has no internet. The <Text style={{ fontWeight: '800' }}>call room official</Text> types their own PIN.
              Everyone who has not reported becomes DNS; scans the call room tablet made before now are still counted when it comes back online.
            </Muted>
            <View>
              <Text style={ui.fieldLabel}>Call room official&apos;s PIN</Text>
              <View style={[ui.field, s.pinField]}>
                <Icon name="lock" size={20} color={colors.muted} />
                <TextInput
                  value={pin}
                  onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                  placeholder="••••••"
                  placeholderTextColor="#b4b9c4"
                  style={s.pin}
                  accessibilityLabel="Call room official's PIN"
                  onSubmitEditing={closeHere}
                />
              </View>
            </View>
            {!!error && <Text style={s.error}>{error}</Text>}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Cancel" variant="secondary" onPress={() => (setAsking(false), setPin(''), setError(null))} style={{ flex: 1 }} />
              <Button title="Close call room" variant="gold" onPress={closeHere} loading={busy} style={{ flex: 1.4 }} />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

const s = StyleSheet.create({
  card: { gap: 10, backgroundColor: colors.navy, borderColor: 'rgba(233,199,104,0.45)' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  link: { alignSelf: 'flex-start', paddingVertical: 4 },
  linkText: { color: colors.goldBright, fontWeight: '800', fontSize: 14, textDecorationLine: 'underline' },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,18,38,0.6)', justifyContent: 'center', padding: 18 },
  sheet: { backgroundColor: colors.card, borderRadius: 22, padding: 20, gap: 14, width: '100%', maxWidth: 480, alignSelf: 'center' },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.navy },
  pinField: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pin: { flex: 1, minWidth: 0, fontSize: 24, fontWeight: '800', letterSpacing: 8, color: colors.text, paddingVertical: 10 },
  error: { color: colors.red, fontWeight: '700' },
});
