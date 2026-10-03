#!/bin/sh
set -eu
npm run build
docker build --tag tofarev-reviewer .
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --memory 3g --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=1g,mode=1777 \
  --tmpfs /home/node:rw,nosuid,nodev,size=256m,uid=1000,gid=1000 \
  --mount type=bind,src="$PWD/dist/test",dst=/app/dist/test,readonly \
  --mount type=bind,src="$PWD/prompts",dst=/source,readonly \
  --entrypoint node tofarev-reviewer --test dist/test/container.integration.js dist/test/opencode.integration.js dist/test/sharing.integration.js
