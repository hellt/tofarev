# Report previews

Run `npm run preview` or `npm run preview -- partial`. To save clean Markdown without npm's log preamble:

```sh
npm run build
node dist/src/cli.js preview findings > /tmp/tofarev-preview.md
```

Supported examples: [findings](examples/findings.md), [empty](examples/empty.md), [partial](examples/partial.md), [stale](examples/stale.md), [failed](examples/failed.md). They deliberately use illustrative file names and SHAs, so their links demonstrate syntax rather than real revisions. Production links use recorded commits and validated file/line ranges.

Each finding is a `PX - Summary` table row with an immutable source link and a matching default-collapsed details block. Details cover problem/evidence, trigger, impact and a proportionate correction. The report orders P0 through P4; an empty list is valid. Failed or partial analysis cannot present itself as a clean complete review. The footer is always `Powered by Nebius Token Factory`, linking to the service.

Model text is escaped as literal text, including HTML, Markdown fences, table pipes, mentions and arbitrary links. Model text cannot supply publishing metadata or a URL. Optional diagrams pass a restricted versioned grammar: plain flowchart nodes/edges or sequence participants/messages; no HTML, links, directives or styling. Invalid diagrams are omitted. GitHub supports [Mermaid fences](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) and [details sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections). Final rendering still needs a live sandbox check.

The default comment budget is 60,000 UTF-8 bytes. Truncation removes whole lowest-priority findings, including their matching table rows/details, reports the omitted count and preserves closing markup and the footer. A report with omitted findings is partial.
