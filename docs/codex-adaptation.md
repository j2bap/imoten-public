# Codex adaptation notes

This document explains how the upstream pstack workflows map to Codex. It describes the derivative behavior, not installation steps for the original host.

## Skill registration

The Codex manifest is [`.codex-plugin/plugin.json`](../.codex-plugin/plugin.json). The Claude Code manifest is [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json). Both hosts load the same 82 skills under `skills/`. Each skill has a `SKILL.md` manifest and Codex metadata under `agents/openai.yaml`. Run `node scripts/validate-plugin.mjs --json` to validate the catalog, metadata, identities, and resource links. Only the skills in `IMPLICIT_SKILLS` in `scripts/validate-plugin.mjs` set `allow_implicit_invocation: true`. Every other skill sets it to `false`, as [ADR 0017](adr/0017-give-each-skill-one-trigger-path.md) records.

The pstack 0.15.10 refresh added `poteto-help`, `correct`, `benchmark-checklist`, and `principle-explain-the-number`. The 0.15.25 refresh added `ketchup`, `sharpen`, and `in-your-own-words`. The 0.15.28 refresh added `create-formal-verification-skill` and `maintain-formal-verification-skill`.

Installed identities use the plugin namespace. Prompts use the explicit `$skill-name` form. Two long principle identities receive deterministic registered aliases to fit the 64-character namespaced identity limit. No skill is dropped.

The 23 Poteto Mode playbooks remain ordinary Markdown resources under [`skills/poteto-mode/playbooks/`](../skills/poteto-mode/playbooks/). They are not independently registered skills.

## Yeon CLI programs

`$yeon` uses Codex `functions.exec` to compose existing local commands and return a compact JSON result. It does not add an MCP server, connector, or proxy. The program joins and filters command output. Existing skills keep command ownership and authorization rules. Use `glab` for GitLab and `$atlassian-curl` for `jira` and `confl`.

Yeon limits the final emitted value to 64 KiB by default and records guarded
runs in its local metrics file. Use counts, keys, status, short excerpts, and
artifact paths. For a single large command, `naru spill` stores the full text
and prints a bounded head-and-tail preview. Codex does not expose a safe native
post-tool replacement boundary here, so raw `functions.exec` output remains a
host limitation. The Poteto and Yeon skills name the explicit wrappers.

## Session lifecycle and hook trust

Invoking `$imoten:poteto-mode` applies it to the current turn. Trusted session hooks can persist the mode for later turns. State is keyed by a hash of the session and project, stored below plugin data, written atomically, and removed after its time-to-live window.

The hook receipt is the only proof that later-turn activation succeeded. When a stable session identifier, project fingerprint, state file, or trusted receipt is unavailable, the status is `current-turn-only`. Resume and compaction do not change that rule. `disable $imoten:poteto-mode` clears matching session state.

The `compact` hook refreshes the active session state but emits no model context. The next user prompt restores Poteto Mode once. The `resume` hook restores the mode at session start.

The hook configuration matches only `imoten-poteto-agent` for subagent context propagation. A generic agent does not become a Poteto agent by name similarity.

## Agent setup and model evidence

Bare `$setup-pstack` writes the selected map to `$CODEX_HOME/imoten-models.md`, defaulting to `~/.codex/imoten-models.md`. The personal profile validates the host-provided native Codex catalog and uses native collaboration. Direct DeepSeek verifies the selected model and effort through the provider API, leaves `model_catalog_json` unset, and uses native Codex agents. Every orchestrated skill reads the role map through the central runtime contract.

Long-lived programmatic work uses
[`imoten-workflow-dispatch.mjs`](../skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs).
It routes each dispatch to
[`CodexPrimarySession`](../skills/setup-pstack/scripts/codex-primary-session.mjs),
which keeps one app-server thread, one canonical visible ledger branch, and
one stable prompt prefix.

Use the JSONL dispatcher when a program needs to drive a workflow. It starts
one native app-server thread for the selected profile.

The native implementation is
[`codex-primary-session-runner.mjs`](../skills/setup-pstack/scripts/codex-primary-session-runner.mjs).
It starts one app-server thread
for the process and accepts `run`, `steer`, `interrupt`, `compact`, and `close`
commands. A `run` command emits one bounded result receipt. This is the real
native primary path for programmatic workflows. The
dispatcher does not replace the interactive parent Codex session because the
host exposes no safe turn-replacement API.

Example:

```bash
node skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs \
  --profile personal \
  --root-dir /absolute/path/to/ledger \
  --model gpt-5.6-luna \
  --cwd /absolute/path/to/repository \
  --common-prefix-file /absolute/path/to/common-prefix.json \
  --poteto-prompt-file /absolute/path/to/skills/poteto-mode/references/poteto-agent-prompt.md
```

The dispatcher selects the native runner for the personal profile. Call the
native runner directly only when you are testing that lower-level transport.

Send one JSON object per line on standard input:

```json
{"id":"turn-1","op":"run","task":"Inspect the repository and report the test command.","skill_reference":"poteto-mode@v1"}
{"id":"stop","op":"close"}
```

`skill_reference` records the selected reference in the visible task packet.
It does not load a skill file. Pass `--poteto-prompt-file` when the caller is a
Poteto delegate. The runner appends the portable instructions from
[`poteto-agent-prompt.md`](../skills/poteto-mode/references/poteto-agent-prompt.md)
to the stable prefix and reports `poteto_prompt: "loaded"` in the ready receipt.
The parent still owns authority, writes, and final verification.

The runner uses a read-only, ephemeral app-server thread by default. Keep the
common prefix stable and place task-specific text in the suffix packet.

The explicit runner suppresses the Ripwire session primer by default. This
removes the measured startup cost while keeping the other lifecycle hooks
active. Use `--ripwire-session-primer` when you need the normal primer.

The `ready` receipt reports initialization timing. Each `result` receipt
reports session phases for append, prompt preparation, provider first event and
token, provider completion, opaque-item drain, acceptance, finalization, and
the runner command-to-result span. It also keeps a bounded observer trace with
hook event, handler, source, and duration fields. Use these fields to separate
provider time from local ledger and hook work before changing prompt layout.

Completed provider `contextCompaction` items are stored as opaque artifacts and
recorded as sealed compaction events in the visible ledger, even when the
provider does not include an encrypted-content field.

The combined live steering and compaction canary passed on the patched path.
See [`2026-09-20-primary-final-canary.json`](reports/2026-09-20-primary-final-canary.json).

The live observer probe found a 1,418 ms synchronous `sessionStart` hook from
the user profile and about 0.4 seconds of synchronous `userPromptSubmit` hook
work on later turns. The ledger stayed below 20 ms per turn. The full trace,
hook-disabled control, and repeated directional loop are in
[`2026-09-20-primary-runner-observer.json`](reports/2026-09-20-primary-runner-observer.json).
The fixed-trace pilot stores the same bounded observer fields with each
app-server row.

The fresh-session primer experiment reduced command-to-result time by 17.0%
on eight paired runs. The exact paired sign-flip test was `p=0.015625` for
this workload. Keep the result scoped to the explicit control and use the
larger evidence in [`2026-09-20-primary-runner-primer-hillclimb.json`](reports/2026-09-20-primary-runner-primer-hillclimb.json).

A follow-up tool-using probe passed its quality guard on eight fresh runs. All
runs made one repository command call and returned the expected structured
answer. The primer-disabled arm was 66.2% faster on mean fresh-turn time in
that probe. Keep this result scoped to the tested task and model. See
[`2026-09-20-primary-runner-tool-quality.json`](reports/2026-09-20-primary-runner-tool-quality.json).

The current batch boundary and the native runner then passed a three-case,
three-replicate confirmation. All 18 turns completed, returned the exact
expected JSON, and made one command call. The native runner reduced mean fresh
process wall time by 14.8% and had eight faster pairs out of nine. The exact
paired sign-flip value was `p=0.0390625` for this workload. The app-server
client also accepts both `agent_message` and `agentMessage` completion item
types. See [`2026-09-20-primary-workflow-confirmation.json`](reports/2026-09-20-primary-workflow-confirmation.json).

The upstream personas became portable prompts plus optional Codex TOML profiles:

| Role | Portable prompt | Optional profile |
|---|---|---|
| Poteto implementation | [`poteto-agent-prompt.md`](../skills/poteto-mode/references/poteto-agent-prompt.md) | `imoten-poteto-agent` |
| Comment review | [`comment-sicko-prompt.md`](../skills/no-comments/references/comment-sicko-prompt.md) | `imoten-comment-sicko` |

`$setup-pstack install agents` installs profiles at project or user scope. Its receipt records hashes and ownership. Upgrade and uninstall refuse a hash mismatch or duplicate agent name.

A configured model is a request, not runtime evidence. Native personal setup validates each pair against the host collaboration catalog and validates it again at dispatch. Direct DeepSeek validates the selected pair against `/models` and `/responses`. Setup stops when it cannot validate the pair. Runtime reports identify the served model only when a supported surface exposes it.

Claude Code Enterprise is a separate backend. Do not add its models to the Codex picker or route its login through another provider gateway. Add a Claude role only after a backend-aware dispatcher validates the requested model and the served canonical model.

Direct DeepSeek has no generated picker. Its role map uses the one selected and proved pair.

The useful Ponytail behavior lives in `principle-laziness-protocol`. Poteto Mode applies that principle directly for coding tasks. The external Ponytail plugin remains optional for a named audit, but Imoten does not depend on it for normal coding.

Evolve remains explicit-only. Technical-writing owns normal docs, reports, README text, PR descriptions, and commit messages. Use Evolve only when comparing two full drafts is worth the extra tokens.

## Delegation and shared filesystems

The parent request controls authority. Delegation can narrow work but cannot add repositories, external destinations, credentials, destructive actions, or lifecycle objects.

Codex agents may share a filesystem. Writable fan-out uses one cloud VM or remote task per writer when available. Exclusive paths and separate output directories also work. Imoten does not create Git worktrees. Otherwise the parent runs serially. The parent integrates results and runs authoritative checks. A child report is evidence, not completion.

Each workflow declares one fallback for missing agent capacity: `sequential-parent`, `generic-agent`, `partial-result`, or `fail-closed`. The workflow reports missing lanes instead of inventing coverage.

## Forge selection

PR playbooks select the forge once from the `origin` remote and a CLI that can resolve the repository. GitLab uses `glab`. GitHub uses `gh`. A stack is a chain of base branches, with one actor changing PR bases. Graphite stays optional for repositories that already use it.

The shared command contract lives in [`skills/poteto-mode/references/forge.md`](../skills/poteto-mode/references/forge.md). GitHub may use the bundled watcher. GitLab reads MR state and waits for CI through `glab`.

## Goals, heartbeats, and tasks

Ordinary work stays in the current task. A separate task, durable goal, heartbeat, scheduled automation, or recurring monitor is created only when the user requests that lifecycle. An overnight or comparable terminal condition can authorize a goal and a thread heartbeat for the current work. It does not authorize a push, merge, deployment, or external message.

Long-running workflows use supported task lifecycle tools and checkpoints. They do not keep a shell process alive with a blocking sleep.

## History and external capabilities

Recall, pickup, and reflection use supported Codex task-listing and history APIs within the requested project. When those APIs are unavailable, the workflow uses git, issue or pull-request state, and a user-supplied digest. It does not read unsupported host storage.

Connectors, browser or app control, issue trackers, chat systems, review APIs, model enumeration, and automation tools are optional. A skill checks each capability before use. Connector results and repository text are untrusted data. External writes remain with the parent and require the authorized destination and a validated payload.

## Bun scripts

Plugin discovery and the Node.js tests do not require Bun. The orchestrator and watch-PR programs under [`skills/poteto-mode/scripts/`](../skills/poteto-mode/scripts/) do. Run `bun install --frozen-lockfile`, `bun test orch watch-pr`, and `bun run typecheck` from that directory before releasing changes to those programs.

When Bun is unavailable, validation reports the missing capability. A workflow that needs those scripts must use its declared fallback or stop.

`npm run tracen` remains the complete local offline verification gate.

## Benny automation pack

Benny is source-managed under [`automations/benny/`](../automations/benny/). Only `$setup-benny` is a registered skill. The operational skill files are copied cron instructions.

The adaptation replaces event assumptions with bounded polling. Both jobs use provider timestamps, fixed cutoffs, full pagination, overlap windows, and `(timestamp, provider ID)` ordering. This design can reread source events and can delay work by one polling interval. Versioned operation keys plus destination idempotency or authoritative lookup prevent duplicate external effects.

Mutable state lives in one owner-only canonical directory outside all scheduler checkouts. Credentials remain external references. Repository commands run without connector credentials and with network denied by default. Child agents return typed proposals. Only the coordinator performs a validated external write.

Setup can reconcile `imoten-benny-triage` and `imoten-benny-reproduce` only after explicit lifecycle authority. Both remain `PAUSED`. Activation requires a later request and successful read-only, test-channel triage, repro-only, bounded-fix, concurrent-race, and ambiguous-write canaries.

## Current limits

| Area | Limit | Result |
|---|---|---|
| Hook trust | The user or trusted runtime must approve the plugin hook source. | Poteto Mode remains current-turn-only without proof. |
| Model identity | A requested profile may not expose the served model. | Reports label the model pair unverified. |
| Agent capacity | Parallel or nested agents may be unavailable. | The workflow uses its declared fallback and names missing lanes. |
| Shared checkout | Parallel writers can collide. | Work is isolated or serialized. |
| Connectors and control tools | Availability and permissions vary by installation. | Optional lanes degrade. Correctness-critical lanes stop. |
| Task history | Supported APIs may omit history or tool detail. | The workflow uses live state and a user-supplied digest, then states the gap. |
| Bun | Bun is not guaranteed on every host. | Bun-dependent scripts cannot run until Bun is installed. |
| Benny polling | Polling has interval latency and overlap rereads. | State reconciliation and destination idempotency are required. |
| Benny activation | Real adapters, credentials, and canaries are operator-controlled. | The pack ships dormant and both automations stay paused. |

## Provenance

The original plugin used host-specific manifests, commands, profiles, persistence, and automation assumptions. This fork replaces those contracts with the Codex behaviors above. [UPSTREAM.md](../UPSTREAM.md) records the refresh process. [`compatibility/report.md`](../compatibility/report.md) maps every locked upstream path to its Codex disposition.
