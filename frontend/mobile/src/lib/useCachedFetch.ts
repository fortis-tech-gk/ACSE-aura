/**
 * Small "stale-while-revalidate" fetch hook for read-only screens (performance, leaderboard):
 * shows the last saved copy instantly (works offline), refreshes in the background,
 * and optionally polls while the screen is focused.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from './api';

export function useCachedFetch<T>(cacheKey: string, path: string, opts: { token?: string | null; pollMs?: number; enabled?: boolean } = {}) {
  const { token, pollMs, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const again = useRef(false);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        setData((d) => d ?? parsed.data);
        setSavedAt((t) => t ?? parsed.at);
      })
      .catch(() => {});
  }, [cacheKey]);

  const load = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    if (busy.current) {
      // A refresh asked for while one is running: run once more afterwards so the screen ends up current
      again.current = true;
      return;
    }
    busy.current = true;
    setLoading(true);
    try {
      const fresh = await api<T>(path, { token });
      const at = Date.now();
      setData(fresh);
      setSavedAt(at);
      setOffline(false);
      setError(null);
      AsyncStorage.setItem(cacheKey, JSON.stringify({ data: fresh, at })).catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.offline) setOffline(true);
      else setError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
    if (again.current) {
      again.current = false;
      await loadRef.current();
    }
  }, [enabled, path, token, cacheKey]);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Load when the screen gains focus; poll while focused and the app is in the foreground
  useFocusEffect(
    useCallback(() => {
      load();
      if (!pollMs) return undefined;
      const t = setInterval(() => {
        if (AppState.currentState === 'active') load();
      }, pollMs);
      return () => clearInterval(t);
    }, [load, pollMs])
  );

  return { data, savedAt, loading, offline, error, reload: load };
}
