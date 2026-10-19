<div align="center">

# 🍠 Imoten

**Crisp engineering workflows for Codex and Claude Code.**

*Sweet-potato tempura energy for serious engineering work.*

</div>

Imoten is a Codex-first derivative of [pstack](https://github.com/cursor/plugins/tree/main/pstack). Claude Code loads the same skill tree. The plugin contains 82 skills and 23 Poteto Mode playbooks.

Use `$imoten:poteto-mode` for a substantial engineering task. It selects a focused playbook, records proof, and calls narrower skills only when the work needs them. The parent task owns integration, external writes, commits, pushes, and the final result.

## What is inside

- 🍠 **Poteto Mode** routes a task through the smallest sound workflow.
- 🔎 **Investigation and design skills** trace real code before a change.
- 🧪 **Review and verification skills** require runnable proof.
- 🧰 **Yeon** composes existing CLIs into one compact Codex result.

## Install

Install the Codex marketplace from GitHub:

```bash
codex plugin marketplace add j2bap/imoten-public
codex plugin add imoten@imoten-local
```

For a local checkout, replace `j2bap/imoten-public` with its absolute path. Confirm the installed plugin:

```bash
codex plugin list --json
```

The tested Codex plugin CLI does not expose an offline runtime skill-index command. The release suite validates the skill catalog from the installed artifact; start a new task to exercise prompt-time skill discovery.

Each skill has one trigger path. Most skills run only when you name them. Poteto Mode also opens some of them through its routing table when a task matches. Six skills can trigger on their own, as they do upstream: `loop-on-ci`, `new-branch-and-pr`, `review-and-ship`, `weekly-review`, `what-did-i-get-done`, and `check-agent-compatibility`. Codex stores their full identities under the `imoten` namespace. In a prompt, invoke a skill with its registered `$name`:

```text
$imoten:poteto-mode add a --json flag to this command. Keep text output byte-identical. Verify both modes.
```

Start a new task after installation so Codex reloads the plugin catalog. See [Set up Imoten](./docs/guide/01-setup.md) for the complete walkthrough.

In Claude Code, run:

```text
/plugin marketplace add j2bap/imoten-public
/plugin install imoten@j2bap-imoten
```

## Configure model roles

Run `$setup-pstack` after installation. The personal profile validates the host-provided native Codex catalog and uses the curated multi-model role set. With direct DeepSeek, setup checks the selected model through `/models`, proves the pair through `/responses`, and keeps native Codex agents. Every path writes the active profile's `imoten-models.md`. Bare setup does not install custom agent profiles.

Direct DeepSeek assigns the selected Codex model and effort to every role and uses one review lane.

## Optional agent profiles

The skills work without custom agent profiles. Ask `$setup-pstack install agents` only when you want these two profiles:

- `imoten-poteto-agent` for implementation and orchestration.
- `imoten-comment-sicko` for read-only comment review.

Setup writes either project profiles under `.codex/agents/` or user profiles under `~/.codex/agents/`. It records file hashes in a receipt and refuses to overwrite files owned by someone else. Each profile gets an exact `model` and `reasoning_effort` pair from the shared role map. Setup stops when the live Codex selector or provider cannot prove the pair.

Read [Agent setup and model evidence](./docs/codex-adaptation.md#agent-setup-and-model-evidence) before changing profiles.

## Use the skills

`$imoten:poteto-mode` is the main entry point:

```text
$imoten:poteto-mode this retry path creates duplicate rows. Reproduce it first, fix the root cause, and verify the real behavior.
```

The other skills are useful when you want one specific operation:

| Skill | Use it for |
|---|---|
| [`$how`](./skills/how/SKILL.md) | Trace how a subsystem works. |
| [`$why`](./skills/why/SKILL.md) | Reconstruct why code reached its current shape from available evidence. |
| [`$recall`](./skills/recall/SKILL.md) | Rebuild recent project context through supported task history and live state. |
| [`$ketchup`](./skills/ketchup/SKILL.md) | Summarize what changed in this chat since your last message, in plain words and small visuals, with every item waiting on you listed and decidable from the reply alone. |
| [`$in-your-own-words`](./skills/in-your-own-words/SKILL.md) | Play back your goal and the problem before the agent starts. |
| [`$sharpen`](./skills/sharpen/SKILL.md) | Approach a task the way a top expert would, aimed at what you want, without overspecifying it or deciding your choices for you. |
| [`$architect`](./skills/architect/SKILL.md) | Settle types, callers, and module boundaries before implementation. |
| [`$arena`](./skills/arena/SKILL.md) | Compare isolated attempts at the same brief. |
| [`$swarm`](./skills/swarm/SKILL.md) | Cover independent slices or races and aggregate the result. |
| [`$interrogate`](./skills/interrogate/SKILL.md) | Run a skeptical, multi-lens review of a diff. |
| [`$dev-review`](./skills/dev-review/SKILL.md) | Check correctness, architecture, security, and release risk. |
| [`$thermo-nuclear-code-quality-review`](./skills/thermo-nuclear-code-quality-review/SKILL.md) | Run the harsh maintainability and structure persona. |
| [`$yeon`](./skills/yeon/SKILL.md) | Combine existing CLI commands and return a compact result. |
| [`$tdd`](./skills/tdd/SKILL.md) | Reproduce a bug with a failing test before fixing it. |
| [`$no-comments`](./skills/no-comments/SKILL.md) | Review comments and remove ones that do not earn their place. |
| [`$unslop`](./skills/unslop/SKILL.md) | Remove vague or machine-shaped prose. |
| [`$umamusume-naming`](./skills/umamusume-naming/SKILL.md) | Use Umamusume character names for Codex-owned codenames. |
| [`$show-me-your-work`](./skills/show-me-your-work/SKILL.md) | Keep a reviewable `decisions.tsv` trail. |
| [`$setup-benny`](./skills/setup-benny/SKILL.md) | Inspect or configure the dormant Benny polling pack. |
| [`$deslop`](./skills/deslop/SKILL.md) | Strip machine-written slop from a diff before commit. |
| [`$verify-this`](./skills/verify-this/SKILL.md) | Prove or disprove one claim with fresh before-and-after evidence. |
| [`$create-formal-verification-skill`](./skills/create-formal-verification-skill/SKILL.md) | Verify one property that tests rarely reach, such as a race, retry, state machine, or parser, and generate a project skill that rechecks it. |
| [`$maintain-formal-verification-skill`](./skills/maintain-formal-verification-skill/SKILL.md) | Update a formal verification after the code it covers changed, rerun it, and say whether each failure is drift or a code bug. |
| [`$control-ui`](./skills/control-ui/SKILL.md), [`$control-cli`](./skills/control-cli/SKILL.md) | Drive a live web, IDE, Electron, CLI, or TUI surface. |
| [`$fix-ci`](./skills/fix-ci/SKILL.md), [`$loop-on-ci`](./skills/loop-on-ci/SKILL.md) | Fix failing PR or MR checks once, or until green. |
| [`$review-and-ship`](./skills/review-and-ship/SKILL.md) | Review, test, commit, and open or update the PR, without merging. |
| [`$thermos`](./skills/thermos/SKILL.md) | Run the deep audit and the maintainability review together. |
| [`$advisor`](./skills/advisor/SKILL.md) | Consult the `Hardest tasks` role at key checkpoints. |
| [`$cli-for-agents`](./skills/cli-for-agents/SKILL.md) | Design or review a CLI that agents can drive. |
| [`$check-agent-compatibility`](./skills/check-agent-compatibility/SKILL.md) | Score how well a repository works for agents. |
| [`$what-did-i-get-done`](./skills/what-did-i-get-done/SKILL.md) | Summarize your authored commits for a time window. |

Browse the [complete skill directory](./skills/) or read the [Imoten guide](./docs/guide/README.md).

## Workflow ownership

```text
Imoten       selects the workflow
Laziness     selects the smallest sound implementation
dev-review   checks correctness and risk
thermo       attacks maintainability and structure
```

Imoten folds the useful Ponytail rule into `principle-laziness-protocol`. Use the separate Ponytail plugin only when you ask for its audit modes.

## Runtime boundaries

Read-only agents may share a checkout. Give each parallel writer an isolated cloud VM or remote task. Exclusive file ownership also works. Imoten does not create Git worktrees. When safe isolation is unavailable, it runs the work serially.

The active user request is the authority boundary. A child cannot add an external write, destination, credential, repository, or lifecycle object. Goals, heartbeats, scheduled tasks, monitors, and separate user-owned tasks are created only when the user requests that lifecycle or gives an equivalent terminal condition such as an overnight run.

Hooks can keep Poteto Mode active across later turns only after Codex trusts the plugin hook source. Without trusted hook evidence, `$imoten:poteto-mode` still works for the current turn and reports `current-turn-only`. Say `disable $imoten:poteto-mode` to clear the session state.

Optional connectors and control tools are detected at run time. A missing capability triggers the fallback declared by the skill. Work stops when that capability is required for correctness or credential isolation.

PR playbooks select GitLab with `glab` or GitHub with `gh` from the `origin` remote. Base-branch stacks work on both forges. Graphite remains optional for GitHub repositories that already use it.

`$imoten:poteto-mode` runs in the chat that receives it. That chat owns the playbook, the todo list, and every subagent spawn. Do not spawn `imoten-poteto-agent` to run the playbook itself. Use it for delegated implementation work.

The repository contains no Superpowers-derived code or auto-fire hook.

## Benny stays paused

[Benny](./automations/benny/README.md) is an optional polling pack for issue triage and reproduction. Installation does not create or activate an automation. `$setup-benny` copies the pack into a target project only after explicit authority.

The two stable automation names are `imoten-benny-triage` and `imoten-benny-reproduce`. Setup creates or updates them only when the user asks, and it leaves both `PAUSED`. Activation needs a separate request after all six canaries pass. Polling is not event delivery, so work can begin up to one schedule interval after a source change.

## Develop and verify

The metadata and resource validator requires Node.js. The legacy orchestrator and watch-PR scripts require [Bun](https://bun.sh/).

Tracen is the repository guardrail gate. It runs the complete offline test, type, and compatibility checks. Release verification adds the installed-plugin smoke test. Git and Codex ignore local audit, worktree, application, and deployment artifacts, and Tracen rejects them if they enter tracked source.

Ripwire `--test-gate` selects tests and reports possible gaps from its static call graph. Exit 4 means either list is nonempty, even when every selected test passes. Run the selected tests and check reported gaps against runtime evidence. Do not treat exit 4 as a test failure or require exit 0 after running tests.

Poteto Mode also runs the `$tracen` skill after every React change. It finds each added Effect and requires proof that the Effect synchronizes with an external system. It rejects derived-state Effects, event handling in Effects, stale dependencies, and setup without matching cleanup.

```bash
npm run tracen
```

```bash
node scripts/validate-plugin.mjs --json
node --test tests/*.test.mjs
cd skills/poteto-mode/scripts
bun install --frozen-lockfile
bun test orch watch-pr
bun run typecheck
```

The validator reports Bun as an optional capability. Skills that depend on the Bun scripts must stop or declare their fallback when Bun is unavailable.

## Update or remove

Refresh the configured Git marketplace, then reinstall from the refreshed snapshot:

```bash
codex plugin marketplace upgrade imoten-local
codex plugin remove imoten@imoten-local
codex plugin add imoten@imoten-local
```

Remove the plugin and its marketplace registration with:

```bash
codex plugin remove imoten@imoten-local
codex plugin marketplace remove imoten-local
```

Plugin removal does not delete project or user files created by `$setup-pstack` or `$setup-benny`. Use those skills to inspect receipts and remove only unchanged, owned files. Benny configuration and mutable state survive uninstall unless the user separately authorizes a purge.

## Origin and maintenance

This repository contains the modified Codex-first version and Claude Code packaging. It does not publish a raw upstream branch or snapshot commit, and the delivered checkout does not keep an upstream remote.

```text
Lauren Tan's pstack
        ↓
Aqua-123's pstack-for-codex
        ↓
🍠 Imoten
```

Imoten is the Japanese name for sweet-potato tempura. The name keeps Poteto Mode's small joke while giving this fork its own identity.

[NOTICE](./NOTICE), [`upstream.lock.json`](./upstream.lock.json), and the [compatibility map](./compatibility/pstack-map.json) record the source commit, license, file hashes, and migration status. Skills ported from five other plugins in the same upstream repository have their own lock and map under [`compatibility/plugins/`](./compatibility/plugins/). [UPSTREAM.md](./UPSTREAM.md) explains how maintainers refresh that evidence through a temporary local source checkout.

See [Codex adaptation notes](./docs/codex-adaptation.md) for the behavioral changes and current limits.

## License

MIT. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

### New workflows from pstack 0.15.10

- [`$poteto-help`](./skills/poteto-help/SKILL.md) answers setup and workflow questions.
- [`$correct`](./skills/correct/SKILL.md) finds repeated mistakes and enforces the rules in code.
- [`$benchmark-checklist`](./skills/benchmark-checklist/SKILL.md) checks performance measurements before you report them.
- [Explain the Number](./skills/principle-explain-the-number/SKILL.md) checks the evidence behind a measured result.
