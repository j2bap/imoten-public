# 0013: Use a prompt-stable primary session and task packets

## Context

The cache-aware context manager plan can support many branches, but the normal
workflow shares requirements, files, tool results, and a changing plan. A
branch for every phase repeats context, fragments prompt-cache reuse, and
creates more opaque-state ownership and merge work. The user also requires
that workflow skills do not become a new prefix for every agent.

Open-source agent systems commonly separate durable application memory from a
thread or prompt view. LangGraph separates thread checkpoints from durable
stores. Aider keeps a repository map and selects exact relevant context. SWE-
agent persists trajectories while constructing model-facing messages. These
patterns support one application-owned ledger and a derived prompt, not a
universal encrypted transcript.

## Decision

Use one long-lived GPT primary session for shared work. Compile a common stable
prefix once, require a prefix fingerprint, and put skill/config references and
task-specific state after the cache boundary. Keep remote compaction enabled.

Represent optional work as bounded visible `TaskPacket` and `ResultPacket`
records. Spawn a native subagent only after deterministic vetoes and a
classifier.dev decision. Use paid Jev as the fallback. Keep read-only packets
as the default and isolate any writes.

Keep the append-only visible event ledger and branch/family-scoped opaque vault
above every transport. Treat provider compaction as continuity state, not
application memory. Use the SDK or app-server for a live primary session and
keep `codex exec` for batch runs.

## Reason

This shape gives the common work one context owner, one warm cache frontier,
and one merge point. It preserves optional parallelism for tasks that can prove
independence and critical-path benefit. It also makes the cache invariant
checkable: the common prefix is byte-stable, and no full skill prompt is
prepended per agent.

The redesign is a hypothesis. The local quick benchmark is synthetic. A paired
fixed-trace API pilot must measure cache tokens, latency, cost, task success,
compaction, and encrypted-payload failures before this becomes a production
default.

## Consequences

- Ordinary coupled work stays in the parent session.
- Optional subagents need an explicit packet, receipt, and merge path.
- Filtering may change only the suffix or start a fresh visible branch; it may
  not rewrite a sealed provider window or split a tool dependency group.
- A skill version change intentionally creates a new cache generation.
- `codex exec` still cannot receive live mid-turn mailbox messages. The SDK or
  app-server adapter is required for a proved steering capability.
- The application must record classifier latency and fallback use because a
  free classifier can still add wall time and a paid fallback can erase savings.

## References

- [LangGraph persistence](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx)
- [Aider repository map](https://github.com/Aider-AI/aider/blob/main/aider/website/docs/repomap.md)
- [SWE-agent trajectories](https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/trajectories.md)
- [Goose context compaction](https://github.com/Ding-Ye/learn-goose/blob/main/docs/en/s09-context-compaction.md)
- [Letta memory](https://github.com/letta-ai/letta-docs-md/blob/main/configuration/memory/index.md)
- [AutoGen programming model](https://github.com/microsoft/autogen/blob/main/docs/design/01%20-%20Programming%20Model.md)
