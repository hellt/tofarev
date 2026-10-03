# review-reports Specification

## Purpose

Present ToFaRev's review results as recognizable, concise GitHub comments with expandable evidence and stable references to reviewed source.

## Requirements

### Requirement: Branded publication
Reports SHALL be posted using the ToFaRev GitHub App installation identity, configured with a custom Nebius logo avatar. The configured App identity SHALL be verified during setup, and reports SHALL remain advisory without approving PRs or requesting changes through a formal GitHub review.

#### Scenario: Configured installation publishes a report
- **WHEN** a review is ready for publication
- **THEN** the PR receives a comment attributed to the configured ToFaRev bot with its custom avatar

### Requirement: Summary table
A report containing findings SHALL begin its findings section with a Markdown summary table containing one row per finding, ordered P0 through P4. Each finding cell SHALL use `PX - Summary of a finding`; its location cell SHALL contain a clickable source reference. Priorities without findings SHALL NOT receive placeholder rows.

#### Scenario: Multiple priorities
- **WHEN** a review contains P3, P1, and P2 findings
- **THEN** the table lists P1, P2, and P3 in that order, with each title and location matching its detailed finding

#### Scenario: Empty result
- **WHEN** a successful review has no findings
- **THEN** the report states that no actionable findings were found and omits empty tables and finding blocks

### Requirement: Collapsed finding details
Each summary row SHALL have a corresponding default-collapsed HTML `details` block below the table. Its `summary` SHALL repeat the finding's priority and title. The block SHALL include source links, problem and triggering conditions, impact, and suggested correction.

#### Scenario: Reader expands a finding
- **WHEN** a reader opens a finding's collapsed block
- **THEN** they see the supporting detail for precisely that summary row, with code snippets or diagrams when useful

### Requirement: Stable source links
All finding locations SHALL link to verified files and line ranges at immutable reviewed commits. Existing and added lines SHALL link to the reviewed head; removed lines SHALL link to the comparison-base revision. Renamed files SHALL use the path at the referenced revision.

#### Scenario: PR is updated after publication
- **WHEN** a reader follows a source link after the PR receives further commits
- **THEN** the link still points to the code revision that supports the finding

#### Scenario: Finding concerns deleted code
- **WHEN** a finding references lines removed by the PR
- **THEN** its link resolves to those lines in the comparison base instead of a nonexistent head path

### Requirement: Severity meanings
The system SHALL use P0 for critical catastrophic or severe security blockers, P1 for high-impact merge-blocking defects, P2 for normal correctness or reliability defects, P3 for minor defects or limited edge cases, and P4 for optional actionable improvements. Severity SHALL reflect demonstrated impact rather than speculation.

#### Scenario: Optional improvement
- **WHEN** the reviewer proposes an improvement without demonstrating a behavioral defect
- **THEN** it is labeled P4 and described as optional

### Requirement: Optional diagrams and safe formatting
Useful diagrams SHALL use GitHub-supported fenced Mermaid syntax inside the related details block. All findings SHALL remain understandable without a diagram. Model-provided text SHALL NOT break the table, close a details block unexpectedly, inject arbitrary HTML, or create arbitrary external links.

#### Scenario: Unsafe or invalid diagram
- **WHEN** a proposed diagram cannot be validated against the supported syntax or contains interactive links or HTML
- **THEN** the renderer omits it and retains the textual explanation

### Requirement: Review metadata and attribution
Every report SHALL identify its state, reviewed commit when available, coverage limitations, and workflow run. Every report, including partial and failure reports, SHALL end with `Powered by [Nebius Token Factory](https://nebius.com/services/token-factory)`, appended independently of model output.

#### Scenario: Model omits branding
- **WHEN** the model returns findings without attribution
- **THEN** the published report still ends with the exact linked footer

#### Scenario: Stale or partial report
- **WHEN** the PR head changed or review coverage was incomplete
- **THEN** the report displays that limitation prominently above the findings
