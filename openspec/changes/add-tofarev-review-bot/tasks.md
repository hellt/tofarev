# Tasks

## 1. Runtime and trusted configuration

- [x] 1.1 Create the TypeScript orchestration package with a supported Node.js LTS version, locked dependencies, build/typecheck commands, and a test runner; verify a clean install, build, and typecheck succeed.
- [x] 1.2 Define validated trusted settings for the production repository, three allowed users, App identity, Token Factory endpoint/model, and execution limits; verify invalid settings fail closed and document each setting and runtime secret.
- [x] 1.3 Pin an OpenCode release and a reproducible reviewer container image; verify the installed CLI supports non-interactive execution, the chosen provider configuration, result events, and deny-by-default tool controls, and record the compatibility contract.

## 2. Request admission and lifecycle

- [x] 2.1 Implement event admission using repository identity, `issue_comment.created`, PR context, human comment author, and exact trimmed command; verify fixtures for all three allowed users and rejection of unauthorized, quoted, edited, issue-only, diff-line, bot, and wrong-repository events without inference or publication.
- [x] 2.2 Implement request metadata resolution and the bot-owned status marker with paginated comment lookup; verify duplicate completed requests skip inference, spoofed markers are ignored, and failed/interrupted requests reuse their comment and stored revision.
- [x] 2.3 Implement bounded GitHub retries, ambiguous-create recovery, closed/unavailable PR handling, and sanitized diagnostics; verify fixture-driven API failures cannot create duplicate reports or claim successful publication.
- [x] 2.4 Document the exact trigger, request lifecycle, rerun behavior, and comment-based persistence limitation; verify the examples match admission tests and state transitions.

## 3. Immutable PR context

- [x] 3.1 Implement read-only Git object fetching, recorded-SHA verification, merge-base diff generation, and rename/deletion metadata; verify temporary Git fixtures for same-repository and fork-style refs, shallow-history recovery, base movement, and head races.
- [x] 3.2 Build bounded regular-file source snapshots without executing hooks, filters, submodules, or repository scripts; verify malicious paths/symlinks cannot escape snapshots and binary, large, LFS-pointer, and submodule content is recorded as skipped where unsupported.
- [x] 3.3 Generate changed-file and coverage manifests with revision-specific line counts for later link validation; verify added, renamed, deleted, empty, and non-ASCII paths, and document source limits and partial-review behavior.
- [x] 3.4 Supply the Karpathy and Ponytail rules from the recorded target-base SHA as a separate standards bundle and prioritize relevant docs/schema context; verify PR edits cannot replace the rubric, retries retain its revision, and missing rule files produce coverage notes. Document the selected rule paths and revision policy.

## 4. Isolated OpenCode review

- [x] 4.1 Implement the isolated reviewer launch with a trusted working directory/home, read-only source mounts, explicit source read/search tools, and disabled shell/edit/plugin/MCP/LSP/skill/subagent/web/sharing features; verify hostile OpenCode configuration, agent instructions, and symlink fixtures cannot execute or expose a sentinel publishing secret.
- [x] 4.2 Implement the Token Factory/OpenCode adapter using the exact GLM-5.3-Flash model and `TOFAREV_API_KEY` runtime secret; verify fake-provider tests cover tool calls, missing/invalid credentials, transient failures, event parsing, and absence of silent provider/model fallback.
- [x] 4.3 Implement the canonical system policy from design.md in `prompts/containerlab-review.md`, select the dedicated primary review agent, and supply the versioned result/severity contract; verify a captured provider request contains the policy as system instructions, separates PR data, and records its version. Verify result fixtures cover evidence, trigger, impact, correction, priority, location, coverage, and one bounded repair attempt.
- [x] 4.4 Enforce reviewer deadlines, model-turn/context/output budgets, process termination, and partial/failure outcomes; verify a hanging provider, malformed final result, and budget exhaustion finish with correct states and sanitized logs.
- [x] 4.5 Add an opt-in live model/tool-calling compatibility probe and document its command, credentials, and expected output; verify it is excluded from default tests and fails clearly when the key or model access is unavailable.
- [x] 4.6 Add a focused prompt-evaluation set and documented opt-in GLM evaluation command covering missing/stale docs, topology/schema mismatches, an unrelated internal API change, compatible helper reuse, unnecessary abstraction, repeated expensive work, a justified `ponytail:` tradeoff, duplicate root causes, and no-defect cases; verify the runner scores expected findings, false positives, severity, and coverage without assuming a mocked model demonstrates prompt quality.

## 5. Findings and report rendering

- [x] 5.1 Validate finding structure and revision-specific file/line locations and construct encoded immutable GitHub links; verify invalid priorities, nonexistent paths, invalid line ranges, rename paths, and deleted-line references produce the required validation outcomes.
- [x] 5.2 Implement deterministic priority ordering, the `PX - Summary` table rows, matching default-collapsed details blocks, metadata, and the exact linked Token Factory footer; verify golden fixtures for P0–P4, empty, partial, stale, and failed reports.
- [x] 5.3 Add safe text/code rendering and optional restricted Mermaid parsing; verify hostile HTML, pipes, fences, mentions, arbitrary URLs, Mermaid links/directives, and invalid diagrams cannot break report structure or inject content.
- [x] 5.4 Enforce the report byte budget at complete-finding boundaries with omitted counts and intact footer/markup; verify oversized multibyte output remains valid and explicitly discloses omissions.
- [x] 5.5 Add a documented report preview command and representative rendered Markdown fixtures; verify previews demonstrate the summary table, expandable detail sections, source links, and branding without contacting GitHub.

## 6. Actions orchestration and App publication

- [x] 6.1 Implement a reusable workflow with admission/preparation, isolated review, and trusted finalization jobs, per-request concurrency, immutable dependency references, explicit secret passing, and short-retention run-scoped artifacts; verify workflow validation and automated checks for privilege/secret separation.
- [x] 6.2 Implement App-token publication and update of the request's existing comment, including current-head comparison and recovery after review-job failure; verify mocked integration tests prevent model output from redirecting publication or altering trusted metadata.
- [x] 6.3 Deliver a Containerlab consumer workflow example using `issue_comment.created` on the default branch and pinned ToFaRev invocation, explicitly mapping the existing `${{ secrets.TOFAREV_API_KEY }}` to the reusable workflow's declared `TOFAREV_API_KEY` secret; verify its syntax, secret forwarding to inference only, and event gating against the reusable workflow interface.
- [x] 6.4 Write the installation and rollback guide covering App ownership/name availability, Nebius avatar upload, permissions, disabled webhooks, repository installation, credentials, model probe, consumer workflow, and revocation; verify every documented input is consumed by the implementation and no credentials are committed.

## 7. End-to-end acceptance

- [x] 7.1 Run the offline end-to-end suite through request admission, source preparation, fake-model review, validation, and mocked publication; verify the positive path plus unauthorized input, duplicate delivery, stale head, malformed findings, oversized PRs, and provider/publisher failures.
- [x] 7.2 Deliver a sandbox smoke-test procedure with an explicit test-repository configuration and pass/fail checklist for live model access, App identity/avatar, least-privilege permissions, clickable SHA links, details/Mermaid rendering, footer, duplicate handling, and ignored unauthorized commands; verify the procedure is executable and clearly records which live checks remain pending until credentials and App installation are supplied.

Production activation in `srl-labs/containerlab` is a rollout operation described in the design and installation guide. Local implementation completion does not imply that the App has been registered, the avatar uploaded, secrets installed, or a production review posted.
