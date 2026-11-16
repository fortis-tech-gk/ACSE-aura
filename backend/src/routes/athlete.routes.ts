import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { supabase } from '../config/supabase';
import { signPhotoUrl } from '../utils/photo-links';
import { authenticate, requireRole, generateToken, AuthenticatedRequest } from '../middleware/auth';
import { makeAthleteQrToken, verifyAthleteQrToken } from '../utils/athlete-qr';
import { isLoginThrottled, recordLoginFailure, clearLoginFailures, THROTTLE_MESSAGE } from '../utils/login-throttle';

/**
 * AURA Athletes app API.
 *
 *   POST   /api/athlete/login        { bib, dob }  or  { qrToken }
 *   GET    /api/athlete/me           profile, photo, events, schedule (heat/lane/call room), hostel, meals
 *   POST   /api/athlete/push-token   { token, platform }  register this device for push notifications
 *   DELETE /api/athlete/push-token   { token }            unregister on logout
 *
 * All meet times are India Standard Time; the API returns absolute ISO timestamps
 * (with +05:30) so phones in any timezone schedule reminders correctly.
 */
export const athleteRouter = Router();

const IST_OFFSET = '+05:30';
/** Fallback when an event has no explicit call room time: report this long before the start */
const DEFAULT_CALL_ROOM_LEAD_MIN = 30;

// Per-IP cap sized for 3000 athletes logging in over shared venue Wi-Fi / carrier NAT.
// The real brute-force guard is per bib (8 failures / 15 min, login_attempts table).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this network. Please wait 15 minutes.' },
});

function istIso(date?: string | null, time?: string | null): string | null {
  if (!date || !time) return null;
  const t = String(time).slice(0, 8);
  const iso = `${date}T${t.length === 5 ? `${t}:00` : t}${IST_OFFSET}`;
  return isNaN(new Date(iso).getTime()) ? null : iso;
}

function istToday(): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/**
 * POST /api/athlete/login
 * Body: { bib: number|string, dob: "YYYY-MM-DD" }  — or —  { qrToken: "AURA26.<id>.<sig>" }
 */
athleteRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const ip = req.ip || 'unknown';
    const qrToken = typeof req.body?.qrToken === 'string' ? req.body.qrToken.trim() : '';
    let profileId: string | null = null;
    let throttleKey = '';

    if (qrToken) {
      profileId = verifyAthleteQrToken(qrToken);
      if (!profileId) {
        return res.status(401).json({ error: 'This QR code is not a valid AURA athlete ID card.' });
      }
    } else {
      const bibRaw = String(req.body?.bib ?? '').trim();
      const dob = String(req.body?.dob ?? '').trim();
      if (!/^\d{1,5}$/.test(bibRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        return res.status(400).json({ error: 'Enter your bib number and date of birth.' });
      }
      const bib = parseInt(bibRaw, 10);
      throttleKey = String(bib);

      if (await isLoginThrottled('athlete', throttleKey, ip, 8, 1000)) {
        return res.status(429).json({ error: THROTTLE_MESSAGE });
      }

      const { data: match, error } = await supabase
        .from('profiles')
        .select('id, date_of_birth')
        .eq('bid_number', bib)
        .neq('accreditation_status', 'WITHDrAWN')
        .maybeSingle();

      if (error) return res.status(500).json({ error: 'Login is temporarily unavailable. Please try again.' });

      if (match && !match.date_of_birth) {
        return res.status(409).json({
          error: 'Your date of birth has not been recorded yet. Ask your college PED to add it on the registration portal, or scan the QR on your ID card.',
        });
      }
      if (!match || match.date_of_birth !== dob) {
        await recordLoginFailure('athlete', throttleKey, ip);
        return res.status(401).json({ error: 'Bib number and date of birth do not match.' });
      }
      profileId = match.id;
    }

    const { data: athlete } = await supabase
      .from('profiles')
      .select('id, sslc_name, bid_number, accreditation_status, squads ( colleges ( id ) )')
      .eq('id', profileId)
      .maybeSingle();

    if (!athlete || athlete.accreditation_status === 'WITHDrAWN') {
      return res.status(404).json({ error: 'This athlete is not registered for the championship.' });
    }
    if (throttleKey) await clearLoginFailures('athlete', throttleKey);

    const token = generateToken({
      role: 'athlete',
      entityId: athlete.id,
      displayName: athlete.sslc_name,
      collegeId: (athlete.squads as any)?.colleges?.id,
    });

    return res.json({ success: true, token, athlete: { id: athlete.id, name: athlete.sslc_name, bibNumber: athlete.bid_number } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/athlete/me
 */
athleteRouter.get('/me', authenticate, requireRole(['athlete']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const athleteId = req.user!.entityId;

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select(`
        id, sslc_name, usn, bid_number, blood_group, semester, photo_url,
        accreditation_status, accredited_at,
        squads ( id, squad_code, gender, colleges ( id, name, code, district ) )
      `)
      .eq('id', athleteId)
      .maybeSingle();

    if (profErr || !profile || profile.accreditation_status === 'WITHDrAWN') {
      return res.status(404).json({ error: 'Athlete profile not found.' });
    }
    const squad: any = profile.squads;

    // Registered events
    const { data: registrations } = await supabase
      .from('registrations')
      .select('kind, events ( id, name, code, category )')
      .eq('profile_id', athleteId);

    // Relay teams this athlete belongs to (leg or reserve)
    const { data: relayMemberships } = await supabase
      .from('relay_members')
      .select('relay_team_id, leg_order, is_reserve, relay_teams ( event_id )')
      .eq('profile_id', athleteId);
    const relayTeamIds = (relayMemberships || []).map((m: any) => m.relay_team_id);
    const relayByTeam = new Map((relayMemberships || []).map((m: any) => [m.relay_team_id, m]));

    // Heat assignments: individual + relay team entries
    const heatSelect = `
      id, lane_number, call_room_reported, call_room_reported_at, relay_team_id,
      heats (
        id, stage, heat_number, status,
        events ( id, name, code, category ),
        schedule_items ( scheduled_time, call_room_time, status, schedule_sessions ( session_date, session_name ) )
      )`;
    const [{ data: ownHeats }, { data: relayHeats }] = await Promise.all([
      supabase.from('heat_athletes').select(heatSelect).eq('profile_id', athleteId),
      relayTeamIds.length > 0
        ? supabase.from('heat_athletes').select(heatSelect).in('relay_team_id', relayTeamIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    type ScheduleEntry = {
      key: string;
      eventId: string;
      eventName: string;
      eventCode: string;
      category: string;
      kind: string;
      stage: string | null;
      heatNumber: number | null;
      lane: number | null;
      relayLeg: number | null;
      isRelayReserve: boolean;
      sessionName: string | null;
      startAt: string | null;
      callRoomAt: string | null;
      callRoomEstimated: boolean;
      status: string;
      reported: boolean;
    };
    const schedule: ScheduleEntry[] = [];
    const eventsWithHeats = new Set<string>();
    const kindByEvent = new Map<string, string>(
      (registrations || []).map((r: any) => [r.events?.id, r.kind])
    );

    for (const ha of [...(ownHeats || []), ...(relayHeats || [])] as any[]) {
      const heat = ha.heats;
      if (!heat?.events) continue;
      const si = heat.schedule_items;
      const date = si?.schedule_sessions?.session_date;
      const startAt = istIso(date, si?.scheduled_time);
      let callRoomAt = istIso(date, si?.call_room_time);
      const callRoomEstimated = !callRoomAt && !!startAt;
      if (!callRoomAt && startAt) {
        callRoomAt = new Date(new Date(startAt).getTime() - DEFAULT_CALL_ROOM_LEAD_MIN * 60000).toISOString();
      }
      const relay = ha.relay_team_id ? relayByTeam.get(ha.relay_team_id) : null;
      eventsWithHeats.add(heat.events.id);
      schedule.push({
        key: `heat-${ha.id}`,
        eventId: heat.events.id,
        eventName: heat.events.name,
        eventCode: heat.events.code,
        category: heat.events.category,
        kind: kindByEvent.get(heat.events.id) || (relay ? 'relay' : 'regular'),
        stage: heat.stage,
        heatNumber: heat.heat_number,
        lane: ha.lane_number,
        relayLeg: relay?.leg_order ?? null,
        isRelayReserve: !!relay?.is_reserve,
        sessionName: si?.schedule_sessions?.session_name || null,
        startAt,
        callRoomAt,
        callRoomEstimated,
        status: heat.status || si?.status || 'SCHEDULED',
        reported: !!ha.call_room_reported,
      });
    }

    // Registered events with no heat drawn yet: show the event's first scheduled round
    const pendingEventIds = (registrations || [])
      .map((r: any) => r.events?.id)
      .filter((id: string | undefined) => id && !eventsWithHeats.has(id));
    if (pendingEventIds.length > 0) {
      const { data: items } = await supabase
        .from('schedule_items')
        .select('event_id, stage, scheduled_time, call_room_time, status, schedule_sessions ( session_date, session_name )')
        .in('event_id', pendingEventIds);
      for (const r of (registrations || []) as any[]) {
        const ev = r.events;
        if (!ev || eventsWithHeats.has(ev.id)) continue;
        const rounds = (items || [])
          .filter((i: any) => i.event_id === ev.id)
          .map((i: any) => ({ i, startAt: istIso(i.schedule_sessions?.session_date, i.scheduled_time) }))
          .sort((a: any, b: any) => String(a.startAt).localeCompare(String(b.startAt)));
        const first = rounds[0];
        const startAt = first?.startAt || null;
        let callRoomAt = first ? istIso(first.i.schedule_sessions?.session_date, first.i.call_room_time) : null;
        const callRoomEstimated = !callRoomAt && !!startAt;
        if (!callRoomAt && startAt) {
          callRoomAt = new Date(new Date(startAt).getTime() - DEFAULT_CALL_ROOM_LEAD_MIN * 60000).toISOString();
        }
        schedule.push({
          key: `event-${ev.id}`,
          eventId: ev.id,
          eventName: ev.name,
          eventCode: ev.code,
          category: ev.category,
          kind: r.kind,
          stage: first?.i.stage || null,
          heatNumber: null,
          lane: null,
          relayLeg: null,
          isRelayReserve: false,
          sessionName: first?.i.schedule_sessions?.session_name || null,
          startAt,
          callRoomAt,
          callRoomEstimated,
          status: first?.i.status || 'SCHEDULED',
          reported: false,
        });
      }
    }

    schedule.sort((a, b) => {
      if (!a.startAt && !b.startAt) return a.eventName.localeCompare(b.eventName);
      if (!a.startAt) return 1;
      if (!b.startAt) return -1;
      return a.startAt.localeCompare(b.startAt);
    });

    // Hostel allocation (per squad) + this athlete's check-in
    const [{ data: hostelAlloc }, { data: checkin }] = await Promise.all([
      supabase.from('hostel_allocations').select('room_range, notes, hostels ( name )').eq('squad_id', squad?.id).maybeSingle(),
      supabase.from('accommodation_scans').select('room_assigned, synced_at').eq('profile_id', athleteId).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    // Today's meals (India date)
    const today = istToday();
    const { data: todayMeals } = await supabase
      .from('meal_logs')
      .select('meal_type, scanned_at')
      .eq('profile_id', athleteId)
      .eq('meal_date', today);

    return res.json({
      serverTime: new Date().toISOString(),
      athlete: {
        id: profile.id,
        name: profile.sslc_name,
        usn: profile.usn,
        bibNumber: profile.bid_number,
        gender: squad?.gender || null,
        bloodGroup: profile.blood_group,
        semester: profile.semester,
        photoUrl: await signPhotoUrl(profile.photo_url),
        accreditationStatus: profile.accreditation_status,
        accreditedAt: profile.accredited_at,
        college: squad?.colleges || null,
        squadCode: squad?.squad_code || null,
        qrToken: makeAthleteQrToken(profile.id),
      },
      events: (registrations || [])
        .filter((r: any) => r.events)
        .map((r: any) => ({ kind: r.kind, id: r.events.id, name: r.events.name, code: r.events.code, category: r.events.category })),
      schedule,
      hostel: hostelAlloc
        ? {
            name: (hostelAlloc as any).hostels?.name || null,
            roomRange: hostelAlloc.room_range || null,
            notes: hostelAlloc.notes || null,
            checkedIn: !!checkin,
            room: checkin?.room_assigned || null,
            checkedInAt: checkin?.synced_at || null,
          }
        : null,
      meals: {
        date: today,
        claimed: (todayMeals || []).map((m: any) => ({ mealType: m.meal_type, at: m.scanned_at })),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/athlete/push-token  { token: "ExponentPushToken[...]", platform: "android"|"ios" }
 */
athleteRouter.post('/push-token', authenticate, requireRole(['athlete']), async (req: AuthenticatedRequest, res: Response) => {
  const token = String(req.body?.token || '').trim();
  const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
  if (!/^Expo(nent)?PushToken\[[^\]]{10,}\]$/.test(token)) {
    return res.status(400).json({ error: 'Invalid push token.' });
  }
  const { error } = await supabase.from('device_push_tokens').upsert(
    {
      expo_push_token: token,
      app: 'athletes',
      profile_id: req.user!.entityId,
      staff_id: null,
      platform,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'expo_push_token' }
  );
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

/**
 * DELETE /api/athlete/push-token  { token }
 */
athleteRouter.delete('/push-token', authenticate, requireRole(['athlete']), async (req: AuthenticatedRequest, res: Response) => {
  const token = String(req.body?.token || '').trim();
  if (token) {
    await supabase.from('device_push_tokens').delete().eq('expo_push_token', token).eq('profile_id', req.user!.entityId);
  }
  return res.json({ success: true });
});

// ----------------------------------------------------------------------------
// My Performance
// ----------------------------------------------------------------------------

type Attempt = { round?: number; attempt?: number; type?: string; mark?: number | null; height?: number; result?: string; wind?: number | null };

function bestOf(entry: any, category: string): { value: number | null; status: string | null; reaction: number | null; wind: number | null; dq: string | null; attempts: Attempt[] } {
  if (category === 'field_vertical_jump') {
    const att: any[] = entry.vertical_jump_attempts || [];
    const cleared = att.filter((a) => a.result === 'O').map((a) => Number(a.bar_height_meters));
    return {
      value: cleared.length ? Math.max(...cleared) : null,
      status: att.length && !cleared.length ? 'NM' : null,
      reaction: null,
      wind: null,
      dq: null,
      attempts: att
        .map((a) => ({ height: Number(a.bar_height_meters), attempt: a.attempt_number, result: a.result }))
        .sort((x, y) => x.height! - y.height! || x.attempt! - y.attempt!),
    };
  }
  if (category.startsWith('field_')) {
    const att: any[] = entry.field_attempts || [];
    const valid = att.filter((a) => a.attempt_type === 'VALID' && a.mark_meters != null).map((a) => Number(a.mark_meters));
    return {
      value: valid.length ? Math.max(...valid) : null,
      status: att.length && !valid.length ? 'NM' : null,
      reaction: null,
      wind: null,
      dq: null,
      attempts: att
        .map((a) => ({ round: a.round_number, type: a.attempt_type, mark: a.mark_meters != null ? Number(a.mark_meters) : null, wind: a.wind_reading != null ? Number(a.wind_reading) : null }))
        .sort((x, y) => x.round! - y.round!),
    };
  }
  // Track / relay / road: one result row
  const tr = Array.isArray(entry.track_results) ? entry.track_results[0] : entry.track_results;
  if (!tr) return { value: null, status: null, reaction: null, wind: null, dq: null, attempts: [] };
  return {
    value: tr.status === 'FINISHED' && tr.time_seconds != null ? Number(tr.time_seconds) : null,
    status: tr.status === 'FINISHED' ? null : tr.status,
    reaction: tr.reaction_time_ms ?? null,
    wind: tr.wind_reading != null ? Number(tr.wind_reading) : null,
    dq: tr.dq_rule || null,
    attempts: [],
  };
}

/**
 * GET /api/athlete/performance
 * The athlete's results per round (incl. relays): time / best mark, place within the heat,
 * attempts, official placings (medals + points) and the college's current standing.
 */
athleteRouter.get('/performance', authenticate, requireRole(['athlete']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const athleteId = req.user!.entityId;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, squad_id, squads ( gender, college_id )')
      .eq('id', athleteId)
      .maybeSingle();
    if (!profile) return res.status(404).json({ error: 'Athlete profile not found.' });
    const squad: any = profile.squads;

    const { data: memberships } = await supabase
      .from('relay_members')
      .select('relay_team_id, leg_order, is_reserve')
      .eq('profile_id', athleteId);
    const teamIds = (memberships || []).map((m: any) => m.relay_team_id);
    const legByTeam = new Map((memberships || []).map((m: any) => [m.relay_team_id, m]));

    // Which heats this athlete (or their relay team) is in
    const mine = await Promise.all([
      supabase.from('heat_athletes').select('id, heat_id, relay_team_id').eq('profile_id', athleteId),
      teamIds.length ? supabase.from('heat_athletes').select('id, heat_id, relay_team_id').in('relay_team_id', teamIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const myEntries: any[] = [...(mine[0].data || []), ...(mine[1].data || [])];
    const heatIds = Array.from(new Set(myEntries.map((e) => e.heat_id)));

    // Everyone in those heats (to compute places) + heat/event/schedule info
    const [{ data: heats }, { data: allEntries }] = heatIds.length
      ? await Promise.all([
          supabase
            .from('heats')
            .select('id, stage, heat_number, status, wind_reading, events ( id, name, code, category, measurement_unit ), schedule_items ( scheduled_time, schedule_sessions ( session_date ) )')
            .in('id', heatIds),
          supabase
            .from('heat_athletes')
            .select(`
              id, heat_id, lane_number,
              track_results ( time_seconds, status, reaction_time_ms, wind_reading, dq_rule ),
              field_attempts ( round_number, attempt_type, mark_meters, wind_reading ),
              vertical_jump_attempts ( bar_height_meters, attempt_number, result )
            `)
            .in('heat_id', heatIds),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];

    const heatById = new Map((heats || []).map((h: any) => [h.id, h]));
    const entriesByHeat = new Map<string, any[]>();
    for (const e of allEntries || []) {
      const list = entriesByHeat.get(e.heat_id) || [];
      list.push(e);
      entriesByHeat.set(e.heat_id, list);
    }

    const results = myEntries.map((mineEntry) => {
      const heat: any = heatById.get(mineEntry.heat_id);
      const category: string = heat?.events?.category || 'track_sprint';
      const lowerIsBetter = !category.startsWith('field_');
      const heatEntries = entriesByHeat.get(mineEntry.heat_id) || [];
      const scored = heatEntries.map((e) => ({ id: e.id, lane: e.lane_number, ...bestOf(e, category) }));
      const me = scored.find((s) => s.id === mineEntry.id) || { value: null, status: null, reaction: null, wind: null, dq: null, attempts: [], lane: null };
      let placeInHeat: number | null = null;
      if (me.value != null) {
        const better = scored.filter((s) => s.value != null && (lowerIsBetter ? s.value < me.value! : s.value > me.value!)).length;
        placeInHeat = better + 1;
      }
      const relay = mineEntry.relay_team_id ? legByTeam.get(mineEntry.relay_team_id) : null;
      const date = heat?.schedule_items?.schedule_sessions?.session_date;
      return {
        key: mineEntry.id,
        eventId: heat?.events?.id,
        eventName: heat?.events?.name || 'Event',
        eventCode: heat?.events?.code || '',
        category,
        unit: lowerIsBetter ? 'seconds' : 'metres',
        stage: heat?.stage || null,
        heatNumber: heat?.heat_number ?? null,
        heatStatus: heat?.status || 'SCHEDULED',
        lane: (me as any).lane ?? null,
        relayLeg: relay?.leg_order ?? null,
        startAt: istIso(date, heat?.schedule_items?.scheduled_time),
        value: me.value,
        status: me.status,
        dqRule: me.dq,
        reactionMs: me.reaction,
        wind: me.wind ?? (heat?.wind_reading != null ? Number(heat.wind_reading) : null),
        attempts: me.attempts,
        placeInHeat,
        finishers: scored.filter((s) => s.value != null).length,
        entrants: scored.length,
      };
    });
    results.sort((a, b) => String(b.startAt || '').localeCompare(String(a.startAt || '')));

    // Official placings (medals / championship points)
    const orFilter = [`profile_id.eq.${athleteId}`, ...teamIds.map((t: string) => `relay_team_id.eq.${t}`)].join(',');
    const { data: placings } = await supabase
      .from('team_points')
      .select('place, points, relay_team_id, events ( id, name, code, category )')
      .or(orFilter);
    const official = (placings || [])
      .map((p: any) => ({
        eventId: p.events?.id,
        eventName: p.events?.name,
        eventCode: p.events?.code,
        isRelay: !!p.relay_team_id,
        isMixed: String(p.events?.code || '').toUpperCase() === '4X400M-MIX',
        place: p.place,
        points: Number(p.points) || 0,
      }))
      .sort((a: any, b: any) => a.place - b.place);

    // College standing (same rules as the public leaderboard)
    let collegeStanding: any = null;
    try {
      const { data: standings } = await supabase.rpc('get_championship_standings');
      const s: any = standings || {};
      const find = (list: any[]) => (list || []).find((r: any) => r.college_id === squad?.college_id) || null;
      const overall = find(s.combined);
      const division = find(squad?.gender === 'women' ? s.womens : s.mens);
      collegeStanding = {
        overallRank: overall?.rank ?? null,
        overallPoints: overall ? Number(overall.total_points) : null,
        divisionRank: division?.rank ?? null,
        divisionPoints: division ? Number(division.total_points) : null,
        colleges: (s.combined || []).length,
      };
    } catch {
      // standings optional
    }

    const individual = official.filter((o: any) => !o.isRelay);
    return res.json({
      serverTime: new Date().toISOString(),
      summary: {
        golds: official.filter((o: any) => o.place === 1).length,
        silvers: official.filter((o: any) => o.place === 2).length,
        bronzes: official.filter((o: any) => o.place === 3).length,
        individualPoints: individual.reduce((sum: number, o: any) => sum + o.points, 0),
        eventsCompleted: results.filter((r) => r.value != null || r.status).length,
      },
      official,
      results,
      collegeStanding,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
