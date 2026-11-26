#!/usr/bin/env bash
# =============================================================================
# Deploy the VTU SportsOS API (AURA apps backend) to Google Cloud Run — Mumbai.
#
#   ./deploy-cloudrun.sh <gcp-project-id> [--meet]
#
#   (none)   normal sizing: CPU always on, production keeps 1 warm instance (staging scales to zero).
#   --meet   meet sizing (6–10 Dec, ~4000 athletes): 6 warm instances, up to 60, 1 GiB each.
#
# Resize the running service without rebuilding (about a minute; use on the morning of 6 Dec
# and again after the meet):
#   ./deploy-cloudrun.sh <gcp-project-id> --resize-meet
#   ./deploy-cloudrun.sh <gcp-project-id> --resize-normal
#
# First run only — store the secrets (values are read from your terminal, never from git):
#   ./deploy-cloudrun.sh <gcp-project-id> --init-secrets
#
# Staging (demo) copy: same commands with AURA_ENV=staging → service "aura-api-staging" and
# secrets named JWT_SECRET_STAGING etc., pointing at the staging Supabase project.
#   AURA_ENV=staging ./deploy-cloudrun.sh <gcp-project-id> --init-secrets
#   AURA_ENV=staging ./deploy-cloudrun.sh <gcp-project-id>
# =============================================================================
set -euo pipefail

PROJECT="${1:?usage: ./deploy-cloudrun.sh <gcp-project-id> [--meet|--resize-meet|--resize-normal|--init-secrets]}"
MODE="${2:-}"
REGION="asia-south1"          # Mumbai — same region as Supabase
SERVICE="aura-api"
SUFFIX=""
if [[ "${AURA_ENV:-production}" == "staging" ]]; then
  SERVICE="aura-api-staging"
  SUFFIX="_STAGING"
fi
# PED_CRON_SECRET: random value Cloud Scheduler sends as X-Cron-Secret to /api/internal/ped-alerts/tick
SECRETS=(JWT_SECRET ATHLETE_QR_SECRET SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY PED_CRON_SECRET)

gcloud config set project "$PROJECT" >/dev/null

if [[ "$MODE" == "--init-secrets" ]]; then
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
  for base in "${SECRETS[@]}"; do
    name="$base$SUFFIX"
    if gcloud secrets describe "$name" >/dev/null 2>&1; then
      echo "✓ $name already exists (add a new version with: gcloud secrets versions add $name --data-file=-)"
      continue
    fi
    read -rsp "Value for $name: " value; echo
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=-
  done
  # Let Cloud Run's runtime service account read them
  SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
  for base in "${SECRETS[@]}"; do
    name="$base$SUFFIX"
    gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
  done
  echo "Secrets ready. Now run: ${AURA_ENV:+AURA_ENV=$AURA_ENV }./deploy-cloudrun.sh $PROJECT"
  exit 0
fi

# CPU is always allocated (instance-based billing) so send-and-forget pushes (heat status,
# results, PED swap notices) always finish after the response. The every-minute
# ped-alerts-tick keeps one instance up anyway (~₹150/day), which is within budget.
# Meet sizing for ~4000 athletes: the apps poll standings ~30 s / results ~60 s, so ~250 req/s
# at peak (bursts higher after results). One 1-vCPU Node instance at concurrency 80 serves well
# over 100 req/s of these mostly-I/O requests; 6 warm instances absorb bursts with no cold start,
# and up to 60 can start if needed.
MIN_INSTANCES=0
[[ "${AURA_ENV:-production}" != "staging" ]] && MIN_INSTANCES=1
MAX_INSTANCES=20
MEMORY=512Mi
if [[ "$MODE" == "--meet" || "$MODE" == "--resize-meet" ]]; then
  MIN_INSTANCES=6
  MAX_INSTANCES=60
  MEMORY=1Gi
fi
SIZING=(--cpu 1 --memory "$MEMORY" --concurrency 80 --min-instances "$MIN_INSTANCES" --max-instances "$MAX_INSTANCES" --no-cpu-throttling --cpu-boost --timeout 60s)

if [[ "$MODE" == "--resize-meet" || "$MODE" == "--resize-normal" ]]; then
  gcloud run services update "$SERVICE" --region "$REGION" "${SIZING[@]}"
  gcloud run services describe "$SERVICE" --region "$REGION" \
    --format='value(spec.template.metadata.annotations,spec.template.spec.containers[0].resources.limits)' | tr ';' '\n' | grep -E 'Scale|throttling|memory|cpu'
  exit 0
fi

cd "$(dirname "$0")"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  "${SIZING[@]}" \
  --set-env-vars "NODE_ENV=production,TRUST_PROXY=1" \
  --set-secrets "JWT_SECRET=JWT_SECRET$SUFFIX:latest,ATHLETE_QR_SECRET=ATHLETE_QR_SECRET$SUFFIX:latest,SUPABASE_URL=SUPABASE_URL$SUFFIX:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY$SUFFIX:latest,PED_CRON_SECRET=PED_CRON_SECRET$SUFFIX:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "Deployed: $URL"
echo "Health:   $(curl -s "$URL/health" || true)"
echo "Set EXPO_PUBLIC_API_URL=$URL/api in frontend/mobile/eas.json"
