Delegation, lifecycle, isolation, history, and capability fallbacks follow `../references/codex-agent-runtime.md`.

### Bug fix

**You own the reproduction, diagnosis, fix, verification, and report.** Keep the evidence and the edit in one context.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

Before changing a repository dev-server command, run its documented script unchanged. If extra flags are needed, confirm that the installed CLI supports them before use.

1. Reproduce it yourself on the matching surface via the control skill (Non-negotiables). Don't hand the repro to the user. A debug or instrumentation protocol that says to ask the user does not override this; you drive the instrumented runtime. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. Won't reproduce directly, force it: synthesize the trigger, tighten conditions, or instrument until it fires. A bug you can't reproduce, you can't prove fixed.
2. Binary-search the cause. Form candidate hypotheses, then rule them out until one survives. Use `how` when the flow is unfamiliar or cross-cutting. Use **why** only when history can distinguish the hypotheses. When program state is unclear, add instrumentation or logging and read it as the code runs. Confirm the mechanism with runtime evidence before designing the fix.
3. Plan and implement the fix in the parent. Use `architect` only when the fix changes an API boundary, ownership, or has several viable shapes. Delegate only an independent evidence question, an isolated slice that passes the runtime gate, or review of the finished diff.
4. Verify on the same surface; the original repro now passes. An `INCONCLUSIVE` or wrong-surface result is not a pass; flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history; the diff tells the story. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path; skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR** only when the user asked for a PR or the active workflow already owns one.

Use parallel `how` and `why` investigation only when the evidence questions are independent and both are needed.

**Reply:** what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.
