#!/usr/bin/env bash
# Runs ON THE VM, from the repo, after the new code has been pulled (by the one-time
# ~/plzbot-deploy wrapper, see "Automatic deploys" in deploy/README.md). Rebuilds and restarts the
# app, waits for it to report healthy, and rolls back to the previous commit if it does not.
# Safe to run by hand: PLZBOT_PREV_COMMIT=$(git rev-parse HEAD) git pull --ff-only && deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NEW=$(git rev-parse HEAD)
PREV=${PLZBOT_PREV_COMMIT:-}

wait_healthy() {
  local i status
  for i in $(seq 1 36); do # up to ~3 minutes: the image's health check runs every 30 s
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$(docker compose ps -q plzbot)" 2>/dev/null || echo none)
    [ "$status" = healthy ] && return 0
    sleep 5
  done
  return 1
}

echo "deploying ${NEW:0:7} (was ${PREV:0:7})"
docker compose build plzbot
docker compose up -d

if wait_healthy; then
  docker image prune -f >/dev/null # drop superseded images so the small disk does not fill up
  echo "deployed ${NEW:0:7}: healthy"
  exit 0
fi

echo "!! ${NEW:0:7} did not become healthy. Last log lines:"
docker compose logs --no-log-prefix --tail 30 plzbot | sed 's#postgres://[^ ]*#<url>#g' || true

if [ -n "$PREV" ] && [ "$PREV" != "$NEW" ]; then
  echo "rolling back to ${PREV:0:7}"
  git reset --hard "$PREV"
  docker compose build plzbot
  docker compose up -d
  if wait_healthy; then echo "rolled back: healthy"; else echo "!! the rollback is not healthy either"; fi
fi
exit 1
