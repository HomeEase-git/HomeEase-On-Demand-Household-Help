#!/bin/sh
# Container entrypoint: apply pending DB migrations, then hand off to the
# process in CMD (the Node server).
#
# `prisma migrate deploy` is idempotent and takes a Postgres advisory lock,
# so it is safe when several instances boot at once. If you would rather run
# migrations as a separate release step, start the container with
# RUN_MIGRATIONS=false and run `npx prisma migrate deploy` yourself.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy..."
  npx prisma migrate deploy
else
  echo "[entrypoint] RUN_MIGRATIONS=false — skipping migrations."
fi

exec "$@"
