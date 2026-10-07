#!/usr/bin/env bash
# Operator script: pg_dump backup of the DEV and/or PROD cloud database into docs/dbak/<env>/<stamp>/.
#
# Usage (from anywhere; needs SUPABASE_ACCESS_TOKEN, e.g. `sbuse stock`):
#   bash -ic 'sbuse stock >/dev/null; bash ~/stock-pnl-web/sources/scripts/db-backup.sh all'
#   ... db-backup.sh dev | prod | all
#
# Output per environment (restore with db-restore.sh, to Supabase cloud or self-host):
#   roles.sql    custom cluster roles (Supabase's own roles are filtered out by the CLI)
#   schema.sql   every non-platform schema (public, ...); auth/storage structure comes with any Supabase
#   data.sql     COPY data of public, auth, storage, ... minus sessions, tokens and cron/net logs
#   cron.sql     one cron.schedule(...) per job, command text included (it carries x-cron-secret)
#   counts.tsv   exact row count per public/auth table, compared after a restore
#   manifest.txt ref, time, pg_dump / server versions
#   SHA256SUMS   checked by db-restore.sh before it writes anything
#
# No Docker here, so `supabase db dump` cannot run pg_dump itself. Its --dry-run prints the exact
# pg_dump pipeline (with a short-lived cli_login_postgres password); this script runs that pipeline
# with the local pg_dump. Nothing secret is printed: credentials stay in a 0600 temp file.
#
# The output holds password hashes, the cron secret and every user's transactions. The repo is
# PUBLIC, so the script refuses to write unless git ignores the target (`docs/dbak/` in .gitignore).
set -euo pipefail

DEV_REF=zyebvayngwrqzoaicbwd
PROD_REF=hrilemueiqyaoiwnkeuu

SOURCES_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO_DIR=$(dirname "$SOURCES_DIR")
DBAK_DIR="$REPO_DIR/docs/dbak"

# Ephemeral or log tables: no recovery value, and cron.job is restored from cron.sql instead
# (its command text must be re-pointed at the new host). Auth list: Spec 160 §4.
DATA_EXCLUDES=(
  auth.sessions auth.refresh_tokens auth.flow_state auth.one_time_tokens
  auth.saml_relay_states auth.audit_log_entries
  cron.job cron.job_run_details net._http_response net.http_request_queue
)

die() { echo "db-backup: $*" >&2; exit 1; }

SUPABASE_BIN=${SUPABASE_BIN:-$(command -v supabase || echo /home/linuxbrew/.linuxbrew/bin/supabase)}
[[ -x "$SUPABASE_BIN" ]] || die "supabase CLI not found (set SUPABASE_BIN)"
command -v pg_dump >/dev/null || die "pg_dump not found (apt install postgresql-client)"
command -v psql >/dev/null || die "psql not found (apt install postgresql-client)"
[[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]] || die "SUPABASE_ACCESS_TOKEN is not set (run: sbuse stock)"

case "${1:-}" in
  dev) ENVS=(dev) ;;
  prod) ENVS=(prod) ;;
  all) ENVS=(dev prod) ;;
  *) die "usage: db-backup.sh dev|prod|all" ;;
esac

TMP=$(mktemp -d)
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# Writes the CLI's pg_dump pipeline for <ref> + <flags> to $TMP/<name>.sh and checks its shape.
cli_script() {
  local name=$1 ref=$2
  shift 2
  (cd "$SOURCES_DIR" && "$SUPABASE_BIN" db dump --project-ref "$ref" --dry-run "$@" 2>/dev/null) >"$TMP/$name.sh" \
    || die "supabase db dump --dry-run failed for $name ($ref)"
  chmod 600 "$TMP/$name.sh"
  head -1 "$TMP/$name.sh" | grep -q '^#!/usr/bin/env bash' || die "unexpected dry-run output for $name"
  grep -q '^export PGPASSWORD=' "$TMP/$name.sh" || die "dry-run for $name carries no credentials"
}

# Runs a SQL file with the credentials of a dry-run script, never echoing them.
psql_with() {
  local creds=$1 sql=$2
  (
    # shellcheck disable=SC1090
    source <(grep '^export PG' "$creds")
    # pg_dump gets --role postgres; psql needs the same SET ROLE to read cron.job.
    psql -X -q -v ON_ERROR_STOP=1 -At -F $'\t' -c "SET ROLE postgres" -f "$sql"
  )
}

backup_env() {
  local env=$1 ref
  [[ $env == dev ]] && ref=$DEV_REF || ref=$PROD_REF
  local stamp out
  stamp=$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)
  out="$DBAK_DIR/$env/$stamp"
  mkdir -p "$out"
  chmod 700 "$DBAK_DIR" "$DBAK_DIR/$env" "$out"
  git -C "$REPO_DIR" check-ignore -q "$out/probe" || die "$out is not git-ignored; refusing to write"
  echo "== $env ($ref) -> ${out#"$REPO_DIR"/}"

  local x_flags=()
  for t in "${DATA_EXCLUDES[@]}"; do x_flags+=(-x "$t"); done

  # Every --dry-run re-initialises the login role with a new password, so each pipeline must run
  # before the next one is generated, and the psql queries below reuse the last (data) credentials.
  cli_script roles "$ref" --role-only
  bash "$TMP/roles.sh" >"$out/roles.sql"
  cli_script schema "$ref"
  bash "$TMP/schema.sh" >"$out/schema.sql"
  cli_script data "$ref" --data-only --use-copy "${x_flags[@]}"
  bash "$TMP/data.sh" >"$out/data.sql"

  # format(%L) quotes the command exactly as pg_cron stores it.
  cat >"$TMP/cron.q.sql" <<'SQL'
SELECT format('SELECT cron.schedule(%L, %L, %L);', jobname, schedule, command)
FROM cron.job ORDER BY jobid;
SQL
  { echo "-- cron jobs of $ref; db-restore.sh rewrites https://$ref.supabase.co"; psql_with "$TMP/data.sh" "$TMP/cron.q.sql"; } >"$out/cron.sql"

  cat >"$TMP/counts.q.sql" <<'SQL'
SELECT table_schema || '.' || table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema IN ('public', 'auth') AND table_type = 'BASE TABLE'
ORDER BY 1;
SQL
  psql_with "$TMP/data.sh" "$TMP/counts.q.sql" >"$out/counts.tsv"

  echo "SELECT current_setting('server_version');" >"$TMP/ver.q.sql"
  {
    echo "env=$env"
    echo "ref=$ref"
    echo "created_at=$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S') Asia/Taipei"
    echo "pg_dump=$(pg_dump --version)"
    echo "server_version=$(psql_with "$TMP/data.sh" "$TMP/ver.q.sql")"
    echo "data_excludes=${DATA_EXCLUDES[*]}"
  } >"$out/manifest.txt"

  for f in roles.sql schema.sql data.sql cron.sql; do
    [[ -s "$out/$f" ]] || die "$f is empty"
  done
  grep -q '^COPY "public"."transactions"' "$out/data.sql" || die "data.sql has no public.transactions"
  grep -q '^COPY "auth"."users"' "$out/data.sql" || die "data.sql has no auth.users"

  (cd "$out" && sha256sum roles.sql schema.sql data.sql cron.sql counts.tsv manifest.txt >SHA256SUMS)
  chmod 600 "$out"/*
  rm -f "$TMP"/*.sh
  echo "   $(du -sh "$out" | cut -f1)  jobs=$(grep -c '^SELECT cron.schedule' "$out/cron.sql")  tables=$(wc -l <"$out/counts.tsv")"
}

for env in "${ENVS[@]}"; do backup_env "$env"; done
