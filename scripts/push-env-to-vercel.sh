#!/usr/bin/env bash
# Reads .env.local and pushes each non-empty variable to the linked Vercel
# project across production + preview + development environments. Safe to
# re-run — overwrites existing values.
#
# Usage: bash scripts/push-env-to-vercel.sh [path-to-env-file]

set -e

ENV_FILE="${1:-.env.local}"
CONFIG_FLAG="-Q $HOME/.vercel-cli"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

pushed=0
skipped=0
failed=0

while IFS='=' read -r key value; do
  # Skip comments, blanks, and keys without equals.
  [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
  key="$(echo "$key" | xargs)"           # trim whitespace
  [[ -z "$key" ]] && continue

  # Strip surrounding quotes and trailing CR from the value.
  value="${value%$'\r'}"
  value="${value#\"}"; value="${value%\"}"
  value="${value#\'}"; value="${value%\'}"

  if [[ -z "$value" ]]; then
    echo "skip $key (empty)"
    skipped=$((skipped+1))
    continue
  fi

  # Remove existing value (silent if absent), then re-add across all envs.
  npx vercel $CONFIG_FLAG env rm "$key" production --yes >/dev/null 2>&1 || true
  npx vercel $CONFIG_FLAG env rm "$key" preview --yes    >/dev/null 2>&1 || true
  npx vercel $CONFIG_FLAG env rm "$key" development --yes >/dev/null 2>&1 || true

  if printf '%s' "$value" | npx vercel $CONFIG_FLAG env add "$key" production preview development >/dev/null 2>&1; then
    echo "push $key"
    pushed=$((pushed+1))
  else
    echo "FAIL $key" >&2
    failed=$((failed+1))
  fi
done < "$ENV_FILE"

echo
echo "done: $pushed pushed, $skipped skipped (empty), $failed failed"
