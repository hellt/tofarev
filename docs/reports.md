# Report previews

The [compact shared-session preview](examples/shared.md) shows the new table-and-link layout; its session URL is illustrative. Run `npm run preview -- shared` to reproduce it.

Run `npm run preview` or `npm run preview -- partial`. To save clean Markdown without npm's log preamble:

```sh
npm run build
node dist/src/cli.js preview findings > /tmp/tofarev-preview.md
```

Supported examples: [findings](examples/findings.md), [empty](examples/empty.md), [partial](examples/partial.md), [stale](examples/stale.md), [failed](examples/failed.md). They deliberately use illustrative file names and SHAs, so their links demonstrate syntax rather than real revisions. Production links use recorded commits and validated file/line ranges.

Each finding is a `PX - Summary` table row with an immutable source link. When sharing succeeds, a **View full review session** link replaces the collapsed details. The native OpenCode viewer includes tool outputs and a readable final review before the structured JSON. The report includes evidence, triggers, impact, suggested corrections, and coverage notes. Symbols use inline code. Verified file references link to the reviewed commit and exact line range. Coverage bullets retain complete sentences. If sharing is disabled or unavailable, each row has a matching collapsed details block. The report orders P0 through P4; an empty list is valid. Failed or partial analysis cannot present itself as a clean complete review.

The footer displays `Powered by` and the official Nebius Token Factory logo, linked to the service. The logo uses light and dark variants at 22 pixels high. See [asset provenance](../assets/README.md).

The generated caller enables public session sharing through `trusted_config: '{"shareSessions":true}'`. Shared conversation and source excerpts are uploaded to OpenCode's hosting service. Anyone with the link can access them. The inference key stays in the parent proxy, and GitHub credentials never enter the reviewer. See [OpenCode sharing](https://opencode.ai/docs/share/) and the [native sharing implementation pinned to 1.18.33](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/share/share-next.ts).

The Review job prints `OpenCode review session: <url>` in Actions logs before the first model call. The status publisher adds this link before `Workflow run` in the running comment. Open the link to inspect progress; refresh the shared page to see newly synced messages. The final comment keeps the same link and order, even when final synchronization fails. If synchronization cannot be confirmed, the comment also includes finding details and explains the upload status. This upload status does not change complete source coverage into a partial review.

Model text is escaped as literal text, including HTML, Markdown fences, table pipes, mentions and arbitrary links. Model text cannot supply publishing metadata or a URL. Optional diagrams pass a restricted versioned grammar: plain flowchart nodes/edges or sequence participants/messages; no HTML, links, directives or styling. Invalid diagrams are omitted. GitHub supports [Mermaid fences](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) and [details sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections). Final rendering still needs a live sandbox check.

The default comment budget is 60,000 UTF-8 bytes. Truncation removes whole lowest-priority findings, including their matching table rows/details, reports the omitted count and preserves closing markup and the footer. A report with omitted findings is partial.
