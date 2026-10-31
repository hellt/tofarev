# Conference digests

ToFaRev also writes conference digests for [hellt/conference-digest](https://github.com/hellt/conference-digest). That repository fetches conference programs and composes one prompt per edition at `prompts/<key>.md`. The digest workflow runs that prompt with Token Factory and returns the digest as a workflow artifact. The caller decides what to do with the artifact. Conference Digest opens a pull request with it.

## Components

- Digest workflow: the reusable workflow `.github/workflows/digest.yml`.
- Digest writer: the `digest` CLI command inside the review container.
- Caller prompt: `prompts/<key>.md` at the caller commit `source_ref`.

## Stages

A program can be 800 kB, which is larger than the 100,000-token context window. The digest writer therefore uses stages:

1. **Parse.** The writer drops the run note and splits the prompt at the `PROGRAM TEXT` separator. Each `### ` heading starts one program item. A `## ` heading names the group of the items that follow. A pasted program without this structure is split into paragraph runs.
2. **Shortlist.** Programs above 120,000 characters go into batches of about 80,000 characters. Three parallel calls each return a JSON shortlist of item IDs with provisional tiers. The writer ignores unknown IDs.
3. **Select.** When more than 30 items are on the shortlist, one call selects at most 25 final picks.
4. **Write.** OpenCode receives the caller instructions as the system prompt, followed by the selected items. Smaller programs go to this step whole.
5. **Check.** Deterministic code produces the final Markdown. The model cannot change these checks.

The write step uses one OpenCode agent. Its only tool is `webfetch`, for the best-effort enrichment that the caller prompt asks for. The agent has no file, shell, or search tools. The writer instructions limit fetches to `page:` and `pdf:` URLs from the selected items. These instructions are a model control, not a network control. If OpenCode returns no usable digest, one tool-free call writes from the program text.

## Checks

The check step does these operations:

- It removes any metadata block that the model wrote. Then it adds the block from the caller prompt, with `generated` set to the run date and `written_by: ToFaRev (zai-org/GLM-5.3-Flash)` added.
- It removes text before the first heading and an enclosing code fence.
- It reduces a Markdown link to plain text when its URL is not in the program text.
- It compares each `### ` heading with the program item titles. It does not remove an unmatched heading. It adds a note, so that a person can examine the heading in the pull request.
- It adds a note when the `## Core` or `## Themes` section is missing. A missing `## Themes` section usually means truncated output.

Notes, counts, and the stage statistics go into `result.json` next to `digest.md`.

## Budgets

The run shares one inference proxy and the [runtime limits](runtime.md). The default deadline is 30 minutes, and the job timeout is 45 minutes. Near the deadline, the proxy removes tools and requests an immediate answer. Each stage call has one repair attempt when its JSON is invalid. A failed shortlist batch adds a note and its items are not considered. A failed selection call gives the first 40 shortlisted items, ordered by tier, to the writer.

Output is capped at 16,384 tokens, including reasoning. If digests end without `## Themes`, set `"reasoningEffort":"low"` in `trusted_config`.

## Caller workflow

The caller passes a registry key and the full commit SHA that contains the prompt. The digest workflow validates both values, checks out only `prompts/<key>.md`, and mounts it read-only into the container.

```yaml
jobs:
  write:
    strategy:
      matrix:
        key: ${{ fromJSON(needs.queue.outputs.keys) }}
    permissions:
      contents: read
    uses: hellt/tofarev/.github/workflows/digest.yml@FULL_COMMIT_SHA
    with:
      bot_repository: hellt/tofarev
      bot_ref: FULL_COMMIT_SHA
      key: ${{ matrix.key }}
      source_ref: ${{ needs.queue.outputs.source_ref }}
      trusted_config: '{"repository":"hellt/conference-digest"}'
    secrets:
      TOFAREV_API_KEY: ${{ secrets.TOFAREV_API_KEY }}
```

The artifact `tofarev-digest-<key>` contains `digest.md` and `result.json`. A later caller job downloads it. The digest workflow has `contents: read` only, and it does not write to the caller repository.

## Local run

Run the writer on a prompt file with a real key:

```sh
npm run build
TOFAREV_API_KEY=... node dist/src/cli.js digest ../conference-digest/prompts/netdev-0x1a.md > /tmp/result.json
node dist/src/cli.js digest-files /tmp/result.json /tmp/digest
```

`npm test` covers parsing, staging, and the checks with a fake model. `npm run test:opencode` runs the pinned OpenCode CLI against a fake provider. That test confirms that `webfetch` is the only tool and that a fetch reaches its page. It also confirms that the key stays in the proxy and that the staged path and the tool-free retry work. These tests do not measure the quality of real digests.
