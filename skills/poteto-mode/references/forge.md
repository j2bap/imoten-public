# Forge operations

Use this reference before a playbook creates, edits, views, watches, or merges a pull request. GitLab calls the object a merge request. This file uses PR for both names.

## Select the forge once

1. Run `git remote get-url origin` and read the host.
2. For a GitLab remote, run `glab repo view`. Select GitLab only when the command resolves the repository.
3. For a GitHub remote, run `gh repo view`. Select GitHub only when the command resolves the repository.
4. If a GitHub repository already uses Graphite and `gt log short` resolves its stack, `gt` may manage stack metadata. GitHub still owns review, checks, and merge state.
5. Keep the selected forge for every PR operation in the task. If its CLI stops resolving the repository, stop before the next external write and report the command error.

Do not select a forge because its CLI happens to be installed.

## Use a base-branch stack

A stack is a chain of base branches. The root PR targets trunk. Each child PR targets its parent branch and starts from the parent's exact tip. One actor owns base changes for the whole chain.

## Use the matching commands

| Operation | GitLab | GitHub |
|---|---|---|
| Create ready | `glab mr create --target-branch <base> --yes` | `gh pr create --base <base>` |
| Change base | `glab mr update <mr> --target-branch <base> --yes` | `gh pr edit <pr> --base <base>` |
| Mark ready | `glab mr update <mr> --ready --yes` | `gh pr ready <pr>` |
| Read state | `glab mr view <mr> --output json` | `gh pr view <pr> --json state,mergedAt,mergeStateStatus,statusCheckRollup,autoMergeRequest` |
| Read open threads | `glab mr view <mr> --comments --unresolved` | `scripts/watch-pr/watch-pr --status-only <pr>` |
| Wait for checks | `glab ci status --branch <head-branch> --wait` | `gh pr checks <pr> --watch` |
| Squash now | `glab mr merge <mr> --squash --sha <head-sha> --auto-merge=false --yes` | `gh pr merge <pr> --squash --match-head-commit <head-sha>` |
| Squash after checks | `glab mr merge <mr> --squash --sha <head-sha> --auto-merge --yes` | `gh pr merge <pr> --squash --auto --match-head-commit <head-sha>` |

Omit `--draft` when you create a ready PR. Before a merge, re-read the PR and pass the reviewed head SHA to the merge command. External writes still require the authority in the runtime contract.

## Built-in PR tools

When the runtime provides a PR tool, use it for create, edit, retarget, and mark-ready operations that it supports. Follow its instructions and set `draft: false` on creation. Use the selected forge for other operations and when no PR tool exists. Read the PR state before you report it. This rule does not add authority to publish a PR.
