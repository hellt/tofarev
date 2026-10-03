# Install and roll back ToFaRev

The runtime is a reusable GitHub Actions workflow. OpenCode runs once per authorized comment inside an isolated Docker container on a GitHub-hosted Ubuntu runner. There is no continuously running service, webhook server or subscription to PR pushes.

## 1. Publish the bot code

Push this repository to a GitHub repository accessible to Containerlab Actions. Use a reviewed full 40-character commit SHA for both the reusable workflow invocation and its `bot_ref` input. Public visibility is simplest; private reusable workflows require GitHub's access configuration and the bot checkout must be accessible to the caller token. The supplied workflow assumes a publicly readable bot repository.

Run the checks in [runtime.md](runtime.md) before choosing the pinned commit. The reusable workflow builds the Dockerfile from that revision; it never checks out or executes the PR head.

## 2. Register the GitHub App

Register an App under an appropriate personal or organization owner. Request the display name **ToFaRev**; GitHub name availability must be checked during registration. The default configuration expects `tofarev[bot]`. If the actual App slug differs, set `appSlug` in trusted_config and confirm the resulting bot login during the sandbox test.

Set a homepage URL pointing to the bot repository. Disable **Active** webhooks: this design uses Actions comment events and does not require a callback service. Do not request user authorization/OAuth permissions. Grant repository **Contents: read** and **Pull requests: read and write**; Metadata read is implicit. No organization/account permissions are needed. Install only on the sandbox repository first, then select `srl-labs/containerlab` for rollout.

Upload the desired custom Nebius logo as the App avatar in its settings. Use an approved Nebius asset; the avatar is configured on GitHub, not in generated Markdown. The source tree does not pretend that the App name is reserved or an avatar is already installed. The rendered footer always links to Nebius Token Factory.

## 3. Configure credentials

Generate an App private key and add it as repository Actions secret `TOFAREV_APP_PRIVATE_KEY` in the target repository. Add the App's Client ID as repository Actions variable `TOFAREV_APP_CLIENT_ID`.

The existing Containerlab repository secret **`TOFAREV_API_KEY`** is the inference credential. Keep that name. For the sandbox, add the same-named secret there independently. No PAT is required. The preparation/finalization jobs mint short-lived App installation tokens scoped to the current repository and revoke them at job completion. The inference job receives only the Token Factory secret; it does not receive the App key or installation token.

The internal CLI environment variable for an installation token is `TOFAREV_GITHUB_TOKEN`. This is set by the workflow action output, not a repository secret you must create.

## 4. Verify the model and generate the consumer workflow

Run the opt-in [model probe](evaluation.md) in an environment with the inference key. A secret stored on GitHub cannot be read back for local use. Complete the [sandbox checklist](smoke-test.md) before production rollout.

Generate the exact consumer YAML using the published bot repository and reviewed commit:

```sh
npm run build
node dist/src/cli.js consumer YOUR_OWNER/YOUR_BOT_REPO YOUR_40_CHARACTER_COMMIT_SHA > /tmp/tofarev.yml
```

Both arguments are validated; placeholders or a branch name fail. Review `/tmp/tofarev.yml`, then install it as `.github/workflows/tofarev.yml` on Containerlab's **default branch**. The [illustrative example](examples/containerlab-workflow.yml) uses dummy `owner/tofarev` and `aaaa…` values and must not be installed unchanged.

The generated caller uses `issue_comment: types: [created]`, a coarse author/PR/command gate and explicit secret forwarding. The reusable workflow performs the exact trimmed-command, human-author, repository name/ID and current-comment validation. The caller's `contents: read` permission permits bot checkout; publication uses only the App token. Repository Actions policy must permit the pinned actions/reusable workflow.

Reusable inputs:

| Input | Use |
| --- | --- |
| `bot_repository` | Repository containing this implementation; use public visibility |
| `bot_ref` | Full reviewed commit SHA, same as the `uses` pin |
| `app_client_id` | App Client ID from `vars.TOFAREV_APP_CLIENT_ID` |
| `trusted_config` | Optional JSON matching [configuration.md](configuration.md); default `{}` selects Containerlab |

Explicit secrets: `TOFAREV_API_KEY` and `TOFAREV_APP_PRIVATE_KEY`. Do not use `secrets: inherit`.

## 5. Operate and roll back

An allowed user posts `/tofarev review` in the PR conversation. A status comment becomes the final report. Rerun a failed workflow to reuse the recorded revision/comment; a new command comment requests a review of the current head. Completed/partial requests are idempotent. See [request lifecycle](requests.md) for deletion and cancellation limits.

To stop new reviews, disable/remove the consumer workflow on the default branch. Cancel active runs if required; cancellation can leave a running status comment. To revoke publication, suspend/uninstall the App from the repository or revoke its private key and delete `TOFAREV_APP_PRIVATE_KEY`. To revoke inference, revoke the Token Factory key and remove/replace `TOFAREV_API_KEY`. Roll back bot code by restoring a previously reviewed workflow SHA and matching `bot_ref`. Existing reports remain visible.
