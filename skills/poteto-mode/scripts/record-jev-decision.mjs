#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { readStdin } from "./read-stdin.mjs";

const SECRET_KEY = /(?:api[_-]?key|authorization|credential|password|secret|token)/iu;
const SECRET_VALUE = /((?:api[_-]?key|authorization|bearer|password|secret|token)\s*[:=]\s*)([^\s,;]+)/giu;

// Never guess ~/.codex. A missing home may belong to the other profile.
export function activeCodexHome(env = process.env) {
  const configured = env.IMOTEN_ACTIVE_CODEX_HOME || env.CODEX_HOME;
  return configured ? path.resolve(configured) : null;
}

export function requireActiveCodexHome(env = process.env, override = "a path option") {
  const home = activeCodexHome(env);
  if (!home) {
    throw new Error(`active Codex home is unknown. Set IMOTEN_ACTIVE_CODEX_HOME from the Imoten runtime receipt, set CODEX_HOME, or pass ${override}.`);
  }
  return home;
}

export function defaultLogPath(env = process.env) {
  if (env.JEV_DECISION_LOG) return path.resolve(env.JEV_DECISION_LOG);
  return path.join(requireActiveCodexHome(env, "--log PATH"), "jev-decisions.jsonl");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function sanitize(value, key = "") {
  if (SECRET_KEY.test(key)) return "<redacted>";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "$1<redacted>");
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
  }
  return value;
}

function parseArgs(argv) {
  let logPath;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--log" || !argv[index + 1]) throw new Error("usage: record-jev-decision.mjs [--log PATH]");
    logPath = argv[index + 1];
    index += 1;
  }
  logPath ??= defaultLogPath();
  if (!path.basename(logPath)) throw new Error("log path must name a file");
  return logPath;
}

export function normalizeDecisionRecord(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("decision must be a JSON object");
  for (const field of ["state", "question", "answer"]) {
    if (!(field in input)) throw new Error(`decision.${field} is required`);
  }
  if (input.confidence !== null && (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1)) {
    throw new Error("decision.confidence must be a number from 0 to 1 or null");
  }
  if (input.action !== undefined && typeof input.action !== "string") throw new Error("decision.action must be text");
  return {
    ts: now.toISOString(),
    model: typeof input.model === "string" && input.model.trim() ? input.model : (input.provider === "none" ? null : "jev-latest"),
    provider: input.provider ?? "jev",
    state: sanitize(input.state),
    question: sanitize(input.question),
    answer: sanitize(input.answer),
    confidence: input.confidence,
    gate: typeof input.gate === "string" ? input.gate : "review-required",
    action: typeof input.action === "string" ? input.action : "",
  };
}

export async function recordDecision(input, { logPath, now = new Date(), env = process.env } = {}) {
  const record = normalizeDecisionRecord(input, now);
  logPath ??= defaultLogPath(env);
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const logPath = parseArgs(process.argv.slice(2));
    const input = JSON.parse(await readStdin());
    await recordDecision(input, { logPath });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
