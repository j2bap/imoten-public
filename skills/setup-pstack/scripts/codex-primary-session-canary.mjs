#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { CodexPrimarySession } from "./codex-primary-session.mjs";

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_MODEL_FAMILY = "gpt-5-6";
const DEFAULT_TURN_TIMEOUT_MS = 300_000;
const DEFAULT_PRESSURE_TURNS = 6;
const DEFAULT_PRESSURE_BYTES = 30_000;
const MAX_PRESSURE_TURNS = 12;
const MAX_PRESSURE_BYTES = 120_000;

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be non-empty text`);
  return value;
}

function assertInteger(value, label, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    mode: "both",
    model: DEFAULT_MODEL,
    modelFamily: DEFAULT_MODEL_FAMILY,
    turnTimeoutMs: DEFAULT_TURN_TIMEOUT_MS,
    pressureTurns: DEFAULT_PRESSURE_TURNS,
    pressureBytes: DEFAULT_PRESSURE_BYTES,
    output: null,
    keepRoot: false,
    requireApplied: false,
    requireCompaction: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep-root") {
      options.keepRoot = true;
      continue;
    }
    if (arg === "--require-applied") {
      options.requireApplied = true;
      continue;
    }
    if (arg === "--require-compaction") {
      options.requireCompaction = true;
      continue;
    }
    if (["--mode", "--model", "--model-family", "--turn-timeout-ms", "--pressure-turns", "--pressure-bytes", "--output"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--mode") options.mode = value;
      else if (arg === "--model") options.model = value;
      else if (arg === "--model-family") options.modelFamily = value;
      else if (arg === "--turn-timeout-ms") options.turnTimeoutMs = Number(value);
      else if (arg === "--pressure-turns") options.pressureTurns = Number(value);
      else if (arg === "--pressure-bytes") options.pressureBytes = Number(value);
      else options.output = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node codex-primary-session-canary.mjs [--mode steering|pressure|both] [--model MODEL] [--model-family FAMILY] [--turn-timeout-ms N] [--pressure-turns N] [--pressure-bytes N] [--output ABSOLUTE_PATH] [--keep-root] [--require-applied] [--require-compaction]");
      return null;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!["steering", "pressure", "both"].includes(options.mode)) throw new Error("--mode must be steering, pressure, or both");
  assertText(options.model, "model");
  assertText(options.modelFamily, "modelFamily");
  assertInteger(options.turnTimeoutMs, "turn-timeout-ms", { min: 100, max: 3_600_000 });
  assertInteger(options.pressureTurns, "pressure-turns", { min: 1, max: MAX_PRESSURE_TURNS });
  assertInteger(options.pressureBytes, "pressure-bytes", { min: 1_000, max: MAX_PRESSURE_BYTES });
  if (options.output !== null && !path.isAbsolute(options.output)) throw new Error("--output must be an absolute path");
  return options;
}

function commonPrefix() {
  return [
    { name: "system", text: "You are a read-only Codex canary. Follow the task and return a short result." },
    { name: "project", text: "Do not edit files. Do not expose secrets. Report only the requested marker or a short failure." },
  ];
}

function boundedText(value, maxBytes = 512) {
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value);
  return Buffer.byteLength(text, "utf8") <= maxBytes
    ? text
    : `${Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")}…`;
}

function sessionOptions(rootDir, options, onEvent) {
  return {
    rootDir,
    branchId: "primary",
    modelFamily: options.modelFamily,
    model: options.model,
    cwd: process.cwd(),
    sandbox: "read-only",
    ephemeral: true,
    approvalPolicy: "never",
    turnTimeoutMs: options.turnTimeoutMs,
    commonPrefix: commonPrefix(),
    onEvent,
  };
}

async function runSteering(rootDir, options) {
  let session;
  let steerPromise = null;
  let steerAccepted = false;
  let steerError = null;
  session = new CodexPrimarySession(sessionOptions(path.join(rootDir, "steering"), options, (event) => {
    if (event.method !== "turn/started" || steerPromise) return;
    steerPromise = session.steer("When the running task finishes, include the exact marker LIVE_STEER_ACK if you received this message. Do not edit files.");
    steerPromise.then(() => { steerAccepted = true; }, (error) => {
      steerError = { kind: error?.kind ?? null, message: boundedText(error?.message ?? error) };
    });
  }));
  try {
    const result = await session.run({
      task: "Use the read-only shell to run the command sleep 8 and wait for it to finish. Then reply with exactly BASE_DONE unless a live steering message changes the reply. Do not edit files.",
    });
    if (steerPromise) await steerPromise;
    const assistantText = boundedText(result.assistant_text);
    return {
      status: result.status,
      thread_id: result.threadId,
      turn_id: result.turnId,
      steer_accepted: steerAccepted,
      steer_error: steerError,
      applied_marker_seen: assistantText.includes("LIVE_STEER_ACK"),
      assistant_text: assistantText,
      elapsed_ms: result.elapsed_ms,
      first_event_ms: result.first_event_ms,
      first_token_ms: result.first_token_ms,
      failure_kind: result.failure_kind ?? null,
    };
  } catch (error) {
    if (steerPromise) await steerPromise.catch(() => {});
    return {
      status: "error",
      error_kind: error?.kind ?? null,
      error_message: boundedText(error?.message ?? error),
      stderr_kind: error?.stderrKind ?? null,
      stderr_bytes: error?.stderrBytes ?? null,
      steer_accepted: steerAccepted,
      steer_error: steerError,
    };
  } finally {
    await session.close().catch(() => {});
  }
}

function pressureTask(turn, bytes) {
  const header = `Pressure turn ${turn}. Return PRESSURE_${turn} after reading this task.\n`;
  const filler = "Keep this visible pressure payload unchanged. ".repeat(Math.ceil(bytes / 46));
  return header + filler.slice(0, Math.max(0, bytes - Buffer.byteLength(header, "utf8")));
}

async function runPressure(rootDir, options) {
  let compactionCount = 0;
  const session = new CodexPrimarySession(sessionOptions(path.join(rootDir, "pressure"), options, (event) => {
    if (event.method === "item/completed" && event.item_type === "contextCompaction") {
      compactionCount += 1;
    }
  }));
  const turns = [];
  try {
    for (let turn = 1; turn <= options.pressureTurns; turn += 1) {
      const result = await session.run({ task: pressureTask(turn, options.pressureBytes) });
      turns.push({
        turn,
        status: result.status,
        turn_id: result.turnId,
        elapsed_ms: result.elapsed_ms,
        input_tokens: result.usage?.input_tokens ?? null,
        cached_input_tokens: result.usage?.cached_input_tokens ?? null,
        compaction_items_seen: result.compaction_items_seen,
        failure_kind: result.failure_kind ?? null,
      });
      if (result.status !== "completed") break;
    }
    const automaticCompactions = compactionCount;
    let forcedCompaction = false;
    if (turns.every((entry) => entry.status === "completed")) {
      await session.compact();
      const deadline = Date.now() + 30_000;
      while (compactionCount === automaticCompactions && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      forcedCompaction = compactionCount > automaticCompactions;
      if (forcedCompaction) await session.run({ task: "Return COMPACTION_FOLLOWUP after the compaction event." });
    }
    const ledger = await session.manager.readLedger();
    const compactionItems = compactionCount;
    return {
      status: turns.length === options.pressureTurns && turns.every((entry) => entry.status === "completed") ? "completed" : "failed",
      turns,
      compaction_items: compactionItems,
      automatic_compaction_items: automaticCompactions,
      forced_compaction: forcedCompaction,
      ledger_events: ledger.length,
      ledger_compactions: ledger.filter((event) => event.kind === "compaction").length,
      capabilities_after_run: session.capabilities,
    };
  } catch (error) {
    return {
      status: "error",
      turns,
      compaction_items: turns.reduce((sum, entry) => sum + entry.compaction_items_seen, 0),
      error_kind: error?.kind ?? null,
      error_message: boundedText(error?.message ?? error),
      stderr_kind: error?.stderrKind ?? null,
      stderr_bytes: error?.stderrBytes ?? null,
    };
  } finally {
    await session.close().catch(() => {});
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options === null) return;
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "pstack-primary-session-canary-"));
  const report = {
    schema_version: 1,
    model: options.model,
    model_family: options.modelFamily,
    transport: "app-server",
    sandbox: "read-only",
    mode: options.mode,
    steering: null,
    pressure: null,
  };
  try {
    if (options.mode === "steering" || options.mode === "both") report.steering = await runSteering(rootDir, options);
    if (options.mode === "pressure" || options.mode === "both") report.pressure = await runPressure(rootDir, options);
    if (options.output) await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(report));
    if (options.requireApplied && !report.steering?.applied_marker_seen) process.exitCode = 3;
    if (options.requireCompaction && !(report.pressure?.compaction_items > 0)) process.exitCode = 3;
  } finally {
    if (!options.keepRoot) await rm(rootDir, { recursive: true, force: true });
    else console.error(`canary_root=${rootDir}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});

export { parseArgs, pressureTask, runPressure, runSteering };
