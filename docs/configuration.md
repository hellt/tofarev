# Configuration

The CLI reads `TOFAREV_CONFIG` only when explicitly set to a trusted JSON file. Production defaults are `srl-labs/containerlab` (repository ID `290960521`), commenters `hellt`, `flosch62`, `kaelemc`, and App slug `tofarev`. Never load this file from a PR. A sandbox installation must supply its own repository name and numeric ID; keep the same three-user allowlist unless deliberately testing another trusted configuration.

All settings are validated; unknown keys are errors. Model and endpoint are fixed to `zai-org/GLM-5.3-Flash` and `https://api.tokenfactory.nebius.com/v1`.

| Setting | Default / maximum |
| --- | --- |
| `limits.durationMs` | 1800000 (30 minutes) |
| `shareSessions` | false in the CLI; true in the generated public-repository caller |
| `sessionPages.repository` | `hellt/tofarev`; publishes to its `gh-pages` branch |
| `sessionPages.intervalSeconds` | 120; accepts 60–900 seconds |
| `reasoningEffort` | `high`; accepts `low`, `high`, or `max` |
| `limits.turns` | Unset: no call cap. Optional explicit cap: 1–1000 calls. |
| `limits.contextTokens` | 100000 (OpenCode compaction window, not provider capacity) |
| `limits.requestBytes` | 2097152 (HTTP request body bytes, independent of token count) |
| `limits.outputTokens` | 16384 (room for Markdown review plus JSON) |
| `limits.blobBytes` | 1048576 |
| `limits.snapshotBytes` | 104857600 |
| `limits.diffBytes` | 250000 |
| `limits.reportBytes` | 60000 |

`TOFAREV_API_KEY` is the existing Containerlab Actions secret for Token Factory. Forward it explicitly to the reusable workflow. The reviewer is the only job receiving it. Local live probes read the same environment variable. Never put credentials in JSON settings, prompts, source artifacts, or CLI arguments.

The publisher receives a short-lived `TOFAREV_GITHUB_TOKEN` created from the separately configured GitHub App credentials. `TOFAREV_APP_CLIENT_ID` is a repository variable and `TOFAREV_APP_PRIVATE_KEY` is a repository secret. The inference container receives neither. GitHub event and run metadata come from the standard `GITHUB_EVENT_PATH`, `GITHUB_EVENT_NAME`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, and `GITHUB_RUN_ATTEMPT` variables.

`shareSessions: true` now publishes session exports to GitHub Pages. OpenCode hosting is no longer used. Configure `TOFAREV_PAGES_DEPLOY_KEY` as an Actions secret in the repository running the caller, and forward it explicitly. This SSH deploy key needs write access only to the Pages repository. The runner uses it outside the review container. GitHub Pages must use the custom [Pages workflow](../.github/workflows/pages.yml), with that workflow also present on `gh-pages`.

For local capture, set `TOFAREV_SESSION_DIR` to a writable directory and run `review` with `shareSessions: true`. The directory receives `snapshot.json` even when the review fails. To publish an export, run `node dist/src/cli.js publish-session /path/to/snapshot.json` with the Pages key, trusted configuration, `GITHUB_RUN_ID`, and `GITHUB_RUN_ATTEMPT` in the environment. The command emits `{"url":"..."}` only after the branch push succeeds. Pages deployment completes asynchronously.
