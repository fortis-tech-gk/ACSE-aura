import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ApiError } from '@/lib/api';
import { usePedSession } from '@/lib/ped-session';

type Loaded<T> = { path: string; data: T | null; error: string | null };

/**
 * Loads a PED API path; reloads when the path changes, when the app comes back to the
 * foreground, when a PED push arrives and (optionally) every `pollMs` while open.
 * Data loaded for another path (e.g. the Men's list after switching to Women) is never shown.
 */
export function usePedData<T>(path: string, pollMs = 0) {
  const { call, status } = usePedSession();
  const [loaded, setLoaded] = useState<Loaded<T>>({ path: '', data: null, error: null });
  const [loading, setLoading] = useState(false);
  const current = useRef(path);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const d = await call<T>(p);
        if (current.current === p) setLoaded({ path: p, data: d, error: null });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Could not load. Pull down to try again.';
        if (current.current === p) setLoaded((prev) => ({ path: p, data: prev.path === p ? prev.data : null, error: msg }));
      } finally {
        if (current.current === p) setLoading(false);
      }
    },
    [call]
  );

  const reload = useCallback(() => load(current.current), [load]);

  useEffect(() => {
    current.current = path;
    // Fetching on path change is the point of this effect (the spinner state is set inside load)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === 'signedIn') load(path);
  }, [path, status, load]);

  useEffect(() => {
    if (status !== 'signedIn') return;
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') reload();
    });
    const push = Notifications.addNotificationReceivedListener((n) => {
      const kind = String((n.request.content.data as any)?.kind || '');
      if (kind.startsWith('ped-')) reload();
    });
    const timer = pollMs
      ? setInterval(() => {
          if (AppState.currentState === 'active') reload();
        }, pollMs)
      : null;
    return () => {
      app.remove();
      push.remove();
      if (timer) clearInterval(timer);
    };
  }, [status, reload, pollMs]);

  const mine = loaded.path === path;
  return { data: mine ? loaded.data : null, error: mine ? loaded.error : null, loading, reload };
}
