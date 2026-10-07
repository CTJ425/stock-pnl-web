#!/usr/bin/env bash
# Operator script: load a db-backup.sh package into another Supabase database —
# a new cloud project (e.g. another region) or a self-hosted stack.
#
# Usage:
#   export TARGET_DB_URL='postgresql://<user>:<password>@<host>:5432/postgres'   # keeps it out of shell history
#   bash sources/scripts/db-migrate.sh --from docs/dbak/prod/<stamp> --dry-run
#   bash sources/scripts/db-migrate.sh --from docs/dbak/prod/<stamp> --cron-base-url https://<new-ref>.supabase.co
#
# Target connection string:
#   cloud      Dashboard → Connect → Session pooler (port 5432), user `postgres.<ref>`
#   self-host  postgres on the host's 5432 (behind Supavisor the user is `postgres.<POOLER_TENANT_ID>`),
#              password = POSTGRES_PASSWORD from the stack's .env
#
# Options:
#   --from <dir>            backup package (docs/dbak/<env>/<stamp>)
#   --to <url>              target URL; default $TARGET_DB_URL
#   --cron-base-url <url>   rewrite https://<old-ref>.supabase.co in cron jobs to this and install them
#                           (cloud: https://<new-ref>.supabase.co, self-host: http://kong:8000 or the public API URL)
#   --skip-cron             install no cron jobs (e.g. while the old project still runs its own)
#   --allow-prod            permit the current PROD project as the target
#   --dry-run               verify the package and the target, print the plan, write nothing
#   --yes                   do not ask for the typed confirmation
#
# Order: checksums → target checks (Supabase schemas present, empty) → one transaction of
# roles + schema + data (triggers off) → cron jobs → row counts compared with counts.tsv.
# The main load is a single transaction: any error leaves the target untouched.
#
# Not covered here (printed at the end): Edge Functions, Edge secrets, Storage files,
# Auth URL settings, Cloudflare Pages env vars, CSP connect-src, verify.sql.
set -euo pipefail

PROD_REF=hrilemueiqyaoiwnkeuu

die() { echo "db-migrate: $*" >&2; exit 1; }
say() { echo "db-migrate: $*"; }

FROM= TO=${TARGET_DB_URL:-} CRON_BASE= SKIP_CRON=0 ALLOW_PROD=0 DRY=0 YES=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --from) FROM=$2; shift 2 ;;
    --to) TO=$2; shift 2 ;;
    --cron-base-url) CRON_BASE=${2%/}; shift 2 ;;
    --skip-cron) SKIP_CRON=1; shift ;;
    --allow-prod) ALLOW_PROD=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

[[ -n $FROM && -d $FROM ]] || die "--from <backup dir> is required"
[[ -n $TO ]] || die "no target: pass --to or set TARGET_DB_URL"
[[ $SKIP_CRON == 1 || -n $CRON_BASE ]] || die "pass --cron-base-url <url> or --skip-cron"
[[ $SKIP_CRON == 1 && -n $CRON_BASE ]] && die "--cron-base-url and --skip-cron are exclusive"
command -v psql >/dev/null || die "psql not found (apt install postgresql-client)"

FROM=$(cd "$FROM" && pwd)
for f in roles.sql schema.sql data.sql cron.sql counts.tsv manifest.txt SHA256SUMS; do
  [[ -f $FROM/$f ]] || die "$FROM/$f missing"
done
(cd "$FROM" && sha256sum --quiet -c SHA256SUMS) || die "checksum mismatch in $FROM; refusing to load it"

SRC_REF=$(sed -n 's/^ref=//p' "$FROM/manifest.txt")
EXCLUDES=$(sed -n 's/^data_excludes=//p' "$FROM/manifest.txt")
[[ -n $SRC_REF ]] || die "manifest.txt has no ref"

REDACTED=$(sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#' <<<"$TO")
TARGET_HOST=$(sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#' <<<"$TO")
if [[ $TO == *"$PROD_REF"* && $ALLOW_PROD == 0 ]]; then
  die "target is the PROD project ($PROD_REF); pass --allow-prod if that is really intended"
fi
[[ $TO == *"$SRC_REF"* ]] && say "WARNING: target looks like the source project itself ($SRC_REF)"

TMP=$(mktemp -d)
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

q() { psql "$TO" -X -q -v ON_ERROR_STOP=1 -At -F $'\t' "$@"; }

# --- target checks -----------------------------------------------------------------------------
say "source  $SRC_REF ($(sed -n 's/^created_at=//p' "$FROM/manifest.txt"))"
say "target  $REDACTED"
q -c "SELECT 1" >/dev/null || die "cannot connect to the target"
say "server  $(q -c "SELECT current_setting('server_version')") as $(q -c "SELECT current_user")"

for s in auth storage; do
  [[ $(q -c "SELECT count(*) FROM pg_namespace WHERE nspname = '$s'") == 1 ]] \
    || die "target has no '$s' schema: it is not a Supabase database (start the stack / create the project first)"
done
for e in pg_cron pg_net pgcrypto uuid-ossp; do
  [[ $(q -c "SELECT count(*) FROM pg_available_extensions WHERE name = '$e'") == 1 ]] \
    || die "extension $e is not available on the target"
done
users=$(q -c "SELECT count(*) FROM auth.users")
txs=$(q -c "SELECT CASE WHEN to_regclass('public.transactions') IS NULL THEN 0 ELSE (SELECT count(*) FROM public.transactions) END")
[[ $users == 0 && $txs == 0 ]] || die "target is not empty (auth.users=$users, public.transactions=$txs); load only into a fresh project"

# data.sql COPYs into platform tables too (auth.*, storage.*). A self-host or an older/newer
# Supabase may lack some of them (e.g. storage.vector_indexes); drop those blocks rather than
# fail the whole load. public.* tables are created by schema.sql in the same transaction.
: >"$TMP/skipped"
while IFS= read -r tbl; do
  schema=${tbl%%.*}
  [[ $schema == public ]] && continue
  [[ $(q -c "SELECT to_regclass('\"$schema\".\"${tbl#*.}\"') IS NOT NULL") == t ]] || echo "$tbl" >>"$TMP/skipped"
done < <(sed -nE 's/^COPY "([^"]+)"\."([^"]+)".*/\1.\2/p' "$FROM/data.sql")

awk -v skipfile="$TMP/skipped" '
  BEGIN { while ((getline t < skipfile) > 0) skip[t] = 1 }
  /^COPY "/ { match($0, /^COPY "[^"]+"\."[^"]+"/); s = substr($0, 6, RLENGTH - 5); gsub(/"/, "", s); if (s in skip) { dropping = 1; next } }
  dropping { if ($0 == "\\.") dropping = 0; next }
  { print }
' "$FROM/data.sql" >"$TMP/data.sql"

# --- cron ----------------------------------------------------------------------------------------
if [[ $SKIP_CRON == 0 ]]; then
  sed "s#https://$SRC_REF\.supabase\.co#$CRON_BASE#g" "$FROM/cron.sql" >"$TMP/cron.sql"
  ! grep -q "$SRC_REF" <(grep -v '^--' "$TMP/cron.sql") || die "cron.sql still names $SRC_REF after the rewrite"
fi

# --- plan ----------------------------------------------------------------------------------------
echo
say "plan"
echo "  1. one transaction: roles.sql, schema.sql, data.sql ($(grep -c '^COPY ' "$TMP/data.sql") tables, triggers off)"
if [[ -s $TMP/skipped ]]; then
  echo "     skipped (absent on target): $(tr '\n' ' ' <"$TMP/skipped")"
fi
if [[ $SKIP_CRON == 0 ]]; then
  echo "  2. $(grep -c '^SELECT cron.schedule' "$TMP/cron.sql") cron jobs, https://$SRC_REF.supabase.co -> $CRON_BASE"
else
  echo "  2. cron skipped"
fi
echo "  3. compare row counts with counts.tsv"
echo
[[ $DRY == 1 ]] && { say "dry run: nothing written"; exit 0; }

if [[ $YES == 0 ]]; then
  read -r -p "Type the target host ($TARGET_HOST) to load into it: " answer
  [[ $answer == "$TARGET_HOST" ]] || die "confirmation did not match; nothing written"
fi

# --- load ----------------------------------------------------------------------------------------
say "loading (single transaction)..."
psql "$TO" -X -q -v ON_ERROR_STOP=1 --single-transaction \
  -f "$FROM/roles.sql" \
  -f "$FROM/schema.sql" \
  -c 'SET session_replication_role = replica' \
  -f "$TMP/data.sql" >/dev/null
say "loaded"

if [[ $SKIP_CRON == 0 ]]; then
  q -f "$TMP/cron.sql" >/dev/null
  say "cron jobs on target: $(q -c 'SELECT count(*) FROM cron.job')"
fi

# --- verify --------------------------------------------------------------------------------------
cat >"$TMP/counts.q.sql" <<'SQL'
SELECT table_schema || '.' || table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema IN ('public', 'auth') AND table_type = 'BASE TABLE'
ORDER BY 1;
SQL
q -f "$TMP/counts.q.sql" >"$TMP/counts.target"
mismatch=0
while IFS=$'\t' read -r tbl n; do
  [[ " $EXCLUDES " == *" $tbl "* ]] && continue
  grep -qx "$tbl" "$TMP/skipped" && continue
  got=$(awk -F'\t' -v t="$tbl" '$1 == t { print $2 }' "$TMP/counts.target")
  if [[ $got != "$n" ]]; then
    echo "  count mismatch: $tbl source=$n target=${got:-missing}"
    mismatch=1
  fi
done <"$FROM/counts.tsv"
[[ $mismatch == 0 ]] && say "row counts match the backup" || say "WARNING: row counts differ (see above)"

cat <<EOF

db-migrate: database done. Still to do by hand (the order matters for cron):
  - Edge Functions: deploy stock-price, stock-report (--no-verify-jwt), backup-transactions
  - Edge secrets: CRON_SECRET must equal the value inside the restored cron jobs; FUGLE_API_KEY etc.
  - Storage files: only the storage.objects rows were restored, not the files (scripts/backup-download.cjs)
  - Auth: Site URL / redirect URLs (pages.dev domains), SMTP on self-host; users sign in again (new JWT secret)
  - Cloudflare Pages: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY; public/_headers connect-src
  - Run sources/supabase/verify.sql: SELECT * FROM verify_setup(); SELECT assert_setup_ok();
  - Stop the old project's cron before the new one runs, or every batch runs twice
EOF
