# code-review Specification

## Purpose

Produce evidence-backed reviews of Containerlab pull requests using Nebius Token Factory while preserving the boundary between untrusted source and trusted review execution.

## Requirements

### Requirement: Explicit model effort
The inference proxy SHALL send `reasoning_effort: high` by default for GLM-5.3-Flash. Trusted configuration MAY select `low`, `high`, or `max`. This setting SHALL apply to review, compaction, and repair calls. Progress logs SHALL show call counts and durations without source contents or credentials.

#### Scenario: Agent omits or supplies effort
- **WHEN** OpenCode sends an inference request
- **THEN** the proxy uses the validated trusted effort setting instead of an implicit provider default or agent-supplied setting

### Requirement: Token Factory model
The system SHALL perform inference through Nebius Token Factory using the exact model `zai-org/GLM-5.3-Flash`. Credentials SHALL come from runtime secrets. The system SHALL NOT silently substitute a different provider or model when access fails.

#### Scenario: Configured model is available
- **WHEN** a valid request reaches inference with a working Token Factory key
- **THEN** the selected model reviews the supplied PR context through Token Factory

#### Scenario: Model access fails
- **WHEN** the key is rejected or the model is unavailable
- **THEN** the request fails with a sanitized explanation and no fallback provider receives the source

### Requirement: Source-aware review
The reviewer SHALL inspect the PR change and relevant surrounding code, including callers, tests, or documentation needed to assess suspected regressions. Reported findings SHALL be attributable to the proposed change and supported by an identifiable source location and concrete reasoning.

#### Scenario: Finding needs surrounding context
- **WHEN** a changed function appears incorrect but its callers or tests determine its behavior
- **THEN** the reviewer can inspect that context before deciding whether to report the finding

#### Scenario: Unsupported suspicion
- **WHEN** a suspected issue lacks a demonstrable failure condition or sufficient evidence
- **THEN** it is omitted as a finding or described explicitly as an uncertainty in coverage notes

### Requirement: Review-only authority
PR source, comments, and repository instructions SHALL be treated as untrusted review data. The reviewer SHALL NOT execute PR code, load PR-controlled executable configuration, modify repository contents, publish directly, or access the GitHub App private key or publishing token. Enforcement SHALL exist outside the review prompt.

#### Scenario: Malicious repository configuration
- **WHEN** a PR adds an OpenCode plugin, MCP command, install hook, agent instruction, or symlink intended to execute code or expose secrets
- **THEN** it cannot alter reviewer permissions, execute through configuration discovery, or expose publishing credentials

#### Scenario: Prompt injection in source
- **WHEN** a source comment instructs the reviewer to ignore the review policy or send data elsewhere
- **THEN** the reviewer remains limited to source inspection and approved inference, with no tool available to publish, run commands, or contact arbitrary services

### Requirement: Containerlab system prompt
Every review SHALL use a versioned system prompt identifying Containerlab as a CLI for deploying container-powered network topologies. It SHALL explicitly cover correctness, clarity, performance, repository rules, documentation, schema consistency, duplication, and unnecessary abstraction. PR-specific material SHALL remain separate from the system instructions.

#### Scenario: Review starts
- **WHEN** the model receives its first review request
- **THEN** the Containerlab review policy is present in its system instructions and the report metadata can identify the policy version used

### Requirement: Repository review standards
The reviewer SHALL assess relevant changes against the supplied Karpathy and Ponytail rules from the recorded target-base revision. Rule changes in the PR SHALL be reviewed as changes without replacing the active rubric. Missing rules SHALL be disclosed as a coverage limitation; repository standards SHALL NOT expand tool authority or replace the output contract.

#### Scenario: Existing helper is duplicated
- **WHEN** the PR adds logic already provided by a suitable repository helper
- **THEN** the reviewer checks the helper's semantics and identifies an actionable reuse opportunity when behavior can be preserved

#### Scenario: PR weakens review rules
- **WHEN** the PR edits a rule to suppress a finding category
- **THEN** the review continues using the recorded target-base rule and treats the proposed rule edit as review data

### Requirement: Documentation and schema consistency
The reviewer SHALL check documentation and examples for added, changed, deprecated, or removed user-visible behavior. For changes represented by `schemas/clab.schema.json`, it SHALL check agreement between implementation and schema, including fields, types, defaults, requiredness, enums, and constraints. API changes outside that schema's domain SHALL NOT trigger a demand for an unrelated schema edit.

#### Scenario: New topology property lacks a schema definition
- **WHEN** implementation adds a supported topology property but the corresponding schema entry is missing
- **THEN** the review reports the mismatch with the changed implementation location and required schema correction

#### Scenario: Removed behavior remains documented
- **WHEN** the PR removes user-visible behavior while relevant documentation or examples still recommend it
- **THEN** the review reports the stale guidance and explains the user impact

#### Scenario: Internal API refactor
- **WHEN** a Go API changes without altering the topology configuration contract
- **THEN** the reviewer checks relevant compatibility and documentation but does not require an unrelated topology-schema edit

### Requirement: Calibrated simplicity and performance findings
The reviewer SHALL flag actionable duplication, unnecessary abstraction, and inefficient execution with source-backed reasoning. Performance findings SHALL identify the operation, triggering scale or path, and expected cost. It SHALL distinguish measured evidence from static inference, respect documented tradeoffs, and avoid fixes whose complexity exceeds the demonstrated benefit.

#### Scenario: Repeated expensive operation
- **WHEN** a PR repeats an expensive runtime call inside a per-node loop
- **THEN** a finding identifies the loop, repeated operation, relevant scale, and a simpler correction without inventing benchmark results

#### Scenario: Deliberate bounded simplification
- **WHEN** code documents a `ponytail:` ceiling and the reviewed use remains within it
- **THEN** the reviewer evaluates that tradeoff and does not flag it solely because a more elaborate implementation exists

#### Scenario: Shared root cause
- **WHEN** several symptoms stem from the same introduced defect
- **THEN** the review consolidates them into one finding with the relevant affected locations instead of inflating the report

### Requirement: Structured validated findings
Each finding SHALL contain a priority from P0 through P4, title, source revision/path/line range, problem and triggering conditions, impact, and suggested correction. The system SHALL validate structure and source locations before publication and SHALL NOT publish fabricated links or unsupported priority values.

#### Scenario: Invalid finding location
- **WHEN** a model result references a nonexistent file or out-of-range line
- **THEN** that finding is excluded or corrected through a bounded repair attempt, and the report discloses any resulting incompleteness

#### Scenario: No supported findings
- **WHEN** review completes successfully and produces no supported findings
- **THEN** the result states that no actionable findings were found within the reported coverage

### Requirement: Bounded and disclosed coverage
The system SHALL bound runtime, inference turns, context size, and output size. It SHALL disclose skipped or unreadable content, resource-limit truncation, and that PR code/tests were not executed. An incomplete review SHALL NOT be presented as complete or as a clean bill of health.

#### Scenario: Oversized or binary change
- **WHEN** a PR contains more reviewable content than the configured limits or includes binary, submodule, or otherwise unsupported content
- **THEN** the report identifies the omitted scope and labels the review partial when changed content was not analyzed

#### Scenario: Limit reached after useful findings
- **WHEN** execution reaches a limit after obtaining validated findings
- **THEN** those findings can be published with an explicit partial-review status and coverage limitations
