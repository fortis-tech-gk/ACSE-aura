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
  mealKey,
  newScanId,
  pruneMealLog,
  pruneQueue,
  type MealLog,
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
const MEALS_KEY = '@aura/off-meals';
const ROSTER_MAX_AGE_MS = 15 * 60 * 1000;
const SYNC_EVERY_MS = 20 * 1000;
/**
 * A scan at the desk waits at most this long for the server before the phone decides on its own.
 * Venue Wi-Fi with no internet, or weak mobile data, does not fail fast: without a short limit
 * every scan in the queue would hang for the full background timeout.
 */
const LIVE_TIMEOUT_MS = 2500;
/** Background re-sends are not blocking anyone, so they can wait longer */
const SYNC_TIMEOUT_MS = 8000;
/** After the network fails, scans are decided on the phone straight away for this long */
const OFFLINE_HOLD_MS = 30 * 1000;
/**
 * Food counter and hostel desk work offline-first: one counter and one hostel per division, so
 * the phone's own meal log and saved list decide at once and the scan is sent in the background.
 * Their saved athlete list is refreshed this often so check-ins and payments show up.
 */
const OFFLINE_FIRST_KINDS: ScanKind[] = ['meal', 'checkin'];
const SCANNER_ROSTER_REFRESH_MS = 5 * 60 * 1000;
/** Referee results may wait for the network this long before the screen warns about it */
export const STALE_PENDING_MS = 3 * 60 * 1000;
/** "Finish" first sends waiting results; it waits this long for them before giving up */
const FLUSH_BEFORE_FINISH_MS = 15 * 1000;

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
  /** Every meal given on this device today and yesterday (not trimmed like the scan history) */
  mealLog: MealLog;
  pendingCount: number;
  /** When the oldest unsent entry was made (null when everything is sent) */
  oldestPendingAt: string | null;
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
  submitOp: (op: OpPayload, opts?: { queueable?: boolean; flushFirst?: boolean }) => Promise<OpResult>;
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
async function sendOp(op: OpPayload, token: string, timeoutMs = SYNC_TIMEOUT_MS): Promise<SendResult> {
  try {
    const data: any = await api(op.path, { method: op.method || 'POST', token, timeoutMs, body: op.body });
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
async function sendScan(q: QueuedScan, token: string, fallback: ScanAthlete | null, timeoutMs = SYNC_TIMEOUT_MS): Promise<SendResult> {
  if (q.kind === 'op' && q.op) return sendOp(q.op, token, timeoutMs);
  const ref = !q.ref ? {} : 'qrToken' in q.ref ? { qrToken: q.ref.qrToken } : { bib: q.ref.bib };
  try {
    if (q.kind === 'meal') {
      const r: any = await api('/catering/scan', {
        method: 'POST',
        token,
        timeoutMs,
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
        timeoutMs,
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
      timeoutMs,
      body: { clientScanUuid: q.id, deviceTimestamp: q.scannedAt, ...ref },
    });
    const x = r.result || {};
    const athlete: ScanAthlete = {
      name: x.sslc_name || fallback?.name || 'Athlete',
      bib: x.bid_number ?? fallback?.bib ?? null,
      college: x.squad_code || x.college_name || fallback?.college || null,
      photoUrl: fallback?.photoUrl ?? null,
    };
    // College check-in: one scan accredits the whole college (migration 0054)
    const collegeName = x.college_name || x.college_code || 'College';
    const men = Number(x.accredited_men ?? 0);
    const women = Number(x.accredited_women ?? 0);
    const counts = `${men} men · ${women} women accredited`;
    if (x.already_present && !x.is_duplicate_sync) {
      const added = Number(x.newly_accredited ?? 0);
      return {
        kind: 'done',
        status: 'ok',
        outcome: { tone: 'amber', title: 'College already checked in', detail: `${collegeName}${added ? ` · ${added} more added` : ''} · ${counts}`, athlete },
      };
    }
    return { kind: 'done', status: 'ok', outcome: { tone: 'green', title: 'College checked in', detail: `${collegeName} · ${counts}`, athlete } };
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
  const [mealLog, setMealLogState] = useState<MealLog>({});
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  const tokenRef = useRef<string | null>(null);
  const queueRef = useRef<QueuedScan[]>([]);
  const mealLogRef = useRef<MealLog>({});
  const syncingRef = useRef(false);
  /** Until this time, scans skip the live attempt and are decided on the phone */
  const offlineUntilRef = useRef(0);
  const networkLooksDown = useCallback(() => Date.now() < offlineUntilRef.current, []);
  /** Remember how the last request went, so the next scan doesn't wait on a dead network */
  const noteNetwork = useCallback((r: SendResult) => {
    if (r.kind === 'retry') offlineUntilRef.current = Date.now() + OFFLINE_HOLD_MS;
    else offlineUntilRef.current = 0;
  }, []);
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

  /** Update the meal log in memory and on disk */
  const setMealLog = useCallback(async (update: (log: MealLog) => MealLog) => {
    const next = pruneMealLog(update(mealLogRef.current), istDate());
    mealLogRef.current = next;
    setMealLogState(next);
    await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  /**
   * After the server answers a meal scan: a meal the server refused for any reason other than
   * "already claimed" was not given, so it comes off the log. ("Already claimed" stays: the
   * athlete has eaten, at this counter or another.)
   */
  const settleMeal = useCallback(
    async (q: QueuedScan, r: SendResult) => {
      if (q.kind !== 'meal' || !q.athleteId || !q.mealType || !q.mealDate) return;
      if (r.kind === 'done' && r.status === 'rejected' && r.outcome.title !== 'Already claimed') {
        const key = mealKey(q.athleteId, q.mealType, q.mealDate);
        await setMealLog((log) => {
          const next = { ...log };
          delete next[key];
          return next;
        });
      }
    },
    [setMealLog]
  );

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
    if (!queueRef.current.some((q) => q.status === 'pending')) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      // Keep going while scans keep arriving (offline-first counters add them during a sync)
      for (let pass = 0; pass < 20; pass++) {
      const pending = queueRef.current.filter((q) => q.status === 'pending');
      if (!pending.length) break;
      for (const q of pending) {
        const athlete = q.athleteId ? fromRoster(rosterIndexRef.current.byId.get(q.athleteId) ?? null) : null;
        const r = await sendScan(q, t, athlete);
        noteNetwork(r);
        await settleMeal(q, r);
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
      }
      setLastSyncError(null);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [patchScan, noteNetwork, settleMeal]);

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

      // Checks that need no network. The meal log covers every meal given on this device today;
      // the scan history only covers its last 800 entries.
      if (input.kind === 'meal' && known && input.mealType) {
        const loggedAt = mealLogRef.current[mealKey(known.id, input.mealType, mealDate!)];
        const dupAt = loggedAt ?? localMealDuplicate(queueRef.current, known.id, input.mealType, mealDate!)?.scannedAt;
        if (dupAt) {
          return {
            tone: 'red',
            title: 'Already claimed',
            detail: `${MEAL_LABEL[input.mealType]} was already scanned on this device at ${fmtClock(dupAt)}.`,
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

      // Food / hostel, athlete on the saved list: a "no" the server would give, from the saved list
      const localNo: Omit<Outcome, 'offline'> | null = !known
        ? null
        : !known.feesVerified && OFFLINE_FIRST_KINDS.includes(input.kind)
          ? { tone: 'red', title: 'Fees not verified', detail: `${known.collegeCode || 'This college'}: send the team manager to the finance desk.`, athlete }
          : input.kind === 'meal' && !known.accredited
            ? { tone: 'red', title: 'College not checked in', detail: `${known.collegeCode || 'This college'} has not checked in at the accreditation desk yet.`, athlete }
            : input.kind === 'checkin' && !known.checkedIn && !(input.hostelId || known.hostelId)
              ? { tone: 'red', title: 'No hostel allotted', detail: 'Pick the hostel above, or ask the meet office to allot one to this college.', athlete }
              : null;
      // Offline-first: nothing in the way on the saved list → decide now, send in the background
      const decideHere = !!known && OFFLINE_FIRST_KINDS.includes(input.kind) && !localNo;

      await setQueue((q) => [...q, scan]);
      if (scan.kind === 'meal' && scan.athleteId && scan.mealType && scan.mealDate) {
        const key = mealKey(scan.athleteId, scan.mealType, scan.mealDate);
        await setMealLog((log) => ({ ...log, [key]: scan.scannedAt }));
      }

      if (decideHere) {
        syncNow(); // background; never blocks the counter
        if (input.kind === 'checkin' && known!.checkedIn) {
          return { tone: 'amber', title: 'Already checked in', detail: [known!.hostelName, known!.roomRange].filter(Boolean).join(' · '), athlete, offline: true };
        }
        const title = input.kind === 'meal' ? `${MEAL_LABEL[input.mealType as MealType]} — serve` : 'Checked in';
        const detail = input.kind === 'checkin' ? [known!.hostelName, input.room ? `Room ${input.room}` : known!.roomRange].filter(Boolean).join(' · ') : undefined;
        return { tone: 'green', title, detail, athlete, offline: true };
      }

      // Ask the server only while the network looks healthy, and only for a short time: on a
      // dead or crawling network the phone decides at once and the scan is sent in the background.
      // (Food / hostel get here only when the saved list says "no" — it may be minutes old, so the
      // server has the final word when it can be reached.)
      if (t && !sessionExpired && !networkLooksDown()) {
        const r = await sendScan(scan, t, athlete, LIVE_TIMEOUT_MS);
        noteNetwork(r);
        await settleMeal(scan, r);
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
      if (localNo) {
        // Server unreachable and the saved list says no: nothing was given, so nothing is saved
        await setQueue((q) => q.filter((s) => s.id !== scan.id));
        if (scan.kind === 'meal' && scan.athleteId && scan.mealType && scan.mealDate) {
          const key = mealKey(scan.athleteId, scan.mealType, scan.mealDate);
          await setMealLog((log) => {
            const next = { ...log };
            delete next[key];
            return next;
          });
        }
        return { ...localNo, detail: `${localNo.detail} (Saved list; no network to re-check.)`, offline: false };
      }
      if (input.kind === 'accreditation' && !known.feesVerified) {
        await setQueue((q) => q.filter((s) => s.id !== scan.id));
        return { tone: 'red', title: 'Fees not verified', detail: `${known.collegeCode || 'This college'}: send the team manager to the finance desk.`, athlete, offline: false };
      }
      if (input.kind === 'checkin' && known.checkedIn) {
        return { tone: 'amber', title: 'Already checked in', detail: [known.hostelName, known.roomRange].filter(Boolean).join(' · '), athlete, offline: true };
      }
      const title =
        input.kind === 'meal' ? `${MEAL_LABEL[input.mealType as MealType]} — serve` : input.kind === 'checkin' ? 'Checked in' : 'College checked in';
      const detail = input.kind === 'checkin' ? [known.hostelName, input.room ? `Room ${input.room}` : known.roomRange].filter(Boolean).join(' · ') : undefined;
      return { tone: 'green', title, detail, athlete, offline: true };
    },
    [patchScan, sessionExpired, setQueue, setMealLog, networkLooksDown, noteNetwork, settleMeal, syncNow]
  );

  const submitOp = useCallback(
    async (op: OpPayload, opts: { queueable?: boolean; flushFirst?: boolean } = {}): Promise<OpResult> => {
      const queueable = opts.queueable !== false;
      const t = tokenRef.current;
      // "Finish" must reach the server AFTER the results saved before it: send those first,
      // waiting a short while for them. Only for that — a call room scan never waits.
      if (opts.flushFirst && t && !sessionExpired && queueRef.current.some((q) => q.status === 'pending')) {
        const until = Date.now() + FLUSH_BEFORE_FINISH_MS;
        offlineUntilRef.current = 0;
        while (Date.now() < until && queueRef.current.some((q) => q.status === 'pending')) {
          await syncNow();
          if (queueRef.current.some((q) => q.status === 'pending')) await new Promise((r) => setTimeout(r, 1500));
        }
      }
      // Keep order: if earlier actions are still waiting, this one waits behind them
      const waiting = queueRef.current.some((q) => q.status === 'pending');
      // Never send an online-only action ahead of entries still waiting (it would overtake them)
      if (!queueable && waiting) {
        const n = queueRef.current.filter((q) => q.status === 'pending').length;
        return {
          status: 'offline',
          message: `${n} saved entr${n === 1 ? 'y is' : 'ies are'} not sent yet (no network). Keep the paper sheet and try again in a minute.`,
        };
      }
      // Queueable actions skip the live attempt while the network looks down: saved at once,
      // sent in order later. Actions that need the internet always try.
      const skipLive = queueable && (waiting || networkLooksDown());
      if (t && !sessionExpired && !skipLive) {
        // Full timeout here: unlike scans, actions carry no duplicate-safe id, so a request cut off
        // early could reach the server and then be sent a second time from the queue.
        const r = await sendOp(op, t, SYNC_TIMEOUT_MS);
        noteNetwork(r);
        if (r.kind === 'done') {
          return r.status === 'ok'
            ? { status: 'ok', data: r.data }
            : { status: 'rejected', message: r.outcome.detail || 'Not allowed.', data: r.data };
        }
        if (r.kind === 'auth') setSessionExpired(true);
        if (!queueable) {
          if (r.kind === 'auth') return { status: 'offline', message: 'Your login has expired. Log in again.' };
          // After a failed flush the referee still has results on the tablet: say so.
          const unsent = queueRef.current.filter((q) => q.status === 'pending').length;
          return {
            status: 'offline',
            message: unsent
              ? `No connection. ${unsent} saved entr${unsent === 1 ? 'y is' : 'ies are'} still not sent — keep the paper sheet and try again in a minute.`
              : 'No connection. This needs the internet — try again in a moment.',
          };
        }
        // Only reachable with no token / an expired session: skipLive implies a queueable action.
      } else if (!queueable) {
        return { status: 'offline', message: 'Your login has expired. Log in again.' };
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
    [sessionExpired, setQueue, syncNow, networkLooksDown, noteNetwork]
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
      const [savedToken, savedStaff, savedRoster, savedQueue, savedHostels, savedMeals] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
        AsyncStorage.getItem(STAFF_KEY).catch(() => null),
        AsyncStorage.getItem(ROSTER_KEY).catch(() => null),
        AsyncStorage.getItem(QUEUE_KEY).catch(() => null),
        AsyncStorage.getItem(HOSTELS_KEY).catch(() => null),
        AsyncStorage.getItem(MEALS_KEY).catch(() => null),
      ]);
      try {
        if (savedQueue) {
          queueRef.current = JSON.parse(savedQueue);
          setQueueState(queueRef.current);
        }
        // Meal log, plus any meals still in the scan history (phones updated mid-meet start with one)
        const log: MealLog = savedMeals ? JSON.parse(savedMeals) : {};
        for (const q of queueRef.current) {
          if (q.kind === 'meal' && q.athleteId && q.mealType && q.mealDate && q.status !== 'rejected') {
            const key = mealKey(q.athleteId, q.mealType, q.mealDate);
            if (!log[key]) log[key] = q.scannedAt;
          }
        }
        mealLogRef.current = pruneMealLog(log, istDate());
        setMealLogState(mealLogRef.current);
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

  // Food counter / hostel desk decide from the saved list: keep it fresh (check-ins, payments)
  useEffect(() => {
    if (status !== 'signedIn' || !staff || !['food_volunteer', 'warden'].includes(staff.role)) return;
    const timer = setInterval(() => {
      if (!networkLooksDown()) refreshRoster();
    }, SCANNER_ROSTER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [status, staff, refreshRoster, networkLooksDown]);

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
  const oldestPendingAt = useMemo(() => queue.find((q) => q.status === 'pending')?.scannedAt ?? null, [queue]);

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
      mealLog,
      pendingCount,
      oldestPendingAt,
      syncing,
      lastSyncError,
      login,
      logout,
      refreshRoster,
      submit,
      submitOp,
      syncNow,
    }),
    [status, staff, token, sessionExpired, roster, rosterAt, rosterIndex, hostels, queue, mealLog, pendingCount, oldestPendingAt, syncing, lastSyncError, login, logout, refreshRoster, submit, submitOp, syncNow]
  );

  return <OfficialSessionContext.Provider value={value}>{children}</OfficialSessionContext.Provider>;
}

export function useOfficialSession(): Ctx {
  const ctx = useContext(OfficialSessionContext);
  if (!ctx) throw new Error('useOfficialSession must be used inside OfficialSessionProvider');
  return ctx;
}
