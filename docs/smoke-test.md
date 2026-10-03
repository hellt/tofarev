# Live sandbox acceptance

Status: **not run**. Local fake-provider and container tests do not verify live Token Factory model entitlement, GitHub App identity/avatar, GitHub permissions or Markdown rendering. The existing Containerlab `TOFAREV_API_KEY` secret was reported by the user; its value/access has not been inspected.

Prerequisites: a public test repository you control, the App installed only there, App Client ID/private key configured as in [install.md](install.md), the Token Factory key under `TOFAREV_API_KEY`, and a published reviewed bot commit. Never put a secret in test source or a workflow input.

1. Get the sandbox identity with `gh api repos/OWNER/REPO --jq '{repository: .full_name, repositoryId: .id}'`.
2. Generate the consumer workflow using the real bot owner/repository and full commit SHA. In its `with:` block add this trusted configuration, substituting the sandbox's actual name and ID:

   ```yaml
   trusted_config: >-
     {"repository":"OWNER/REPO","repositoryId":123456789,"appSlug":"tofarev"}
   ```

   Keep the three allowed users. Have one of them run the test. If testing with a different account is necessary, explicitly set `allowedUsers` in this sandbox config and update the caller's coarse user gate to the same list; restore production defaults for Containerlab. If the App slug differs, set the actual slug.
3. Put the caller on the sandbox default branch. Include `.cursor/rules/karpathy-guidelines.mdc` and `.cursor/rules/ponytail.mdc` there so a complete review can load its standards. A missing rule should instead produce partial coverage.
4. Run `TOFAREV_LIVE=1 npm run probe` with the key in the local environment, then the opt-in evaluation command. Record model access/tool/schema results and evaluation scores; never paste the key in results.
5. Open a PR with a clear introduced bug and a small user-facing change lacking docs/schema where applicable. Include a hostile `.opencode` plugin and `opencode.json` containing a harmless sentinel write to `/tmp/tofarev-hostile-config-ran`; its execution must never occur. PR data must not change the review policy or tools. Add a removed file to check base links and a binary change to check partial coverage.
6. Post `/tofarev review` as an allowed user in the PR conversation. Observe the three jobs and one bot status comment changing into a report. Do not run the consumer from the PR branch.
7. Record pass/fail and the run/comment URLs for each check below. Open the linked files and expand every finding. Check an optional safe Mermaid diagram if the model returns one; otherwise paste `docs/examples/findings.md` as a manual sandbox comment to verify the renderer's example. That example's dummy SHA links are intentionally not live.
8. Rerun the completed workflow; it must not call inference or create another report. Post a new command, add a commit while it runs, and verify the resulting review links to the original head with a stale notice. Try an unauthorized user's exact command, a quoted command, an edited comment, an issue comment and a diff-line comment: none should create a report or call inference.
9. Temporarily substitute an invalid sandbox inference key and request another review. Expect a failed report, sanitized logs and no fallback. Restore the key. Remove App permission in the sandbox and verify publication fails without claiming success; restore permissions and rerun for recovery.
10. Only after all checks pass, install the production caller with default Containerlab config and its existing `TOFAREV_API_KEY` mapping.

| Live check | Status | Evidence |
| --- | --- | --- |
| Exact model access, tool calls and structured result | Pending | |
| Prompt-evaluation expected findings/false positives/severity/coverage | Pending | |
| App login `tofarev[bot]` (or configured slug), name and Nebius avatar | Pending | |
| Contents read, Pull requests write; installation limited to test repo | Pending | |
| P0–P4 summary table and matching collapsed details | Pending | |
| Actual head and deleted-line SHA links open correctly | Pending | |
| Mermaid renders safely when included | Pending | |
| Linked Powered by Nebius Token Factory footer | Pending | |
| One comment per request; completed rerun skips inference | Pending | |
| New head produces stale notice with immutable original links | Pending | |
| Unauthorized/edited/quoted/non-PR commands ignored | Pending | |
| Partial/failed results and publisher recovery are truthful | Pending | |
| Hostile config does not execute; logs contain no credentials | Pending | |
