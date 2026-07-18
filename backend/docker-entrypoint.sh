#!/bin/sh
set -e
umask 077

echo "[WenFlow] Starting server. Database schema changes must be applied before deployment."
exec node dist/index.js
