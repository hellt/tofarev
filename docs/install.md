# Install and roll back ToFaRev

The runtime is a reusable GitHub Actions workflow. OpenCode runs once per authorized comment inside an isolated Docker container on a GitHub-hosted Ubuntu runner. There is no continuously running service, webhook server or subscription to PR pushes.

Setup has three parts: publish this code, register the GitHub App that supplies the bot identity, and add a caller workflow to Containerlab. Pushing this repository alone does not activate reviews. GitHub Actions builds the TypeScript and Docker image automatically for each accepted review request.

## 1. Publish the bot code

Push this repository to a GitHub repository accessible to Containerlab Actions. Use a reviewed full 40-character commit SHA for both the reusable workflow invocation and its `bot_ref` input. Public visibility is simplest; private reusable workflows require GitHub's access configuration and the bot checkout must be accessible to the caller token. The supplied workflow assumes a publicly readable bot repository.

Run the checks in [runtime.md](runtime.md) before choosing the pinned commit. The reusable workflow builds the Dockerfile from that revision; it never checks out or executes the PR head.

Installing the caller workflow does **not** require npm or a local bot build. The Python generator in step 4 runs with `uv` and has no package dependencies. GitHub Actions handles the bot build.

For optional local development, use Node.js 24.20.0 and run:

```sh
npm ci --ignore-scripts
npm run build
```

This produces `dist/`. Keep generated build output out of Git; the runner rebuilds it from the pinned source. Publishing to npm or a container registry is not required by this workflow.

## 2. Register the GitHub App

### Open the registration form

Sign in to GitHub, then choose the App owner:

- **Your personal account:** [Create a GitHub App](https://github.com/settings/apps/new).
- **The srl-labs organization:** [Create an srl-labs GitHub App](https://github.com/organizations/srl-labs/settings/apps/new). You need organization-owner access or permission to manage its Apps.

The navigation path is **Settings → Developer settings → GitHub Apps → New GitHub App**. See [GitHub's registration guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) for account/organization navigation.

### Fill in the form

Replace `YOUR_OWNER/tofarev` below with the actual repository containing this bot.

| Field | Enter or select |
| --- | --- |
| GitHub App name | `ToFaRev`, if available |
| Description | `On-demand Containerlab pull request reviews powered by Nebius Token Factory.` |
| Homepage URL | `https://github.com/YOUR_OWNER/tofarev` |
| Callback URL | Leave blank |
| Expire user authorization tokens | Keep the default |
| Request user authorization (OAuth) during installation | Unchecked |
| Enable Device Flow | Unchecked |
| Setup URL | Leave blank |
| Redirect on update | Unchecked |
| Webhook → Active | **Unchecked** |
| Webhook URL and Webhook secret | Leave blank; unused with webhooks disabled |
| Repository permissions → Contents | **Read-only** |
| Repository permissions → Pull requests | **Read and write** |
| Repository permissions → Metadata | Keep automatic read-only access |
| Other repository, organization, and account permissions | No access |
| Subscribe to events | No subscriptions; Actions handles the comment event |
| Where can this GitHub App be installed? | **Any account** if personally owned and destined for srl-labs, or if your sandbox is under another account. **Only on this account** works when all target repositories belong to the App owner. |

Click **Create GitHub App**. No Marketplace listing is required for this setup. [GitHub's installation guide](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app) explains the installation-scope choices.

The default configuration expects the resulting bot login to be `tofarev[bot]`. If you choose another name, use its actual slug as `appSlug` in the caller's `trusted_config`; for example, `{"appSlug":"tofarev-srl-labs"}`. Confirm the login during the sandbox test.

### Set the avatar and install the App

On the App's settings page, upload the desired approved Nebius logo as its avatar. The report footer is supplied by the bot code independently of the avatar.

In the App settings sidebar, select **Install App**, choose the account containing the target repository, select **Only select repositories**, choose that repository, and click **Install**. Start with your sandbox. For production, choose the **srl-labs** account and **containerlab** repository. If that account is unavailable, check the installation-scope choice above and ask an organization owner to perform or approve the installation.

You can reopen the App's settings from [your personal GitHub Apps page](https://github.com/settings/apps) or [srl-labs GitHub Apps settings](https://github.com/organizations/srl-labs/settings/apps), then click **Edit** beside the App. Its public page is `https://github.com/apps/APP_SLUG`, with `APP_SLUG` replaced by its actual slug.

## 3. Configure credentials

On the App's **General** settings page:

1. Copy the **Client ID** shown near the top. The workflow expects this Client ID, not the App ID or an OAuth client secret.
2. Scroll to **Private keys** and click **Generate a private key**. GitHub downloads a `.pem` file. This is the GitHub credential; it is separate from your Nebius key. See [GitHub's private-key instructions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).

Configure these values in **Containerlab**, where the caller workflow runs:

| Location | Name | Value |
| --- | --- | --- |
| Repository Actions secret | `TOFAREV_API_KEY` | Your existing Nebius Token Factory key; keep the configured secret |
| Repository Actions secret | `TOFAREV_APP_PRIVATE_KEY` | Entire downloaded `.pem` contents, including the BEGIN/END lines and original line breaks |
| Repository Actions variable | `TOFAREV_APP_CLIENT_ID` | The GitHub App's Client ID |

To add the private key, open [Containerlab Actions secrets](https://github.com/srl-labs/containerlab/settings/secrets/actions), click **New repository secret**, enter the name and PEM contents, then click **Add secret**. To add the Client ID, open [Containerlab Actions variables](https://github.com/srl-labs/containerlab/settings/variables/actions), click **New repository variable**, enter the name and Client ID, then click **Add variable**. Both pages are under **Repository Settings → Secrets and variables → Actions**. [GitHub's secret setup guide](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) covers the required access.

For a sandbox, use the same settings pages under your sandbox repository instead. Keep the downloaded private key outside the source repository; it belongs in the Actions secret, not a committed file.

The existing Containerlab repository secret **`TOFAREV_API_KEY`** is the inference credential. Keep that name. For the sandbox, add the same-named secret there independently. No PAT is required. The preparation/finalization jobs mint short-lived App installation tokens scoped to the current repository and revoke them at job completion. The inference job receives only the Token Factory secret; it does not receive the App key or installation token.

The internal CLI environment variable for an installation token is `TOFAREV_GITHUB_TOKEN`. This is set by the workflow action output, not a repository secret you must create.

## 4. Verify the model and generate the consumer workflow

Run the opt-in [model probe](evaluation.md) in an environment with the inference key. A secret stored on GitHub cannot be read back for local use. Complete the [sandbox checklist](smoke-test.md) before production rollout.

From your local ToFaRev checkout, generate the exact consumer YAML with [uv](https://docs.astral.sh/uv/getting-started/installation/):

```sh
uv run scripts/generate-workflow.py hellt/tofarev "$(git rev-parse HEAD)" > /tmp/tofarev.yml
```

This uses `hellt/tofarev` and the current checkout's full commit SHA. Ensure that commit is reviewed and pushed to the bot repository first. For a different bot repository or revision, replace the two arguments. The generator validates their format; it does not check whether the commit is published. Branch names such as `main` are rejected.

Install the generated file in Containerlab:

1. Review `/tmp/tofarev.yml`.
2. In a Containerlab checkout, copy it to `.github/workflows/tofarev.yml`, commit it, and push it through the repository's normal review process. Alternatively, use GitHub's **Add file → Create new file**, name it `.github/workflows/tofarev.yml`, and paste the generated YAML.
3. Get the file onto Containerlab's **default branch** (`main`). A workflow present only in a pull request will not receive these comment events.
4. Confirm the two Actions secrets and Client ID variable from step 3 are configured, and the GitHub App is installed on Containerlab.
5. As `hellt`, `flosch62`, or `kaelemc`, submit a new PR conversation comment containing exactly `/tofarev review`. The **ToFaRev** workflow should appear in Containerlab's **Actions** tab, and the App should post a status comment followed by the review.

The [illustrative example](examples/containerlab-workflow.yml) uses dummy `owner/tofarev` and `aaaa…` values and must not be installed unchanged. You do not need to copy the bot source into Containerlab; the caller references the pinned workflow in the bot repository.

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
