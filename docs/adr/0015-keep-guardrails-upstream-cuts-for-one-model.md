# 0015: Keep guardrails that upstream cuts for one model

## Context

Upstream pstack 0.15.4 and 0.15.5 remove instructions that one frontier model
follows without the text. Examples include "Review the diff yourself", the
`prove-it-works` checklist, the `tdd` nearby-validation step, the
`technical-writing` review checklist, and the three-to-five learning bound in
the `reflect` reviewer prompts.

Imoten runs the same skills on several model families. These include GPT
models, DeepSeek, and a small local operator. A cut that is safe for one model
can remove a needed step for another.

## Decision

When an upstream refresh only removes an instruction, keep the local text by
default. Record the path in `compatibility/pstack-map.json` with the
`retained-model-neutral-guardrail` disposition.

Port an upstream cut only when one of these conditions is true:

- The instruction is wrong or conflicts with another rule.
- The same rule is stated in another file that every caller loads.
- A local test under ADR 0007 shows that the cut keeps quality on each model
  family that runs the skill.

Port upstream rewrites that change behavior, such as new verification rounds
or a positive form of a negative rule, on their merits.

## Reason

A missing step is a silent failure. The cost of keeping one sentence is small
and fixed. The cost of dropping a check that a weaker model needs appears only
in its output, which nobody may inspect. ADR 0007 already gates model and
skill promotion on local evidence, so a removal needs the same proof.
