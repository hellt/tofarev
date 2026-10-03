import { Repo, Sha } from './types.js';
export function consumerWorkflow(repository: string, ref: string) {
  Repo.parse(repository); Sha.parse(ref);
  return `# Install on the target repository's default branch.
name: ToFaRev
on:
  issue_comment:
    types: [created]
permissions:
  contents: read
  actions: read
jobs:
  review:
    if: >-
      github.event.issue.pull_request &&
      github.event.comment.user.type == 'User' &&
      contains(fromJSON('["hellt","flosch62","kaelemc"]'), github.event.comment.user.login) &&
      contains(github.event.comment.body, '/tofarev review')
    uses: ${repository}/.github/workflows/review.yml@${ref}
    with:
      bot_repository: ${repository}
      bot_ref: ${ref}
      app_client_id: \${{ vars.TOFAREV_APP_CLIENT_ID }}
      trusted_config: '{"shareSessions":true}'
    secrets:
      TOFAREV_API_KEY: \${{ secrets.TOFAREV_API_KEY }}
      TOFAREV_APP_PRIVATE_KEY: \${{ secrets.TOFAREV_APP_PRIVATE_KEY }}
`;
}
