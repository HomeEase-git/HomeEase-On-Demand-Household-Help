#!/usr/bin/env bash
# Gets one off-site backup back (docs/DATA-RESILIENCE.md, "Off-site backup"):
# downloads it, checks it against its SHA256SUMS, decrypts it with the age
# private key, and unpacks it into <out-dir>:
#   <out-dir>/db.dump    pg_restore it into an EMPTY database
#   <out-dir>/files/     one folder per storage bucket
# With --restore-db <url>, also restores the dump into that (empty) database.
#
# Usage (from backend/):
#   scripts/offsite-restore.sh <stamp|latest> <age identity file> <out-dir> [--restore-db <url>]
# Environment: OFFSITE_ENDPOINT, OFFSITE_REGION, OFFSITE_BUCKET, and a key
# that can READ the bucket in OFFSITE_ACCESS_KEY_ID / OFFSITE_SECRET_ACCESS_KEY
# (the nightly job's key can only write). PG_BIN optionally points at pg_restore.
set -euo pipefail

if [ $# -lt 3 ]; then
  sed -n '2,15p' "$0"
  exit 1
fi
STAMP="$1" IDENTITY="$2" OUT="$3"
RESTORE_DB=""
if [ "${4:-}" = "--restore-db" ]; then RESTORE_DB="${5:?--restore-db needs a connection string}"; fi
for var in OFFSITE_ENDPOINT OFFSITE_REGION OFFSITE_BUCKET OFFSITE_ACCESS_KEY_ID OFFSITE_SECRET_ACCESS_KEY; do
  if [ -z "${!var:-}" ]; then echo "$var is not set." >&2; exit 1; fi
done
[ -r "$IDENTITY" ] || { echo "Can't read the identity file $IDENTITY." >&2; exit 1; }
if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT")" ]; then echo "$OUT is not empty." >&2; exit 1; fi
PG_RESTORE="${PG_BIN:+$PG_BIN/}pg_restore"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export AWS_CONFIG_FILE="$WORK/aws-config" AWS_SHARED_CREDENTIALS_FILE="$WORK/aws-credentials"
printf '[default]\ns3 =\n  addressing_style = path\n' > "$AWS_CONFIG_FILE"
: > "$AWS_SHARED_CREDENTIALS_FILE"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
offsite_s3() {
  AWS_ACCESS_KEY_ID="$OFFSITE_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$OFFSITE_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="$OFFSITE_REGION" aws --endpoint-url "$OFFSITE_ENDPOINT" "$@"
}

if [ "$STAMP" = latest ]; then
  # Timestamps sort as text. Only complete backups have a SHA256SUMS (uploaded last).
  STAMP="$(offsite_s3 s3 ls "s3://$OFFSITE_BUCKET/" --recursive | awk '{print $4}' \
    | grep '/SHA256SUMS$' | sort | tail -1 | cut -d/ -f1)"
  [ -n "$STAMP" ] || { echo "No complete backup found in $OFFSITE_BUCKET." >&2; exit 1; }
fi
echo "Backup $STAMP"

for file in db.dump.age files.tar.age SHA256SUMS; do
  offsite_s3 s3 cp "s3://$OFFSITE_BUCKET/$STAMP/$file" "$WORK/$file" --only-show-errors
done
(cd "$WORK" && sha256sum --check --quiet SHA256SUMS) || { echo "Checksum mismatch: the backup is damaged." >&2; exit 1; }
echo "Checksums match."

mkdir -p "$OUT/files"
age --decrypt --identity "$IDENTITY" --output "$OUT/db.dump" "$WORK/db.dump.age"
age --decrypt --identity "$IDENTITY" "$WORK/files.tar.age" | tar -C "$OUT/files" -xf -
echo "Decrypted into $OUT: db.dump and files/ ($(find "$OUT/files" -type f | wc -l | tr -d ' ') files)."

if [ -n "$RESTORE_DB" ]; then
  "$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_DB" "$OUT/db.dump"
  echo "Restored the database."
fi
