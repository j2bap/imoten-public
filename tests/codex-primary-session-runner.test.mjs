import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const runner = path.join(root, "skills/setup-pstack/scripts/codex-primary-session-runner.mjs");
const fakeServer = path.join(root, "tests/fixtures/fake-codex-app-server.mjs");

function waitForMessage(messages, predicate, timeoutMs = 5000) {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for runner message")), timeoutMs);
    messages.waiters ??= [];
    messages.waiters.push({ predicate, resolve: (message) => { clearTimeout(timer); resolve(message); } });
  });
}

function recordMessage(messages, message) {
  messages.push(message);
  const waiters = messages.waiters ?? [];
  messages.waiters = waiters.filter((waiter) => {
    if (!waiter.predicate(message)) return true;
    waiter.resolve(message);
    return false;
  });
}

test("runner keeps one native primary thread across task packets", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pstack-primary-runner-"));
  const ledgerRoot = path.join(temporary, "ledger");
  const prefixFile = path.join(temporary, "prefix.json");
  const inputsFile = path.join(temporary, "inputs.jsonl");
  const environmentFile = path.join(temporary, "environment.jsonl");
  const requestsFile = path.join(temporary, "requests.jsonl");
  await writeFile(prefixFile, JSON.stringify([
    { name: "system", text: "stable system" },
    { name: "project", text: "stable project rules" },
  ]));
  const child = spawn(process.execPath, [
    runner,
    "--root-dir", ledgerRoot,
    "--model-family", "gpt-5-6",
    "--model", "gpt-5.6-luna",
    "--sandbox", "workspace-write",
    "--approval-policy", "on-request",
    "--cwd", temporary,
    "--common-prefix-file", prefixFile,
    "--command", process.execPath,
    "--command-arg", fakeServer,
  ], {
    cwd: root,
    env: { ...process.env, FAKE_APP_SERVER_INPUTS: inputsFile, FAKE_APP_SERVER_ENV: environmentFile, FAKE_APP_SERVER_REQUESTS: requestsFile },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages = [];
  const stderr = [];
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => recordMessage(messages, JSON.parse(line)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    const ready = await waitForMessage(messages, (message) => message.type === "ready");
    assert.equal(ready.model, "gpt-5.6-luna");
    assert.equal(ready.ripwire_session_primer, "disabled");
    assert.equal(ready.capabilities.send_next_turn, true);
    assert.ok(Number.isSafeInteger(ready.timing.bootstrap_ms));
    assert.ok(Number.isSafeInteger(ready.timing.session_init_ms));
    assert.ok(Number.isSafeInteger(ready.timing.initialization.total_ms));

    child.stdin.write(`${JSON.stringify({ id: "first", op: "run", task: "first task", skill_reference: "skill@v1" })}\n`);
    const first = await waitForMessage(messages, (message) => message.type === "result" && message.id === "first");
    assert.equal(first.prompt_mode, "full");
    assert.equal(first.status, "completed");
    assert.equal(first.usage.input_tokens, 1001);
    assert.equal(first.thread_usage.input_tokens, 1001);
    assert.equal(first.last_usage.input_tokens, 1001);
    assert.equal(first.observer_trace_truncated, false);
    assert.ok(first.observer_trace.some((entry) => entry.method === "turn/completed"));
    assert.ok(Number.isSafeInteger(first.timing.append_visible_ms));
    assert.ok(Number.isSafeInteger(first.timing.prepare_ms));
    assert.ok(Number.isSafeInteger(first.timing.provider_turn_ms));
    assert.ok(Number.isSafeInteger(first.timing.provider_after_first_token_ms));
    assert.ok(Number.isSafeInteger(first.timing.accept_ms));
    assert.ok(Number.isSafeInteger(first.timing.finalize_ms));
    assert.ok(Number.isSafeInteger(first.timing.session_run_ms));
    assert.ok(Number.isSafeInteger(first.runner_timing.command_to_result_ms));
    assert.equal(first.runner_timing.session_run_ms, first.timing.session_run_ms);

    child.stdin.write(`${JSON.stringify({ id: "second", op: "run", task: "second task", skill_reference: "skill@v1" })}\n`);
    const second = await waitForMessage(messages, (message) => message.type === "result" && message.id === "second");
    assert.equal(second.prompt_mode, "suffix");
    assert.equal(second.thread_id, first.thread_id);
    assert.equal(second.usage.input_tokens, 1002);
    assert.equal(second.thread_usage.input_tokens, 2003);
    assert.equal(second.last_usage.input_tokens, 1002);
    assert.ok(Number.isSafeInteger(second.timing.session_run_ms));

    child.stdin.write(`${JSON.stringify({ id: "done", op: "close" })}\n`);
    await waitForMessage(messages, (message) => message.type === "closed" && message.id === "done");
    const exitCode = await new Promise((resolve) => child.once("close", resolve));
    assert.equal(exitCode, 0, stderr.join(""));

    const inputs = (await readFile(inputsFile, "utf8")).trim().split(/\r?\n/u).map(JSON.parse);
    const environment = (await readFile(environmentFile, "utf8")).trim().split(/\r?\n/u).map(JSON.parse);
    assert.deepEqual(environment, [{ ripwire_meter_arm: "control" }]);
    assert.equal(inputs.length, 2);
    const requests = (await readFile(requestsFile, "utf8")).trim().split(/\r?\n/u).map(JSON.parse);
    const thread = requests.find((request) => request.method === "thread/start").params;
    assert.equal(thread.sandbox, "workspace-write");
    assert.equal(thread.approvalPolicy, "on-request");
    for (const { params } of requests.filter((request) => request.method === "turn/start")) {
      assert.equal(params.sandboxPolicy, undefined, "turns must inherit workspace-write");
      assert.equal(params.approvalPolicy, undefined, "turns must inherit on-request");
    }

    const firstPrompt = JSON.parse(inputs[0][0].text);
    const secondPrompt = JSON.parse(inputs[1][0].text);
    assert.deepEqual(firstPrompt.context.slice(0, 2), [
      { name: "system", text: "stable system" },
      { name: "project", text: "stable project rules" },
    ]);
    assert.equal(secondPrompt.context.some((entry) => entry.name === "system"), false);
    assert.equal(secondPrompt.context[0].name, "skill-reference");
  } finally {
    output.close();
    child.kill();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("runner permits an explicit session-primer opt-in", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pstack-primary-runner-primer-"));
  const ledgerRoot = path.join(temporary, "ledger");
  const prefixFile = path.join(temporary, "prefix.json");
  const environmentFile = path.join(temporary, "environment.jsonl");
  await writeFile(prefixFile, JSON.stringify([{ name: "system", text: "stable system" }]));
  const environment = { ...process.env, FAKE_APP_SERVER_ENV: environmentFile };
  delete environment.RIPWIRE_METER_ARM;
  const child = spawn(process.execPath, [
    runner,
    "--root-dir", ledgerRoot,
    "--model-family", "gpt-5-6",
    "--model", "gpt-5.6-luna",
    "--cwd", temporary,
    "--common-prefix-file", prefixFile,
    "--ripwire-session-primer",
    "--command", process.execPath,
    "--command-arg", fakeServer,
  ], {
    cwd: root,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages = [];
  const stderr = [];
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => recordMessage(messages, JSON.parse(line)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    const ready = await waitForMessage(messages, (message) => message.type === "ready");
    assert.equal(ready.ripwire_session_primer, "enabled");
    child.stdin.write(`${JSON.stringify({ id: "done", op: "close" })}\n`);
    await waitForMessage(messages, (message) => message.type === "closed" && message.id === "done");
    const exitCode = await new Promise((resolve) => child.once("close", resolve));
    assert.equal(exitCode, 0, stderr.join(""));
    const recorded = (await readFile(environmentFile, "utf8")).trim().split(/\r?\n/u).map(JSON.parse);
    assert.deepEqual(recorded, [{ ripwire_meter_arm: null }]);
  } finally {
    output.close();
    child.kill();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("runner appends the portable Poteto prompt when requested", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pstack-primary-runner-poteto-"));
  const ledgerRoot = path.join(temporary, "ledger");
  const prefixFile = path.join(temporary, "prefix.json");
  const promptFile = path.join(temporary, "poteto-prompt.md");
  const inputsFile = path.join(temporary, "inputs.jsonl");
  await writeFile(prefixFile, JSON.stringify([{ name: "system", text: "stable system" }]));
  await writeFile(promptFile, "Poteto delegate boundary. Return the artifact and verification.");
  const child = spawn(process.execPath, [
    runner,
    "--root-dir", ledgerRoot,
    "--model-family", "gpt-5-6",
    "--model", "gpt-5.6-luna",
    "--cwd", temporary,
    "--common-prefix-file", prefixFile,
    "--poteto-prompt-file", promptFile,
    "--command", process.execPath,
    "--command-arg", fakeServer,
  ], {
    cwd: root,
    env: { ...process.env, FAKE_APP_SERVER_INPUTS: inputsFile },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages = [];
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => recordMessage(messages, JSON.parse(line)));
  try {
    const ready = await waitForMessage(messages, (message) => message.type === "ready");
    assert.equal(ready.poteto_prompt, "loaded");
    child.stdin.write(`${JSON.stringify({ id: "run", op: "run", task: "bounded task" })}\n`);
    await waitForMessage(messages, (message) => message.type === "result" && message.id === "run");
    child.stdin.write(`${JSON.stringify({ id: "done", op: "close" })}\n`);
    await waitForMessage(messages, (message) => message.type === "closed" && message.id === "done");
    const exitCode = await new Promise((resolve) => child.once("close", resolve));
    assert.equal(exitCode, 0);
    const firstPrompt = JSON.parse((await readFile(inputsFile, "utf8")).trim().split(/\r?\n/u)[0])[0].text;
    const request = JSON.parse(firstPrompt);
    assert.deepEqual(request.context.slice(0, 2), [
      { name: "system", text: "stable system" },
      { name: "poteto-agent-prompt", text: "Poteto delegate boundary. Return the artifact and verification." },
    ]);
  } finally {
    output.close();
    child.kill();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("runner rejects the removed negative session-primer alias", async () => {
  const child = spawn(process.execPath, [runner, "--no-ripwire-session-primer"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exitCode = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(exitCode, 1);
  assert.match(stderr, /unknown argument --no-ripwire-session-primer/u);
});
