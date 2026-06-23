#!/usr/bin/env bash
# Generate a gitignored Helm overlay from the root .env so real keys (Firebase
# web config, RapidAPI, Google Maps) never get committed. Firebase web config +
# NUXT_PUBLIC_GOOGLE_MAPS_KEY → frontend env (via global.extraEnv); RAPIDAPI_KEY
# and GOOGLE_MAPS_SERVER_KEY → trip-service Secret.
#
#   ./scripts/gen-local-secret.sh
# (kind-up.sh layers the generated overlay automatically.) The chart now lives in
# the sibling TravelManagerIaC repo; override TM_CHART_DIR if checked out elsewhere.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
CHART_DIR="${TM_CHART_DIR:-$REPO_ROOT/../TravelManagerIaC/charts/travelmanager}"
[ -d "$CHART_DIR" ] || { echo "chart not found at $CHART_DIR — set TM_CHART_DIR to the TravelManagerIaC checkout"; exit 1; }

[ -f .env ] || { echo ".env not found"; exit 1; }
set -a; . ./.env; set +a   # source .env

# Auth mode is controlled by GATEWAY_SKIP_AUTH in .env (default 1 = skip-auth,
# x-debug-uid). Set GATEWAY_SKIP_AUTH=0 for real Firebase token verification —
# this works with ADC (no service-account key needed): verifyIdToken only needs
# the project id, resolved from NUXT_PUBLIC_FIREBASE_PROJECT_ID in the pod.
SKIP_AUTH="${GATEWAY_SKIP_AUTH:-1}"
SKIP_AUTH_LINE=''
if [ "$SKIP_AUTH" = "1" ]; then
  SKIP_AUTH_LINE='    - { name: GATEWAY_SKIP_AUTH, value: "1" }'
  echo "GATEWAY_SKIP_AUTH=1 → skip-auth mode (x-debug-uid)"
else
  echo "GATEWAY_SKIP_AUTH=0 → real auth (verifyIdToken via ADC / project id)"
fi

# Optional explicit service-account JSON (most orgs disallow key downloads and
# use ADC instead, so this is normally left as "{}").
GW_SECRET='    FIREBASE_SERVICE_ACCOUNT: "{}"'
if [ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ]; then
  esc=$(printf '%s' "$FIREBASE_SERVICE_ACCOUNT" | sed "s/'/''/g")
  GW_SECRET="    FIREBASE_SERVICE_ACCOUNT: '${esc}'"
fi

OUT="$CHART_DIR/values-local.secret.yaml"
{
cat <<EOF
# AUTO-GENERATED from .env by scripts/gen-local-secret.sh — DO NOT COMMIT.
global:
  extraEnv:
    - { name: PUBSUB_DISABLED, value: "1" }
    # Firestore (likes / review-comments) → in-cluster emulator, no GCP creds.
    # Helm replaces (not merges) the extraEnv array, so these must live here too
    # — this overlay is applied last and would otherwise drop them.
    - { name: FIRESTORE_EMULATOR_HOST, value: "firestore-emulator:8080" }
    - { name: FIRESTORE_DATABASE_ID, value: "(default)" }
EOF
[ -n "$SKIP_AUTH_LINE" ] && echo "$SKIP_AUTH_LINE"
cat <<EOF
    - { name: NUXT_PUBLIC_FIREBASE_API_KEY,        value: "${NUXT_PUBLIC_FIREBASE_API_KEY:-}" }
    - { name: NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN,    value: "${NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN:-}" }
    - { name: NUXT_PUBLIC_FIREBASE_PROJECT_ID,     value: "${NUXT_PUBLIC_FIREBASE_PROJECT_ID:-}" }
    - { name: NUXT_PUBLIC_FIREBASE_APP_ID,         value: "${NUXT_PUBLIC_FIREBASE_APP_ID:-}" }
    - { name: NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET, value: "${NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-}" }
    - { name: NUXT_PUBLIC_GOOGLE_MAPS_KEY,         value: "${NUXT_PUBLIC_GOOGLE_MAPS_KEY:-}" }
localSecretValues:
  api-gateway:
${GW_SECRET}
  trip-service:
    RAPIDAPI_KEY: "${RAPIDAPI_KEY:-}"
    GOOGLE_MAPS_SERVER_KEY: "${GOOGLE_MAPS_SERVER_KEY:-}"
EOF
} > "$OUT"
echo "wrote $OUT (gitignored)"
