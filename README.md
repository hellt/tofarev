# ToFaRev

On-demand Containerlab PR reviews using Nebius Token Factory and GLM-5.3-Flash, orchestrated by OpenCode in GitHub Actions.

`hellt`, `flosch62` or `kaelemc` posts `/tofarev review` in a PR conversation. ToFaRev reviews that recorded revision and updates one bot-owned comment with P0–P4 findings, a summary table, expandable details, immutable source links and the Token Factory footer. Optional diagrams use GitHub Mermaid syntax.

The canonical [review policy](prompts/containerlab-review.md) checks correctness, clarity, performance, repository Karpathy/Ponytail rules, documentation and topology/schema consistency. Source is treated as data; PR code is never executed.

```sh
npm ci --ignore-scripts
npm run check
npm run test:opencode
npm run test:e2e
npm run test:container
npm run preview
```

Requires Node.js 24.20.0. Docker is used for the production reviewer. No server or always-on OpenCode process is needed.

- [Installation and rollback](docs/install.md)
- [Sandbox smoke test](docs/smoke-test.md)
- [Settings and secrets](docs/configuration.md)
- [Request lifecycle](docs/requests.md)
- [Source context and limits](docs/source-context.md)
- [Runtime isolation and compatibility](docs/runtime.md)
- [Reports and previews](docs/reports.md)
- [Live model probe and prompt evaluation](docs/evaluation.md)

Local implementation does not install a GitHub App or activate reviews in Containerlab. The existing `TOFAREV_API_KEY` repository secret is the inference secret used by the consumer workflow.

OpenSpec's shared skills/commands and `openspec/` planning files can be versioned. Do not blanket-ignore agent dot directories containing shared instructions. Ignore credentials, local caches and generated state instead; see `.gitignore`.
