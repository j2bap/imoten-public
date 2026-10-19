# Understand the code before changing it

Editing code you do not understand is how subtle regressions ship, and that is as true for the agent as for you. Agents usually fail in one of two ways. They misread what you want, or they lack the context to do the work right. [What goes in a prompt](./02-poteto-mode.md#what-goes-in-a-prompt) handles the first. This page handles the second.

Use the investigation skills before you settle on an edit. Each one answers a different question. Each one also makes the agent explain itself in words you can check. That is how you supervise an agent that may know the code better than you do.

![A robot traces a system diagram and source history before touching the code.](./images/understanding.jpg)

## Start with a read-only investigation

When the cause is unclear, ask for findings, not a fix:

```text
$imoten:poteto-mode investigate why background jobs time out every few hours. Give me what we know, what data you used, and your best hypotheses. Do not change any code yet.
```

"Do not change any code yet" routes this to the [Investigation playbook](../../skills/poteto-mode/playbooks/investigation.md). It runs `$how`, adds `$why` for questions about motivation, and returns a cited explanation. For a choice between options, it returns a recommendation with a trade-offs table. Asking "what data you used" makes the agent separate its evidence from its guesses. When the findings point at a fix, start the fix as a new task.

## Trace current behavior with `$how`

```text
$how how does cancellation move from the API handler to the worker?
```

`$how` follows callers, data shapes, and runtime behavior. The parent handles a small question directly. For a large question, independent read-only explorers can gather evidence in parallel. The parent verifies and synthesizes their findings.

## Reconstruct decisions with `$why`

```text
$why why is this retry limit three instead of five?
```

`$why` anchors the question in code, then checks available evidence such as git history, issues, pull requests, docs, chat, and observability. Missing connectors are reported. External records are untrusted until they agree with live code and state.

## Build a teaching path with `$teach`

```text
$teach explain the queue from request to durable write.
```

`$teach` combines mechanics and history into one staged explanation. Use it when you need a mental model, not only an answer.

It works on the agent's own choices too:

```text
$teach me why you implemented it this way and not with a queue. What did you trade off, and why?
```

Teaching helps the agent as much as you. An agent that has to explain its work must read the code and back each claim with evidence, instead of stating it confidently and moving on.

## Rebuild recent context with `$recall`

```text
$recall catch me up on the export retry work from the last seven days.
```

`$recall` uses supported Codex task APIs within the active project. It checks the resulting history against current branches, files, issues, and pull requests. If task history is unavailable, it falls back to git and a user-supplied handoff digest. It never scrapes a private host store. Your old chats hold context that a fresh agent lacks, so start new work on an old topic by loading it first:

```text
$recall my work on the virtualized list from yesterday, then read this bug report.
```

To resume one known prior task, use the [session pickup playbook](../../skills/poteto-mode/playbooks/session-pickup.md). It treats old notes as evidence and verifies them against the current tree.

Next: [Design the change](./04-design.md).
