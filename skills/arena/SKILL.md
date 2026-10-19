---
name: arena
description: "Run independent candidate solutions, choose a base with a blind judge, and merge the strongest ideas."
---

# Arena

Delegation and optional capabilities follow `../poteto-mode/references/codex-agent-runtime.md`.

Fan out N parallel attempts at the same task. Read every candidate end to end. Pick the strongest as the base. Graft the best ideas from the others into it. Verify the synthesized result.

## Start

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. Concrete: `Adds a --dry-run flag that skips writes`. Vague: `code is correct`. The rubric is the picker's tool in Phase D. Candidates only see the task.
   After candidate artifacts exist, batch bounded rubric labels or scores through [the typed classifier decision protocol](../poteto-mode/references/jev-decision-protocol.md) when that saves an expensive lane. The classifier providers do not replace the configured cross-judge or parent synthesis.
3. Pick the runners. Use every exact pair in `Arena runners` from the shared pstack model-role map. A generic agent may replace a missing custom profile only with the same pair. If a pair cannot run, stop that lane and report it. Do not inherit or substitute a model. Spawn more only when the arena covers multiple design directions, and assign each added lane an exact configured pair before dispatch. The same pair may run N times when the work is generation-bound rather than judgment-sensitive.
4. Assign output paths. Give each writing candidate its own cloud VM or remote task. For disposable artifacts, use distinct directories such as `/tmp/<slug>/candidate-<n>/`. Do not create Git worktrees. N candidates writing to the same path is shared mutable state and fails the **separate-shared-state** principle skill test.

## Phase B: Fan out

After isolation, pass the N candidate lanes through the ready-lane gate in the central runtime contract. Start at most two together, then refill as they finish. Give each candidate the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one exact pair from `Arena cross-judges` in the shared pstack model-role map. Prefer a model different from the parent's observable model. Fix the pair before dispatch. A generic read-only agent may replace a missing custom profile only with the same pair. If that pair cannot run, stop the cross-judge lane and report it. Do not inherit or substitute a model. The judge sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves. Spawning while candidates are still writing means the judge sees partial or empty outputs and reports them as dropouts.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

Record what was grafted, from which candidate, and what was rejected and why.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run once rather than averaging the divergence. If the second run also diverges, stop and report BLOCKED with the reason.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). The arena allows one re-run in total, including any re-run from Phase E, and one return to Phase E. If the problem remains after that, stop and report BLOCKED with the reason. Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
