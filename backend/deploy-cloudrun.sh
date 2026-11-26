#!/usr/bin/env bash
# =============================================================================
# Deploy the VTU SportsOS API (AURA apps backend) to Google Cloud Run — Mumbai.
#
#   ./deploy-cloudrun.sh <gcp-project-id> [--meet]
#
#   --meet   meet-day sizing (7–10 Dec): 2 always-warm instances. Without it: 0 (scale to zero).
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

PROJECT="${1:?usage: ./deploy-cloudrun.sh <gcp-project-id> [--meet|--init-secrets]}"
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

MIN_INSTANCES=0
[[ "$MODE" == "--meet" ]] && MIN_INSTANCES=2

cd "$(dirname "$0")"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 80 \
  --min-instances "$MIN_INSTANCES" \
  --max-instances 20 \
  --no-cpu-throttling \
  --cpu-boost \
  --timeout 60s \
  --set-env-vars "NODE_ENV=production,TRUST_PROXY=1" \
  --set-secrets "JWT_SECRET=JWT_SECRET$SUFFIX:latest,ATHLETE_QR_SECRET=ATHLETE_QR_SECRET$SUFFIX:latest,SUPABASE_URL=SUPABASE_URL$SUFFIX:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY$SUFFIX:latest,PED_CRON_SECRET=PED_CRON_SECRET$SUFFIX:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "Deployed: $URL"
echo "Health:   $(curl -s "$URL/health" || true)"
echo "Set EXPO_PUBLIC_API_URL=$URL/api in frontend/mobile/eas.json"
