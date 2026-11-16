/**
 * Server-only payment & fee logic shared by squad, finance and admin actions.
 *
 * Deliberately NOT a 'use server' module: exports here are plain server functions and
 * cannot be invoked from the browser as server actions (no auth bypass on arbitrary squads).
 */
import { supabaseAdmin } from '@/lib/supabase';
import { totalCredited } from '@/lib/payment-status';
import { getEventsByCodes, getEventsCatalogue } from '@/lib/events-catalogue';

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

/**
 * Entry fees for a squad, computed live from the current roster:
 *  - Event 1 / Event 2 / Half Marathon: ₹100 per entry. Reserve events: ₹0.
 *  - Relays: ₹100 × (number of team members, counting at most 4). So a team of 1/2/3 costs
 *    ₹100/₹200/₹300 and a team of 4–6 costs ₹400. A member is any athlete nominated to that
 *    relay (tick-box on the athlete form) or placed on the Relay page lineup — counted once.
 *  - The 4x400m Mixed Relay team is shared by the college's Men's and Women's squads. Each squad
 *    pays ₹100 for each of its OWN members, counting at most 2 (₹100 for 1, ₹200 for 2 or more).
 */
export async function calculateSquadFees(squadId: string) {
  let regularEventsCount = 0;
  let reserveEventsCount = 0;
  let hmCount = 0;
  const relayEventIds = new Set<string>();
  // event_id -> athletes nominated to it from THIS squad
  const nominations = new Map<string, Set<string>>();
  const addMember = (map: Map<string, Set<string>>, eventId: string, profileId: string) => {
    if (!map.has(eventId)) map.set(eventId, new Set());
    map.get(eventId)!.add(profileId);
  };

  // Independent reads run together (one round trip instead of five in a row):
  //  - this squad's registrations (joined through profiles, so no separate profile-id lookup)
  //  - the squad's college and every squad of that college (for the shared mixed relay)
  //  - relay teams owned by this squad, with their members
  //  - the events catalogue (cached, same for everyone)
  const [{ data: regs }, { data: squadRow }, { data: ownedTeams }, catalogue] = await Promise.all([
    supabaseAdmin
      .from('registrations')
      .select('id, kind, event_id, profile_id, profiles!inner(squad_id)')
      .eq('profiles.squad_id', squadId),
    supabaseAdmin
      .from('squads')
      .select('college_id, colleges(squads(id))')
      .eq('id', squadId)
      .maybeSingle(),
    supabaseAdmin
      .from('relay_teams')
      .select('id, event_id, relay_members(profile_id)')
      .eq('squad_id', squadId),
    getEventsCatalogue(),
  ]);

  (regs || []).forEach((r: any) => {
    if (r.kind === 'regular') regularEventsCount++;
    else if (r.kind === 'reserve') reserveEventsCount++;
    else if (r.kind === 'half_marathon') hmCount++;
    else if (r.kind === 'relay' && r.event_id) {
      relayEventIds.add(r.event_id);
      addMember(nominations, r.event_id, r.profile_id);
    }
  });

  const eventById = new Map(catalogue.map((e) => [e.id, e]));
  const mixedEventIds = new Set(
    catalogue.filter((e) => String(e.code || '').toUpperCase() === MIXED_RELAY_CODE).map((e) => e.id)
  );

  // Divisional relays: team members = athletes nominated on the athlete form ∪ the squad's own
  // Relay-page lineup, billed for at most 4.
  (ownedTeams || []).forEach((t: any) => {
    if (t.event_id && !mixedEventIds.has(t.event_id) && Array.isArray(t.relay_members) && t.relay_members.length > 0) {
      relayEventIds.add(t.event_id);
    }
  });

  // Mixed relay: the team is shared by the college, but each squad pays only for its OWN members
  // (men's squad for its men, women's squad for its women), at most 2 each — so ₹200 per squad,
  // ₹400 per college. Members = this squad's tick-box nominations ∪ this squad's athletes in the
  // college's mixed team on the Relay page, whichever squad owns that team row.
  const collegeRow: any = Array.isArray((squadRow as any)?.colleges) ? (squadRow as any).colleges[0] : (squadRow as any)?.colleges;
  const collegeSquadIds: string[] = ((collegeRow?.squads || []) as any[]).map((x: any) => x.id).filter(Boolean);
  if (!collegeSquadIds.includes(squadId)) collegeSquadIds.push(squadId);
  const { data: mixedTeams } =
    mixedEventIds.size > 0
      ? await supabaseAdmin
          .from('relay_teams')
          .select('event_id, relay_members(profile_id, profiles(squad_id))')
          .in('squad_id', collegeSquadIds)
          .in('event_id', Array.from(mixedEventIds))
      : { data: [] as any[] };
  (mixedTeams || []).forEach((t: any) => {
    (t.relay_members || []).forEach((m: any) => {
      const prof = Array.isArray(m?.profiles) ? m.profiles[0] : m?.profiles;
      if (m?.profile_id && prof?.squad_id === squadId) {
        relayEventIds.add(t.event_id);
        addMember(nominations, t.event_id, m.profile_id);
      }
    });
  });

  const relayTeams: RelayTeamFee[] = [];
  for (const eventId of relayEventIds) {
    const members = new Set<string>(nominations.get(eventId) || []);
    const isMixed = mixedEventIds.has(eventId);
    if (!isMixed) {
      (ownedTeams || [])
        .filter((t: any) => t.event_id === eventId)
        .forEach((t: any) => (t.relay_members || []).forEach((m: any) => m?.profile_id && members.add(m.profile_id)));
    }
    if (members.size === 0) continue;

    const billedMembers = Math.min(members.size, isMixed ? MIXED_RELAY_BILLABLE_PER_SQUAD : RELAY_BILLABLE_MEMBERS);
    const ev: any = eventById.get(eventId) || {};
    relayTeams.push({
      eventId,
      code: ev.code || '',
      name: ev.name || 'Relay',
      members: members.size,
      billedMembers,
      fee: billedMembers * RELAY_FEE_PER_MEMBER,
    });
  }
  relayTeams.sort((a, b) => a.code.localeCompare(b.code));

  const relayTeamsCount = relayTeams.length;
  const relayMembersBilled = relayTeams.reduce((sum, t) => sum + t.billedMembers, 0);
  const relayFeeTotal = relayTeams.reduce((sum, t) => sum + t.fee, 0);
  const regularFeeRate = 100;
  const hmFeeRate = 100;
  const relayFeeRate = RELAY_FEE_PER_MEMBER; // per member, first 4 members of each team
  const totalAmount = regularEventsCount * regularFeeRate + hmCount * hmFeeRate + relayFeeTotal;

  return {
    regularEventsCount,
    regularFeeRate,
    reserveEventsCount,
    hmCount,
    hmFeeRate,
    relayTeamsCount,
    relayFeeRate,
    relayMembersBilled,
    relayFeeTotal,
    relayTeams,
    totalAmount,
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

/**
 * Pre-payment readiness check for relays. Submitting payment FREEZES the roster, so any relay
 * with nominations must already have a complete lineup — otherwise it could never be completed.
 *
 * - Divisional (4x100m / 4x400m of this squad): if anyone is nominated, ≥ 4 must be nominated
 *   and the team must have all 4 legs assigned on the Relay page.
 * - 4x400m Mixed (shared by the college): if anyone in the college is nominated, ≥ 2 women and
 *   ≥ 2 men must be nominated and all 4 legs assigned (W, M, W, M).
 *
 * Returns human-readable blockers; an empty array means the squad may pay.
 */
export async function getRelayReadinessIssues(squadId: string): Promise<string[]> {
  const issues: string[] = [];

  const { data: squad } = await supabaseAdmin
    .from('squads')
    .select('id, college_id, gender, colleges(squads(id, gender))')
    .eq('id', squadId)
    .maybeSingle();
  if (!squad) return ['Squad not found.'];

  const divisionalCodes = squad.gender === 'men' ? ['4X100M-M', '4X400M-M'] : ['4X100M-W', '4X400M-W'];
  const relayEvents = await getEventsByCodes([...divisionalCodes, MIXED_RELAY_CODE]);
  if (relayEvents.length === 0) return issues;
  const relayEventIds = relayEvents.map((e) => e.id);

  const college: any = Array.isArray((squad as any).colleges) ? (squad as any).colleges[0] : (squad as any).colleges;
  const collegeSquads: any[] = college?.squads?.length ? college.squads : [{ id: squad.id, gender: squad.gender }];
  const squadGender = new Map(collegeSquads.map((s: any) => [s.id, s.gender]));
  const collegeSquadIds = Array.from(squadGender.keys());

  // Nominations of the whole college (joined through profiles) and every relay team of the
  // college for these events, fetched together instead of one query per event.
  const [{ data: nominationRows }, { data: collegeTeams }] = await Promise.all([
    supabaseAdmin
      .from('registrations')
      .select('profile_id, event_id, profiles!inner(squad_id)')
      .eq('kind', 'relay')
      .in('event_id', relayEventIds)
      .in('profiles.squad_id', collegeSquadIds),
    supabaseAdmin
      .from('relay_teams')
      .select('id, event_id, squad_id, relay_members(leg_order, is_reserve)')
      .in('event_id', relayEventIds)
      .in('squad_id', collegeSquadIds),
  ]);
  const profileSquad = new Map(
    (nominationRows || []).map((n: any) => {
      const prof = Array.isArray(n.profiles) ? n.profiles[0] : n.profiles;
      return [n.profile_id, prof?.squad_id];
    })
  );
  const nominations = nominationRows || [];

  for (const ev of relayEvents as any[]) {
    const isMixed = ev.code === MIXED_RELAY_CODE;
    const evNoms = nominations.filter(
      (n: any) => n.event_id === ev.id && (isMixed || profileSquad.get(n.profile_id) === squadId)
    );
    if (evNoms.length === 0) continue;

    // Find the team: own squad for divisional; any college squad for mixed
    const teams = (collegeTeams || []).filter(
      (t: any) => t.event_id === ev.id && (isMixed || t.squad_id === squadId)
    );
    const members: any[] = (teams || []).flatMap((t: any) => t.relay_members || []);
    const legs = members.filter((m) => !m.is_reserve && m.leg_order).length;

    if (isMixed) {
      const women = evNoms.filter((n: any) => squadGender.get(profileSquad.get(n.profile_id)) === 'women').length;
      const men = evNoms.length - women;
      if (women < 2 || men < 2) {
        issues.push(
          `${ev.name}: needs at least 2 women and 2 men nominated across your college (currently ${women} women, ${men} men). Nominate more athletes, or remove the mixed relay nominations.`
        );
        continue;
      }
    } else if (evNoms.length < 4) {
      issues.push(
        `${ev.name}: only ${evNoms.length} athlete(s) nominated — a team needs at least 4. Nominate more athletes, or remove these nominations.`
      );
      continue;
    }

    if (legs < 4) {
      issues.push(`${ev.name}: lineup incomplete (${legs}/4 legs assigned). Assign all 4 legs on the Relay Teams page.`);
    }
  }

  return issues;
}
