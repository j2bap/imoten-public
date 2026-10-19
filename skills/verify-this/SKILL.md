---
name: verify-this
description: "Prove or disprove one specific claim with fresh baseline and treatment evidence and return a verdict. Use for a before-and-after repro or a measured perf or memory claim. For the general done check, use principle-prove-it-works."
---

# Verify this

Delegation, waiting, and optional capabilities follow [`codex-agent-runtime.md`](../poteto-mode/references/codex-agent-runtime.md).

Verification is not a recap. It proves or disproves one specific claim with repeatable evidence. `$principle-prove-it-works` sets the general rule to check the real artifact. This skill runs the before and after comparison for one claim.

## When to use

- The user asks "verify this", "prove it works", "did this fix it", or "show me the evidence".
- A bug fix needs a before and after repro.
- A UI, CLI, API, performance, or memory claim needs measurement.
- A test passes, but the user-visible behavior still needs confirmation.

Do not use this skill for a vague claim such as "the code is cleaner". Ask for a measurable claim first, and stop until you have one.

## Steps

1. Restate the claim in falsifiable form: the condition, the metric, and the threshold.
2. Pick the smallest local surface that can disprove it. See "Local surfaces" below.
3. Capture a baseline from the old state: the merge base, the parent commit, the failing branch, or the current broken repro. Record its SHA. Build it in a temporary clone, for example `git clone --quiet . "$T/baseline" && git -C "$T/baseline" checkout <sha>`. Do not switch the user's checkout while it has uncommitted work, and do not create Git worktrees.
4. Capture the treatment from the changed state with the same command, data, warmup, and environment. Record its SHA.
5. Compare the raw artifacts: numbers, screenshots, terminal transcripts, HTTP responses, profiles, heap snapshots, or test output.
6. Return exactly one verdict from "Verdict rules" below.

## Local surfaces

- Code behavior: a focused unit or integration test, or a minimal repro script. When a cheap regression test fits, follow `$tdd`.
- CLI or TUI behavior: `$control-cli`, a terminal transcript, or a demo recording.
- UI behavior: `$control-ui`, screenshots, accessibility snapshots, or browser traces.
- API behavior: a local HTTP or RPC request and a diff of the responses.
- Performance: same-machine baseline and treatment timings or CPU profiles.
- Memory: heap snapshots before and after the suspected operation.

When the repository has a project verification skill under `.agents/skills/verify-<app>/`, use its launch, drive, and evidence steps for the surface.

## Artifact layout

When it is safe to write artifacts, use this layout:

```text
${TMPDIR:-/tmp}/verify-this/<claim-slug>/
├── claim.md
├── timeline.md
├── baseline/
├── treatment/
├── diff/
└── verdict.md
```

If artifacts may contain sensitive code, prompts, screenshots, HTTP bodies, or heap data, keep only the minimal inline evidence unless the user agrees to disk storage.

## Verdict rules

Use the tokens in [`verdicts.md`](../poteto-mode/references/verdicts.md):

| Token | Use when |
|---|---|
| `PASS` | Baseline and treatment differ in the predicted direction, by the claimed threshold, with no obvious confound. |
| `PASS+NOTES` | The claim passes, and you also saw something that is not a defect, such as a slow step. |
| `FAIL` | The behavior is unchanged, moves the wrong way, or misses the threshold. |
| `BLOCKED` | You could not run the measurement. Name the missing tool, access, environment, or input. |
| `INCONCLUSIVE` | You ran it, but there is no valid baseline, the noise is larger than the effect, or an environment difference invalidates the comparison. |

## Stop condition and output

Stop after one verdict. Use this shape:

```text
<PASS | PASS+NOTES | FAIL | BLOCKED | INCONCLUSIVE>
Claim: <falsifiable claim>
Baseline: <SHA or state>  Treatment: <SHA or state>

Evidence:
<metric or artifact>: baseline=<...>, treatment=<...>, delta=<...>, threshold=<...>

Reasoning:
<one short paragraph that names the evidence and any confounds>
```

Do not soften a negative result. A clear `FAIL` is useful.
