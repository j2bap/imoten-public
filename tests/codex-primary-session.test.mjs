import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CodexAppServerClient } from "../skills/setup-pstack/scripts/codex-app-server-client.mjs";
import { CodexPrimarySession } from "../skills/setup-pstack/scripts/codex-primary-session.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fakeServer = path.join(root, "tests/fixtures/fake-codex-app-server.mjs");

test("runs a prompt-stable primary session through one app-server thread", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pstack-primary-session-"));
  const ledgerRoot = path.join(temporary, "ledger");
  const inputsPath = path.join(temporary, "inputs.jsonl");
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fakeServer],
    cwd: temporary,
    env: { ...process.env, FAKE_APP_SERVER_INPUTS: inputsPath },
  });
  const session = new CodexPrimarySession({
    rootDir: ledgerRoot,
    branchId: "primary",
    modelFamily: "gpt-5-6",
    model: "gpt-5.6-luna",
    commonPrefix: [
      { name: "system", text: "stable system" },
      { name: "project", text: "stable project rules" },
    ],
    client,
  });
  t.after(async () => {
    await session.close();
    await rm(temporary, { recursive: true, force: true });
  });

  const first = await session.run({ task: "first task", skillReference: "skill@v1" });
  const second = await session.run({ task: "second task", skillReference: "skill@v1" });

  assert.equal(first.status, "completed");
  assert.equal(first.prompt_mode, "full");
  assert.equal(first.assistant_text, "verified");
  assert.equal(first.observer_trace_truncated, false);
  assert.ok(first.observer_trace.some((entry) => entry.method === "turn/completed"));
  assert.equal(second.status, "completed");
  assert.equal(second.prompt_mode, "suffix");
  assert.equal(second.threadId, first.threadId);
  assert.equal(second.assistant_text, "verified");
  assert.ok(Number.isSafeInteger(first.timing.session_run_ms));
  assert.ok(Number.isSafeInteger(first.timing.provider_turn_ms));
  assert.ok(Number.isSafeInteger(first.timing.provider_after_first_token_ms));
  assert.ok(Number.isSafeInteger(second.timing.session_run_ms));
  assert.deepEqual(session.capabilities, {
    observe: true,
    cancel: true,
    send_next_turn: true,
    steer_live: true,
    fork: false,
    inject_visible_items: false,
  });

  const inputs = (await readFile(inputsPath, "utf8")).trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(inputs.length, 2);
  const firstPrompt = JSON.parse(inputs[0][0].text);
  const secondPrompt = JSON.parse(inputs[1][0].text);
  assert.deepEqual(firstPrompt.context.slice(0, 2), [
    { name: "system", text: "stable system" },
    { name: "project", text: "stable project rules" },
  ]);
  assert.equal(firstPrompt.context[2].name, "skill-reference");
  assert.equal(secondPrompt.context.some((entry) => entry.name === "system"), false);
  assert.equal(secondPrompt.context.some((entry) => entry.name === "project"), false);
  assert.equal(secondPrompt.context[0].name, "skill-reference");
  assert.equal(secondPrompt.task, "second task");

  const ledger = await session.manager.readLedger({ includeValues: true });
  assert.deepEqual(
    ledger.filter((event) => event.kind === "message").map((event) => event.value.role),
    ["user", "assistant", "user", "assistant"],
  );
  assert.equal(ledger.filter((event) => event.kind === "runner_observation").length, 2);
});

test("records a provider compaction item without encrypted content", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pstack-primary-session-compaction-"));
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fakeServer],
    cwd: temporary,
  });
  const session = new CodexPrimarySession({
    rootDir: path.join(temporary, "ledger"),
    branchId: "primary",
    modelFamily: "gpt-5-6",
    model: "gpt-5.6-luna",
    commonPrefix: [{ name: "system", text: "stable system" }],
    client,
  });
  t.after(async () => {
    await session.close();
    await rm(temporary, { recursive: true, force: true });
  });

  const result = await session.run({ task: "emit-compaction" });
  assert.equal(result.status, "completed");
  assert.equal(result.compaction_items_seen, 1);
  const ledger = await session.manager.readLedger({ includeValues: true });
  const compactions = ledger.filter((event) => event.kind === "compaction");
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0].value.state, "sealed");
  assert.equal(compactions[0].value.descriptor.item_type, "compaction");
});
