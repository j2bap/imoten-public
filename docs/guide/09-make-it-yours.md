# Make the workflows yours

Project skills belong under `.agents/skills/`. They remain separate from the installed plugin, so a plugin upgrade does not overwrite them.

Start smaller than you think. You do not need many skills on day one. Prompt plainly, watch where agents fail, and add a skill or a check when the same failure shows up twice.

## Draft a personal mode

```text
$automate-me create a project mode from my stated preferences and the supported recent task history for this repository.
```

`$automate-me` uses supported Codex task APIs when available. If those APIs are unavailable, it asks for a digest or skips history mining and states the gap. It never searches unsupported host storage.

The draft goes to `.agents/skills/<handle>-mode/` or an existing project category. Review the draft before any commit or pull request. `$automate-me` does not gain push authority from the authoring request.

## Fix the environment with `$correct`

When you correct agents for the same mistake again and again, the fix belongs in the repo, not in your next prompt. Rank the options by how well they hold:

1. Make the mistake impossible with architecture or a better data structure.
2. Block it with types, or with a lint or CI check whose error names the fix.
3. Catch it with a test.
4. Write it down as a doc or agent rule. Nothing fails when an agent skips a rule, so this comes last.

Human review is not on the list. A reviewer who must catch the same mistake on every PR is the problem this fixes. [`$correct`](../../skills/correct/SKILL.md) does the work:

```text
$correct agents keep calling the database client directly instead of going through the repository layer
```

It reads recent commits, reverts, review comments, and comments that explain workarounds, then groups the mistakes into classes. A class counts once it has happened twice. It fixes the most frequent classes one commit each, at the highest level that works, and proves each new check fails on a real past mistake. It also keeps a table in the agent instruction file that pairs each rule with what enforces it, so a rule that nothing enforces shows up as a repeat.

Run it with no argument and it finds the classes from history on its own. `$reflect` and `$correct` split the work. `$reflect` improves skills from one session. `$correct` changes the repo so a mistake class cannot come back. Pair it with `$architect` when the fix is a new boundary.

## Capture a lesson with `$reflect`

```text
$reflect review this task for a reusable workflow correction.
```

`$reflect` collects the current task through supported history or a bounded digest. It presents accepted, rejected, and backlog findings before editing a skill. The user must approve any skill edit because the change affects later tasks.

## Create a focused skill

Use the installed `skill-creator` when available, or ask Codex to follow the repository's skill-authoring requirements. Keep the skill explicit-only unless you have a clear reason for automatic invocation. Add `agents/openai.yaml`, use relative resource paths, and test from an installed cache-like copy.

Use `$technical-writing` for documentation and `$unslop` for the final prose pass. Use the [authoring-a-skill playbook](../../skills/poteto-mode/playbooks/authoring-a-skill.md) when the change needs a full plan and evaluation.

When a skill keeps missing and you know what it should do, change and test it in one task:

```text
$imoten:poteto-mode update the review skill so it flags missing migrations, and eval the change.
```

Asking for the eval up front keeps the edit honest. A fix written from one bad session tends to overfit that session, and over many edits the skill drifts. The [eval playbook](../../skills/poteto-mode/playbooks/eval.md) catches the drift before it ships. Use the same check before you adopt someone else's skill.

Two special cases have their own generators. A skill that must drive your app and prove behavior is a verification skill, so use [`$create-verification-skill`](../../skills/create-verification-skill/SKILL.md) and [`$maintain-verification-skill`](../../skills/maintain-verification-skill/SKILL.md). A skill that checks a property of your code with a model checker, a proof, or another verifier is a formal verification skill, so use [`$create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md) and [`$maintain-formal-verification-skill`](../../skills/maintain-formal-verification-skill/SKILL.md). [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers both kinds.

## Keep provenance separate

Do not edit [`upstream.lock.json`](../../upstream.lock.json) to describe a local customization. The lock records the imported source. Put derivative behavior in the compatibility map, tests, and adaptation notes. [UPSTREAM.md](../../UPSTREAM.md) covers refreshes.

Next: [Use the recipes and avoid the pitfalls](./10-recipes-and-pitfalls.md).
