Delegation, lifecycle, isolation, history, and capability fallbacks follow `../references/codex-agent-runtime.md`.

### Feature

**You own the design, implementation, verification, and report.** Keep code-coupled work in the parent.

1. Run `how` when the affected flow is unfamiliar or spans several modules. For a narrow change with named files and an obvious flow, read those files directly.
2. Run `architect` when the change creates or changes an API boundary, ownership, or a design with multiple viable shapes. A narrow local change that follows an established pattern does not need it.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Implement the code-coupled change in the parent. Delegate only a slice that passes the runtime delegation gate, or an independent review after the artifact exists. Give the child named files, the data shape, invariants, output, verification, and stop condition. State when that set is self-contained. When several valid shapes remain, use **arena**. Re-ground surgical changes against upstream-derived files. Port shared-primitive improvements to all consumers and verify each.
5. Verify on the matching surface. An `INCONCLUSIVE` or wrong-surface result is not a pass; flag it.
6. Rebase into small, ordered commits; stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR** only when the user asked for a PR or the active workflow already owns one.

Parent-level fan-out is for slices that produce independent artifacts, such as audits, cross-subsystem investigations, isolated modules, or competing experiments. Rewrite the checkpoint at phase boundaries. Do not pass the main implementation through a serial agent handoff.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
