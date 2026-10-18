# Report previews

The [shared-session preview](examples/shared.md) shows the summary table, collapsed finding details, and session link. Its session URL is illustrative. Run `npm run preview -- shared` to reproduce it.

Run `npm run preview` or `npm run preview -- partial`. To save clean Markdown without npm's log preamble:

```sh
npm run build
node dist/src/cli.js preview findings > /tmp/tofarev-preview.md
```

Supported examples: [findings](examples/findings.md), [empty](examples/empty.md), [partial](examples/partial.md), [stale](examples/stale.md), [failed](examples/failed.md). They deliberately use illustrative file names and SHAs, so their links demonstrate syntax rather than real revisions. Production links use recorded commits and validated file/line ranges.

Each finding is a `PX - Summary` table row with an immutable source link. Each row has a matching collapsed details block, including when the report has an OpenCode session link. The collapsed title repeats the priority and finding title. Expanding it shows the same problem, trigger, impact, and suggested correction as the final OpenCode session report. The self-contained session viewer includes tool inputs and outputs, reasoning, message metadata, a final review, and a downloadable JSON transcript. The report includes evidence, triggers, impact, suggested corrections, and coverage notes. Symbols use inline code. Verified file references link to the reviewed commit and exact line range. Coverage bullets retain complete sentences. The report orders P0 through P4; an empty list is valid. Failed or partial analysis cannot present itself as a clean complete review.

The summary table is followed by `## Detailed findings:` and the individual collapsed findings. Review scope and coverage bullets appear in a final collapsed block titled `review conditions`, after all findings. Failed, partial, and stale status notices remain visible above the table.

The footer displays `Powered by` and the official Nebius Token Factory logo, linked to the service. The logo uses light and dark variants at 22 pixels high. See [asset provenance](../assets/README.md).

The generated caller enables public session exports with `trusted_config: '{"shareSessions":true}'`. Conversation messages and source excerpts are published to the configured GitHub Pages repository. The default index is [hellt.github.io/tofarev](https://hellt.github.io/tofarev/). The inference key stays in the parent proxy, and GitHub/Pages credentials stay outside the review container.

The runner publishes an initial snapshot and updates the same URL every two minutes by default, with another export when review ends. The status publisher adds the session link immediately before `Workflow run`. Pages deployments add latency. Running pages refresh every minute and display their snapshot timestamp; completed pages stop refreshing. The viewer supports transcript search and toggles for tools and reasoning. Message text and tool data are displayed literally so inspecting a transcript cannot execute embedded source HTML. The final comment retains collapsed finding details even if exporting fails. Export failures do not change source coverage.

Model text is escaped as literal text, including HTML, Markdown fences, table pipes, mentions and arbitrary links. Model text cannot supply publishing metadata or a URL. Optional diagrams pass a restricted versioned grammar: plain flowchart nodes/edges or sequence participants/messages; no HTML, links, directives or styling. Invalid diagrams are omitted. GitHub supports [Mermaid fences](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) and [details sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections). Final rendering still needs a live sandbox check.

The default comment budget is 60,000 UTF-8 bytes. Truncation removes whole lowest-priority findings, including their matching table rows/details, reports the omitted count and preserves closing markup and the footer. A report with omitted findings is partial.
