# Poteto task routing

Read only the sections that match the task. Then open the named skill or playbook. A routed workflow may narrow the runtime contract but cannot broaden authority.

For any workflow that emits a confidence-bearing semantic classification, the parent must apply [`jev-decision-protocol.md`](jev-decision-protocol.md) before acting. This includes route, triage, severity, risk, priority, effort, and pattern-maturity labels. The protocol owns provider order and the fallback when a provider is absent. Exact deterministic predicates that emit no confidence stay local. The parent still owns evidence, authority, proof, and dispatch.

Every check, lane, and review result uses the tokens in [`verdicts.md`](verdicts.md). That file owns check verdicts, the clean-aggregate rule, finding severities, and review verdicts.

## Workflow triggers

- Unfamiliar or cross-cutting change, architecture decision, or "are we sure?". Use `how`. Skip it for a narrow change with named files and an obvious local flow.
- A UI and a long-lived process share one mutable config object. Test rejected saves and failed refreshes. Keep the last good state and show the error. After a successful save, reload into the same object.
- An observable design or behavior fork. Use the Prototype playbook and let evidence decide. Keep a read-only Investigation as an investigation when its deliverable is a cited answer.
- Stateful code or a repeated data shape. Use `principle-model-the-domain`.
- A new API boundary, ownership change, or design with several viable shapes. Use `architect`.
- Parallel coverage, race, gauntlet, or exploration. Use `swarm`. Use `arena` for competing designs or code with selection and grafting.
- A contested design. Use `interrogate` before shipping.
- A nontrivial multi-step or parallel task. Write the throughput checkpoint from the matched playbook.
- A commit. Run `$deslop` on the diff.
- A correctness and risk review. Use `dev-review`. Use `$thermos` for a deep bug, security, and maintainability audit, or `$thermo-nuclear-review` for the bug and security audit alone. Use `thermo-nuclear-code-quality-review` only for an explicitly harsh maintainability audit. Use `ponytail-review` only when the user asks for an over-engineering review.
- A React component, hook, context, or rendering change. Use `tracen` after implementation and before the final review or commit.
- An explicit comment audit, or a pre-merge review where comment debt can hide constraints. Use `no-comments` before the review.
- A shipping UI, IDE, or CLI task. Use the project's own verify skill when one exists, else `$control-ui` for web, IDE, or Electron UI and `$control-cli` for a CLI or TUI. Every playbook that says "the control skill" means this choice. Reproduce a bug on the same surface. If live control is unavailable, do not claim live proof.
- A PR-status request. Use the Babysit playbook. Declare its mode before polling. Use `$get-pr-comments` for a read-only summary of review feedback, and `$fix-ci` for one focused pass on a failing check.
- A request to land or ship a green stack. Use the Shipping playbook. Verify each PR independently and land only the contiguous verified run from the root.
- Compile or type-check errors block validation. Use `$check-compiler-errors`.
- A local merge or rebase stopped on conflicts. Use `$fix-merge-conflicts`, unless a babysit or stack owner holds the branch.
- A claim that a change fixes, speeds up, or shrinks something. Prove it with `$verify-this`.
- A benchmark or measured performance claim. Use `benchmark-checklist` before you report or act on the number.
- An end-to-end smoke suite fails or must pass before shipping. Use `$run-smoke-tests`.
- An open PR that is hard to review. Use `$make-pr-easy-to-review`.
- A CLI that agents will run. Design or review it with `$cli-for-agents`.
- A Bugbot or agentic security comment. Triage it with [`bugbot-triage.md`](bugbot-triage.md). Fix real issues and dismiss noise with evidence.
- A broken skill during other work. Fix it in its own PR when authorized. Do not hide the failure.
- Long, autonomous, multi-phase work, or a task the user leaves for later review. Use `figure-it-out` and `show-me-your-work`. Use Orchestrate only for a standing multi-day program.
- A Codex-owned non-semantic codename. Use `umamusume-naming`. Preserve user, repository, product, API, ticket, and domain names.

## Principle routes

Read a principle leaf only when its trigger matches. Cite only principles read in the current session.

### Core

- `principle-laziness-protocol`. Size a change, refactor, or remove needless layers.
- `principle-foundational-thinking`. Choose core types, data structures, sequencing, or shared state before logic.
- `principle-redesign-from-first-principles`. Integrate a new requirement as if it had existed from the start.
- `principle-attack-the-premise`. Repeated fixes fail because they share one premise.
- `principle-subtract-before-you-add`. Remove dead weight before an addition, refactor, or rewrite.
- `principle-minimize-reader-load`. Collapse indirection, hidden state, or one-caller wrappers.
- `principle-outcome-oriented-execution`. Drive a staged rewrite or migration to its target architecture.
- `principle-experience-first`. Resolve product, UX, or feature-scope tradeoffs for the user.
- `principle-exhaust-the-design-space`. Compare two or three prototypes for a novel interaction or architecture.
- `principle-build-the-lever`. Build a reusable script, generator, or proof tool for nontrivial repeated work.

### Architecture

- `principle-model-the-domain`. Structure stateful logic or repeated shape assumptions.
- `principle-boundary-discipline`. Validate at system boundaries and keep internal logic pure.
- `principle-type-system-discipline`. Make invalid typed states unrepresentable.
- `principle-make-operations-idempotent`. Make retryable commands and lifecycle work converge.
- `principle-migrate-callers-delete-legacy-apis`. Migrate callers and remove the old internal API in one wave.
- `principle-separate-shared-state`. Remove shared writable state before adding locks.

### Verification

- `principle-prove-it-works`. Verify the real artifact before declaring completion.
- `principle-fix-root-causes`. Reproduce a defect and trace it to the owning cause.
- `principle-sequence-verifiable-units`. End each migration or sweep unit with a check.
- `principle-test-behavior-not-implementation`. Test public behavior against literal expected results.
- `principle-explain-the-number`. Find what limits a measured result and rule out errors, skipped work, and noise.

### Delegation and meta

- `principle-guard-the-context-window`. Route bulk output to agents or files and keep compact summaries in the parent.
- `principle-never-block-on-the-human`. Proceed with reversible work instead of asking for permission.
- `principle-encode-lessons-in-structure`. Replace repeated prose rules with code, metadata, lint, or tests.

## Playbook routes

For nontrivial multi-step work, put the matched playbook steps before task-specific todos. Record a skipped step with one reason. A narrow task can run its relevant steps directly.

| Task | Playbook |
| --- | --- |
| Read-only question or comparison | [`investigation.md`](../playbooks/investigation.md) |
| Reproduced defect and fix | [`bug-fix.md`](../playbooks/bug-fix.md) |
| Measured slowness | [`perf-issue.md`](../playbooks/perf-issue.md) |
| Repeated metric improvement | [`hillclimb.md`](../playbooks/hillclimb.md) |
| Live runtime diagnosis without a fix | [`runtime-forensics.md`](../playbooks/runtime-forensics.md) |
| Captured trace diagnosis | [`trace-forensics.md`](../playbooks/trace-forensics.md) |
| New or changed behavior | [`feature.md`](../playbooks/feature.md) |
| Behavior-preserving structure change | [`refactoring.md`](../playbooks/refactoring.md) |
| Throwaway design or behavior probe | [`prototype.md`](../playbooks/prototype.md) |
| Pixel-exact UI work | [`visual-parity.md`](../playbooks/visual-parity.md) |
| Skill creation or change | [`authoring-a-skill.md`](../playbooks/authoring-a-skill.md) |
| Agent behavior comparison | [`eval.md`](../playbooks/eval.md) |
| PR or stack to merge-ready | [`babysit.md`](../playbooks/babysit.md) |
| Independently verify and land | [`shipping.md`](../playbooks/shipping.md) |
| One long task to a completion predicate | [`autonomous-run.md`](../playbooks/autonomous-run.md) |
| Standing multi-day program | [`orchestrate.md`](../playbooks/orchestrate.md) |
| Independent PR queue through merge | [`autopilot-full.md`](../playbooks/autopilot-full.md) |
| One linear reviewed stack | [`autopilot-stack.md`](../playbooks/autopilot-stack.md) |
| Resume prior work | [`session-pickup.md`](../playbooks/session-pickup.md) |
| Suspend work for later resumption | [`pause-safely.md`](../playbooks/pause-safely.md) |
| Multi-phase or stacked-PR plan | [`multi-phase-plan.md`](../playbooks/multi-phase-plan.md) |
| Safe worktree or simulator cleanup | [`worktree-cleanup.md`](../playbooks/worktree-cleanup.md) |
| Open a requested PR | [`opening-a-pr.md`](../playbooks/opening-a-pr.md) |

Use Opening a PR only when the user asked for a PR or the active workflow already owns one.
