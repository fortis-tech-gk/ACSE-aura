/**
 * Server-only payment & fee logic shared by squad, finance and admin actions.
 *
 * Deliberately NOT a 'use server' module: exports here are plain server functions and
 * cannot be invoked from the browser as server actions (no auth bypass on arbitrary squads).
 */
import { supabaseAdmin } from '@/lib/supabase';
import { totalCredited } from '@/lib/payment-status';
import { getEventsCatalogue } from '@/lib/events-catalogue';
import { fetchAllRows, fetchInChunks } from '@/lib/db-fetch-all';

/**
 * Accurately calculates squad fees:
 * - Regular events = ₹100
 * - Reserve events = Free (₹0)
 * - 21km Half Marathon = ₹100
 * - Relay teams = ₹100 for each of the first 4 members; members 5 & 6 free (max ₹400 per team)
 * - Mixed relay = ₹100 for each of the squad's own first 2 members (max ₹200 per squad)
 */
/** Relay fee: ₹100 for each of the first 4 members of a team; members 5 & 6 are free (max ₹400/team). */
export const RELAY_FEE_PER_MEMBER = 100;
export const RELAY_BILLABLE_MEMBERS = 4;
/** Mixed relay: each squad pays for its own members only, at most 2 (₹200 per squad, ₹400 per college). */
export const MIXED_RELAY_BILLABLE_PER_SQUAD = 2;
export const MIXED_RELAY_CODE = '4X400M-MIX';

export interface RelayTeamFee {
  eventId: string;
  code: string;
  name: string;
  members: number;
  billedMembers: number;
  fee: number;
}

/** One squad's entry-fee breakdown (see calculateSquadFees for the rules). */
export interface SquadFeeBreakdown {
  regularEventsCount: number;
  regularFeeRate: number;
  reserveEventsCount: number;
  hmCount: number;
  hmFeeRate: number;
  relayTeamsCount: number;
  relayFeeRate: number;
  relayMembersBilled: number;
  relayFeeTotal: number;
  relayTeams: RelayTeamFee[];
  totalAmount: number;
}

export const REGULAR_EVENT_FEE = 100;
export const HALF_MARATHON_FEE = 100;

export function emptySquadFees(): SquadFeeBreakdown {
  return {
    regularEventsCount: 0,
    regularFeeRate: REGULAR_EVENT_FEE,
    reserveEventsCount: 0,
    hmCount: 0,
    hmFeeRate: HALF_MARATHON_FEE,
    relayTeamsCount: 0,
    relayFeeRate: RELAY_FEE_PER_MEMBER,
    relayMembersBilled: 0,
    relayFeeTotal: 0,
    relayTeams: [],
    totalAmount: 0,
  };
}

const one = (v: any) => (Array.isArray(v) ? v[0] : v);

/**
 * Entry fees for a squad, computed live from the current roster:
 *  - Event 1 / Event 2 / Half Marathon: ₹100 per entry. Reserve events: ₹0.
 *  - Relays: ₹100 × (number of team members, counting at most 4). So a team of 1/2/3 costs
 *    ₹100/₹200/₹300 and a team of 4–6 costs ₹400. A member is any athlete nominated to that
 *    relay (tick-box on the athlete form) or placed on the Relay page lineup — counted once.
 *  - The 4x400m Mixed Relay team is shared by the college's Men's and Women's squads. Each squad
 *    pays ₹100 for each of its OWN members, counting at most 2 (₹100 for 1, ₹200 for 2 or more).
 */
export async function calculateSquadFees(squadId: string): Promise<SquadFeeBreakdown> {
  return (await calculateFeesForSquads([squadId])).get(squadId) ?? emptySquadFees();
}

/**
 * The same fees for MANY squads at once, from four bulk reads instead of five reads per squad.
 * The Payment Verification and Delegations desks list every squad of the meet (~500): one fee
 * query per squad made those pages take a minute and flooded the database connection pool.
 * Squads that do not exist are left out of the map.
 */
export async function calculateFeesForSquads(squadIds: string[]): Promise<Map<string, SquadFeeBreakdown>> {
  const ids = Array.from(new Set(squadIds.filter(Boolean)));
  const fees = new Map<string, SquadFeeBreakdown>();
  if (ids.length === 0) return fees;

  // The squads, each with every squad of its college: the shared Mixed Relay team may be owned
  // by the sibling squad, so that squad's team rows must be read as well.
  const [catalogue, squadRows] = await Promise.all([
    getEventsCatalogue(),
    fetchInChunks(ids, (part) =>
      fetchAllRows<any>(() =>
        supabaseAdmin.from('squads').select('id, college_id, colleges(squads(id))').in('id', part).order('id')
      )
    ),
  ]);
  const collegeOf = new Map<string, string>();
  for (const s of squadRows) {
    collegeOf.set(s.id, s.college_id);
    for (const sib of one(s.colleges)?.squads || []) if (sib?.id) collegeOf.set(sib.id, s.college_id);
  }

  const [regs, teams] = await Promise.all([
    // registrations of the requested squads (joined through profiles)
    fetchInChunks(ids, (part) =>
      fetchAllRows<any>(() =>
        supabaseAdmin
          .from('registrations')
          .select('id, kind, event_id, profile_id, profiles!inner(squad_id)')
          .in('profiles.squad_id', part)
          .order('id')
      )
    ),
    // relay teams of every squad of the colleges involved, with each member's squad
    fetchInChunks(Array.from(collegeOf.keys()), (part) =>
      fetchAllRows<any>(() =>
        supabaseAdmin
          .from('relay_teams')
          .select('id, squad_id, event_id, relay_members(profile_id, profiles(squad_id))')
          .in('squad_id', part)
          .order('id')
      )
    ),
  ]);

  const eventById = new Map(catalogue.map((e) => [e.id, e]));
  const mixedEventIds = new Set(
    catalogue.filter((e) => String(e.code || '').toUpperCase() === MIXED_RELAY_CODE).map((e) => e.id)
  );

  const regsBySquad = new Map<string, any[]>();
  for (const r of regs) {
    const sid = one(r.profiles)?.squad_id;
    if (!sid) continue;
    if (!regsBySquad.has(sid)) regsBySquad.set(sid, []);
    regsBySquad.get(sid)!.push(r);
  }
  const teamsBySquad = new Map<string, any[]>();
  const mixedTeamsByCollege = new Map<string, any[]>();
  for (const t of teams) {
    if (!teamsBySquad.has(t.squad_id)) teamsBySquad.set(t.squad_id, []);
    teamsBySquad.get(t.squad_id)!.push(t);
    const college = collegeOf.get(t.squad_id);
    if (college && mixedEventIds.has(t.event_id)) {
      if (!mixedTeamsByCollege.has(college)) mixedTeamsByCollege.set(college, []);
      mixedTeamsByCollege.get(college)!.push(t);
    }
  }

  for (const squadId of ids) {
    const college = collegeOf.get(squadId);
    if (!college) continue;
    fees.set(
      squadId,
      computeSquadFees(
        squadId,
        regsBySquad.get(squadId) || [],
        teamsBySquad.get(squadId) || [],
        mixedTeamsByCollege.get(college) || [],
        mixedEventIds,
        eventById
      )
    );
  }
  return fees;
}

/** Pure fee rules for one squad, from rows already in memory. */
function computeSquadFees(
  squadId: string,
  regs: any[],
  ownedTeams: any[],
  collegeMixedTeams: any[],
  mixedEventIds: Set<string>,
  eventById: Map<string, { code: string; name: string }>
): SquadFeeBreakdown {
  let regularEventsCount = 0;
  let reserveEventsCount = 0;
  let hmCount = 0;
  const relayEventIds = new Set<string>();
  // event_id -> athletes of THIS squad in that relay
  const nominations = new Map<string, Set<string>>();
  const addMember = (eventId: string, profileId: string) => {
    if (!nominations.has(eventId)) nominations.set(eventId, new Set());
    nominations.get(eventId)!.add(profileId);
  };

  for (const r of regs) {
    if (r.kind === 'regular') regularEventsCount++;
    else if (r.kind === 'reserve') reserveEventsCount++;
    else if (r.kind === 'half_marathon') hmCount++;
    else if (r.kind === 'relay' && r.event_id) {
      relayEventIds.add(r.event_id);
      addMember(r.event_id, r.profile_id);
    }
  }

  // Divisional relays: team members = athletes nominated on the athlete form ∪ the squad's own
  // Relay-page lineup, billed for at most 4.
  for (const t of ownedTeams) {
    if (t.event_id && !mixedEventIds.has(t.event_id) && (t.relay_members || []).length > 0) relayEventIds.add(t.event_id);
  }

  // Mixed relay: the team is shared by the college, but each squad pays only for its OWN members
  // (men's squad for its men, women's squad for its women), at most 2 each — so ₹200 per squad,
  // ₹400 per college. Members = this squad's tick-box nominations ∪ this squad's athletes in the
  // college's mixed team on the Relay page, whichever squad owns that team row.
  for (const t of collegeMixedTeams) {
    for (const m of t.relay_members || []) {
      if (m?.profile_id && one(m.profiles)?.squad_id === squadId) {
        relayEventIds.add(t.event_id);
        addMember(t.event_id, m.profile_id);
      }
    }
  }

  const relayTeams: RelayTeamFee[] = [];
  for (const eventId of relayEventIds) {
    const members = new Set<string>(nominations.get(eventId) || []);
    const isMixed = mixedEventIds.has(eventId);
    if (!isMixed) {
      for (const t of ownedTeams) {
        if (t.event_id !== eventId) continue;
        for (const m of t.relay_members || []) if (m?.profile_id) members.add(m.profile_id);
      }
    }
    if (members.size === 0) continue;

    const billedMembers = Math.min(members.size, isMixed ? MIXED_RELAY_BILLABLE_PER_SQUAD : RELAY_BILLABLE_MEMBERS);
    const ev = eventById.get(eventId);
    relayTeams.push({
      eventId,
      code: ev?.code || '',
      name: ev?.name || 'Relay',
      members: members.size,
      billedMembers,
      fee: billedMembers * RELAY_FEE_PER_MEMBER,
    });
  }
  relayTeams.sort((a, b) => a.code.localeCompare(b.code));

  const relayMembersBilled = relayTeams.reduce((sum, t) => sum + t.billedMembers, 0);
  const relayFeeTotal = relayTeams.reduce((sum, t) => sum + t.fee, 0);

  return {
    regularEventsCount,
    regularFeeRate: REGULAR_EVENT_FEE,
    reserveEventsCount,
    hmCount,
    hmFeeRate: HALF_MARATHON_FEE,
    relayTeamsCount: relayTeams.length,
    relayFeeRate: RELAY_FEE_PER_MEMBER, // per member, first 4 members of each team
    relayMembersBilled,
    relayFeeTotal,
    relayTeams,
    totalAmount: regularEventsCount * REGULAR_EVENT_FEE + hmCount * HALF_MARATHON_FEE + relayFeeTotal,
  };
}

export type PaymentDecision = 'VERIFIED' | 'REJECTED';

/**
 * Applies a Finance/Admin decision to ONE payment that is still awaiting verification,
 * then synchronises the parent squad's payment_status and roster lock.
 *
 * - Only payments in status 'SUBMITTED' can be processed: a payment that was already
 *   verified or rejected is refused (prevents double-verify / reject-after-verify).
 * - VERIFIED: squad becomes VERIFIED (roster locked) once verified payments cover the
 *   squad's CURRENT total fee; otherwise it stays SUBMITTED with a balance due.
 * - REJECTED: squad becomes REJECTED unless another payment is still pending. The roster
 *   stays locked; the squad may re-upload a corrected receipt / UTR.
 */
export async function reviewPayment(
  paymentId: string,
  decision: PaymentDecision,
  reason: string | undefined,
  staffId: string | null | undefined,
  amountReceived?: number | null
): Promise<{ success: boolean; error?: string; squadId?: string }> {
  if (decision === 'REJECTED' && !reason?.trim()) {
    return { success: false, error: 'A rejection reason is mandatory when rejecting payments.' };
  }
  // Verification must record what the bank statement actually shows for this UTR
  if (decision === 'VERIFIED') {
    if (amountReceived == null || !Number.isInteger(amountReceived) || amountReceived < 1 || amountReceived > 10_000_000) {
      return {
        success: false,
        error: 'Enter the amount actually credited in the bank statement for this UTR (whole rupees). If nothing was received, reject the payment instead.',
      };
    }
  }

  // Conditional update: matches only while the payment is still pending (atomic guard)
  const { data: updated, error } = await supabaseAdmin
    .from('payments')
    .update({
      status: decision,
      rejection_reason: decision === 'REJECTED' ? reason!.trim() : null,
      amount_received: decision === 'VERIFIED' ? amountReceived : null,
      verified_by: staffId || null,
      verified_at: new Date().toISOString(),
    })
    .eq('id', paymentId)
    .eq('status', 'SUBMITTED')
    .select('squad_id')
    .maybeSingle();

  if (error) {
    if (/amount_received/.test(error.message)) {
      return { success: false, error: 'Database migration 0018 (payments.amount_received) has not been applied yet. Apply it in Supabase, then verify again.' };
    }
    return { success: false, error: error.message };
  }

  if (!updated) {
    const { data: existing } = await supabaseAdmin
      .from('payments')
      .select('status')
      .eq('id', paymentId)
      .maybeSingle();
    if (!existing) return { success: false, error: 'Payment record not found.' };
    return {
      success: false,
      error: `This payment has already been ${String(existing.status).toLowerCase()} and cannot be processed again.`,
    };
  }

  const squadId: string = updated.squad_id;
  const now = new Date().toISOString();

  const [{ data: allPayments }, fees] = await Promise.all([
    supabaseAdmin.from('payments').select('*').eq('squad_id', squadId),
    calculateSquadFees(squadId),
  ]);

  const verifiedSum = totalCredited(allPayments as any[]);
  const pendingCount = (allPayments || []).filter((p: any) => p.status === 'SUBMITTED').length;

  let squadStatus: 'VERIFIED' | 'SUBMITTED' | 'REJECTED';
  if (verifiedSum > 0 && verifiedSum >= fees.totalAmount) {
    squadStatus = 'VERIFIED';
  } else if (pendingCount > 0) {
    // Another receipt is still awaiting verification
    squadStatus = 'SUBMITTED';
  } else if (decision === 'REJECTED') {
    // Let the squad see the rejection and re-upload a corrected receipt / UTR
    squadStatus = 'REJECTED';
  } else {
    // Verified but under-paid: remains locked in the submitted phase with a balance due
    squadStatus = 'SUBMITTED';
  }

  const { error: sqErr } = await supabaseAdmin
    .from('squads')
    .update({ payment_status: squadStatus, roster_locked: true, updated_at: now })
    .eq('id', squadId);

  if (sqErr) return { success: false, error: sqErr.message };
  return { success: true, squadId };
}
