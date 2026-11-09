export type ScheduleEntry = {
  key: string;
  eventId: string;
  eventName: string;
  eventCode: string;
  category: string;
  /** registration kind: regular | reserve | relay | half_marathon */
  kind: string;
  stage: string | null;
  heatNumber: number | null;
  lane: number | null;
  relayLeg: number | null;
  isRelayReserve: boolean;
  sessionName: string | null;
  /** ISO timestamps with +05:30 offset */
  startAt: string | null;
  callRoomAt: string | null;
  callRoomEstimated: boolean;
  status: string;
  reported: boolean;
};

export type AthleteMe = {
  serverTime: string;
  athlete: {
    id: string;
    name: string;
    usn: string;
    bibNumber: number | null;
    gender: 'men' | 'women' | null;
    bloodGroup: string | null;
    semester: number | null;
    photoUrl: string | null;
    accreditationStatus: string;
    accreditedAt: string | null;
    college: { id: string; name: string; code: string; district: string | null } | null;
    squadCode: string | null;
    qrToken: string;
  };
  events: { kind: string; id: string; name: string; code: string; category: string }[];
  schedule: ScheduleEntry[];
  hostel: {
    name: string | null;
    roomRange: string | null;
    notes: string | null;
    checkedIn: boolean;
    room: string | null;
    checkedInAt: string | null;
  } | null;
  meals: { date: string; claimed: { mealType: string; at: string }[] };
};

export type PerformanceResult = {
  key: string;
  eventId: string;
  eventName: string;
  eventCode: string;
  category: string;
  unit: 'seconds' | 'metres';
  stage: string | null;
  heatNumber: number | null;
  heatStatus: string;
  lane: number | null;
  relayLeg: number | null;
  startAt: string | null;
  /** seconds for track/relay/road, metres for field (best valid mark / highest bar cleared) */
  value: number | null;
  /** DNF | DQ | DNS | NM (no mark) — null when finished normally or not yet run */
  status: string | null;
  dqRule: string | null;
  reactionMs: number | null;
  wind: number | null;
  attempts: { round?: number; attempt?: number; type?: string; mark?: number | null; height?: number; result?: string; wind?: number | null }[];
  placeInHeat: number | null;
  finishers: number;
  entrants: number;
};

export type AthletePerformance = {
  serverTime: string;
  summary: { golds: number; silvers: number; bronzes: number; individualPoints: number; eventsCompleted: number };
  official: { eventId: string; eventName: string; eventCode: string; isRelay: boolean; isMixed: boolean; place: number; points: number }[];
  results: PerformanceResult[];
  collegeStanding: { overallRank: number | null; overallPoints: number | null; divisionRank: number | null; divisionPoints: number | null; colleges: number } | null;
};

export type StandingRow = {
  rank: number;
  college_id: string;
  college_name: string;
  college_code: string;
  district?: string | null;
  total_points: number | string;
  golds: number;
  silvers: number;
  bronzes: number;
};

export type BestAthleteRow = {
  rank: number;
  profile_id: string;
  athlete_name: string;
  bid_number: number | null;
  college_name: string;
  college_code: string;
  total_points: number | string;
  golds: number;
  silvers: number;
  bronzes: number;
};

export type LiveLeaderboard = {
  status: string;
  timestamp: string;
  standings: {
    combined?: StandingRow[];
    mens?: StandingRow[];
    womens?: StandingRow[];
    best_male_athletes?: BestAthleteRow[];
    best_female_athletes?: BestAthleteRow[];
  };
};
