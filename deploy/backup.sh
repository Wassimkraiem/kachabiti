#!/bin/sh
# Backs up the database to S3 (bucket BACKUP_BUCKET, which keeps 30 days) and 2 days on the server.
# Run hourly by cron (set up by infra/terraform/cloud-init.yaml) and by deploy.sh before migrating.
# Restore: pg_restore --clean --if-exists --no-owner -d <database> <file> (docs/DEPLOY.md).
set -eu
cd "$(dirname "$0")"
set -a
# shellcheck source=/dev/null  # the server's .env (deploy/.env.example)
. ./.env
set +a
mkdir -p backups
FILE="kachabity-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "backups/$FILE"

# Signs with the server's instance role (env_auth reads it from the metadata service).
docker run --rm -v "$PWD/backups:/backups" \
  -e RCLONE_CONFIG_S3_TYPE=s3 -e RCLONE_CONFIG_S3_PROVIDER=AWS -e RCLONE_CONFIG_S3_ENV_AUTH=true \
  -e RCLONE_CONFIG_S3_REGION="$S3_REGION" -e RCLONE_CONFIG_S3_NO_CHECK_BUCKET=true \
  rclone/rclone:1.68.2 copy "/backups/$FILE" "s3:$BACKUP_BUCKET/"
find backups -name 'kachabity-*.dump' -mtime +1 -delete
echo "Backed up: $FILE"

# Tells CloudWatch it worked; the alarm kachabity-backup-missing (aws.tf) e-mails when this stops arriving.
# Not fatal: the backup is already in S3, and a missing report raises the alarm anyway.
docker run --rm -e AWS_REGION="$S3_REGION" amazon/aws-cli:2.22.0 \
  cloudwatch put-metric-data --namespace Kachabity --metric-name BackupSucceeded --value 1 \
  || echo "Could not report the backup to CloudWatch" >&2
