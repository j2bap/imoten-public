# 0017: Give each skill one trigger path

## Context

Imoten set `allow_implicit_invocation: false` on every skill. Upstream is
mixed. pstack and the thermos review skills are explicit-only. Most of the
CI, PR, and verification skills that Imoten ported on 2026-09-28 trigger on
their own upstream, as do cli-for-agents, check-agent-compatibility, and
advisor.

Poteto Mode's `task-routing.md` also routes eleven of those ported skills,
such as `$deslop`, `$fix-ci`, and `$verify-this`. A skill that is both routed
and implicit has two owners for the same decision.

## Decision

Give each skill exactly one trigger path:

- **Explicit.** The user names the skill. This is the default.
- **Routed.** The user names the skill, or Poteto Mode opens it from
  `task-routing.md`. The skill stays explicit-only.
- **Implicit.** The skill may trigger on its own. Only upstream auto-trigger
  skills that Poteto Mode does not route qualify.

`IMPLICIT_SKILLS` in `scripts/validate-plugin.mjs` is the one list of
implicit skills. The validator and tests read it, and a test fails when an
implicit skill also appears in `task-routing.md`. `advisor` stays explicit,
because its port replaced automatic hooks with opt-in checkpoints.

## Reason

One trigger path gives one owner for each decision. Routed skills already
reach the model when a matching task runs, so implicit invocation would add
their descriptions to every session for no new reach. Keeping the implicit
set small limits context cost and keeps triggering predictable across model
families that match descriptions differently.
