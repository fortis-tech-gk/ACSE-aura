import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { Outcome } from '@/lib/officials/session';
import type { AthleteRef } from '@/lib/officials/types';
import { usePhotoUri } from '@/lib/photo-cache';
import { Button, Icon, Muted, colors, useNow } from '@/components/ui';

const TONE = {
  green: { bg: '#047857', icon: '✓' },
  amber: { bg: '#b45309', icon: '!' },
  red: { bg: '#b91c1c', icon: '✕' },
} as const;

/** Green results clear themselves so the queue keeps moving; amber/red wait for a tap */
const AUTO_CLEAR_MS = 2500;
/** The same card held in front of the camera is ignored for this long after its result closes */
const SAME_CARD_COOLDOWN_MS = 4000;

export function ScanPanel({
  onScan,
  hint,
  cameraHeight = 360,
  large = false,
}: {
  onScan: (ref: AthleteRef) => Promise<Outcome>;
  hint: string;
  cameraHeight?: number;
  /** tablet: bigger result text, readable at arm's length */
  large?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [bib, setBib] = useState('');
  // Typing a bib: shrink the camera so the box and Check stay above the keyboard, and show the
  // answer right under the box (the big card can be off-screen / under the keyboard; rehearsal 27-11-2026)
  const [typing, setTyping] = useState(false);
  const [fromBib, setFromBib] = useState(false);
  const lastCode = useRef<{ data: string; at: number } | null>(null);
  const busyRef = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = null;
    if (lastCode.current) lastCode.current.at = Date.now();
    setResult(null);
  }, []);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const run = useCallback(
    async (ref: AthleteRef) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const out = await onScan(ref);
        Vibration.vibrate(out.tone === 'green' ? 60 : [0, 220, 120, 220]);
        setResult(out);
        if (out.tone === 'green') clearTimer.current = setTimeout(close, AUTO_CLEAR_MS);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onScan, close]
  );

  const onBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (result || busyRef.current) return;
      const prev = lastCode.current;
      if (prev && prev.data === data && Date.now() - prev.at < SAME_CARD_COOLDOWN_MS) return;
      lastCode.current = { data, at: Date.now() };
      setFromBib(false);
      run({ qrToken: data });
    },
    [result, run]
  );

  function submitBib() {
    const b = bib.trim();
    if (!/^\d{1,5}$/.test(b)) return;
    setBib('');
    lastCode.current = null;
    setFromBib(true);
    run({ bib: b });
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={[s.cameraBox, { height: typing ? Math.min(cameraHeight, 150) : cameraHeight }]}>
        {!permission ? null : !permission.granted ? (
          <View style={s.permission}>
            <Text style={s.permissionText}>Camera access is needed to scan ID cards.</Text>
            <Button title="Allow camera" onPress={requestPermission} />
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={result || busy ? undefined : onBarcode}
            />
            {!result && (
              <View style={s.frameWrap} pointerEvents="none">
                <View style={[s.frame, { width: Math.min(cameraHeight * 0.6, 300), height: Math.min(cameraHeight * 0.6, 300) }]} />
                <Text style={s.cameraHint}>{busy ? 'Checking…' : hint}</Text>
              </View>
            )}
          </>
        )}

        {result && !typing && <ResultCard result={result} onClose={close} large={large} />}
      </View>

      <View style={s.bibRow}>
        <TextInput
          value={bib}
          onChangeText={(v) => setBib(v.replace(/\D/g, '').slice(0, 5))}
          placeholder="Damaged card? Type bib no."
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={submitBib}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          style={s.bibInput}
          accessibilityLabel="Bib number"
          maxLength={5}
        />
        <Button title="Check" onPress={submitBib} disabled={!bib || busy || !!result} style={{ minWidth: 96 }} />
      </View>
      {result && (typing || fromBib) && (
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={`${result.title}. ${result.athlete?.name || ''}. Tap to scan next.`}
          style={[s.inline, { backgroundColor: TONE[result.tone].bg }]}
        >
          <Text style={s.inlineTitle} numberOfLines={1}>
            {TONE[result.tone].icon} {result.title}
            {result.athlete ? ` · ${result.athlete.name}${result.athlete.bib != null ? ` #${result.athlete.bib}` : ''}` : ''}
          </Text>
          {!!result.detail && <Text style={s.inlineDetail} numberOfLines={2}>{result.detail}</Text>}
          <Text style={s.inlineDetail}>{result.tone === 'green' ? 'Next scan in a moment…' : 'Tap to scan the next card'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function ResultCard({ result, onClose, large }: { result: Outcome; onClose: () => void; large: boolean }) {
  const t = TONE[result.tone];
  const a = result.athlete;
  const k = large ? 1.35 : 1; // text and photo scale on tablets
  // The copy saved on the phone when there is one, so the face shows with no network
  const photoUri = usePhotoUri(a?.photoUrl);
  return (
    <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, s.result, { backgroundColor: t.bg }]} accessibilityRole="alert" accessibilityLabel={`${result.title}. ${a?.name || ''}. Tap to scan next.`}>
      <View style={s.resultTop}>
        <Text style={[s.resultIcon, { fontSize: 56 * k, width: 60 * k }]}>{t.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[s.resultTitle, { fontSize: 28 * k }]} numberOfLines={2}>{result.title}</Text>
          {result.offline && <Text style={s.offlineTag}>Saved on device · will sync</Text>}
        </View>
      </View>

      {a ? (
        <View style={s.athlete}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={[s.photo, { width: 84 * k, height: 104 * k }]} />
          ) : (
            <View style={[s.photo, s.noPhoto, { width: 84 * k, height: 104 * k }]}>
              <Text style={{ fontSize: 34 * k }}>👤</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.name, { fontSize: 22 * k }]} numberOfLines={2}>{a.name}</Text>
            <Text style={[s.meta, { fontSize: 16 * k }]}>{a.bib != null ? `Bib ${a.bib}` : 'No bib'}{a.college ? ` · ${a.college}` : ''}</Text>
          </View>
        </View>
      ) : null}

      {!!result.detail && <Text style={[s.detail, { fontSize: 16 * k, lineHeight: 22 * k }]}>{result.detail}</Text>}
      <Text style={s.tapNext}>{result.tone === 'green' ? 'Next scan in a moment…' : 'Tap to scan the next card'}</Text>
    </Pressable>
  );
}

export function SyncPill({ pending, expired, syncing, onPress }: { pending: number; expired: boolean; syncing: boolean; onPress: () => void }) {
  const tone = expired ? { bg: colors.redSoft, fg: colors.red } : pending ? { bg: colors.amberSoft, fg: colors.amber } : { bg: 'rgba(220,243,231,0.14)', fg: '#7fe0b0' };
  const label = expired ? 'Log in to sync' : pending ? `${syncing ? 'Syncing' : 'Waiting'} · ${pending}` : 'Synced';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Sync status: ${label}. Open scan history.`} style={[s.pill, { backgroundColor: tone.bg }]} hitSlop={8}>
      <Icon name={expired || pending ? 'history' : 'synced'} size={15} color={tone.fg} />
      <Text style={[s.pillText, { color: tone.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function RosterNote({ count, at }: { count: number; at: number | null }) {
  const now = useNow();
  const mins = at ? Math.max(0, Math.round((now - at) / 60000)) : null;
  return (
    <Muted style={{ fontSize: 12, textAlign: 'center' }}>
      {count ? `${count.toLocaleString('en-IN')} athlete${count === 1 ? '' : 's'} saved on this device` : 'Athlete list not downloaded yet — connect to the internet'}
      {mins !== null ? ` · updated ${mins < 1 ? 'just now' : `${mins} min ago`}` : ''}
    </Muted>
  );
}

const s = StyleSheet.create({
  cameraBox: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#000', borderWidth: 3, borderColor: colors.navy },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14, backgroundColor: colors.navy },
  permissionText: { color: '#fff', fontSize: 15, textAlign: 'center' },
  frameWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 14 },
  frame: { borderWidth: 3, borderColor: colors.goldBright, borderRadius: 22 },
  cameraHint: { color: '#fff', fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, overflow: 'hidden' },
  result: { padding: 18, gap: 14, justifyContent: 'center' },
  resultTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  resultIcon: { color: '#fff', fontSize: 56, fontWeight: '900', width: 60, textAlign: 'center' },
  resultTitle: { color: '#fff', fontSize: 28, fontWeight: '900' },
  offlineTag: { color: '#fff', fontSize: 13, fontWeight: '700', opacity: 0.9, marginTop: 2 },
  athlete: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 12 },
  photo: { width: 84, height: 104, borderRadius: 12, backgroundColor: '#fff' },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  name: { color: '#fff', fontSize: 22, fontWeight: '900' },
  meta: { color: '#fff', fontSize: 16, fontWeight: '700', opacity: 0.95 },
  detail: { color: '#fff', fontSize: 16, fontWeight: '600', lineHeight: 22 },
  tapNext: { color: '#fff', opacity: 0.8, fontSize: 13, textAlign: 'center', marginTop: Platform.OS === 'web' ? 0 : 4 },
  bibRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  inline: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  inlineTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  inlineDetail: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  bibInput: { flex: 1, minWidth: 0, minHeight: 52, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, fontSize: 18, fontWeight: '800', backgroundColor: '#fffdf8', color: colors.text },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  pillText: { fontSize: 13, fontWeight: '800' },
});
