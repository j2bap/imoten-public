# Design before implementation

Use design work when a change crosses boundaries or has several credible shapes. Skip it for a mechanical edit whose structure is already fixed.

The two most common design mistakes are taking the agent's first design and polishing a plan that no code has tested. This page fixes both. You plan through code. Prototypes answer the open questions, a README or tutorial sets the target, and the written plan comes last.

![Several robots draft separate bridge designs while a reviewer compares them.](./images/design.jpg)

## Settle boundaries with `$architect`

```text
$architect design the cancellation state and API before changing callers.
```

`$architect` grounds the request in current callers and types. It can compare isolated sketches, agree on one shape, and implement against the chosen design. The design is not sacred once code starts. If implementation shows the same workaround in unrelated places, or types that compile only with `any` or forced casts, `$architect` treats that as proof the design is wrong. It scraps the sketch and starts over instead of patching around it.

## Compare attempts with `$arena`

```text
$arena produce three parser designs from this brief. Keep each candidate isolated and judge them against migration cost and failure handling.
```

The candidates need isolated VMs, remote tasks, or independent output directories. The parent reads them, selects a base, integrates useful parts, and verifies the result. If independent agents are unavailable, `$arena` declares a sequential fallback or returns partial coverage.

## Cover separate slices with `$swarm`

```text
$swarm check every package for direct calls to the legacy client. One read-only slice per package.
```

Use `$swarm` when the work divides by package, file set, test group, or another independent boundary. Do not use it to make several writers share one checkout.

## Review the design with `$interrogate`

```text
$interrogate review this design for correctness, migration risk, operability, and unnecessary complexity.
```

`$interrogate` returns findings grouped by action and explains dismissals. Distinct model families are useful when observable, but installed model labels do not prove which model served a request. Reports mark unverified identity instead of claiming diversity.

## Prototype instead of debating

Never take the first design. Ask for a few, and pick from evidence you can see:

```text
$imoten:poteto-mode prototype a few options for the new dropdown menu. Take screenshots or videos for me to compare.
```

The [Prototype playbook](../../skills/poteto-mode/playbooks/prototype.md) builds throwaway sketches in a scratch directory, puts the variants behind one switcher, drives each one, and captures screenshots or timings. It also works for behavior and algorithms, not just UI. Prototypes are planning with code. They let the agent answer its own open questions by running something instead of asking you, and they leave room for an option you would not have thought of.

The same idea scales up to a real design. Pair `$architect` with prototypes and keep a review gate:

```text
$imoten:poteto-mode we need rate limiting for external webhooks. Run $architect first, and answer open questions with prototypes. Let me review before proceeding.
```

Do not spend reviewers on an abstract plan. `$interrogate` belongs on a diff. Point adversarial review at a plan with no code behind it and the reviewers invent theoretical risks and edge cases that will never happen. Let prototypes settle the questions, then review what got built.

## Write the README first for shared code

For a package or API that other code will use, start with the doc a user would read:

```text
$imoten:poteto-mode write a tutorial for how I would use the new config package first. Then $teach me why it beats the current one.
```

Writing the tutorial first forces the caller's view. You describe the API to a hypothetical user and work back to the implementation. The doc also becomes a concrete target the agent checks its own work against. Name [`$technical-writing`](../../skills/technical-writing/SKILL.md) when the doc itself matters, so a tutorial stays a tutorial instead of drifting into reference and explanation at once.

## Plan after the design settles

Imoten has no planning skill, on purpose. When you do want a written plan, ask for it once the design is settled:

```text
$imoten:poteto-mode turn this design into a plan. Small verifiable PRs, each with its own verification steps.
```

The [Multi-phase plan playbook](../../skills/poteto-mode/playbooks/multi-phase-plan.md) settles any remaining open questions by prototype, then writes one section per PR, each ending in proof that the change works. A passing test suite alone does not count as that proof. The plan is the deliverable. The playbook does not implement it, and it names which execution playbook should run it next.

For a migration, state the bar in the prompt:

```text
$imoten:poteto-mode plan the migration of our ui library to the new styling system. Small verifiable PRs, each with visual regression checks. The result must match the original exactly, bugs included.
```

"Bugs included" keeps the migration from quietly fixing things on the way, which would make the old and new output impossible to compare. For a project that spans many days, you can commit the plan to the repo for a while so other agents see the work in progress. Delete it when the work lands.

Next: [Build and clean the change](./05-build-and-clean.md).
