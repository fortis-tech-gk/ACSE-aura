#!/bin/bash
# VTU SportsOS API audit checks. Talks ONLY to the local audit API started by run.sh.
# Every check states the CORRECT behaviour: FAIL = the bug is still there.
set -u
API="http://127.0.0.1:${AUDIT_API_PORT:-55435}/api"
DB="psql -h 127.0.0.1 -p ${AUDIT_DB_PORT:-55432} -U postgres -d postgres -tA -q"
export PGPASSWORD=audit
BACKEND="$(cd "$(dirname "$0")/../../backend" && pwd)"
PASS=0; FAIL=0
chk() { # id ok(0/1) title [detail]
  if [ "$2" = 1 ]; then echo "PASS  $1  $3"; PASS=$((PASS+1)); else echo "FAIL  $1  $3${4:+  — $4}"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$API$1" -H 'Content-Type: application/json' ${3:+-H "Authorization: Bearer $3"} -d "$2"; }
token() { curl -s -X POST "$API/auth/staff/pin-login" -H 'Content-Type: application/json' -d "$1" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))'; }
in4xx() { [ "$1" -ge 400 ] && [ "$1" -lt 500 ] && echo 1 || echo 0; }

# --- test staff and heats --------------------------------------------------------------
HASHES=$(cd "$BACKEND" && node -e 'const b=require("bcryptjs");console.log(["4821","5930","7777"].map(p=>b.hashSync(p,10)).join(" "))')
read -r H4821 H5930 H7777 <<<"$HASHES"
$DB >/dev/null <<SQL
UPDATE staff SET is_active = false;
INSERT INTO staff (display_name, role, pin_hash, is_active, scope_event_ids) VALUES
 ('Audit Ref 100m', 'referee', '$H4821', true, ARRAY[audit_ev('100M-M')]),
 ('Audit Ref LJ',   'referee', '$H5930', true, ARRAY[audit_ev('LJ-M')]),
 ('Audit Warden',   'warden',  '$H7777', true, '{}'),
 ('Audit Callroom', 'call_room_official', '$H7777', true, '{}');
DELETE FROM heats WHERE event_id = audit_ev('100M-M');
SELECT audit_heat('100M-M', 'HEATS', 1, ARRAY['Spare 1','Spare 2','Spare 3']);
SELECT audit_heat('100M-M', 'FINAL', 1, ARRAY['Spare 4','Spare 5','Spare 6']);
SQL
PRELIM=$($DB -c "select id from heats where event_id = audit_ev('100M-M') and stage = 'HEATS'")
FINAL=$($DB -c "select id from heats where event_id = audit_ev('100M-M') and stage = 'FINAL'")
EV100=$($DB -c "select audit_ev('100M-M')"); EVTJ=$($DB -c "select audit_ev('TJ-M')")
HA_FINAL=$($DB -c "select audit_ha('$FINAL', 'Spare 4')")
$DB -c "select count(submit_track_result(id, 10.5 + lane_number/10.0, NULL, NULL, 'FINISHED', '', NULL)) from heat_athletes where heat_id = '$PRELIM'" >/dev/null

REF100=$(token '{"role":"referee","pin":"4821"}')
REFLJ=$(token '{"role":"referee","pin":"5930"}')
[ -n "$REF100" ] && [ -n "$REFLJ" ] || { echo "could not log in test referees"; exit 2; }

# --- checks -------------------------------------------------------------------------
c=$(code /track/result "{\"heatAthleteId\":\"$HA_FINAL\",\"timeSeconds\":10.42}" "$REFLJ")
chk A1 "$(in4xx $c)" "A referee cannot write results outside their assigned events" "long-jump referee wrote a 100m time: HTTP $c"

c=$(code /track/result "{\"heatAthleteId\":\"$HA_FINAL\",\"timeSeconds\":1.00}" "$REF100")
chk A2 "$(in4xx $c)" "The API rejects an impossible time (1.00 s for 100m)" "HTTP $c"

c=$(code /track/finalize "{\"heatId\":\"$PRELIM\",\"eventId\":\"$EV100\",\"stage\":\"FINAL\"}" "$REF100")
pts=$($DB -c "select count(*) from team_points where heat_id = '$PRELIM'")
chk A3 "$([ "$pts" = 0 ] && echo 1 || echo 0)" "A preliminary heat cannot be finalized as a FINAL (no medals from heats)" "HTTP $c, $pts medal rows created"

c=$(code /track/finalize "{\"heatId\":\"$FINAL\",\"eventId\":\"$EVTJ\",\"stage\":\"FINAL\"}" "$REF100")
chk A4 "$(in4xx $c)" "finalize refuses a heat sent with another event's id" "HTTP $c"

$DB -c "update staff set is_active = false where display_name = 'Audit Ref LJ'" >/dev/null
c=$(code /track/result "{\"heatAthleteId\":\"$HA_FINAL\",\"timeSeconds\":10.43}" "$REFLJ")
chk A5 "$( [ "$c" = 401 ] || [ "$c" = 403 ] && echo 1 || echo 0)" "A deactivated official is locked out immediately" "HTTP $c with a token issued before deactivation"

c=$(code /auth/staff/pin-login '{"pin":"7777"}')
chk A6 "$(in4xx $c)" "PIN login requires choosing a role" "role-less login with a PIN shared by 2 staff: HTTP $c"

FORGED=$(cd "$BACKEND" && node -e 'console.log(require("jsonwebtoken").sign({role:"meet_admin",entityId:"x"},"vtu-athletics-dev-secret-change-in-production"))')
NONE=$(python3 -c 'import base64,json;e=lambda o:base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b"=").decode();print(e({"alg":"none","typ":"JWT"})+"."+e({"role":"meet_admin","entityId":"x"})+".")')
c1=$(code /track/qualify '{}' "$FORGED"); c2=$(code /track/qualify '{}' "$NONE"); c3=$(code /track/qualify '{}')
chk A7 "$( [ "$c1$c2$c3" = 401401401 ] && echo 1 || echo 0)" "Forged, alg=none and missing tokens are rejected" "$c1/$c2/$c3"

$DB -c "update profiles set bid_number = 4242, date_of_birth = '2004-01-01' where sslc_name = 'Spare 11'" >/dev/null
for i in $(seq 1 8); do code /athlete/login "{\"bib\":\"4242\",\"dob\":\"2003-01-0$i\"}" >/dev/null; done
c=$(code /athlete/login '{"bib":"4242","dob":"2004-01-01"}')
chk A8 "$([ "$c" = 429 ] && echo 1 || echo 0)" "Athlete login locks after 8 wrong dates of birth" "HTTP $c"

# A9: 30 concurrent role-less PIN logins must not stall the API
START=$(date +%s%N)
for i in $(seq 1 30); do code /auth/staff/pin-login "{\"pin\":\"$((3000+i))\"}" >/dev/null & done; wait
MS=$(( ($(date +%s%N) - START) / 1000000 ))
chk A9 "$([ $MS -lt 3000 ] && echo 1 || echo 0)" "30 concurrent bad PIN logins finish in < 3 s (no CPU stall)" "took ${MS} ms"

echo "API: $PASS passed, $FAIL failed"
