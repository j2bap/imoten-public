#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertFiniteInteger } from "./codex-app-server-client.mjs";
import { buildProfileEnvironment, inspectProfile } from "./imoten-profile.mjs";

const NATIVE_RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), "codex-primary-session-runner.mjs");

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be non-empty text`);
  return value;
}

function assertAbsolute(value, label) {
  const text = assertText(value, label);
  if (!path.isAbsolute(text)) throw new TypeError(`${label} must be absolute`);
  return text;
}

function parseArgs(argv) {
  const options = {
    profile: null,
    rootDir: null,
    branchId: "primary",
    modelFamily: null,
    model: null,
    reasoningEffort: null,
    cwd: process.cwd(),
    commonPrefixFile: null,
    potetoPromptFile: null,
    sandbox: "read-only",
    approvalPolicy: "never",
    turnTimeoutMs: 300_000,
    command: "codex",
    commandArgs: ["app-server", "--listen", "stdio://"],
  };
  let customCommandArgs = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    const value = argv[index + 1];
    if ([
      "--profile", "--root-dir", "--branch-id", "--model-family", "--model", "--reasoning-effort",
      "--cwd", "--common-prefix-file", "--poteto-prompt-file", "--sandbox", "--approval-policy",
      "--turn-timeout-ms", "--command", "--command-arg",
    ].includes(arg)) {
      if (value === undefined || (value.startsWith("--") && arg !== "--command-arg")) throw new Error(`${arg} needs a value`);
      if (arg === "--profile") options.profile = value;
      else if (arg === "--root-dir") options.rootDir = value;
      else if (arg === "--branch-id") options.branchId = value;
      else if (arg === "--model-family") options.modelFamily = value;
      else if (arg === "--model") options.model = value;
      else if (arg === "--reasoning-effort") options.reasoningEffort = value;
      else if (arg === "--cwd") options.cwd = value;
      else if (arg === "--common-prefix-file") options.commonPrefixFile = value;
      else if (arg === "--poteto-prompt-file") options.potetoPromptFile = value;
      else if (arg === "--sandbox") options.sandbox = value;
      else if (arg === "--approval-policy") options.approvalPolicy = value;
      else if (arg === "--turn-timeout-ms") options.turnTimeoutMs = Number(value);
      else if (arg === "--command") options.command = value;
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
  if (options.profile === null) throw new Error("--profile is required");
  if (options.rootDir === null) throw new Error("--root-dir is required");
  assertText(options.profile, "profile");
  assertAbsolute(options.rootDir, "root-dir");
  assertText(options.branchId, "branch-id");
  assertAbsolute(options.cwd, "cwd");
  if (options.commonPrefixFile !== null) assertAbsolute(options.commonPrefixFile, "common-prefix-file");
  if (options.potetoPromptFile !== null) assertAbsolute(options.potetoPromptFile, "poteto-prompt-file");
  if (options.modelFamily !== null) assertText(options.modelFamily, "model-family");
  if (options.model !== null) assertText(options.model, "model");
  if (options.reasoningEffort !== null) assertText(options.reasoningEffort, "reasoning-effort");
  if (!(options.sandbox === "read-only")) throw new Error("only the read-only sandbox is supported");
  assertFiniteInteger(options.turnTimeoutMs, "turn-timeout-ms", { min: 100, max: 3_600_000 });
  return options;
}

export function inferModelFamily(model) {
  const match = /^gpt-(\d+)\.(\d+)/u.exec(model);
  return match ? `gpt-${match[1]}-${match[2]}` : model;
}

export function nativeRunnerArgs(options, model) {
  const args = [
    NATIVE_RUNNER,
    "--root-dir", options.rootDir,
    "--branch-id", options.branchId,
    "--model-family", options.modelFamily ?? inferModelFamily(model),
    "--model", model,
    "--cwd", options.cwd,
    "--common-prefix-file", options.commonPrefixFile,
    "--sandbox", options.sandbox,
    "--approval-policy", options.approvalPolicy,
    "--turn-timeout-ms", String(options.turnTimeoutMs),
    "--command", options.command,
  ];
  for (const value of options.commandArgs) args.push("--command-arg", value);
  if (options.reasoningEffort != null) args.push("--reasoning-effort", options.reasoningEffort);
  if (options.potetoPromptFile !== null) args.push("--poteto-prompt-file", options.potetoPromptFile);
  return args;
}

function usage() {
  return [
    "Usage: node imoten-workflow-dispatch.mjs --profile personal",
    "  --root-dir ABSOLUTE_DIR --common-prefix-file ABSOLUTE_JSON",
    "  [--model MODEL] [--model-family FAMILY] [--reasoning-effort EFFORT]",
    "  [--turn-timeout-ms MS]",
    "",
    "The JSONL protocol accepts run, steer, interrupt, compact, and close commands.",
    "Each dispatch uses one CodexPrimarySession thread.",
    "Effort inherits the selected Codex config unless --reasoning-effort is set.",
  ].join("\n");
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function createNativeProxy(options, profile, model) {
  if (options.commonPrefixFile === null) throw new Error("--common-prefix-file is required for native dispatch");
  const child = spawn(process.execPath, nativeRunnerArgs(options, model), {
    cwd: options.cwd,
    env: buildProfileEnvironment(options.profile),
    stdio: ["pipe", "pipe", "inherit"],
  });
  child.stdout.pipe(process.stdout);
  process.stdin.pipe(child.stdin);
  process.stdin.once("end", () => child.stdin.end());
  const terminate = (signal) => child.kill(signal);
  process.once("SIGINT", () => terminate("SIGINT"));
  process.once("SIGTERM", () => terminate("SIGTERM"));
  writeMessage({ type: "dispatch_ready", transport: "native-primary", provider: profile.provider, model });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) process.exitCode = 1;
      else process.exitCode = code ?? 1;
      resolve();
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const profile = await inspectProfile(options.profile);
  if (profile.identity_status !== "configured") {
    throw new Error(`profile ${options.profile} is not configured: ${profile.warnings.join(", ")}`);
  }
  if (options.command === "codex" && profile.command !== "codex") options.command = profile.command;
  const model = options.model ?? profile.model;
  if (!model) throw new Error("--model is required when the profile has no default model");
  await createNativeProxy(options, profile, model);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
