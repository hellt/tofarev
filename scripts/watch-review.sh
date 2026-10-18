#!/usr/bin/env bash
set -euo pipefail
# This host-side step owns the Pages credential. The already-running container
# receives only the output mount and the inference key.
tail -n +1 -F .work/reviewer.log &
log_pid=$!
trap 'kill "$log_pid" 2>/dev/null || true' EXIT
interval=$(node -e 'const c=JSON.parse(require("fs").readFileSync(".work/config.json","utf8")); console.log(c.sessionPages?.intervalSeconds ?? 120)')
next=$((SECONDS + interval))
publish_snapshot() {
  if test -s .work/session/snapshot.json; then
    if node dist/src/cli.js publish-session .work/session/snapshot.json > .work/session-link.tmp; then
      mv .work/session-link.tmp .work/session-link.json
    else
      echo 'Session Pages publication failed; review findings are preserved.' >&2
    fi
  fi
}
while test ! -f .work/reviewer.exit; do
  if ((SECONDS >= next)); then
    publish_snapshot
    next=$((SECONDS + interval))
  fi
  sleep 1
done
publish_snapshot
exit "$(cat .work/reviewer.exit)"
