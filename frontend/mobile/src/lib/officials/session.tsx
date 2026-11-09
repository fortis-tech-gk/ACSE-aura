/**
 * AURA Officials session: staff PIN login, the athlete roster kept on the phone, and an offline
 * scan queue. Every scan is written to the phone first, then sent; when the network is down it
 * stays queued and is re-sent later with the same scan id, so the server never counts it twice.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStoreNative from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from '../api';
import {
  athleteIdFromQr,
  findInRoster,
  indexRoster,
  istDate,
  localMealDuplicate,
  newScanId,
  pruneQueue,
  type RosterIndex,
} from './scan-logic';
import type { AthleteRef, Hostel, LoginRole, MealType, OpPayload, QueuedScan, RosterAthlete, ScanKind, Staff } from './types';

const SecureStore =
  Platform.OS === 'web'
    ? {
        getItemAsync: (k: string) => AsyncStorage.getItem(k),
        setItemAsync: (k: string, v: string) => AsyncStorage.setItem(k, v),
        deleteItemAsync: (k: string) => AsyncStorage.removeItem(k),
      }
    : SecureStoreNative;

const TOKEN_KEY = 'aura_official_token';
const STAFF_KEY = '@aura/off-staff';
const ROSTER_KEY = '@aura/off-roster';
const QUEUE_KEY = '@aura/off-queue';
const HOSTELS_KEY = '@aura/off-hostels';
const ROSTER_MAX_AGE_MS = 15 * 60 * 1000;
const SYNC_EVERY_MS = 20 * 1000;

export type ScanAthlete = { name: string; bib: number | null; college: string | null; photoUrl: string | null };

export type Outcome = {
  tone: 'green' | 'amber' | 'red';
  title: string;
  detail?: string;
  athlete: ScanAthlete | null;
  /** saved on the device, not yet confirmed by the server */
  offline: boolean;
};

export type OpResult =
  | { status: 'ok'; data: any }
  | { status: 'queued' }
  | { status: 'offline'; message: string }
  | { status: 'rejected'; message: string; data?: any };

export type ScanInput = {
  kind: ScanKind;
  ref: AthleteRef;
  mealType?: MealType;
  hostelId?: string;
  room?: string;
};

type Ctx = {
  status: 'loading' | 'signedOut' | 'signedIn';
  staff: Staff | null;
  token: string | null;
  sessionExpired: boolean;
  roster: RosterAthlete[];
  rosterAt: number | null;
  rosterIndex: RosterIndex;
  hostels: Hostel[];
  queue: QueuedScan[];
  pendingCount: number;
  syncing: boolean;
  lastSyncError: string | null;
  login: (role: LoginRole, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshRoster: () => Promise<void>;
  submit: (input: ScanInput) => Promise<Outcome>;
  /**
   * Call room / referee action. Sent now when possible; when the network is down it is saved
   * and sent later in order (queueable actions only). Server refusals come back as 'rejected'.
   */
  submitOp: (op: OpPayload, opts?: { queueable?: boolean }) => Promise<OpResult>;
  syncNow: () => Promise<void>;
};

const OfficialSessionContext = createContext<Ctx | null>(null);

const fromRoster = (a: RosterAthlete | null): ScanAthlete | null =>
  a ? { name: a.name, bib: a.bib, college: a.collegeCode || a.collegeName, photoUrl: a.photoUrl } : null;

const MEAL_LABEL: Record<MealType, string> = { BREAKFAST: 'Breakfast', LUNCH: 'Lunch', SNACKS: 'Snacks', DINNER: 'Dinner' };

const fmtClock = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 330 * 60000);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

type SendResult =
  | { kind: 'done'; status: 'ok' | 'rejected'; outcome: Omit<Outcome, 'offline'>; data?: any }
  | { kind: 'retry'; error: string }
  | { kind: 'auth' };

/** Send a call room / referee action */
async function sendOp(op: OpPayload, token: string): Promise<SendResult> {
  try {
    const data: any = await api(op.path, { method: op.method || 'POST', token, timeoutMs: 8000, body: op.body });
    return { kind: 'done', status: 'ok', outcome: { tone: 'green', title: op.label, athlete: null }, data };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.offline) return { kind: 'retry', error: e.message };
      if (e.status === 401) return { kind: 'auth' };
      if (e.status === 429 || e.status >= 500) return { kind: 'retry', error: e.message };
      return { kind: 'done', status: 'rejected', outcome: { tone: 'red', title: op.label, detail: e.message, athlete: null } };
    }
    return { kind: 'retry', error: 'Unexpected error' };
  }
}

/** Send one queued scan to the server and translate the answer for the screen */
async function sendScan(q: QueuedScan, token: string, fallback: ScanAthlete | null): Promise<SendResult> {
  if (q.kind === 'op' && q.op) return sendOp(q.op, token);
  const ref = !q.ref ? {} : 'qrToken' in q.ref ? { qrToken: q.ref.qrToken } : { bib: q.ref.bib };
  try {
    if (q.kind === 'meal') {
      const r: any = await api('/catering/scan', {
        method: 'POST',
        token,
        timeoutMs: 8000,
        body: { clientScanUuid: q.id, mealType: q.mealType, scannedAt: q.scannedAt, ...ref },
      });
      const athlete: ScanAthlete = {
        name: r.athlete_name || fallback?.name || 'Athlete',
        bib: r.bid_number ?? fallback?.bib ?? null,
        college: r.college_code || r.college_name || fallback?.college || null,
        photoUrl: fallback?.photoUrl ?? null,
      };
      const meal = MEAL_LABEL[q.mealType as MealType] || 'Meal';
      if (r.success) return { kind: 'done', status: 'ok', outcome: { tone: 'green', title: `${meal} — serve`, athlete } };
      if (r.status === 'ALREADY_SERVED') {
        return {
          kind: 'done',
          status: 'rejected',
          outcome: { tone: 'red', title: 'Already claimed', detail: `${meal} was already given${r.served_at ? ` at ${fmtClock(r.served_at)}` : ''}.`, athlete },
        };
      }
      return { kind: 'done', status: 'rejected', outcome: { tone: 'red', title: 'Not allowed', detail: r.message, athlete } };
    }

    if (q.kind === 'checkin') {
      const r: any = await api('/accommodation/checkin', {
        method: 'POST',
        token,
        timeoutMs: 8000,
        body: { clientScanUuid: q.id, deviceTimestamp: q.scannedAt, hostelId: q.hostelId, roomAssigned: q.room, ...ref },
      });
      const x = r.result || {};
      const athlete: ScanAthlete = {
        name: x.sslc_name || fallback?.name || 'Athlete',
        bib: x.bid_number ?? fallback?.bib ?? null,
        college: x.squad_code || x.college_name || fallback?.college || null,
        photoUrl: fallback?.photoUrl ?? null,
      };
      const where = [x.hostel_name, x.room_assigned && x.room_assigned !== 'General Dorm' ? `Room ${x.room_assigned}` : null].filter(Boolean).join(' · ');
      if (x.already_checked_in) {
        return {
          kind: 'done',
          status: 'ok',
          outcome: { tone: 'amber', title: 'Already checked in', detail: `${where}${x.checked_in_at ? ` · since ${fmtClock(x.checked_in_at)}` : ''}`, athlete },
        };
      }
      return { kind: 'done', status: 'ok', outcome: { tone: 'green', title: 'Checked in', detail: where, athlete } };
    }

    const r: any = await api('/accreditation/scan', {
      method: 'POST',
      token,
      timeoutMs: 8000,
      body: { clientScanUuid: q.id, deviceTimestamp: q.scannedAt, ...ref },
    });
    const x = r.result || {};
    const athlete: ScanAthlete = {
      name: x.sslc_name || fallback?.name || 'Athlete',
      bib: x.bid_number ?? fallback?.bib ?? null,
      college: x.squad_code || x.college_name || fallback?.college || null,
      photoUrl: fallback?.photoUrl ?? null,
    };
    const events = Array.isArray(x.events) ? x.events.map((e: any) => e.name).join(', ') : '';
    if (x.already_accredited && !x.is_duplicate_sync) {
      return { kind: 'done', status: 'ok', outcome: { tone: 'amber', title: 'Already accredited', detail: events, athlete } };
    }
    return { kind: 'done', status: 'ok', outcome: { tone: 'green', title: 'Accredited', detail: events, athlete } };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.offline) return { kind: 'retry', error: e.message };
      if (e.status === 401) return { kind: 'auth' };
      if (e.status === 429 || e.status >= 500) return { kind: 'retry', error: e.message };
      return { kind: 'done', status: 'rejected', outcome: { tone: 'red', title: 'Not allowed', detail: e.message, athlete: fallback } };
    }
    return { kind: 'retry', error: 'Unexpected error' };
  }
}

export function OfficialSessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Ctx['status']>('loading');
  const [staff, setStaff] = useState<Staff | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [roster, setRoster] = useState<RosterAthlete[]>([]);
  const [rosterAt, setRosterAt] = useState<number | null>(null);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [queue, setQueueState] = useState<QueuedScan[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  const tokenRef = useRef<string | null>(null);
  const queueRef = useRef<QueuedScan[]>([]);
  const syncingRef = useRef(false);
  const rosterIndex = useMemo(() => indexRoster(roster), [roster]);
  const rosterIndexRef = useRef(rosterIndex);
  useEffect(() => {
    rosterIndexRef.current = rosterIndex;
  }, [rosterIndex]);

  /** Update the queue in memory and on disk (disk first matters: the phone may die mid-shift) */
  const setQueue = useCallback(async (update: (q: QueuedScan[]) => QueuedScan[]) => {
    const next = pruneQueue(update(queueRef.current));
    queueRef.current = next;
    setQueueState(next);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const patchScan = useCallback(
    (id: string, patch: Partial<QueuedScan>) => setQueue((q) => q.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    [setQueue]
  );

  const refreshRoster = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const r = await api<{ athletes: RosterAthlete[] }>('/officials/roster', { token: t, timeoutMs: 30000 });
      const at = Date.now();
      setRoster(r.athletes);
      setRosterAt(at);
      await AsyncStorage.setItem(ROSTER_KEY, JSON.stringify({ at, athletes: r.athletes })).catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSessionExpired(true);
    }
  }, []);

  const refreshHostels = useCallback(async (role: string | undefined) => {
    const t = tokenRef.current;
    if (!t || (role !== 'warden' && role !== 'meet_admin')) return;
    try {
      const r = await api<{ hostels: Hostel[] }>('/accommodation/hostels', { token: t });
      setHostels(r.hostels);
      await AsyncStorage.setItem(HOSTELS_KEY, JSON.stringify(r.hostels)).catch(() => {});
    } catch {
      // keep cached list
    }
  }, []);

  const syncNow = useCallback(async () => {
    const t = tokenRef.current;
    if (!t || syncingRef.current) return;
    const pending = queueRef.current.filter((q) => q.status === 'pending');
    if (!pending.length) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      for (const q of pending) {
        const athlete = q.athleteId ? fromRoster(rosterIndexRef.current.byId.get(q.athleteId) ?? null) : null;
        const r = await sendScan(q, t, athlete);
        if (r.kind === 'auth') {
          setSessionExpired(true);
          setLastSyncError('Your login has expired. Log in again to send the saved scans.');
          return;
        }
        if (r.kind === 'retry') {
          await patchScan(q.id, { attempts: q.attempts + 1 });
          setLastSyncError(r.error);
          return; // network is down — try again later, keep order
        }
        await patchScan(q.id, {
          status: r.status,
          message: [r.outcome.title, r.outcome.detail].filter(Boolean).join(' — '),
          syncedAt: new Date().toISOString(),
          attempts: q.attempts + 1,
        });
      }
      setLastSyncError(null);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [patchScan]);

  const submit = useCallback(
    async (input: ScanInput): Promise<Outcome> => {
      const t = tokenRef.current;
      if ('qrToken' in input.ref && !athleteIdFromQr(input.ref.qrToken)) {
        return { tone: 'red', title: 'Not an AURA ID card', detail: 'This QR code is not from an AURA 2026 athlete ID card.', athlete: null, offline: false };
      }
      const known = findInRoster(input.ref, rosterIndexRef.current);
      const athlete = fromRoster(known);
      const now = new Date();
      const mealDate = input.kind === 'meal' ? istDate(now) : undefined;

      // Checks that need no network
      if (input.kind === 'meal' && known && input.mealType) {
        const dup = localMealDuplicate(queueRef.current, known.id, input.mealType, mealDate!);
        if (dup) {
          return {
            tone: 'red',
            title: 'Already claimed',
            detail: `${MEAL_LABEL[input.mealType]} was already scanned on this device at ${fmtClock(dup.scannedAt)}.`,
            athlete,
            offline: false,
          };
        }
      }

      const scan: QueuedScan = {
        id: newScanId(),
        kind: input.kind,
        ref: input.ref,
        athleteId: known?.id ?? ('qrToken' in input.ref ? athleteIdFromQr(input.ref.qrToken) : null),
        mealType: input.mealType,
        mealDate,
        hostelId: input.hostelId,
        room: input.room?.trim() || undefined,
        scannedAt: now.toISOString(),
        status: 'pending',
        attempts: 0,
      };

      // Bib typed by hand and not on the saved list: only the server can say who it is
      const unknownBib = 'bib' in input.ref && !known;

      await setQueue((q) => [...q, scan]);

      if (t && !sessionExpired) {
        const r = await sendScan(scan, t, athlete);
        if (r.kind === 'done') {
          await patchScan(scan.id, {
            status: r.status,
            message: [r.outcome.title, r.outcome.detail].filter(Boolean).join(' — '),
            syncedAt: new Date().toISOString(),
            attempts: 1,
          });
          return { ...r.outcome, offline: false };
        }
        if (r.kind === 'auth') setSessionExpired(true);
      }

      // Saved on the phone only
      if (unknownBib) {
        await setQueue((q) => q.filter((s) => s.id !== scan.id));
        return {
          tone: 'red',
          title: 'Bib not found',
          detail: `Bib ${(input.ref as { bib: string }).bib} is not on the saved athlete list. Ask for the ID card or check the number.`,
          athlete: null,
          offline: false,
        };
      }
      if (!known) {
        return {
          tone: 'amber',
          title: 'Saved — will check when online',
          detail: 'This card is not on the saved list yet. Ask the athlete to wait, or allow and it will be verified when the network is back.',
          athlete: null,
          offline: true,
        };
      }
      if (input.kind === 'accreditation' && !known.feesVerified) {
        await setQueue((q) => q.filter((s) => s.id !== scan.id));
        return { tone: 'red', title: 'Fees not verified', detail: `${known.collegeCode || 'This college'}: send the team manager to the finance desk.`, athlete, offline: false };
      }
      if (input.kind === 'checkin' && known.checkedIn) {
        return { tone: 'amber', title: 'Already checked in', detail: [known.hostelName, known.roomRange].filter(Boolean).join(' · '), athlete, offline: true };
      }
      const title =
        input.kind === 'meal' ? `${MEAL_LABEL[input.mealType as MealType]} — serve` : input.kind === 'checkin' ? 'Checked in' : 'Accredited';
      const detail = input.kind === 'checkin' ? [known.hostelName, input.room ? `Room ${input.room}` : known.roomRange].filter(Boolean).join(' · ') : undefined;
      return { tone: 'green', title, detail, athlete, offline: true };
    },
    [patchScan, sessionExpired, setQueue]
  );

  const submitOp = useCallback(
    async (op: OpPayload, opts: { queueable?: boolean } = {}): Promise<OpResult> => {
      const queueable = opts.queueable !== false;
      const t = tokenRef.current;
      // Keep order: if earlier actions are still waiting, this one waits behind them
      const waiting = queueRef.current.some((q) => q.status === 'pending');
      if (t && !sessionExpired && !(queueable && waiting)) {
        const r = await sendOp(op, t);
        if (r.kind === 'done') {
          return r.status === 'ok'
            ? { status: 'ok', data: r.data }
            : { status: 'rejected', message: r.outcome.detail || 'Not allowed.', data: r.data };
        }
        if (r.kind === 'auth') setSessionExpired(true);
        if (!queueable) {
          return { status: 'offline', message: r.kind === 'auth' ? 'Your login has expired. Log in again.' : 'No connection. This needs the internet — try again in a moment.' };
        }
      } else if (!queueable) {
        return { status: 'offline', message: waiting ? 'Saved entries are still being sent. Try again when they are done.' : 'No connection. This needs the internet.' };
      }
      const item: QueuedScan = {
        id: newScanId(),
        kind: 'op',
        ref: null,
        athleteId: null,
        op,
        scannedAt: new Date().toISOString(),
        status: 'pending',
        attempts: 0,
      };
      await setQueue((q) => [...q, item]);
      if (waiting) syncNow();
      return { status: 'queued' };
    },
    [sessionExpired, setQueue, syncNow]
  );

  const login = useCallback(
    async (role: LoginRole, pin: string) => {
      const r = await api<{ token: string; staff: Staff }>('/auth/staff/pin-login', { method: 'POST', body: { role, pin } });
      tokenRef.current = r.token;
      await SecureStore.setItemAsync(TOKEN_KEY, r.token);
      await AsyncStorage.setItem(STAFF_KEY, JSON.stringify(r.staff));
      setToken(r.token);
      setStaff(r.staff);
      setSessionExpired(false);
      setLastSyncError(null);
      setStatus('signedIn');
      refreshRoster();
      refreshHostels(r.staff.role);
      syncNow();
    },
    [refreshRoster, refreshHostels, syncNow]
  );

  /** Logging out keeps unsent scans on the phone — they are sent after the next login */
  const logout = useCallback(async () => {
    tokenRef.current = null;
    setToken(null);
    setStaff(null);
    await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}), AsyncStorage.removeItem(STAFF_KEY).catch(() => {})]);
    setStatus('signedOut');
  }, []);

  // Restore everything saved on the device
  useEffect(() => {
    (async () => {
      const [savedToken, savedStaff, savedRoster, savedQueue, savedHostels] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
        AsyncStorage.getItem(STAFF_KEY).catch(() => null),
        AsyncStorage.getItem(ROSTER_KEY).catch(() => null),
        AsyncStorage.getItem(QUEUE_KEY).catch(() => null),
        AsyncStorage.getItem(HOSTELS_KEY).catch(() => null),
      ]);
      try {
        if (savedQueue) {
          queueRef.current = JSON.parse(savedQueue);
          setQueueState(queueRef.current);
        }
        if (savedRoster) {
          const r = JSON.parse(savedRoster);
          setRoster(r.athletes || []);
          setRosterAt(r.at || null);
        }
        if (savedHostels) setHostels(JSON.parse(savedHostels));
      } catch {
        // corrupt cache — start clean
      }
      if (savedToken && savedStaff) {
        tokenRef.current = savedToken;
        setToken(savedToken);
        const s = JSON.parse(savedStaff) as Staff;
        setStaff(s);
        setStatus('signedIn');
        refreshRoster();
        refreshHostels(s.role);
        syncNow();
      } else {
        setStatus('signedOut');
      }
    })();
  }, [refreshRoster, refreshHostels, syncNow]);

  // Keep sending saved scans; refresh the roster when the app comes back to the front
  useEffect(() => {
    if (status !== 'signedIn') return;
    const timer = setInterval(() => {
      if (queueRef.current.some((q) => q.status === 'pending')) syncNow();
    }, SYNC_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      syncNow();
      if (!rosterAt || Date.now() - rosterAt > ROSTER_MAX_AGE_MS) refreshRoster();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [status, syncNow, refreshRoster, rosterAt]);

  const pendingCount = useMemo(() => queue.filter((q) => q.status === 'pending').length, [queue]);

  const value = useMemo<Ctx>(
    () => ({
      status,
      staff,
      token,
      sessionExpired,
      roster,
      rosterAt,
      rosterIndex,
      hostels,
      queue,
      pendingCount,
      syncing,
      lastSyncError,
      login,
      logout,
      refreshRoster,
      submit,
      submitOp,
      syncNow,
    }),
    [status, staff, token, sessionExpired, roster, rosterAt, rosterIndex, hostels, queue, pendingCount, syncing, lastSyncError, login, logout, refreshRoster, submit, submitOp, syncNow]
  );

  return <OfficialSessionContext.Provider value={value}>{children}</OfficialSessionContext.Provider>;
}

export function useOfficialSession(): Ctx {
  const ctx = useContext(OfficialSessionContext);
  if (!ctx) throw new Error('useOfficialSession must be used inside OfficialSessionProvider');
  return ctx;
}
