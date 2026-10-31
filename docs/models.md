# Model selection

ToFaRev runs one Token Factory model for each review or digest. Trusted configuration sets the default model. An allowed commenter can request a different model for one review.

## Request a model for one review

Add `model=` to the review command, on the same line:

```text
/tofarev review model=glm 5.3
/tofarev review model=z.ai/glm-5.3
/tofarev review model=kimi k3
/tofarev review model="deepseek v4.1 flash"
```

The status comment shows the requested selector. The final report names the model that ran, for example ``Reviewed 1a2b3c4d5e6f with `zai-org/GLM-5.3` ``. If the selector does not resolve, the review stops before inference. The report then shows the reason and the available models, below the failure notice.

## Default model

Set `model` in trusted configuration. The default is `zai-org/GLM-5.3-Flash`. An exact model ID is used without a catalog lookup. Any other value is resolved with the rules below. The digest workflow uses the same setting:

```json
{ "model": "zai-org/GLM-5.3" }
```

## Mappings reference

Each rule below links to the code that defines it. [`test/docs.test.ts`](../test/docs.test.ts) fails if a link no longer points at its symbol. It also fails if an example in the [examples table](#examples) does not resolve as documented.

### Command syntax

[`parseCommand`](../src/requests.ts#L12-L19) accepts these forms. Admission and the trigger re-check both use it.

| Comment | Result |
| --- | --- |
| `/tofarev review` | Default model |
| `/tofarev review model=glm 5.3` | Selector `glm 5.3`, to the end of the line |
| `/tofarev review model = glm 5.3` | Spaces around `=` are accepted |
| `/tofarev review model="glm 5.3"` or `model='glm 5.3'` | Quotes are removed |
| Any other text, a second line, or `model=` with an invalid selector | The comment is ignored |

### Selector and model ID syntax

| Rule | Definition |
| --- | --- |
| A selector is 1–64 characters. It starts with a letter or digit, then contains only letters, digits, spaces, and `.` `_` `/` `:` `-`. | [`Selector`](../src/models.ts#L11) |
| An exact model ID is `vendor/name`, for example `zai-org/GLM-5.3`. | [`ModelId`](../src/models.ts#L12) |
| The `model` setting uses the same characters, up to 100. | [`model:`](../src/config.ts#L15) |
| The default model is `zai-org/GLM-5.3-Flash`. | [`MODEL`](../src/config.ts#L5) |

### Vendor aliases

[`FAMILIES`](../src/models.ts#L15-L19) maps each vendor (the model ID prefix) to the words that name it. [`ALIAS`](../src/models.ts#L20) is the reverse lookup. A vendor word can come before a slash (`z.ai/glm 5.3`) or stand as a separate word (`z.ai glm 5.3`). Letter case is ignored.

| Vendor | Family | Accepted words |
| --- | --- | --- |
| `zai-org` | GLM | `glm`, `zai`, `z.ai`, `z-ai`, `zhipu`, `zhipuai`, `zai-org` |
| `moonshotai` | Kimi | `kimi`, `moonshot`, `moonshotai`, `moonshot-ai` |
| `deepseek-ai` | DeepSeek | `deepseek`, `deepseek-ai`, `ds` |

### Tokens

[`parse`](../src/models.ts#L31-L49) splits a selector and each catalog ID into tokens. The same rules apply to both.

| Token | Rule | Examples | Definition |
| --- | --- | --- | --- |
| Split | A letter next to a digit starts a new token. Vendor words are kept whole. | `glm5.3` → `glm`, `5.3` | [`replace(/([a-z])(\d)/g`](../src/models.ts#L37) |
| Version | 1–3 digits, with optional `.` parts | `5.3`, `4.1`, `3` | [`isVersion`](../src/models.ts#L27) |
| Revision | 4 or more digits | `0813`, `1017` | [`isRevision`](../src/models.ts#L28) |
| Version prefix | A `v` or `k` directly before a version is removed | `V4.1` → `4.1`, `K3` → `3` | [`(t === 'v' \|\| t === 'k')`](../src/models.ts#L43) |
| Word | Any other token | `flash`, `pro`, `code` | [`out.words.push`](../src/models.ts#L46) |

### Matching

[`resolveModel`](../src/models.ts#L58-L93) applies these rules in order:

1. An exact model ID matches first, with or without the vendor prefix. Letter case is ignored. See [`const exact`](../src/models.ts#L62-L63).
2. A candidate must have the selector's vendor, every word, and every revision. See [`c.vendor !== q.vendor`](../src/models.ts#L69-L71).
3. Each selector version must equal a candidate version, or be its prefix: `5` matches `5.3`. See [`startsWith`](../src/models.ts#L72-L77).
4. Candidate words that the selector does not name are extra words. See [`extra:`](../src/models.ts#L80).
5. If the matches come from more than one vendor and the selector names no vendor, resolution fails. See [`vendors.size > 1`](../src/models.ts#L87).
6. Otherwise the best match wins. See [`scored.sort`](../src/models.ts#L90-L91). The order is:
   1. Exact versions before prefix versions.
   2. Fewer extra words. Thus `glm 5.3` selects `GLM-5.3`, not `GLM-5.3-Flash`.
   3. The higher version. See [`compareVersions`](../src/models.ts#L52-L56).
   4. The newer `created` time in the catalog.
   5. The model ID, alphabetically.

### Candidates

[`fetchCatalog`](../src/models.ts#L97-L105) reads `/v1/models?verbose=true` from Token Factory. It keeps the models of the three vendors that list [`includes('tools')`](../src/models.ts#L102) in their features. Models without tool calls cannot review or write digests. New releases become candidates without a ToFaRev change.

[`selectModel`](../src/models.ts#L107-L115) uses a trusted exact ID without a catalog lookup ([`ModelId.safeParse(selector).success`](../src/models.ts#L110)). It resolves every requested selector against the catalog. If the catalog cannot be read, a requested selector fails.

### Transport and enforcement

| Step | Definition |
| --- | --- |
| The prepare job writes the selector as the `model` job output. | [`output('model'`](../src/cli.ts#L32) |
| The reviewer step receives it as an environment variable. | [`TOFAREV_MODEL:`](../.github/workflows/review.yml#L126) |
| The container receives it with `--env`. | [`--env TOFAREV_MODEL`](../.github/workflows/review.yml#L140) |
| The CLI gives it to the reviewer. | [`process.env.TOFAREV_MODEL`](../src/cli.ts#L41) |
| The inference proxy rejects any other model. | [`body.model !== model`](../src/opencode.ts#L72) |

## Examples

These examples use the Token Factory catalog of 2026-10-31. They use the same catalog snapshot as [`test/models.test.ts`](../test/models.test.ts#L7-L22).

| Selectors | Model |
| --- | --- |
| `glm5.3`, `glm 5.3`, `GLM-5.3`, `z.ai/glm 5.3`, `z.ai glm 5.3`, `zai/glm5.3`, `Z.AI/GLM-5.3`, `zai-org/GLM-5.3`, `glm`, `glm 5` | `zai-org/GLM-5.3` |
| `glm 5.2` | `zai-org/GLM-5.2` |
| `zhipu glm-5.1` | `zai-org/GLM-5.1` |
| `glm flash`, `glm 5.3 flash`, `GLM5.3-Flash`, `GLM-5.3-Flash` | `zai-org/GLM-5.3-Flash` |
| `kimi`, `kimi k3`, `Kimi-K3`, `moonshot kimi 3` | `moonshotai/Kimi-K3` |
| `kimi k2.6`, `kimi 2.6` | `moonshotai/Kimi-K2.6` |
| `kimi code`, `moonshotai/kimi k2.7 code` | `moonshotai/Kimi-K2.7-Code` |
| `deepseek`, `deepseek v4.1 flash`, `ds flash`, `deepseek-ai/DeepSeek-V4.1-Flash` | `deepseek-ai/DeepSeek-V4.1-Flash-1017` |
| `deepseek v4 flash` | `deepseek-ai/DeepSeek-V4-Flash-0731` |
| `deepseek pro` | `deepseek-ai/DeepSeek-V4-Pro` |
| `deepseek v4 pro 0813`, `DeepSeek-V4-Pro-0813` | `deepseek-ai/DeepSeek-V4-Pro-0813` |

Notes on the examples:

- `glm` and `glm 5` select `GLM-5.3`: the highest version without extra words.
- `deepseek-ai/DeepSeek-V4.1-Flash` selects the `-1017` release, because the undated model has no tool calls.
- `deepseek pro` selects `DeepSeek-V4-Pro` over `DeepSeek-V4-Pro-0813`, because its catalog entry is newer. A revision is not an extra word.

| Selector | Result |
| --- | --- |
| `flash` | Error: ambiguous. GLM and DeepSeek both have Flash models. |
| `glm 9` | Error: no match. The message lists the GLM models. |
| `qwen 3.5`, `Qwen/Qwen3.5-397B-A17B`, `gpt-oss-120b` | Error: no match. Only Kimi, GLM, and DeepSeek models are candidates. |
| `glm; rm -rf /` | Error: invalid selector. The command is also ignored at admission. |

## Security

- Only allowed users can request a model. The request uses the same admission checks as `/tofarev review`.
- The prepare job checks the selector syntax. The workflow passes the selector only as an environment variable, never inside a script.
- The resolver checks the syntax again. It accepts only Kimi, GLM, and DeepSeek models with tool calls.
- The inference proxy sends requests only for the resolved model.
