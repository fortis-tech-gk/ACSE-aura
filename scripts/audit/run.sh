#!/bin/bash
# VTU SportsOS audit suite — one command:  bash scripts/audit/run.sh
#
# Spins up a THROWAWAY Supabase Postgres + PostgREST in Docker, applies every migration,
# loads test data, runs the database checks, then starts the real backend API against that
# throwaway database (with test-only secrets) and runs the API checks. Everything is torn
# down at the end. It never reads backend/.env and never contacts production.
#
# Exit code: 0 when every check passes, 1 otherwise. AUDIT_KEEP=1 leaves the database running.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export AUDIT_DB_PORT=${AUDIT_DB_PORT:-55432} AUDIT_REST_PORT=${AUDIT_REST_PORT:-55433}
export AUDIT_PROXY_PORT=${AUDIT_PROXY_PORT:-55434} AUDIT_API_PORT=${AUDIT_API_PORT:-55435}
PG_IMAGE=${AUDIT_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.11.0.018}
REST_IMAGE=${AUDIT_REST_IMAGE:-public.ecr.aws/supabase/postgrest:v16.5}
NAME=vtu-audit-$$
WORK=$(mktemp -d)            # API runs from here: no .env file can be picked up
export PGPASSWORD=audit PGOPTIONS="-c client_min_messages=warning"
PSQL="psql -h 127.0.0.1 -p $AUDIT_DB_PORT -U postgres -d postgres -q -v ON_ERROR_STOP=1"

cleanup() {
  if [ "${AUDIT_KEEP:-}" = 1 ]; then echo "AUDIT_KEEP=1: database left running on port $AUDIT_DB_PORT (docker rm -f $NAME-db $NAME-rest)"; kill "${API_PID:-0}" "${PROXY_PID:-0}" 2>/dev/null; return; fi
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true
  docker rm -f "$NAME-rest" "$NAME-db" >/dev/null 2>&1 || true
  docker network rm "$NAME-net" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

for p in $AUDIT_DB_PORT $AUDIT_REST_PORT $AUDIT_PROXY_PORT $AUDIT_API_PORT; do
  if ss -ltn | grep -q ":$p "; then echo "Port $p is busy — set AUDIT_*_PORT to free ports."; exit 2; fi
done

echo "▸ starting throwaway database"
docker network create "$NAME-net" >/dev/null
docker run -d --name "$NAME-db" --network "$NAME-net" -e POSTGRES_PASSWORD=audit \
  -p "127.0.0.1:$AUDIT_DB_PORT:5432" "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do $PSQL -c 'select 1' >/dev/null 2>&1 && break; sleep 2; done

echo "▸ applying migrations"
for f in "$REPO"/supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  $PSQL -f "$f" >/dev/null || { echo "migration failed: $(basename "$f")"; exit 2; }
done
$PSQL -f "$HERE/fixture.sql" >/dev/null

echo; echo "════════ DATABASE CHECKS ════════"
$PSQL -tA -F'  ' -f "$HERE/checks.sql" | sed '/^$/d'
DB_FAILS=$($PSQL -tA -c "select count(*) from audit_results where not ok")

echo; echo "▸ starting PostgREST + the real backend API (test secrets only)"
JWT_PGRST="audit-postgrest-$(openssl rand -hex 16)"
docker run -d --name "$NAME-rest" --network "$NAME-net" -p "127.0.0.1:$AUDIT_REST_PORT:3000" \
  -e PGRST_DB_URI="postgres://postgres:audit@$NAME-db:5432/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_PGRST" "$REST_IMAGE" >/dev/null
node "$HERE/rest-proxy.mjs" "$AUDIT_PROXY_PORT" "$AUDIT_REST_PORT" & PROXY_PID=$!
SERVICE_KEY=$(cd "$REPO/backend" && node -e 'console.log(require("jsonwebtoken").sign({role:"service_role"}, process.argv[1], {expiresIn:"1d"}))' "$JWT_PGRST")

(
  cd "$WORK"
  exec env -i PATH="$PATH" HOME="$HOME" \
    SUPABASE_URL="http://127.0.0.1:$AUDIT_PROXY_PORT" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" \
    JWT_SECRET="audit-api-$(openssl rand -hex 24)" ATHLETE_QR_SECRET="audit-qr-$(openssl rand -hex 24)" \
    NODE_ENV=production PORT="$AUDIT_API_PORT" TRUST_PROXY=1 CORS_ORIGIN=http://localhost \
    "$REPO/backend/node_modules/.bin/tsx" "$REPO/backend/src/server.ts" > "$WORK/api.log" 2>&1
) & API_PID=$!
for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$AUDIT_API_PORT/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://127.0.0.1:$AUDIT_API_PORT/health" >/dev/null || { echo "API did not start:"; tail -20 "$WORK/api.log"; exit 2; }

echo; echo "════════ API CHECKS ════════"
API_OUT=$(bash "$HERE/api_checks.sh"); echo "$API_OUT"
API_FAILS=$(echo "$API_OUT" | grep -c '^FAIL' || true)

echo; echo "════════ TOTAL: $((DB_FAILS + API_FAILS)) failing check(s) ════════"
[ $((DB_FAILS + API_FAILS)) -eq 0 ]
