# Run authorized overnight work

An overnight request changes the lifecycle of a task. It does not expand authority.

![A robot tends a workbench at night while a written checklist stays visible.](./images/overnight.jpg)

## Earn the trust before the loop

A loop you do not trust just produces unchecked work faster, and the mess compounds with every iteration. Before you leave one running, check that it has earned it:

- You have done the task once by hand, or watched an agent do it, so you know what good looks like.
- The agent has the tools and signals you would use yourself: the verification skill, the profiler, the logs.
- Every stage proves its work and can stop the line when the work misses the bar.
- You have read a few transcripts and turned the repeated failures into tools, skills, or checks.

Make the loop autonomous only after all four hold. Until then, run it while you watch.

## Write an overnight contract

Name the goal, finish condition, checkout, allowed writes, and stop condition:

```text
$imoten:poteto-mode keep working overnight in an isolated checkout from <base>. Migrate every caller to the new parser. Done means the old-call scan is empty and the full test suite passes. Do not push, open a pull request, or merge. Stop on an external credential or product decision.
```

The isolated checkout keeps the run separate from other work. A decision log makes the morning review shorter:

```text
$show-me-your-work record the decisions for this run.
```

A duration is not a finish condition. "Work on this for 4 hours" gives the agent nothing to check, and you wake up to four hours of motion instead of a result. Give the run a predicate that can pass or fail.

To stop a run on purpose, tell the agent to pause, or that you are about to go offline or restart Codex. The [Pause safely playbook](../../skills/poteto-mode/playbooks/pause-safely.md) finishes or backs out of the current step, commits a work-in-progress checkpoint, and writes a resume note. A fresh chat picks the work up from that note through the Session pickup playbook. Saying "keep going" never triggers a pause.

## Use supported lifecycle objects

Codex may use a durable goal and a thread heartbeat only because the request asks for continued overnight work. The workflow checkpoints progress through supported task tools. It does not keep a shell process alive with a sleep loop.

A scheduled task, recurring monitor, or separate user-owned task still needs an explicit request for that object. The phrase "overnight" does not authorize an external message, pull request, merge, deployment, or new repository.

## Build a reviewed stack

When the request also authorizes pushes and ready PRs, `$imoten:poteto-mode autopilot-stack` builds one base-branch stack and stops for your review. A fresh swarm verifies each PR at its code-ready head and again after each push that changes the patch. Only a verified PR enters the stack. The root PR targets trunk. Each later PR targets its parent branch. You land the verified chain from the bottom through GitLab or GitHub.

## Audit the result

In the morning, inspect:

1. the finish-condition evidence.
2. the integrated diff and current branch.
3. `decisions.tsv` if the run created one.
4. the agent receipt, including missing lanes, fallbacks, and observed or unverified model pairs.
5. remaining processes, isolated checkouts, and scratch outputs.

Treat every child report as a claim until the parent checks the artifact.

For a quick status instead of an audit, run [`$ketchup`](../../skills/ketchup/SKILL.md) in the chat that ran the work. It reads only, and tells you in plain words what changed since your last message, with the screenshots and small diagrams the work produced. Then it lists each call waiting on you, such as a merge, an approval, or a choice between options, with its pick, the evidence, and the risk, so you can decide from the reply alone.

## Configure Benny separately

Benny is a polling automation pack, not an overnight shortcut. Use `$setup-benny` only when you intend to configure Slack, tracker, repository, control-adapter, and canonical-state integration.

Setup does not activate Benny. It can reconcile exactly two `PAUSED` project automations only after explicit authority. A later request is required to activate them after the six canaries pass. Polling may add up to one schedule interval of latency, and overlap windows can reread events. Destination idempotency prevents duplicate effects.

Next: [Steer with principle names](./08-principles.md).
