#!/bin/sh
# Wrapper for the scheduled backup (see scripts/launchd/README.md).
#
# launchd is not a shell: it starts jobs with a minimal PATH and none of your
# profile, which is the usual reason a launch agent appears to do nothing. This
# script fixes up the environment, logs every run with a timestamp, and returns a
# real exit code so failures are visible.
#
# Safe to run by hand — it does exactly what the schedule does:
#   sh scripts/backup-cron.sh
set -eu

# Resolve the repo from this script's own location rather than hardcoding it, so
# moving the checkout doesn't leave the wrapper pointing at nothing.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO"

# Homebrew's bin is not on launchd's default PATH (/usr/bin:/bin:/usr/sbin:/sbin),
# so node would not be found. /usr/local/bin covers Intel Macs too.
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

LOG="$REPO/data/backup.log"
mkdir -p "$(dirname "$LOG")"

# Keep the log bounded; this runs forever.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1048576 ]; then
  tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ ! -f "$REPO/.env" ]; then
  echo "$stamp FAILED: no .env at $REPO/.env" >> "$LOG"
  exit 1
fi

if ! command -v node > /dev/null 2>&1; then
  echo "$stamp FAILED: node not found on PATH ($PATH)" >> "$LOG"
  exit 1
fi

echo "--- $stamp starting backup (node $(node --version)) ---" >> "$LOG"

if node --env-file="$REPO/.env" --import tsx "$REPO/scripts/backup.ts" >> "$LOG" 2>&1; then
  echo "--- ok ---" >> "$LOG"
else
  status=$?
  echo "--- FAILED (exit $status) ---" >> "$LOG"
  exit "$status"
fi
