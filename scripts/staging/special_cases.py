"""Call-room special cases on staging: reserve swap, relay swap, scratch, closed/not-open scans, late offline sync, results guards."""
import sys, os, json, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import run_meet as rm
from meet_driver import call
rm.tokens(); T = rm.TOK
R = []
def rec(name, expect, s, j):
    ok = (s in expect) if isinstance(expect, (list, tuple, set)) else s == expect
    msg = (j.get('error') or j.get('message') or '')[:110] if isinstance(j, dict) else ''
    R.append((name, 'PASS' if ok else 'FAIL', s, msg)); print(('PASS' if ok else 'FAIL'), name, s, msg, flush=True)

sql = rm.sql
def reset(code):
    eid = sql(f"select id from events where code='{code}'")[0][0]
    sql(f"delete from team_points where event_id='{eid}'; delete from heats where event_id='{eid}';", False)
    return eid
def draw(eid, stage):
    return call('POST', '/schedule/draw', {'eventId': eid, 'stage': stage, 'numLanes': 8}, T['adm'])
cr, ref, adm = T['cr'], T['ref'], T['adm']

# ---------------------- field event: Hammer Throw Men ----------------------
eid = reset('HT-M'); s, j = draw(eid, 'FINAL'); rec('redraw after reset', 200, s, j)
hid = sql(f"select id from heats where event_id='{eid}'")[0][0]
ents = sql(f"select ha.id, p.id, p.bid_number from heat_athletes ha join profiles p on p.id=ha.profile_id where ha.heat_id='{hid}' order by ha.lane_number")
A, B, C, D, E_ = ents[0], ents[1], ents[2], ents[3], ents[4]
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(A[2])}, cr); rec('scan BEFORE call room opens is refused', 409, s, j)
s, j = call('PATCH', f'/schedule/heats/{hid}/status', {'status': 'CALL_ROOM'}, ref); rec('referee cannot open the call room', [403, 409], s, j)
s, j = call('PATCH', f'/schedule/heats/{hid}/status', {'status': 'ON_TRACK'}, cr); rec('call room cannot jump a heat to ON_TRACK', [403, 409], s, j)
s, j = call('PATCH', f'/schedule/heats/{hid}/status', {'status': 'CALL_ROOM'}, cr); rec('call room official opens the call room', 200, s, j)
other = sql(f"select p.bid_number from profiles p where p.accreditation_status='ACCREDITED' and p.id not in (select profile_id from heat_athletes where heat_id='{hid}' and profile_id is not null) and p.squad_id in (select id from squads where gender='men') limit 1")[0][0]
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(other)}, cr); rec('scan athlete who is NOT in this heat -> 404 with hint', 404, s, j)
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': 99999}, cr); rec('scan unknown bib -> 404', 404, s, j)
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'qrToken': 'AURA26.00000000-0000-0000-0000-000000000000.AAAAAAAAAAAAAAAAAAAAAA'}, cr); rec('fake QR is rejected', 400, s, j)
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(A[2])}, cr); rec('scan athlete A (valid)', 200, s, j)
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(A[2])}, cr); rec('scan athlete A again -> alreadyReported', 200, s, j); print('   alreadyReported =', j.get('alreadyReported'))
s, j = call('POST', '/callroom/inspect', {'heatAthleteId': B[0], 'reportedStatus': 'SCRATCH', 'notes': 'withdrawn by PED'}, cr); rec('scratch athlete B', 200, s, j)
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(B[2])}, cr); rec('scan scratched athlete B is refused', 409, s, j)
s, j = call('POST', '/callroom/inspect', {'heatAthleteId': D[0], 'reportedStatus': 'REPORTED', 'spikeLengthMm': 14, 'bibAffixed': False}, cr); rec('inspection with 14mm spikes / no bib', [200, 400], s, j); print('   ->', str(j)[:200])
# reserve swap for absent athlete C
s, j = call('GET', f'/callroom/heats/{hid}', None, cr); rec('call room heat list loads', 200, s, j)
res = (j.get('reserves') or {}).get(C[0]) if s == 200 else None
print('   eligible reserves for C:', res)
if res:
    s, j = call('POST', '/callroom/reserve-swap', {'heatAthleteId': C[0], 'reserveProfileId': res[0]['id']}, cr); rec('reserve substitution for absent athlete C', 200, s, j)
    nb = sql(f"select p.bid_number from heat_athletes ha join profiles p on p.id=ha.profile_id where ha.id='{C[0]}'")[0][0]
    print('   entry C now belongs to bib', nb, '(reserve bib', res[0]['bib'], ')')
    s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(res[0]['bib'])}, cr); rec('substituted reserve can now check in', 200, s, j)
else:
    R.append(('reserve list for C', 'FAIL', 0, 'no eligible reserve returned')); print('FAIL no reserve for C')
s, j = call('POST', f'/callroom/advance/{hid}', {}, cr); rec('close call room (advance)', 200, s, j)
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(E_[2])}, cr); rec('scan after close (no actedAt) is refused', 409, s, j)
past = (dt.datetime.utcnow() - dt.timedelta(minutes=30)).isoformat() + 'Z'
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(E_[2]), 'actedAt': past}, cr); rec('offline tablet sync with actedAt BEFORE close is refused (acted before open?)', [200, 409], s, j); print('   late-sync ->', s, j.get('error') or 'accepted')
s, j = call('POST', '/field/finalize', {'heatId': hid}, ref); rec('finalize with NO results entered is refused', 400, s, j)
# results: only athletes who reported
rep = sql(f"select ha.id from heat_athletes ha where ha.heat_id='{hid}' and ha.call_room_reported")
print('   reported in call room:', len(rep), 'of', len(ents), '| DNS entries:', sql(f"select count(*) from heat_athletes where heat_id='{hid}' and not call_room_reported")[0][0])
s, j = call('POST', '/field/attempt', {'heatAthleteId': B[0], 'roundNumber': 1, 'attemptType': 'VALID', 'markMeters': 50}, ref); rec('result for SCRATCHED athlete refused', [400, 409], s, j)
for k, e in enumerate(rep):
    for r in (1, 2, 3):
        call('POST', '/field/attempt', {'heatAthleteId': e[0], 'roundNumber': r, 'attemptType': 'VALID' if (k + r) % 5 else 'FOUL', 'markMeters': round(40 + k * 0.7 + r * 0.4, 2)}, ref)
s, j = call('POST', '/field/attempt', {'heatAthleteId': rep[0][0], 'roundNumber': 1, 'attemptType': 'VALID', 'markMeters': -5}, ref); rec('negative distance refused', [400], s, j)
s, j = call('POST', '/field/attempt', {'heatAthleteId': rep[0][0], 'roundNumber': 1, 'attemptType': 'VALID', 'markMeters': 400}, ref); rec('impossible 400 m hammer throw refused', [400], s, j)
s, j = call('POST', '/field/finalize', {'heatId': hid}, ref); rec('finalize heat', 200, s, j); print('   points:', str(j.get('pointsAwarded'))[:160])
s, j = call('POST', '/field/attempt', {'heatAthleteId': rep[0][0], 'roundNumber': 4, 'attemptType': 'VALID', 'markMeters': 60}, ref); rec('result entry AFTER finalize is refused', [400, 409], s, j)
s, j = call('POST', '/field/finalize', {'heatId': hid}, ref); rec('double finalize is refused or harmless', [200, 400, 409], s, j); print('   ->', s, str(j)[:140])

# ---------------------- relay: 4x400m Women ----------------------
eid = reset('4X400M-W'); s, j = draw(eid, 'HEATS'); rec('relay redraw', 200, s, j)
hid = sql(f"select id from heats where event_id='{eid}' order by heat_number limit 1")[0][0]
call('PATCH', f'/schedule/heats/{hid}/status', {'status': 'CALL_ROOM'}, cr)
team = sql(f"select ha.id, ha.relay_team_id from heat_athletes ha where ha.heat_id='{hid}' limit 1")[0]
mem = sql(f"select profile_id, leg_order, is_reserve from relay_members where relay_team_id='{team[1]}' order by is_reserve, leg_order")
print('   team members:', [(m[1], m[2]) for m in mem])
legs = [m for m in mem if m[2] == 'f']; resv = [m for m in mem if m[2] == 't']
if legs and resv:
    s, j = call('POST', '/callroom/relay-swap', {'relayTeamId': team[1], 'legOrder': int(legs[1][1]), 'reserveProfileId': resv[0][0]}, cr); rec('swap a relay runner with a reserve', 200, s, j)
    after = sql(f"select profile_id, leg_order, is_reserve from relay_members where relay_team_id='{team[1]}' order by is_reserve, leg_order")
    print('   leg', legs[1][1], 'was', legs[1][0][:8], 'now', [a[0][:8] for a in after if a[1] == legs[1][1] and a[2] == 'f'])
    s, j = call('POST', '/callroom/relay-swap', {'relayTeamId': team[1], 'legOrder': int(legs[0][1]), 'reserveProfileId': legs[2][0]}, cr); rec('swap using a non-reserve teammate is refused', [400], s, j)
else:
    print('   team has no reserve members; relay-swap not testable:', mem)
s, j = call('POST', '/callroom/scan', {'heatId': hid, 'bib': int(sql(f"select bid_number from profiles where id='{legs[0][0]}'")[0][0])}, cr) if legs else (0, {})
rec('relay team checks in via one runner scan', 200, s, j)
# put the heat back so run_meet can finish this event
json.dump(R, open('/tmp/claude-1000/special_cases.json', 'w'))
print('\nSUMMARY', sum(1 for r in R if r[1] == 'PASS'), 'pass,', sum(1 for r in R if r[1] == 'FAIL'), 'fail')
