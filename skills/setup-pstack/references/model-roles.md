# Imoten model roles

This file defines the shared model-role map. Setup writes the map to `$CODEX_HOME/imoten-models.md`, defaulting to `~/.codex/imoten-models.md` when `CODEX_HOME` is unset. Runtime scripts do not use that default. They read `IMOTEN_ACTIVE_CODEX_HOME`, then `CODEX_HOME`, and fail closed. The role names stay compatible with upstream pstack and Claude Code.

Every remote role and panel lane uses an exact model and reasoning-effort pair. If the runtime or provider cannot serve that pair, stop the lane and report it. Do not inherit the parent model or select a substitute.

## Recommended Codex map

| Role | Model | Effort |
| --- | --- | --- |
| Fast profile | `gpt-6-luna` | `medium` |
| Instruction-following profile | `gpt-6-luna` | `xhigh` |
| Judgment and prose profile | `gpt-6-astra` | `max` |
| Poteto agent | `gpt-6-sol` | `max` |
| Comment auditor | `gpt-6-astra` | `max` |
| Feature delegate | `gpt-6-sol` | `max` |
| Refactoring delegate | `gpt-6-sol` | `max` |
| Bug-fix delegate | `gpt-6-astra` | `low` |
| Performance delegate | `gpt-6-astra` | `low` |
| Hillclimb delegate | `gpt-6-astra` | `low` |
| Hardest tasks | `gpt-6-astra` | `max` |
| How explorer | `gpt-6-luna` | `max` |
| Why investigator | `gpt-6-astra` | `low` |
| Why synthesizer | `gpt-6-astra` | `low` |
| Reflect tooling | `gpt-6-astra` | `low` |
| Reflect judgment | `gpt-6-astra` | `low` |
| Reflect divergent | `gpt-6-astra` | `low` |
| Reflect synthesizer | `gpt-6-astra` | `low` |
| Swarm worker | `gpt-6-luna` | `high` |

## Recommended local map

The local operator is provisional under [ADR 0007](../../../docs/adr/0007-gate-model-and-skill-promotion.md). Use it only for bounded, read-only work with an automatic check. Ripwire owns repository navigation. Fall back to the selected remote role when the endpoint is unavailable, the model asks to escalate, or the result fails validation.

| Role | Backend | Model | Endpoint | Max concurrency |
| --- | --- | --- | --- | --- |
| Local operator | `omlx` | `mlx-community--gemma-4-e2b-it-4bit` | `http://127.0.0.1:8123/v1` | `4` |

## Shared review panel

Use this ordered panel for `Arena runners`, `Arena cross-judges`, `Architect runners`, `Interrogate reviewers`, and `Independent verifiers`. `thermos` uses entries 1 and 2 for its two reviewers:

1. `gpt-6-luna` with `max`
2. `gpt-6-astra` with `low`
3. `gpt-6-sol` with `max`

## Cost basis

Use pairs that the active catalog serves. GPT-6-Luna covers fast and bounded work. GPT-6-Sol covers routine coding and agent work. GPT-6-Astra covers judgment and the hardest work; its `low` pair remains assigned to bounded delegated work. Use all three models in the shared review panel. These assignments follow the current native model catalog and model descriptions. They are owner policy, not a measured local promotion.

## Decision status

The native personal profile's 2026-09-28 selector catalog exposes the listed GPT-6 pairs. It proves availability in that profile only, not provider support or role quality. Another provider must prove each selected pair with its own live request. Do not copy native catalog evidence to another profile.

| Scope | Current default | Status | Basis |
| --- | --- | --- | --- |
| Remote role map | GPT-6-Luna, GPT-6-Sol, and GPT-6-Astra pairs above | Provisional owner policy | On 2026-09-28, the owner requested that the role map use the current native catalog. The assignments use the model descriptions and are not local promotion results. |
| Fast profile | GPT-6-Luna `medium` | Provisional owner policy | The current native catalog serves this pair. The earlier three-run result measured GPT-5.6-Luna, not GPT-6-Luna. |
| Hardest tasks | GPT-6-Astra `max` | Provisional owner policy | The native model description positions Astra for demanding work. No local Imoten promotion test has compared this pair. |
| Local operator | Gemma 4 E2B at MTP depth 4 | Provisional | The local test measured 91.1 generation tokens per second, 228.6 aggregate tokens per second across four requests, 10 of 10 correct tool routes, and 9 of 10 correct small debugging cases. |

The supplied VulcanBench chart informed the earlier role policy. It does not prove the quality of GPT-6 model pairs. Keep the new assignments provisional until local tests compare them.

Use [ADR 0007](../../../docs/adr/0007-gate-model-and-skill-promotion.md) for the promotion gate. Use the [model and skill hillclimb guide](../../../docs/guide/11-hillclimb-models-and-skills.md) for treatment details.

## Runtime rules

- A remote Codex host generates and verifies its own map. Do not copy a local proof receipt. A prompt-forwarding dispatcher uses this policy only when it selects and verifies each exact pair.
- A Claude Enterprise account is a separate backend. Reflect Claude Code models in reports and policy text only. Do not write them to `model_catalog_json`. Keep Claude roles unassigned until Imoten can verify the backend and the served canonical model.
- Direct DeepSeek verifies the configured model through `GET /models` and the exact pair through `POST /responses`. It assigns that pair to every role. It does not write `model_catalog_json`.

Keep this file as plain Markdown. Record validation dates and sources. Do not include credentials or entitlement data.
