#!/bin/sh
# Deploys an API image on the server (run by .github/workflows/deploy.yml over SSH, in /opt/kachabity)
# without downtime: back up the database, apply pending migrations, start the new API next to the
# running one (Caddy sends requests to both), and stop the old one only once the new one is healthy.
# If the new one never gets healthy it is removed and the old one keeps serving.
# Migrations run while the old API still serves: they must keep working with the previous code
# (add first, remove in a later deploy). Usage: ./deploy.sh ghcr.io/<owner>/kachabity-api:<sha>
set -eu
cd "$(dirname "$0")"
NEW_IMAGE="$1"
COMPOSE="docker compose -f docker-compose.prod.yml"
PREVIOUS_IMAGE="$(cat current-image 2>/dev/null || true)"

echo "Deploying $NEW_IMAGE (previous: ${PREVIOUS_IMAGE:-none})"
export API_IMAGE="$NEW_IMAGE"
$COMPOSE pull api
# --wait: until Postgres accepts connections (its health check), or the migrations would fail.
$COMPOSE up -d --wait db

# A backup before any migration: migrations can't be undone by switching images.
if [ -n "$PREVIOUS_IMAGE" ]; then ./backup.sh; fi

# Pending migrations (an empty database gets db/baseline.sql first), with the new image's files.
$COMPOSE run --rm --no-deps api node scripts/migrate.mjs

# Postgres and Caddy: started, or recreated only when their settings changed.
$COMPOSE up -d --no-deps --remove-orphans db caddy

# The new API next to the old one (--no-recreate leaves the running container alone).
OLD="$($COMPOSE ps -q api)"
$COMPOSE up -d --no-deps --no-recreate --scale api="$(( $(echo "$OLD" | grep -c .) + 1 ))" api
NEW="$($COMPOSE ps -q api | grep -v -x -F -e "${OLD:-none}")"

# Up to 3 minutes for its health check.
status=starting
for _ in $(seq 36); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$NEW")"
  [ "$status" = healthy ] && break
  [ "$status" = unhealthy ] && break
  sleep 5
done

if [ "$status" = healthy ]; then
  # Caddy re-reads the API's addresses every second: let it see the new one, then stop the old one,
  # which finishes its requests in progress first (up to 30 seconds).
  sleep 3
  echo "$OLD" | xargs -r docker stop -t 30 >/dev/null
  echo "$OLD" | xargs -r docker rm >/dev/null
  echo "$NEW_IMAGE" > current-image
  docker tag "$NEW_IMAGE" kachabity-api:current
  # Old API images go; the current one and the previous one (for a rollback) stay.
  docker images "${NEW_IMAGE%:*}" --format '{{.Repository}}:{{.Tag}}' \
    | grep -v -x -e "$NEW_IMAGE" -e "${PREVIOUS_IMAGE:-none}" -e "${NEW_IMAGE%:*}:latest" \
    | xargs -r docker rmi >/dev/null 2>&1 || true
  echo "Deployed: $NEW_IMAGE"
  exit 0
fi

echo "The new API did not become healthy ($status):" >&2
docker logs --tail 80 "$NEW" >&2 || true
docker rm -f "$NEW" >/dev/null
if [ -n "$OLD" ]; then
  echo "The previous API ($PREVIOUS_IMAGE) keeps serving; the database keeps the migrations (restore a backup if needed)." >&2
fi
exit 1
