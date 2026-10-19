#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const METRICS = new Set(["input_tokens", "generated_tokens", "elapsed_ms"]);
const USAGE_KEYS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(value, label, type) {
  if (type === "string" && (typeof value !== "string" || !value.trim())) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (type === "count" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function optionalCount(value, label) {
  if (value === null || value === undefined) return null;
  return field(value, label, "count");
}

function normalizeRow(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!isRecord(value.metrics) || !isRecord(value.metrics.usage) || !isRecord(value.metrics.tools)) {
    throw new Error(`${label} is missing metrics`);
  }
  const usage = Object.fromEntries(USAGE_KEYS.map((key) => [
    key,
    field(value.metrics.usage[key], `${label}.metrics.usage.${key}`, "count"),
  ]));
  const toolTotal = field(value.metrics.tools.total, `${label}.metrics.tools.total`, "count");
  const toolFailed = field(value.metrics.tools.failed, `${label}.metrics.tools.failed`, "count");
  if (toolFailed > toolTotal) throw new Error(`${label}.metrics.tools.failed exceeds total`);
  if (!Number.isFinite(value.quality_score) || value.quality_score < 0 || value.quality_score > 1) {
    throw new Error(`${label}.quality_score must be between 0 and 1`);
  }
  if (typeof value.pass !== "boolean") throw new Error(`${label}.pass must be a boolean`);
  if (!Number.isSafeInteger(value.replicate) || value.replicate < 1) {
    throw new Error(`${label}.replicate must be a positive integer`);
  }
  return {
    treatment: field(value.treatment, `${label}.treatment`, "string"),
    case: field(value.case, `${label}.case`, "string"),
    replicate: value.replicate,
    run_id: field(value.run_id, `${label}.run_id`, "string"),
    metrics: {
      model: field(value.metrics.model, `${label}.metrics.model`, "string"),
      reasoning_effort: field(value.metrics.reasoning_effort, `${label}.metrics.reasoning_effort`, "string"),
      elapsed_ms: optionalCount(value.metrics.elapsed_ms, `${label}.metrics.elapsed_ms`),
      usage,
      tools: { total: toolTotal, failed: toolFailed },
    },
    quality_score: value.quality_score,
    pass: value.pass,
  };
}

export function parseTreatmentResults(content) {
  const rows = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`input line ${index + 1} is not valid JSON`);
    }
    rows.push(value);
  }
  if (!rows.length) throw new Error("input has no treatment results");
  return rows;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function optionalMedian(values) {
  const present = values.filter((value) => value !== null);
  return present.length ? median(present) : null;
}

function metricValue(row, metric) {
  if (metric === "elapsed_ms") {
    if (row.metrics.elapsed_ms === null) throw new Error(`run ${row.run_id} is missing elapsed_ms`);
    return row.metrics.elapsed_ms;
  }
  if (metric === "generated_tokens") {
    return row.metrics.usage.output_tokens + row.metrics.usage.reasoning_output_tokens;
  }
  return row.metrics.usage[metric];
}

function medianByCase(rows, value) {
  const grouped = new Map();
  for (const row of rows) {
    const values = grouped.get(row.case) ?? [];
    values.push(value(row));
    grouped.set(row.case, values);
  }
  return new Map([...grouped].map(([caseName, values]) => [caseName, median(values)]));
}

function summarize(treatment, rows, metric) {
  const pair = rows[0].metrics;
  const passCount = rows.filter((row) => row.pass).length;
  return {
    treatment,
    model: pair.model,
    reasoning_effort: pair.reasoning_effort,
    sample_count: rows.length,
    pass_count: passCount,
    pass_rate: passCount / rows.length,
    medians: {
      quality_score: median(rows.map((row) => row.quality_score)),
      elapsed_ms: optionalMedian(rows.map((row) => row.metrics.elapsed_ms)),
      input_tokens: median(rows.map((row) => row.metrics.usage.input_tokens)),
      cached_input_tokens: median(rows.map((row) => row.metrics.usage.cached_input_tokens)),
      cache_write_input_tokens: median(rows.map((row) => row.metrics.usage.cache_write_input_tokens)),
      output_tokens: median(rows.map((row) => row.metrics.usage.output_tokens)),
      reasoning_output_tokens: median(rows.map((row) => row.metrics.usage.reasoning_output_tokens)),
      generated_tokens: median(rows.map((row) => metricValue(row, "generated_tokens"))),
      tool_total: median(rows.map((row) => row.metrics.tools.total)),
      tool_failed: median(rows.map((row) => row.metrics.tools.failed)),
      metric_value: median(rows.map((row) => metricValue(row, metric))),
    },
  };
}

function observedPareto(variants, metric) {
  const dominates = (left, right) => {
    const noWorse = left.pass_rate >= right.pass_rate
      && left.medians.quality_score >= right.medians.quality_score
      && left.medians.metric_value <= right.medians.metric_value;
    const better = left.pass_rate > right.pass_rate
      || left.medians.quality_score > right.medians.quality_score
      || left.medians.metric_value < right.medians.metric_value;
    return noWorse && better;
  };
  const frontier = variants.filter((entry) => (
    !variants.some((other) => other !== entry && dominates(other, entry))
  ));
  const treatments = frontier.map((entry) => entry.treatment).sort();
  const decision = treatments.length === 1
    ? {
        verdict: "prefer-observed",
        treatment: treatments[0],
        reason: `${treatments[0]} is not worse on pass rate, median quality, or ${metric}, and is better on at least one`,
      }
    : {
        verdict: "tradeoff",
        treatments,
        reason: `no treatment dominates the others on pass rate, median quality, and ${metric}`,
      };
  return {
    maximize: ["pass_rate", "median_quality_score"],
    minimize: [metric],
    treatments,
    decision,
  };
}

function experimentOptions({ baseline, metric, minimumReplicates, minImprovementPercent }) {
  const baselineTreatment = field(baseline, "baseline", "string");
  if (!METRICS.has(metric)) throw new Error(`metric must be one of ${[...METRICS].join(", ")}`);
  if (!Number.isSafeInteger(minimumReplicates) || minimumReplicates < 1) {
    throw new Error("minimumReplicates must be a positive integer");
  }
  if (!Number.isFinite(minImprovementPercent) || minImprovementPercent < 0) {
    throw new Error("minImprovementPercent must be a non-negative number");
  }
  return { baselineTreatment, metric, minimumReplicates, minImprovementPercent };
}

function groupResults(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Error("results must be a non-empty array");
  const rows = rawRows.map((row, index) => normalizeRow(row, `result ${index + 1}`));
  const runIds = new Set();
  const grouped = new Map();
  for (const row of rows) {
    if (runIds.has(row.run_id)) throw new Error(`run_id ${row.run_id} appears more than once`);
    runIds.add(row.run_id);
    const treatmentRows = grouped.get(row.treatment) ?? [];
    treatmentRows.push(row);
    grouped.set(row.treatment, treatmentRows);
  }
  return grouped;
}

function validateBaseline(baselineRows, minimumReplicates) {
  const baselineCells = new Set(baselineRows.map((row) => `${row.case}\u0000${row.replicate}`));
  if (baselineCells.size !== baselineRows.length) throw new Error("baseline contains duplicate case and replicate pairs");
  const baselineCounts = new Map();
  for (const row of baselineRows) baselineCounts.set(row.case, (baselineCounts.get(row.case) ?? 0) + 1);
  for (const [caseName, count] of baselineCounts) {
    if (count < minimumReplicates) {
      throw new Error(`baseline case ${caseName} has ${count} replicates, below ${minimumReplicates}`);
    }
  }
  return baselineCells;
}

function validateTreatment(treatment, rows, baselineCells) {
  const pairs = new Set(rows.map((row) => `${row.metrics.model}\u0000${row.metrics.reasoning_effort}`));
  if (pairs.size !== 1) throw new Error(`treatment ${treatment} mixes model and reasoning effort pairs`);
  const cells = new Set(rows.map((row) => `${row.case}\u0000${row.replicate}`));
  if (cells.size !== rows.length) throw new Error(`treatment ${treatment} contains duplicate case and replicate pairs`);
  if (cells.size !== baselineCells.size || [...baselineCells].some((key) => !cells.has(key))) {
    throw new Error(`treatment ${treatment} does not match the baseline case and replicate set`);
  }
}

function validateExperiment(grouped, baselineTreatment, minimumReplicates) {
  const baselineRows = grouped.get(baselineTreatment);
  if (!baselineRows) throw new Error(`baseline treatment ${baselineTreatment} is missing`);
  if (grouped.size < 2) throw new Error("at least one candidate treatment is required");
  const baselineCells = validateBaseline(baselineRows, minimumReplicates);
  for (const [treatment, rows] of grouped) validateTreatment(treatment, rows, baselineCells);
  return baselineRows;
}

function candidateSummary(treatment, rows, baseline, metric) {
  const quality = medianByCase(rows, (row) => row.quality_score);
  const metricByCase = medianByCase(rows, (row) => metricValue(row, metric));
  const pass = rows.every((row) => row.pass)
    && [...baseline.quality].every(([caseName, value]) => quality.get(caseName) >= value)
    && [...baseline.metricByCase].every(([caseName, value]) => metricByCase.get(caseName) <= value);
  const summary = summarize(treatment, rows, metric);
  const improvementPercent = (
    (baseline.summary.medians.metric_value - summary.medians.metric_value)
    / baseline.summary.medians.metric_value
  ) * 100;
  return {
    ...summary,
    pass,
    median_metric_by_case: Object.fromEntries(metricByCase),
    improvement_percent: improvementPercent,
    verdict: "reject",
  };
}

function decide(baselineTreatment, metric, eligible) {
  eligible.sort((left, right) => left.medians.metric_value - right.medians.metric_value || left.treatment.localeCompare(right.treatment));
  if (!eligible.length) return {
    verdict: "keep-baseline",
    treatment: baselineTreatment,
    reason: "no candidate cleared the quality and improvement gates",
  };
  const best = eligible[0];
  const tied = eligible.filter((entry) => entry.medians.metric_value === best.medians.metric_value);
  if (tied.length > 1) {
    for (const entry of tied) entry.verdict = "inconclusive";
    return {
      verdict: "inconclusive",
      treatment: baselineTreatment,
      reason: `the best eligible candidates tied at ${best.medians.metric_value}`,
    };
  }
  best.verdict = "accept";
  return {
    verdict: "accept",
    treatment: best.treatment,
    improvement_percent: best.improvement_percent,
    reason: `${best.treatment} improved ${metric} by ${best.improvement_percent.toFixed(2)}%`,
  };
}

function invalidBaselineReport(report, grouped, baselineTreatment, baseline, metric) {
  const candidates = [...grouped]
    .filter(([treatment]) => treatment !== baselineTreatment)
    .map(([treatment, rows]) => ({
      ...summarize(treatment, rows, metric),
      pass: false,
      median_metric_by_case: Object.fromEntries(medianByCase(rows, (row) => metricValue(row, metric))),
      improvement_percent: null,
      verdict: "not-evaluated",
    }));
  const variants = [{
    ...baseline.summary,
    pass: false,
    median_metric_by_case: Object.fromEntries(baseline.metricByCase),
    improvement_percent: 0,
    verdict: "invalid",
  }, ...candidates];
  return {
    ...report,
    variants,
    decision: {
      verdict: "invalid-baseline",
      treatment: baselineTreatment,
      reason: "one or more baseline results failed the quality gate",
    },
    observed_pareto: observedPareto(variants, metric),
  };
}

export function compareHillclimb(rawRows, options) {
  const { baselineTreatment, metric, minimumReplicates, minImprovementPercent } = experimentOptions(options);
  const grouped = groupResults(rawRows);
  const baselineRows = validateExperiment(grouped, baselineTreatment, minimumReplicates);
  const report = {
    schema_version: 1,
    baseline_treatment: baselineTreatment,
    metric,
    minimum_replicates: minimumReplicates,
    min_improvement_percent: minImprovementPercent,
  };
  const baseline = {
    summary: summarize(baselineTreatment, baselineRows, metric),
    quality: medianByCase(baselineRows, (row) => row.quality_score),
    metricByCase: medianByCase(baselineRows, (row) => metricValue(row, metric)),
  };
  if (baselineRows.some((row) => !row.pass)) return invalidBaselineReport(report, grouped, baselineTreatment, baseline, metric);
  if (baseline.summary.medians.metric_value === 0) throw new Error("the baseline metric median must be greater than zero");

  const candidates = [...grouped]
    .filter(([treatment]) => treatment !== baselineTreatment)
    .map(([treatment, rows]) => candidateSummary(treatment, rows, baseline, metric));
  const eligible = candidates.filter((candidate) => (
    candidate.pass && candidate.improvement_percent >= minImprovementPercent
  ));
  const variants = [{
    ...baseline.summary,
    pass: true,
    median_metric_by_case: Object.fromEntries(baseline.metricByCase),
    improvement_percent: 0,
    verdict: "baseline",
  }, ...candidates];

  return {
    ...report,
    variants,
    decision: decide(baselineTreatment, metric, eligible),
    observed_pareto: observedPareto(variants, metric),
  };
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string" },
      baseline: { type: "string" },
      metric: { type: "string" },
      "minimum-replicates": { type: "string" },
      "min-improvement-percent": { type: "string" },
    },
    strict: true,
  });
  const input = values.input;
  const baseline = values.baseline;
  const metric = values.metric;
  const minimumReplicates = Number(values["minimum-replicates"]);
  const minImprovementPercent = Number(values["min-improvement-percent"]);
  if (!input || !baseline || !metric || !Number.isFinite(minimumReplicates) || !Number.isFinite(minImprovementPercent)) {
    throw new Error("all comparison flags are required");
  }
  const rows = parseTreatmentResults(await readFile(input, "utf8"));
  process.stdout.write(`${JSON.stringify(compareHillclimb(rows, {
    baseline,
    metric,
    minimumReplicates,
    minImprovementPercent,
  }), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
