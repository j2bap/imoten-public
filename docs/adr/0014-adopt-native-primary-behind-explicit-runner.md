# 0014: Adopt the native primary behind an explicit runner

## Context

The native primary adapter now has a real app-server path. A host pilot cut
uncached input by 39.4 percent, from 15,538 to 9,415 tokens, and raised cache
share from 87.8 percent to 94.0 percent. The same pilot raised average
end-to-end time by 21.9 percent. It used four calls per arm, so the latency
result was directional and needed follow-up. The follow-up used the current
batch boundary and the native runner on three tool-using cases with three
interleaved replicates. All 18 turns completed with the exact answer and one
command call. The native runner reduced mean fresh-process wall time by 14.8
percent, with eight faster pairs out of nine.

At adoption time, the repository had no personal-provider dispatcher that
could safely replace the interactive parent Codex session.

## Decision

Adopt `CodexPrimarySession` for programmatic native GPT workflows through the
`imoten-workflow-dispatch.mjs` JSONL entry point. The dispatcher routes each
call to `codex-primary-session-runner.mjs`. Keep the interactive parent session on its host
boundary because a plugin hook cannot safely replace the current turn.

Treat cache and uncached-input reduction as the first rollout objective. The
explicit runner also suppresses the Ripwire session primer by default because
a follow-up tool-using quality probe passed on all eight runs and measured a
large fresh-turn latency reduction. Keep the normal primer available through
`--ripwire-session-primer`. Do not silently reroute existing workflows into a
nested native session.

## Reason

The explicit runner creates a real, testable integration boundary without
inventing a broker. One process owns one thread and one visible ledger branch. The user can
send suffix task packets and live control commands while the existing parent
workflow remains safe.

## Consequences

- Programmatic callers have one entry point and JSONL protocol.
- Native dispatch forwards explicit `--reasoning-effort` to the thread's
  `model_reasoning_effort` config. Omit it to inherit the selected Codex config.
- Turns inherit the thread's approval and sandbox settings unless a caller
  explicitly overrides them. The ready receipt includes `thread_settings`
  returned by app-server, separate from requested values. These confirm the
  app-server configuration, not the model served by a remote provider.
- The first turn carries the stable prefix. Later turns carry suffix packets.
- The runner is read-only and ephemeral by default.
- Runner receipts expose phase timing so provider latency and local ledger work
  can be measured separately.
- Runner receipts expose a bounded observer trace for hook ownership and
  duration. The trace is diagnostic data, not a latency claim by itself.
- The runner suppresses the Ripwire session primer by default. The explicit
  `--ripwire-session-primer` option restores it.
- The app-server client accepts both snake-case and camel-case assistant
  completion item types.
- Completed provider compaction items are retained and recorded in the visible
  ledger even when they have no encrypted-content field.
- Programmatic Poteto callers can pass the portable delegate prompt through
  `--poteto-prompt-file`; the ready receipt records whether it loaded.
- End-to-end latency remains an open optimization target for provider and later
  lifecycle work.
- Automatic replacement of the interactive parent remains out of scope until
  the Codex host exposes a safe turn-replacement API. The dispatcher is the
  selected path for supported programmatic workflows.

Turn receipts report `usage` as the difference between cumulative thread counters before and after the turn. This counts all model calls and ignores duplicate snapshots. `thread_usage` retains the cumulative counters; `last_usage` retains the latest call. Missing cumulative counters or an unknown starting count produce `usage: null`. These counts do not measure the active context window or dollar cost.

## References

- [Native primary session](../../skills/setup-pstack/scripts/codex-primary-session.mjs)
- [Native primary runner](../../skills/setup-pstack/scripts/codex-primary-session-runner.mjs)
- [Workflow dispatcher](../../skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs)
- [Live dispatcher receipt](../reports/2026-09-20-workflow-dispatch-live.json)
- [Live runner report](../reports/2026-09-20-primary-runner-live.json)
- [Phase timing probe](../reports/2026-09-20-primary-runner-timing.json)
- [Observer and hook timing probe](../reports/2026-09-20-primary-runner-observer.json)
- [Primer latency hillclimb](../reports/2026-09-20-primary-runner-primer-hillclimb.json)
- [Tool-using quality comparison](../reports/2026-09-20-primary-runner-tool-quality.json)
- [Native workflow confirmation](../reports/2026-09-20-primary-workflow-confirmation.json)
