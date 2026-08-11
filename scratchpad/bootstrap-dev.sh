#!/usr/bin/env bash
# Full bootstrap for stock-pnl-web new dev Supabase (ivan.lab)
# Usage: bash scratchpad/bootstrap-dev.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/sources"

export SUPABASE_URL="${SUPABASE_URL:-https://korq9tvdz0jd7yblr72p.ivan.lab}"
export SUPABASE_SECRET_KEY="${SUPABASE_SECRET_KEY:?set SUPABASE_SECRET_KEY}"
export SUPABASE_PUBLISHABLE_KEY="${SUPABASE_PUBLISHABLE_KEY:?set SUPABASE_PUBLISHABLE_KEY}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}"
export CRON_SECRET="${CRON_SECRET:-33c5349d1fee7a30f908e8711203271c2c862c74f37a6d0e}"
export PGHOST="${PGHOST:-korq9tvdz0jd7yblr72p.ivan.lab}"
export PGPORT="${PGPORT:-5432}"
export PGPASSWORD="$POSTGRES_PASSWORD"
export CURL_INSECURE="${CURL_INSECURE:--k}"

echo "== 1) Apply schema =="
psql "postgresql://postgres:${PGPASSWORD}@${PGHOST}:${PGPORT}/postgres?sslmode=prefer" \
  -v ON_ERROR_STOP=1 -f "$ROOT/scratchpad/bootstrap-dev-full.sql"

echo "== 2) Verify tables =="
psql "postgresql://postgres:${PGPASSWORD}@${PGHOST}:${PGPORT}/postgres?sslmode=prefer" -c \
  "select tablename from pg_tables where schemaname='public' order by 1;"

echo "== 3) Storage bucket (idempotent via SQL already; also via API) =="
curl $CURL_INSECURE -sS -X POST "$SUPABASE_URL/storage/v1/bucket" \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"reports","name":"reports","public":true}' || true
curl $CURL_INSECURE -sS "$SUPABASE_URL/storage/v1/bucket" \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY"

echo "== 4) Edge secrets CRON_SECRET =="
# Self-hosted: try CLI if linked; else print manual step
if supabase secrets set "CRON_SECRET=$CRON_SECRET" --project-ref korq9tvdz0jd7yblr72p 2>/dev/null; then
  echo "secrets set via CLI"
else
  echo "CLI secrets set failed — set CRON_SECRET in Dashboard Edge Function secrets to: $CRON_SECRET"
fi

echo "== 5) Deploy functions (from sources/) =="
supabase functions deploy stock-price --project-ref korq9tvdz0jd7yblr72p || \
  echo "CLI deploy stock-price failed — use Studio or docker deploy"
supabase functions deploy stock-report --no-verify-jwt --project-ref korq9tvdz0jd7yblr72p || \
  echo "CLI deploy stock-report failed — use Studio or docker deploy"

echo "== 6) Smoke =="
curl $CURL_INSECURE -sS -o /tmp/sp.json -w "stock-price HTTP %{http_code}\n" -X POST \
  "$SUPABASE_URL/functions/v1/stock-price" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"quote","items":[{"market":"TPE","ticker":"2330"}]}'
head -c 200 /tmp/sp.json; echo

curl $CURL_INSECURE -sS -o /tmp/sr.json -w "stock-report warm no auth HTTP %{http_code}\n" -X POST \
  "$SUPABASE_URL/functions/v1/stock-report" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"warm","ticker":"2330","name":"TSMC"}'
head -c 200 /tmp/sr.json; echo

curl $CURL_INSECURE -sS -o /tmp/cron.json -w "generate-all cron HTTP %{http_code}\n" -X POST \
  "$SUPABASE_URL/functions/v1/stock-report" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"action":"generate-all"}'
head -c 300 /tmp/cron.json; echo

echo "DONE. Record CRON_SECRET=$CRON_SECRET"
