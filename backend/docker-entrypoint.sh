#!/bin/sh
set -e

echo "[WenFlow] Initializing database schema..."
npx prisma db push --schema=prisma/schema.prisma --accept-data-loss
npx prisma db push --schema=prisma/system.prisma --accept-data-loss

echo "[WenFlow] Bootstrapping complete, starting server..."
exec node dist/index.js
