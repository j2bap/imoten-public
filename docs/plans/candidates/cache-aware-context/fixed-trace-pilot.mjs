#!/usr/bin/env node

/**
 * Fixed-trace pilot harness.
 *
 * Default mode is offline and prints the exact prompts plus metadata needed
 * for a later paired provider run. Provider mode is explicit with
 * --run-provider. It uses Codex app-server by default, with codex exec kept
 * as an explicit batch transport. It records bounded usage/latency summaries,
 * not model text.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { CodexAppServerClient, classifyStderr } from "../../../../skills/setup-pstack/scripts/codex-app-server-client.mjs";

const DEFAULT_MODEL = "gpt-5.6-luna";
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const stableContext = Object.freeze([
  { name: "system", text: "You are a coding agent. Return a short verified report.\n".repeat(80) },
  { name: "project-rules", text: "Keep visible state inspectable. Do not edit opaque provider state.\n".repeat(70) },
  { name: "stable-tools", text: "read_file, test, and report are available.\n".repeat(60) },
]);

const traces = Object.freeze([
  Object.freeze({
    id: "short",
    task: "Inspect package.json and report the offline verification command.",
    dynamic: [{ name: "task-input", text: "The user wants the smallest safe verification path." }],
  }),
  Object.freeze({
    id: "long",
    task: "Inspect the context architecture documents and report the owner of durable state.",
    dynamic: [
      { name: "trace-a", text: "The canonical ledger is application-owned visible state." },
      { name: "trace-b", text: "Opaque reasoning belongs to a compatible branch vault." },
      { name: "trace-c", text: "A result packet returns visible discoveries and unresolved questions." },
      { name: "trace-d", text: "The prompt compiler constructs a derived model view." },
    ],
  }),
  Object.freeze({
    id: "pressure",
    task: "Inspect the compaction and recovery rules and report what must remain immutable.",
    dynamic: [
      { name: "compaction-a", text: "Remote compaction is continuity state, not durable application memory." },
      { name: "compaction-b", text: "The returned sealed window is replayed exactly as provided." },
      { name: "recovery-a", text: "Readable source is preserved before a matching decrypt failure retry." },
      { name: "recovery-b", text: "A missing readable source stops recovery instead of guessing." },
      { name: "recovery-c", text: "Classifier input excludes opaque bytes, secrets, and provider handles." },
      { name: "recovery-d", text: "Optional spawning is deferred while compaction is in flight." },
    ],
  }),
]);

function parseArgs(argv) {
  const options = {
    model: DEFAULT_MODEL,
    runProvider: false,
    output: null,
    transport: "app-server",
    arms: ["legacy", "redesign"],
    branches: ["alpha", "beta"],
    maxCalls: Number.POSITIVE_INFINITY,
    turnTimeoutMs: 300_000,
    codexCommand: "codex",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-provider") {
      options.runProvider = true;
      continue;
    }
    if (arg === "--model" || arg === "--output" || arg === "--transport" || arg === "--arms" || arg === "--branches" || arg === "--max-calls" || arg === "--turn-timeout-ms" || arg === "--codex-command") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--arms") options.arms = value.split(",").map((arm) => arm.trim()).filter(Boolean);
      else if (arg === "--branches") options.branches = value.split(",").map((branch) => branch.trim()).filter(Boolean);
      else if (arg === "--max-calls") options.maxCalls = Number(value);
      else if (arg === "--turn-timeout-ms") options.turnTimeoutMs = Number(value);
      else if (arg === "--codex-command") options.codexCommand = value;
      else options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node fixed-trace-pilot.mjs [--output /absolute/path.jsonl] [--run-provider] [--model MODEL] [--transport app-server|exec] [--arms legacy,redesign] [--branches alpha,beta] [--max-calls N] [--codex-command COMMAND]");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (options.output && !path.isAbsolute(options.output)) throw new Error("--output must be absolute");
  if (!["app-server", "exec"].includes(options.transport)) throw new Error("--transport must be app-server or exec");
  if (options.arms.length < 1 || options.arms.length > 2 || options.arms.some((arm) => !["legacy", "redesign"].includes(arm)) || new Set(options.arms).size !== options.arms.length) {
    throw new Error("--arms must contain legacy, redesign, or both once");
  }
  if (options.branches.length < 2 || options.branches.length > 4 || options.branches.some((branch) => !/^[A-Za-z0-9_-]+$/u.test(branch))) {
    throw new Error("--branches must contain 2 to 4 safe branch names");
  }
  if (!Number.isSafeInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 100) {
    if (options.maxCalls !== Number.POSITIVE_INFINITY) throw new Error("--max-calls must be an integer from 1 to 100");
  }
  if (!Number.isSafeInteger(options.turnTimeoutMs) || options.turnTimeoutMs < 100 || options.turnTimeoutMs > 3_600_000) {
    throw new Error("--turn-timeout-ms must be an integer from 100 to 3600000");
  }
  return options;
}

function promptBytes(context, task) {
  return Buffer.from(JSON.stringify({ schema_version: 2, context, task }), "utf8");
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function makePrompt(trace, arm, branch = "alpha") {
  if (arm === "legacy") {
    return promptBytes([
      { name: "skill", text: `full workflow skill text before shared context; branch-specific expansion for ${branch}` },
      ...stableContext,
      ...trace.dynamic,
    ], `${trace.task} branch=${branch}`);
  }
  if (arm === "redesign") {
    return promptBytes([
      ...stableContext,
      { name: "skill-reference", text: "poteto-mode@pinned-v1" },
      { name: "task-packet", text: `${trace.task} branch=${branch}` },
      ...trace.dynamic,
    ], `${trace.task} branch=${branch}`);
  }
  throw new Error(`unknown arm ${arm}`);
}

function longestCommonPrefix(left, right) {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) index += 1;
  return index;
}

function makeFixtureRow(trace, arm, branch = "alpha") {
  const prompt = makePrompt(trace, arm, branch);
  const branchPrompts = ["alpha", "beta", "gamma", "delta"].map((candidate) => makePrompt(trace, arm, candidate));
  const commonPrefixBytes = branchPrompts.slice(1).reduce(
    (common, branchPrompt) => longestCommonPrefix(branchPrompts[0].subarray(0, common), branchPrompt),
    branchPrompts[0].length,
  );
  return {
    trace: trace.id,
    arm,
    branch,
    prompt_bytes: prompt.length,
    estimated_input_tokens: Math.ceil(prompt.length / 4),
    prompt_sha256: sha(prompt),
    stable_prefix_bytes: promptBytes(stableContext, "").length,
    common_prefix_bytes: commonPrefixBytes,
    common_prefix_token_estimate: Math.floor(commonPrefixBytes / 4),
    dynamic_items: trace.dynamic.length,
    provider: null,
    elapsed_ms: null,
    first_event_ms: null,
    first_token_ms: null,
    session_start_ms: null,
    observer: null,
    usage: null,
  };
}

function fixtureRows() {
  const rows = [];
  for (const trace of traces) {
    for (const arm of ["legacy", "redesign"]) {
      rows.push(makeFixtureRow(trace, arm));
    }
  }
  return rows;
}

function providerRows(branches, arms) {
  const rows = [];
  for (const trace of traces) {
    for (const arm of arms) {
      for (const branch of branches) rows.push(makeFixtureRow(trace, arm, branch));
    }
  }
  return rows;
}

function parseUsage(event) {
  const usage = event?.response?.usage ?? event?.usage ?? event?.response_completed?.usage;
  if (!usage || typeof usage !== "object") return null;
  return {
    input_tokens: Number.isSafeInteger(usage.input_tokens) ? usage.input_tokens : null,
    cached_input_tokens: Number.isSafeInteger(usage.cached_input_tokens) ? usage.cached_input_tokens : null,
    cache_write_input_tokens: Number.isSafeInteger(usage.cache_write_input_tokens) ? usage.cache_write_input_tokens : null,
    output_tokens: Number.isSafeInteger(usage.output_tokens) ? usage.output_tokens : null,
    reasoning_output_tokens: Number.isSafeInteger(usage.reasoning_output_tokens) ? usage.reasoning_output_tokens : null,
    total_tokens: Number.isSafeInteger(usage.total_tokens) ? usage.total_tokens : null,
  };
}

function runCodexExec(prompt, model, codexCommand) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(codexCommand, [
      "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--model", model, "-C", WORKSPACE, "-",
    ], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({
        code: null,
        signal: null,
        elapsed_ms: Math.round(Number(process.hrtime.bigint() - started) / 1_000_000),
        usage: null,
        stderr_bytes: Buffer.byteLength(stderr),
        stderr_kind: error.code === "ENOENT" ? "codex_not_found" : "spawn_failed",
        events: 0,
        turn_started: false,
      });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const events = stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      const usages = events.map(parseUsage).filter(Boolean);
      const usage = usages.length > 0 ? usages[usages.length - 1] : null;
      resolve({
        code,
        signal,
        elapsed_ms: Math.round(elapsedMs),
        usage,
        stderr_bytes: Buffer.byteLength(stderr),
        stderr_kind: classifyStderr(stderr),
        events: events.length,
        turn_started: events.some((event) => event.type === "turn.started" || event.type === "turn.completed"),
      });
    });
    child.stdin.end(prompt);
  });
}

function appServerInput(prompt) {
  return [{ type: "text", text: prompt.toString("utf8") }];
}

function summarizeObserverTrace(result) {
  const trace = Array.isArray(result?.observer_trace) ? result.observer_trace : [];
  const hookRuns = trace.filter((entry) => entry?.hook_event);
  const hookElapsedMs = hookRuns.reduce(
    (sum, entry) => sum + (Number.isFinite(entry.hook_duration_ms) ? entry.hook_duration_ms : 0),
    0,
  );
  const userMessageCompleted = trace.find(
    (entry) => entry?.method === "item/completed" && entry.item_type === "userMessage",
  );
  return {
    trace,
    trace_truncated: result?.observer_trace_truncated === true,
    hook_count: hookRuns.length,
    hook_elapsed_ms: hookElapsedMs,
    user_message_completed_ms: userMessageCompleted?.elapsed_ms ?? null,
  };
}

async function runAppServerTrace(trace, arm, branches, model, turnTimeoutMs, codexCommand) {
  const rows = branches.map((branch) => makeFixtureRow(trace, arm, branch));
  const connectionStarted = process.hrtime.bigint();
  const client = new CodexAppServerClient({ command: codexCommand, cwd: WORKSPACE, turnTimeoutMs });
  let connectionStartMs = null;
  try {
    await client.connect();
    connectionStartMs = Math.round(Number(process.hrtime.bigint() - connectionStarted) / 1_000_000);
    for (const row of rows) {
      const prompt = makePrompt(trace, arm, row.branch);
      const threadStarted = process.hrtime.bigint();
      let thread = null;
      let threadStartMs = null;
      try {
        thread = await client.startThread({ model, cwd: WORKSPACE, sandbox: "read-only", ephemeral: true, approvalPolicy: "never" });
        threadStartMs = Math.round(Number(process.hrtime.bigint() - threadStarted) / 1_000_000);
        const result = await client.runTurn({
          threadId: thread.threadId,
          input: appServerInput(prompt),
          model,
          cwd: WORKSPACE,
          timeoutMs: turnTimeoutMs,
        });
        row.provider = {
          transport: "app-server",
          model,
          thread_id: thread.threadId,
          turn_id: result.turnId,
          turn_started: true,
          status: result.status,
          failure_kind: result.failure_kind,
          events: result.event_count,
          opaque_items_seen: result.opaque_items_seen,
          compaction_items_seen: result.compaction_items_seen,
          server_requests: client.serverRequestCount,
          usage_observed: result.usage !== null,
          stderr_bytes: 0,
          stderr_kind: null,
          valid_observation: result.status === "completed" && result.usage !== null,
        };
        row.elapsed_ms = result.elapsed_ms;
        row.first_event_ms = result.first_event_ms;
        row.first_token_ms = result.first_token_ms;
        row.session_start_ms = connectionStartMs;
        row.thread_start_ms = threadStartMs;
        row.observer = summarizeObserverTrace(result);
        row.usage = result.usage;
      } catch (error) {
        row.provider = {
          transport: "app-server",
          model,
          thread_id: thread?.threadId ?? null,
          turn_id: error.turnId ?? null,
          turn_started: Boolean(error.turnId),
          status: "failed",
          failure_kind: error.failureKind ?? error.kind ?? "turn_failed",
          events: 0,
          opaque_items_seen: 0,
          compaction_items_seen: 0,
          server_requests: client.serverRequestCount,
          usage_observed: false,
          stderr_bytes: error.stderrBytes ?? 0,
          stderr_kind: error.stderrKind ?? error.kind ?? "turn_failed",
          valid_observation: false,
        };
        row.session_start_ms = connectionStartMs;
        row.thread_start_ms = threadStartMs;
      }
    }
  } catch (error) {
    for (const row of rows) {
      row.provider = {
        transport: "app-server",
        model,
        thread_id: null,
        turn_id: null,
        turn_started: false,
        status: "transport_failed",
        failure_kind: error.failureKind ?? error.kind ?? "transport_failed",
        events: client.protocolEventCount,
        opaque_items_seen: 0,
        compaction_items_seen: 0,
        server_requests: client.serverRequestCount,
        usage_observed: false,
        stderr_bytes: error.stderrBytes ?? Buffer.byteLength(client.stderr),
        stderr_kind: error.stderrKind ?? error.kind ?? classifyStderr(client.stderr) ?? "transport_failed",
        valid_observation: false,
      };
      row.session_start_ms = connectionStartMs;
      row.thread_start_ms = null;
    }
  } finally {
    await client.close();
  }
  return rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let rows = fixtureRows();
  let providerAttempts = 0;
  if (options.runProvider) {
    rows = providerRows(options.branches, options.arms).slice(0, options.maxCalls);
    if (options.transport === "app-server") {
      const measured = [];
      const selectedKeys = new Set(rows.map((row) => `${row.trace}:${row.arm}:${row.branch}`));
      for (const trace of traces) {
      for (const arm of options.arms) {
          const branches = options.branches.filter((branch) => selectedKeys.has(`${trace.id}:${arm}:${branch}`));
          if (branches.length === 0) continue;
          const group = await runAppServerTrace(trace, arm, branches, options.model, options.turnTimeoutMs, options.codexCommand);
          measured.push(...group);
          providerAttempts += group.filter((row) => row.provider?.turn_started).length;
        }
      }
      const measuredByKey = new Map(measured.map((row) => [`${row.trace}:${row.arm}:${row.branch}`, row]));
      rows = rows.map((row) => measuredByKey.get(`${row.trace}:${row.arm}:${row.branch}`) ?? row);
    } else {
      for (const row of rows) {
        const prompt = makePrompt(traces.find((candidate) => candidate.id === row.trace), row.arm, row.branch);
        const result = await runCodexExec(prompt, options.model, options.codexCommand);
        row.provider = {
          transport: "exec",
          model: options.model,
          exit_code: result.code,
          signal: result.signal,
          turn_started: result.turn_started,
          events: result.events,
          stderr_bytes: result.stderr_bytes,
          stderr_kind: result.stderr_kind,
          valid_observation: result.code === 0 && result.turn_started && result.usage !== null,
        };
        row.elapsed_ms = result.elapsed_ms;
        row.usage = result.usage;
        providerAttempts += result.turn_started ? 1 : 0;
      }
    }
  }
  const output = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  if (options.output) await fs.writeFile(options.output, output, { mode: 0o600 });
  console.log(`fixed-trace-pilot mode=${options.runProvider ? "provider" : "offline"} transport=${options.runProvider ? options.transport : "none"} traces=${traces.length} arms=${options.runProvider ? options.arms.length : 2} branches=${options.runProvider ? options.branches.length : 1} provider_attempts=${providerAttempts}`);
  for (const row of rows) {
    const suffix = row.provider
      ? ` status=${row.provider.status ?? (row.provider.exit_code === 0 ? "completed" : "failed")} failure=${row.provider.failure_kind ?? "none"} elapsed_ms=${row.elapsed_ms ?? "n/a"} first_event_ms=${row.first_event_ms ?? "n/a"} first_token_ms=${row.first_token_ms ?? "n/a"} connection_ms=${row.session_start_ms ?? "n/a"} thread_ms=${row.thread_start_ms ?? "n/a"} hooks_ms=${row.observer?.hook_elapsed_ms ?? "n/a"} input=${row.usage?.input_tokens ?? "n/a"} cached=${row.usage?.cached_input_tokens ?? "n/a"} cache_write=${row.usage?.cache_write_input_tokens ?? "n/a"} output=${row.usage?.output_tokens ?? "n/a"} reasoning=${row.usage?.reasoning_output_tokens ?? "n/a"} compactions=${row.provider.compaction_items_seen ?? "n/a"} valid=${row.provider.valid_observation}`
      : "";
    console.log(`${row.trace.padEnd(8)} ${row.arm.padEnd(8)} ${row.branch.padEnd(6)} bytes=${String(row.prompt_bytes).padStart(6)} tokens≈${String(row.estimated_input_tokens).padStart(6)} common_prefix=${String(row.common_prefix_bytes).padStart(6)} sha=${row.prompt_sha256}${suffix}`);
  }
  if (options.output) console.log(`summary_output=${options.output}`);
  if (!options.runProvider) console.log("provider_run=disabled; add --run-provider for the app-server pilot or --transport exec for the batch control");
  if (options.runProvider && providerAttempts === 0) console.log("provider_observation=blocked_or_failed_before_turn; do not use this run for cache, latency, cost, or task-success claims");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
