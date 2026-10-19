# Real-task scheduling benchmark, 2026-10-02

This bounded read-only screen measures a **21.96% reduction in median elapsed time**. Two workers take **64.92 seconds**. One programmatic parent takes **83.19 seconds**. All 20 arms pass the executable behavior oracle. All 30 model turns complete with exit 0. Parallel execution is faster in 10 of 10 matched pairs.

The primary metric is `1 - median(parallel wall time) / median(parent wall time)`. It clears the 20% target with full behavior correctness. Keep the current scheduling policy. Two narrow workloads, incomplete accumulated usage, and missing served-model identity do not support a broader policy change.

## Workload and controls

You run two independent real repository tasks per fixture. Fixture 0 checks configuration identity parsing and classifier result normalization. Fixture 1 checks scheduling gate decisions and classifier request validation. The 21 cases include accepted inputs, invalid labels, probability errors, confidence thresholds, active compaction, conflicting paths, and invalid task fields. Five matched trials per fixture produce 210 case checks across both arms.

The source snapshot comes from commit `8467888ffcc5758ddb11d46e96bd9aaccd175d0d`. The [JSON report](2026-10-02-scheduling-real-tasks.json) contains each file's SHA-256 and every task input. Frozen copies and the measured harness remain under `../../.audit/scheduling-real-tasks-2026-10-02/`.

Both arms request native `gpt-6-astra` with `low` effort through `imoten-workflow-dispatch.mjs`, using the personal profile only. They use the same task bytes, scope instructions, portable prompt, read-only sandbox, tools, and scorer. The parent receives both tasks in one fresh thread. Two workers receive one task each in separate fresh threads and separate runtime directories. Trial order alternates within each fixture. Each turn has a 180-second limit; the run caps at 30 turns with no additional model runs for answer repair. The independent tasks share no writes or intermediate answers.

| Fixture | Parent median | Parallel median | Reduction |
| --- | ---: | ---: | ---: |
| 0 | 85.73 s | 66.49 s | 22.44% |
| 1 | 76.41 s | 57.61 s | 24.61% |

Matched-pair reductions range from 15.50% to 33.53%. These are descriptive results from two workloads, not a general significance claim.

## Failures and scorer correction

The initial sandboxed launch fails with `Network access to "chatgpt.com" was blocked: domain is not on the allowlist for the current sandbox mode.` The tool supplies no process exit code. The same native command succeeds after normal escalation. This setup failure stays outside the paired sample. Its exact tool error is transcribed in `setup-failure.json`; the retry overwrites the original `run.log`, so that initial raw log is unavailable.

The native adapter joins progress commentary and final output. The original whole-text JSON scorer therefore marks 30 of 30 turns as incorrect. After the first inspected pair, the scorer separates transport presentation from task correctness. It parses the final JSON object at a line boundary, including when progress text is itself JSON. This same rule applies to every retained output. Original strict scores remain in `results.json`; amended scores remain in the report. All behavior values and exact errors pass. Rework is zero additional model runs for answer repair. This count does not exclude tool errors or internal tool retries within a turn.

You assemble parallel answers by their fixed task IDs and compare the combined object with the same executable oracle as the parent answer. This deterministic assembly occurs during post-run scoring. Its total measured time is 0.730 ms across 20 arms; it is reported separately from the primary latency metric.

## Measured overhead and usage limits

Elapsed arm time includes dispatcher and app-server startup, model and tool work, process shutdown, raw-log writes, and the original scorer. One-time source freeze, oracle setup, and prefix creation take 3.64 ms. The median difference between arm time and the longest reported provider turn is 394.78 ms for the parent and 423.63 ms for two workers. These are measured process overheads. Interactive parent planning, role classification, ready-lane classification, prompt design, and report writing are outside the timed arms.

| Adapter-reported counters | Parent total | Two-worker total |
| --- | ---: | ---: |
| Input | 282,610 | 473,040 |
| Cached input | 271,232 | 458,880 |
| Uncached input | 11,378 | 14,160 |
| Output | 4,025 | 4,075 |
| Input plus output | 286,635 | 477,115 |

You cannot read these counters as complete usage or billing cost. The measured revision of `codex-app-server-client.mjs` replaced its usage record with `tokenUsage.last` on each update and discarded the accumulated counter. The current client calculates turn usage from cumulative thread counters, but that fix cannot recover the missing historical counts. Exact-ID lookup for the first 24 completed ephemeral threads finds no saved native rollout files, so complete counters remain unavailable. Cached input is part of input, not an extra amount. No pricing calculation is made.

The measured dispatcher revision accepts `--reasoning-effort` but does not forward it through the native runner. The measured harness supplies the same explicit `-c model_reasoning_effort="low"` app-server argument in both arms. Ready receipts echo the requested model. The measured client retains only the thread ID from thread creation; it does not preserve an independent served-model or served-effort receipt. Treat the pair as requested settings, not independently verified provider identity. The later parameter-handoff fix forwards effort and retains app-server settings; the current harness no longer needs the command-argument workaround. These fixes do not change the historical measurements or prove remote provider identity.

These tasks use real repository behavior and executable checks. They do not measure code edits, repair quality, shared-context tasks, long-lived warm parents, or production scheduling. Tool use can execute the audited functions directly. Repeated calls can warm caches, and alternating order does not eliminate provider contention.

## Reproduce and verify

Run the local oracle without model calls:

```sh
node scripts/benchmark-native-scheduling.mjs --check
```

Run a new approved native experiment in a fresh output directory:

```sh
node scripts/benchmark-native-scheduling.mjs --output .audit/scheduling-real-tasks-followup
node scripts/benchmark-native-scheduling.mjs --summarize --output .audit/scheduling-real-tasks-followup
```

The harness refuses an existing experiment manifest. `--check` uses a temporary directory and removes it. `--summarize` verifies frozen source and task definitions before scoring.

Verified commands exit 0: the 30-turn benchmark, `--check` (21 cases), `--summarize`, `node --check`, Ripwire quality delta (zero gating regressions), and the `run` edit check (new symbol; no incompatible callers). An intentional overwrite attempt exits 1 with `Output already contains an experiment. Use --output with a new directory.` No scheduling policy, ADR, commit, or external publication changes.
