# Runtime compatibility contract

Node.js 24.20.0, OpenCode 1.18.33 and npm dependencies are pinned in package-lock.json. The Dockerfile pins the multi-platform Node image by SHA-256 digest and installs Debian ripgrep 13.0.0-4+b2. This avoids OpenCode downloading a search binary at runtime. The OpenAI-compatible SDK is bundled inside the pinned OpenCode release. Actions are pinned to full commit SHAs. Build with `docker build -t tofarev-reviewer .`; no floating reviewer image is pulled. Updates require rerunning the integration tests.

The CLI contract is `opencode run --pure --format json --agent tofarev --model tofarev/zai-org/GLM-5.3-Flash`. The platform binary is invoked directly because npm lifecycle scripts are disabled. We consume `step_start`, `text` and `error` JSON events; a final schema-valid JSON text response is required. A dedicated primary agent receives the canonical policy plus schema as system instructions. Result schema v1 and the policy SHA-256 are independent version markers.

The pinned release supports an OpenAI-compatible provider. A local proxy holds the actual API key, forwards only `/chat/completions` to Token Factory, enforces the exact model, caps output and request size, retries transient failures and stops at the turn/deadline limit. OpenCode receives a placeholder proxy credential and a minimal environment. There is no provider fallback. Context accounting uses UTF-8 request bytes as a conservative token ceiling, reserving the output allowance. Large tool results can therefore stop a review before the model's advertised context limit.

The reviewer uses a fresh non-Git working directory and isolated XDG directories. In 1.18.33 this yields worktree `/`; **read permission patterns are relative to that worktree**, while external-directory permissions use absolute paths. The configuration allows only snapshot reads, grep and glob. Shell, writes, tasks, skills, network tools, MCP, plugins, LSP, sharing and default agents are disabled. The snapshot is outside the working directory so OpenCode's per-file AGENTS discovery cannot promote PR instructions into its policy. Project configuration loading is disabled. The container has an empty temporary home, a read-only root, read-only snapshot/config mounts, no capabilities, no Docker socket, and no publisher secrets.

The parent inference adapter can reach Token Factory. Container networking is not an independent outbound firewall; restrictions on agent network actions are tool/config controls. PR code never runs. Native CLI tests verify the protocol, while the container is the production isolation boundary.

Run `npm run check` for unit/fixture tests and `npm run test:opencode` for the real pinned CLI with a fake streaming provider, tool calls, hostile config, credential sentinels and bounded repair. `npm run test:e2e` exercises preparation through publication against local Git and fake APIs. No live inference or GitHub writes occur in these tests.

Container integration test:

```sh
npm run test:container
```

This builds the image and checks the real CLI under the production container flags, non-root UID, read-only root/source mounts and absence of publisher credentials. `actionlint` 1.7.12 validates the reusable workflow and generated consumer example; run `actionlint .github/workflows/review.yml docs/examples/containerlab-workflow.yml` when changing them.

Compatibility source: [OpenCode 1.18.33 read permission handling](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/tool/read.ts), [external-directory boundary](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/project/instance-context.ts), and [instruction discovery](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/session/instruction.ts).
