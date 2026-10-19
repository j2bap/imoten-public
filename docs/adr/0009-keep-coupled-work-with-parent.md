# 0009: Keep coupled work with the parent

## Context

Poteto Mode delegated parts of ordinary investigations, features, and bug fixes through serial agent stages. Each stage needed a new brief and context transfer.

On 2026-09-15, a blinded one-case pilot compared one agent with a two-agent investigation handoff. Both results scored 9 of 10. The single-agent path finished in 8.6 seconds instead of 20.9 seconds and used 18,928 reported tokens instead of 38,051. The pilot did not measure a real repository edit or dollar cost.

## Decision

Use the parent as the default owner for coupled design, implementation, verification, and reporting. Delegate only independent exploration, isolated work with safe ownership, competing disposable artifacts, or review of a finished artifact.

Ordinary work uses one delegation level. The parent synthesizes child reports. Standing programs may use bounded nested coordinators when one session cannot own the work.

This is a provisional owner policy. Keep the existing subagent paths available and collect elapsed time, reported tokens, quality, and rework on real tasks.

## Reason

The pilot found equal quality with 59 percent less elapsed time and 50 percent fewer reported tokens. The change is reversible and removes context handoffs from the main path without removing independent review or parallel work.

## Follow-up decision 2026-09-18

The parent now uses a bounded ready-lane rule for ordinary parallel workflows. It records candidate lane dependencies, read paths, write paths, shared context, and required status. Classifier.dev classifies semantic independence through the typed decision adapter, with paid Jev fallback. The parent keeps deterministic dependency and isolation checks, starts at most two eligible lanes, refills when a lane completes, and owns synthesis. A low-confidence or unavailable classifier answer falls back to the sequential-parent path.

The decision came from a repeated read-only screen. Twenty paired runs across two fixtures reduced median wall time from 14,254.5 ms to 7,381.5 ms. Ten paired usage runs changed median child token use by -24 tokens, or -0.035 percent. The screen did not measure complex-answer accuracy, parent scheduler tokens, billing prices, or provider contention. Those remain required production metrics.

## Follow-up decision 2026-10-05

For independent delegated work, start a fresh agent for each task, fix round, retry, or queue item. Carry the complete brief, directives, report, and branch into the new agent. Reuse an agent only when required state is costly to move, such as uncommitted changes or a process it still runs. Keep stop and hold messages available for running agents.

This ports pstack 0.15.10's agent lifecycle rule. It limits stale task context while keeping state that cannot move cheaply. The parent remains the owner of coupled work, and the ready-lane and exact-pair gates remain in force.
