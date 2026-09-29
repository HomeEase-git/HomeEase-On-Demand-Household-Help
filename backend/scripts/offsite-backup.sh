#!/usr/bin/env bash
# Nightly off-site backup (docs/DATA-RESILIENCE.md, "Off-site backup").
#   1. Dumps the database (pg_dump, as homeease_readonly). When
#      VERIFY_DATABASE_URL is set, restores the dump into that scratch
#      database and checks it with restore-drill.ts --verify-only, so every
#      copy is known to restore.
#   2. Copies every Supabase Storage bucket through Supabase's S3 interface.
#   3. Encrypts both with age to AGE_RECIPIENT (a public key: only the holder
#      of the private key, kept in the password manager, can read them) and
#      uploads them to the off-site bucket under <UTC timestamp>/.
# Nothing unencrypted leaves this machine; the working directory is deleted
# on exit. Run by .github/workflows/offsite-backup.yml; restore with
# offsite-restore.sh.
#
# Needs: pg_dump/pg_restore 18+, age, aws (CLI), tar, sha256sum; npx for the check.
# Environment:
#   BACKUP_DATABASE_URL             database to back up (read-only login, direct host, not the pooler)
#   AGE_RECIPIENT                   age public key (age1...)
#   OFFSITE_ENDPOINT, OFFSITE_REGION, OFFSITE_BUCKET,
#   OFFSITE_ACCESS_KEY_ID, OFFSITE_SECRET_ACCESS_KEY    where copies go (S3-compatible)
#   SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION,
#   SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY  file storage to copy
#   optional: VERIFY_DATABASE_URL (empty scratch database), BACKUP_BUCKETS
#   (space-separated; default: every bucket), PG_BIN (directory of pg_dump)
set -euo pipefail

for var in BACKUP_DATABASE_URL AGE_RECIPIENT OFFSITE_ENDPOINT OFFSITE_REGION OFFSITE_BUCKET \
  OFFSITE_ACCESS_KEY_ID OFFSITE_SECRET_ACCESS_KEY SUPABASE_S3_ENDPOINT SUPABASE_S3_REGION \
  SUPABASE_S3_ACCESS_KEY_ID SUPABASE_S3_SECRET_ACCESS_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "::error::$var is not set (docs/DATA-RESILIENCE.md, 'Off-site backup')." >&2
    exit 1
  fi
done

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PG_DUMP="${PG_BIN:+$PG_BIN/}pg_dump"
PG_RESTORE="${PG_BIN:+$PG_BIN/}pg_restore"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Own AWS CLI config: path-style addressing (Supabase needs it; B2 and R2
# accept it), no credentials from the machine's own profile, and checksums
# only where required (newer CLI defaults trip some S3-compatible services).
export AWS_CONFIG_FILE="$WORK/aws-config" AWS_SHARED_CREDENTIALS_FILE="$WORK/aws-credentials"
printf '[default]\ns3 =\n  addressing_style = path\n' > "$AWS_CONFIG_FILE"
: > "$AWS_SHARED_CREDENTIALS_FILE"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
source_s3() {
  AWS_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="$SUPABASE_S3_REGION" aws --endpoint-url "$SUPABASE_S3_ENDPOINT" "$@"
}
offsite_s3() {
  AWS_ACCESS_KEY_ID="$OFFSITE_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$OFFSITE_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="$OFFSITE_REGION" aws --endpoint-url "$OFFSITE_ENDPOINT" "$@"
}
size() { du -h "$1" | cut -f1; }

echo "Dumping the database..."
DUMP_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
"$PG_DUMP" --format=custom --file "$WORK/db.dump" --dbname "$BACKUP_DATABASE_URL"
DB_SIZE="$(size "$WORK/db.dump")"

if [ -n "${VERIFY_DATABASE_URL:-}" ]; then
  echo "Restoring the dump into the scratch database and checking it..."
  "$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname "$VERIFY_DATABASE_URL" "$WORK/db.dump"
  (cd "$BACKEND_DIR" && npx tsx scripts/restore-drill.ts --verify-only "$VERIFY_DATABASE_URL" --as-of "$DUMP_STARTED")
fi

echo "Copying file storage..."
BUCKETS="${BACKUP_BUCKETS:-$(source_s3 s3api list-buckets --query 'Buckets[].Name' --output text)}"
# An empty list means the wrong endpoint or key, not an app with no files:
# publishing an empty archive would look like a good backup.
if [ -z "${BUCKETS//[[:space:]]/}" ] || [ "$BUCKETS" = None ]; then
  echo "::error::No storage buckets found at SUPABASE_S3_ENDPOINT; refusing to publish an empty file backup." >&2
  exit 1
fi
mkdir -p "$WORK/files"
FILE_SUMMARY=""
for bucket in $BUCKETS; do
  mkdir -p "$WORK/files/$bucket"
  source_s3 s3 sync "s3://$bucket" "$WORK/files/$bucket" --only-show-errors
  FILE_SUMMARY+="| $bucket | $(find "$WORK/files/$bucket" -type f | wc -l | tr -d ' ') |"$'\n'
done
FILES_SIZE="$(du -sh "$WORK/files" | cut -f1)"

echo "Encrypting..."
age --encrypt --recipient "$AGE_RECIPIENT" --output "$WORK/db.dump.age" "$WORK/db.dump"
tar -C "$WORK/files" -cf - . | age --encrypt --recipient "$AGE_RECIPIENT" --output "$WORK/files.tar.age"
rm -rf "$WORK/db.dump" "$WORK/files"
(cd "$WORK" && sha256sum db.dump.age files.tar.age > SHA256SUMS)

echo "Uploading to the off-site bucket..."
for file in db.dump.age files.tar.age SHA256SUMS; do
  offsite_s3 s3 cp "$WORK/$file" "s3://$OFFSITE_BUCKET/$STAMP/$file" --only-show-errors
done

SUMMARY="## Off-site backup $STAMP

| Part | Size before encryption |
|---|---|
| Database | $DB_SIZE |
| Files | $FILES_SIZE |

| Bucket | Files |
|---|---|
$FILE_SUMMARY
Stored as \`$STAMP/\` in the off-site bucket (db.dump.age $(size "$WORK/db.dump.age"), files.tar.age $(size "$WORK/files.tar.age")).
"
echo "$SUMMARY"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"; fi
