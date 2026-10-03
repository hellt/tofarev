# Model compatibility and prompt evaluation

These commands make paid Token Factory requests and are excluded from default tests. Use Node 24.20.0 and `npm ci --ignore-scripts` first. Keep the key in the environment; do not put it in a command argument or tracked file. The Containerlab Actions secret does not automatically make it available locally.

```sh
# With TOFAREV_API_KEY already exported in this shell:
TOFAREV_LIVE=1 npm run probe
TOFAREV_LIVE=1 npm run evaluate
# Run only one case:
TOFAREV_LIVE=1 npm run evaluate -- topology-schema
```

The probe checks the exact model in `/models`, then runs the pinned OpenCode agent and requires a tool result plus valid structured output. Expected output names `zai-org/GLM-5.3-Flash` with modelAccess/toolCalling/structuredResult all true. Missing opt-in, key, model access, tool support or structured output causes a nonzero exit. The CLI prints a safe diagnostic without provider bodies or credentials.

The evaluation set in `src/evaluation.ts` includes missing/stale docs after changed or removed behavior, topology schema drift, an internal API change that needs no schema edit, compatible helper reuse, unnecessary abstraction, repeated expensive work, a justified Ponytail tradeoff, duplicate root causes and clean changes. Synthetic base/head snapshots include simplified standards explicitly labeled as evaluation-only. Production reviews always use the repository's recorded base rules.

Each result reports expected/matched/missed findings, false positives (including duplicate root causes), severity agreement, execution failures and complete coverage. Matching uses fixture-specific path and evidence keywords; it is a regression aid, not a semantic judge. Inspect full findings when tuning the policy, and add real-world sanitized cases over time. A no-defect case passes only with zero false positives and complete coverage. Defect cases should have all expected findings, no false positives, matching severity and complete coverage. Record the model, date, bot commit and policy hash alongside scores.

The offline tests verify the scorer and wire protocol. They do **not** establish GLM's review quality. Live model access and evaluation scores remain pending until a key is supplied to the live environment.
