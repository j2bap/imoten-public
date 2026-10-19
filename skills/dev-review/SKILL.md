---
name: dev-review
description: Run an evidence-based pre-merge review when correctness, contracts, security, performance, or architecture need scrutiny. For a two-lane deep audit use thermos. To review, fix, and open a PR use review-and-ship.
---

# Dev review

Review the change through several independent engineering lenses, verify each claim against the code or a test, and return one deduplicated report.

Read [references/lenses.md](references/lenses.md) before selecting reviewers. Give each selected reviewer its matching persona file and require it to read that file before reviewing.

## 1. Resolve the review target

1. Read repository instructions and contribution conventions.
2. Resolve the base branch and merge base. Include committed changes and relevant uncommitted changes unless the user limits scope.
3. Collect only the initial inventory:
   - changed files and diff size;
   - commit messages;
   - runtime, frameworks, wire protocols, storage, and concurrency model;
   - product path that the change is meant to implement.
4. Split a diff larger than about 3,000 lines by module or contract boundary.

Do not review generated files, vendored code, or unrelated dirty-checkout changes unless they affect the contract under review.

## 2. Select lenses

Always run the complexity, craft, and testing persona lenses. The primary reviewer also owns product and architecture context.

Add the applicable runtime, distributed-systems, security, and performance/operations lenses. For a cross-repository change, assign one reviewer to each side and one reviewer to the shared boundary.

Before expensive review lanes, batch bounded triage questions through [the typed classifier decision protocol](../poteto-mode/references/jev-decision-protocol.md), such as severity, security-review need, and reviewer effort. After the reviewer writes the finding and its strongest false-positive case, use the adapter's typed score for the finding confidence. The parent and reviewers still prove findings against the code, and neither classifier provider decides whether an unverified finding is real.

Use parallel subagents when slots are available. Give each reviewer the repository path, diff range, changed-file slice, tech inventory, and its lens. Do not give reviewers suspected findings or the desired verdict.

## 3. Finding contract

Accept a finding only when it includes all of these:

- severity: `blocker`, `major`, `minor`, or `nit`, as [the shared verdicts](../poteto-mode/references/verdicts.md) define them;
- exact file and line;
- quoted code or observed test output;
- reachable failure sequence or violated invariant;
- concrete product or operational consequence;
- smallest credible fix;
- verification status;
- the strongest case that the finding is WRONG — the guard that may exist, the caller that never passes that input, the invariant held elsewhere. Write "none: <the fact that rules it out>" only after you check and can name the fact;
- confidence as an integer from 0 to 100, scored through the typed classifier provider after writing that case.

Reject generic advice, style preferences, ungrounded security claims, and speculative performance concerns. Do not manufacture nits to make a report look complete.

### Confidence scale

Use the whole 0-100 range:

| range | meaning |
|---|---|
| 90-100 | defect traced end to end |
| 70-89 | real defect, trigger not fully confirmed |
| 40-69 | genuine maybe |
| below 40 | drop it |

A two-value verdict ties almost every pair and forces the reader to eyeball the whole list. Measured on a 20-case set, a 0-100 scale produced zero ties where the binary verdict tied 80% of pairs. Ranking is the point.

If your scores pile up at 95 and 100, the scale has collapsed back to binary and the ordering is worthless. Spread them or say you cannot.

The false-positive case is a lie detector, not a disclaimer. A reviewer that cannot argue against its own finding has not tested it.

## 4. Verify and synthesize

1. Reproduce or inspect every blocker and major finding yourself.
2. Run the narrowest meaningful tests at the real module boundary.
3. For wire protocols, verify request and response cardinality, schema compatibility, offsets/encodings, timeout behavior, rolling-version compatibility, and fail-open/fail-closed semantics.
4. For remote calls, walk timeout, overload, unavailable downstream, cancellation, malformed response, and partial-result cases.
5. Deduplicate findings by root cause. Prefer verified evidence over reviewer confidence.
6. Put unresolved disagreements in a separate section and state the observation that would settle them.

If the user asked for implementation, fix verified blockers and majors, rerun affected tests, then rerun the review on the final diff. If the user asked only for review, do not modify code.

## 5. Report

Use this compact structure:

```markdown
# Dev review — <target>

**Verdict:** ready | ready after fixes | not ready (the review verdict rules in the shared verdicts file)
**Lenses:** <list>

## Blockers
- **[Lens]** `file:line` — <consequence>  ·  **conf NN**
  - Evidence: `<quote or command result>`
  - Failure: <reachable sequence>
  - Fix: <smallest credible fix>
  - Might be wrong because: <the false-positive case>

## Major
## Minor
## Nits
## Disputed
## Verified strengths

**Coverage:** <files> · <diff lines> · <tests run> · <counts by severity>
```

Within each severity section, order findings by confidence, highest first.

Omit empty severity sections. “Verified strengths” must name concrete safeguards or tests; it is not praise filler.

## 6. Label log

After printing the report, append one JSON object per finding to `~/.codex/review-labels.jsonl`:

```json
{"ts":"<ISO8601>","target":"<range or PR>","file":"...","line":0,"lens":"...","severity":"...","confidence":0,"finding":"...","outcome":null}
```

Leave `outcome` null. Set it to `fixed`, `skipped`, or `no_change_needed` when the finding is later acted on.

This is the only ground truth for whether the confidence numbers mean anything. Without it the scale is unfalsifiable. Do not skip it, and do not backfill outcomes by guessing.
