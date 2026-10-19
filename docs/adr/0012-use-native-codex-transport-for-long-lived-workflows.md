# ADR 0012: Use native Codex transport for long-lived workflows

## Context

`codex exec` is a non-interactive turn runner. The caller sends one prompt on
stdin. The process then emits events and output until it exits. `exec resume`
and the current `exec fork` command continue or fork stored sessions, but they
do not provide arbitrary context replacement or live model input.

The current Codex release also provides native subagent workflows, the Codex
SDK, and an app-server JSON-RPC surface. The local subagent workflow can spawn
custom agents with separate model and effort settings. The SDK and app-server
can start, resume, and fork threads, stream events, interrupt turns, and steer
an active turn. Some app-server methods remain experimental.

The provider pilot uses the app-server JSONL client in
`skills/setup-pstack/scripts/codex-app-server-client.mjs`. It completes the
documented `initialize`/`initialized` handshake, starts an ephemeral thread,
and waits for `turn/completed` plus `thread/tokenUsage/updated` before marking
a measurement valid.

The primary-session adapter in
`skills/setup-pstack/scripts/codex-primary-session.mjs` now composes that
client with `ContextManager`. It starts one primary thread, sends the full
prompt-stable view once, sends suffix-only task packets on later turns, and
records visible observations in the canonical ledger. It exposes live steer
and interrupt only through the app-server turn IDs.

The cache-aware manager needs durable application state, deterministic prompt
construction, and explicit model-family handoffs. It must also support live
progress and steering when the selected runtime proves those capabilities.

## Decision

Use one long-lived primary GPT thread as the default:

1. Use the Codex SDK or app-server for a programmatic workflow that needs
   streamed events, thread control, or mid-turn steering. The native primary
   workflow uses `CodexPrimarySession` and app-server.
2. Use native Codex subagents only for bounded, independent, mostly read-only
   work when a benchmark shows that parallel execution repays extra model and
   merge cost. Route that choice through deterministic vetoes, then the typed
   `classifier.dev` gate with paid Jev fallback. Treat this as an optional
   capability, not the normal workflow.

Keep the `ContextManager` above all transports. Its canonical visible event
store, branch/family-scoped opaque-state vault, dependency groups, cache
frontiers, classifier.dev/Jev decisions, mailbox receipts, and explicit
handoffs do not move into provider thread history. A transport may expose more
events or steering,
but it cannot make encrypted model state application memory.

Remote compaction is enabled for the active primary workflow. Context growth
uses the provider's compaction path before optional parallel work is considered.
The gate defers optional spawning while compaction is `needed` or `in_flight`.
It treats a sealed compaction window as immutable and never sends its opaque
item to a classifier or subagent. After compaction, the gate reads the
canonical visible ledger again.

Workflow triggering must not prepend a full skill prompt to each agent. Keep a
single common-prefix fingerprint for system, project, schema, tool, and shared
reference text. Prefer native skill/config references. If a provider expands a
skill into prompt text, place the pinned bytes after the cache boundary and
record the skill version and invalidation reason. A branch may vary after the
boundary, but not before it.

Every adapter reports capabilities:

```text
observe | cancel | send_next_turn | steer_live | fork | inject_visible_items
```

`CodexPrimarySession` reports live steering after the client proves turn-ID
checks and streamed usage. A successful steering request means queued, not
applied. Record both states. The adapter does not claim complete opaque
history capture or cross-family replay.

## Reason

`codex exec` is the right size for a batch runner. It is the wrong ownership
boundary for an
always-running primary thread that needs bidirectional control. The SDK/app-
server path gives a supported control protocol for an external client without
making the provider transcript the durable application record. Subagents are
useful for a narrow independent-work case, but using them by default would
duplicate context, fragment cache reuse, and add merge and encrypted-state
ownership work.

The model being GPT does not by itself prove that opaque reasoning is portable
between families or branches.

## Consequences

- The native GPT runtime bridge is `CodexPrimarySession` over app-server.
- The manager must test primary-thread stream, interrupt, and steering
  behavior separately from cache and ledger tests. It tests fork and subagent
  behavior only when that optional capability is enabled.
- App-server lifecycle, auth, and experimental-method changes become runtime
  risks. The native adapter fails closed.
- Optional native subagent results still need explicit visible handoff
  records. Parent aggregation is not a replacement for canonical application
  memory.
- Context filtering remains limited on a resumed provider thread until an
  adapter proves safe visible-item injection or a full-window replacement
  contract. A reduced working set can start a fresh branch.

## References

- [Codex subagents](https://developers.openai.com/codex/subagents)
- [Codex SDK](https://developers.openai.com/codex/sdk)
- [Codex app-server](https://developers.openai.com/codex/app-server)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
