#!/usr/bin/env sh
# One-time Let's Encrypt bootstrap. The app's own :80 helper serves the ACME webroot, but it
# can't start until a certificate exists, so the very first issuance uses certbot's standalone
# listener on :80 instead. Run from the repo root after creating .env (see deploy/env.example).
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "missing .env (copy deploy/env.example)"; exit 1; }
. ./.env
: "${PLZBOT_DOMAIN:?set PLZBOT_DOMAIN in .env}"
: "${ACME_EMAIL:?set ACME_EMAIL in .env}"

docker compose down plzbot 2>/dev/null || true
docker compose run --rm -p 80:80 --entrypoint certbot certbot certonly \
  --standalone --non-interactive --agree-tos --email "$ACME_EMAIL" \
  -d "$PLZBOT_DOMAIN" ${ACME_STAGING:+--staging}
echo "Certificate issued for $PLZBOT_DOMAIN. Now: docker compose up -d"
