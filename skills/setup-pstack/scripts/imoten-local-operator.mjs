#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const configuredHome = process.env.IMOTEN_ACTIVE_CODEX_HOME ?? process.env.CODEX_HOME;
const installedHome = process.argv[1]
  && path.basename(process.argv[1]) === "imoten-local-operator"
  && path.basename(path.dirname(process.argv[1])) === "bin"
  ? path.dirname(path.dirname(path.resolve(process.argv[1])))
  : null;
const resolvedConfiguredHome = configuredHome ? path.resolve(configuredHome) : null;
const profileMismatch = installedHome && resolvedConfiguredHome && installedHome !== resolvedConfiguredHome;
const configRoot = installedHome ?? resolvedConfiguredHome ?? path.join(os.homedir(), ".codex");
const configPath = path.join(configRoot, "imoten-local-operator.json");

const SYSTEM_PROMPT = `You are Imoten's Local operator. Complete only the bounded task in the supplied packet. You may diagnose a bug from the supplied evidence. Use submit_result exactly once. Set status to completed only when the supplied evidence supports the result. Set status to escalate when information is missing, the task needs repository navigation or tools, or the result needs architecture, security, product, or final user judgment. Do not invent facts, run commands, edit files, or request more context.`;

const RESULT_TOOL = {
  type: "function",
  function: {
    name: "submit_result",
    description: "Return the checked result or ask the remote role to continue.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["completed", "escalate"] },
        summary: { type: "string" },
        evidence: { type: "array", items: { type: "string" }, maxItems: 8 },
      },
      required: ["status", "summary", "evidence"],
    },
  },
};

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} has unknown field ${unknown}`);
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function requiredInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function parsePrompt(value) {
  if (!isRecord(value)) throw new Error("prompt must be an object");
  assertOnlyKeys(value, new Set(["context", "task"]), "prompt");
  const context = value.context ?? [];
  if (!Array.isArray(context)) throw new Error("prompt.context must be an array");
  return {
    context: context.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`prompt.context[${index}] must be an object`);
      assertOnlyKeys(entry, new Set(["name", "text"]), `prompt.context[${index}]`);
      return {
        name: requiredText(entry.name, `prompt.context[${index}].name`),
        text: requiredText(entry.text, `prompt.context[${index}].text`),
      };
    }),
    task: requiredText(value.task, "prompt.task"),
  };
}

function parseDispatchRequest(value, config) {
  if (!isRecord(value)) throw new Error("dispatch request must be an object");
  assertOnlyKeys(value, new Set(["schema_version", "role", "prompt", "max_output_tokens"]), "dispatch request");
  if (value.schema_version !== 1) throw new Error("dispatch request schema_version must be 1");
  if (value.role !== config.role) throw new Error(`dispatch role must be ${config.role}`);
  return {
    prompt: parsePrompt(value.prompt),
    maxOutputTokens: value.max_output_tokens === undefined
      ? config.max_output_tokens
      : requiredInteger(value.max_output_tokens, "max_output_tokens", { max: config.max_output_tokens }),
  };
}

function parseConfig(value) {
  if (!isRecord(value)) throw new Error("local operator config must be an object");
  assertOnlyKeys(value, new Set([
    "schema_version", "role", "backend", "base_url", "model", "max_concurrency",
    "request_timeout_ms", "max_output_tokens",
  ]), "local operator config");
  if (value.schema_version !== 1) throw new Error("local operator config schema_version must be 1");
  const baseUrl = new URL(requiredText(value.base_url, "base_url"));
  if (baseUrl.protocol !== "http:" || baseUrl.hostname !== "127.0.0.1") {
    throw new Error("base_url must use http://127.0.0.1");
  }
  return {
    role: requiredText(value.role, "role"),
    backend: requiredText(value.backend, "backend"),
    baseUrl: baseUrl.toString().replace(/\/$/u, ""),
    model: requiredText(value.model, "model"),
    maxConcurrency: requiredInteger(value.max_concurrency, "max_concurrency", { max: 32 }),
    requestTimeoutMs: requiredInteger(value.request_timeout_ms, "request_timeout_ms", { max: 600_000 }),
    maxOutputTokens: requiredInteger(value.max_output_tokens, "max_output_tokens", { max: 2048 }),
  };
}

async function loadConfig() {
  let value;
  try {
    value = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`local operator config is missing at ${configPath}`);
    if (error instanceof SyntaxError) throw new Error(`local operator config is not valid JSON at ${configPath}`);
    throw error;
  }
  return parseConfig(value);
}

async function readRequestFile(requestFile) {
  if (!path.isAbsolute(requestFile)) throw new Error("the dispatch request file must be absolute");
  const metadata = await fs.lstat(requestFile);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("the dispatch request file must be a regular file");
  if (metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) {
    throw new Error("the dispatch request file must be private and owned by the current user");
  }
  if (metadata.size > 4 * 1024 * 1024) throw new Error("the dispatch request file exceeds 4 MiB");
  return fs.readFile(requestFile, "utf8");
}

async function readDispatchContent(argv) {
  if (argv.length === 0) {
    if (process.stdin.isTTY) throw new Error("the dispatch request must be piped through standard input");
    let content = "";
    for await (const chunk of process.stdin) content += chunk;
    if (!content.trim()) throw new Error("the dispatch request is empty");
    return content;
  }
  if (argv.length === 2 && argv[0] === "--request-json") return requiredText(argv[1], "the dispatch request");
  if (argv.length === 2 && argv[0] === "--request-file") {
    return readRequestFile(requiredText(argv[1], "the dispatch request file"));
  }
  throw new Error("dispatch accepts standard input, --request-json <json>, or --request-file <absolute-path>");
}

async function readDispatchRequest(config, argv = []) {
  return parseDispatchRequest(JSON.parse(await readDispatchContent(argv)), config);
}

async function requestJson(config, pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const headers = { ...options.headers };
  if (process.env.IMOTEN_LOCAL_API_KEY) headers.authorization = `Bearer ${process.env.IMOTEN_LOCAL_API_KEY}`;
  try {
    const response = await fetch(`${config.baseUrl}${pathname}`, { ...options, headers, signal: controller.signal });
    const body = await response.text();
    let value;
    try {
      value = JSON.parse(body);
    } catch {
      throw new Error(`local operator received invalid JSON with HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`local operator request failed with HTTP ${response.status}: ${value.error?.message ?? body}`);
    }
    return value;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`local operator request timed out after ${config.requestTimeoutMs} ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function modelIds(value) {
  const models = Array.isArray(value?.data) ? value.data : value?.models;
  if (!Array.isArray(models)) throw new Error("local model list has an invalid shape");
  return models.map((model) => requiredText(model?.id ?? model?.model, "local model id"));
}

async function probe(config) {
  const ids = modelIds(await requestJson(config, "/models"));
  if (!ids.includes(config.model)) throw new Error(`local model "${config.model}" is not served by ${config.baseUrl}`);
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    role: config.role,
    backend: config.backend,
    model: config.model,
    max_concurrency: config.maxConcurrency,
  })}\n`);
}

function parseResult(value) {
  const calls = value?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls) || calls.length !== 1) {
    throw new Error("local operator must return exactly one tool call");
  }
  const call = calls[0]?.function;
  if (call?.name !== "submit_result") throw new Error("local operator returned an unknown tool call");
  let args = call.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      throw new Error("local operator tool arguments are not valid JSON");
    }
  }
  if (!isRecord(args)) throw new Error("local operator tool arguments must be an object");
  assertOnlyKeys(args, new Set(["status", "summary", "evidence"]), "local operator result");
  if (!new Set(["completed", "escalate"]).has(args.status)) {
    throw new Error("local operator result status must be completed or escalate");
  }
  if (!Array.isArray(args.evidence) || args.evidence.length > 8) {
    throw new Error("local operator result evidence must be an array with at most 8 items");
  }
  return {
    status: args.status,
    summary: requiredText(args.summary, "local operator result summary"),
    evidence: args.evidence.map((entry, index) => requiredText(entry, `local operator result evidence[${index}]`)),
  };
}

async function dispatch(config, argv = []) {
  const request = await readDispatchRequest(config, argv);
  const started = performance.now();
  const value = await requestJson(config, "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ schema_version: 1, ...request.prompt }) },
      ],
      tools: [RESULT_TOOL],
      tool_choice: "required",
      temperature: 0,
      max_tokens: request.maxOutputTokens,
    }),
  });
  if (value.model !== config.model) {
    throw new Error(`local operator served model "${value.model ?? "unknown"}" instead of "${config.model}"`);
  }
  process.stdout.write(`${JSON.stringify({
    ...parseResult(value),
    role: config.role,
    backend: config.backend,
    model: config.model,
    elapsed_ms: Math.round(performance.now() - started),
    usage: value.usage ?? null,
  })}\n`);
}

async function main(argv) {
  if (profileMismatch) {
    throw new Error(`active Codex home ${resolvedConfiguredHome} does not own runner ${process.argv[1]}`);
  }
  const config = await loadConfig();
  const [command, ...rest] = argv;
  if (command === "probe" && rest.length === 0) return probe(config);
  if (command === "dispatch") return dispatch(config, rest);
  throw new Error("usage: imoten-local-operator <probe|dispatch [--request-json <json>|--request-file <absolute-path>]>");
}

main(process.argv.slice(2)).catch((error) => fail(error.message));
