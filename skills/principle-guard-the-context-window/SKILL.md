---
name: principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads."
---

# Guard the Context Window

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.

**Pattern:**
- **Isolate large payloads.** Route verbose outputs, screenshots, and large documents to subagents. The main context gets summaries, not raw data.
- **Spill bulk to a recoverable store.** Codex cannot replace a tool result at the harness boundary, so a noisy command spills itself: `cmd 2>&1 | naru add "<topic>" | tail -1` returns one `seq N` handle instead of the payload. Recover the full text with `naru show N`, or find one part of it with `naru search "<terms>"`. Use it for test runs, build logs, wide greps, and long `git log` output.
- **Don't read what you won't use.** Read selectively based on relevance. If a file isn't needed for the current task, skip it.
- **Keep frequently used content inline.** Templates and references used on every invocation belong in the skill file, not in separate files that cost a read each time.
- **Size phases and cap scope.** Limit files per phase, set turn budgets, account for mechanism costs.
