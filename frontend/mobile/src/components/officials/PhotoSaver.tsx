/**
 * "Save photos for offline": downloads every athlete photo on the saved roster to the phone, so a
 * scan shows the athlete's face even with no network. Meant to be run on Wi-Fi before gates open.
 *
 * The run lives outside React, so leaving the screen does not stop it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import { countSavedPhotos, savePhotos, type PhotoSaveProgress } from '@/lib/photo-cache';
import { Button, Card, Muted, colors } from '@/components/ui';

type RunState = { running: boolean; progress: PhotoSaveProgress | null };

let run: RunState = { running: false, progress: null };
let stopRequested = false;
const listeners = new Set<(s: RunState) => void>();
const publish = (next: RunState) => {
  run = next;
  listeners.forEach((l) => l(run));
};

async function startRun(urls: string[]) {
  if (run.running) return;
  stopRequested = false;
  publish({ running: true, progress: { done: 0, saved: 0, failed: 0, total: urls.length } });
  const final = await savePhotos(urls, (p) => publish({ running: true, progress: p }), { shouldStop: () => stopRequested });
  publish({ running: false, progress: final });
}

function useRun(): RunState {
  const [state, setState] = useState(run);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

export function PhotoSaver() {
  const { roster } = useOfficialSession();
  const state = useRun();
  const urls = useMemo(() => roster.map((a) => a.photoUrl).filter((u): u is string => !!u), [roster]);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // Re-count what is on the phone when the roster changes and after each run
  useEffect(() => {
    if (state.running) return;
    // countSavedPhotos is a quick local file check, run after the roster arrives
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedCount(countSavedPhotos(urls));
  }, [urls, state.running]);

  if (Platform.OS === 'web' || urls.length === 0) return null;

  const total = urls.length;
  const saved = state.running ? state.progress?.saved ?? 0 : savedCount ?? 0;
  const missing = Math.max(0, total - saved);
  const pct = total ? Math.round((saved / total) * 100) : 0;
  const failed = !state.running ? state.progress?.failed ?? 0 : 0;

  return (
    <Card style={{ gap: 10 }}>
      <View style={s.row}>
        <Text style={s.title}>Athlete photos for offline</Text>
        <Text style={[s.count, missing === 0 && { color: colors.green }]}>
          {saved.toLocaleString('en-IN')} / {total.toLocaleString('en-IN')}
        </Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }]} />
      </View>
      {state.running ? (
        <>
          <Muted style={{ fontSize: 12 }}>
            Saving photos… {state.progress?.done.toLocaleString('en-IN')} of {state.progress?.total.toLocaleString('en-IN')} checked. You can keep scanning.
          </Muted>
          <Button title="Stop" variant="secondary" onPress={() => (stopRequested = true)} />
        </>
      ) : missing === 0 ? (
        <Muted style={{ fontSize: 12 }}>Every photo is on this phone. Scans show faces even with no network.</Muted>
      ) : (
        <>
          <Muted style={{ fontSize: 12 }}>
            {missing.toLocaleString('en-IN')} photo{missing === 1 ? '' : 's'} not on this phone yet. Save them on Wi-Fi before gates open, so scans show
            faces with no network.{failed ? ` ${failed} could not be downloaded last time.` : ''}
          </Muted>
          <Button title={saved ? 'Save the rest' : 'Save all photos'} onPress={() => startRun(urls)} />
        </>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 15, fontWeight: '800', color: colors.navy },
  count: { fontSize: 14, fontWeight: '800', color: colors.muted },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.blue },
});
