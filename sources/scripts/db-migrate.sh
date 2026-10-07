#!/usr/bin/env bash
# Operator script: load a db-backup.sh package into another Supabase database —
# a new cloud project (e.g. another region) or a self-hosted stack.
#
# Usage:
#   bash sources/scripts/db-migrate.sh            # interactive: pick the backup, target, cron and Storage choice
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
#   --new-cron-secret       give the cron jobs a newly generated x-cron-secret instead of the source's;
#                           it is written (0600) to docs/dbak/secrets/ for the Edge CRON_SECRET, never printed
#   --exclude <schema.table>  leave this table's rows out (repeatable), e.g. storage.objects when the
#                           Storage files themselves are not being moved: rows without files point at nothing
#   --dry-run               verify the package and the target, print the plan, write nothing
#   --yes                   do not ask for the typed confirmation
#   -i, --interactive       ask for everything (the default when run with no options in a terminal)
#
# Order: checksums → target checks (Supabase schemas present, empty) → one transaction of
# roles + schema + data (triggers off) → cron jobs → row counts compared with counts.tsv.
# The main load is a single transaction: any error leaves the target untouched.
#
# Not covered here (printed at the end): Edge Functions, Edge secrets, Storage files,
# Auth URL settings, Cloudflare Pages env vars, CSP connect-src, verify.sql.
set -euo pipefail

die() { echo "db-migrate: $*" >&2; exit 1; }
say() { echo "db-migrate: $*"; }

FROM= TO=${TARGET_DB_URL:-} CRON_BASE= SKIP_CRON=0 DRY=0 YES=0
USER_EXCLUDES=()
INTERACTIVE=0
NEW_SECRET=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --from) FROM=$2; shift 2 ;;
    --to) TO=$2; shift 2 ;;
    --cron-base-url) CRON_BASE=${2%/}; shift 2 ;;
    --skip-cron) SKIP_CRON=1; shift ;;
    --new-cron-secret) NEW_SECRET=1; shift ;;
    --exclude) USER_EXCLUDES+=("$2"); shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --yes) YES=1; shift ;;
    -i|--interactive) INTERACTIVE=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/{/^set -euo/!p}' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

ask() { # ask <prompt> [default] -> answer on stdout
  local ans
  read -r -p "$1${2:+ [$2]}: " ans </dev/tty
  echo "${ans:-$2}"
}

# Interactive mode: every choice the flags make, asked in turn. The password is read without echo and
# handed to psql through PGPASSWORD, so it never lands in the URL, the shell history or the output.
interactive() {
  echo "== 資料庫移轉（互動模式）；隨時按 Ctrl+C 中止，正式寫入前還會再確認一次"
  echo
  local pkgs=() i=0 m
  # newest first, by the <YYYYMMDD-HHMMSS> folder name across both environments
  while IFS= read -r m; do pkgs+=("$(dirname "$m")"); done < <(
    for m in "$REPO_DIR"/docs/dbak/*/*/manifest.txt; do
      [[ -f $m ]] && echo "$(basename "$(dirname "$m")") $m"
    done | sort -r | cut -d' ' -f2-)
  echo "1) 選擇要還原的備份："
  for p in "${pkgs[@]}"; do
    i=$((i + 1))
    printf '   %d) %-5s %s  (ref %s)\n' "$i" "$(sed -n 's/^env=//p' "$p/manifest.txt")" \
      "$(sed -n 's/^created_at=//p' "$p/manifest.txt")" "$(sed -n 's/^ref=//p' "$p/manifest.txt")"
  done
  local n
  echo "   0) 輸入其他備份資料夾的路徑"
  n=$(ask "   編號" 1)
  if [[ $n == 0 ]]; then
    FROM=$(ask "   路徑")
  else
    [[ $n =~ ^[0-9]+$ && $n -ge 1 && $n -le ${#pkgs[@]} ]] || die "invalid choice: $n"
    FROM=${pkgs[$((n - 1))]}
  fi
  echo

  echo "2) 目標資料庫："
  echo "   1) Supabase cloud（貼上 Dashboard → Connect → Session pooler 的連線字串）"
  echo "   2) 自架 Supabase（逐項輸入主機、帳號）"
  local kind host port user db
  kind=$(ask "   選擇" 1)
  case $kind in
    1)
      TO=$(ask "   連線字串（含 [YOUR-PASSWORD] 也可以）")
      TO=${TO//:\[YOUR-PASSWORD\]@/@}
      ;;
    2)
      host=$(ask "   主機")
      port=$(ask "   port" 5432)
      user=$(ask "   使用者（經 Supavisor 時為 postgres.<POOLER_TENANT_ID>）" postgres)
      db=$(ask "   資料庫" postgres)
      TO="postgresql://$user@$host:$port/$db"
      ;;
    *) die "invalid choice: $kind" ;;
  esac
  [[ -n $TO ]] || die "no target given"
  if [[ ! $TO =~ ://[^/@]+:[^/@]+@ ]]; then
    local pw
    read -r -s -p "   資料庫密碼（不會顯示）: " pw </dev/tty
    echo
    export PGPASSWORD=$pw
  fi
  echo

  local ref default_cron
  ref=$(sed -nE 's#^[a-z]+://postgres\.([a-z0-9]{20})[:@].*#\1#p' <<<"$TO")
  default_cron=${ref:+https://$ref.supabase.co}
  echo "3) 排程（cron）："
  echo "   1) 建立排程，網址改指向新環境${default_cron:+（$default_cron）}"
  echo "   2) 不建立排程（舊環境還在跑時選這個，避免批次重複執行）"
  case $(ask "   選擇" 1) in
    1) CRON_BASE=$(ask "   新環境的 API 網址（自架可用 http://kong:8000）" "$default_cron"); CRON_BASE=${CRON_BASE%/} ;;
    2) SKIP_CRON=1 ;;
    *) die "invalid choice" ;;
  esac
  if [[ $SKIP_CRON == 0 ]]; then
    echo "   排程呼叫 Edge Function 時帶的 CRON_SECRET："
    echo "   1) 沿用備份裡的值（新環境的 Edge secret 要設成同一個值）"
    echo "   2) 產生新的（存到 docs/dbak/secrets/，不會顯示在畫面上）"
    [[ $(ask "   選擇" 1) == 2 ]] && NEW_SECRET=1
  fi
  echo

  echo "4) Storage 檔案本體不在備份裡，只有檔案清單（storage.objects）。"
  if [[ $(ask "   檔案會另外搬過去嗎？(y/N)" N) =~ ^[Yy] ]]; then
    echo "   保留 storage.objects"
  else
    USER_EXCLUDES+=(storage.objects)
    echo "   略過 storage.objects（避免留下指向不存在檔案的紀錄）"
  fi
  echo
}

if [[ ${INTERACTIVE:-0} == 1 || ( -z $FROM && -t 0 ) ]]; then
  interactive
fi

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
# The host the source's cron jobs call. Older packages recorded only the ref.
SRC_API=$(sed -n 's/^api_base=//p' "$FROM/manifest.txt")
[[ -z $SRC_API && -n $SRC_REF ]] && SRC_API="https://$SRC_REF.supabase.co"

REDACTED=$(sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#' <<<"$TO")
TARGET_HOST=$(sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#' <<<"$TO")
# No project is special-cased: the guard against overwriting a live database is the emptiness check
# below (a live project has users), plus the typed confirmation.
if [[ -n $SRC_REF && $TO == *"$SRC_REF"* ]]; then say "WARNING: target looks like the source project itself ($SRC_REF)"; fi

TMP=$(mktemp -d)
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# A login that is not postgres but may become it (the Supabase CLI's temporary cli_login_postgres)
# acts as postgres, so everything it creates is owned by postgres as on the source.
ROLE_ARGS=()
q() { psql "$TO" -X -q -v ON_ERROR_STOP=1 -At -F $'\t' "${ROLE_ARGS[@]}" "$@"; }

# --- target checks -----------------------------------------------------------------------------
say "source  ${SRC_REF:-$SRC_API} ($(sed -n 's/^created_at=//p' "$FROM/manifest.txt"))"
say "target  $REDACTED"
q -c "SELECT 1" >/dev/null || die "cannot connect to the target"
if [[ $(q -c "SELECT current_user <> 'postgres' AND pg_has_role('postgres', 'MEMBER')") == t ]]; then
  ROLE_ARGS=(-c "SET ROLE postgres")
fi
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
# Two queries: a subquery naming a missing table fails at parse time, CASE or not.
txs=0
if [[ $(q -c "SELECT to_regclass('public.transactions') IS NOT NULL") == t ]]; then
  txs=$(q -c "SELECT count(*) FROM public.transactions")
fi
[[ $users == 0 && $txs == 0 ]] || die "target is not empty (auth.users=$users, public.transactions=$txs); load only into a fresh project"

# data.sql COPYs into platform tables too (auth.*, storage.*). A self-host or an older/newer
# Supabase may lack some of them (e.g. storage.vector_indexes); drop those blocks rather than
# fail the whole load. public.* tables are created by schema.sql in the same transaction.
: >"$TMP/skipped"
: >"$TMP/excluded"
for t in "${USER_EXCLUDES[@]}"; do
  grep -q "^COPY \"${t%%.*}\"\.\"${t#*.}\" " "$FROM/data.sql" || die "--exclude $t: no such table in data.sql"
  echo "$t" >>"$TMP/excluded"
done
# Platform tables are loaded only when they hold rows and the target lets postgres write them:
#   - absent on the target                 -> skipped (older/newer Supabase or self-host)
#   - empty in the backup                  -> skipped (nothing to load; several, e.g.
#                                             storage.buckets_vectors, refuse postgres anyway)
#   - rows bound to excluded sessions      -> skipped (auth.mfa_amr_claims: session_id rows of
#                                             sessions that are not carried over)
#   - rows but no INSERT for postgres      -> stop: that would silently lose data
awk '/^COPY "/ { match($0, /^COPY "[^"]+"\."[^"]+"/); t = substr($0, 6, RLENGTH - 5); gsub(/"/, "", t); n = 0; f = 1; next }
     f && $0 == "\\." { print t "\t" n; f = 0; next }
     f { n++ }' "$FROM/data.sql" >"$TMP/rows.tsv"
while IFS=$'\t' read -r tbl rows; do
  schema=${tbl%%.*}
  [[ $schema == public ]] && continue
  grep -qx "$tbl" "$TMP/excluded" && continue
  if [[ $(q -c "SELECT to_regclass('\"$schema\".\"${tbl#*.}\"') IS NOT NULL") != t || $rows == 0 || $tbl == auth.mfa_amr_claims ]]; then
    echo "$tbl" >>"$TMP/skipped"
  elif [[ $(q -c "SELECT has_table_privilege('\"$schema\".\"${tbl#*.}\"', 'INSERT')") != t ]]; then
    die "$tbl has $rows row(s) but the target does not let $(q -c 'SELECT current_user') insert into it; pass --exclude $tbl to leave them out"
  fi
done <"$TMP/rows.tsv"

awk -v skipfile="$TMP/skipped" -v exfile="$TMP/excluded" '
  BEGIN { while ((getline t < skipfile) > 0) skip[t] = 1; while ((getline t < exfile) > 0) skip[t] = 1 }
  /^COPY "/ { match($0, /^COPY "[^"]+"\."[^"]+"/); s = substr($0, 6, RLENGTH - 5); gsub(/"/, "", s); if (s in skip) { dropping = 1; next } }
  dropping { if ($0 == "\\.") dropping = 0; next }
  { print }
' "$FROM/data.sql" >"$TMP/data.sql"

# Grants to Supabase's own roles belong to the platform: the target already has them, and its
# postgres may not re-grant them (GRANT SET ON PARAMETER ... TO supabase_realtime_admin is refused).
# db-backup.sh drops them now; this also cleans packages made before it did.
RESERVED_ROLES='anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin'
sed -E "/^GRANT .* TO \"($RESERVED_ROLES)\"/d" "$FROM/roles.sql" >"$TMP/roles.sql"

# Privileges. pg_dump writes GRANT/REVOKE relative to PostgreSQL's built-in defaults, but a Supabase
# target also has ALTER DEFAULT PRIVILEGES for postgres in public that hand every new table and
# function to anon / authenticated / service_role. Restored as is, a function the source had locked
# down (REVOKE ... FROM anon) would come back callable from the browser. So, after schema.sql: take
# every grant off the restored objects, then replay the backup's own GRANT/REVOKE lines.
# Extension members (pg_net lives in public) are left alone.
SCHEMAS=$( { echo public; sed -nE 's/^CREATE SCHEMA IF NOT EXISTS "([^"]+)".*/\1/p' "$FROM/schema.sql"; } | sort -u | paste -sd, -)
{
  cat <<SQL
DO \$acl\$
DECLARE
  grantees text;
  stmt text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ') INTO grantees
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role');
  grantees := concat_ws(', ', 'PUBLIC', grantees);
  FOR stmt IN
    SELECT format('REVOKE ALL ON FUNCTION %s FROM %s', p.oid::regprocedure, grantees)
      FROM pg_proc p
     WHERE p.pronamespace::regnamespace::text = ANY (string_to_array('$SCHEMAS', ','))
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT format('REVOKE ALL ON %s %s FROM %s', CASE c.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, c.oid::regclass, grantees)
      FROM pg_class c
     WHERE c.relnamespace::regnamespace::text = ANY (string_to_array('$SCHEMAS', ','))
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE stmt;
  END LOOP;
END
\$acl\$;
SQL
  grep -E '^(GRANT|REVOKE) .* ON (TABLE|FUNCTION|SEQUENCE) ' "$FROM/schema.sql"
} >"$TMP/acl.sql"

# --- cron ----------------------------------------------------------------------------------------
if [[ $SKIP_CRON == 0 ]]; then
  if [[ -n $SRC_API ]]; then
    # literal replace (the URL holds regex characters)
    SRC_API="$SRC_API" NEW_API="$CRON_BASE" python3 -c '
import os, sys
sys.stdout.write(sys.stdin.read().replace(os.environ["SRC_API"], os.environ["NEW_API"]))' <"$FROM/cron.sql" >"$TMP/cron.sql"
    ! grep -qF "$SRC_API" <(grep -v '^--' "$TMP/cron.sql") || die "cron.sql still calls $SRC_API after the rewrite"
  else
    cp "$FROM/cron.sql" "$TMP/cron.sql"   # source jobs call no URL
  fi
  if [[ $NEW_SECRET == 1 ]]; then
    SECRET_FILE="$REPO_DIR/docs/dbak/secrets/cron-secret-$(sed -E 's#^[a-z]+://([^:/]+).*#\1#' <<<"$CRON_BASE")-$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S).txt"
    # Every job carries the same secret (schema.sql §6e enforces it); swap that literal for a new one.
    python3 - "$TMP/cron.sql" "$TMP/new-secret" <<'PY' || die "could not replace the cron secret"
import re, secrets, sys
path, out = sys.argv[1], sys.argv[2]
sql = open(path).read()
old = set(re.findall(r"x-cron-secret'', ''([^']+)''", sql))
if len(old) != 1:
    sys.exit("expected exactly one x-cron-secret value, found %d" % len(old))
new = secrets.token_urlsafe(32)
sql = sql.replace("''%s''" % old.pop(), "''%s''" % new)
open(path, "w").write(sql)
open(out, "w").write(new + "\n")
PY
  fi
fi

# --- plan ----------------------------------------------------------------------------------------
echo
say "plan"
echo "  1. one transaction: roles.sql, schema.sql, privileges ($(grep -cE '^(GRANT|REVOKE)' "$TMP/acl.sql") grant lines replayed), data.sql ($(grep -c '^COPY ' "$TMP/data.sql") tables, triggers off)"
if [[ -s $TMP/skipped ]]; then
  echo "     skipped (platform tables: absent, empty or session-bound): $(tr '\n' ' ' <"$TMP/skipped")"
fi
if [[ -s $TMP/excluded ]]; then
  echo "     excluded (--exclude): $(tr '\n' ' ' <"$TMP/excluded")"
fi
if [[ $SKIP_CRON == 0 ]]; then
  echo "  2. $(grep -c '^SELECT cron.schedule' "$TMP/cron.sql") cron jobs, ${SRC_API:-(no URL)} -> $CRON_BASE"
  [[ $NEW_SECRET == 1 ]] && echo "     new x-cron-secret -> ${SECRET_FILE#"$REPO_DIR"/}"
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
  "${ROLE_ARGS[@]}" \
  -f "$TMP/roles.sql" \
  -f "$FROM/schema.sql" \
  -f "$TMP/acl.sql" \
  -c 'SET session_replication_role = replica' \
  -f "$TMP/data.sql" >/dev/null
say "loaded"

if [[ $SKIP_CRON == 0 ]]; then
  q -f "$TMP/cron.sql" >/dev/null
  say "cron jobs on target: $(q -c 'SELECT count(*) FROM cron.job')"
  if [[ $NEW_SECRET == 1 ]]; then
    mkdir -p "$(dirname "$SECRET_FILE")"
    chmod 700 "$(dirname "$SECRET_FILE")"
    install -m 600 "$TMP/new-secret" "$SECRET_FILE"
    say "new CRON_SECRET saved to ${SECRET_FILE#"$REPO_DIR"/} — set it as the Edge secret CRON_SECRET"
  fi
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
  grep -qx "$tbl" "$TMP/skipped" "$TMP/excluded" && continue
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
