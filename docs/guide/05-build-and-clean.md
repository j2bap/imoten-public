# Build and clean the change

Poteto Mode has playbooks for bug fixes, features, refactors, performance work, prototypes, runtime forensics, traces, visual parity, and metric improvement.

## Preserve the user contract

Name the behavior that must change and the behavior that must remain:

```text
$imoten:poteto-mode add JSON output to the status command. Keep existing text output byte-identical. Test both.
```

The parent task owns coupled design, implementation, verification, and the final report. Delegate only independent work with a result that the parent can verify on its own. A child owns only the files and operations named in its brief.

Use [the typed classifier decision protocol](../../skills/poteto-mode/references/jev-decision-protocol.md) for bounded task routing when a cheaper calibrated decision can avoid an unnecessary full-model lane. Keep exact model availability and verification deterministic.

## Reproduce bugs with `$tdd`

```text
$tdd reproduce the duplicate retry row, then implement the smallest root-cause fix.
```

`$tdd` writes the cheapest meaningful failing test first. When a test needs a broad mock harness or cannot exercise the symptom, the skill uses the closest executable check and says why.

## Apply language guidance where it fits

Invoke `$typescript-best-practices` by name when a task touches `.ts` or `.tsx` files. It does not load on its own.

`$typescript-best-practices` checks TypeScript-specific design and type rules. It does not replace the repository compiler, formatter, or test suite.

Both perf playbooks run [`$benchmark-checklist`](../../skills/benchmark-checklist/SKILL.md) on their numbers. Perf issue vets its baseline and every number after it, and Hillclimb vets its harness before freezing it. [Verify and ship](./06-verify-and-ship.md#vet-a-measured-number-with-benchmark-checklist) shows when to type it yourself.

Sometimes you want the cause before any fix. For a live symptom, such as a leak, an idle CPU spin, or a visual glitch, the [Runtime forensics playbook](../../skills/poteto-mode/playbooks/runtime-forensics.md) instruments the running process. For a profile you already captured, the [Trace forensics playbook](../../skills/poteto-mode/playbooks/trace-forensics.md) reads the artifact and maps the hot frame to source. Both return a diagnosis, not a fix:

```text
$imoten:poteto-mode here is a cpuprofile from the slow startup. Tell me where the time goes and which source lines own it. No fix yet.
```

## Clean prose with `$unslop`

```text
$unslop tighten the changed README and error messages without changing meaning.
```

The skill removes filler, vague claims, and repeated jargon. It keeps real symbols and measured facts.

## Review comments with `$no-comments`

```text
$no-comments inspect comments added by this diff and remove the ones the code can express.
```

The `imoten-comment-sicko` custom profile is optional. Without it, the skill uses a generic read-only reviewer loaded with the portable Comment Sicko prompt. The parent accepts or rejects each finding and applies edits.

Next: [Verify and ship](./06-verify-and-ship.md).
