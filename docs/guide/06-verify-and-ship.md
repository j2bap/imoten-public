# Verify and ship

Verification must exercise the artifact that changed. A compiler pass proves types. It does not prove a UI flow, network side effect, or command transcript.

Verification is the slowest step in most agent work, because it usually waits on a human. Make the agent able to do it, and you stop being the bottleneck. Skip it, and running more agents only gets you more unchecked work to review.

![A robot checks a built machine while another records the result.](./images/verification.jpg)

## State the finish condition

```text
$imoten:poteto-mode fix the retry duplicate. Done means the regression test passes and the real command writes one row after an interrupted retry.
```

The parent reruns authoritative checks after integrating child work. A child summary is evidence, not completion.

When the change must match a reference pixel for pixel, the [Visual parity playbook](../../skills/poteto-mode/playbooks/visual-parity.md) diffs screenshots against a frozen baseline instead of judging by eye.

Ask for the proof as an artifact you can inspect yourself: the failing test and then the passing one, a before-and-after video, the trace, the screenshot. If the fix already merged, ask for the same check again on main. An artifact beats a plausible explanation, because you can challenge it without replaying the whole run.

## Vet a measured number with `$benchmark-checklist`

A before-and-after number is the easiest evidence to get wrong by accident. A warm cache, a debug build on one side, or work that never ran inside the timed region can each produce a convincing speedup. Before you report or act on a number, type:

```text
$benchmark-checklist vet the export speedup before it goes in the pr
```

[`$benchmark-checklist`](../../skills/benchmark-checklist/SKILL.md) asks seven questions and wants evidence from a run for each:

1. What limits the number, and why isn't it double?
2. Did every side run tuned the way production runs?
3. Does the result break a physical limit, like disk bandwidth or core count?
4. Did anything error or return wrong output?
5. Does it reproduce over alternating runs, with a median and a range?
6. Does it matter end to end, on the path a user waits on?
7. Did the work actually happen inside the timed region?

The verdict comes back as faster, slower, no measurable difference, or inconclusive, with the run count, range, and limiter. It says inconclusive when it can't name the limiter or a side ran untuned. `$imoten:poteto-mode` already runs the checklist inside the Perf issue and Hillclimb playbooks, so you type it yourself when you measured something outside them, or when someone else's number looks too good. It's the working form of the [Explain the Number principle](../../skills/principle-explain-the-number/SKILL.md).

## Create a project verification skill

If the repository lacks a repeatable real-surface check, ask:

```text
$create-verification-skill create a project skill that launches this CLI, drives one mapped command, captures a transcript, and cleans up.
```

The generated skill lives under `.agents/skills/verify-<app>/`. It contains launch, health, drive, evidence, and cleanup instructions plus a feature map. The generator runs one mapped feature before handing the skill over.

Name the skill in the prompt when you want the proof in a specific form:

```text
$imoten:poteto-mode build the bulk-archive action. Use $verify-<app> to verify your changes and show me a recording and screenshots as proof.
```

Treat the verification skill as infrastructure. Commit it, so every person and every agent on the team drives the app the same way. When agents keep writing throwaway scripts to click through the app, [build the lever](../../skills/principle-build-the-lever/SKILL.md): ask for a small control CLI that the skill calls instead. Agents spend fewer tokens, and every run becomes repeatable. A CLI that agents use well has a few composable commands, a `--dry-run` option on anything destructive, error messages that say what to do instead, rich `--help` text, and machine-readable output such as JSON. Make the dev setup repeatable too: seeded data, test users, and one command that brings the environment up the same way every time.

Use `$maintain-verification-skill` to compare an existing verification skill with the current app. It edits only proven drift and reruns affected live checks.

## Prove a property with a formal verification skill

A verification skill proves the paths you drive. Some bugs live on paths nobody drives: two retries that overlap, a lock that expires mid-write, a state change that arrives out of order. Tests rarely reach those cases. For code where such a bug is costly, ask:

```text
$create-formal-verification-skill the job lease and retry logic. a job must never run twice at once.
```

Without an area, [`$create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md) picks the target from the code: the strongest promise the code makes where a break harms users and tests rarely reach the case that breaks it.

The question picks the tool. Whether events can happen in a bad order suits a model checker over a small model of the design, and TLA+ is the default for that in any language. Whether the code behaves for every input suits a verifier that runs on the code. If no verifier runs on your language, the agent says so and tests the real code with generated inputs. A property that must hold at every size can need a proof. The agent tells you which tool it chose and why.

It verifies one property and shows that property failing on a broken variant of the code, because a check you've never seen fail proves nothing. When the current code already breaks the property, you get the counterexample as a short sequence of steps in your code's terms. The property stays as stated, and product code doesn't change unless you ask.

It writes a project-local skill under `.agents/skills/` that tells the next agent whether a change touches the verified code, how to run the check with one command, and how to tell a real bug from a modeling error. Before handing it over, the generator follows that skill once on a scratch change that breaks the property, and the check must catch it. The handoff says what was verified, with which tool and bounds, what the check found, and what it doesn't cover. A pass covers the model or the bound, not the whole system.

The skill records which code each check covers and the commit where the check last matched it. After merges and refactors that skip the skill, run [`$maintain-formal-verification-skill`](../../skills/maintain-formal-verification-skill/SKILL.md). It updates the verification from the code, reruns it, shows that each updated check can still fail, and tells you whether each failure is drift in the verification or a bug in the code.

## Review the diff

Run the repository checks, inspect `git diff --check`, and use `$interrogate` for a skeptical review when the risk warrants it. Keep unsupported or trust-dependent checks visible as blockers or deferred operator gates.

## Open or merge only with authority

The [opening-a-PR playbook](../../skills/poteto-mode/playbooks/opening-a-pr.md) prepares a focused branch and pull request. The [babysit playbook](../../skills/poteto-mode/playbooks/babysit.md) watches authorized review and CI work. The [shipping playbook](../../skills/poteto-mode/playbooks/shipping.md) verifies a stack before an authorized landing action. It selects GitLab with `glab` or GitHub with `gh`, then lands the verified run from the bottom one PR at a time.

These playbooks do not infer permission to commit, push, open a pull request, merge, or deploy. State the allowed repository and action in the request. The parent validates the remote and branch immediately before a write.

Next: [Run authorized overnight work](./07-overnight.md).
