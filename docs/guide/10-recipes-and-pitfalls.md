# Recipes and pitfalls

Copy these prompts, then replace the nouns and finish conditions with your own.

![A robot follows a recipe card while avoiding marked hazards.](./images/recipes.jpg)

## Understand a subsystem

```text
$how trace cancellation from the API to the worker. Then use $why to explain the retry limit from available history.
```

## Restate a noisy report before touching code

```text
$imoten:poteto-mode read this thread. Restate the underlying issue in your own words, in plain English. Do not change any code yet.
```

A misreading shows up in the restatement, where it costs one message to correct. Keep your own theory to yourself until the agent has stated its own. `$in-your-own-words` asks for the restatement alone, with no playbook.

## Aim a task before it starts

```text
$sharpen write the onboarding doc for the new billing service.
```

The agent asks how an expert would do the task, what you're really after, and whether the ask says too much or too little. It keeps one outside check that the result is right, then does the work.

## Prototype before you pick

```text
$imoten:poteto-mode prototype a few options for the settings layout. Put them behind a switcher and send me screenshots of each.
```

You pick from things that run, not from descriptions. The agent answers its own layout and timing questions along the way.

## Turn a settled design into a plan

```text
$imoten:poteto-mode turn this design into a plan. Small verifiable PRs, each with its own proof.
```

Ask only after the design settles. The plan is the deliverable, and it names the playbook that will execute it.

## Compare a design

```text
$arena compare three isolated designs for this state machine. Judge them on illegal-state prevention, caller migration, and operational evidence. Do not edit production code.
```

## Repro and fix a report with proof

```text
$imoten:poteto-mode repro this with $verify-<app>. If it repros on main, fix it and show me a recording as proof.
```

"If it repros on main" lets the run stop early when the bug is already gone. The recording lets you check the fix before you read the diff.

## Prove a property tests rarely reach

```text
$create-formal-verification-skill the retry queue. a message must never be delivered twice.
```

You get one property checked in every case within a stated scope, a counterexample in your code's terms if the code already breaks it, and a project skill the next agent runs on any change to that code.

## Vet a number before you post it

```text
$benchmark-checklist vet this 40% speedup before it goes in the pr description
```

You get faster, slower, no measurable difference, or inconclusive, with the run count, the range, and what limits the number.

## Stop correcting the same mistake

```text
$correct agents keep adding new config flags without registering them in the schema
```

The fix lands in the repo as architecture, a type, a lint, or a test, so the next agent cannot make the mistake.

## Ask how without starting the work

```text
$poteto-help how do I get poteto-mode to stay on every turn?
```

You get an answer, a prompt to send, and a link to the source. Nothing runs until you send that prompt.

## Review a branch

```text
$interrogate review this branch against its stated intent. Report actionable findings with file evidence and explain every dismissal.
```

## Fix a bug

```text
$imoten:poteto-mode reproduce the duplicate retry row, add the narrow regression check, fix the root cause, and verify the real command.
```

## Run bounded parallel checks

```text
$swarm inspect each package for direct legacy-client calls. Keep the workers read-only and return one deduplicated report.
```

## Catch up on a chat you left running

```text
$ketchup
```

[`$ketchup`](../../skills/ketchup/SKILL.md) tells you in plain words what changed since your last message, then lists each call waiting on you with its pick, evidence, and risk. It changes nothing while it reports.

## Configure dormant polling

```text
$setup-benny inspect the dormant Benny pack and list every activation blocker. Do not create automations or write externally.
```

## Avoid these mistakes

- Do not lead with your theory of the cause. The agent searches wherever you pointed. Ask it to restate the problem first, then share your hunch.
- Do not take the first design. One attempt locks in the first shape the model thought of. Ask for prototypes or `$architect` and pick from evidence.
- Do not polish an abstract plan. Adversarial review of a plan with no code behind it invents risks that will never happen. Settle the open questions with prototypes, then review what got built.
- Do not loop before you trust the loop. A loop that cannot verify its own work only makes unchecked work faster. Get the verification skill working first.
- Do not trust an unvetted number. A warm cache or a skipped code path can fake a speedup. Run `$benchmark-checklist` before the number goes anywhere.
- Do not correct the same mistake by hand. A correction in chat helps one run. `$correct` fixes the repo so no later run repeats it.

- Do not use slash-command syntax. Invoke installed skills as `$skill-name`.
- Do not assume that Poteto Mode persists. Without a trusted hook receipt, invoke it again on each turn.
- Do not send parallel writers into one checkout. Use separate agent VMs or assign exclusive paths.
- Do not claim model diversity from a requested profile. Report the served model only when a supported live surface exposes it.
- Do not treat optional connectors as installed. Detect them and follow the skill's declared fallback.
- Do not create goals, heartbeats, monitors, scheduled tasks, or separate tasks for ordinary work.
- Do not activate Benny during setup. Both canaries and separate activation authority are required.
- Do not store connector credentials in repository files, receipts, task prompts, or Benny state.
- Do not call a unit test proof of a UI or command behavior unless it exercises the changed artifact.
- Do not delete modified setup files. A receipt hash mismatch requires review.

Return to [the guide index](./README.md) or read the [Codex adaptation notes](../codex-adaptation.md).
