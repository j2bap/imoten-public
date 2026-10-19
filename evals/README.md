# Release evaluation evidence

This directory is the release ledger for `imoten` version `0.2.0`, derived from upstream pstack `0.15.5` at `adf3218ca2f5b9971eedc07a76bef22df7701539`. The immutable upstream file inventory is [`../upstream.lock.json`](../upstream.lock.json); [`cases/coverage.yaml`](cases/coverage.yaml) maps the 46 active upstream skills and all 23 upstream playbooks.

## Recorded environment

| Evidence | Verdict |
|---|---|
| Codex | `codex-cli 0.153.4` observed during the 2026-09-07 local installed smoke; the smoke records the executing CLI string again in TAP output. |
| Models | Live owner proof from 2026-09-06 is recorded in the model-role source. Release tests use synthetic provider responses and receipt checks; they do not repeat live model requests. |
| Permissions | Offline verification used the host's observable local process permissions. No live connector permission or model-generated write was exercised. Installed smoke uses only a temporary `CODEX_HOME` and temporary marketplace. |
| Offline tests | `npm run verify:offline` checks the baseline, static plugin, lifecycle, tooling, Benny fake adapters, and documentation without installing into a Codex profile. `npm run verify` remains an alias for this offline-only target. |
| Installed behavior | `npm run test:installed` requires the `codex` CLI, adds the local marketplace, installs the plugin into a fresh temporary Codex profile, validates the installed skill files, runs setup/teardown and hook boundary checks, and proves that the exact installed path is removed. The tested plugin CLI exposes no offline runtime skill-index command, so this does not claim fresh-task skill discovery or model dispatch. |
| Benny canaries | `not-run`: both automation descriptors remain `PAUSED`. Read-only, test-channel triage, repro-only, bounded-fix, concurrent-race, and ambiguous-write canaries require operator-owned real adapters before activation. |

## Release disposition

68 of the 74 registered skills are explicit-only. The six in `IMPLICIT_SKILLS` may trigger on their own. [`cases/implicit-triggers.yaml`](cases/implicit-triggers.yaml) gives each one a positive case and a near-miss negative case, and `tests/implicit-trigger-cases.test.mjs` checks the cases against the skill list. These are offline contracts; no test runs a model to confirm the selection.

### Live trigger run, 2026-09-28

Each case ran once through `codex exec --json --ephemeral -s read-only` in the personal profile (`gpt-6-sol` at `medium`, `codex-cli 0.158.0`), in a fresh clone, with the installed plugin. A case passes when the run opens the expected skill's `SKILL.md` for a positive case, and does not open it for a negative case.

| Case | Opened | Verdict |
| --- | --- | --- |
| positive `loop-on-ci` | `loop-on-ci`, `fix-ci` | `PASS` |
| negative `loop-on-ci` | none | `PASS` |
| positive `new-branch-and-pr` | `new-branch-and-pr` | `PASS` |
| negative `new-branch-and-pr` | none, after the `review-and-ship` description fix | `PASS` |
| positive `review-and-ship` | `review-and-ship`, `dev-review` | `PASS` |
| negative `review-and-ship` | none | `PASS` |
| positive `weekly-review` | `weekly-review` | `PASS` |
| negative `weekly-review` | `what-did-i-get-done` | `PASS` |
| positive `what-did-i-get-done` | `what-did-i-get-done` | `PASS` |
| negative `what-did-i-get-done` | none | `PASS` |
| positive `check-agent-compatibility` | `check-agent-compatibility` | `PASS` |
| negative `check-agent-compatibility` | none | `PASS` |

The first run of the negative `new-branch-and-pr` case opened `review-and-ship`. Its description said "open or update its PR" without the review-first condition. The fixed description names that condition, and both affected cases passed on rerun. Each case ran once on one model, so this shows the descriptions can trigger correctly. It does not measure how often they do, or how other model families behave. All 46 active upstream skills and 23 playbooks have positive offline-contract outcomes and applicable authority, capability, and negative-trigger boundaries. Connector- and trust-dependent live activation is deferred, with the automation tasks paused. Polling latency, hook trust, connector availability, model diversity, and Bun availability remain declared limitations; none is presented as verified when it was not observable.

Run `npm test` (or `npm run verify:release`) for the mandatory release gate. It runs offline verification followed by the installed-profile smoke and fails closed when the `codex` prerequisite is unavailable. A release is blocked by any failed test, missing coverage row, stale compatibility report, residual temporary profile/cache, unpaused Benny descriptor, or an unverified live-activation claim.
