#!/usr/bin/env bash
# Apply IvanLab Root CA trust to stock-pnl-web-dev DB (pg_net outbound HTTPS).
# Prerequisites: host already ran update-ca-trust with rootCA.crt from
#   https://hfs.ivan.lab/config/Certs/root/rootCA.crt
#   and volumes/certs/ca-bundle-with-ivanlab.crt exists (full host tls bundle).
set -euo pipefail
COMPOSE_DIR="${COMPOSE_DIR:-/root/container/supabase/stock-pnl-web-dev}"
cd "$COMPOSE_DIR"

if [[ ! -f volumes/certs/ca-bundle-with-ivanlab.crt ]]; then
  echo "missing volumes/certs/ca-bundle-with-ivanlab.crt" >&2
  exit 1
fi

if ! grep -q 'ca-bundle-with-ivanlab.crt' docker-compose.yml; then
  echo "Patching docker-compose.yml db service..."
  python3 -c '
from pathlib import Path
p = Path("docker-compose.yml")
text = p.read_text()
old = """      # Use named volume to persist pgsodium decryption key between restarts
      - db-config:/etc/postgresql-custom
    healthcheck:"""
new = """      # Use named volume to persist pgsodium decryption key between restarts
      - db-config:/etc/postgresql-custom
      # IvanLab Root CA for pg_net outbound HTTPS to *.ivan.lab
      - ./volumes/certs/ca-bundle-with-ivanlab.crt:/etc/ssl/certs/ca-certificates.crt:ro
    healthcheck:"""
if old not in text:
    raise SystemExit("volume anchor not found")
text = text.replace(old, new, 1)
old_env = """      JWT_SECRET: ${JWT_SECRET}
      JWT_EXP: ${JWT_EXPIRY}
    command:
      [
        \"postgres\","""
new_env = """      JWT_SECRET: ${JWT_SECRET}
      JWT_EXP: ${JWT_EXPIRY}
      SSL_CERT_FILE: /etc/ssl/certs/ca-certificates.crt
      CURL_CA_BUNDLE: /etc/ssl/certs/ca-certificates.crt
      SSL_CERT_DIR: /etc/ssl/certs
    command:
      [
        \"postgres\","""
if old_env not in text:
    raise SystemExit("env anchor not found")
text = text.replace(old_env, new_env, 1)
p.write_text(text)
print("patched")
'
else
  echo "compose already patched"
fi

docker compose up -d db
echo "Waiting for db..."
for i in $(seq 1 40); do
  if docker exec stock-pnl-web-dev-db-1 pg_isready -U postgres -h localhost >/dev/null 2>&1; then
    echo "ready"
    break
  fi
  sleep 2
done

docker exec stock-pnl-web-dev-db-1 psql -U postgres -d postgres -c "
SELECT net.http_post(
  url := 'https://korq9tvdz0jd7yblr72p.ivan.lab/functions/v1/stock-report',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := '{\"action\":\"probe\"}'::jsonb,
  timeout_milliseconds := 20000
);"
sleep 3
docker exec stock-pnl-web-dev-db-1 psql -U postgres -d postgres -c "
SELECT id, status_code, left(coalesce(error_msg, content::text, ''), 100) AS body
FROM net._http_response ORDER BY id DESC LIMIT 3;
"
echo "Expect status_code 401 (no secret) — not SSL error."
