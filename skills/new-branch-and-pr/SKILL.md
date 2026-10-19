---
name: new-branch-and-pr
description: "Use to start new work on a fresh branch from the latest trunk and finish it as a ready PR. A thin entry: poteto-mode's opening-a-pr playbook owns commits, the PR body, and the forge steps."
---

# New branch and PR

Delegation, lifecycle, isolation, history, and capability fallbacks follow [the runtime contract](../poteto-mode/references/codex-agent-runtime.md). This skill runs in the parent. Its fallback is `sequential-parent`.

## Trigger

You are starting work that should ship through a clean branch and pull request.

## Owner

The [opening-a-pr playbook](../poteto-mode/playbooks/opening-a-pr.md) owns isolation, commits, `$deslop`, the PR title and body, readiness, and the rule that opening a PR does not start a babysit. This skill adds only the branch start and the final report.

## Workflow

1. **Check the working tree.** Run `git status --porcelain`. If it prints anything, stop and ask how to handle the existing changes. Do not stash, reset, or commit them yourself. Opening-a-pr says to leave unrelated work alone.
2. **Resolve the forge.** Select GitLab or GitHub once through [forge.md](../poteto-mode/references/forge.md).
3. **Find trunk and fetch it.** Read the default branch with `git symbolic-ref --short refs/remotes/origin/HEAD`. If that fails, use `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` or the `default_branch` field of `glab repo view --output json`. Run `git fetch origin <trunk>`.
4. **Create a descriptive branch from the latest trunk.** Read recent branch names and repository guidance for the naming format and any issue-key rule. Run `git switch -c <branch> origin/<trunk>`. For a child in a stack, branch from the parent branch's exact tip instead, as [forge.md](../poteto-mode/references/forge.md) says.
5. **Complete the implementation and tests.** Keep the branch to one change set. Run the closest real test, build, or application path. Record each command and its real exit code.
6. **Commit and open the PR through opening-a-pr.** Follow its commit, cleanup, title, description, and readiness rules. Push with `git push -u origin <branch>`. Create the PR with the selected forge's create command. Put the verification notes in the `## Verification` section.
7. **Read the PR back through the same forge** and confirm that it is open, ready, and targets the intended base.

## Guardrails

- Keep the branch scope focused on one change set.
- Include verification notes before you request review.
- Do not bypass hooks with `--no-verify`.
- Do not start a babysit or a CI loop. Post the URL and stop, unless the user asks for more.

## Stop condition

Stop after the PR is open, ready, and read back through the forge. Also stop when step 1 finds existing changes or step 5 cannot pass its checks.

## Output

Report in this shape:

```text
Forge: GitHub | GitLab
Branch: <name> from <trunk or parent> at <sha>
PR: <url>  base <base>  state <open, ready>
Summary: <one or two lines>
Verification: <command> -> exit <code>, one line per command
Verdict: PASS | FAIL | BLOCKED | INCONCLUSIVE
```

Use the tokens in [verdicts.md](../poteto-mode/references/verdicts.md) for the verification result.
