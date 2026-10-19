# Codex agent model and capability profile

Codex custom agents are standalone TOML files in project `.codex/agents/` or user `$CODEX_HOME/agents/`, defaulting to `~/.codex/agents/`. The TOML `name` field, not the filename, owns identity. Skill `agents/openai.yaml` files provide UI and invocation metadata only.

## Role matrix

| Role | Writable scope | Sandbox policy | Connector posture | Skill posture | Model policy | Capability fallback |
| --- | --- | --- | --- | --- | --- | --- |
| `imoten-poteto-agent` | Inherits the live parent request; setup does not grant writes | Inherits the live runtime so setup cannot broaden authority | Inherits, but use remains limited to the parent request | Must read `poteto-mode`; portable prompt is authoritative | Use the exact `Poteto agent` pair from `model-roles.md` unless the user supplies another validated pair | Include `poteto-agent-prompt.md` in a generic-agent task with the same pair; use the parent sequentially only when its pair matches |
| `imoten-comment-sicko` | None | Explicit `read-only` default; live parent restrictions may narrow it further | Prohibited by prompt; setup does not claim it can prove connector isolation | May use `how` and `why` for read-only investigation | Use the exact `Comment auditor` pair from `model-roles.md` unless the user supplies another validated pair | Use the portable prompt in a constrained generic agent with the same pair; otherwise skip and report the missing isolation |

Custom-agent defaults never prove the served model, effort, effective sandbox, connector set, or skill availability. A setup receipt describes written configuration only. Runtime receipts must come from an observable Codex surface.

## Model resolution

- The helper installs profiles for the direct DeepSeek provider only. It stops when the Codex config selects another provider or no provider.
- Require the selected Codex model in `/models` and prove its selected effort with a completed `/responses` request. Require a served model that matches the requested model or its dated version. Use that pair for both optional profiles. A custom pair must match the selected pair.
- Keep request proof in a separate receipt and leave `model_catalog_json` unset. Stop before changing profiles when the provider, role, model, effort, or served-model proof is missing.

Panel workflows must use every exact configured pair or report the missing lane. They must not invent a served-model receipt.

## Ownership receipt

Setup records scope, relative path, SHA-256, template source, exact model policy, and configuration-resolution status. Upgrade and uninstall may replace or remove a file only while its current hash matches the receipt. A mismatch requires human review and leaves the file and receipt intact.
