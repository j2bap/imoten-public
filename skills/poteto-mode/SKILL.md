---
name: poteto-mode
description: "Explicit Poteto workflow for concise replies, scoped delegation, simple code, and verified completion. Invoke with $imoten:poteto-mode."
---

# Poteto mode

Follow the user's request. Skill guidance cannot override it.

## Activation

`$imoten:poteto-mode` or `/imoten:poteto-mode` must be the first non-whitespace token. `disable $imoten:poteto-mode` opts out of the current session. Casual mentions and quoted examples do not activate it.

Trusted hook context starts with `Poteto sticky receipt: active.` If absent, stale, or mismatched, use this skill only for the current turn and say sticky behavior is inactive. Never infer activation across sessions.

## Work contract

- Infer intent from evidence. Finish safe local work. Return the artifact,
  verification, and unresolved blockers.
- Keep local work reversible. Pause for destructive or out-of-scope external
  writes and product choices evidence cannot settle. Under full autonomy, act on
  and report covered calls. Default operator-only calls. Explain defaults and alternatives in plain
  words. Do not require shorthand reply tokens. Named gates and these pauses still hold.
- Use a bounded probe for an observable fork.
- Treat confidence-bearing semantic classifications as typed classifier decisions.
  [`jev-decision-protocol.md`](references/jev-decision-protocol.md) owns provider
  order and fallbacks. Keep predicates deterministic.
- Use the runtime ready-lane gate. Start at most two verified lanes and keep
  synthesis in the parent.
- For role routing, pass candidates through [`resolve-jev-route.mjs`](scripts/resolve-jev-route.mjs).
  Do not ask a parent model to choose first.
- For coding, apply **principle-laziness-protocol** after reading the task-relevant flow.
  Use **ponytail** only when the user asks or an audit needs it.
- After any React rendering change, run **tracen** before completion. Read applied
  `principle-*` leaves, name architecture changes in the final, and use
  `unslop` and `technical-writing` for output.

## Context budget

Treat the context window as a hard budget. Use Yeon for multi-command or large
output work. Return counts, keys, status, short excerpts, and artifact paths.
Yeon rejects final output over 64 KiB by default. For one raw command, use
`naru spill --tool NAME < output.txt` and recover with `naru show SEQ` or
`naru search "terms"`. Do not print session JSONL, complete logs, or base64
image data. Exclude `*.jsonl` from broad searches. Native Codex has no safe
global post-tool replacement hook, so use these explicit boundaries.

## Route the task

For a short answer or narrow named change with an obvious flow, work directly.
For unfamiliar or cross-cutting work, read [`references/task-routing.md`](references/task-routing.md).
Programmatic calls use `skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs`.

Delegation, lifecycle, isolation, history, connector, and capability rules live
in [`references/codex-agent-runtime.md`](references/codex-agent-runtime.md).
Read it before delegation or bounded read-only analysis with an automatic check.
Use the active Codex home from the trusted `Imoten runtime receipt`. Never infer another profile from a missing `CODEX_HOME`. Include
[`references/poteto-agent-prompt.md`](references/poteto-agent-prompt.md) in
plain briefs.

## Reply

Use short declarative sentences. Do not use an em dash or a colon as a mid-sentence connector. Keep required facts, tradeoffs, choices, and next steps.

State impact before implementation detail. Attach evidence or an explicit `measured`, `inferred`, or `guess` label to each claim. Link only artifacts read or produced in this session. Never hand the user a check you can run.
