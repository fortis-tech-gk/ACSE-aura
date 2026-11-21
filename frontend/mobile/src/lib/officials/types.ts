export type OfficialRole = 'food_volunteer' | 'warden' | 'accreditation_volunteer' | 'meet_admin' | 'call_room_official' | 'referee';

/** Roles the officials app can serve today (call room and referees come later) */
export type ScanRole = 'food_volunteer' | 'warden' | 'accreditation_volunteer';

/** Duties an official can log in as */
export type LoginRole = ScanRole | 'call_room_official' | 'referee';

export type Staff = { id: string; displayName: string; role: OfficialRole };

export type RosterAthlete = {
  id: string;
  name: string;
  usn: string | null;
  bib: number | null;
  photoUrl: string | null;
  gender: 'men' | 'women' | null;
  collegeCode: string | null;
  collegeName: string | null;
  feesVerified: boolean;
  accredited: boolean;
  checkedIn: boolean;
  hostelId: string | null;
  hostelName: string | null;
  roomRange: string | null;
};

export type MealType = 'BREAKFAST' | 'LUNCH' | 'SNACKS' | 'DINNER';

/** What the official scanned or typed */
export type AthleteRef = { qrToken: string } | { bib: string };

export type ScanKind = 'meal' | 'checkin' | 'accreditation' | 'op';

/** A call room / referee action saved for sending (results, check-ins). Re-sending is safe. */
export type OpPayload = { path: string; method?: 'POST' | 'PATCH'; body: Record<string, unknown>; label: string; heatId?: string };

export type ScanStatus =
  | 'pending' // saved on the device, not yet accepted by the server
  | 'ok' // server accepted
  | 'rejected'; // server said no (already served, wrong hostel, fees not verified…)

export type QueuedScan = {
  id: string; // clientScanUuid — the server ignores a second copy
  kind: ScanKind;
  ref: AthleteRef | null; // null for referee / call room actions
  athleteId: string | null; // from the roster, when known
  mealType?: MealType;
  mealDate?: string; // India date YYYY-MM-DD the meal belongs to
  hostelId?: string;
  room?: string;
  op?: OpPayload;
  scannedAt: string; // ISO
  status: ScanStatus;
  message?: string;
  syncedAt?: string;
  attempts: number;
};

export type Hostel = { id: string; name: string; gender: 'men' | 'women'; total_capacity: number; occupied: number; available: number };

export type HeatKind = 'track' | 'relay' | 'field' | 'vertical' | 'combined';

export type HeatSummary = {
  id: string;
  eventId: string;
  eventName: string;
  eventCode: string;
  gender: 'men' | 'women' | 'mixed' | null;
  category: string;
  kind: HeatKind;
  unit: 'seconds' | 'metres';
  stage: 'HEATS' | 'SEMI_FINAL' | 'FINAL' | 'QUALIFYING';
  heatNumber: number;
  status: 'SCHEDULED' | 'CALL_ROOM' | 'ON_TRACK' | 'IN_PROGRESS' | 'COMPLETED' | 'OFFICIAL';
  wind: number | null;
  startAt: string | null;
  callRoomAt: string | null;
  entries: number;
  reported: number;
};
