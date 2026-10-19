#!/usr/bin/env node

/**
 * A cheap, deterministic design simulation.
 *
 * This does not call a model and does not observe provider cache behaviour.
 * It compares two prompt/workflow shapes under explicit assumptions so that
 * the expensive fixed-trace pilot has a concrete hypothesis to test.
 */

import process from "node:process";

const DEFAULTS = Object.freeze({
  n: 5000,
  seed: 20260919,
  bootstrap: 2000,
});

const ASSUMPTIONS = Object.freeze({
  stablePrefixTokens: 18000,
  fullSkillTokens: 2200,
  taskPacketTokens: 700,
  warmCacheShare: 0.88,
  legacyCacheShare: 0.34,
  modelMsPerKInput: 15,
  modelMsPerKOutput: 42,
  execStartupMs: 430,
  warmRequestMs: 70,
  classifierMs: 95,
  jevFallbackRate: 0.03,
  jevFallbackMs: 640,
  mergeMs: 180,
  compactionLimitTokens: 30000,
  uncachedCostUnit: 1,
  cachedCostUnit: 0.1,
  outputCostUnit: 1.4,
  reasoningCostUnit: 1.8,
  jevCostUnit: 0.35,
});

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--n" || arg === "--seed" || arg === "--bootstrap") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${arg} needs a positive integer`);
      }
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node quick-benchmark.mjs [--n 5000] [--seed 20260919] [--bootstrap 2000]");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function integerBetween(random, low, high) {
  return Math.floor(low + random() * (high - low + 1));
}

function chooseWorkload(random) {
  const roll = random();
  if (roll < 0.5) return "short";
  if (roll < 0.8) return "long";
  return "pressure";
}

function makeTrace(random, id) {
  const workload = chooseWorkload(random);
  const settings = {
    short: { turns: [3, 5], additions: [1800, 5200], independent: 0.16, filter: 0.1 },
    long: { turns: [5, 8], additions: [3200, 8200], independent: 0.42, filter: 0.2 },
    pressure: { turns: [8, 11], additions: [5200, 10500], independent: 0.3, filter: 0.24 },
  }[workload];
  const turns = integerBetween(random, settings.turns[0], settings.turns[1]);
  const additions = [];
  const visibleDynamic = [];
  let accumulated = 0;
  for (let turn = 0; turn < turns; turn += 1) {
    const addition = integerBetween(random, settings.additions[0], settings.additions[1]);
    additions.push(addition);
    accumulated += addition;
    visibleDynamic.push(accumulated);
  }
  const independent = random() < settings.independent;
  return Object.freeze({
    id,
    workload,
    turns,
    additions: Object.freeze(additions),
    visibleDynamic: Object.freeze(visibleDynamic),
    independent,
    filterShare: settings.filter,
    gateSpawn: independent && random() < (workload === "long" ? 0.72 : 0.55),
    classifierFallback: random() < ASSUMPTIONS.jevFallbackRate,
  });
}

function addModelWork(metrics, { promptTokens, cachedTokens, outputTokens, reasoningTokens }) {
  const safeCached = Math.min(promptTokens, Math.max(0, cachedTokens));
  const uncachedTokens = promptTokens - safeCached;
  metrics.totalInput += promptTokens;
  metrics.cachedInput += safeCached;
  metrics.uncachedInput += uncachedTokens;
  metrics.outputTokens += outputTokens;
  metrics.reasoningTokens += reasoningTokens;
  metrics.costUnits += safeCached * ASSUMPTIONS.cachedCostUnit;
  metrics.costUnits += uncachedTokens * ASSUMPTIONS.uncachedCostUnit;
  metrics.costUnits += outputTokens * ASSUMPTIONS.outputCostUnit;
  metrics.costUnits += reasoningTokens * ASSUMPTIONS.reasoningCostUnit;
  metrics.latencyMs +=
    (promptTokens / 1000) * ASSUMPTIONS.modelMsPerKInput +
    (outputTokens / 1000) * ASSUMPTIONS.modelMsPerKOutput;
  metrics.calls += 1;
}

function emptyMetrics() {
  return {
    totalInput: 0,
    cachedInput: 0,
    uncachedInput: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUnits: 0,
    latencyMs: 0,
    calls: 0,
    spawned: 0,
    compactions: 0,
    classifierCalls: 0,
    jevFallbacks: 0,
  };
}

function runLegacy(trace) {
  const metrics = emptyMetrics();
  let priorContext = 0;
  for (let turn = 0; turn < trace.turns; turn += 1) {
    const branchCount = trace.independent ? 3 : 1;
    const dynamic = trace.visibleDynamic[turn];
    for (let branch = 0; branch < branchCount; branch += 1) {
      const promptTokens = ASSUMPTIONS.stablePrefixTokens + ASSUMPTIONS.fullSkillTokens +
        ASSUMPTIONS.taskPacketTokens + dynamic + (branch > 0 ? 900 : 0);
      const cacheShare = turn === 0 ? 0.04 : Math.min(ASSUMPTIONS.legacyCacheShare, 0.16 + branch * 0.06);
      const outputTokens = 1300 + Math.round(dynamic / 22);
      const reasoningTokens = 900 + Math.round(dynamic / 28);
      addModelWork(metrics, {
        promptTokens,
        cachedTokens: promptTokens * cacheShare,
        outputTokens,
        reasoningTokens,
      });
      metrics.latencyMs += ASSUMPTIONS.execStartupMs;
    }
    if (dynamic > ASSUMPTIONS.compactionLimitTokens || priorContext > ASSUMPTIONS.compactionLimitTokens) {
      metrics.compactions += 1;
    }
    priorContext = dynamic;
  }
  metrics.latencyMs += Math.max(0, metrics.calls - 1) * ASSUMPTIONS.mergeMs;
  metrics.costUnits += metrics.jevFallbacks * ASSUMPTIONS.jevCostUnit;
  return metrics;
}

function runRedesign(trace, { filter = true } = {}) {
  const metrics = emptyMetrics();
  let priorSelectedDynamic = 0;
  for (let turn = 0; turn < trace.turns; turn += 1) {
    const dynamic = trace.visibleDynamic[turn];
    const retainedDynamic = filter
      ? Math.round(dynamic * (1 - trace.filterShare))
      : dynamic;
    const primaryPrompt = ASSUMPTIONS.stablePrefixTokens + ASSUMPTIONS.taskPacketTokens +
      ASSUMPTIONS.fullSkillTokens + retainedDynamic;
    const primaryCacheShare = turn === 0
      ? 0.04
      : Math.min(ASSUMPTIONS.warmCacheShare, 0.62 + (priorSelectedDynamic / Math.max(1, retainedDynamic)) * 0.18);
    const outputTokens = 1300 + Math.round(retainedDynamic / 22);
    const reasoningTokens = 900 + Math.round(retainedDynamic / 28);
    addModelWork(metrics, {
      promptTokens: primaryPrompt,
      cachedTokens: primaryPrompt * primaryCacheShare,
      outputTokens,
      reasoningTokens,
    });
    metrics.latencyMs += ASSUMPTIONS.warmRequestMs;

    const shouldClassify = retainedDynamic > 6000 || trace.independent;
    if (shouldClassify) {
      metrics.classifierCalls += 1;
      metrics.latencyMs += ASSUMPTIONS.classifierMs;
      if (trace.classifierFallback && turn === trace.turns - 1) {
        metrics.jevFallbacks += 1;
        metrics.latencyMs += ASSUMPTIONS.jevFallbackMs;
        metrics.costUnits += ASSUMPTIONS.jevCostUnit;
      }
    }

    if (trace.gateSpawn && turn === trace.turns - 1 && dynamic > 9000) {
      const childVisible = Math.min(4200, Math.max(1800, Math.round(retainedDynamic * 0.22)));
      const childPrompt = ASSUMPTIONS.stablePrefixTokens + ASSUMPTIONS.taskPacketTokens +
        ASSUMPTIONS.fullSkillTokens + childVisible;
      const childOutput = 850 + Math.round(childVisible / 35);
      const childReasoning = 520 + Math.round(childVisible / 42);
      addModelWork(metrics, {
        promptTokens: childPrompt,
        cachedTokens: childPrompt * ASSUMPTIONS.warmCacheShare,
        outputTokens: childOutput,
        reasoningTokens: childReasoning,
      });
      metrics.spawned += 1;
      // Primary and child can overlap. Keep only the child's incremental merge
      // work on the critical path, rather than adding the full child duration.
      metrics.latencyMs += ASSUMPTIONS.mergeMs;
    }

    if (retainedDynamic > ASSUMPTIONS.compactionLimitTokens) {
      metrics.compactions += 1;
    }
    priorSelectedDynamic = retainedDynamic;
  }
  return metrics;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function bootstrapMean(values, random, rounds) {
  const results = [];
  for (let round = 0; round < rounds; round += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    results.push(total / values.length);
  }
  return [quantile(results, 0.025), quantile(results, 0.975)];
}

function bootstrapReduction(legacy, redesign, random, rounds) {
  const results = [];
  for (let round = 0; round < rounds; round += 1) {
    let legacyTotal = 0;
    let redesignTotal = 0;
    for (let index = 0; index < legacy.length; index += 1) {
      const sample = Math.floor(random() * legacy.length);
      legacyTotal += legacy[sample];
      redesignTotal += redesign[sample];
    }
    results.push(legacyTotal === 0 ? 0 : ((legacyTotal - redesignTotal) / legacyTotal) * 100);
  }
  return [quantile(results, 0.025), quantile(results, 0.975)];
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function printMetric(label, legacy, redesign, random, rounds, mode = "reduction", display = "number") {
  const oldMean = mean(legacy);
  const newMean = mean(redesign);
  const observations = mode === "points"
    ? redesign.map((value, index) => value - legacy[index])
    : null;
  const estimate = mode === "points"
    ? mean(observations)
    : oldMean === 0 ? 0 : ((oldMean - newMean) / oldMean) * 100;
  const [low, high] = mode === "points"
    ? bootstrapMean(observations, random, rounds)
    : bootstrapReduction(legacy, redesign, random, rounds);
  const displayDelta = mode === "points"
    ? `${estimate >= 0 ? "+" : ""}${(estimate * 100).toFixed(1)} pp`
    : `${formatPercent(estimate)}`;
  const interval = mode === "points"
    ? `[${(low * 100).toFixed(1)} pp, ${(high * 100).toFixed(1)} pp]`
    : `[${low.toFixed(1)}%, ${high.toFixed(1)}%]`;
  const formatValue = (value) => {
    if (display === "ratio") return `${(value * 100).toFixed(1)}%`;
    if (display === "decimal") return value.toFixed(2);
    return formatNumber(value);
  };
  console.log(`${label.padEnd(22)} legacy ${formatValue(oldMean).padStart(10)}  redesign ${formatValue(newMean).padStart(10)}  change ${displayDelta.padStart(12)}  95% CI ${interval}`);
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const traceRandom = mulberry32(options.seed);
  const traces = Array.from({ length: options.n }, (_, id) => makeTrace(traceRandom, id));
  const legacy = traces.map(runLegacy);
  const redesign = traces.map((trace) => runRedesign(trace, { filter: true }));
  const noFilter = traces.map((trace) => runRedesign(trace, { filter: false }));
  const bootstrapRandom = mulberry32(options.seed ^ 0x9e3779b9);

  console.log("Synthetic cache-aware context benchmark");
  console.log(`traces=${options.n} seed=${options.seed} bootstrap=${options.bootstrap}`);
  console.log("status=simulation_only provider_calls=0 remote_compaction=on");
  console.log("assumptions=" + JSON.stringify(ASSUMPTIONS));
  console.log("metric                 legacy       redesign  change        95% CI");
  console.log("-".repeat(104));
  printMetric("total input tokens", legacy.map((m) => m.totalInput), redesign.map((m) => m.totalInput), bootstrapRandom, options.bootstrap);
  printMetric("uncached input tokens", legacy.map((m) => m.uncachedInput), redesign.map((m) => m.uncachedInput), bootstrapRandom, options.bootstrap);
  printMetric("cache share", legacy.map((m) => m.cachedInput / m.totalInput), redesign.map((m) => m.cachedInput / m.totalInput), bootstrapRandom, options.bootstrap, "points", "ratio");
  printMetric("normalized cost units", legacy.map((m) => m.costUnits), redesign.map((m) => m.costUnits), bootstrapRandom, options.bootstrap);
  printMetric("latency estimate ms", legacy.map((m) => m.latencyMs), redesign.map((m) => m.latencyMs), bootstrapRandom, options.bootstrap);
  printMetric("model calls", legacy.map((m) => m.calls), redesign.map((m) => m.calls), bootstrapRandom, options.bootstrap);
  printMetric("compactions", legacy.map((m) => m.compactions), redesign.map((m) => m.compactions), bootstrapRandom, options.bootstrap);

  const filterEffect = noFilter.map((m, index) => m.uncachedInput - redesign[index].uncachedInput);
  console.log(`\nfilter-only uncached-input reduction vs no-filter: ${formatNumber(mean(filterEffect))} tokens/trace`);
  console.log(`classifier calls/trace: ${mean(redesign.map((m) => m.classifierCalls)).toFixed(2)}; Jev fallback calls/trace: ${mean(redesign.map((m) => m.jevFallbacks)).toFixed(3)}; optional spawns/trace: ${mean(redesign.map((m) => m.spawned)).toFixed(3)}`);
  console.log("Interpretation: percentages and intervals describe this synthetic workload and assumptions only.");
  console.log("Use a paired fixed-trace API pilot before changing production defaults.");
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
