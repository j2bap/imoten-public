# Route work through `$imoten:poteto-mode`

`$imoten:poteto-mode` matches the request to one of 23 playbooks and tracks the selected steps. It invokes other skills only when those steps need them.

![A dispatcher routes robots toward bug fix, feature, and investigation gates.](./images/router.jpg)

## Give it an outcome

State the goal, known constraints, and a checkable finish condition:

```text
$imoten:poteto-mode users receive two notifications after a retry. Reproduce it, fix the root cause, and verify one notification remains.
```

That is a Bug fix prompt. "Reproduce it" is a real constraint, not politeness, and the playbook honors it. Watch the todo list fill with the Bug fix steps. A skipped step stays visible with `skip: <reason>`.

## What goes in a prompt

A useful prompt carries up to five things, and each one fits in a sentence:

- **The goal.** Say what is wrong, or what you want.
- **The done check.** It must be able to pass or fail. "Make it better" and "work on it for an hour" are not checks.
- **The proof you want to see.** Ask for the real command output, a video of the flow, the stored value, or a before-and-after number.
- **What you already know.** A symptom, a repro step, a log line, or a link saves the agent a search.
- **The real constraints.** "repro first", "don't change any code yet", "zero behavior change", and "let me review before proceeding" each change what the agent does.

Here is one prompt with all five:

```text
$imoten:poteto-mode the csv export drops its last row since yesterday's deploy. failing job id is 4812. repro first, then fix. done means the 60k-row fixture exports every row. show me the row counts before and after.
```

Two things are worth leaving out:

- **The how.** Say what to achieve, and leave the agent room to find a better path than the one you would pick.
- **Your theory of the cause, at first.** A stated guess narrows the search to wherever you pointed. Let the agent restate the problem before you share your hunch.

For a noisy report, such as a long thread or a vague bug, make the restatement the first step:

```text
$imoten:poteto-mode read this thread. restate the underlying issue in your own words, in plain english. don't change any code yet.
```

A misreading shows up in the restatement, before any code exists. Correct it there, and it costs you one message instead of one wrong fix. For the restatement alone, with no playbook, run [`$in-your-own-words`](../../skills/in-your-own-words/SKILL.md). It restates what the agent thinks your goals are and what problem you're trying to solve.

When you're unsure whether a task is aimed right, put [`$sharpen`](../../skills/sharpen/SKILL.md) in front of it:

```text
$sharpen write a migration guide for the v2 config format.
```

Before it starts, the agent asks how a top expert would do the task, what you're really after, and whether the ask is over- or underspecified. It drops constraints that don't serve the goal as readily as it adds ones that do, leaves your choices open, and keeps one outside check that the result is right. Then it does the work.

## Follow up short

When the conversation already carries the context, the prompt shrinks to almost nothing. Use `new task` when the subject changes:

```text
$imoten:poteto-mode new task. Explain why the cache survives logout. Do not edit code.
```

The second prompt routes to a read-only investigation because the authority boundary forbids edits.

## Keep one owner for coupled work

The parent handles design, implementation, verification, and the final report when those stages depend on the same evidence. Poteto Mode delegates only independent exploration, isolated work, competing disposable artifacts, or review of a finished artifact.

A delegated slice must be useful and verifiable on its own. If a child needs hidden parent context or another child must summarize the result, keep the work in the parent.

## Use the cheap decision lane

Any confidence-bearing semantic classification in a Poteto workflow goes through [the typed classifier decision protocol](../../skills/poteto-mode/references/jev-decision-protocol.md), including role routes, triage, severity, risk, priority, effort, and pattern maturity. Classifier.dev receives the workflow's bounded role candidates first and returns a normalized typed answer. The paid Jev MCP is the fallback provider. The deterministic resolver looks up the exact proven model and reasoning effort. Poteto dispatches the original task once. It does not ask a full LLM to choose a model or write a routing summary first. The parent keeps authority, evidence, deterministic checks, exact model proof, and final synthesis. Exact predicates with no confidence remain local.

## Run ready lanes

When a workflow has several candidate lanes, the parent gives classifier.dev
one typed independence question per lane through the adapter. The parent still
checks dependencies, read and write paths, shared context, and live-control
ownership. It starts at most two verified lanes together, then fills an open
slot when a lane finishes. Low confidence or missing classifier results use
the sequential-parent fallback. A classifier failure tries the paid Jev MCP
before that fallback. The parent owns the final reducer. This is the default
behavior and needs no flag.

## Understand session state

The explicit invocation always applies to the current turn. Trusted hooks can persist Poteto Mode for later turns in the same session. The hook state is keyed by session and project, expires, and does not authorize new actions.

When hook trust or stable session context is unavailable, the mode reports `current-turn-only`. Invoke `$imoten:poteto-mode` again on a later turn. Do not assume that a prior activation survived a resume or compaction without a healthy receipt.

Disable the session state with:

```text
disable $imoten:poteto-mode
```

## Isolate parallel writers

Codex agents can share a filesystem. Before parallel writes, give each writer an isolated cloud VM or remote task. Exclusive files or separate output directories also work. Do not create Git worktrees. If none is safe, ask Poteto Mode to run serially.

```text
$imoten:poteto-mode compare two parser designs. Put each disposable candidate in its own output directory. Do not edit production code.
```

The parent integrates the winner and runs the authoritative checks.

## Expect visible fallbacks

A playbook declares what happens when a custom profile, subagent, connector, control tool, or history API is unavailable. The common fallbacks are sequential parent work, a generic agent with a portable prompt, a labeled partial result, or a closed stop. Poteto Mode does not silently drop a lane.

Next: [Understand the code](./03-understand.md).
