# 0002: Require exact model-role pairs

## Context

Pstack used parent-model inheritance and model substitution when a requested pair was unavailable. That made role behavior depend on the active session and could collapse a multi-model panel into one model without a clear failure.

## Decision

Use one model-role map per profile at `<active Codex home>/imoten-models.md`. Setup takes the home from `CODEX_HOME` and defaults to `~/.codex`. Runtime scripts take it from `IMOTEN_ACTIVE_CODEX_HOME`, then `CODEX_HOME`, and fail closed when both are missing, so a session never reads another profile's map. Generate plain Markdown because Imoten reads the file explicitly. Do not keep a Cursor copy or fallback path.

Include a model only after a real request completes through the configured provider. Each role and panel lane selects an exact model and reasoning-effort pair with its own request proof. Accept a dated served model only when its name starts with the exact requested model plus an ISO date. Bound each catalog or proof request to 60 seconds. Retry one failed proof after a random 250 to 500 millisecond delay. If any check fails, stop that lane and report it. Capability fallbacks may change the execution surface, but they must keep the same pair. A future multi-backend dispatcher must also bind and verify the backend and served canonical model.

Direct DeepSeek uses the model and effort selected in Codex config. Verify that model through the provider model list and one completed Responses API request. Assign the proved pair to every role and use one review lane. Do not write a synthetic Codex picker for this path.

Local inference uses a separate local role table in the same shared role-map file. Bind each local role to an exact backend, canonical model, loopback endpoint, and concurrency limit. Do not add local models to the Codex picker. Do not require a reasoning-effort value that the backend does not support.

Install a separate exact-path local runner. It verifies the served model and accepts only its fixed structured result call. The central runtime tries this runner before a read-only remote dispatch only when the parent has a complete evidence packet and an automatic acceptance check. The selected remote role remains the fallback. The runner has no broker or shared request lock. oMLX owns concurrent scheduling.

The 2026-09-19 owner decision superseded the 2026-09-13 role assignments. On 2026-09-28, the owner requested a role-map refresh for the current native Codex catalog. Use GPT-6-Luna `medium` for fast work, `xhigh` for instruction following, `max` for exploration, and `high` for swarm work. Use GPT-6-Sol `max` for the Poteto, feature, and refactoring roles. Use GPT-6-Astra `low` for bounded delegated work and `max` for judgment and the hardest tasks.

Use GPT-6-Luna `max`, GPT-6-Astra `low`, and GPT-6-Sol `max` for the shared review panel. GPT-Reserve remains available in the native catalog but has no assigned role. These are provisional owner-policy assignments based on the live native catalog and model descriptions. They are not local Imoten promotion results under ADR 0007. Keep them provisional until local tests compare quality and efficiency.

The earlier GPT-5.6-Luna and GPT-5.6-Terra assignments are historical. The former Astra `xhigh` Hardest tasks choice is also historical.

## Reason

This keeps model choice explicit and reviewable. The native role map follows the active Codex catalog and records exact pairs. The GPT-6 assignments are provisional because role-specific quality and efficiency tests have not compared them under ADR 0007. The Codex-owned path gives the map one owner and removes Cursor-only syntax. It also prevents silent changes in cost, speed, and behavior when provider entitlements, model aliases, or runtime catalogs change. The request bound stops a short setup probe from hanging forever. The small random delay avoids an immediate duplicate request to an unhealthy provider.

The direct DeepSeek rule keeps the same proof standard without claiming model diversity that one provider cannot supply.

The separate local table keeps one role-map owner without forcing local inference through Codex-only validation. The fixed runner boundary lets automatically checked local work finish without remote review. Invalid or unavailable local work can fall back to the selected remote role without changing the task packet.
