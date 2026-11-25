/**
 * College PED session in the AURA Athletes app ("Log in as PED").
 * One login for the whole college: the Men's or the Women's registration password opens both
 * squads; the PED switches between Men and Women inside the app. The token lives in SecureStore
 * under its own key, separate from an athlete login.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStoreNative from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from './api';
import { getNotificationPermission, requestNotificationPermission, ensureNotificationChannel } from './reminders';
import { registerPushToken, unregisterPushToken } from './push';

const TOKEN_KEY = 'aura_ped_token';
const INFO_KEY = '@aura/ped-info';
const GENDER_KEY = '@aura/ped-gender';
const PUSH_PATH = '/ped/push-token';

const SecureStore =
  Platform.OS === 'web'
    ? {
        getItemAsync: (k: string) => AsyncStorage.getItem(k),
        setItemAsync: (k: string, v: string) => AsyncStorage.setItem(k, v),
        deleteItemAsync: (k: string) => AsyncStorage.removeItem(k),
      }
    : SecureStoreNative;

export type Gender = 'men' | 'women';
export type PedInfo = { college: { id: string; name: string; code: string }; squads: { id: string; gender: Gender }[] };
type Status = 'loading' | 'signedOut' | 'signedIn';

type Ctx = {
  status: Status;
  token: string | null;
  info: PedInfo | null;
  gender: Gender;
  setGender: (g: Gender) => void;
  login: (collegeCode: string, passphrase: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Authenticated API call; a 401 signs the PED out */
  call: <T>(path: string, opts?: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown }) => Promise<T>;
};

const PedSessionContext = createContext<Ctx | null>(null);

async function enableAlerts(token: string) {
  try {
    if (Platform.OS === 'web') return;
    await ensureNotificationChannel();
    if ((await getNotificationPermission()) !== 'granted') await requestNotificationPermission();
    await registerPushToken(token, PUSH_PATH);
  } catch {
    // retried on next launch
  }
}

export function PedSessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<PedInfo | null>(null);
  const [gender, setGenderState] = useState<Gender>('men');
  const tokenRef = useRef<string | null>(null);

  const clearLocal = useCallback(async () => {
    tokenRef.current = null;
    setToken(null);
    setInfo(null);
    await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}), AsyncStorage.removeItem(INFO_KEY).catch(() => {})]);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      const g = await AsyncStorage.getItem(GENDER_KEY).catch(() => null);
      if (g === 'men' || g === 'women') setGenderState(g);
      if (!saved) {
        setStatus('signedOut');
        return;
      }
      tokenRef.current = saved;
      setToken(saved);
      try {
        const raw = await AsyncStorage.getItem(INFO_KEY);
        if (raw) setInfo(JSON.parse(raw));
      } catch {
        // ignore
      }
      setStatus('signedIn');
      enableAlerts(saved);
    })();
  }, []);

  const setGender = useCallback((g: Gender) => {
    setGenderState(g);
    AsyncStorage.setItem(GENDER_KEY, g).catch(() => {});
  }, []);

  const login = useCallback(async (collegeCode: string, passphrase: string) => {
    const res = await api<PedInfo & { token: string }>('/auth/ped/login', { method: 'POST', body: { collegeCode, passphrase } });
    const next: PedInfo = { college: res.college, squads: res.squads };
    await SecureStore.setItemAsync(TOKEN_KEY, res.token);
    await AsyncStorage.setItem(INFO_KEY, JSON.stringify(next)).catch(() => {});
    tokenRef.current = res.token;
    setToken(res.token);
    setInfo(next);
    // Open on a squad that exists (a college may have only a women's or men's squad)
    if (next.squads.length === 1) setGender(next.squads[0].gender);
    setStatus('signedIn');
    enableAlerts(res.token);
  }, [setGender]);

  const logout = useCallback(async () => {
    const t = tokenRef.current;
    if (t) await unregisterPushToken(t, PUSH_PATH);
    await clearLocal();
  }, [clearLocal]);

  const call = useCallback(
    async <T,>(path: string, opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}): Promise<T> => {
      try {
        return await api<T>(path, { ...opts, token: tokenRef.current });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403) && !e.offline) await clearLocal();
        throw e;
      }
    },
    [clearLocal]
  );

  const value = useMemo(
    () => ({ status, token, info, gender, setGender, login, logout, call }),
    [status, token, info, gender, setGender, login, logout, call]
  );
  return <PedSessionContext.Provider value={value}>{children}</PedSessionContext.Provider>;
}

export function usePedSession(): Ctx {
  const ctx = useContext(PedSessionContext);
  if (!ctx) throw new Error('usePedSession must be used inside PedSessionProvider');
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// API shapes (backend/src/routes/ped.routes.ts)
// ---------------------------------------------------------------------------------------------

export type PedAthleteRef = { id: string; name: string; bib: number | null };
export type PedEvent = {
  id: string;
  name: string;
  code: string;
  deadline: string | null;
  open: boolean;
  entries: PedAthleteRef[];
  reserves: (PedAthleteRef & { accredited: boolean; regulars: { id: string; name: string; open: boolean }[] })[];
};
export type PedRelayMember = PedAthleteRef & { gender: Gender | null; withdrawn: boolean; leg: number | null; isReserve: boolean };
export type PedRelay = { teamId: string; eventId: string; eventName: string; isMixed: boolean; deadline: string | null; open: boolean; members: PedRelayMember[] };
export type PedEntries = { events: PedEvent[]; relays: PedRelay[]; serverTime: string };

export type PedEntryState = 'REPORTED' | 'NOT_REPORTED' | 'DNS' | 'SCRATCHED' | 'DQ' | string;
export type PedHeatEntry = {
  heatAthleteId: string;
  lane: number | null;
  profileId: string | null;
  relayTeamId: string | null;
  name: string;
  bib: number | null;
  state: PedEntryState;
  mark?: string | null;
  place?: number | null;
  resultStatus?: string | null;
};
/** Attendance card: a heat, or a first-round roll call (NOT_OPEN: before the roll call opens) */
export type PedUnit = {
  key: string;
  mode: 'HEAT' | 'ROLL_CALL' | 'NOT_OPEN';
  heatId: string | null;
  eventId: string;
  eventName: string;
  category: string;
  stage: string;
  heatNumber: number | null;
  status: string;
  startAt: string | null;
  callRoomAt: string | null;
  callRoomEstimated: boolean;
  sessionName: string | null;
  entries: PedHeatEntry[];
};
export type PedHeat = {
  heatId: string;
  eventId: string;
  eventName: string;
  category: string;
  stage: string;
  heatNumber: number | null;
  status: string;
  startAt: string | null;
  callRoomAt: string | null;
  callRoomEstimated: boolean;
  sessionName: string | null;
  entries: PedHeatEntry[];
};
