#!/usr/bin/env node

import { createInterface } from "node:readline";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { assertFiniteInteger, elapsedMs } from "./codex-app-server-client.mjs";
import { CodexPrimarySession } from "./codex-primary-session.mjs";

const DEFAULT_TURN_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_TEXT_BYTES = 16 * 1024;

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be non-empty text`);
  return value;
}

function boundedText(value, maxBytes = MAX_OUTPUT_TEXT_BYTES) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  return `${bytes.subarray(0, maxBytes).toString("utf8")}\n[truncated]`;
}

function elapsedMilliseconds(startedAt) {
  return Math.round(elapsedMs(startedAt));
}

function parseArgs(argv) {
  const options = {
    rootDir: null,
    branchId: "primary",
    modelFamily: null,
    model: null,
    reasoningEffort: null,
    cwd: process.cwd(),
    commonPrefixFile: null,
    potetoPromptFile: null,
    command: "codex",
    commandArgs: ["app-server", "--listen", "stdio://"],
    sandbox: "read-only",
    approvalPolicy: "never",
    turnTimeoutMs: DEFAULT_TURN_TIMEOUT_MS,
    skipRipwireSessionPrimer: true,
  };
  let customCommandArgs = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--ripwire-session-primer") {
      options.skipRipwireSessionPrimer = false;
      continue;
    }
    if (arg === "--root-dir" || arg === "--branch-id" || arg === "--model-family" || arg === "--model" || arg === "--reasoning-effort"
      || arg === "--cwd" || arg === "--common-prefix-file" || arg === "--poteto-prompt-file" || arg === "--command" || arg === "--sandbox"
      || arg === "--approval-policy" || arg === "--turn-timeout-ms" || arg === "--command-arg") {
      const value = argv[index + 1];
      if (value === undefined || (value.startsWith("--") && arg !== "--command-arg")) throw new Error(`${arg} needs a value`);
      if (arg === "--root-dir") options.rootDir = value;
      else if (arg === "--branch-id") options.branchId = value;
      else if (arg === "--model-family") options.modelFamily = value;
      else if (arg === "--model") options.model = value;
      else if (arg === "--reasoning-effort") options.reasoningEffort = value;
      else if (arg === "--cwd") options.cwd = value;
      else if (arg === "--common-prefix-file") options.commonPrefixFile = value;
      else if (arg === "--poteto-prompt-file") options.potetoPromptFile = value;
      else if (arg === "--command") options.command = value;
      else if (arg === "--sandbox") options.sandbox = value;
      else if (arg === "--approval-policy") options.approvalPolicy = value;
      else if (arg === "--turn-timeout-ms") options.turnTimeoutMs = Number(value);
      else if (arg === "--command-arg") {
        if (!customCommandArgs) {
          options.commandArgs = [];
          customCommandArgs = true;
        }
        options.commandArgs.push(value);
      }
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  if (options.rootDir === null) throw new Error("--root-dir is required");
  if (options.commonPrefixFile === null) throw new Error("--common-prefix-file is required");
  assertText(options.rootDir, "root-dir");
  assertText(options.branchId, "branch-id");
  assertText(options.modelFamily, "model-family");
  assertText(options.model, "model");
  if (options.reasoningEffort !== null) assertText(options.reasoningEffort, "reasoning-effort");
  assertText(options.cwd, "cwd");
  assertText(options.commonPrefixFile, "common-prefix-file");
  if (options.potetoPromptFile !== null) assertText(options.potetoPromptFile, "poteto-prompt-file");
  assertText(options.command, "command");
  assertText(options.approvalPolicy, "approval-policy");
  if (!path.isAbsolute(options.rootDir)) throw new Error("--root-dir must be absolute");
  if (!path.isAbsolute(options.cwd)) throw new Error("--cwd must be absolute");
  if (!path.isAbsolute(options.commonPrefixFile)) throw new Error("--common-prefix-file must be absolute");
  if (options.potetoPromptFile !== null && !path.isAbsolute(options.potetoPromptFile)) throw new Error("--poteto-prompt-file must be absolute");
  if (!new Set(["read-only", "workspace-write", "danger-full-access"]).has(options.sandbox)) {
    throw new Error("--sandbox must be read-only, workspace-write, or danger-full-access");
  }
  assertFiniteInteger(options.turnTimeoutMs, "turn-timeout-ms", { min: 100, max: 3_600_000 });
  return options;
}

function usage() {
  return [
    "Usage: node codex-primary-session-runner.mjs",
    "  --root-dir ABSOLUTE_DIR --model-family FAMILY --model MODEL",
    "  --common-prefix-file ABSOLUTE_JSON [options]",
    "",
    "The JSONL input protocol accepts run, steer, interrupt, compact, and close commands.",
    "Each command may include an id. One app-server thread stays open for the process.",
    "",
    "Options: --branch-id ID --cwd ABSOLUTE_DIR --sandbox read-only|workspace-write|danger-full-access",
    "         --reasoning-effort EFFORT (otherwise inherit the selected Codex config)",
    "         --approval-policy POLICY --turn-timeout-ms N --command COMMAND",
    "         --poteto-prompt-file ABSOLUTE_MD (append the portable Poteto delegate prompt)",
    "         --ripwire-session-primer (opt in to the normal session primer)",
    "         --command-arg VALUE (repeat to replace the default app-server arguments)",
  ].join("\n");
}

async function readJsonFile(file) {
  let value;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`common prefix file is unavailable or invalid at ${file}`, { cause: error });
  }
  if (!Array.isArray(value)) throw new Error("common prefix file must contain a JSON array");
  return value;
}

async function readPromptFile(file) {
  let value;
  try {
    value = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new Error(`Poteto prompt file is unavailable at ${file}`, { cause: error });
  }
  if (!value.trim()) throw new Error(`Poteto prompt file is empty at ${file}`);
  return value;
}

function assertCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("command must be an object");
  if (typeof value.op !== "string" || !value.op.trim()) throw new TypeError("command.op must be non-empty text");
  const id = value.id === undefined ? null : assertText(value.id, "command.id");
  if (value.op === "run") {
    const allowed = new Set(["op", "id", "task", "skill_reference", "selected_bundle_ids", "retrieve_bundle_ids"]);
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`run command has unknown field ${key}`);
    const task = assertText(value.task, "run.task");
    const skillReference = value.skill_reference ?? null;
    if (skillReference !== null) assertText(skillReference, "run.skill_reference");
    const selectedBundleIds = value.selected_bundle_ids ?? null;
    if (selectedBundleIds !== null && (!Array.isArray(selectedBundleIds) || !selectedBundleIds.every((entry) => typeof entry === "string" && entry.trim()))) {
      throw new TypeError("run.selected_bundle_ids must be text[] or null");
    }
    const retrieveBundleIds = value.retrieve_bundle_ids ?? [];
    if (!Array.isArray(retrieveBundleIds) || !retrieveBundleIds.every((entry) => typeof entry === "string" && entry.trim())) {
      throw new TypeError("run.retrieve_bundle_ids must be text[]");
    }
    return { op: value.op, id, task, skillReference, selectedBundleIds, retrieveBundleIds };
  }
  if (value.op === "steer") {
    const allowed = new Set(["op", "id", "text"]);
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`steer command has unknown field ${key}`);
    return { op: value.op, id, text: assertText(value.text, "steer.text") };
  }
  if (["interrupt", "compact", "close"].includes(value.op)) {
    const allowed = new Set(["op", "id"]);
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${value.op} command has unknown field ${key}`);
    return { op: value.op, id };
  }
  throw new TypeError(`unknown command op ${value.op}`);
}

function resultSummary(result, runnerTiming) {
  return {
    status: result.status,
    prompt_mode: result.prompt_mode,
    thread_id: result.threadId,
    turn_id: result.turnId,
    failure_kind: result.failure_kind ?? null,
    elapsed_ms: result.elapsed_ms,
    first_event_ms: result.first_event_ms,
    first_token_ms: result.first_token_ms,
    observer_trace: result.observer_trace ?? [],
    observer_trace_truncated: result.observer_trace_truncated === true,
    event_count: result.event_count,
    opaque_items_seen: result.opaque_items_seen,
    compaction_items_seen: result.compaction_items_seen,
    cache: result.cache ?? null,
    selected_bundle_ids: result.selected_bundle_ids ?? [],
    cold_bundle_ids: result.cold_bundle_ids ?? [],
    timing: result.timing ?? null,
    runner_timing: runnerTiming,
    usage: result.usage ?? null,
    thread_usage: result.thread_usage ?? null,
    last_usage: result.last_usage ?? null,
    assistant_text: boundedText(result.assistant_text),
  };
}

function receiptSummary(receipt) {
  return {
    state: receipt.state,
    thread_id: receipt.thread_id,
    turn_id: receipt.turn_id,
    text: receipt.text,
  };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const bootstrapStartedAt = process.hrtime.bigint();
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const commonPrefix = await readJsonFile(options.commonPrefixFile);
  if (options.potetoPromptFile !== null) {
    commonPrefix.push({ name: "poteto-agent-prompt", text: await readPromptFile(options.potetoPromptFile) });
  }
  const appServerEnv = options.skipRipwireSessionPrimer
    ? { ...process.env, RIPWIRE_METER_ARM: "control" }
    : process.env;
  const session = new CodexPrimarySession({
    rootDir: options.rootDir,
    branchId: options.branchId,
    modelFamily: options.modelFamily,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    cwd: options.cwd,
    command: options.command,
    commandArgs: options.commandArgs,
    env: appServerEnv,
    commonPrefix,
    sandbox: options.sandbox,
    ephemeral: true,
    approvalPolicy: options.approvalPolicy,
    turnTimeoutMs: options.turnTimeoutMs,
  });
  let activeRun = null;
  let closing = false;
  const run = async (command) => {
    if (activeRun) throw new Error("a primary turn is already running");
    const commandStartedAt = process.hrtime.bigint();
    activeRun = session.run({
      task: command.task,
      skillReference: command.skillReference,
      selectedBundleIds: command.selectedBundleIds,
      retrieveBundleIds: command.retrieveBundleIds,
    });
    try {
      const result = await activeRun;
      writeMessage({
        type: "result",
        id: command.id,
        ...resultSummary(result, {
          command_to_result_ms: elapsedMilliseconds(commandStartedAt),
          session_run_ms: result.timing?.session_run_ms ?? null,
        }),
      });
    } finally {
      activeRun = null;
    }
  };
  const respondError = (id, error) => writeMessage({
    type: "error",
    id,
    error_kind: error?.kind ?? error?.failureKind ?? "command_failed",
    message: boundedText(error?.message ?? error),
  });
  const finish = async () => {
    if (closing) return;
    closing = true;
    if (activeRun) await activeRun.catch(() => {});
    await session.close().catch(() => {});
  };
  try {
    const initStartedAt = process.hrtime.bigint();
    await session.init();
    writeMessage({
      type: "ready",
      thread_id: session.thread?.threadId ?? null,
      capabilities: session.capabilities,
      model: options.model,
      thread_settings: session.thread?.settings ?? null,
      model_family: options.modelFamily,
      poteto_prompt: options.potetoPromptFile === null ? "not_loaded" : "loaded",
      ripwire_session_primer: options.skipRipwireSessionPrimer ? "disabled" : "enabled",
      timing: {
        bootstrap_ms: elapsedMilliseconds(bootstrapStartedAt),
        session_init_ms: elapsedMilliseconds(initStartedAt),
        initialization: session.initializationTiming,
      },
    });
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      let command;
      try {
        command = assertCommand(JSON.parse(line));
      } catch (error) {
        respondError(null, error);
        continue;
      }
      if (closing) {
        respondError(command.id, new Error("runner is closing"));
        continue;
      }
      try {
        if (command.op === "run") {
          void run(command).catch((error) => respondError(command.id, error));
        } else if (command.op === "steer") {
          const receipt = await session.steer(command.text);
          writeMessage({ type: "steer_result", id: command.id, ...receiptSummary(receipt) });
        } else if (command.op === "interrupt") {
          await session.interrupt();
          writeMessage({ type: "interrupt_result", id: command.id, status: "requested" });
        } else if (command.op === "compact") {
          await session.compact();
          writeMessage({ type: "compact_result", id: command.id, status: "requested" });
        } else if (command.op === "close") {
          await finish();
          writeMessage({ type: "closed", id: command.id });
          input.close();
        }
      } catch (error) {
        respondError(command.id, error);
      }
    }
    await finish();
  } catch (error) {
    respondError(null, error);
    await finish();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
