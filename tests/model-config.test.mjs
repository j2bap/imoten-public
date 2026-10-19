import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  buildDirectProviderCatalog,
  parseCodexProviderConfig,
  parseRecommendedLocalRoles,
  parseRecommendedRoles,
  refreshModelCatalog,
  removeModelCatalogSetting,
  resolveCodexHome,
  resolveModelPolicy,
  updateLocalRoleRule,
} from "../skills/setup-pstack/scripts/manage-agents.mjs";
import { observableModelCatalog } from "./fixtures/observable-model-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const deepseekConfig = `model = "deepseek-flash"\nmodel_provider = "deepseek"\nmodel_reasoning_effort = "high"\n[model_providers.deepseek]\nbase_url = "https://api.deepseek.com"\nenv_key = "DEEPSEEK_API_KEY"\nwire_api = "responses"\n`;

test("Codex state follows the active CODEX_HOME without hijacking explicit fixture homes", () => {
  const activeHome = path.join(os.homedir(), "active-codex");
  assert.equal(resolveCodexHome({ userHome: os.homedir(), env: { CODEX_HOME: activeHome } }), activeHome);
  assert.equal(resolveCodexHome({ userHome: "/tmp/isolated-home", env: { CODEX_HOME: activeHome } }), "/tmp/isolated-home/.codex");
  assert.equal(resolveCodexHome({ userHome: os.homedir(), codexHome: "/tmp/explicit-codex", env: { CODEX_HOME: activeHome } }), "/tmp/explicit-codex");
  assert.equal(resolveCodexHome({ userHome: os.homedir(), env: { CODEX_HOME: "/tmp/wrong-codex", IMOTEN_ACTIVE_CODEX_HOME: activeHome } }), activeHome);
});

test("the recommended role table is machine-readable", async () => {
  const content = await fs.readFile(path.join(root, "skills/setup-pstack/references/model-roles.md"), "utf8");
  const roles = parseRecommendedRoles(content);
  assert.deepEqual(roles.get("Feature delegate"), { model: "gpt-6-sol", reasoning_effort: "max" });
  assert.deepEqual(roles.get("Poteto agent"), { model: "gpt-6-sol", reasoning_effort: "max" });
  assert.deepEqual(roles.get("Comment auditor"), { model: "gpt-6-astra", reasoning_effort: "max" });
  assert.deepEqual(roles.get("Performance delegate"), { model: "gpt-6-astra", reasoning_effort: "low" });
  assert.deepEqual(roles.get("Hillclimb delegate"), { model: "gpt-6-astra", reasoning_effort: "low" });
  assert.deepEqual(roles.get("Hardest tasks"), { model: "gpt-6-astra", reasoning_effort: "max" });
  assert.deepEqual(roles.get("Why synthesizer"), { model: "gpt-6-astra", reasoning_effort: "low" });
  assert.deepEqual(roles.get("Reflect synthesizer"), { model: "gpt-6-astra", reasoning_effort: "low" });
  assert.deepEqual(roles.get("Swarm worker"), { model: "gpt-6-luna", reasoning_effort: "high" });
  assert.deepEqual(parseRecommendedLocalRoles(content).get("Local operator"), {
    backend: "omlx",
    model: "mlx-community--gemma-4-e2b-it-4bit",
    endpoint: "http://127.0.0.1:8123/v1",
    max_concurrency: 4,
  });
  assert.equal([...roles.values()].some(({ model }) => model === "gpt-5.5"), false);
});

test("local setup updates one local section without changing remote roles", async () => {
  const modelRoles = await fs.readFile(path.join(root, "skills/setup-pstack/references/model-roles.md"), "utf8");
  const remote = "# Imoten model roles\n\n## Role map\n\n| Role | Model | Reasoning effort |\n| --- | --- | --- |\n| Fast profile | `gpt-5.6-luna` | `medium` |\n";
  const first = updateLocalRoleRule(remote, modelRoles);
  const second = updateLocalRoleRule(first, modelRoles);
  assert.equal(second, first);
  assert.match(first, /\| Fast profile \| `gpt-5\.6-luna` \| `medium` \|/u);
  assert.equal((first.match(/^## Local role map$/gmu) ?? []).length, 1);
  assert.match(first, /\| Local operator \| `omlx` \| `mlx-community--gemma-4-e2b-it-4bit`/u);
  assert.match(first, /use the selected remote role/u);
});

test("observable model inventory validates the exact model and reasoning pair", () => {
  const observableModels = observableModelCatalog();
  assert.deepEqual(
    resolveModelPolicy({ requested: { model: "gpt-5.6-sol", reasoning_effort: "high" }, observableModels }),
    {
      status: "verified-explicit",
      source: "direct-provider",
      requested: { model: "gpt-5.6-sol", reasoning_effort: "high" },
      resolved: { model: "gpt-5.6-sol", reasoning_effort: "high" },
      toml: { model: "gpt-5.6-sol", model_reasoning_effort: "high" },
    },
  );
  assert.throws(
    () => resolveModelPolicy({ requested: { model: "gpt-5.6-sol", reasoning_effort: "impossible" }, observableModels }),
    /does not support reasoning effort/,
  );
  assert.throws(
    () => resolveModelPolicy({ requested: { model: "missing", reasoning_effort: "high" }, observableModels }),
    /is not in the observable model list/,
  );
});

test("generated catalog rejects a served-model mismatch", () => {
  assert.throws(() => buildDirectProviderCatalog({
    provider: { name: "deepseek", baseUrl: "https://api.deepseek.com" },
    providerModels: { data: [{ id: "deepseek-flash" }] },
    model: "deepseek-flash",
    reasoningEffort: "high",
    verifiedRequests: [{ model: "deepseek-flash", reasoning_effort: "high", served_model: "deepseek-pro", status: "passed" }],
  }), /served "deepseek-pro"/);
});

test("Codex provider config resolves the selected responses provider", () => {
  assert.deepEqual(parseCodexProviderConfig(`model_provider = "gateway"\n\n[model_providers.gateway]\nbase_url = "http://127.0.0.1:4141/"\nenv_key = "TEST_KEY"\nwire_api = "responses"\n`), {
    name: "gateway",
    baseUrl: "http://127.0.0.1:4141",
    envKey: "TEST_KEY",
    model: null,
    reasoningEffort: null,
  });
  assert.deepEqual(parseCodexProviderConfig(`[marketplaces.local]\nsource = "/tmp/plugin"\n\nmodel_provider = "gateway"\n[model_providers.gateway]\nbase_url = "http://127.0.0.1:4141/v1"\nenv_key = "TEST_KEY"\nwire_api = "responses"\n`), {
    name: "gateway",
    baseUrl: "http://127.0.0.1:4141/v1",
    envKey: "TEST_KEY",
    model: null,
    reasoningEffort: null,
  });
  assert.deepEqual(parseCodexProviderConfig(`model = "deepseek-flash"\nmodel_provider = "deepseek"\nmodel_reasoning_effort = "high"\n[model_providers.deepseek]\nbase_url = "https://api.deepseek.com"\nenv_key = "DEEPSEEK_API_KEY"\nwire_api = "responses"\n`), {
    name: "deepseek",
    baseUrl: "https://api.deepseek.com",
    envKey: "DEEPSEEK_API_KEY",
    model: "deepseek-flash",
    reasoningEffort: "high",
  });
});

test("model setup removes only a stale top-level catalog setting", () => {
  const content = `model_provider = "deepseek"\nmodel_catalog_json = "/tmp/stale-models.json"\n\n[features]\nmulti_agent_v2 = true\n`;
  const updated = removeModelCatalogSetting(content);
  assert.doesNotMatch(updated, /^model_catalog_json\s*=/m);
  assert.match(updated, /^model_provider = "deepseek"$/m);
  assert.match(updated, /^multi_agent_v2 = true$/m);
  assert.equal(removeModelCatalogSetting(updated), updated);
});

test("live refresh rejects a provider other than direct DeepSeek before writes", async (t) => {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "pstack-model-unsupported-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const configPath = path.join(temporary, "config.toml");
  const config = `model = "gpt-5.6-sol"\nmodel_provider = "gateway"\n[model_providers.gateway]\nbase_url = "http://gateway.test/v1"\nenv_key = "TEST_KEY"\nwire_api = "responses"\n`;
  await fs.writeFile(configPath, config);
  let calls = 0;
  await assert.rejects(refreshModelCatalog({
    pluginRoot: root,
    env: { TEST_KEY: "secret" },
    configPath,
    catalogPath: path.join(temporary, "models.json"),
    proofPath: path.join(temporary, "proof.json"),
    roleRulePath: path.join(temporary, "imoten-models.md"),
    fetchImpl: async () => { calls += 1; throw new Error("unexpected request"); },
  }), /Codex provider "gateway" is not supported/);
  assert.equal(calls, 0);
  assert.equal(await fs.readFile(configPath, "utf8"), config);
  assert.deepEqual(await fs.readdir(temporary), ["config.toml"]);
});

test("live refresh configures direct DeepSeek without a catalog setting", async (t) => {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "pstack-model-deepseek-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const configPath = path.join(temporary, "config.toml");
  const catalogPath = path.join(temporary, "models.json");
  const proofPath = path.join(temporary, "proof.json");
  const roleRulePath = path.join(temporary, "imoten-models.md");
  const config = deepseekConfig;
  await fs.writeFile(configPath, config);
  const calls = [];
  const response = (body) => new Response(JSON.stringify(body), { status: 200 });
  const result = await refreshModelCatalog({
    pluginRoot: root,
    env: { DEEPSEEK_API_KEY: "secret" },
    configPath,
    catalogPath,
    proofPath,
    roleRulePath,
    now: () => "2026-09-10T00:00:00.000Z",
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url.endsWith("/models")) return response({ object: "list", data: [{ id: "deepseek-flash" }] });
      const request = JSON.parse(options.body);
      assert.equal(request.model, "deepseek-flash");
      assert.equal(request.reasoning.effort, "high");
      return response({ status: "completed", model: "deepseek-flash", output: [] });
    },
  });
  assert.deepEqual(calls, ["https://api.deepseek.com/models", "https://api.deepseek.com/responses"]);
  assert.equal(result.receipt.source, "direct-provider");
  assert.deepEqual(result.catalog.models.map(({ slug }) => slug), ["deepseek-flash"]);
  assert.equal(await fs.readFile(configPath, "utf8"), config);
  assert.doesNotMatch(await fs.readFile(configPath, "utf8"), /^model_catalog_json\s*=/m);
  assert.equal((await fs.readdir(temporary)).some((name) => name.includes(".tmp-")), false);
  const roleRule = await fs.readFile(roleRulePath, "utf8");
  assert.match(roleRule, /\| Poteto agent \| `deepseek-flash` \| `high` \|/);
  assert.match(roleRule, /\| 1 \| `deepseek-flash` \| `high` \|/);
  assert.deepEqual(resolveModelPolicy({
    requested: { model: "deepseek-flash", reasoning_effort: "high" },
    observableModels: result,
  }).source, "direct-provider");
});

test("models CLI passes the default role-rule path to refresh", async (t) => {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "pstack-model-cli-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const userHome = path.join(temporary, "home");
  await fs.mkdir(path.join(userHome, ".codex"), { recursive: true });
  await fs.writeFile(path.join(userHome, ".codex/config.toml"), deepseekConfig);
  const result = await execFileAsync(
    process.execPath,
    ["--import", path.join(root, "tests/fixtures/model-fetch-mock.mjs"), "skills/setup-pstack/scripts/manage-agents.mjs", "models", "--user-home", userHome],
    { cwd: root, encoding: "utf8", env: { ...process.env, DEEPSEEK_API_KEY: "secret" } },
  );
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "configured");
  assert.equal(output.roleRulePath, path.join(userHome, ".codex/imoten-models.md"));
  const rule = await fs.readFile(output.roleRulePath, "utf8");
  assert.match(rule, /^# Imoten model roles$/m);
  assert.match(rule, /\| Local operator \| `omlx` \| `mlx-community--gemma-4-e2b-it-4bit` \| `http:\/\/127\.0\.0\.1:8123\/v1` \| `4` \|/u);
  assert.doesNotMatch(rule, /^---$/m);
  assert.deepEqual(JSON.parse(await fs.readFile(output.catalogPath, "utf8")).models.map(({ slug }) => slug), ["deepseek-flash"]);
  assert.equal(JSON.parse(await fs.readFile(output.proofPath, "utf8")).verified_requests.length > 0, true);
});

test("live refresh aborts stalled model-list requests", async (t) => {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "pstack-model-timeout-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const configPath = path.join(temporary, "config.toml");
  await fs.writeFile(configPath, deepseekConfig);

  await assert.rejects(refreshModelCatalog({
    pluginRoot: root,
    env: { DEEPSEEK_API_KEY: "secret" },
    configPath,
    catalogPath: path.join(temporary, "models.json"),
    proofPath: path.join(temporary, "proof.json"),
    roleRulePath: path.join(temporary, "imoten-models.mdc"),
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      const abort = () => reject(options.signal.reason);
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }),
  }), /model request timed out after 10 ms/);
});

test("live refresh fails before writes when the provider is unavailable", async (t) => {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "pstack-models-down-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const configPath = path.join(temporary, "config.toml");
  await fs.writeFile(configPath, deepseekConfig);
  await assert.rejects(refreshModelCatalog({
    pluginRoot: root,
    env: { DEEPSEEK_API_KEY: "secret" },
    fetchImpl: async () => { throw new Error("connection refused"); },
    configPath,
    catalogPath: path.join(temporary, "models.json"),
    proofPath: path.join(temporary, "proof.json"),
    roleRulePath: path.join(temporary, "imoten-models.mdc"),
  }), /connection refused/);
  assert.equal(await fs.readFile(configPath, "utf8"), deepseekConfig);
  await assert.rejects(fs.stat(path.join(temporary, "imoten-models.mdc")), { code: "ENOENT" });
});

test("live refresh retries transient probe failures", async (t) => {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "pstack-model-retry-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const configPath = path.join(temporary, "config.toml");
  await fs.writeFile(configPath, deepseekConfig);
  let failedOnce = false;
  let retryDelays = 0;
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const result = await refreshModelCatalog({
    pluginRoot: root,
    env: { DEEPSEEK_API_KEY: "secret" },
    configPath,
    catalogPath: path.join(temporary, "models.json"),
    proofPath: path.join(temporary, "proof.json"),
    roleRulePath: path.join(temporary, "imoten-models.md"),
    retryDelay: async () => { retryDelays += 1; },
    fetchImpl: async (url, options) => {
      if (url.endsWith("/models")) return response({ object: "list", data: [{ id: "deepseek-flash" }] });
      const request = JSON.parse(options.body);
      if (!failedOnce) {
        failedOnce = true;
        return response({ error: { message: "try again" } }, 503);
      }
      return response({ status: "completed", model: request.model, output: [] });
    },
  });
  assert.equal(failedOnce, true);
  assert.equal(retryDelays, 1);
  assert.deepEqual(result.catalog.models.map(({ slug }) => slug), ["deepseek-flash"]);
});

test("policy rejects a catalog changed after its provider receipt", () => {
  const observableModels = observableModelCatalog();
  observableModels.catalog.models.pop();
  assert.throws(
    () => resolveModelPolicy({ requested: { model: "gpt-5.5", reasoning_effort: "high" }, observableModels }),
    /does not match its provider receipt/,
  );
});

test("policy refuses an unproven effort even when the Codex picker lists it", () => {
  const observableModels = observableModelCatalog();
  observableModels.receipt.verified_requests = observableModels.receipt.verified_requests.filter(
    (record) => record.model !== "gpt-5.6-sol" || record.reasoning_effort !== "max",
  );
  assert.throws(
    () => resolveModelPolicy({ requested: { model: "gpt-5.6-sol", reasoning_effort: "max" }, observableModels }),
    /lacks a real provider request proof/,
  );
});

test("model selection fails closed without an exact pair and observable catalog", () => {
  assert.throws(() => resolveModelPolicy({ requested: null, observableModels: [] }), /explicit model pair/);
  assert.throws(
    () => resolveModelPolicy({ requested: { model: "gpt-5.6-sol", reasoning_effort: "high" } }),
    /observable model list/,
  );
});
