import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  installLocalOperator,
  uninstallLocalOperator,
} from "../skills/setup-pstack/scripts/manage-agents.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = path.join(root, "skills/setup-pstack/scripts/imoten-local-operator.mjs");
const model = "mlx-community--gemma-4-e2b-it-4bit";

async function findNode24() {
  if (process.versions.node.startsWith("24.")) return fs.realpath(process.execPath);
  const { stdout } = await execFileAsync("mise", ["where", "node@24"]);
  return fs.realpath(path.join(stdout.trim(), "bin", "node"));
}

function run(file, args, { input = "", env = {} } = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    delete childEnv.CODEX_HOME;
    delete childEnv.IMOTEN_ACTIVE_CODEX_HOME;
    Object.assign(childEnv, env);
    const child = spawn(file, args, {
      cwd: root,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

function requestBarrier(size) {
  let resolve;
  let timer;
  const promise = new Promise((done) => { resolve = done; });
  return async (count) => {
    if (!size) return;
    timer ??= setTimeout(resolve, 2_000);
    if (count === size) {
      clearTimeout(timer);
      resolve();
    }
    await promise;
  };
}

async function fixture(t, {
  servedModel = model,
  toolName = "submit_result",
  resultStatus = "completed",
  releaseAfter = 0,
} = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-local-operator-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const codexRoot = path.join(temporary, ".codex");
  await fs.mkdir(codexRoot, { recursive: true });
  let active = 0;
  let maxActive = 0;
  const waitForPeers = requestBarrier(releaseAfter);
  const requests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ object: "list", data: [{ id: model }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const body = await readBody(request);
      requests.push(body);
      await waitForPeers(active);
      active -= 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        model: servedModel,
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: toolName,
                arguments: JSON.stringify({
                  status: resultStatus,
                  summary: "The failing assertion expects 3 but received 2.",
                  evidence: ["AssertionError: expected 3, received 2"],
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 40, completion_tokens: 24, total_tokens: 64 },
        request_model: body.model,
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await fs.writeFile(path.join(codexRoot, "imoten-local-operator.json"), `${JSON.stringify({
    schema_version: 1,
    role: "Local operator",
    backend: "omlx",
    base_url: `http://127.0.0.1:${port}/v1`,
    model,
    max_concurrency: 4,
    request_timeout_ms: 5000,
    max_output_tokens: 512,
  })}\n`);
  const installedRunner = path.join(codexRoot, "bin", "imoten-local-operator");
  await fs.mkdir(path.dirname(installedRunner), { recursive: true });
  await fs.copyFile(runnerPath, installedRunner);
  return {
    codexRoot,
    installedRunner,
    node24: await findNode24(),
    maxActive: () => maxActive,
    requests: () => requests,
  };
}

function dispatchRequest(task = "Classify this test failure.") {
  return JSON.stringify({
    schema_version: 1,
    role: "Local operator",
    prompt: {
      context: [{ name: "test output", text: "AssertionError: expected 3, received 2" }],
      task,
    },
    max_output_tokens: 128,
  });
}

test("local operator installer writes one exact role config and rule", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-local-install-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const userHome = path.join(temporary, "home");
  const node24 = await findNode24();
  const installed = await installLocalOperator({ pluginRoot: root, userHome, nodePath: node24 });
  assert.equal(installed.launcherPath, path.join(userHome, ".codex/bin/imoten-local-operator"));
  const config = JSON.parse(await fs.readFile(installed.runnerConfigPath, "utf8"));
  assert.deepEqual(config, {
    schema_version: 1,
    role: "Local operator",
    backend: "omlx",
    base_url: "http://127.0.0.1:8123/v1",
    model,
    max_concurrency: 4,
    request_timeout_ms: 120000,
    max_output_tokens: 512,
  });
  const [shebang] = (await fs.readFile(installed.launcherPath, "utf8")).split("\n");
  assert.equal(shebang, `#!${node24}`);
  const existingRule = "prefix_rule(\n    pattern = [\"glab\"],\n    decision = \"allow\",\n)\n";
  await fs.writeFile(installed.rulesPath, `${existingRule}\n${await fs.readFile(installed.rulesPath, "utf8")}`);
  await installLocalOperator({ pluginRoot: root, userHome, nodePath: node24 });
  const rules = await fs.readFile(installed.rulesPath, "utf8");
  assert.equal((rules.match(/# imoten-local-operator:begin/gu) ?? []).length, 1);
  assert.match(rules, new RegExp(`pattern = \\[${JSON.stringify(installed.launcherPath).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\]`, "u"));
  await uninstallLocalOperator({ userHome });
  await assert.rejects(fs.stat(installed.launcherPath), { code: "ENOENT" });
  await assert.rejects(fs.stat(installed.runnerConfigPath), { code: "ENOENT" });
  assert.equal(await fs.readFile(installed.rulesPath, "utf8"), existingRule);
});

test("local operator installer rejects another Node major", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-local-node-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const node23 = path.join(temporary, "node23");
  await fs.writeFile(node23, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo v23.0.0\n  exit 0\nfi\nexit 1\n", { mode: 0o700 });
  await assert.rejects(installLocalOperator({
    pluginRoot: root,
    userHome: path.join(temporary, "home"),
    nodePath: node23,
  }), /requires Node\.js 24 LTS/u);
});

test("local operator probes and returns its fixed result contract", async (t) => {
  const { codexRoot, node24, requests } = await fixture(t);
  const env = { CODEX_HOME: codexRoot };
  const probed = await run(node24, [runnerPath, "probe"], { env });
  assert.equal(probed.code, 0, probed.stderr);
  assert.deepEqual(JSON.parse(probed.stdout), {
    status: "ready",
    role: "Local operator",
    backend: "omlx",
    model,
    max_concurrency: 4,
  });
  const dispatched = await run(node24, [runnerPath, "dispatch"], { env, input: dispatchRequest() });
  assert.equal(dispatched.code, 0, dispatched.stderr);
  const result = JSON.parse(dispatched.stdout);
  assert.equal(result.status, "completed");
  assert.equal(result.summary, "The failing assertion expects 3 but received 2.");
  assert.deepEqual(result.evidence, ["AssertionError: expected 3, received 2"]);
  assert.equal(result.model, model);
  assert.deepEqual(result.usage, { prompt_tokens: 40, completion_tokens: 24, total_tokens: 64 });
  assert.match(requests()[0].messages[0].content, /You may diagnose a bug from the supplied evidence/);
});

test("local operator accepts a request as a direct argument", async (t) => {
  const { node24, codexRoot } = await fixture(t);
  const result = await run(node24, [runnerPath, "dispatch", "--request-json", dispatchRequest("Direct request.")], {
    env: {
      CODEX_HOME: path.join(codexRoot, "wrong-profile"),
      IMOTEN_ACTIVE_CODEX_HOME: codexRoot,
    },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "completed");
});

test("installed local operator binds its own profile and reads a private request file", async (t) => {
  const { node24, codexRoot, installedRunner } = await fixture(t);
  const requestFile = path.join(codexRoot, "request.json");
  await fs.writeFile(requestFile, dispatchRequest("Quote ' and `shell` $(text)."), { mode: 0o600 });
  const result = await run(node24, [installedRunner, "dispatch", "--request-file", requestFile], {
    env: { HOME: path.join(codexRoot, "unrelated-home") },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "completed");
});

test("installed local operator rejects a conflicting active profile", async (t) => {
  const { node24, codexRoot, installedRunner } = await fixture(t);
  const result = await run(node24, [installedRunner, "probe"], {
    env: { IMOTEN_ACTIVE_CODEX_HOME: path.join(codexRoot, "wrong-profile") },
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /does not own runner/u);
});

test("local operator returns escalation for the parent to route", async (t) => {
  const { codexRoot, node24 } = await fixture(t, { resultStatus: "escalate" });
  const result = await run(node24, [runnerPath, "dispatch"], {
    env: { CODEX_HOME: codexRoot },
    input: dispatchRequest(),
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "escalate");
});

test("independent local operator processes do not serialize requests", async (t) => {
  const { codexRoot, node24, maxActive } = await fixture(t, { releaseAfter: 4 });
  const env = { CODEX_HOME: codexRoot };
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => (
    run(node24, [runnerPath, "dispatch"], { env, input: dispatchRequest(`Classify failure ${index + 1}.`) })
  )));
  assert.equal(results.every((result) => result.code === 0), true, results.map((result) => result.stderr).join("\n"));
  assert.equal(maxActive(), 4);
});

test("local operator rejects a served-model mismatch", async (t) => {
  const { codexRoot, node24 } = await fixture(t, { servedModel: "wrong-model" });
  const result = await run(node24, [runnerPath, "dispatch"], {
    env: { CODEX_HOME: codexRoot },
    input: dispatchRequest(),
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /served model "wrong-model" instead/u);
});

test("local operator rejects a non-loopback endpoint", async (t) => {
  const { codexRoot, node24 } = await fixture(t);
  const configPath = path.join(codexRoot, "imoten-local-operator.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  await fs.writeFile(configPath, `${JSON.stringify({ ...config, base_url: "http://192.0.2.10:8123/v1" })}\n`);
  const result = await run(node24, [runnerPath, "dispatch"], {
    env: { CODEX_HOME: codexRoot },
    input: dispatchRequest(),
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /base_url must use http:\/\/127\.0\.0\.1/u);
});
