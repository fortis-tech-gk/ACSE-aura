-- College registration status report (data query).
--
-- Emits ONE json object on stdout:
--   { registered: [...], not_registered: [...] }
-- Each college carries its PED + principal contacts, athlete counts and, for registered
-- colleges, the college fee account (ONE PAYMENT PER COLLEGE: both squads added up).
--
-- Fees mirror calculateSquadFees()/calculateCollegeFees() in frontend/web/src/lib/payments.ts:
--   regular ₹100 · half marathon ₹100 · reserve ₹0
--   divisional relay ₹100 x min(members, 4) · 4x400m mixed ₹100 x min(own members, 2)
-- Relay members = athlete-form nominations (registrations.kind='relay') UNION relay_teams
-- lineups; the mixed team is shared by the college, so each member counts for their OWN squad.
-- Amount paid = bank-confirmed amount_received of VERIFIED payments only (payment-status.ts).
with mixed_ev as (
  select id from events where upper(code) = '4X400M-MIX'
),
reg as (
  select p.squad_id, r.kind, r.event_id, r.profile_id
  from registrations r
  join profiles p on p.id = r.profile_id
),
individual as (
  select squad_id,
         count(*) filter (where kind = 'regular')        as regular_n,
         count(*) filter (where kind = 'half_marathon')  as hm_n,
         count(*) filter (where kind = 'reserve')        as reserve_n
  from reg
  group by squad_id
),
-- relay nominations ticked on the athlete form
nominated as (
  select squad_id, event_id, profile_id
  from reg
  where kind = 'relay' and event_id is not null
),
-- divisional relay lineups: members belong to the squad that owns the team
team_divisional as (
  select t.squad_id, t.event_id, m.profile_id
  from relay_teams t
  join relay_members m on m.relay_team_id = t.id
  where t.event_id is not null
    and t.event_id not in (select id from mixed_ev)
),
-- mixed relay lineups: the team is shared, so each member counts for their own squad
team_mixed as (
  select mp.squad_id, t.event_id, m.profile_id
  from relay_teams t
  join relay_members m on m.relay_team_id = t.id
  join profiles mp on mp.id = m.profile_id
  join squads owner on owner.id = t.squad_id
  join squads member_squad on member_squad.id = mp.squad_id
  where t.event_id in (select id from mixed_ev)
    and member_squad.college_id = owner.college_id
),
relay_members_all as (
  select distinct squad_id, event_id, profile_id
  from (
    select * from nominated
    union all select * from team_divisional
    union all select * from team_mixed
  ) x
),
relay_per_event as (
  select squad_id,
         event_id,
         event_id in (select id from mixed_ev) as is_mixed,
         count(distinct profile_id)            as members
  from relay_members_all
  group by squad_id, event_id
),
relay_fee as (
  select squad_id,
         sum(least(members, case when is_mixed then 2 else 4 end) * 100) as fee,
         count(*)                                                       as teams
  from relay_per_event
  group by squad_id
),
athletes as (
  select squad_id, count(*) as n from profiles group by squad_id
),
squad_money as (
  select s.id,
         s.college_id,
         s.gender,
         s.squad_code,
         s.ped_name,
         s.ped_phone,
         s.ped_email,
         s.payment_status,
         coalesce(a.n, 0)                as athletes,
         coalesce(i.regular_n, 0)        as regular_n,
         coalesce(i.hm_n, 0)             as hm_n,
         coalesce(i.reserve_n, 0)        as reserve_n,
         coalesce(rf.teams, 0)           as relay_teams,
         coalesce(i.regular_n, 0) * 100
           + coalesce(i.hm_n, 0) * 100
           + coalesce(rf.fee, 0)         as total_amount
  from squads s
  left join athletes a on a.squad_id = s.id
  left join individual i on i.squad_id = s.id
  left join relay_fee rf on rf.squad_id = s.id
),
squad_paid as (
  select squad_id,
         sum(case when status = 'VERIFIED' then coalesce(amount_received, 0) else 0 end) as paid,
         sum(case when status = 'SUBMITTED' then coalesce(amount_submitted, 0) else 0 end) as pending,
         count(*) filter (where status = 'VERIFIED')  as verified_count,
         count(*) filter (where status = 'SUBMITTED') as pending_count
  from payments
  group by squad_id
),
college_rows as (
  select c.id,
         c.name,
         c.code,
         c.district,
         c.region,
         c.principal_name,
         c.principal_email,
         c.principal_phone,
         sum(sm.athletes)                      as athletes,
         sum(case when lower(sm.gender) = 'men'   then sm.athletes else 0 end) as men,
         sum(case when lower(sm.gender) = 'women' then sm.athletes else 0 end) as women,
         sum(sm.regular_n)                     as regular_n,
         sum(sm.hm_n)                          as hm_n,
         sum(sm.reserve_n)                     as reserve_n,
         sum(sm.relay_teams)                   as relay_teams,
         sum(sm.total_amount)                  as total_amount,
         coalesce(sum(sp.paid), 0)             as paid,
         coalesce(sum(sp.pending), 0)          as pending,
         coalesce(sum(sp.verified_count), 0)   as verified_count,
         coalesce(sum(sp.pending_count), 0)    as pending_count,
         jsonb_agg(
           jsonb_build_object(
             'gender', sm.gender,
             'squad_code', sm.squad_code,
             'ped_name', sm.ped_name,
             'ped_phone', sm.ped_phone,
             'ped_email', sm.ped_email,
             'athletes', sm.athletes,
             'payment_status', sm.payment_status
           ) order by sm.gender
         )                                     as squads
  from colleges c
  left join squad_money sm on sm.college_id = c.id
  left join squad_paid sp on sp.squad_id = sm.id
  group by c.id
)
select jsonb_pretty(jsonb_build_object(
  'registered', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.region, r.name)
    from college_rows r where r.athletes > 0
  ), '[]'::jsonb),
  'not_registered', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.region, r.name)
    from college_rows r where coalesce(r.athletes, 0) = 0
  ), '[]'::jsonb)
));
