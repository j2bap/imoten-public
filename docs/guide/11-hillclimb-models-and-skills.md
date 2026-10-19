# Hillclimb models and skills

Use local tasks to decide model, effort, and skill changes. Use public benchmarks to select candidates. Do not use them as the promotion test.

## Set the quality gate

Use the same cases and replicate numbers for every treatment. Run at least three interleaved replicates. Change one variable at a time:

- To test a model or effort, keep the task and skill text fixed.
- To test a skill revision, keep the task, model, effort, tools, and limits fixed.

Score each run against the five behavioral parity dimensions in [`evals/rubrics/behavioral-parity.md`](../../evals/rubrics/behavioral-parity.md). A candidate must pass every run. Its median quality score for each case must meet or exceed the baseline median.

## Capture treatment results

The Imoten runner adds `metrics` to each completed report when the event log has valid usage data. It reports model, effort, elapsed time, token usage, and tool counts. A run can still complete when metrics are absent, but you cannot use that run in a comparison.

Completed runner reports also carry `metrics.phases`. The receipt separates policy validation, start-approval wait, prompt read and byte count, child elapsed time, and summary parse/write overhead. Provider queue time, model inference time, and managed-host approval wait are explicit `null` values until the runtime exposes them. `null` means unavailable, not zero. Do not label `child_elapsed_ms` as model inference.

Write one JSON object per run to a JSONL file. A historical run can use `null` for an unavailable non-selected metric. The command rejects a run when the selected metric is unavailable.

```json
{"treatment":"sol-high","case":"fix-small-bug","replicate":1,"run_id":"6a49f335-0945-438f-a9eb-b3e9965aa3fd","metrics":{"model":"gpt-5.6-sol","reasoning_effort":"high","elapsed_ms":221000,"usage":{"input_tokens":13250,"cached_input_tokens":5000,"cache_write_input_tokens":0,"output_tokens":3200,"reasoning_output_tokens":800},"tools":{"total":9,"failed":0}},"quality_score":0.94,"pass":true}
```

Use `input_tokens` for skill prompt tests. Use `generated_tokens` or `elapsed_ms` for model and effort tests. `generated_tokens` adds answer and reasoning tokens. Keep the raw fields in the report so you can diagnose changes. Do not subtract cache-write tokens when you compare prompt size. New prompt text can appear there.

## Compare treatments

Run this command after you score all runs:

```sh
npm run hillclimb:compare -- \
  --input .audit/model-effort-results.jsonl \
  --baseline sol-high \
  --metric generated_tokens \
  --minimum-replicates 3 \
  --min-improvement-percent 5
```

The command accepts one unique candidate only when it clears both gates and no case regresses on the selected metric. It keeps the baseline after a quality loss, metric regression, small gain, or tie. It rejects missing cases and replicates as invalid evidence. An accepted result supports a verified role-map change.

If any baseline run fails the quality gate, the command returns an `invalid-baseline` decision. It does not evaluate candidates against a failed baseline.

The command also reports `observed_pareto`. This result maximizes the pass rate and the median quality score, and it minimizes the selected metric. Use a sole observed dominator as a provisional default. A tradeoff does not change the default.

## Historical measured comparisons

The 2026-09-13 role audit produced these results before the owner changed the default policy:

- Use Astra `xhigh` as the provisional Hardest tasks default. It beat `max` on pass rate, median quality, and median generated tokens.
- Use Luna `xhigh` as the provisional instruction and synthesis default. It passed one instruction case and one synthesis case. Its upper-bound instruction-task token cost was 89.3% lower than Terra `high`.
- The audit retained Sol `xhigh` for Performance. Sol `high` used fewer generated tokens, but it passed fewer runs and had a lower median quality score.
- The audit retained the remaining role pairs. Their tested candidates lost quality, failed runs, or remained on a quality and token tradeoff frontier.

## Current policy

On 2026-09-19, the owner updated the role map from the supplied VulcanBench Frontier v4 comparison. The map keeps Luna for its existing roles, uses Astra at `low` for lower-cost delegated work, and uses Terra at `max` for the highest-complexity work. The shared panel uses Luna `max`, Astra `low`, and Terra `max`. The benchmark is an owner policy input, not a local Imoten promotion test. Use the local Gemma operator first for eligible bounded, read-only work.

The earlier Astra `xhigh` Hardest tasks choice is historical. The current role map supersedes it with Terra `max`.

Artificial Analysis does not list MAI-Code-1.1-Flash. Microsoft's report compares MAI-Code-1.1-Flash only with its predecessor. These sources help you select later tests. They do not prove a role change.

OpenAI's Astra prompting guidance supports shorter skill descriptions, small router skills, contextual document loading, explicit completion criteria, and calibrated test scope. Apply those changes as separate skill treatments. Do not combine them with a model change.

Sources:

- [Artificial Analysis release comparison](https://artificialanalysis.ai/?intelligence=agentic-index&intelligence-category=open-weights-vs-proprietary&models=gpt-5-6-sol%2Cgpt-6-astra-high%2Cgpt-6-astra-medium%2Cgpt-6-astra-low%2Cgpt-5-6-sol-xhigh%2Cgpt-5-6-sol-high&coding-agents=cost&releases=claude-opus-5%2Cgpt-6-astra%2Cgpt-5-6-luna%2Cgrok-4-6%2Cgemini-3-8-flash%2Cgpt-5-6-sol%2Cgpt-5-6-terra#release-comparison-tabs)
- [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
- [GPT-6 Astra model guide](https://developers.openai.com/api/docs/guides/latest-model)
- [MAI-Code-1.1-Flash announcement](https://microsoft.ai/news/mai-code-1-1-flash-br-better-faster-at-a-quarter-of-the-cost/)
