# Verdicts and severities

Every Imoten skill and playbook uses these words for results. Use the exact tokens. Do not invent a synonym, and do not map words yourself when a skill already names one here.

## Check verdicts

A check verdict reports one check, lane, verifier, or experiment. Swarm workers, shipping verifiers, autopilot lanes, plan lanes, and `figure-it-out` units all return one of these tokens.

| Token | Use when | Counts as a pass |
| --- | --- | --- |
| `PASS` | You ran the check on the real artifact at the named SHA, and it met its predicate. | Yes |
| `PASS+NOTES` | The check passed. You also saw something that is not a defect, such as a slow step or an unclear log line. | Yes |
| `FAIL` | You can prove a defect. List every defect you can prove, not only the first. | No |
| `BLOCKED` | You could not run the check. Name what stopped it: a missing tool, access, environment, or input. | No |
| `INCONCLUSIVE` | You ran the check, but the evidence cannot decide. Examples: the wrong surface, noise larger than the effect, or a flaky result. | No |

Rules:

1. A defect is never a note. A defect is anything at `blocker` or `major` severity below. If you can prove one, the verdict is `FAIL`, even when it looks small. Only `minor` and `nit` findings may appear as notes.
2. A self-report, a green CI list, or an approving bot review is not a verdict.
3. Each verdict names the SHA it checked and the evidence: a command and its exit code, a `file:line`, or an artifact path.

## Aggregate verdict

When several checks gate one decision, the aggregate verdict is **clean** only when every required check is `PASS` or `PASS+NOTES`. A missing result is a gap, and a gap is not a pass. Any `FAIL`, `BLOCKED`, or `INCONCLUSIVE` makes the aggregate not clean. Report which check caused it.

## Finding severities

A finding is one problem that a review reports. `dev-review`, `interrogate`, `thermo-nuclear-code-quality-review`, and audit lanes use these severities.

| Severity | Meaning |
| --- | --- |
| `blocker` | Causes wrong behavior, data loss, a security hole, or a broken build or contract. Do not merge with it. |
| `major` | A real correctness, design, or maintenance problem that is not broken yet but will cause harm. Fix before merge unless the owner accepts it in writing. |
| `minor` | A small, local improvement with a clear fix. Merging with it is safe. |
| `nit` | Style or naming. Include it only when it helps the reader. |

Each finding gives its severity, the `file:line`, the evidence, and the fix when you have one.

## Review verdict

A review ends with one of these lines:

| Verdict | Use when |
| --- | --- |
| `ready` | No `blocker` or `major` findings. |
| `ready after fixes` | No `blocker` findings, and every `major` finding has a clear, local fix. |
| `not ready` | Any `blocker` finding, or a `major` finding without a clear fix. |

When a review runs as a check lane, map it this way. `ready` with no findings is `PASS`. `ready` with only `minor` or `nit` findings is `PASS+NOTES`. `ready after fixes` and `not ready` are `FAIL`.
