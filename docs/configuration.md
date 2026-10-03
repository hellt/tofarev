# Configuration

The CLI reads `TOFAREV_CONFIG` only when explicitly set to a trusted JSON file. Production defaults are `srl-labs/containerlab` (repository ID `290960521`), commenters `hellt`, `flosch62`, `kaelemc`, and App slug `tofarev`. Never load this file from a PR. A sandbox installation must supply its own repository name and numeric ID; keep the same three-user allowlist unless deliberately testing another trusted configuration.

All settings are validated; unknown keys are errors. Model and endpoint are fixed to `zai-org/GLM-5.3-Flash` and `https://api.tokenfactory.nebius.com/v1`.

| Setting | Default / maximum |
| --- | --- |
| `limits.durationMs` | 900000 (15 minutes) |
| `shareSessions` | false in the CLI; true in the generated public-repository caller |
| `reasoningEffort` | `high`; accepts `low`, `high`, or `max` |
| `limits.turns` | Unset: no call cap. Optional explicit cap: 1–1000 calls. |
| `limits.contextTokens` | 100000 (OpenCode compaction window, not provider capacity) |
| `limits.requestBytes` | 2097152 (HTTP request body bytes, independent of token count) |
| `limits.outputTokens` | 8192 / 16384 |
| `limits.blobBytes` | 1048576 |
| `limits.snapshotBytes` | 104857600 |
| `limits.diffBytes` | 250000 |
| `limits.reportBytes` | 60000 |

`TOFAREV_API_KEY` is the existing Containerlab Actions secret for Token Factory. Forward it explicitly to the reusable workflow. The reviewer is the only job receiving it. Local live probes read the same environment variable. Never put credentials in JSON settings, prompts, source artifacts, or CLI arguments.

The publisher receives a short-lived `TOFAREV_GITHUB_TOKEN` created from the separately configured GitHub App credentials. `TOFAREV_APP_CLIENT_ID` is a repository variable and `TOFAREV_APP_PRIVATE_KEY` is a repository secret. The inference container receives neither. GitHub event and run metadata come from the standard `GITHUB_EVENT_PATH`, `GITHUB_EVENT_NAME`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, and `GITHUB_RUN_ATTEMPT` variables.
