# Requests and recovery

Post exactly `/tofarev review` in an open PR's conversation. Surrounding whitespace is accepted. Only new comments from `hellt`, `flosch62`, and `kaelemc` in the configured repository are admitted. The comment author is checked, not the PR author or workflow rerun actor. Quoted commands, extra prompt text, edits, issue comments, and inline diff comments are ignored.

An accepted request creates one ToFaRev status comment. Its hidden versioned marker records the repository/comment identity, head, target base, comparison base, prompt hash, state, and workflow run. Only markers posted by the configured App bot are trusted. The status moves from `running` to `completed`, `partial`, or `failed`.

Duplicate deliveries and reruns serialize by request ID. Completed and partial reports are retained without another inference call. A failed/interrupted request reuses its comment and fixed source revision. A newly posted command always requests a new review. A changed PR head at publication is labeled as newer than the reviewed revision.

The bot paginates its comment lookup. If creating a comment receives an ambiguous network/server error, it searches for the marker before retrying. GitHub GET/PATCH and transient failures have bounded retries; authentication failures fail immediately. If GitHub is unavailable, the workflow fails with a sanitized diagnostic.

Deleting a bot status comment removes the durable request record. There is no separate database. A canceled runner can leave a `running` comment; rerun the workflow to recover it. Closed or inaccessible PRs receive a failure status without paid inference.
