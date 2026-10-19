#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE_NAMES = Object.freeze(["personal"]);

const PROFILE_DEFAULTS = Object.freeze({
  personal: Object.freeze({
    homeSuffix: ".codex-personal",
    homeEnv: "IMOTEN_PERSONAL_CODEX_HOME",
    commandEnv: "IMOTEN_PERSONAL_CODEX_COMMAND",
    clearEnv: Object.freeze(["OPENAI_API_KEY", "OPENAI_BASE_URL"]),
  }),
});

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function assertProfileName(profile) {
  if (!PROFILE_NAMES.includes(profile)) {
    throw new Error(`profile must be one of ${PROFILE_NAMES.join(", ")}`);
  }
  return profile;
}

function parseTomlString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  if (trimmed && !/[\s#]/u.test(trimmed)) return trimmed;
  return null;
}

export function parseCodexIdentity(content) {
  const identity = {
    provider: null,
    model: null,
    reasoning_effort: null,
    model_catalog_json: null,
    default_permissions: null,
    approvals_reviewer: null,
  };
  let section = "";
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/u);
    if (header) {
      section = header[1];
      continue;
    }
    if (section) continue;
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u);
    if (!assignment) continue;
    const key = assignment[1];
    const field = {
      model_provider: "provider",
      model_reasoning_effort: "reasoning_effort",
    }[key] ?? key;
    if (!(field in identity)) continue;
    identity[field] = parseTomlString(assignment[2]);
  }
  return identity;
}

function resolveHome(profile, userHome, env) {
  const override = env[PROFILE_DEFAULTS[profile].homeEnv];
  if (override) return path.resolve(override);
  return path.join(path.resolve(userHome), PROFILE_DEFAULTS[profile].homeSuffix);
}

function resolveCommand(profile, env) {
  return env[PROFILE_DEFAULTS[profile].commandEnv] || "codex";
}

export function resolveProfile(profile, { userHome = os.homedir(), env = process.env } = {}) {
  assertProfileName(profile);
  const codexHome = resolveHome(profile, userHome, env);
  const defaults = PROFILE_DEFAULTS[profile];
  return Object.freeze({
    profile,
    codexHome,
    configPath: path.join(codexHome, "config.toml"),
    roleMapPath: path.join(codexHome, "imoten-models.md"),
    command: resolveCommand(profile, env),
    clearEnv: [...defaults.clearEnv],
  });
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function inspectProfile(profile, options = {}) {
  const resolved = resolveProfile(profile, options);
  const configExists = await fileExists(resolved.configPath);
  const roleMapExists = await fileExists(resolved.roleMapPath);
  const identity = configExists
    ? parseCodexIdentity(await fs.readFile(resolved.configPath, "utf8"))
    : null;
  const nativeDefault = profile === "personal" && configExists && !identity?.provider;
  const warnings = [];
  if (!configExists) warnings.push("config.toml is missing");
  if (!identity?.provider && !nativeDefault) warnings.push("provider is implicit and not proven by config.toml");
  if (!identity?.model) warnings.push("model is missing from config.toml");
  if (!identity?.reasoning_effort) warnings.push("reasoning effort is missing from config.toml");
  if (!roleMapExists) warnings.push("imoten-models.md is missing");
  return {
    ...resolved,
    config_exists: configExists,
    role_map_exists: roleMapExists,
    provider: identity?.provider ?? (nativeDefault ? "native-default" : "implicit-default"),
    model: identity?.model ?? null,
    reasoning_effort: identity?.reasoning_effort ?? null,
    model_catalog_json: identity?.model_catalog_json ?? null,
    default_permissions: identity?.default_permissions ?? null,
    approvals_reviewer: identity?.approvals_reviewer ?? null,
    identity_status: warnings.length ? "review-required" : "configured",
    warnings,
  };
}

export function buildProfileEnvironment(profile, baseEnv = process.env, options = {}) {
  const resolved = resolveProfile(profile, options);
  const environment = {
    ...baseEnv,
    CODEX_HOME: resolved.codexHome,
    IMOTEN_ACTIVE_CODEX_HOME: resolved.codexHome,
  };
  for (const key of resolved.clearEnv) delete environment[key];
  return environment;
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || !["doctor", "run"].includes(command)) {
    throw new Error("usage: imoten-profile.mjs <doctor|run> --profile personal [--strict] [-- command args]");
  }
  let profile = null;
  let strict = false;
  let index = 1;
  while (index < argv.length && argv[index] !== "--") {
    const flag = argv[index];
    if (flag === "--profile" && argv[index + 1]) {
      profile = argv[index + 1];
      index += 2;
      continue;
    }
    if (flag === "--strict") {
      strict = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown option "${flag}"`);
  }
  if (!profile) throw new Error("--profile is required");
  return { command, profile: assertProfileName(profile), strict, childArgs: argv[index] === "--" ? argv.slice(index + 1) : [] };
}

async function runChild(profile, childArgs) {
  if (!childArgs.length) throw new Error("run requires command arguments after --");
  const resolved = resolveProfile(profile);
  const child = spawn(resolved.command, childArgs, {
    env: buildProfileEnvironment(profile),
    stdio: "inherit",
  });
  const forward = (signal) => child.kill(signal);
  process.once("SIGINT", () => forward("SIGINT"));
  process.once("SIGTERM", () => forward("SIGTERM"));
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 1;
      resolve();
    });
  });
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.command === "doctor") {
    const report = await inspectProfile(args.profile);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (args.strict && report.identity_status !== "configured") process.exitCode = 3;
    return;
  }
  await runChild(args.profile, args.childArgs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
