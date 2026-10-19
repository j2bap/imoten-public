# 0007: Gate model and skill promotion with local evidence

## Context

Public model indexes help select model and effort candidates. Vendor reports help select models that lack a shared index. These sources use workloads, prompts, tools, and prices that do not match Imoten's roles.

Imoten already preserves each delegated Codex event stream. The stream records token usage and tool calls. The runner did not expose those facts in its completed report. The repository also had a behavioral parity rubric, but no deterministic command that compared scored treatments.

## Decision

Expose elapsed time, token usage, tool counts, and local phase timings in completed Imoten runner reports. Keep a completed agent result valid when metrics are absent. Report the metric error instead. Keep provider queue, model inference, and managed-host approval wait explicitly unavailable until the runtime exposes them. Never infer those phases from total child elapsed time.

Compare model, effort, and skill treatments with fixed cases and replicate numbers. Require every run to pass. Require each candidate's median quality score for every case to meet or exceed the baseline. Reject a candidate when any case regresses on the selected efficiency metric. Rank the remaining candidates by the pooled median. Accept one candidate only when it clears the configured improvement floor and does not tie another candidate.

If any baseline run fails, return an `invalid-baseline` report and do not evaluate candidates against it. Keep invalid experiments machine-readable so the audit trail can record the failed gate without treating the command itself as broken.

Also report the observed Pareto frontier. Maximize the run pass rate and the median quality score. Minimize the selected efficiency metric. One treatment dominates another only when it is no worse on all three values and better on at least one.

The observed frontier does not verify a promotion. If a failed baseline has one observed dominator, use the dominator as the provisional policy default and repeat the treatment. If the frontier contains a tradeoff, keep the current policy default until a valid treatment or an owner decision selects the preferred axis.

Keep experiments separate from `skills/setup-pstack/references/model-roles.md`. Update the role map after an accepted treatment or a provisional observed-dominator decision. Label a provisional change in the role map.

Use token counts or elapsed time until Imoten has a dated, machine-readable price source with cache billing rules. Do not infer dollar cost from undated prose or public benchmark charts.

## Reason

This keeps task quality as a hard gate for verified promotions. It also prevents a pooled result from hiding a regression in one task class. The observed frontier removes status quo bias when the current default is worse on every measured axis. The runner remains the only owner of runtime facts, and the comparison command remains the only owner of promotion policy.
