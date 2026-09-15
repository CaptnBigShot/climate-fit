#!/bin/bash
# Stop: run `npm run check` when Claude finishes a turn. On failure, exit 2 so the errors go
# back to Claude to fix. If Claude was already sent back once and it still fails, let the
# turn end and warn the user rather than looping.
input=$(cat)
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -z "$(git status --porcelain)" ] && exit 0 # nothing changed since the last commit

out=$(npm run --silent check 2>&1) && exit 0

if [ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ]; then
  jq -n '{systemMessage: "npm run check is still failing after a fix attempt."}'
  exit 0
fi
printf 'npm run check failed. Fix these before finishing:\n%s\n' "$(tail -n 60 <<<"$out")" >&2
exit 2
