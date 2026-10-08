#!/usr/bin/env bash
# Operator script: pg_dump backup of a Supabase database (cloud or self-hosted) into backups/<name>/<stamp>/.
#
# Needs only `pg_dump` / `psql` (postgresql-client, version >= the server's). The Supabase CLI is optional.
#
# Usage:
#   bash scripts/db-backup.sh                                   # interactive
#   SOURCE_DB_URL='postgresql://...' bash scripts/db-backup.sh --name prod
#   bash scripts/db-backup.sh --project-ref <ref> --name dev    # via Supabase CLI, no DB password
#
# Connection string:
#   cloud      Dashboard → Connect → Session pooler (port 5432) or Direct connection. Not the transaction
#              pooler (6543): pg_dump needs a session.
#   self-host  postgres on the host's 5432 (behind Supavisor the user is `postgres.<POOLER_TENANT_ID>`)
#   A URL without a password makes the script ask for it (not echoed, passed via PGPASSWORD).
#
# --project-ref: `supabase db dump --dry-run` creates a short-lived `cli_login_postgres` login and prints it;
# the script uses that login instead of a password (needs SUPABASE_ACCESS_TOKEN or `supabase login`).
#
# Output (restore with db-migrate.sh, into Supabase cloud or a self-host):
#   roles.sql    custom cluster roles (Supabase's own roles filtered out)
#   schema.sql   every non-platform schema (public, ...); auth/storage structure comes with any Supabase
#   data.sql     COPY data of public, auth, storage, ... minus sessions, tokens and cron/net logs
#   cron.sql     one cron.schedule(...) per job, command text included (it carries x-cron-secret)
#   counts.tsv   exact row count per public/auth table, compared after a restore
#   manifest.txt source, API base the cron jobs call, time, pg_dump / server versions
#   SHA256SUMS   checked by db-migrate.sh before it writes anything
#
# The pg_dump flags and sed filters are the ones `supabase db dump` (CLI v2.117) runs, so a backup made
# with or without the CLI is the same.
#
# The output holds password hashes, the cron secret and every user's transactions. Inside a git
# checkout the script refuses to write unless git ignores the target (`backups/` in .gitignore).
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCES_DIR="$REPO_DIR/sources"   # the Supabase CLI runs from here (it looks for ./supabase/)
DBAK_DIR="$REPO_DIR/backups"

# Ephemeral or log tables: no recovery value, and cron.job is restored from cron.sql instead
# (its command text must be re-pointed at the new host).
DATA_EXCLUDES=(
  auth.sessions auth.refresh_tokens auth.flow_state auth.one_time_tokens
  auth.saml_relay_states auth.audit_log_entries auth.mfa_amr_claims
  cron.job cron.job_run_details net._http_response net.http_request_queue
)
# Platform schemas and roles, maintained by Supabase itself (same lists as the CLI).
SCHEMA_SKIP='information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault'
DATA_SKIP='information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor'
RESERVED_ROLES='anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin'

die() { echo "db-backup: $*" >&2; exit 1; }
ask() { # ask <prompt> [default] -> answer on stdout
  local ans
  read -r -p "$1${2:+ [$2]}: " ans </dev/tty
  echo "${ans:-${2:-}}"
}
read_secret() { # read_secret <prompt> -> the typed value on stdout; shows one * per character
  local pw="" ch
  # Drop keys already waiting in the buffer: a pasted URL that ended in a newline used to arrive here
  # as an instant Enter, i.e. an empty password.
  while IFS= read -r -s -n1 -t 0.05 ch </dev/tty; do :; done
  printf '%s' "$1" >/dev/tty
  while IFS= read -r -s -n1 ch </dev/tty; do
    if [[ -z $ch && -z $pw ]]; then
      printf '\n%s' "   密碼不能是空的，請輸入：" >/dev/tty # Enter on nothing: ask again
    elif [[ -z $ch ]]; then
      break # Enter
    elif [[ $ch == $'\x7f' || $ch == $'\b' ]]; then
      [[ -n $pw ]] && { pw=${pw%?}; printf '\b \b' >/dev/tty; }
    else
      pw+=$ch
      printf '*' >/dev/tty
    fi
  done
  printf '\n' >/dev/tty
  printf '%s' "$pw"
}

# probe <url> -> ok | badpw | blocked | notenant | other   (password from PGPASSWORD)
probe() {
  local out
  out=$(PGCONNECT_TIMEOUT=6 psql "$1" -w -X -q -At -c 'SELECT 1' 2>&1) && { echo ok; return; }
  case $out in
    *'password authentication failed'*) echo badpw ;;
    *ECIRCUITBREAKER* | *'too many authentication'*) echo blocked ;;
    *'Tenant or user not found'*) echo notenant ;;
    *) echo other ;;
  esac
}

# find_pooler <ref> -> "<host> <ok|badpw|blocked>" for the Session pooler that holds this cloud project,
# or nothing. It connects with the real password (PGPASSWORD) to every regional pooler at once: the ones
# that do not hold the project answer "Tenant or user not found" without checking any password, so only
# the right one can ever count an authentication failure. (Probing with a dummy password did count one,
# and a few rounds tripped Supavisor's ECIRCUITBREAKER for the project.) First hit wins.
find_pooler() {
  local ref=$1 dir h r i f
  dir=$(mktemp -d)
  for h in aws-0 aws-1; do
    for r in ap-northeast-1 ap-northeast-2 ap-southeast-1 ap-southeast-2 ap-south-1 us-east-1 us-east-2 \
      us-west-1 us-west-2 ca-central-1 eu-west-1 eu-west-2 eu-west-3 eu-central-1 eu-central-2 eu-north-1 sa-east-1; do
      ( st=$(probe "postgresql://postgres.$ref@$h-$r.pooler.supabase.com:5432/postgres")
        [[ $st == ok || $st == badpw || $st == blocked ]] && echo "$st" >"$dir/$h-$r" ) >/dev/null 2>&1 &
      # (no output: the answer is the file; a probe still running after the first hit must not
      # write into the caller's closed pipe)
    done
  done
  for ((i = 0; i < 100; i++)); do
    [[ -n $(ls "$dir") || -z $(jobs -pr) ]] && break
    sleep 0.2
  done
  kill $(jobs -pr) 2>/dev/null || true
  f=$(ls "$dir" | head -1)
  [[ -n $f ]] && echo "$f.pooler.supabase.com $(cat "$dir/$f")"
  rm -rf "$dir"
}

BLOCKED_MSG="Supabase 因為短時間內多次密碼錯誤，暫時封鎖了這個專案來自這台電腦的新連線（ECIRCUITBREAKER）。請等 5–10 分鐘再執行，並確認輸入的是「資料庫密碼」"

command -v pg_dump >/dev/null || die "pg_dump not found (install postgresql-client)"
command -v psql >/dev/null || die "psql not found (install postgresql-client)"

DB_URL=${SOURCE_DB_URL:-} REF= NAME=
while [[ $# -gt 0 ]]; do
  case $1 in
    --db-url) DB_URL=$2; shift 2 ;;
    --project-ref) REF=$2; shift 2 ;;
    --name) NAME=$2; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/{/^set -euo/!p}' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

TMP=$(mktemp -d)
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

supabase_cli() {
  if command -v supabase >/dev/null; then supabase "$@"
  elif command -v npx >/dev/null; then npx --yes supabase "$@"
  else die "--project-ref needs the Supabase CLI (or npx); use a connection string instead"
  fi
}

interactive() {
  echo "== 資料庫備份（互動模式）"
  echo "1) 來源資料庫怎麼連："
  echo "   1) Supabase cloud：只要貼 Project URL，連線位址自動找（之後輸入資料庫密碼）"
  echo "   2) 貼上連線字串（自架，或想自己指定）"
  echo "   3) 用 Supabase CLI（免資料庫密碼；需已 supabase login 或設定 SUPABASE_ACCESS_TOKEN）"
  local choice
  choice=$(ask "   選擇" 1)
  if [[ $choice == 1 ]]; then
    local url ref host
    while :; do
      url=$(ask "   Project URL（Dashboard → Project Settings → Data API，例如 https://abcdefghijklmnopqrst.supabase.co）")
      ref=$(sed -nE 's#^https?://([a-z0-9]{20})\.supabase\.co/?$#\1#p' <<<"$url")
      [[ -n $ref ]] && break
      echo "   格式不對：要長得像 https://<20 個英數字>.supabase.co"
    done
    local res st tries=0
    host=""
    while :; do
      PGPASSWORD=$(read_secret "   資料庫密碼（建專案時設定的那組，不是 Supabase 帳號密碼）: ")
      export PGPASSWORD
      if [[ -z $host ]]; then
        echo "   連線中（同時試各區域，找出這個專案的資料庫位址，通常幾秒內）..."
        res=$(find_pooler "$ref")
        [[ -n $res ]] || die "could not find the database of $ref; rerun and choose 2 to paste the Session pooler connection string"
        host=${res%% *}
        st=${res#* }
      else
        st=$(probe "postgresql://postgres.$ref@$host:5432/postgres")
      fi
      case $st in
        ok) echo "   連線成功（$host）"; break ;;
        badpw)
          tries=$((tries + 1))
          echo "   密碼不對（專案在 $host）。忘了可到 Project Settings → Database → Reset database password，約 1–2 分鐘後生效。"
          [[ $tries -lt 3 ]] || die "the source refused the password 3 times"
          ;;
        blocked) die "$BLOCKED_MSG" ;;
        *) die "cannot reach $host ($st)" ;;
      esac
    done
    DB_URL="postgresql://postgres.$ref@$host:5432/postgres"
    choice=done
  fi
  case $choice in
    done) ;;
    2)
      echo "   cloud：Dashboard → 上方「Connect」→ 選「Session pooler」→ 複製 URI（主機是 aws-…pooler.supabase.com、port 5432）"
      while :; do
        DB_URL=$(ask "   連線字串（裡面的 [YOUR-PASSWORD] 不用改，之後再輸入密碼）")
        if [[ ! $DB_URL =~ ^postgres(ql)?:// ]]; then
          echo "   這不是連線字串：要以 postgresql:// 開頭（你可能貼成了 Project URL）"
        elif [[ $DB_URL =~ @db\.[a-z0-9]{20}\.supabase\.co ]]; then
          echo "   這是「Direct connection」（db.<ref>.supabase.co），只走 IPv6，多數網路連不到；請改用 Session pooler"
        elif [[ $DB_URL =~ :6543/ ]]; then
          echo "   這是 Transaction pooler（6543），備份需要 Session pooler（5432）"
        else
          break
        fi
      done
      ;;
    3)
      local json rows=() i=0 r ref region name n
      json=$(cd "$SOURCES_DIR" && supabase_cli projects list -o json 2>/dev/null) || die "supabase projects list failed (logged in?)"
      while IFS= read -r r; do rows+=("$r"); done < <(python3 -c '
import json, sys
for p in json.load(sys.stdin):
    print(p["ref"], p.get("region", "?"), p["name"])' <<<"$json")
      [[ ${#rows[@]} -gt 0 ]] || die "this login sees no project"
      for r in "${rows[@]}"; do
        i=$((i + 1))
        read -r ref region name <<<"$r"
        printf '   %d) %-24s %s  %s\n' "$i" "$name" "$ref" "$region"
      done
      n=$(ask "   專案編號" 1)
      [[ $n =~ ^[0-9]+$ && $n -ge 1 && $n -le ${#rows[@]} ]] || die "invalid choice: $n"
      read -r REF region name <<<"${rows[$((n - 1))]}"
      ;;
    *) die "invalid choice" ;;
  esac
  NAME=$(ask "2) 存到 backups/<名稱>/，名稱（例如 dev、prod）" backup)
}

if [[ -z $DB_URL && -z $REF ]]; then
  [[ -t 0 ]] || die "no source: pass --db-url / SOURCE_DB_URL or --project-ref (see --help)"
  interactive
fi
if [[ -z $NAME ]]; then
  [[ -t 0 ]] || die "pass --name <folder under backups/>"
  NAME=$(ask "存到 backups/<名稱>/，名稱" backup)
fi
[[ $NAME =~ ^[a-z0-9_-]+$ ]] || die "name must be [a-z0-9_-]: $NAME"

# --- connection: everything below connects with CONN plus PG* from the environment ---------------
if [[ -n $REF ]]; then
  # One dry-run = one fresh login. A second dry-run would invalidate this password, so take it once.
  (cd "$SOURCES_DIR" && supabase_cli db dump --project-ref "$REF" --dry-run 2>/dev/null) >"$TMP/cli.sh" \
    || die "supabase db dump --dry-run failed for $REF"
  chmod 600 "$TMP/cli.sh"
  grep -q '^export PGPASSWORD=' "$TMP/cli.sh" || die "the CLI printed no login for $REF"
  # shellcheck disable=SC1090
  source <(grep '^export PG' "$TMP/cli.sh")
  rm -f "$TMP/cli.sh"
  CONN=()
else
  DB_URL=${DB_URL//:\[YOUR-PASSWORD\]@/@}
  if [[ ! $DB_URL =~ ://[^/@]+:[^/@]+@ && -z ${PGPASSWORD:-} ]]; then
    [[ -t 0 ]] || die "the connection string has no password; set PGPASSWORD"
    tries=0
    while :; do
      PGPASSWORD=$(read_secret "資料庫密碼（建專案時設定的那組）: ")
      export PGPASSWORD
      out=$(psql "$DB_URL" -w -X -q -At -c 'SELECT 1' 2>&1) && { echo "連線成功"; break; }
      echo "連不上：$(grep -m1 -E 'FATAL|error' <<<"$out" | sed -E 's/.*FATAL: +//; s/^psql: error: //')"
      [[ $out == *ECIRCUITBREAKER* || $out == *'too many authentication'* ]] && die "$BLOCKED_MSG"
      if [[ $out == *'password authentication failed'* ]]; then
        echo "→ 資料庫拒絕這組密碼：要的是「資料庫密碼」，不是 Supabase 帳號密碼；忘了可在 Project Settings → Database 重設（約 1–2 分鐘後生效）。"
        tries=$((tries + 1))
        [[ $tries -lt 3 ]] || die "the source refused the password 3 times"
      else
        die "cannot reach the source database (not a password problem); check the connection string / network"
      fi
    done
  fi
  REF=$(sed -nE 's#^[a-z]+://postgres\.([a-z0-9]{20})[:@].*#\1#p; s#^[a-z]+://[^@]*@db\.([a-z0-9]{20})\.supabase\.co.*#\1#p' <<<"$DB_URL" | head -1)
  CONN=(--dbname "$DB_URL")
fi

q() { psql "${CONN[@]}" -w -X -q -v ON_ERROR_STOP=1 -At -F $'\t' -c "SET ROLE postgres" "$@"; }
q -c "SELECT 1" >/dev/null || die "cannot connect to the source database"

stamp=$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)
out="$DBAK_DIR/$NAME/$stamp"
mkdir -p "$out"
chmod 700 "$DBAK_DIR" "$DBAK_DIR/$NAME" "$out"
if git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$REPO_DIR" check-ignore -q "$out/probe" || { rm -rf "$out"; die "$out is not git-ignored; add backups/ to .gitignore"; }
fi
echo "== ${REF:-source} -> ${out#"$REPO_DIR"/}"

pg_dumpall "${CONN[@]}" -w --roles-only --role postgres --quote-all-identifier --no-role-passwords --no-comments \
  | sed -E 's/^\\(un)?restrict .*$/-- &/' \
  | sed -E "s/^CREATE ROLE \"($RESERVED_ROLES)\"/-- &/" \
  | sed -E "s/^ALTER ROLE \"($RESERVED_ROLES)\"/-- &/" \
  | sed -E "s/ (NOSUPERUSER|NOREPLICATION)//g" \
  | sed -E "s/^-- (.* SET \"(pgaudit.*|pgrst.*|session_replication_role|statement_timeout|track_io_timing)\" .*)/\1/" \
  | sed -E "s/GRANT \".*\" TO \"($RESERVED_ROLES)\"/-- &/" \
  | sed -E "s/^GRANT .* ON PARAMETER .* TO \"($RESERVED_ROLES)\"/-- &/" \
  | sed -E "/^--/d" | uniq >"$out/roles.sql"
echo "RESET ALL;" >>"$out/roles.sql"

pg_dump "${CONN[@]}" -w --schema-only --quote-all-identifier --role postgres --exclude-schema "$SCHEMA_SKIP" \
  | sed -E 's/^\\(un)?restrict .*$/-- &/' \
  | sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' \
  | sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
  | sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' \
  | sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' \
  | sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' \
  | sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' \
  | sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' \
  | sed -E 's/^CREATE EVENT TRIGGER /-- &/' \
  | sed -E 's/^         WHEN TAG IN /-- &/' \
  | sed -E 's/^   EXECUTE FUNCTION /-- &/' \
  | sed -E 's/^ALTER EVENT TRIGGER /-- &/' \
  | sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' \
  | sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' \
  | sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' \
  | sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' \
  | sed -E "s/^GRANT (.+) ON (.+) \"($SCHEMA_SKIP)\"/-- &/" \
  | sed -E "s/^REVOKE (.+) ON (.+) \"($SCHEMA_SKIP)\"/-- &/" \
  | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\1;/' \
  | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\1;/' \
  | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\1;/' \
  | sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' \
  | sed -E 's/^CREATE POLICY "cron_job_/-- &/' \
  | sed -E 's/^ALTER TABLE "cron"/-- &/' \
  | sed -E 's/^SET transaction_timeout = 0;/-- &/' \
  | sed -E "/^--/d" >"$out/schema.sql"

x_flags=()
for t in auth.schema_migrations storage.migrations supabase_functions.migrations "${DATA_EXCLUDES[@]}"; do
  x_flags+=(--exclude-table "\"${t%%.*}\".\"${t#*.}\"")
done
pg_dump "${CONN[@]}" -w --data-only --quote-all-identifier --role postgres --exclude-schema "$DATA_SKIP" \
  --schema '*' "${x_flags[@]}" \
  | sed -E 's/^\\(un)?restrict .*$/-- &/' >"$out/data.sql"
echo "RESET ALL;" >>"$out/data.sql"

# format(%L) quotes the command exactly as pg_cron stores it. Never printed.
{
  echo "-- cron jobs; db-migrate.sh rewrites the api_base recorded in manifest.txt"
  q -c "SELECT format('SELECT cron.schedule(%L, %L, %L);', jobname, schedule, command) FROM cron.job ORDER BY jobid"
} >"$out/cron.sql"
API_BASE=$(q -c "SELECT (regexp_match(command, 'https?://[^/'']+'))[1] FROM cron.job WHERE command ~ 'https?://' LIMIT 1")
[[ -z $REF ]] && REF=$(sed -nE 's#^https://([a-z0-9]{20})\.supabase\.co$#\1#p' <<<"$API_BASE")

q -c "SELECT table_schema || '.' || table_name,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
       FROM information_schema.tables
       WHERE table_schema IN ('public', 'auth') AND table_type = 'BASE TABLE' ORDER BY 1" >"$out/counts.tsv"

{
  echo "env=$NAME"
  echo "ref=$REF"
  echo "api_base=$API_BASE"
  echo "created_at=$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S') Asia/Taipei"
  echo "pg_dump=$(pg_dump --version)"
  echo "server_version=$(q -c "SELECT current_setting('server_version')")"
  echo "data_excludes=${DATA_EXCLUDES[*]}"
} >"$out/manifest.txt"

for f in roles.sql schema.sql data.sql counts.tsv; do
  [[ -s "$out/$f" ]] || die "$f is empty"
done
grep -q '^COPY "auth"."users"' "$out/data.sql" || die "data.sql has no auth.users"

(cd "$out" && sha256sum roles.sql schema.sql data.sql cron.sql counts.tsv manifest.txt >SHA256SUMS)
chmod 600 "$out"/*
echo "   $(du -sh "$out" | cut -f1)  cron jobs=$(grep -c '^SELECT cron.schedule' "$out/cron.sql" || true)  tables=$(wc -l <"$out/counts.tsv")"
