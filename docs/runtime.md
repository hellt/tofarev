# Runtime compatibility contract

Node.js 24.20.0, OpenCode 1.19.3 and npm dependencies are pinned in package-lock.json. The Dockerfile pins the multi-platform Node image by SHA-256 digest and installs Debian ripgrep 13.0.0-4+b2. This avoids OpenCode downloading a search binary at runtime. The OpenAI-compatible SDK is bundled inside the pinned OpenCode release. Actions are pinned to full commit SHAs. Build with `docker build -t tofarev-reviewer .`; no floating reviewer image is pulled. Updates require rerunning the integration tests.

The CLI contract is `opencode run --pure --format json --agent tofarev --model tofarev/zai-org/GLM-5.3-Flash`. The platform binary is invoked directly because npm lifecycle scripts are disabled. We consume `step_start`, `text` and `error` JSON events; a final schema-valid JSON text response is required. A dedicated primary agent receives the canonical policy plus schema as system instructions. Result schema v1 and the policy SHA-256 are independent version markers.

The pinned release supports an OpenAI-compatible provider. A local proxy holds the actual API key, forwards only `/chat/completions` to Token Factory, enforces the exact model, caps output and request size, retries transient failures and stops at the turn/deadline limit. OpenCode receives a placeholder proxy credential and a minimal environment. There is no provider fallback. OpenCode's automatic compaction uses provider-reported token usage near the configured 100,000-token window. It preserves a summary and recent conversation, using estimates for tail selection; older tool output pruning is disabled. The proxy has an independent 2 MiB HTTP request-body cap. Bytes are not counted as tokens. Compaction calls use the same fixed model and share the turn/deadline budgets.

A failed reviewer writes a bounded result artifact and exits nonzero. The publisher still runs, puts execution errors before snapshot warnings in the comment, and exits nonzero if the published report is failed. Skipped requests remain successful no-ops.

The reviewer uses a fresh non-Git working directory and isolated XDG directories. In 1.19.3 this yields worktree `/`; **read permission patterns are relative to that worktree**, while external-directory permissions use absolute paths. The configuration allows only snapshot reads, grep and glob. Shell, writes, tasks, skills, network tools, MCP, plugins, LSP and default agents are disabled. The snapshot is outside the working directory so OpenCode's per-file AGENTS discovery cannot promote PR instructions into its policy. Project configuration loading is disabled. The container has an empty temporary home, a read-only root, read-only snapshot/config mounts, no capabilities, no Docker socket, and no publisher secrets.

There is no default inference-call cap or agent step cap. OpenCode continues until completion or the reviewer deadline. Repair resumes the existing session and preserves its source inspection. If trusted configuration sets `limits.turns`, that allowance includes compaction and result repair. Near an explicit cap, the proxy removes tools and requests the investigated findings as JSON. The runner marks that result partial even if the model claims complete coverage.

The runner reserves up to 3 minutes for final output before the 30-minute deadline. Near that deadline, the proxy requests investigated findings and marks unfinished scope as partial. The proxy ends streaming at `[DONE]`, without waiting for the provider to close its HTTP connection. Logs distinguish response-header latency, first-data latency, and total call duration.

The proxy sends `reasoning_effort: high` by default on every model call, including compaction and repair. Trusted configuration accepts `low`, `high`, or `max`. Actions logs show call counts, request sizes, effort, and elapsed time. Logs exclude request contents and credentials.

With trusted `shareSessions: true`, the runner starts a temporary OpenCode server on loopback and captures the session through `GET /session/{id}` and `GET /session/{id}/message`. It never calls the removed native sharing API or sets its removed configuration field. The CLI attaches to the local server and session. Every 15 seconds the parent writes an atomic `snapshot.json` into the output mount. A final snapshot, including the validated report, is awaited before removing the session store. Each API response is bounded to 16 MiB and the combined export to 20 MB. Failed reviews also export their available transcript.

The runner host publishes the first snapshot, then updates it every `sessionPages.intervalSeconds` (default 120), and publishes again at completion. It generates self-contained HTML and downloadable JSON, pushes them to the `gh-pages` branch in `sessionPages.repository` (default `hellt/tofarev`), and updates the session index. Concurrent pushes retry against the current branch without force-pushing. Run IDs and attempt numbers keep reruns and simultaneous reviews separate. GitHub Pages deployment adds latency; this is periodic publication, not a streaming connection. Running pages refresh every 60 seconds; completed pages stop refreshing.

The host receives a repository-scoped `TOFAREV_PAGES_DEPLOY_KEY` only in its publishing steps. The container receives a writable `/session` output mount, the read-only snapshot/configuration, and the inference key. It receives no GitHub or Pages credentials. The Pages workflow runs on `gh-pages` pushes with its own `GITHUB_TOKEN`, `pages: write` and `id-token: write`. Custom Actions deployment avoids branch-build restrictions on automated pushes.

A separate progress job adds the generated Pages URL to the running bot comment. Final publication waits for progress, republishes the preserved snapshot, and includes that URL in the final comment. URLs must match the configured Pages repository and reviewed repository ID. Existing `opncd.ai` links remain readable for older reports. Publication failures preserve valid findings and any previously published link. The raw snapshot artifact is retained for seven days; Pages exports persist in Git until explicitly removed. Deleting an export from the branch does not erase Git history. Set `shareSessions: false` to disable new exports.

The parent inference adapter can reach Token Factory. Container networking is not an independent outbound firewall; restrictions on agent network actions are tool/config controls. PR code never runs. Native CLI tests verify the protocol, while the container is the production isolation boundary.

Run `npm run check` for unit/fixture tests and `npm run test:opencode` for the real pinned CLI with a fake streaming provider, tool calls, hostile config, credential sentinels and bounded repair. `npm run test:e2e` exercises preparation through publication against local Git and fake APIs. No live inference or GitHub writes occur in these tests.

Container integration test:

```sh
npm run test:container
```

This builds the image and checks the real CLI under the production container flags, non-root UID, read-only root/source mounts and absence of publisher credentials. `actionlint` 1.7.12 validates the reusable workflow and generated consumer example; run `actionlint .github/workflows/review.yml docs/examples/containerlab-workflow.yml` when changing them.

Compatibility source: [OpenCode 1.19.3 read permission handling](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/tool/read.ts), [external-directory boundary](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/project/instance-context.ts), and [instruction discovery](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/session/instruction.ts).
