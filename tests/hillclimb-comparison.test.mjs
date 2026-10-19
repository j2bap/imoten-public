import assert from "node:assert/strict";
import test from "node:test";

import { compareHillclimb, parseTreatmentResults } from "../evals/compare-hillclimb.mjs";

function row({
  treatment,
  caseName = "edit",
  replicate,
  input = 100,
  quality = 0.9,
  pass = true,
  model = "gpt-5.6-sol",
  effort = "high",
}) {
  return {
    treatment,
    case: caseName,
    replicate,
    run_id: `${treatment}-${caseName}-${replicate}`,
    metrics: {
      model,
      reasoning_effort: effort,
      elapsed_ms: input * 10,
      usage: {
        input_tokens: input,
        cached_input_tokens: 10,
        cache_write_input_tokens: 0,
        output_tokens: 20,
        reasoning_output_tokens: 5,
      },
      tools: { total: 1, failed: 0 },
    },
    quality_score: quality,
    pass,
  };
}

function compare(rows) {
  return compareHillclimb(rows, {
    baseline: "baseline",
    metric: "input_tokens",
    minimumReplicates: 3,
    minImprovementPercent: 5,
  });
}

test("accepts the only candidate that keeps quality and reduces the metric", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", replicate }));
    rows.push(row({ treatment: "candidate", replicate, input: 80 }));
  }

  const report = compare(rows);

  assert.equal(report.decision.verdict, "accept");
  assert.equal(report.decision.treatment, "candidate");
  assert.equal(report.decision.improvement_percent, 20);
});

test("keeps the baseline when a cheaper candidate loses quality", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", replicate }));
    rows.push(row({ treatment: "candidate", replicate, input: 70, quality: 0.89 }));
  }

  const report = compare(rows);

  assert.equal(report.decision.verdict, "keep-baseline");
  assert.equal(report.variants.find((entry) => entry.treatment === "candidate").pass, false);
});

test("keeps the baseline when one case gets more expensive", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", caseName: "easy", replicate, input: 100 }));
    rows.push(row({ treatment: "baseline", caseName: "hard", replicate, input: 100 }));
    rows.push(row({ treatment: "candidate", caseName: "easy", replicate, input: 40 }));
    rows.push(row({ treatment: "candidate", caseName: "hard", replicate, input: 110 }));
  }

  const report = compare(rows);

  assert.equal(report.decision.verdict, "keep-baseline");
  assert.equal(report.variants.find((entry) => entry.treatment === "candidate").pass, false);
});

test("rejects a treatment with incomplete case and replicate coverage", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", replicate }));
    if (replicate < 3) rows.push(row({ treatment: "candidate", replicate, input: 80 }));
  }

  assert.throws(() => compare(rows), /does not match the baseline case and replicate set/u);
});

test("keeps the baseline when the best candidates tie", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", replicate }));
    rows.push(row({ treatment: "candidate-a", replicate, input: 80 }));
    rows.push(row({ treatment: "candidate-b", replicate, input: 80 }));
  }

  const report = compare(rows);

  assert.equal(report.decision.verdict, "inconclusive");
  assert.equal(report.decision.treatment, "baseline");
  assert.equal(report.variants.find((entry) => entry.treatment === "candidate-a").verdict, "inconclusive");
  assert.equal(report.variants.find((entry) => entry.treatment === "candidate-b").verdict, "inconclusive");
});

test("reports an invalid baseline without throwing", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", replicate, pass: replicate !== 2 }));
    rows.push(row({ treatment: "candidate", replicate, input: 80 }));
  }

  const report = compare(rows);

  assert.equal(report.decision.verdict, "invalid-baseline");
  assert.equal(report.decision.treatment, "baseline");
  assert.equal(report.variants.find((entry) => entry.treatment === "baseline").verdict, "invalid");
  assert.equal(report.variants.find((entry) => entry.treatment === "candidate").verdict, "not-evaluated");
  assert.equal(report.observed_pareto.decision.verdict, "prefer-observed");
  assert.equal(report.observed_pareto.decision.treatment, "candidate");
});

test("reports an observed tradeoff when no treatment dominates", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", replicate, pass: replicate !== 2 }));
    rows.push(row({
      treatment: "candidate",
      replicate,
      input: 80,
      quality: 0.8,
    }));
  }

  const report = compare(rows);

  assert.equal(report.decision.verdict, "invalid-baseline");
  assert.equal(report.observed_pareto.decision.verdict, "tradeoff");
  assert.deepEqual(report.observed_pareto.treatments, ["baseline", "candidate"]);
});

test("rejects a baseline below the minimum replicate count", () => {
  assert.throws(() => compare([
    row({ treatment: "baseline", replicate: 1 }),
    row({ treatment: "baseline", replicate: 2 }),
    row({ treatment: "candidate", replicate: 1, input: 80 }),
    row({ treatment: "candidate", replicate: 2, input: 80 }),
  ]), /baseline case edit has 2 replicates, below 3/u);
});

test("keeps the baseline when the gain misses the improvement floor", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", replicate }));
    rows.push(row({ treatment: "candidate", replicate, input: 96 }));
  }

  const report = compare(rows);

  assert.equal(report.variants.find((entry) => entry.treatment === "candidate").pass, true);
  assert.equal(report.decision.verdict, "keep-baseline");
});

test("accepts elapsed time as the comparison metric", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    rows.push(row({ treatment: "baseline", replicate, input: 100 }));
    rows.push(row({ treatment: "candidate", replicate, input: 80 }));
  }

  const report = compareHillclimb(rows, {
    baseline: "baseline",
    metric: "elapsed_ms",
    minimumReplicates: 3,
    minImprovementPercent: 5,
  });

  assert.equal(report.decision.verdict, "accept");
  assert.equal(report.decision.improvement_percent, 20);
});

test("allows a missing elapsed time when another metric is selected", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    const baseline = row({ treatment: "baseline", replicate });
    const candidate = row({ treatment: "candidate", replicate, input: 80 });
    baseline.metrics.elapsed_ms = null;
    candidate.metrics.elapsed_ms = null;
    rows.push(baseline, candidate);
  }

  const report = compare(rows);

  assert.equal(report.decision.verdict, "accept");
  assert.equal(report.variants[0].medians.elapsed_ms, null);
});

test("rejects a run that lacks the selected elapsed metric", () => {
  const rows = [
    row({ treatment: "baseline", replicate: 1 }),
    row({ treatment: "candidate", replicate: 1, input: 80 }),
  ];
  rows[0].metrics.elapsed_ms = null;

  assert.throws(() => compareHillclimb(rows, {
    baseline: "baseline",
    metric: "elapsed_ms",
    minimumReplicates: 1,
    minImprovementPercent: 5,
  }), /run baseline-edit-1 is missing elapsed_ms/u);
});

test("reports the JSONL line that cannot be parsed", () => {
  assert.throws(() => parseTreatmentResults('{"treatment":"baseline"}\nnot-json\n'), /input line 2/u);
});

test("rejects an unsupported derived token metric", () => {
  assert.throws(() => compareHillclimb([
    row({ treatment: "baseline", replicate: 1 }),
    row({ treatment: "candidate", replicate: 1 }),
  ], {
    baseline: "baseline",
    metric: "uncached_input_tokens",
    minimumReplicates: 1,
    minImprovementPercent: 5,
  }), /metric must be one of input_tokens, generated_tokens, elapsed_ms/u);
});

test("generated tokens include answer and reasoning tokens", () => {
  const rows = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    const baseline = row({ treatment: "baseline", replicate });
    baseline.metrics.usage.output_tokens = 20;
    baseline.metrics.usage.reasoning_output_tokens = 80;
    const candidate = row({ treatment: "candidate", replicate });
    candidate.metrics.usage.output_tokens = 30;
    candidate.metrics.usage.reasoning_output_tokens = 50;
    rows.push(baseline, candidate);
  }

  const report = compareHillclimb(rows, {
    baseline: "baseline",
    metric: "generated_tokens",
    minimumReplicates: 3,
    minImprovementPercent: 5,
  });

  assert.equal(report.variants[0].medians.generated_tokens, 100);
  assert.equal(report.variants[1].medians.generated_tokens, 80);
  assert.equal(report.decision.verdict, "accept");
});
