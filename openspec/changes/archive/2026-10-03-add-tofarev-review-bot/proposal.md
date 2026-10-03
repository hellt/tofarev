# Proposal

## Why

Containerlab maintainers need an on-demand code reviewer that they can invoke directly from a pull request. ToFaRev will use Nebius Token Factory to produce consistent, actionable reviews with source links and a recognizable bot identity.

## What Changes

- Introduce a GitHub Actions-based review bot for `srl-labs/containerlab`, invoked by `/tofarev review` from `hellt`, `flosch62`, or `kaelemc`.
- Run OpenCode non-interactively against Nebius Token Factory's `zai-org/GLM-5.3-Flash`, reviewing a fixed PR revision and relevant repository context.
- Supply a versioned Containerlab system prompt covering clarity, correctness, performance, Karpathy/Ponytail rules, documentation for changed behavior, topology-schema consistency, duplication, and unnecessary abstraction.
- Restrict the reviewer to source inspection; keep authorization, credentials for publishing, and output validation in trusted orchestration.
- Publish as a GitHub App named **ToFaRev**, with a custom Nebius logo avatar and the expected `tofarev[bot]` identity, subject to GitHub name availability.
- Format each review as a P0–P4 summary table whose finding rows use `PX - Summary of a finding`, followed by one collapsed details block per finding. Include clickable commit-pinned file/line references, evidence, impact, suggested corrections, and Mermaid diagrams when useful.
- Append the deterministic footer `Powered by [Nebius Token Factory](https://nebius.com/services/token-factory)` to every bot review report.
- Provide bounded execution, duplicate-request handling, explicit partial/failure states, and a reproducible installation guide and consumer workflow for Containerlab.

The initial scope is PR conversation comments, one report per accepted command, and advisory reviews. Automatic reviews on pushes, inline review comments, executing PR code/tests, patch generation, merge blocking, and an always-running webhook service are outside this change.

## Capabilities

### New Capabilities

- `review-requests`: Command authorization, PR revision selection, request lifecycle, and duplicate handling.
- `code-review`: Isolated source inspection through OpenCode and Token Factory, evidence-backed findings, and explicit coverage limitations.
- `review-reports`: Branded GitHub App publication, severity ordering, summary tables, collapsible findings, stable source links, and attribution.

### Modified Capabilities

None. This repository has no existing capability specifications or application implementation.

## Impact

- This repository gains a small review orchestrator, trusted reviewer configuration, report renderer, tests, a versioned Actions integration, and installation documentation during implementation.
- Containerlab needs a default-branch consumer workflow, the ToFaRev App installation, and configured Actions credentials. This change supplies those integration assets locally; enabling them in Containerlab is a separate rollout step.
- External dependencies are GitHub Actions and REST APIs, the OpenCode CLI, and Nebius Token Factory's OpenAI-compatible inference API.
- Required operational inputs are an available GitHub App name, the final Nebius avatar asset, App credentials, and a Token Factory key with model access. Use the existing Containerlab repository Actions secret `TOFAREV_API_KEY`, reported configured by the user, for inference. Secrets are supplied through Actions, never committed.
