---
name: how
description: "Explain how a codebase or subsystem works, including runtime flow, ownership, and placement. Use why for rationale."
---

# How

Delegation and optional capabilities follow `../poteto-mode/references/codex-agent-runtime.md`.

Explore the codebase to answer "how does X work?" questions. Produce clear architectural explanations at the level of a senior engineer onboarding onto a subsystem. Enough to build a working mental model, not annotated source code.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): the parent explores and explains in one pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): use parallel explorers only for independent angles. The parent writes the explanation. Go to Step 2a.

When in doubt, take the simple path.

If grounding leaves a bounded scope or rigor choice, use [the Jev decision protocol](../poteto-mode/references/jev-decision-protocol.md) to route it. The parent still traces the code and writes the explanation.

## Step 2a. Explore (complex questions only)

Decompose the question into 2 to 4 exploration angles. Build a lane record for
each angle. Ask the typed classifier provider to classify independence, then apply the deterministic
dependency and write checks from the runtime contract. Start at most two ready
explorers together. Recompute readiness and refill after each completion. If an
angle depends on another, hold it until its dependency completes. Low-confidence
or unavailable classifier results use the sequential-parent fallback:

- Role: the exact `How explorer` pair through its configured profile or a generic agent with the same pair and the explorer prompt.
- Access: read-only. If that pair cannot run, cover the missing angle in the parent and report the fallback.

## Step 2b. Explain directly (simple questions)

Trace the relevant code in the parent. Read the implementation and direct dependencies. Stop when the evidence answers the question. Then go to Step 4.

## Step 3. Synthesize in the parent (complex questions only)

Read every explorer report. Check disputed or important claims against the code. Resolve overlap and disagreement. Use `references/explainer-prompt.md` as the parent synthesis guide.

## Step 4. Present

Write the explanation in the parent. State open questions and missing evidence.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
