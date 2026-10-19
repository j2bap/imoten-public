import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

import { inferModelFamily, nativeRunnerArgs } from "../skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dispatcher = path.join(root, "skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs");
const fakeServer = path.join(root, "tests/fixtures/fake-codex-app-server.mjs");

function waitForMessage(messages, predicate, timeoutMs = 8000) {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for dispatcher message")), timeoutMs);
    messages.waiters ??= [];
    messages.waiters.push({ predicate, resolve: (message) => { clearTimeout(timer); resolve(message); } });
  });
}

function recordMessage(messages, message) {
  messages.push(message);
  messages.waiters = (messages.waiters ?? []).filter((waiter) => {
    if (!waiter.predicate(message)) return true;
    waiter.resolve(message);
    return false;
  });
}

function readLines(child) {
  const messages = [];
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => recordMessage(messages, JSON.parse(line)));
  return { messages, output };
}

test("dispatcher builds native primary runner arguments", () => {
  assert.equal(inferModelFamily("gpt-5.6-luna"), "gpt-5-6");
  const args = nativeRunnerArgs({
    rootDir: "/tmp/ledger",
    branchId: "primary",
    modelFamily: "gpt-5-6",
    cwd: "/tmp/repo",
    commonPrefixFile: "/tmp/prefix.json",
    potetoPromptFile: "/tmp/poteto.md",
    sandbox: "read-only",
    approvalPolicy: "never",
    turnTimeoutMs: 300_000,
    command: "codex",
    commandArgs: ["app-server", "--listen", "stdio://"],
  }, "gpt-5.6-luna");
  assert.ok(args.includes("--poteto-prompt-file"));
  assert.ok(args.includes("/tmp/poteto.md"));
  assert.ok(args.includes("--common-prefix-file"));
});

for (const effort of ["low", null]) {
test(`dispatcher preserves native parameters (effort ${effort ?? "inherited"})`, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "imoten-dispatch-native-"));
  const personal = path.join(temporary, ".codex-personal");
  const ledger = path.join(temporary, "ledger");
  const prefix = path.join(temporary, "prefix.json");
  const inputs = path.join(temporary, "inputs.jsonl");
  const requests = path.join(temporary, "requests.jsonl");
  await mkdir(personal, { recursive: true });
  await writeFile(path.join(personal, "config.toml"), 'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "max"\n');
  await writeFile(path.join(personal, "imoten-models.md"), "# native roles\n");
  await writeFile(prefix, JSON.stringify([{ name: "system", text: "stable" }]));
  const child = spawn(process.execPath, [
    dispatcher,
    "--profile", "personal",
    "--model", "gpt-6-astra",
    "--approval-policy", "on-request",
    ...(effort === null ? [] : ["--reasoning-effort", effort]),
    "--root-dir", ledger,
    "--cwd", temporary,
    "--common-prefix-file", prefix,
    "--command", process.execPath,
    "--command-arg", fakeServer,
    "--command-arg", "--listen",
  ], {
    cwd: root,
    env: {
      ...process.env,
      HOME: temporary,
      IMOTEN_PERSONAL_CODEX_HOME: personal,
      FAKE_APP_SERVER_INPUTS: inputs,
      FAKE_APP_SERVER_REQUESTS: requests,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const { messages, output } = readLines(child);
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    const ready = await waitForMessage(messages, (message) => message.type === "dispatch_ready");
    assert.equal(ready.transport, "native-primary");
    child.stdin.write(`${JSON.stringify({ id: "one", op: "run", task: "read-only probe" })}\n`);
    const result = await waitForMessage(messages, (message) => message.type === "result" && message.id === "one");
    assert.equal(result.status, "completed");
    child.stdin.write(`${JSON.stringify({ id: "two", op: "run", task: "second probe" })}\n`);
    await waitForMessage(messages, (message) => message.type === "result" && message.id === "two");
    child.stdin.write(`${JSON.stringify({ id: "done", op: "close" })}\n`);
    await waitForMessage(messages, (message) => message.type === "closed" && message.id === "done");
    const code = await new Promise((resolve) => child.once("close", resolve));
    assert.equal(code, 0, stderr.join(""));
    const firstPrompt = JSON.parse((await readFile(inputs, "utf8")).trim().split(/\r?\n/u)[0])[0].text;
    assert.equal(JSON.parse(firstPrompt).context[0].name, "system");
    const calls = (await readFile(requests, "utf8")).trim().split(/\r?\n/u).map(JSON.parse);
    const thread = calls.find((call) => call.method === "thread/start").params;
    assert.equal(thread.model, "gpt-6-astra");
    assert.equal(thread.cwd, temporary);
    assert.equal(thread.sandbox, "read-only");
    assert.equal(thread.approvalPolicy, "on-request");
    assert.equal(thread.ephemeral, true);
    assert.equal(thread.config?.model_reasoning_effort, effort ?? undefined);
    const turns = calls.filter((call) => call.method === "turn/start");
    assert.equal(turns.length, 2);
    for (const { params } of turns) {
      assert.equal(params.model, "gpt-6-astra");
      assert.equal(params.cwd, temporary);
      assert.equal(params.approvalPolicy, undefined, "inherit the thread approval policy");
      assert.equal(params.sandboxPolicy, undefined, "inherit the thread sandbox policy");
    }

  } finally {
    output.close();
    child.kill();
    await rm(temporary, { recursive: true, force: true });
  }
});

}
