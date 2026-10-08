#!/usr/bin/env bash
# Operator script: load a db-backup.sh package into another Supabase database —
# a new cloud project (e.g. another region) or a self-hosted stack.
#
# Usage:
#   bash scripts/db-migrate.sh            # interactive: pick the backup, target, cron and Storage choice
#   export TARGET_DB_URL='postgresql://<user>:<password>@<host>:5432/postgres'   # keeps it out of shell history
#   bash scripts/db-migrate.sh --from backups/prod/<stamp> --dry-run
#   bash scripts/db-migrate.sh --from backups/prod/<stamp> --cron-base-url https://<new-ref>.supabase.co
#
# Target connection string:
#   cloud      Dashboard → Connect → Session pooler (port 5432), user `postgres.<ref>`
#   self-host  postgres on the host's 5432 (behind Supavisor the user is `postgres.<POOLER_TENANT_ID>`),
#              password = POSTGRES_PASSWORD from the stack's .env
#
# Options:
#   --from <dir>            backup package (backups/<env>/<stamp>)
#   --to <url>              target URL; default $TARGET_DB_URL
#   --cron-base-url <url>   rewrite https://<old-ref>.supabase.co in cron jobs to this and install them
#                           (cloud: https://<new-ref>.supabase.co, self-host: http://kong:8000 or the public API URL)
#   --skip-cron             install no cron jobs (e.g. while the old project still runs its own)
#   --new-cron-secret       give the cron jobs a newly generated x-cron-secret instead of the source's;
#                           it is written (0600) to backups/secrets/ for the Edge CRON_SECRET, never printed
#   --exclude <schema.table>  leave this table's rows out (repeatable), e.g. storage.objects when the
#                           Storage files themselves are not being moved: rows without files point at nothing
#   --skip-functions        cloud targets get everything by default: after the load the script deploys
#                           stock-price / stock-report / backup-transactions, sets CRON_SECRET to what the jobs
#                           send, installs the jobs, sets the Auth Site URL / Redirect URLs, and proves each one
#                           (functions ACTIVE, secret digest, one real cron call answering 200). This flag
#                           leaves the functions and CRON_SECRET out.
#   --site-url <url>        Auth Site URL for the target (Redirect URLs are derived from it). Default: copied
#                           from the source project when the token can read it, else asked; empty = untouched.
#   --functions-only        no database work: deploy the functions, set CRON_SECRET and the Auth URLs on a
#                           project whose database is already restored. Takes --ref <ref> plus one secret
#                           source: --from <backup dir> (its cron jobs' value), --secret-file <file> (a value
#                           --new-cron-secret wrote), or --keep-secret.
#   --dry-run               verify the package and the target, print the plan, write nothing
#   --yes                   do not ask for the typed confirmation
#   --force-overwrite       the target already has data: wipe it and load the backup (same transaction,
#                           so a failed load leaves it as it was). Interactive runs ask instead and offer
#                           to back the target up first. Existing Storage buckets/objects are kept.
#                           Every account is deleted. Accounts that are administrators in the backup stay so.
#   --keep-admins           with --force-overwrite: accounts that were administrators on the target
#                           (app_metadata.role = 'admin') get the flag back, matched by email, when the backup
#                           carries the same email. Interactive runs list them and ask instead. Off otherwise:
#                           an email match does not prove it is the same person (anyone can sign up with an
#                           address when email confirmation is off). An admin whose email is not in the backup
#                           is gone either way; the plan lists them before anything is written.
#   -i, --interactive       ask for everything (the default when run with no options in a terminal)
#
# Edge Functions and the Auth URLs need SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens): taken from
# the environment, else asked for. It is checked before anything is written. The Supabase CLI is taken from
# PATH, else `npx supabase@2`, else the official v2.117.0 binary is downloaded (checksum-verified) into
# ~/.cache/stock-pnl-web/. Function sources come from sources/supabase/ whatever the cwd is.
#
# Order: checksums → target checks (Supabase schemas present, empty) and the token / CLI → one transaction
# of roles + schema + data (triggers off) → Edge Functions + CRON_SECRET → cron jobs → Auth URLs → checks
# (row counts against counts.tsv, one real cron call, verify_setup()).
# The main load is a single transaction: any error leaves the target untouched.
#
# Not covered here (printed at the end): Storage files, Cloudflare Pages env vars, CSP connect-src.
# Self-hosted targets: the functions and Auth URLs too. The functions read no secret but CRON_SECRET and
# the platform's own SUPABASE_*.
set -euo pipefail

die() { echo "db-migrate: $*" >&2; exit 1; }
say() { echo "db-migrate: $*"; }

FROM= TO=${TARGET_DB_URL:-} CRON_BASE= SKIP_CRON=0 DRY=0 YES=0
USER_EXCLUDES=()
INTERACTIVE=0
NEW_SECRET=0
FORCE=0
DEPLOY_FUNCTIONS=0 SKIP_FUNCTIONS=0 FUNCTIONS_ONLY=0 ONLY_REF= SECRET_FILE_ARG= KEEP_SECRET=0 SITE_URL=
FUNCTIONS_DEPLOYED=0
KEEP_ADMINS=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --from) FROM=$2; shift 2 ;;
    --to) TO=$2; shift 2 ;;
    --cron-base-url) CRON_BASE=${2%/}; shift 2 ;;
    --skip-cron) SKIP_CRON=1; shift ;;
    --new-cron-secret) NEW_SECRET=1; shift ;;
    --exclude) USER_EXCLUDES+=("$2"); shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --force-overwrite) FORCE=1; shift ;;
    --deploy-functions) shift ;; # the default now; kept so older command lines still parse
    --skip-functions) SKIP_FUNCTIONS=1; shift ;;
    --functions-only) FUNCTIONS_ONLY=1; shift ;;
    --ref) ONLY_REF=${2:-}; shift 2 ;;
    --secret-file) SECRET_FILE_ARG=${2:-}; shift 2 ;;
    --keep-secret) KEEP_SECRET=1; shift ;;
    --site-url) SITE_URL=${2:-}; shift 2 ;;
    --keep-admins) KEEP_ADMINS=1; shift ;;
    --yes) YES=1; shift ;;
    -i|--interactive) INTERACTIVE=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/{/^set -euo/!p}' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

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

# --- Edge Functions, CRON_SECRET and Auth URLs (cloud targets) -----------------------------------------
# All of it goes through the Management API with SUPABASE_ACCESS_TOKEN, never `supabase login`, so it also runs
# in a sandbox or CI. The token reaches curl through a 0600 header file, never a command line.
CLI_VERSION=2.117.0
# slug:extra deploy flags. stock-report and backup-transactions check x-cron-secret themselves; pg_cron calls
# them without a JWT, so verify_jwt must be off (README step 5).
FUNCTIONS=(stock-price: stock-report:--no-verify-jwt backup-transactions:--no-verify-jwt)

api() { # api <method> <path> [json body] -> body on stdout; the HTTP code is read with api_code
  local m=$1 path=$2 body=${3:-}
  local args=(-s -m 30 -X "$m" -H @"$TMP/auth.hdr" -o "$TMP/api.out" -w '%{http_code}')
  [[ -n $body ]] && args+=(-H 'Content-Type: application/json' --data "$body")
  curl "${args[@]}" "https://api.supabase.com/v1$path" >"$TMP/api.code" 2>/dev/null || echo 000 >"$TMP/api.code"
  cat "$TMP/api.out" 2>/dev/null || true
}
api_code() { cat "$TMP/api.code"; }

# edge_token <ref>: SUPABASE_ACCESS_TOKEN from the environment or typed in (`sbuse` sets it without exporting
# it, which is how a PROD restore once skipped the functions silently), then proven able to manage <ref>.
edge_token() {
  if [[ -z ${SUPABASE_ACCESS_TOKEN:-} ]]; then
    { : </dev/tty; } 2>/dev/null \
      || die "Edge Functions 需要 SUPABASE_ACCESS_TOKEN（Dashboard → Account → Access Tokens），或加 --skip-functions；沒有寫入任何東西"
    SUPABASE_ACCESS_TOKEN=$(read_secret "Supabase access token（Dashboard → Account → Access Tokens）: ")
  fi
  export SUPABASE_ACCESS_TOKEN
  (umask 077; printf 'Authorization: Bearer %s\n' "$SUPABASE_ACCESS_TOKEN" >"$TMP/auth.hdr")
  api GET "/projects/$1" >/dev/null
  case $(api_code) in
    200) say "access token 可以管理專案 $1" ;;
    401) die "access token 無效或已撤銷；沒有寫入任何東西" ;;
    403 | 404) die "這個 access token 的帳號不能管理專案 $1（要用擁有該專案的帳號建立）；沒有寫入任何東西" ;;
    *) die "查不到專案 $1（網路或 api.supabase.com 的問題）；沒有寫入任何東西" ;;
  esac
}

# edge_cli: the Supabase CLI on PATH; else `npx supabase@2`; else the official release binary, downloaded once
# into ~/.cache/stock-pnl-web/ and checked against the release's checksums.txt. Each must know every flag the
# deploy uses: an old CLI would otherwise only fail after the database has been written.
cli_ok() {
  "$@" functions deploy --help >"$TMP/cli-help.txt" 2>&1 || return 1
  local f
  for f in --use-api --workdir --no-verify-jwt --project-ref; do grep -q -- "$f" "$TMP/cli-help.txt" || return 1; done
}
download_cli() {
  local os arch name want got dir="${XDG_CACHE_HOME:-$HOME/.cache}/stock-pnl-web/supabase-$CLI_VERSION"
  case $(uname -s) in Linux) os=linux ;; Darwin) os=darwin ;; *) return 1 ;; esac
  case $(uname -m) in x86_64 | amd64) arch=amd64 ;; aarch64 | arm64) arch=arm64 ;; *) return 1 ;; esac
  if [[ ! -x $dir/supabase ]]; then
    name="supabase_${CLI_VERSION}_${os}_${arch}.tar.gz"
    say "下載 Supabase CLI v$CLI_VERSION（$os/$arch）..." >&2
    curl -fsSL -m 120 -o "$TMP/$name" "https://github.com/supabase/cli/releases/download/v$CLI_VERSION/$name" || return 1
    curl -fsSL -m 30 -o "$TMP/checksums.txt" "https://github.com/supabase/cli/releases/download/v$CLI_VERSION/checksums.txt" || return 1
    want=$(awk -v n="$name" '$2 == n { print $1 }' "$TMP/checksums.txt")
    got=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$TMP/$name")
    [[ -n $want && $want == "$got" ]] || { echo "db-migrate: checksum mismatch for $name" >&2; return 1; }
    mkdir -p "$dir"
    tar -xzf "$TMP/$name" -C "$dir" supabase
  fi
  echo "$dir/supabase"
}
SB=()
edge_cli() {
  local bin
  [[ -f $REPO_DIR/sources/supabase/functions/stock-report/index.ts ]] || die "function sources not found under $REPO_DIR/sources/supabase/functions"
  if command -v supabase >/dev/null && cli_ok supabase; then
    SB=(supabase)
  elif command -v npx >/dev/null && cli_ok npx --yes supabase@2; then
    SB=(npx --yes supabase@2)
  elif bin=$(download_cli) && cli_ok "$bin"; then
    SB=("$bin")
  else
    die "找不到可用的 Supabase CLI：PATH 上沒有（或版本太舊）、沒有 Node.js 的 npx，下載官方執行檔也失敗；沒有寫入任何東西"
  fi
  say "Supabase CLI：${SB[*]}（$("${SB[@]}" --version 2>/dev/null | tail -1)）"
}

# secret_env <file> <cron.sql|plain>: the one CRON_SECRET into $TMP/secrets.env (0600) and its sha256 into
# SECRET_SHA. Only the hash is ever printed.
SECRET_SHA=
secret_env() {
  (umask 077; python3 -I - "$1" "$2" "$TMP/secrets.env" <<'PY') || return 1
import re, sys
src, kind, out = sys.argv[1:]
text = open(src).read()
if kind == "cron.sql":
    found = set(re.findall(r"x-cron-secret'', ''([^']+)''", text))
else:
    found = {text.strip()} if text.strip() and not re.search(r"\s", text.strip()) else set()
if len(found) != 1:
    sys.exit("expected exactly one CRON_SECRET value, found %d" % len(found))
open(out, "w").write("CRON_SECRET=%s\n" % found.pop())
PY
  SECRET_SHA=$(python3 -I -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1]).read().strip().split("=",1)[1].encode()).hexdigest())' "$TMP/secrets.env")
}

# edge_deploy <ref>: deploy the three functions, set CRON_SECRET when $TMP/secrets.env exists, then prove it:
# each function ACTIVE with the right verify_jwt and answering (2xx/4xx, not 404/5xx), and the Edge secret's
# digest equal to SECRET_SHA. Runs after the database load, so it reports and returns 1 instead of ending the
# script. Sources come from --workdir, so the cwd does not matter; --use-api bundles server-side (no Docker).
edge_deploy() {
  local ref=$1 spec fn flags want got code i bad=0
  say "部署 Edge Functions 到 $ref ..."
  for spec in "${FUNCTIONS[@]}"; do
    fn=${spec%%:*} flags=${spec#*:}
    # shellcheck disable=SC2086
    if ! "${SB[@]}" functions deploy "$fn" $flags --use-api --project-ref "$ref" --workdir "$REPO_DIR/sources" >"$TMP/deploy-$fn.log" 2>&1; then
      tail -5 "$TMP/deploy-$fn.log" | sed 's/^/     /' >&2
      echo "   ✗ 部署 $fn 失敗" >&2
      return 1
    fi
    echo "   ✓ 已部署 $fn"
  done
  if [[ -s $TMP/secrets.env ]]; then
    if ! "${SB[@]}" secrets set --env-file "$TMP/secrets.env" --project-ref "$ref" --workdir "$REPO_DIR/sources" >"$TMP/secrets.log" 2>&1; then
      tail -3 "$TMP/secrets.log" | sed 's/^/     /' >&2
      echo "   ✗ 設定 CRON_SECRET 失敗" >&2
      return 1
    fi
    echo "   ✓ 已設定 CRON_SECRET（值不顯示）"
  fi
  "${SB[@]}" functions list --project-ref "$ref" --workdir "$REPO_DIR/sources" --output json >"$TMP/list.json" 2>/dev/null || { echo "   ✗ functions list 失敗" >&2; return 1; }
  for spec in "${FUNCTIONS[@]}"; do
    fn=${spec%%:*} flags=${spec#*:}
    want=true; [[ $flags == *--no-verify-jwt* ]] && want=false
    got=$(python3 -I -c 'import json,sys; f=[x for x in json.load(open(sys.argv[1])) if x["slug"]==sys.argv[2]]; print(f[0]["status"], str(f[0]["verify_jwt"]).lower()) if f else print("missing")' "$TMP/list.json" "$fn")
    if [[ $got == "ACTIVE $want" ]]; then echo "   ✓ $fn ACTIVE，verify_jwt=$want"; else echo "   ✗ $fn：$got（要 ACTIVE $want）" >&2; bad=1; fi
    # Up = the platform routes to a running function: 2xx/4xx without a login. 404 none, 5xx no boot, 000 no answer.
    code=000
    for i in 1 2 3 4 5; do
      code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "https://$ref.supabase.co/functions/v1/$fn" || true)
      [[ $code =~ ^[24][0-9][0-9]$ && $code != 404 ]] && break
      sleep 2
    done
    if [[ $code =~ ^[24][0-9][0-9]$ && $code != 404 ]]; then echo "   ✓ $fn 有回應（未登入呼叫回 HTTP $code）"; else echo "   ✗ $fn 回 HTTP $code（404 不存在、5xx 啟動失敗、000 沒有回應）" >&2; bad=1; fi
  done
  if [[ -n $SECRET_SHA ]]; then
    "${SB[@]}" secrets list --project-ref "$ref" --workdir "$REPO_DIR/sources" --output json >"$TMP/secrets.json" 2>/dev/null || { echo "   ✗ secrets list 失敗" >&2; return 1; }
    got=$(python3 -I -c 'import json,sys; print(next((s["value"] for s in json.load(open(sys.argv[1])) if s["name"]=="CRON_SECRET"), ""))' "$TMP/secrets.json")
    if [[ $got == "$SECRET_SHA" ]]; then echo "   ✓ Edge 的 CRON_SECRET 摘要 = ${SECRET_SHA:0:16}…（和排程送的值相同）"; else echo "   ✗ Edge 的 CRON_SECRET 摘要 ${got:0:16}… ≠ 排程的 ${SECRET_SHA:0:16}…" >&2; bad=1; fi
  fi
  [[ $bad == 0 ]] || return 1
  FUNCTIONS_DEPLOYED=1
}

# auth_plan <target ref>: the Site URL and Redirect URLs the target should get, into AUTH_SITE / AUTH_ALLOW. They
# live in the project's Auth config, not in the database, so a backup does not carry them (a restored PROD once
# kept the new project's http://localhost:3000 and sent password-reset mail there). Source, in order: --site-url;
# the source project's own config when this token can read it; asked for. Empty = leave the target as it is.
AUTH_SITE= AUTH_ALLOW= AUTH_DONE=0
auth_plan() {
  local cur host
  if [[ -z $SITE_URL && -n ${SRC_REF:-} && ${SRC_REF:-} != "$1" ]]; then
    cur=$(api GET "/projects/$SRC_REF/config/auth")
    if [[ $(api_code) == 200 ]]; then
      AUTH_SITE=$(python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("site_url") or "")' <<<"$cur")
      AUTH_ALLOW=$(python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("uri_allow_list") or "")' <<<"$cur")
      [[ -n $AUTH_SITE ]] && say "Auth URL：沿用來源專案 $SRC_REF 的設定（$AUTH_SITE）"
    fi
  fi
  if [[ -z $AUTH_SITE && -z $SITE_URL && $YES == 0 ]] && { : </dev/tty; } 2>/dev/null; then
    SITE_URL=$(ask "前端網址（Auth 的 Site URL，例如 https://stock-pnl-web.pages.dev/；Enter 略過）")
  fi
  if [[ -z $AUTH_SITE && -n $SITE_URL ]]; then
    [[ $SITE_URL =~ ^https?://[^/]+ ]] || die "--site-url 不是網址：$SITE_URL"
    AUTH_SITE=${SITE_URL%/}/
    # the site, its preview deployments (Cloudflare Pages: <hash>.<project>.pages.dev) and local dev ports
    host=${AUTH_SITE#*://}
    host=${host%%/*}
    AUTH_ALLOW=$(printf '%s\n' "${AUTH_SITE}**" "${AUTH_SITE%%://*}://*.$host/**" http://localhost:5173/** http://localhost:5174/** http://localhost:5175/** \
      | awk '!seen[$0]++' | paste -sd, -)
  fi
  return 0
}
# auth_apply <ref>: write AUTH_SITE / AUTH_ALLOW, then read them back.
auth_apply() {
  local body got
  [[ -n $AUTH_SITE ]] || return 0
  body=$(python3 -I -c 'import json,sys; print(json.dumps({"site_url": sys.argv[1], "uri_allow_list": sys.argv[2]}))' "$AUTH_SITE" "$AUTH_ALLOW")
  api PATCH "/projects/$1/config/auth" "$body" >/dev/null
  [[ $(api_code) == 200 ]] || { echo "   ✗ 設定 Auth URL 失敗（HTTP $(api_code)）" >&2; return 1; }
  got=$(api GET "/projects/$1/config/auth" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d.get("site_url"), d.get("uri_allow_list"))')
  if [[ $got == "$AUTH_SITE $AUTH_ALLOW" ]]; then
    echo "   ✓ Auth Site URL = $AUTH_SITE；Redirect URLs $(tr ',' '\n' <<<"$AUTH_ALLOW" | wc -l | tr -d ' ') 條"
    AUTH_DONE=1
  else
    echo "   ✗ Auth URL 回讀不符：$got" >&2
    return 1
  fi
}

# cron_probe: run one cron job's own command now and wait for its HTTP answer, the only proof that the secret
# the jobs send is the one the Edge Function accepts (401 = mismatch). fx-daily only refreshes exchange rates.
CRON_PROBE=
cron_probe() {
  local id code i
  [[ $(q -c "SELECT count(*) FROM cron.job WHERE jobname = 'fx-daily'") == 1 ]] || { CRON_PROBE="略過（沒有 fx-daily）"; return 0; }
  id=$(q -c "SELECT coalesce(max(id), 0) FROM net._http_response")
  q -c "DO \$p\$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'fx-daily'); END \$p\$" >/dev/null
  for i in $(seq 1 30); do
    code=$(q -c "SELECT status_code FROM net._http_response WHERE id > $id ORDER BY id LIMIT 1")
    [[ -n $code ]] && break
    sleep 2
  done
  case $code in
    200) CRON_PROBE="✓ 排程 fx-daily 實際呼叫 Edge 回 HTTP 200（排程密鑰與 CRON_SECRET 相符）"; echo "   $CRON_PROBE" ;;
    401) CRON_PROBE="✗ 排程 fx-daily 實際呼叫 Edge 回 HTTP 401：排程密鑰與 Edge 的 CRON_SECRET 不符"; echo "   $CRON_PROBE" >&2; return 1 ;;
    "") CRON_PROBE="✗ 排程 fx-daily 60 秒內沒有回應"; echo "   $CRON_PROBE" >&2; return 1 ;;
    *) CRON_PROBE="✗ 排程 fx-daily 實際呼叫 Edge 回 HTTP $code"; echo "   $CRON_PROBE" >&2; return 1 ;;
  esac
}

BLOCKED_MSG="Supabase 因為短時間內多次密碼錯誤，暫時封鎖了這個專案來自這台電腦的新連線（ECIRCUITBREAKER）。請等 5–10 分鐘再執行，並確認輸入的是「資料庫密碼」"

# Interactive mode: every choice the flags make, asked in turn. The password is read without echo and
# handed to psql through PGPASSWORD, so it never lands in the URL, the shell history or the output.
interactive() {
  echo "== 資料庫移轉（互動模式）；隨時按 Ctrl+C 中止，正式寫入前還會再確認一次"
  echo
  local pkgs=() i=0 m
  # newest first, by the <YYYYMMDD-HHMMSS> folder name across both environments
  while IFS= read -r m; do pkgs+=("$(dirname "$m")"); done < <(
    for m in "$REPO_DIR"/backups/*/*/manifest.txt; do
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

  echo "2) 目標資料庫（要把資料寫進去的新環境；它必須是空的，還沒執行過 schema.sql）"
  echo "   1) Supabase cloud"
  echo "   2) 自架 Supabase"
  local kind host port user db ref="" url
  while :; do
    kind=$(ask "   選擇" 1)
    [[ $kind == 1 || $kind == 2 ]] && break
    echo "   請輸入 1 或 2"
  done
  if [[ $kind == 1 ]]; then
    echo
    echo "   a. 新專案的網址：Dashboard → Project Settings → Data API 的 Project URL"
    while :; do
      url=$(ask "      Project URL（例如 https://abcdefghijklmnopqrst.supabase.co）")
      ref=$(sed -nE 's#^https?://([a-z0-9]{20})\.supabase\.co/?$#\1#p' <<<"$url")
      [[ -n $ref ]] && break
      echo "      格式不對：要長得像 https://<20 個英數字>.supabase.co"
    done
  fi

  # Connection string (or self-host fields), then the password. A wrong password asks for the password
  # again; a host that cannot be reached goes back to the connection string, since retyping the
  # password cannot fix it.
  local pw tries err
  while :; do
    echo
    if [[ $kind == 1 && -z ${TRIED_AUTO:-} ]]; then
      TRIED_AUTO=1
      local res st
      tries=0
      while :; do
        pw=$(read_secret "   b. 資料庫密碼（建專案時設定的那組，不是 Supabase 帳號密碼）: ")
        export PGPASSWORD=$pw
        if [[ -z ${host:-} ]]; then
          echo "      連線中（同時試各區域，找出這個專案的資料庫位址，通常幾秒內）..."
          res=$(find_pooler "$ref")
          host=${res%% *}
          st=${res#* }
        else
          st=$(probe "postgresql://postgres.$ref@$host:5432/postgres")
        fi
        case ${res:+$st} in
          ok)
            TO="postgresql://postgres.$ref@$host:5432/postgres"
            echo "      連線成功（$host）"
            break 2
            ;;
          badpw)
            tries=$((tries + 1))
            echo "      密碼不對（專案在 $host）。忘了可到 Project Settings → Database → Reset database password，約 1–2 分鐘後生效。"
            [[ $tries -lt 3 ]] || die "the target refused the password 3 times"
            ;;
          blocked) die "$BLOCKED_MSG" ;;
          *)
            echo "      找不到這個專案的連線位址，改用手動貼上連線字串。"
            host=""
            break
            ;;
        esac
      done
    fi
    if [[ $kind == 1 && -z ${host:-} ]]; then
      echo "   b. 資料庫連線字串：Dashboard → 上方「Connect」→ 選「Session pooler」那一欄 → 複製 URI"
      echo "      正確的長相：postgresql://postgres.$ref:[YOUR-PASSWORD]@aws-…-<區域>.pooler.supabase.com:5432/postgres"
      while :; do
        TO=$(ask "      連線字串（裡面的 [YOUR-PASSWORD] 不用改，下一步再輸入密碼）")
        TO=${TO//:\[YOUR-PASSWORD\]@/@}
        if [[ ! $TO =~ ^postgres(ql)?:// ]]; then
          echo "      這不是連線字串：要以 postgresql:// 開頭（你可能貼成了 Project URL）"
        elif [[ $TO != *"$ref"* ]]; then
          echo "      這條連線字串不是專案 $ref 的，請確認是同一個專案"
        elif [[ $TO =~ @db\.[a-z0-9]{20}\.supabase\.co ]]; then
          echo "      這是「Direct connection」（主機 db.$ref.supabase.co）：它只走 IPv6，多數家用 / 公司網路連不到。"
          echo "      請在 Connect 視窗改選「Session pooler」，主機會是 aws-…pooler.supabase.com、使用者是 postgres.$ref"
        elif [[ $TO =~ :6543/ ]]; then
          echo "      這是「Transaction pooler」（port 6543），備份還原需要 Session pooler（port 5432）"
        else
          break
        fi
      done
    elif [[ $kind == 2 ]]; then
      echo "   自架 stack 的資料庫（docker 的 .env 裡有 POSTGRES_PASSWORD / POOLER_TENANT_ID）"
      while :; do host=$(ask "      主機（IP 或網域）"); [[ -n $host ]] && break; done
      port=$(ask "      port" 5432)
      user=$(ask "      使用者（經 Supavisor 時為 postgres.<POOLER_TENANT_ID>）" postgres)
      db=$(ask "      資料庫" postgres)
      TO="postgresql://$user@$host:$port/$db"
    fi

    if [[ $TO =~ ://[^/@]+:[^/@]+@ ]]; then
      unset PGPASSWORD # the password is inside the URL
    fi
    tries=0
    while :; do
      if [[ ! $TO =~ ://[^/@]+:[^/@]+@ ]]; then
        pw=$(read_secret "   資料庫密碼（建專案時設定的那組）: ")
        export PGPASSWORD=$pw
      fi
      if psql "$TO" -w -X -q -At -c "SELECT 1" >/dev/null 2>"$TMP/conn.err"; then
        echo "   連線成功"
        break 2
      fi
      err=$(grep -m1 -E 'FATAL|error' "$TMP/conn.err" | sed -E 's/.*FATAL: +//; s/^psql: error: //')
      echo "   連不上：$err"
      if grep -q 'password authentication failed' "$TMP/conn.err" && [[ ! $TO =~ ://[^/@]+:[^/@]+@ ]]; then
        tries=$((tries + 1))
        echo "   → 資料庫拒絕這組密碼。這裡要的是「資料庫密碼」（建專案時設定的），不是 Supabase 帳號的登入密碼；"
        echo "     忘了可到 Project Settings → Database → Reset database password，重設後約等 1–2 分鐘再試。"
        [[ $tries -lt 3 ]] || die "the target refused the password 3 times"
        continue
      fi
      if grep -qE 'ECIRCUITBREAKER|too many authentication' "$TMP/conn.err"; then
        die "$BLOCKED_MSG"
      fi
      if grep -qiE 'tenant or user not found' "$TMP/conn.err"; then
        echo "   → 找不到這個專案：請到 Connect → Session pooler 重新複製連線字串（主機的區域要和專案相同）。"
      elif grep -qiE 'unreachable|timeout|timed out|could not translate|refused' "$TMP/conn.err"; then
        echo "   → 連不到資料庫主機（不是密碼的問題）。cloud 請改用 Session pooler 的連線字串；自架請確認主機與 port。"
      fi
      echo "   請重新輸入連線資訊："
      host=""
      continue 2
    done
  done
  echo

  local default_cron
  [[ -z $ref ]] && ref=$(sed -nE 's#^[a-z]+://postgres\.([a-z0-9]{20})[:@].*#\1#p' <<<"$TO")
  default_cron=${ref:+https://$ref.supabase.co}
  echo "3) 排程（cron）：備份裡有 12 個左右的定時工作（盤後抓資料、備份、推播），它們會呼叫 Edge Function"
  echo "   1) 建立排程，並改成呼叫新環境${default_cron:+（$default_cron）}"
  echo "   2) 先不建立（舊環境還在運作時選這個，避免兩邊同時跑批次）"
  local c
  while :; do c=$(ask "   選擇" 1); [[ $c == 1 || $c == 2 ]] && break; echo "   請輸入 1 或 2"; done
  if [[ $c == 1 ]]; then
    if [[ -n $default_cron ]]; then
      CRON_BASE=$default_cron
    else
      while :; do
        CRON_BASE=$(ask "   新環境的 API 網址（自架可用 http://kong:8000 或對外網址）")
        CRON_BASE=${CRON_BASE%/}
        [[ $CRON_BASE =~ ^https?://[^/]+$ ]] && break
        echo "   格式不對：例如 https://api.example.com 或 http://kong:8000"
      done
    fi
    echo
    echo "   排程呼叫 Edge Function 時會帶一組密鑰（CRON_SECRET），新環境的 Edge secret 要設成同一個值："
    echo "   1) 沿用備份裡的值"
    echo "   2) 產生新的（存到 backups/secrets/，不顯示在畫面上；之後貼進 Dashboard → Edge Functions → Secrets）"
    [[ $(ask "   選擇" 1) == 2 ]] && NEW_SECRET=1
  else
    SKIP_CRON=1
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

  if [[ -n $ref ]]; then
    echo "5) 寫入資料庫後會一併部署三個 Edge Functions、設定 CRON_SECRET 與 Auth 網址，並逐項驗證"
    echo "   （需要 Supabase access token；環境變數裡沒有的話，下一步會請你輸入）"
    [[ $(ask "   要這樣做嗎？(Y/n)" Y) =~ ^[Nn] ]] && SKIP_FUNCTIONS=1
    echo
  fi
}

TMP=$(mktemp -d)
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# --- --functions-only: Edge Functions, CRON_SECRET and Auth URLs on a project whose database is already in place
pick() { # pick <prompt> <item...> -> the chosen item on stdout
  local p=$1 n; shift
  n=$(ask "$p" 1)
  [[ $n =~ ^[0-9]+$ && $n -ge 1 && $n -le $# ]] || die "沒有這個選項：$n"
  echo "${!n}"
}
if [[ $FUNCTIONS_ONLY == 1 ]]; then
  TTY=0; { : </dev/tty; } 2>/dev/null && TTY=1
  ref=${ONLY_REF:-$(sed -nE 's#^[a-z]+://postgres\.([a-z0-9]{20})[:@].*#\1#p' <<<"$TO")}
  if [[ -z $ref && $TTY == 1 ]]; then
    ref=$(ask "專案 ref（Dashboard 網址 /project/<ref>，或 https://<ref>.supabase.co）")
  fi
  ref=${ref#https://}
  ref=${ref%%.supabase.co*}
  [[ $ref =~ ^[a-z]{20}$ ]] || die "--functions-only needs --ref <project ref> (20 lowercase letters), got: ${ref:-nothing}"
  sources=$(( (${#FROM} > 0) + (${#SECRET_FILE_ARG} > 0) + KEEP_SECRET ))
  [[ $sources -le 1 ]] || die "pass only one of --from / --secret-file / --keep-secret"
  if [[ $sources == 0 ]]; then
    [[ $TTY == 1 ]] || die "--functions-only needs --from <backup dir>, --secret-file <file> or --keep-secret"
    echo "CRON_SECRET 要設成目標排程帶的那個值："
    echo "  1) 從還原用的備份取（還原時選了「沿用備份裡的值」）"
    echo "  2) 從 backups/secrets/ 的檔案取（還原時產生了新密鑰）"
    echo "  3) 不動 CRON_SECRET"
    case $(ask "選擇" 1) in
      1)
        pkgs=() # no mapfile: macOS ships bash 3.2
        while IFS= read -r d; do pkgs+=("$d"); done < <(for m in "$REPO_DIR"/backups/*/*/cron.sql; do
          [[ -f $m ]] && echo "$(basename "$(dirname "$m")") $(dirname "$m")"; done | sort -r | cut -d' ' -f2-)
        [[ ${#pkgs[@]} -gt 0 ]] || die "backups/ 底下沒有含 cron.sql 的備份"
        for i in "${!pkgs[@]}"; do echo "  $((i + 1))) ${pkgs[$i]#"$REPO_DIR"/}"; done
        FROM=$(pick "備份" "${pkgs[@]}") ;;
      2)
        files=()
        while IFS= read -r d; do files+=("$d"); done < <(ls -1t "$REPO_DIR"/backups/secrets/cron-secret-*.txt 2>/dev/null)
        [[ ${#files[@]} -gt 0 ]] || die "backups/secrets/ 底下沒有 cron-secret-*.txt"
        for i in "${!files[@]}"; do echo "  $((i + 1))) ${files[$i]#"$REPO_DIR"/}"; done
        SECRET_FILE_ARG=$(pick "檔案" "${files[@]}") ;;
      3) KEEP_SECRET=1 ;;
      *) die "沒有這個選項" ;;
    esac
  fi
  SRC_REF=
  if [[ -n $FROM ]]; then
    [[ -f $FROM/cron.sql ]] || die "$FROM/cron.sql not found"
    SRC_REF=$(sed -n 's/^ref=//p' "$FROM/manifest.txt" 2>/dev/null || true)
    secret_env "$FROM/cron.sql" cron.sql || die "備份的排程裡 x-cron-secret 不是恰好一個值"
  elif [[ -n $SECRET_FILE_ARG ]]; then
    [[ -f $SECRET_FILE_ARG ]] || die "$SECRET_FILE_ARG not found"
    secret_env "$SECRET_FILE_ARG" plain || die "密鑰檔是空的或含有空白"
  fi
  [[ -n $SECRET_SHA ]] && say "CRON_SECRET 來源：${FROM:-$SECRET_FILE_ARG}（sha256 ${SECRET_SHA:0:16}…；目標排程送的值也要是這個雜湊）"
  edge_token "$ref"
  edge_cli
  auth_plan "$ref"
  if [[ $DRY == 1 ]]; then
    say "--dry-run：權杖、CLI、密鑰${AUTH_SITE:+、Auth 網址（$AUTH_SITE）}都檢查過了，沒有寫入任何東西"
    exit 0
  fi
  rc=0
  edge_deploy "$ref" || rc=1
  [[ -n $AUTH_SITE ]] && { auth_apply "$ref" || rc=1; }
  [[ $rc == 0 ]] && say "完成。排程是否通過驗證：下一輪排程後 net._http_response 應為 200（verify_setup() 的 cron http 一項）"
  exit $rc
fi

if [[ ${INTERACTIVE:-0} == 1 || -z $FROM ]]; then
  # Interactive prompts read the keyboard from /dev/tty; without a terminal (an IDE "run" pane, a
  # `!` shell in an agent session, a pipe) there is nothing to type into.
  { : </dev/tty; } 2>/dev/null || die "no terminal to ask in: run it in a real terminal window, or pass --from / --to (see --help)"
fi
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
TARGET_REF=$(sed -nE 's#^[a-z]+://postgres\.([a-z0-9]{20})[:@].*#\1#p' <<<"$TO")
# No project is special-cased: the guard against overwriting a live database is the emptiness check
# below (a live project has users), plus the typed confirmation.
if [[ -n $SRC_REF && $TO == *"$SRC_REF"* ]]; then say "注意：目標看起來就是來源專案本身（$SRC_REF）"; fi


# A login that is not postgres but may become it (the Supabase CLI's temporary cli_login_postgres)
# acts as postgres, so everything it creates is owned by postgres as on the source.
ROLE_ARGS=()
q() { psql "$TO" -w -X -q -v ON_ERROR_STOP=1 -At -F $'\t' "${ROLE_ARGS[@]}" "$@"; }

# --- target checks -----------------------------------------------------------------------------
say "來源備份  ${SRC_REF:-$SRC_API}（$(sed -n 's/^created_at=//p' "$FROM/manifest.txt")）"
say "目標資料庫  $REDACTED"
q -c "SELECT 1" >/dev/null || die "cannot connect to the target"
if [[ $(q -c "SELECT current_user <> 'postgres' AND pg_has_role('postgres', 'MEMBER')") == t ]]; then
  ROLE_ARGS=(-c "SET ROLE postgres")
fi
say "目標版本  PostgreSQL $(q -c "SELECT current_setting('server_version')")，以 $(q -c "SELECT current_user") 身分寫入"

# Edge Functions preflight: everything that could make the deploy impossible is checked now, while the
# target is still untouched, so a missing token or CLI cannot surface after the database has been overwritten.
[[ -n $TARGET_REF && $SKIP_FUNCTIONS == 0 ]] && DEPLOY_FUNCTIONS=1
if [[ $DEPLOY_FUNCTIONS == 1 ]]; then
  edge_token "$TARGET_REF"
  edge_cli
  auth_plan "$TARGET_REF"
elif [[ -z $TARGET_REF ]]; then
  say "目標不是 Supabase cloud（使用者不是 postgres.<ref>）：Edge Functions 與 Auth 網址要手動設定，結尾會列出"
fi

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
if [[ $users != 0 || $txs != 0 ]]; then
  if [[ $FORCE == 0 ]]; then
    { : </dev/tty; } 2>/dev/null || die "目標不是空的（帳號 $users 個、交易 $txs 筆）。要覆蓋請加 --force-overwrite"
    echo
    echo "  ⚠️  目標資料庫已經有資料：帳號 $users 個、交易 $txs 筆。"
    echo "     強制覆蓋會先刪除目標上「這份備份涵蓋的一切」：public 的所有表格與資料、函數、排程、"
    echo "     所有帳號（auth.users），再寫入備份。目標現有的 Storage bucket 與檔案清單會保留。"
    echo "     清空與寫入在同一個交易裡：途中出錯，目標會維持原樣。"
    while :; do
      answer=$(ask "  要強制覆蓋嗎？輸入 overwrite 繼續，直接 Enter 取消")
      case $answer in
        overwrite) FORCE=1; break ;;
        "") die "已取消，沒有寫入任何東西" ;;
        *) echo "  請輸入 overwrite，或直接 Enter 取消" ;;
      esac
    done
    if [[ ! $(ask "  覆蓋前要先備份目標現在的資料嗎？(Y/n)" Y) =~ ^[Nn] ]]; then
      echo "  備份目標中（存到 backups/${TARGET_REF:-target}-before-overwrite/）..."
      SOURCE_DB_URL=$TO bash "$REPO_DIR/scripts/db-backup.sh" --name "${TARGET_REF:-target}-before-overwrite" </dev/null \
        || die "目標備份失敗，已停止，沒有寫入任何東西"
    fi
  fi
  say "目標已有資料，將清空後覆蓋（帳號 $users 個、交易 $txs 筆）"
fi

# data.sql COPYs into platform tables too (auth.*, storage.*). A self-host or an older/newer
# Supabase may lack some of them (e.g. storage.vector_indexes); drop those blocks rather than
# fail the whole load. public.* tables are created by schema.sql in the same transaction.
: >"$TMP/skipped"
: >"$TMP/excluded"
: >"$TMP/kept"
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
  # Overwrite keeps the target's Storage: its rows would collide with the backup's (same bucket ids),
  # and deleting storage.objects rows would orphan files the Storage API still holds.
  if [[ $FORCE == 1 && $schema == storage && $(q -c "SELECT count(*) > 0 FROM \"$schema\".\"${tbl#*.}\"") == t ]]; then
    echo "$tbl" >>"$TMP/kept"
    continue
  fi
  if [[ $(q -c "SELECT to_regclass('\"$schema\".\"${tbl#*.}\"') IS NOT NULL") != t || $rows == 0 || $tbl == auth.mfa_amr_claims ]]; then
    echo "$tbl" >>"$TMP/skipped"
  elif [[ $(q -c "SELECT has_table_privilege('\"$schema\".\"${tbl#*.}\"', 'INSERT')") != t ]]; then
    die "$tbl has $rows row(s) but the target does not let $(q -c 'SELECT current_user') insert into it; pass --exclude $tbl to leave them out"
  fi
done <"$TMP/rows.tsv"

awk -v skipfile="$TMP/skipped" -v exfile="$TMP/excluded" -v keptfile="$TMP/kept" '
  BEGIN { while ((getline t < skipfile) > 0) skip[t] = 1; while ((getline t < exfile) > 0) skip[t] = 1
          while ((getline t < keptfile) > 0) skip[t] = 1 }
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

# Overwrite: remove what the backup is about to recreate, inside the load transaction. Objects of the
# restored schemas (tables cascade to their views, policies, triggers and FKs), then functions, standalone
# sequences and types; extension members (pg_net lives in public) are left alone. Every account goes
# (identities, sessions and MFA rows cascade), and every cron job: cron.sql brings the backup's set.
: >"$TMP/wipe.sql"
if [[ $FORCE == 1 ]]; then
  cat >"$TMP/wipe.sql" <<SQL
DO \$wipe\$
DECLARE
  stmt text;
  sch text[] := string_to_array('$SCHEMAS', ',');
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job;
  FOR stmt IN
    SELECT format('DROP %s IF EXISTS %s CASCADE',
                  CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                                 WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, c.oid::regclass)
      FROM pg_class c
     WHERE c.relnamespace::regnamespace::text = ANY (sch) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE stmt; END LOOP;
  FOR stmt IN
    SELECT format('DROP %s IF EXISTS %s CASCADE',
                  CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END, p.oid::regprocedure)
      FROM pg_proc p
     WHERE p.pronamespace::regnamespace::text = ANY (sch)
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       -- Functions behind event triggers belong to the platform (Supabase's ensure_rls runs
       -- public.rls_auto_enable()); dropping one cascades to the trigger, which pg_dump never restores.
       AND p.oid NOT IN (SELECT evtfoid FROM pg_event_trigger)
  LOOP EXECUTE stmt; END LOOP;
  FOR stmt IN
    SELECT format('DROP SEQUENCE IF EXISTS %s CASCADE', c.oid::regclass)
      FROM pg_class c
     WHERE c.relnamespace::regnamespace::text = ANY (sch) AND c.relkind = 'S'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('e', 'a', 'i'))
  LOOP EXECUTE stmt; END LOOP;
  FOR stmt IN
    SELECT format('DROP %s IF EXISTS %s CASCADE', CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, t.oid::regtype)
      FROM pg_type t
     WHERE t.typnamespace::regnamespace::text = ANY (sch) AND t.typtype IN ('e', 'd', 'c', 'r')
       AND (t.typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  LOOP EXECUTE stmt; END LOOP;
  DELETE FROM auth.users;
END
\$wipe\$;
SQL
fi

# Overwrite deletes every account, and the administrator flag lives on the account (auth.users
# raw_app_meta_data.role). Remember who was an administrator on the target and set the flag again inside
# the load transaction. Matched by email: user ids differ between projects. The source's own
# administrators keep theirs, it rides in data.sql. An administrator whose email the backup does not
# carry cannot come back (the account itself is gone), so the plan lists them before anything is written.
: >"$TMP/admins.list"
: >"$TMP/admins.lost"
: >"$TMP/admins.kept"
: >"$TMP/keep-admins.sql"
ADMIN_ARRAY=
if [[ $FORCE == 1 ]]; then
  q -c "SELECT lower(email) FROM auth.users WHERE raw_app_meta_data ->> 'role' = 'admin' AND email IS NOT NULL" \
    | LC_ALL=C sort -u >"$TMP/admins.list"
  if [[ -s $TMP/admins.list ]]; then
    ADMIN_ARRAY=$(q -c "SELECT 'ARRAY[' || string_agg(quote_literal(lower(email)), ',') || ']::text[]'
                          FROM auth.users WHERE raw_app_meta_data ->> 'role' = 'admin' AND email IS NOT NULL")
    cat >"$TMP/keep-admins.sql" <<SQL
UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
 WHERE lower(email) = ANY ($ADMIN_ARRAY);
SQL
    # Every email the backup brings back, and those that are administrators in the backup already: only
    # target admins whose backup account is not one need the flag set again (admins.kept).
    awk -F'\t' -v admins="$TMP/restored.admins" '
      /^COPY "auth"\."users" / { h = $0; sub(/^[^(]*\(/, "", h); sub(/\).*$/, "", h); gsub(/"/, "", h)
                                 n = split(h, c, ", ")
                                 for (i = 1; i <= n; i++) { if (c[i] == "email") e = i; if (c[i] == "raw_app_meta_data") m = i }
                                 f = 1; next }
      f && $0 == "\\." { exit }
      f && e && $e != "\\N" { print tolower($e); if (m && $m ~ /"role": ?"admin"/) print tolower($e) > admins }
    ' "$TMP/data.sql" | LC_ALL=C sort -u >"$TMP/restored.emails"
    touch "$TMP/restored.admins"
    LC_ALL=C sort -u -o "$TMP/restored.admins" "$TMP/restored.admins"
    LC_ALL=C comm -12 "$TMP/admins.list" "$TMP/restored.emails" | LC_ALL=C comm -23 - "$TMP/restored.admins" >"$TMP/admins.kept"
    LC_ALL=C comm -23 "$TMP/admins.list" "$TMP/restored.emails" >"$TMP/admins.lost"
  fi
fi

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
    SECRET_FILE="$REPO_DIR/backups/secrets/cron-secret-$(sed -E 's#^[a-z]+://([^:/]+).*#\1#' <<<"$CRON_BASE")-$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S).txt"
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
  # The Edge CRON_SECRET is set to what the jobs send. Read it now, before anything is written: a package
  # whose jobs carry no secret, or two different ones, has to stop here.
  if [[ $DEPLOY_FUNCTIONS == 1 ]]; then
    secret_env "$TMP/cron.sql" cron.sql || die "排程裡的 x-cron-secret 不是恰好一個值，無法設定 CRON_SECRET；沒有寫入任何東西"
  fi
fi

# --- plan ----------------------------------------------------------------------------------------
echo
say "接下來會做的事（現在還沒寫入任何東西）"
echo "  1. 在同一個交易裡寫入：資料庫角色、表格結構、權限（$(grep -cE '^(GRANT|REVOKE)' "$TMP/acl.sql") 條）、資料（$(grep -c '^COPY ' "$TMP/data.sql") 張表）。中途出錯會整批還原"
if [[ -s $TMP/skipped ]]; then
  echo "     略過的平台表（空的、目標沒有、或綁定舊登入狀態）：$(tr '\n' ' ' <"$TMP/skipped")"
fi
if [[ $FORCE == 1 ]]; then
  echo "  0. 先清空目標：public 的表格 / 函數 / 型別、全部帳號、全部排程（Storage 保留）"
  if [[ -s $TMP/admins.kept ]]; then
    if [[ $KEEP_ADMINS == 1 ]]; then
      echo "     目標上是管理員、但備份裡同 email 的帳號不是管理員，還原後會重新設為管理員：$(paste -sd' ' "$TMP/admins.kept")"
    elif [[ $YES == 0 ]]; then
      echo "     目標上是管理員、但備份裡同 email 的帳號不是管理員（寫入前會問你要不要重新設為管理員）：$(paste -sd' ' "$TMP/admins.kept")"
    else
      echo "     目標上是管理員、但備份裡同 email 的帳號不是管理員，不會重新設為管理員（要的話加 --keep-admins）：$(paste -sd' ' "$TMP/admins.kept")"
    fi
  fi
  if [[ -s $TMP/admins.lost ]]; then
    echo "     ⚠️  目標上這些管理員的 email 不在備份裡，帳號會消失、無法再當管理員：$(paste -sd' ' "$TMP/admins.lost")"
  fi
fi
if [[ -s $TMP/kept ]]; then
  echo "     保留目標現有的 Storage：$(tr '\n' ' ' <"$TMP/kept")"
fi
if [[ -s $TMP/excluded ]]; then
  echo "     依你的選擇不匯入：$(tr '\n' ' ' <"$TMP/excluded")"
fi
if [[ $SKIP_CRON == 0 ]]; then
  echo "  2. 建立 $(grep -c '^SELECT cron.schedule' "$TMP/cron.sql") 個排程，呼叫網址 ${SRC_API:-（無）} → $CRON_BASE"
  [[ $NEW_SECRET == 1 ]] && echo "     新的 CRON_SECRET 會存到 ${SECRET_FILE#"$REPO_DIR"/}"
else
  echo "  2. 不建立排程"
fi
echo "  3. 比對每張表的筆數是否和備份一致"
if [[ $DEPLOY_FUNCTIONS == 1 ]]; then
  echo "  4. 部署 Edge Functions 到 $TARGET_REF：stock-price、stock-report、backup-transactions"
  if [[ $SKIP_CRON == 0 ]]; then
    echo "     並把 Edge secret CRON_SECRET 設成排程裡的值（sha256 ${SECRET_SHA:0:16}…，值不顯示），再實際觸發 fx-daily 確認回 200"
  else
    echo "     因為不建立排程，不設定 CRON_SECRET"
  fi
  if [[ -n $AUTH_SITE ]]; then
    echo "  5. Auth Site URL → $AUTH_SITE；Redirect URLs $(tr ',' '\n' <<<"$AUTH_ALLOW" | wc -l | tr -d ' ') 條"
  else
    echo "  5. Auth 網址不變（沒有 --site-url，也讀不到來源專案的設定）"
  fi
fi
echo
[[ $DRY == 1 ]] && { say "預演模式（--dry-run）：沒有寫入任何東西"; exit 0; }

# Re-granting administrator by email is a decision, not a default: the same address in the backup may be a
# different person's account. Interactive runs ask (the list is on screen); --yes runs need --keep-admins.
if [[ -s $TMP/admins.kept && $KEEP_ADMINS == 0 && $YES == 0 ]]; then
  echo "這些帳號在目標上是管理員，但備份裡同 email 的帳號不是管理員：$(paste -sd' ' "$TMP/admins.kept")"
  echo "（同 email 不代表同一個人：請確認它們確實是同一位管理員）"
  [[ $(ask "還原後要把它們重新設為管理員嗎？(Y/n)" Y) =~ ^[Nn] ]] || KEEP_ADMINS=1
fi
if [[ $KEEP_ADMINS == 0 ]]; then
  mv "$TMP/admins.kept" "$TMP/admins.notgranted"
  : >"$TMP/admins.kept"
  : >"$TMP/keep-admins.sql"
fi

if [[ $YES == 0 ]]; then
  # A plain yes/no: emptiness is already checked, and typing a 40-character pooler host was a trap
  # (an Enter at that prompt ended the run).
  while :; do
    answer=$(ask "確定要把以上內容寫入 ${TARGET_REF:-$TARGET_HOST} 嗎？輸入 yes 開始，n 取消")
    case ${answer,,} in
      yes | y) break ;;
      n | no) die "已取消，沒有寫入任何東西" ;;
      *) echo "請輸入 yes 或 n" ;;
    esac
  done
fi

# --- load ----------------------------------------------------------------------------------------
say "寫入中（同一個交易，資料量大時需要一點時間）..."
psql "$TO" -w -X -q -v ON_ERROR_STOP=1 --single-transaction \
  "${ROLE_ARGS[@]}" \
  -f "$TMP/wipe.sql" \
  -f "$TMP/roles.sql" \
  -f "$FROM/schema.sql" \
  -f "$TMP/acl.sql" \
  -c 'SET session_replication_role = replica' \
  -f "$TMP/data.sql" \
  -f "$TMP/keep-admins.sql" >/dev/null
say "寫入完成"
if [[ -s $TMP/admins.list ]]; then
  say "管理員：目標原有 $(wc -l <"$TMP/admins.list") 個，已重新設定 $(wc -l <"$TMP/admins.kept") 個；目標現在共有 $(q -c "SELECT count(*) FROM auth.users WHERE raw_app_meta_data ->> 'role' = 'admin'") 個管理員"
  if [[ -s $TMP/admins.notgranted ]]; then
    say "注意：這些帳號沒有重新設為管理員（未加 --keep-admins 或你選擇不要）：$(paste -sd' ' "$TMP/admins.notgranted")"
  fi
  if [[ -s $TMP/admins.lost ]]; then
    say "注意：這些管理員的 email 不在備份裡，帳號已不存在：$(paste -sd' ' "$TMP/admins.lost")"
  fi
fi

# Functions and CRON_SECRET go in before the cron jobs, so no job fires at a function that would answer 401.
# A failed step does not stop the run: the database is already written. It is reported, the end of the script
# prints the one command that finishes the job, and the exit status is 1.
STEP_FAILED=0
if [[ $DEPLOY_FUNCTIONS == 1 ]]; then
  edge_deploy "$TARGET_REF" || { STEP_FAILED=1; say "注意：Edge Functions 沒有全部完成（原因見上方）；資料庫已寫入"; }
fi

if [[ $SKIP_CRON == 0 ]]; then
  q -f "$TMP/cron.sql" >/dev/null
  say "目標上的排程：$(q -c 'SELECT count(*) FROM cron.job') 個"
  if [[ $NEW_SECRET == 1 ]]; then
    mkdir -p "$(dirname "$SECRET_FILE")"
    chmod 700 "$(dirname "$SECRET_FILE")"
    install -m 600 "$TMP/new-secret" "$SECRET_FILE"
    say "新的 CRON_SECRET 已存到 ${SECRET_FILE#"$REPO_DIR"/}"
  fi
fi

if [[ $DEPLOY_FUNCTIONS == 1 && -n $AUTH_SITE ]]; then
  say "設定 Auth 網址..."
  auth_apply "$TARGET_REF" || STEP_FAILED=1
fi

# --- verify --------------------------------------------------------------------------------------
say "驗證..."
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
  grep -qx "$tbl" "$TMP/skipped" "$TMP/excluded" "$TMP/kept" && continue
  got=$(awk -F'\t' -v t="$tbl" '$1 == t { print $2 }' "$TMP/counts.target")
  if [[ $got != "$n" ]]; then
    echo "   ✗ 筆數不一致：$tbl 備份=$n 目標=${got:-（沒有這張表）}"
    mismatch=1
  fi
done <"$FROM/counts.tsv"
[[ $mismatch == 0 ]] && echo "   ✓ 每張表的筆數都和備份一致" || STEP_FAILED=1

# The cron path end to end: only meaningful once the functions and the jobs are both in place.
if [[ $FUNCTIONS_DEPLOYED == 1 && $SKIP_CRON == 0 ]]; then
  cron_probe || STEP_FAILED=1
fi

# verify.sql's checks ride in schema.sql (public.verify_setup); a package without them skips this.
if [[ $(q -c "SELECT to_regprocedure('public.verify_setup()') IS NOT NULL") == t ]]; then
  q -c "SELECT check_name, status, detail FROM public.verify_setup()" >"$TMP/verify.tsv"
  fails=$(awk -F'\t' '$2 == "FAIL"' "$TMP/verify.tsv")
  if [[ -z $fails ]]; then
    echo "   ✓ verify_setup()：$(awk -F'\t' '$2 == "PASS"' "$TMP/verify.tsv" | wc -l | tr -d ' ') 項 PASS，沒有 FAIL$(awk -F'\t' '$2 != "PASS" { printf "；%s %s", $1, $2 }' "$TMP/verify.tsv")"
  else
    echo "   ✗ verify_setup() 有 FAIL：" >&2
    sed 's/^/     /' <<<"$fails" >&2
    STEP_FAILED=1
  fi
fi

# --- what is left by hand --------------------------------------------------------------------------
n=0
step() { n=$((n + 1)); echo "  $n. $*"; }
echo
if [[ -n $TARGET_REF && $FUNCTIONS_DEPLOYED == 0 ]]; then
  if [[ $SKIP_CRON == 1 ]]; then
    secret_arg=--keep-secret
  elif [[ $NEW_SECRET == 1 ]]; then
    secret_arg="--secret-file $(printf '%q' "$SECRET_FILE")"
  else
    secret_arg="--from $(printf '%q' "$FROM")"
  fi
  say "Edge Functions 還沒完成：沒部署之前，報價、管理後台與排程都無法運作。補做（會詢問 access token）："
  echo "       bash $(printf '%q' "$REPO_DIR/scripts/db-migrate.sh") --functions-only --ref $TARGET_REF $secret_arg"
elif [[ -z $TARGET_REF ]]; then
  say "自架目標，Edge Functions 要手動部署："
  step "把 sources/supabase/functions/ 底下的資料夾（含 _shared/）放進 stack 的 volumes/functions/，重啟 functions 服務（README 步驟 4）"
  step "把 CRON_SECRET 設成排程裡的值（自架：寫在 stack 的環境變數）"
  step "Auth：GOTRUE_SITE_URL / ADDITIONAL_REDIRECT_URLS 設成前端網址"
fi
say "接下來要手動做的："
[[ -n $TARGET_REF && $AUTH_DONE == 0 ]] && step "Supabase → Authentication → URL Configuration：Site URL / Redirect URLs 設成前端網址（或重跑時加 --site-url）"
step "Cloudflare Pages → Settings → Environment variables（Production）："
echo "       VITE_SUPABASE_URL${TARGET_REF:+ = https://$TARGET_REF.supabase.co}"
echo "       VITE_SUPABASE_ANON_KEY = 新專案的 anon / publishable key（Settings → API）"
echo "     VITE_ 開頭的值是建置時寫進程式碼的：改完要重新部署（Deployments → Retry，或推 commit 到 main）才會生效"
step "使用者需重新登入（密碼不變）；舊環境如果還在跑，先停掉它的排程，否則批次會跑兩次"
# Any step that did not finish makes this a failed run for whoever called it (CI, a wrapper script).
[[ $STEP_FAILED == 0 ]] || exit 1
