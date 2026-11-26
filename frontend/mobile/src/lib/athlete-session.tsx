/**
 * Athlete session: auth token (SecureStore), cached profile (AsyncStorage, so the pass and
 * schedule open with no internet), background refresh, reminder + push sync.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStoreNative from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from './api';
import { syncReminders, getNotificationPermission, requestNotificationPermission } from './reminders';
import { registerPushToken, unregisterPushToken } from './push';
import { clearSavedPhotos, savePhoto } from './photo-cache';
import type { AthleteMe } from './types';

const TOKEN_KEY = 'aura_athlete_token';

/** SecureStore on phones; web preview (no SecureStore) falls back to AsyncStorage */
const SecureStore =
  Platform.OS === 'web'
    ? {
        getItemAsync: (k: string) => AsyncStorage.getItem(k),
        setItemAsync: (k: string, v: string) => AsyncStorage.setItem(k, v),
        deleteItemAsync: (k: string) => AsyncStorage.removeItem(k),
      }
    : SecureStoreNative;
const CACHE_KEY = '@aura/athlete-me';
/**
 * The pass, QR and schedule are saved on the phone, so the profile only needs refreshing for
 * schedule changes (heats, lanes, call room times). Live results have their own screens.
 */
const REFRESH_EVERY_MS = 30 * 60 * 1000;
/** Coming back to the app refreshes only when the saved copy is at least this old */
const FOREGROUND_REFRESH_AFTER_MS = 10 * 60 * 1000;
const ASKED_NOTIF_KEY = '@aura/asked-notifications';

/**
 * Ask for notification permission once (right after login, or on first launch after an update).
 * Without it no reminders can be scheduled, and students rarely find the Settings toggle.
 */
async function askNotificationsOnce(): Promise<boolean> {
  try {
    if ((await getNotificationPermission()) === 'granted') return true;
    if ((await AsyncStorage.getItem(ASKED_NOTIF_KEY)) === 'yes') return false;
    await AsyncStorage.setItem(ASKED_NOTIF_KEY, 'yes');
    return (await requestNotificationPermission()) === 'granted';
  } catch {
    return false;
  }
}

type Status = 'loading' | 'signedOut' | 'signedIn';
export type LoginInput = { bib: string; dob: string } | { qrToken: string };

type Ctx = {
  status: Status;
  me: AthleteMe | null;
  lastSyncedAt: number | null;
  refreshing: boolean;
  offline: boolean;
  /** The server no longer accepts the saved login. The saved pass stays on screen until they log in again. */
  loginExpired: boolean;
  remindersScheduled: number | null;
  token: string | null;
  login: (input: LoginInput) => Promise<void>;
  refresh: () => Promise<void>;
  resyncReminders: () => Promise<number>;
  logout: () => Promise<void>;
};

const AthleteSessionContext = createContext<Ctx | null>(null);

export function AthleteSessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<AthleteMe | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loginExpired, setLoginExpired] = useState(false);
  const [remindersScheduled, setRemindersScheduled] = useState<number | null>(null);
  const tokenRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const lastSyncedRef = useRef<number | null>(null);

  const clearLocal = useCallback(async () => {
    tokenRef.current = null;
    setToken(null);
    setMe(null);
    setLastSyncedAt(null);
    lastSyncedRef.current = null;
    setLoginExpired(false);
    setRemindersScheduled(null);
    clearSavedPhotos();
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
      AsyncStorage.removeItem(CACHE_KEY).catch(() => {}),
      syncReminders([]).catch(() => 0),
    ]);
    setStatus('signedOut');
  }, []);

  const applyProfile = useCallback(async (data: AthleteMe) => {
    setMe(data);
    const at = Date.now();
    setLastSyncedAt(at);
    lastSyncedRef.current = at;
    setOffline(false);
    setLoginExpired(false);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ data, at })).catch(() => {});
    // Keep the photo on the phone so the pass shows it offline
    savePhoto(data.athlete?.photoUrl);
    try {
      setRemindersScheduled(await syncReminders(data.schedule));
    } catch {
      // keep previous reminders
    }
  }, []);

  const fetchProfile = useCallback(
    async (authToken: string) => {
      const data = await api<AthleteMe>('/athlete/me', { token: authToken });
      await applyProfile(data);
      return data;
    },
    [applyProfile]
  );

  const refresh = useCallback(async () => {
    const t = tokenRef.current;
    if (!t || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      await fetchProfile(t);
      registerPushToken(t);
    } catch (e) {
      if (e instanceof ApiError && e.offline) setOffline(true);
      // Expired or rejected login: keep the saved pass on screen (the venue may have no network
      // to log in again) and ask them to log in when they can.
      else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setLoginExpired(true);
      // Profile removed or withdrawn from the championship: the saved pass is no longer valid
      else if (e instanceof ApiError && e.status === 404) await clearLocal();
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [fetchProfile, clearLocal]);

  // Restore session on launch: show cached data immediately, then refresh
  useEffect(() => {
    (async () => {
      const saved = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      if (!saved) {
        setStatus('signedOut');
        return;
      }
      tokenRef.current = saved;
      setToken(saved);
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          const { data, at } = JSON.parse(raw);
          setMe(data);
          setLastSyncedAt(at);
          lastSyncedRef.current = at;
        }
      } catch {
        // ignore bad cache
      }
      setStatus('signedIn');
      await askNotificationsOnce();
      refresh();
    })();
  }, [refresh]);

  // Refresh when the app returns to the foreground (if the saved copy is old) and now and then while open
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      const at = lastSyncedRef.current;
      if (!at || Date.now() - at >= FOREGROUND_REFRESH_AFTER_MS) refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, REFRESH_EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [token, refresh]);

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await api<{ token: string }>('/athlete/login', { method: 'POST', body: input });
      await SecureStore.setItemAsync(TOKEN_KEY, res.token);
      tokenRef.current = res.token;
      setToken(res.token);
      const data = await fetchProfile(res.token);
      setStatus('signedIn');
      if (await askNotificationsOnce()) {
        setRemindersScheduled(await syncReminders(data.schedule).catch(() => 0));
      }
      registerPushToken(res.token);
    },
    [fetchProfile]
  );

  const logout = useCallback(async () => {
    const t = tokenRef.current;
    if (t) await unregisterPushToken(t);
    await clearLocal();
  }, [clearLocal]);

  const resyncReminders = useCallback(async () => {
    const n = await syncReminders(me?.schedule || []);
    setRemindersScheduled(n);
    if (tokenRef.current) registerPushToken(tokenRef.current);
    return n;
  }, [me]);

  const value = useMemo(
    () => ({ status, me, lastSyncedAt, refreshing, offline, loginExpired, remindersScheduled, token, login, refresh, resyncReminders, logout }),
    [status, me, lastSyncedAt, refreshing, offline, loginExpired, remindersScheduled, token, login, refresh, resyncReminders, logout]
  );
  return <AthleteSessionContext.Provider value={value}>{children}</AthleteSessionContext.Provider>;
}

export function useAthleteSession(): Ctx {
  const ctx = useContext(AthleteSessionContext);
  if (!ctx) throw new Error('useAthleteSession must be used inside AthleteSessionProvider');
  return ctx;
}
