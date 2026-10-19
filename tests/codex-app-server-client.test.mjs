import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CodexAppServerClient, classifyTurnFailure } from "../skills/setup-pstack/scripts/codex-app-server-client.mjs";

test("inherits thread settings and preserves explicit turn overrides", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pstack-native-params-"));
  const requests = path.join(directory, "requests.jsonl");
  const settings = {
    model: "gpt-6-astra", reasoningEffort: "medium", cwd: directory,
    approvalPolicy: "on-request", sandbox: { type: "workspaceWrite", writableRoots: [directory], networkAccess: false },
  };
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url).pathname],
    env: { ...process.env, FAKE_APP_SERVER_REQUESTS: requests, FAKE_APP_SERVER_SETTINGS: JSON.stringify(settings) },
  });
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  const thread = await client.startThread({ cwd: directory, sandbox: "workspace-write", approvalPolicy: "on-request" });
  assert.deepEqual(thread.settings, {
    model: settings.model, reasoning_effort: settings.reasoningEffort, cwd: directory,
    approval_policy: settings.approvalPolicy, sandbox: settings.sandbox,
  });
  await client.runTurn({ input: [{ type: "text", text: "inherit" }] });
  const overrides = { model: "gpt-6-sol", cwd: directory, approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false } };
  await client.runTurn({ input: [{ type: "text", text: "override" }], ...overrides });
  const turns = (await readFile(requests, "utf8")).trim().split(/\r?\n/u).map(JSON.parse).filter((call) => call.method === "turn/start");
  assert.equal(turns.length, 2);
  for (const [key, value] of Object.entries(overrides)) {
    assert.equal(turns[0].params[key], undefined);
    assert.deepEqual(turns[1].params[key], value);
  }
});

const fakeServer = `
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
let turn = 0;
let thread = 0;
const totals = new Map();
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { platformFamily: "test", platformOs: "test" } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "thread/start") {
    thread += 1;
    send({ id: message.id, result: { thread: { id: "thread-test-" + thread } } });
    return;
  }
  if (message.method === "turn/start") {
    turn += 1;
    const turnId = "turn-" + turn;
    const threadId = message.params.threadId;
    send({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
    send({ method: "hook/started", params: { threadId, turnId, run: { eventName: "userPromptSubmit", handlerType: "command", executionMode: "sync", scope: "turn", source: "plugin" } } });
    send({ method: "hook/completed", params: { threadId, turnId, run: { eventName: "userPromptSubmit", handlerType: "command", executionMode: "sync", scope: "turn", source: "plugin", durationMs: 4 } } });
    const completedOnly = message.params.input?.some((item) => item.text === "completed-only");
    const compactionOnly = message.params.input?.some((item) => item.text === "compaction-only");
    if (completedOnly) send({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", text: "completed-only reply" } } });
    else if (compactionOnly) send({ method: "item/completed", params: { threadId, turnId, item: { type: "contextCompaction", id: "compaction-1" } } });
    else send({ method: "item/agentMessage/delta", params: { threadId, turnId, delta: "ok" } });
    const last = { inputTokens: 100 + turn, cachedInputTokens: 80, cacheWriteInputTokens: 20, outputTokens: 7, reasoningOutputTokens: 3, totalTokens: 110 + turn };
    const multi = message.params.input?.some((item) => item.text === "multi-usage");
    let usageEvent;
    for (let call = 0; call < (multi ? 2 : 1); call += 1) {
      const previous = totals.get(threadId) ?? {};
      const total = Object.fromEntries(Object.entries(last).map(([key, value]) => [key, (previous[key] ?? 0) + value]));
      totals.set(threadId, total);
      const tokenUsage = { last, total };
      if (message.params.input?.some((item) => item.text === "missing-total")) delete tokenUsage.total;
      usageEvent = { method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage } };
      send(usageEvent);
    }
    if (multi) send(usageEvent); // Repeated snapshots must not count twice.

    send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
    send({ id: message.id, result: { turn: { id: turnId } } });
    return;
  }
  if (message.method === "turn/steer" || message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
  }
});
`;

async function withClient(callback) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "pstack-app-server-client-"));
  const serverPath = path.join(rootDir, "fake-server.mjs");
  await writeFile(serverPath, fakeServer, { mode: 0o700 });
  const client = new CodexAppServerClient({ command: process.execPath, args: [serverPath], cwd: rootDir });
  try {
    await callback(client);
  } finally {
    await client.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("speaks the app-server handshake and captures streamed usage", async () => {
  await withClient(async (client) => {
    await client.connect();
    const thread = await client.startThread({ model: "gpt-5.6-luna" });
    assert.equal(thread.threadId, "thread-test-1");
    const result = await client.runTurn({ input: [{ type: "text", text: "hello" }] });
    assert.equal(result.threadId, "thread-test-1");
    assert.equal(result.turnId, "turn-1");
    assert.equal(result.status, "completed");
    assert.equal(result.event_count, 6);
    assert.equal(result.first_event_ms !== null, true);
    assert.equal(result.first_token_ms !== null, true);
    assert.deepEqual(result.observer_trace.map((entry) => entry.method), [
      "turn/started",
      "hook/started",
      "hook/completed",
      "item/agentMessage/delta",
      "thread/tokenUsage/updated",
      "turn/completed",
    ]);
    assert.deepEqual(result.observer_trace[1], {
      index: 2,
      elapsed_ms: result.observer_trace[1].elapsed_ms,
      method: "hook/started",
      item_type: null,
      hook_event: "userPromptSubmit",
      hook_handler: "command",
      hook_mode: "sync",
      hook_scope: "turn",
      hook_source: "plugin",
      hook_duration_ms: null,
    });
    assert.equal(result.observer_trace[2].hook_duration_ms, 4);
    assert.equal(result.observer_trace_truncated, false);
    assert.ok(result.observer_trace.every((entry) => Number.isSafeInteger(entry.elapsed_ms) && entry.elapsed_ms >= 0));
    assert.deepEqual(result.usage, {
      input_tokens: 101,
      cached_input_tokens: 80,
      cache_write_input_tokens: 20,
      output_tokens: 7,
      reasoning_output_tokens: 3,
      total_tokens: 111,
    });
    const secondThread = await client.startThread({ model: "gpt-5.6-luna" });
    const secondResult = await client.runTurn({ threadId: secondThread.threadId, input: [{ type: "text", text: "isolated" }] });
    assert.equal(secondThread.threadId, "thread-test-2");
    assert.equal(secondResult.threadId, "thread-test-2");
  });
});

test("uses the expected-turn precondition for steering", async () => {
  await withClient(async (client) => {
    await client.startThread({ model: "gpt-5.6-luna" });
    const result = await client.runTurn({ input: [{ type: "text", text: "hello" }] });
    await assert.doesNotReject(client.steer({ expectedTurnId: result.turnId, input: [{ type: "text", text: "follow up" }] }));
  });
});

test("captures a completed camel-case agent message", async () => {
  await withClient(async (client) => {
    await client.connect();
    await client.startThread({ model: "gpt-5.6-luna" });
    const result = await client.runTurn({ input: [{ type: "text", text: "completed-only" }] });
    assert.equal(result.status, "completed");
    assert.equal(result.assistant_text, "completed-only reply");
  });
});

test("captures a completed compaction item without encrypted content", async () => {
  await withClient(async (client) => {
    const captured = [];
    client.onOpaqueItem = (item) => captured.push(item);
    await client.startThread({ model: "gpt-5.6-luna" });
    const result = await client.runTurn({ input: [{ type: "text", text: "compaction-only" }] });
    assert.equal(result.status, "completed");
    assert.deepEqual(captured, [{ type: "contextCompaction", id: "compaction-1" }]);
    assert.equal(result.compaction_items_seen, 1);
  });
});

test("classifies bounded provider turn failures without retaining raw error text", () => {
  assert.equal(classifyTurnFailure({ turn: { status: "failed", error: { codexErrorInfo: { UsageLimitExceeded: {} } } } }), "usage_limit_exceeded");
  assert.equal(classifyTurnFailure({ turn: { status: "failed", error: { message: "private raw detail" } } }), "provider_turn_failed");
});


test("accounts for all calls per turn without double-counting snapshots or prior turns", async () => {
  await withClient(async (client) => {
    const first = await client.startThread({ model: "gpt-6-astra" });
    const run = (threadId, text) => client.runTurn({ threadId, input: [{ type: "text", text }] });
    const multi = await run(first.threadId, "multi-usage");
    assert.equal(multi.usage.input_tokens, 202);
    assert.equal(multi.usage.cached_input_tokens, 160);
    assert.equal(multi.usage.output_tokens, 14);
    assert.equal(multi.usage.total_tokens, 222);
    assert.equal(multi.last_usage.input_tokens, 101);
    assert.equal(multi.thread_usage.input_tokens, 202);
    const next = await run(first.threadId, "next");
    assert.equal(next.usage.input_tokens, 102);
    assert.equal(next.thread_usage.input_tokens, 304);
    const other = await client.startThread({ model: "gpt-6-astra" });
    const separate = await run(other.threadId, "multi-usage");
    assert.equal(separate.usage.input_tokens, 206);
    assert.equal(separate.thread_usage.input_tokens, 206);
    const missing = await run(first.threadId, "missing-total");
    assert.equal(missing.usage, null);
    assert.equal(missing.thread_usage, null);
    assert.equal(missing.last_usage.input_tokens, 104);
    const unknownBaseline = await run(first.threadId, "next");
    assert.equal(unknownBaseline.usage, null);
    assert.equal(unknownBaseline.thread_usage.input_tokens, 513);
    const restored = await run(first.threadId, "next");
    assert.equal(restored.usage.input_tokens, 106);
  });
});
