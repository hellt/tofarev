# review-requests Specification

## Purpose

Allow designated Containerlab maintainers to request and track a review of a specific pull request revision from GitHub comments.

## Requirements

### Requirement: Authorized command
The system SHALL accept newly created PR conversation comments in `srl-labs/containerlab` whose trimmed body equals `/tofarev review` and whose human author is `hellt`, `flosch62`, or `kaelemc`. Authorization SHALL use GitHub's comment author metadata and trusted configuration before paid inference or bot publication.

#### Scenario: Allowed maintainer requests a review
- **WHEN** any of the three allowed users posts the command on an open PR
- **THEN** the system accepts a review request associated with that repository, PR, and comment ID

#### Scenario: Unauthorized or unsupported input
- **WHEN** a different account posts the command, an allowed account quotes or embeds it in other text, or the event concerns an issue, edited comment, diff-line comment, or another repository
- **THEN** the system performs no inference and posts no bot response

#### Scenario: PR attempts to alter authorization
- **WHEN** a PR changes ownership files or bot configuration to add its author
- **THEN** the change does not grant that author permission to trigger the reviewer

### Requirement: Fixed review revision
The system SHALL resolve and record an open PR's base and head commits when accepting a request, review the merge-base-to-head change, and retain that revision on retries of the same request. It SHALL support fork PRs and report when the current head differs before publication.

#### Scenario: Fork PR
- **WHEN** an allowed user requests a review of a fork PR
- **THEN** the system reviews that PR's head revision using source accessible through the base repository and records the reviewed revision

#### Scenario: Head changes during review
- **WHEN** a new commit is pushed after the review revision is recorded
- **THEN** the report identifies the reviewed revision and states that newer changes were not reviewed

#### Scenario: Closed or unavailable PR
- **WHEN** an otherwise authorized request targets a closed PR or its revision cannot be retrieved
- **THEN** no inference is performed and a status report explains that the review could not proceed

### Requirement: Request lifecycle and idempotency
The system SHALL maintain one bot-owned status/report comment per accepted request ID. Reprocessing a completed request SHALL reuse its report without another inference run. A new command comment SHALL create a new request even for the same PR revision.

#### Scenario: Repeated event or workflow rerun
- **WHEN** an event for an already completed request is processed again
- **THEN** the existing result is retained without a duplicate comment or another model invocation

#### Scenario: Recovering an interrupted request
- **WHEN** the workflow is retried after an incomplete request
- **THEN** the existing status comment is reused, the stored revision is retained, and only one execution for that request proceeds at a time

### Requirement: Visible terminal state
Accepted requests SHALL end in a completed, partial, or failed state within configured execution limits. When GitHub publication is available, the status comment SHALL reflect that state and link to the workflow run. Publication failures SHALL fail the workflow visibly without exposing credentials.

#### Scenario: Inference fails
- **WHEN** the model is unavailable, authentication fails, or the execution limit is reached without a usable result
- **THEN** the request reports failure rather than claiming that no issues were found

#### Scenario: GitHub cannot receive the result
- **WHEN** publishing fails after bounded retries
- **THEN** the workflow fails with a sanitized diagnostic and does not claim successful publication
