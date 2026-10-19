# ADR 0010: Bound context output at CLI boundaries

## Context

The native Codex runtime can place a large `functions.exec` result directly in
the conversation. The current hook surface cannot safely replace that result
after the tool runs. A replacement is reported as blocked and can cause a
write or other side effect to run again. Session logs also contain large raw
records and image payloads that are useful for recovery but waste active
context.

## Decision

Bound output at the command boundary. Yeon rejects final emitted values over
64 KiB by default and records the guard in local metrics. `naru spill` stores a
large one-off command result in the Naru Event Log and returns a head-and-tail
preview with a recovery sequence. Poteto Mode requires bounded fields, excludes
session JSONL and base64 image data from broad output, and uses recovery handles
instead of copying raw payloads into the transcript.

Keep full text in the local store for later retrieval. Do not add a Codex
PostToolUse replacement hook until the host provides a safe, non-repeating
replacement contract.

## Reason

This keeps the active context small without losing evidence. It gives each
boundary one owner and makes oversize output visible through metrics. The
explicit wrappers work on the current native host and fail closed when a final
answer would exceed the budget.
