# Typed classifier decision protocol

This protocol defines the cheap decision lane for bounded semantic choices.
`classifier.dev` is the primary provider. The paid `mcp__jev__evaluate` server
is the fallback provider. Both are classification models. The parent still
owns evidence, authority, deterministic checks, and the final action.

## Choose the lane

Before a decision, use this order:

1. Answer in the parent when the facts are known and the choice is trivial.
2. Use the typed classifier lane when the choice is bounded, latency-sensitive,
   and needs a calibrated confidence.
3. Write a deterministic check or SDK rule when the answer follows from known
   fields, thresholds, schemas, regexes, or availability data.

Do not use either classifier for code generation, prose generation, final
synthesis, exact model availability, schema validation, lifecycle authority,
credentials, destinations, or irreversible writes.

## Mandatory classification boundary

Any bounded semantic classification that carries a `confidence`, `probability`,
score, or confidence level must go through one of the two classifier providers
when the session exposes one. This includes workflow and role routes, action
labels, triage categories, severity, risk, priority, effort, and pattern
maturity.

The parent supplies the smallest sanitized evidence text and one typed question.
For a `choice`, include `no_match` when no option may fit. The parent passes a
`mcp__classifier__classify_texts` result through
[`classifier-decision-adapter.mjs`](../scripts/classifier-decision-adapter.mjs).
The adapter returns the existing typed decision envelope. Do not silently emit
a confidence-bearing fallback.

## Choose the provider and fallback

This section is the one rule for provider order, confidence gates, and
fallbacks. Other files point here. Not every profile has both providers. A
provider is present only when the session tool list exposes its tool. Check
the list before the first call. Never call an absent tool to test it.

| Outcome | Action |
| --- | --- |
| `mcp__classifier__classify_texts` is exposed | Call it through the adapter. |
| The classifier is absent | Skip it without a call. Ask `mcp__jev__evaluate` the same question. |
| The classifier returns a timeout, 429, 5xx, malformed result, unknown label, missing confidence, or other error | Ask `mcp__jev__evaluate` the same question. |
| Jev is absent or also fails | Leave the item unclassified. Use the context fallback. |
| Confidence at least `0.80` | Take the bounded action. |
| Confidence from `0.50` through `0.79` | Take the bounded action. Log the answer and flag it for review. |
| Confidence below `0.50` | Do not decide. Use the context fallback. |
| Destructive or irreversible action | Require confidence at least `0.90` and human confirmation. |

Each context has one deterministic fallback:

| Context | Fallback |
| --- | --- |
| Role route | When no provider answers, send the decision to `resolve-jev-route.mjs` with `"provider": "none"` and `"answer": null`. It picks the first `role_candidates` entry, so list the default role first. A route below `0.50` stays with the parent. |
| Ready lane | `sequential-parent`. |
| Bugbot triage | `ask`. |
| Any other classification | Escalate to the parent. |

If both providers fail, leave the item unclassified and take the context
fallback. A failed deterministic check also takes the context fallback.

The adapter maps the classifier response as follows:

| Typed question | Classifier request | Normalized answer |
| --- | --- | --- |
| `choice` | `labels` from the criteria map | `answer.choice` and `probabilities` |
| `noul` | `yes` and `no` labels | `answer.noul` is the `yes` probability |
| `score` | Ordered labels from the criteria map | `answer.score` is the probability-weighted position from 0 to 1 |

The adapter requires one result, a known label, a confidence from 0 to 1, and
scores that cover every requested label. This is the external API boundary.
Internal routing trusts the normalized envelope.

## Call the primary provider

Build one request for each independent question. The MCP request has this form:

```json
{
  "inputs": ["<sanitized evidence text>"],
  "labels": ["<candidate 1>", "<candidate 2>", "no_match"],
  "instructions": "<question and criteria>",
  "tier": "fast"
}
```

Use `fast` by default. Use `smart` when the workflow needs the remote
reasoning retry for uncertain results. The MCP tool returns structured JSON, so
the REST-only `verbose` flag is not needed. Use single-label classification for
typed questions. Do not set multi-label output for a `choice`, `noul`, or
`score` question.

Send only non-sensitive text to classifier.dev. Do not send credentials,
authorization values, customer data, or raw external content that has not
passed the existing screening boundary.

## Gate the normalized answer

Apply the confidence rows in the provider table above. The classifier confidence is distinct from a `noul` probability. Use the
provider's confidence for the gate and the normalized probability for the
typed answer.

## Route the trigger model

Do not ask a full LLM to choose a model before the classifier lane. The parent
derives deterministic workflow facts, supplies the smallest sanitized text and
the bounded role candidates, and asks for one role label. The adapter returns a
typed `choice`. Pass it through
[`resolve-jev-route.mjs`](../scripts/resolve-jev-route.mjs), which reads the
proven role map and returns the exact model and reasoning effort.

The role map and live provider proof remain authoritative. A classifier may
choose only a supplied role. It may not invent a model or effort pair.

For an automatic role route, normalize the selected choice and pass it through
the deterministic resolver. Take `<active-home>` from the trusted `Imoten
runtime receipt`. Never infer it from a missing `CODEX_HOME`.

```text
printf '%s' '<decision-json>' | node skills/poteto-mode/scripts/resolve-jev-route.mjs --role-map "<active-home>/imoten-models.md" --log "<active-home>/jev-decisions.jsonl"
```

The decision must include `role_candidates` either at the top level or under
`state`. The answer choice must be one of those candidates. The resolver
applies the confidence gate, records the provider, and returns `role_alias`,
`model`, and `reasoning_effort`. It does not call a classifier, generate prose,
or bypass the live role-map proof. A blocked result stays with the parent.

## Keep exact checks local

Exact lexical, schema, threshold, availability, and state-machine checks that
emit no confidence remain deterministic. Narrative confidence and final
explanations are parent-owned evidence and prose.

## Handle external content

Use `jev_screen` before raw web, connector, issue, attachment, or third-party
content enters either classifier state when that primitive is available. If
screening is unavailable, do not pass raw external content to a classifier.
Keep the existing untrusted-data boundary and summarize only after the parent
has handled the content safely.

## Log every answer

Record the state, question, provider, model, typed answer, confidence, gate, and
action in JSONL. Minimize state before logging and redact credentials, tokens,
and authorization values. Use the helper when the skill is installed:

```text
printf '%s' '<decision-json>' | node skills/poteto-mode/scripts/record-jev-decision.mjs
```

Pass `--log "<active-home>/jev-decisions.jsonl"` with the home from the trusted
`Imoten runtime receipt`. Without `--log`, both scripts use `JEV_DECISION_LOG`,
then `IMOTEN_ACTIVE_CODEX_HOME`, then `CODEX_HOME`. The resolver finds the role
map the same way after `IMOTEN_MODEL_ROLE_RULE`. When no home is known, the
scripts exit with an error and write nothing. They never guess `~/.codex`,
because a guess can write to the other profile. Logs are append-only. A low-confidence answer gets a new
row when a later decision supersedes it.
