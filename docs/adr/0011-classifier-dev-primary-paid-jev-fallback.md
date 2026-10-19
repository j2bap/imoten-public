# ADR 0011: Use classifier.dev as the primary decision provider

## Context

The active Codex profile has a paid local Jev MCP at `mcp_servers.jev`.
`classifier.dev` provides a keyless remote MCP and REST API backed by Jev. A
fast probe on 2026-09-19 returned HTTP 200 for six non-sensitive examples. Its
MCP `tools/list` and `classify_texts` calls also returned JSON-RPC 200. Its
smart tier returned HTTP 200, escalated two of three examples, and took about
3.9 seconds for the batch.

The services expose different wire contracts. The paid server provides the
typed `evaluate` tool with `choice`, `noul`, and `score` questions. The free
server provides labels, confidence, and per-label scores through
`classify_texts`. Its labels can represent the same bounded decisions, but the
response must be normalized before the existing gates, router, and audit log
consume it.

## Decision

Use `https://classifier.dev/mcp` as the primary provider for every bounded
semantic classification that can be expressed as one of the supported typed
questions. Build the request and normalize the response through
`skills/poteto-mode/scripts/classifier-decision-adapter.mjs`.

The adapter preserves the existing typed envelope:

- `choice` maps criteria labels to `answer.choice` and probabilities.
- `noul` uses `yes` and `no` labels and maps the `yes` probability to
  `answer.noul`.
- `score` keeps the ordered criteria and maps the classifier probabilities to
  a probability-weighted position from 0 to 1.

Keep the paid `mcp__jev__evaluate` server as the fallback when classifier.dev
returns an error, times out, reaches a rate limit, or returns a malformed
result. Feed the fallback the same sanitized state and typed question. The
existing confidence gates, role resolver, and JSONL logger consume either
provider's normalized envelope. The logger records the provider.

A profile may not expose both servers. Skip an absent provider without a
failed call. When
neither provider is present, use the fixed fallback for the context in
`skills/poteto-mode/references/jev-decision-protocol.md`. That table is the one
source for provider order, confidence gates, and fallbacks.

Use single-label classification for typed decisions. Use `no_match` as a
choice label when no candidate may fit. Keep exact checks deterministic and do
not use either provider for model availability, credentials, destinations,
permissions, or irreversible writes.

Send only non-sensitive classification text to classifier.dev. Its privacy
statement says inputs are forwarded to TypeSafe or the smart tier's reasoning
provider and are not written to disk by classifier.dev.

## Reason

This uses the free endpoint for the decisions it can express while preserving
the existing typed contract and paid fallback. The adapter keeps provider
selection at one boundary and prevents classifier response shapes from leaking
into routing or audit code.

## Fallback

When classifier.dev is unavailable, use the existing `mcp__jev__evaluate`
server. A 429, 5xx, timeout, or malformed tool result is a fallback signal.
If both providers fail, leave the item unclassified and escalate. Do not send
credentials to classifier.dev. Its anonymous limits are 3,000 fast
classifications per minute and 20,000 per day, or 200 smart classifications
per minute and 2,000 per day.
