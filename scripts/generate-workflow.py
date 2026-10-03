# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Generate the Containerlab caller workflow without building the bot."""

import argparse
import re
import sys


def repository(value: str) -> str:
    if len(value) > 201 or not re.fullmatch(
        r"[A-Za-z0-9][\w.-]*/[A-Za-z0-9][\w.-]*", value, re.ASCII
    ):
        raise argparse.ArgumentTypeError("expected a GitHub repository as OWNER/REPO")
    return value


def commit(value: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{40}", value):
        raise argparse.ArgumentTypeError("expected a full 40-character lowercase commit SHA")
    return value


WORKFLOW = """# Install on the target repository's default branch.
name: ToFaRev
on:
  issue_comment:
    types: [created]
permissions:
  contents: read
jobs:
  review:
    if: >-
      github.event.issue.pull_request &&
      github.event.comment.user.type == 'User' &&
      contains(fromJSON('["hellt","flosch62","kaelemc"]'), github.event.comment.user.login) &&
      contains(github.event.comment.body, '/tofarev review')
    uses: __BOT_REPOSITORY__/.github/workflows/review.yml@__BOT_REF__
    with:
      bot_repository: __BOT_REPOSITORY__
      bot_ref: __BOT_REF__
      app_client_id: ${{ vars.TOFAREV_APP_CLIENT_ID }}
    secrets:
      TOFAREV_API_KEY: ${{ secrets.TOFAREV_API_KEY }}
      TOFAREV_APP_PRIVATE_KEY: ${{ secrets.TOFAREV_APP_PRIVATE_KEY }}
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", type=repository, help="published bot repository: OWNER/REPO")
    parser.add_argument("commit", type=commit, help="reviewed, published full commit SHA")
    args = parser.parse_args()
    sys.stdout.write(
        WORKFLOW.replace("__BOT_REPOSITORY__", args.repository).replace("__BOT_REF__", args.commit)
    )


if __name__ == "__main__":
    main()
