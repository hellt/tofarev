# Runtime compatibility contract

Node.js 24.20.0, OpenCode 1.18.33 and npm dependencies are pinned in package-lock.json. The Dockerfile pins the multi-platform Node image by SHA-256 digest and installs Debian ripgrep 13.0.0-4+b2. This avoids OpenCode downloading a search binary at runtime. The OpenAI-compatible SDK is bundled inside the pinned OpenCode release. Actions are pinned to full commit SHAs. Build with `docker build -t tofarev-reviewer .`; no floating reviewer image is pulled. Updates require rerunning the integration tests.

The CLI contract is `opencode run --pure --format json --agent tofarev --model tofarev/zai-org/GLM-5.3-Flash`. The platform binary is invoked directly because npm lifecycle scripts are disabled. We consume `step_start`, `text` and `error` JSON events; a final schema-valid JSON text response is required. A dedicated primary agent receives the canonical policy plus schema as system instructions. Result schema v1 and the policy SHA-256 are independent version markers.

The pinned release supports an OpenAI-compatible provider. A local proxy holds the actual API key, forwards only `/chat/completions` to Token Factory, enforces the exact model, caps output and request size, retries transient failures and stops at the turn/deadline limit. OpenCode receives a placeholder proxy credential and a minimal environment. There is no provider fallback. OpenCode's automatic compaction uses provider-reported token usage near the configured 100,000-token window. It preserves a summary and recent conversation, using estimates for tail selection; older tool output pruning is disabled. The proxy has an independent 2 MiB HTTP request-body cap. Bytes are not counted as tokens. Compaction calls use the same fixed model and share the turn/deadline budgets.

A failed reviewer writes a bounded result artifact and exits nonzero. The publisher still runs, puts execution errors before snapshot warnings in the comment, and exits nonzero if the published report is failed. Skipped requests remain successful no-ops.

The reviewer uses a fresh non-Git working directory and isolated XDG directories. In 1.18.33 this yields worktree `/`; **read permission patterns are relative to that worktree**, while external-directory permissions use absolute paths. The configuration allows only snapshot reads, grep and glob. Shell, writes, tasks, skills, network tools, MCP, plugins, LSP and default agents are disabled. The snapshot is outside the working directory so OpenCode's per-file AGENTS discovery cannot promote PR instructions into its policy. Project configuration loading is disabled. The container has an empty temporary home, a read-only root, read-only snapshot/config mounts, no capabilities, no Docker socket, and no publisher secrets.

There is no default inference-call cap or agent step cap. OpenCode continues until completion or the reviewer deadline. Repair resumes the existing session and preserves its source inspection. If trusted configuration sets `limits.turns`, that allowance includes compaction and result repair. Near an explicit cap, the proxy removes tools and requests the investigated findings as JSON. The runner marks that result partial even if the model claims complete coverage.

With trusted `shareSessions: true`, the runner starts a temporary OpenCode server on loopback after review. It calls the native `POST /session/{id}/share` API. It verifies every recorded part exists on the hosted backend before publishing the URL. Sharing gets a separate 30-second deadline and 16 MiB response limit. Only validated `https://opncd.ai/s/...` or `/share/...` URLs reach the publisher. A sharing failure preserves findings and their collapsed details. The server and local session store are removed afterward. Hosted public transcripts persist independently of Actions artifacts. Automatic unsharing is not provided.

The parent inference adapter can reach Token Factory. Container networking is not an independent outbound firewall; restrictions on agent network actions are tool/config controls. PR code never runs. Native CLI tests verify the protocol, while the container is the production isolation boundary.

Run `npm run check` for unit/fixture tests and `npm run test:opencode` for the real pinned CLI with a fake streaming provider, tool calls, hostile config, credential sentinels and bounded repair. `npm run test:e2e` exercises preparation through publication against local Git and fake APIs. No live inference or GitHub writes occur in these tests.

Container integration test:

```sh
npm run test:container
```

This builds the image and checks the real CLI under the production container flags, non-root UID, read-only root/source mounts and absence of publisher credentials. `actionlint` 1.7.12 validates the reusable workflow and generated consumer example; run `actionlint .github/workflows/review.yml docs/examples/containerlab-workflow.yml` when changing them.

Compatibility source: [OpenCode 1.18.33 read permission handling](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/tool/read.ts), [external-directory boundary](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/project/instance-context.ts), and [instruction discovery](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/session/instruction.ts).
