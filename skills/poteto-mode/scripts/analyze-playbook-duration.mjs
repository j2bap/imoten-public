#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";

const DEFAULT_PLAYBOOK_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "playbooks");

function parseArgs(argv) {
  const options = { sessions: [], playbooks: DEFAULT_PLAYBOOK_ROOT, format: "text", includePolicy: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sessions") options.sessions.push(argv[++index]);
    else if (arg === "--playbooks") options.playbooks = argv[++index];
    else if (arg === "--json") options.format = "json";
    else if (arg === "--include-policy") options.includePolicy = true;
    else if (arg === "--help") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.sessions.length === 0) {
    const codexHome = process.env.IMOTEN_ACTIVE_CODEX_HOME
      || process.env.CODEX_HOME
      || path.join(os.homedir(), ".codex");
    options.sessions.push(path.join(codexHome, "sessions"));
  }
  return options;
}

async function jsonlFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await jsonlFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(entryPath);
  }
  return files.sort();
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

function metrics(records) {
  const durations = records.map((record) => record.duration_ms);
  const firstTokens = records.map((record) => record.time_to_first_token_ms).filter(Number.isFinite);
  return {
    count: records.length,
    total_ms: durations.reduce((sum, value) => sum + value, 0),
    p50_ms: percentile(durations, 0.5),
    p90_ms: percentile(durations, 0.9),
    max_ms: Math.max(...durations),
    ttft_p50_ms: percentile(firstTokens, 0.5),
    ttft_p90_ms: percentile(firstTokens, 0.9),
  };
}

function extractUserText(message) {
  if (typeof message !== "string") return "";
  const start = message.indexOf(">>> TRANSCRIPT START");
  const transcript = start >= 0 ? message.slice(start + ">>> TRANSCRIPT START".length) : message;
  const users = [...transcript.matchAll(/\[\d+\]\s+user:\s*([\s\S]*?)(?=\n\[\d+\]\s+(?:user|assistant|tool|system):|$)/gu)];
  return users.length > 0 ? users.at(-1)[1] : transcript;
}

function itemText(item) {
  if (!Array.isArray(item?.content)) return "";
  return item.content.filter((part) => part?.type === "text").map((part) => part.text).filter(Boolean).join("\n");
}

function identifyPlaybookNames(texts, playbookNames) {
  const text = texts.filter(Boolean).join("\n");
  const names = new Set();
  const pathPattern = /(?:playbooks|poteto-mode\/playbooks)\/([a-z0-9-]+)\.md/giu;
  for (const match of text.matchAll(pathPattern)) {
    if (playbookNames.has(match[1].toLowerCase())) names.add(match[1].toLowerCase());
  }
  const namePattern = new RegExp(`(?:playbook|workflow|route|matched|selected)[^\\n]{0,80}\\b(${[...playbookNames].sort((a, b) => b.length - a.length).join("|")})\\b`, "giu");
  for (const match of text.matchAll(namePattern)) {
    if (playbookNames.has(match[1].toLowerCase())) names.add(match[1].toLowerCase());
  }
  return names;
}

function commandPlaybookNames(item, playbookNames) {
  if (item?.type !== "CommandExecution") return new Set();
  return identifyPlaybookNames([JSON.stringify(item.command)], playbookNames);
}

function createFileState(file, root) {
  return {
    source: path.basename(path.dirname(root)).replace(/^\./u, ""),
    file: path.basename(file),
    records: [],
    lastUserMessage: "",
    lastAgentMessage: "",
    turnPlaybooks: new Map(),
    policyRecordsExcluded: 0,
    turnAborted: 0,
    turnAbortedMs: 0,
  };
}

function recordItemCompleted(payload, state, playbookNames) {
  if (typeof payload.turn_id === "string") {
    const names = commandPlaybookNames(payload.item, playbookNames);
    if (names.size > 0) {
      const current = state.turnPlaybooks.get(payload.turn_id) ?? new Set();
      for (const name of names) current.add(name);
      state.turnPlaybooks.set(payload.turn_id, current);
    }
  }
  if (payload.item?.type === "UserMessage") {
    state.lastUserMessage = itemText(payload.item);
    state.lastAgentMessage = "";
  } else if (payload.item?.type === "AgentMessage") {
    state.lastAgentMessage = itemText(payload.item);
  }
}

function recordTaskComplete(record, payload, state, playbookNames, includePolicy) {
  if (!Number.isFinite(payload.duration_ms) || payload.duration_ms < 0) return;
  const policyReview = typeof payload.last_agent_message === "string"
    && /risk_level|user_authorization|outcome/iu.test(payload.last_agent_message);
  if (policyReview && !includePolicy) {
    state.policyRecordsExcluded += 1;
    return;
  }
  const userText = extractUserText(state.lastUserMessage);
  const finalText = typeof payload.last_agent_message === "string" ? payload.last_agent_message : state.lastAgentMessage;
  const explicitNames = identifyPlaybookNames([userText, finalText], playbookNames);
  const inferredNames = state.turnPlaybooks.get(payload.turn_id) ?? new Set();
  const names = explicitNames.size === 1 ? explicitNames : inferredNames;
  const evidence = explicitNames.size === 1 ? "explicit" : inferredNames.size === 1 ? "inferred" : names.size > 1 ? "ambiguous" : "none";
  state.records.push({
    source: state.source,
    file: state.file,
    timestamp: record.timestamp ?? null,
    turn_id: payload.turn_id ?? null,
    duration_ms: payload.duration_ms,
    time_to_first_token_ms: Number.isFinite(payload.time_to_first_token_ms) ? payload.time_to_first_token_ms : null,
    playbook: names.size === 1 ? [...names][0] : names.size > 1 ? `ambiguous:${[...names].sort().join(",")}` : "unclassified",
    evidence,
  });
}

function consumeRecord(record, state, playbookNames, includePolicy) {
  if (record?.type !== "event_msg") return;
  const payload = record.payload;
  if (payload?.type === "item_completed") {
    recordItemCompleted(payload, state, playbookNames);
    return;
  }
  if (payload?.type === "turn_aborted") {
    if (Number.isFinite(payload.duration_ms)) {
      state.turnAborted += 1;
      state.turnAbortedMs += payload.duration_ms;
    }
    return;
  }
  if (payload?.type === "task_complete") recordTaskComplete(record, payload, state, playbookNames, includePolicy);
}

async function analyzeFile(file, root, playbookNames, includePolicy) {
  const state = createFileState(file, root);
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (!line.includes('"event_msg"')) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      consumeRecord(record, state, playbookNames, includePolicy);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return {
    records: state.records,
    policyRecordsExcluded: state.policyRecordsExcluded,
    turnAborted: state.turnAborted,
    turnAbortedMs: state.turnAbortedMs,
  };
}

async function analyzeRoot(root, playbookNames, includePolicy) {
  const files = await jsonlFiles(root);
  const result = { root, files: files.length, records: [], policyRecordsExcluded: 0, turnAborted: 0, turnAbortedMs: 0 };
  for (const file of files) {
    const fileResult = await analyzeFile(file, root, playbookNames, includePolicy);
    result.records.push(...fileResult.records);
    result.policyRecordsExcluded += fileResult.policyRecordsExcluded;
    result.turnAborted += fileResult.turnAborted;
    result.turnAbortedMs += fileResult.turnAbortedMs;
  }
  return result;
}

function renderText(result) {
  const lines = [];
  lines.push(`sessions: ${result.sources.map((source) => `${source.name} (${source.files} files)`).join(", ")}`);
  lines.push(`task completions: ${result.completion_records} actual turns, ${result.labeled_records} joinable, ${result.unclassified_records} unclassified, ${result.ambiguous_records} ambiguous`);
  lines.push(`policy-review completions excluded: ${result.policy_records_excluded}; aborted turns: ${result.turn_aborted} (${result.turn_aborted_ms} ms)`);
  lines.push("");
  lines.push("playbook\tcount\tevidence\tp50_ms\tp90_ms\tmax_ms\tttft_p50_ms\tttft_p90_ms");
  for (const [playbook, values] of Object.entries(result.by_playbook)) {
    lines.push([playbook, values.count, values.evidence, values.p50_ms, values.p90_ms, values.max_ms, values.ttft_p50_ms ?? "", values.ttft_p90_ms ?? ""].join("\t"));
  }
  lines.push("");
  lines.push("slowest samples");
  for (const sample of result.slowest) lines.push(`${sample.duration_ms} ms\t${sample.playbook}\t${sample.evidence}\t${sample.source}\t${sample.timestamp ?? "unknown"}`);
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: analyze-playbook-duration.mjs [--sessions DIR] [--playbooks DIR] [--json] [--include-policy]");
    return;
  }
  const playbooks = (await readdir(options.playbooks, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.slice(0, -3).toLowerCase());
  const playbookNames = new Set(playbooks);
  const sources = [];
  for (const root of options.sessions) sources.push(await analyzeRoot(root, playbookNames, options.includePolicy));
  const records = sources.flatMap((source) => source.records);
  const groups = new Map();
  for (const record of records) {
    if (record.playbook === "unclassified" || record.playbook.startsWith("ambiguous:")) continue;
    if (!groups.has(record.playbook)) groups.set(record.playbook, []);
    groups.get(record.playbook).push(record);
  }
  const byPlaybook = Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([playbook, group]) => [playbook, { ...metrics(group), evidence: [...new Set(group.map((record) => record.evidence))].sort().join(",") }]));
  const result = {
    generated_at: new Date().toISOString(),
    sources: sources.map((source) => ({ name: path.basename(path.dirname(source.root)).replace(/^\./u, ""), files: source.files, records: source.records.length })),
    completion_records: records.length,
    policy_records_excluded: sources.reduce((sum, source) => sum + source.policyRecordsExcluded, 0),
    turn_aborted: sources.reduce((sum, source) => sum + source.turnAborted, 0),
    turn_aborted_ms: sources.reduce((sum, source) => sum + source.turnAbortedMs, 0),
    labeled_records: records.filter((record) => record.playbook !== "unclassified" && !record.playbook.startsWith("ambiguous:")).length,
    unclassified_records: records.filter((record) => record.playbook === "unclassified").length,
    ambiguous_records: records.filter((record) => record.playbook.startsWith("ambiguous:")).length,
    by_playbook: byPlaybook,
    slowest: [...records].sort((left, right) => right.duration_ms - left.duration_ms).slice(0, 10),
  };
  console.log(options.format === "json" ? JSON.stringify(result, null, 2) : renderText(result));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
