import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { signPhotoUrls } from '../utils/photo-links';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { fetchAll } from '../utils/fetch-all';

/**
 * AURA Officials app support.
 * GET /api/officials/roster — every registered athlete, small enough to keep on the phone, so a
 * scanner can still show who the athlete is (name, college, bib, photo) with no network.
 * Faculty, PEDs and meet officials with a meal pass (migration 0057) ride on the same list:
 * their pass number stands in for the bib, so the food counter works offline for them too.
 */
export const officialsRouter = Router();

officialsRouter.use(authenticate);
officialsRouter.use(
  requireRole(['meet_admin', 'food_volunteer', 'warden', 'accreditation_volunteer', 'call_room_official', 'referee'])
);

const IST_OFFSET = '+05:30';
export function istIso(date?: string | null, time?: string | null): string | null {
  if (!date || !time) return null;
  const t = String(time).slice(0, 8);
  const iso = `${date}T${t.length === 5 ? `${t}:00` : t}${IST_OFFSET}`;
  return isNaN(new Date(iso).getTime()) ? null : iso;
}
const DEFAULT_CALL_ROOM_LEAD_MIN = 30;

/** Event category → which referee screen the app shows */
function heatKind(category: string): 'track' | 'relay' | 'field' | 'vertical' | 'combined' {
  if (category === 'relay') return 'relay';
  if (category === 'combined') return 'combined';
  if (category === 'field_vertical_jump') return 'vertical';
  if (category === 'field_throw' || category === 'field_horizontal_jump') return 'field';
  return 'track';
}

/**
 * GET /api/officials/heats
 * Every heat / flight for call room officials and referees, with start and call room times
 * (India time), status and check-in counts. A referee with assigned events sees only those.
 */
officialsRouter.get(
  '/heats',
  requireRole(['meet_admin', 'call_room_official', 'referee']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const [heats, items] = await Promise.all([
        fetchAll<any>((from, to) =>
          supabase
            .from('heats')
            .select(
              'id, event_id, stage, heat_number, status, wind_reading, schedule_item_id, events(id, name, code, gender, category, measurement_unit), heat_athletes(id, call_room_reported)'
            )
            .order('id')
            .range(from, to) as any
        ),
        fetchAll<any>((from, to) =>
          supabase
            .from('schedule_items')
            .select('id, event_id, stage, scheduled_time, call_room_time, status, schedule_sessions(session_date)')
            .order('id')
            .range(from, to) as any
        ),
      ]);

      const byId = new Map(items.map((i) => [i.id, i]));
      const byEventStage = new Map<string, any>();
      for (const i of items) {
        const k = `${i.event_id}|${i.stage}`;
        const prev = byEventStage.get(k);
        const at = istIso(i.schedule_sessions?.session_date, i.scheduled_time);
        if (!prev || String(at) < String(istIso(prev.schedule_sessions?.session_date, prev.scheduled_time))) byEventStage.set(k, i);
      }

      const scope: string[] = req.user?.role === 'referee' ? req.user.scopeEventIds || [] : [];

      const list = heats
        .filter((h) => !scope.length || scope.includes(h.event_id))
        .map((h) => {
          const si = (h.schedule_item_id && byId.get(h.schedule_item_id)) || byEventStage.get(`${h.event_id}|${h.stage}`) || null;
          const date = si?.schedule_sessions?.session_date || null;
          const startAt = istIso(date, si?.scheduled_time);
          let callRoomAt = istIso(date, si?.call_room_time);
          if (!callRoomAt && startAt) callRoomAt = new Date(new Date(startAt).getTime() - DEFAULT_CALL_ROOM_LEAD_MIN * 60000).toISOString();
          const entries = h.heat_athletes || [];
          return {
            id: h.id,
            eventId: h.event_id,
            eventName: h.events?.name || 'Event',
            eventCode: h.events?.code || '',
            gender: h.events?.gender || null,
            category: h.events?.category || '',
            kind: heatKind(h.events?.category || ''),
            unit: h.events?.measurement_unit || 'seconds',
            stage: h.stage,
            heatNumber: h.heat_number,
            status: h.status,
            wind: h.wind_reading,
            startAt,
            callRoomAt,
            entries: entries.length,
            reported: entries.filter((e: any) => e.call_room_reported).length,
          };
        })
        .sort((a, b) => {
          if (a.startAt && b.startAt && a.startAt !== b.startAt) return a.startAt.localeCompare(b.startAt);
          if (!a.startAt !== !b.startAt) return a.startAt ? -1 : 1;
          return a.eventName.localeCompare(b.eventName) || a.heatNumber - b.heatNumber;
        });

      return res.json({ generatedAt: new Date().toISOString(), heats: list });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

type DelegateRosterRow = {
  id: string;
  full_name: string;
  pass_no: number;
  category: string;
  designation: string | null;
  organisation: string | null;
  college_id: string | null;
  accreditation_status: string;
  colleges: { code: string; name: string } | null;
};

type RosterRow = {
  id: string;
  sslc_name: string;
  usn: string | null;
  bid_number: number | null;
  photo_url: string | null;
  accreditation_status: string;
  accommodation_checked_in: boolean | null;
  squad_id: string;
  squads: { gender: string; payment_status: string; colleges: { code: string; name: string } | null } | null;
};

officialsRouter.get('/roster', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [rows, allocations, delegateRows, squadPayments] = await Promise.all([
      fetchAll<RosterRow>((from, to) =>
        supabase
          .from('profiles')
          .select(
            'id, sslc_name, usn, bid_number, photo_url, accreditation_status, accommodation_checked_in, squad_id, squads ( gender, payment_status, colleges ( code, name ) )'
          )
          .neq('accreditation_status', 'WITHDrAWN')
          .order('id')
          .range(from, to) as any
      ),
      fetchAll<{ squad_id: string; hostel_id: string; room_range: string | null; hostels: { name: string } | null }>((from, to) =>
        supabase.from('hostel_allocations').select('squad_id, hostel_id, room_range, hostels ( name )').order('id').range(from, to) as any
      ),
      // Passes without meals stay off the list on purpose: the counter must ask the server,
      // so a phone can never wave through someone the meet office issued "no meals" to.
      fetchAll<DelegateRosterRow>((from, to) =>
        supabase
          .from('delegates')
          .select(
            'id, full_name, pass_no, category, designation, organisation, college_id, accreditation_status, colleges ( code, name )'
          )
          .eq('meals_included', true)
          .neq('accreditation_status', 'WITHDRAWN')
          .order('id')
          .range(from, to) as any
      ),
      fetchAll<{ college_id: string; payment_status: string }>((from, to) =>
        supabase.from('squads').select('college_id, payment_status').order('id').range(from, to) as any
      ),
    ]);

    const bySquad = new Map(allocations.map((a) => [a.squad_id, a]));
    // Photos are in a private bucket: signed links, cached by the app with the roster
    const signed = await signPhotoUrls(rows.map((p) => p.photo_url));
    const athletes = rows.map((p) => {
      const alloc = bySquad.get(p.squad_id);
      return {
        id: p.id,
        name: p.sslc_name,
        usn: p.usn,
        bib: p.bid_number,
        photoUrl: p.photo_url ? signed.get(p.photo_url) ?? p.photo_url : null,
        gender: p.squads?.gender ?? null,
        collegeCode: p.squads?.colleges?.code ?? null,
        collegeName: p.squads?.colleges?.name ?? null,
        feesVerified: p.squads?.payment_status === 'VERIFIED',
        accredited: p.accreditation_status === 'ACCREDITED',
        checkedIn: !!p.accommodation_checked_in,
        hostelId: alloc?.hostel_id ?? null,
        hostelName: alloc?.hostels?.name ?? null,
        roomRange: alloc?.room_range ?? null,
      };
    });

    // Colleges whose fee is verified on either squad (one payment per college)
    const paidColleges = new Set(
      squadPayments.filter((s) => s.payment_status === 'VERIFIED').map((s) => s.college_id)
    );
    const delegates = delegateRows.map((d) => {
      const college = Array.isArray(d.colleges) ? (d.colleges as any)[0] : d.colleges;
      const role =
        d.category === 'PED' ? 'Physical Education Director' : d.designation || (d.category === 'FACULTY' ? 'Faculty' : 'Meet official');
      return {
        id: d.id,
        name: d.full_name,
        // The app shows the USN line under the name: say what this person is instead
        usn: role,
        // The pass number is typeable at a counter exactly like a bib (90001+)
        bib: d.pass_no,
        photoUrl: null,
        gender: null,
        collegeCode: college?.code ?? (d.organisation || 'AURA 2026'),
        collegeName: college?.name ?? (d.organisation || 'Meet organising committee'),
        feesVerified: d.college_id ? paidColleges.has(d.college_id) : true,
        accredited: d.accreditation_status === 'ACCREDITED',
        checkedIn: false,
        hostelId: null,
        hostelName: null,
        roomRange: null,
        isDelegate: true,
        role,
      };
    });

    const all = [...athletes, ...delegates];
    return res.json({
      generatedAt: new Date().toISOString(),
      count: all.length,
      athleteCount: athletes.length,
      delegateCount: delegates.length,
      athletes: all,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
