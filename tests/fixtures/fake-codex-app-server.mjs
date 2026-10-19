#!/usr/bin/env node

import { createInterface } from "node:readline";
import { appendFile } from "node:fs/promises";

const input = createInterface({ input: process.stdin });
let turnNumber = 0;
let threadNumber = 0;
const totals = new Map();
let pendingSteer = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function completeTurn(threadId, turnId, text) {
  send({ method: "item/agentMessage/delta", params: { threadId, turnId, delta: text } });
  const last = {
    inputTokens: 1000 + turnNumber,
    cachedInputTokens: 900,
    cacheWriteInputTokens: 100,
    outputTokens: 12,
    reasoningOutputTokens: 4,
    totalTokens: 1012 + turnNumber,
  };
  const previous = totals.get(threadId) ?? {};
  const total = Object.fromEntries(Object.entries(last).map(([key, value]) => [key, (previous[key] ?? 0) + value]));
  totals.set(threadId, total);
  send({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { last, total } } });
  send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
}

input.on("line", async (line) => {
  const message = JSON.parse(line);
  if (process.env.FAKE_APP_SERVER_REQUESTS) {
    await appendFile(process.env.FAKE_APP_SERVER_REQUESTS, JSON.stringify(message) + "\n");
  }
  if (message.method === "initialize") {
    if (process.env.FAKE_APP_SERVER_ENV) {
      await appendFile(process.env.FAKE_APP_SERVER_ENV, JSON.stringify({ ripwire_meter_arm: process.env.RIPWIRE_METER_ARM ?? null }) + "\n");
    }
    send({ id: message.id, result: { platformFamily: "test", platformOs: "test" } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "thread/start") {
    threadNumber += 1;
    send({ id: message.id, result: {
      thread: { id: `fake-thread-${threadNumber}` },
      ...JSON.parse(process.env.FAKE_APP_SERVER_SETTINGS ?? "{}"),
    } });
    return;
  }
  if (message.method === "turn/start") {
    turnNumber += 1;
    const turnId = `fake-turn-${turnNumber}`;
    const threadId = message.params.threadId;
    if (process.env.FAKE_APP_SERVER_INPUTS) {
      await appendFile(process.env.FAKE_APP_SERVER_INPUTS, JSON.stringify(message.params.input) + "\n");
    }
    send({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
    if (message.params.input?.some((item) => item.text.includes("emit-compaction"))) {
      send({ method: "item/completed", params: { threadId, turnId, item: { type: "contextCompaction", id: "fake-compaction-1" } } });
    }
    send({ id: message.id, result: { turn: { id: turnId } } });
    if (message.params.input.some((item) => item.text.includes("BASE_DONE"))) {
      pendingSteer = { threadId, turnId };
    } else {
      completeTurn(threadId, turnId, "verified");
    }
    return;
  }
  if (message.method === "turn/steer" && pendingSteer) {
    send({ id: message.id, result: {} });
    completeTurn(pendingSteer.threadId, pendingSteer.turnId, "LIVE_STEER_ACK");
    pendingSteer = null;
  }
  if (message.method === "thread/compact/start") {
    send({ id: message.id, result: {} });
    send({ method: "item/completed", params: {
      threadId: message.params.threadId,
      item: { type: "contextCompaction", id: "forced-compaction" },
    } });
  }
});
