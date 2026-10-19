#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const AGENT_NODE_MAJOR = 24;

const ROLE_SPECS = [
  {
    name: "imoten-poteto-agent",
    template: "templates/codex-agents/imoten-poteto-agent.toml",
    prompt: "skills/poteto-mode/references/poteto-agent-prompt.md",
    capability: {
      sandbox: "inherited-unverified-at-setup",
      writable_scope: "parent-request-only",
      connectors: "inherited-parent-authority",
      skills: ["poteto-mode"],
      fallback: "generic-agent-same-pair-or-matching-parent",
    },
  },
  {
    name: "imoten-comment-sicko",
    template: "templates/codex-agents/imoten-comment-sicko.toml",
    prompt: "skills/no-comments/references/comment-sicko-prompt.md",
    capability: {
      sandbox: "requested-read-only-unverified-until-runtime",
      writable_scope: "none",
      connectors: "prohibited-fail-closed-if-not-constrained",
      skills: ["how", "why"],
      fallback: "constrained-generic-agent-same-pair-or-skip",
    },
  },
];

const MODEL_REQUEST_TIMEOUT_MS = 60_000;

export function resolveCodexHome({ userHome = os.homedir(), codexHome, env = process.env } = {}) {
  if (codexHome) return path.resolve(codexHome);
  const normalizedUserHome = path.resolve(userHome);
  const normalizedSystemHome = path.resolve(os.homedir());
  const activeHome = env.IMOTEN_ACTIVE_CODEX_HOME ?? env.CODEX_HOME;
  if (activeHome && normalizedUserHome === normalizedSystemHome) return path.resolve(activeHome);
  return path.join(normalizedUserHome, ".codex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerModelIds(providerModels) {
  const models = Array.isArray(providerModels) ? providerModels : providerModels?.data;
  if (!Array.isArray(models)) throw new Error("providerModels must be an OpenAI model list");
  const byId = new Map();
  for (const model of models) {
    if (!isRecord(model) || typeof model.id !== "string" || !model.id.trim()) {
      throw new Error("providerModels contains an invalid model id");
    }
    byId.set(model.id.trim(), model);
  }
  return { models, byId };
}

function providerEndpoint(baseUrl, resource) {
  return `${baseUrl.replace(/\/+$/u, "")}/${resource}`;
}

function requestKey(model, reasoningEffort) {
  return `${model}\u0000${reasoningEffort}`;
}

function servedModelMatches(requested, served) {
  return served === requested || new RegExp(`^${requested.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}-\\d{4}-\\d{2}-\\d{2}$`, "u").test(served);
}

function passedRequests(requests) {
  if (!Array.isArray(requests)) throw new Error("verifiedRequests must be an array");
  const passed = new Map();
  for (const request of requests) {
    if (!isRecord(request) || typeof request.model !== "string" || typeof request.reasoning_effort !== "string") {
      throw new Error("verifiedRequests entries must include model and reasoning_effort");
    }
    if (request.status !== "passed") throw new Error(`verified request failed for "${request.model}" at "${request.reasoning_effort}"`);
    if (typeof request.served_model !== "string" || !servedModelMatches(request.model, request.served_model)) {
      throw new Error(`provider served "${request.served_model ?? "unknown"}" for requested model "${request.model}"`);
    }
    passed.set(requestKey(request.model, request.reasoning_effort), {
      model: request.model,
      reasoning_effort: request.reasoning_effort,
      served_model: request.served_model,
      status: "passed",
    });
  }
  return passed;
}

function uniquePairs(pairs) {
  const result = new Map();
  for (const pair of pairs) {
    if (!isRecord(pair) || typeof pair.model !== "string" || typeof pair.reasoning_effort !== "string") {
      throw new Error("model pairs must include model and reasoning_effort");
    }
    result.set(requestKey(pair.model, pair.reasoning_effort), pair);
  }
  return [...result.values()];
}

export function buildDirectProviderCatalog({ provider, providerModels, model, reasoningEffort, verifiedRequests, generatedAt = new Date().toISOString() } = {}) {
  if (!isRecord(provider) || typeof provider.name !== "string" || typeof provider.baseUrl !== "string") {
    throw new Error("direct provider identity is required");
  }
  const { models: rawProviderModels, byId } = providerModelIds(providerModels);
  if (!byId.has(model)) throw new Error(`model "${model}" is not exposed by provider "${provider.name}"`);
  const passed = passedRequests(verifiedRequests);
  if (!passed.has(requestKey(model, reasoningEffort))) {
    throw new Error(`model "${model}" at "${reasoningEffort}" lacks a real provider request proof`);
  }
  const catalog = {
    models: [{
      slug: model,
      display_name: model,
      description: `Verified model from ${provider.name}`,
      default_reasoning_level: reasoningEffort,
      supported_reasoning_levels: [{ effort: reasoningEffort, description: `${reasoningEffort} reasoning effort` }],
      supported_in_api: true,
      visibility: "list",
      multi_agent_version: "v2",
    }],
  };
  return {
    catalog,
    receipt: {
      schema_version: 1,
      source: "direct-provider",
      generated_at: generatedAt,
      provider: { name: provider.name, base_url: provider.baseUrl },
      provider_models_sha256: sha256(JSON.stringify(rawProviderModels)),
      generated_catalog_sha256: sha256(JSON.stringify(catalog)),
      multi_agent_version: "v2",
      verified_requests: [...passed.values()],
    },
  };
}

function parseTomlString(value, name) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  if (trimmed && !/[\s#]/u.test(trimmed)) return trimmed;
  throw new Error(`${name} must be a TOML string`);
}

function parseProviderSelection(section, key, rawValue, config) {
  if (key === "model_provider" && !section.startsWith("model_providers.")) {
    config.providerName = parseTomlString(rawValue, "model_provider");
    return true;
  }
  if (section !== "") return false;
  if (key === "model") {
    config.model = parseTomlString(rawValue, "model");
    return true;
  }
  if (key === "model_reasoning_effort") {
    config.reasoningEffort = parseTomlString(rawValue, "model_reasoning_effort");
    return true;
  }
  return false;
}

function parseProviderField(section, key, rawValue, providers) {
  const provider = section.match(/^model_providers\.([A-Za-z0-9_-]+)$/u)?.[1];
  if (!provider || !["base_url", "env_key", "wire_api"].includes(key)) return;
  const values = providers.get(provider) ?? {};
  values[key] = parseTomlString(rawValue, `model_providers.${provider}.${key}`);
  providers.set(provider, values);
}

export function parseCodexProviderConfig(content) {
  let section = "";
  const config = { providerName: null, model: null, reasoningEffort: null };
  const providers = new Map();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/u);
    if (header) {
      section = header[1];
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u);
    if (!assignment) continue;
    if (parseProviderSelection(section, assignment[1], assignment[2], config)) continue;
    parseProviderField(section, assignment[1], assignment[2], providers);
  }
  if (!config.providerName) throw new Error("Codex config does not select model_provider");
  const provider = providers.get(config.providerName);
  if (!provider?.base_url || !provider?.env_key) throw new Error(`Codex provider "${config.providerName}" lacks base_url or env_key`);
  if (provider.wire_api && provider.wire_api !== "responses") {
    throw new Error(`Codex provider "${config.providerName}" must use the responses wire API`);
  }
  return {
    name: config.providerName,
    baseUrl: provider.base_url.replace(/\/+$/u, ""),
    envKey: provider.env_key,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
  };
}

function parseDirectProviderConfig(content) {
  const provider = parseCodexProviderConfig(content);
  if (provider.name !== "deepseek") {
    throw new Error(`Codex provider "${provider.name}" is not supported; model setup supports direct "deepseek" only`);
  }
  if (!provider.model) throw new Error("Codex config must select a model for provider \"deepseek\"");
  return provider;
}

export function removeModelCatalogSetting(content) {
  const lines = content.split(/\r?\n/u);
  let sectionStarted = false;
  const result = [];
  for (const line of lines) {
    if (/^\s*\[/u.test(line)) sectionStarted = true;
    if (!sectionStarted && /^\s*model_catalog_json\s*=/u.test(line)) continue;
    result.push(line);
  }
  return `${result.join("\n").replace(/\n*$/u, "")}\n`;
}

const LOCAL_OPERATOR_RULE_BEGIN = "# imoten-local-operator:begin";
const LOCAL_OPERATOR_RULE_END = "# imoten-local-operator:end";

function updateRunnerRule(content, launcherPath, begin, end, justification) {
  const normalized = path.resolve(launcherPath);
  const block = `${begin}\nprefix_rule(\n    pattern = [${JSON.stringify(normalized)}],\n    decision = "allow",\n    justification = ${JSON.stringify(justification)},\n)\n${end}`;
  const pattern = new RegExp(`${begin}[\\s\\S]*?${end}`, "u");
  if (pattern.test(content)) return `${content.replace(pattern, block).replace(/\n*$/u, "")}\n`;
  return `${content.replace(/\n*$/u, "")}\n\n${block}\n`;
}

function removeRunnerRule(content, begin, end) {
  const pattern = new RegExp(`(?:^|\\n)${begin}[\\s\\S]*?${end}(?:\\n|$)`, "u");
  if (!pattern.test(content)) return content;
  const updated = content.replace(pattern, "\n").replace(/\n{3,}/gu, "\n\n").trim();
  return updated ? `${updated}\n` : "";
}

export function updateLocalOperatorRule(content, launcherPath) {
  return updateRunnerRule(
    content,
    launcherPath,
    LOCAL_OPERATOR_RULE_BEGIN,
    LOCAL_OPERATOR_RULE_END,
    "Run the installed Imoten local operator against its fixed loopback endpoint.",
  );
}

export function removeLocalOperatorRule(content) {
  return removeRunnerRule(content, LOCAL_OPERATOR_RULE_BEGIN, LOCAL_OPERATOR_RULE_END);
}

async function executableOnPath(name, env = process.env) {
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      await fs.access(candidate);
      return await fs.realpath(candidate);
    } catch (error) {
      if (!["EACCES", "ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  throw new Error(`${name} executable was not found on PATH`);
}

async function assertAgentNode(nodePath) {
  const node = await fs.realpath(nodePath);
  const { stdout } = await execFileAsync(node, ["--version"]);
  const major = Number(stdout.trim().match(/^v(\d+)\./u)?.[1]);
  if (major !== AGENT_NODE_MAJOR) {
    throw new Error(`Imoten local operator requires Node.js ${AGENT_NODE_MAJOR} LTS; ${node} reports ${stdout.trim() || "an unknown version"}`);
  }
  return node;
}

async function resolveAgentNode(env = process.env) {
  if (Number(process.versions.node.split(".")[0]) === AGENT_NODE_MAJOR) {
    return assertAgentNode(process.execPath);
  }
  try {
    const mise = await executableOnPath("mise", env);
    const { stdout } = await execFileAsync(mise, ["where", `node@${AGENT_NODE_MAJOR}`], { env });
    return assertAgentNode(path.join(stdout.trim(), "bin", "node"));
  } catch (error) {
    throw new Error(`Node.js ${AGENT_NODE_MAJOR} LTS is required for the Imoten local operator launcher; run setup with Node.js ${AGENT_NODE_MAJOR} or install node@${AGENT_NODE_MAJOR} with mise`, { cause: error });
  }
}

async function installRunnerFiles({ sourcePath, launcherPath, runnerConfigPath, config, node, rulesPath, updateRule }) {
  const script = (await fs.readFile(sourcePath, "utf8")).replace(/^#![^\r\n]*/u, `#!${node}`);
  await Promise.all([
    writeAtomic(launcherPath, script),
    writeAtomic(runnerConfigPath, `${JSON.stringify(config, null, 2)}\n`),
  ]);
  await fs.chmod(launcherPath, 0o700);
  let rules = "";
  try {
    rules = await fs.readFile(rulesPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeAtomic(rulesPath, updateRule(rules, launcherPath));
}

async function uninstallRunnerFiles({ launcherPath, runnerConfigPath, rulesPath, removeRule }) {
  let rules = null;
  try {
    rules = await fs.readFile(rulesPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (rules !== null) {
    const updated = removeRule(rules);
    if (updated !== rules) {
      if (updated.trim()) await writeAtomic(rulesPath, updated);
      else await fs.rm(rulesPath, { force: true });
    }
  }
  await Promise.all([
    fs.rm(launcherPath, { force: true }),
    fs.rm(runnerConfigPath, { force: true }),
  ]);
}

export async function installLocalOperator({
  pluginRoot,
  userHome = os.homedir(),
  codexHome,
  nodePath,
  rulesPath,
} = {}) {
  if (!pluginRoot) throw new Error("pluginRoot is required");
  const node = nodePath ? await assertAgentNode(nodePath) : await resolveAgentNode();
  const modelRoles = await fs.readFile(path.join(pluginRoot, "skills/setup-pstack/references/model-roles.md"), "utf8");
  const role = parseRecommendedLocalRoles(modelRoles).get("Local operator");
  if (!role) throw new Error('local model role "Local operator" is missing from the recommended map');
  const codexRoot = resolveCodexHome({ userHome, codexHome });
  const resolvedRulesPath = rulesPath ?? path.join(codexRoot, "rules", "default.rules");
  const launcherPath = path.join(codexRoot, "bin", "imoten-local-operator");
  const sourcePath = path.join(pluginRoot, "skills", "setup-pstack", "scripts", "imoten-local-operator.mjs");
  const runnerConfigPath = path.join(codexRoot, "imoten-local-operator.json");
  const config = {
    schema_version: 1,
    role: "Local operator",
    backend: role.backend,
    base_url: role.endpoint,
    model: role.model,
    max_concurrency: role.max_concurrency,
    request_timeout_ms: 120_000,
    max_output_tokens: 512,
  };
  await installRunnerFiles({
    sourcePath,
    launcherPath,
    runnerConfigPath,
    config,
    node,
    rulesPath: resolvedRulesPath,
    updateRule: updateLocalOperatorRule,
  });
  return { launcherPath, rulesPath: resolvedRulesPath, runnerConfigPath, role };
}

export async function uninstallLocalOperator({
  userHome = os.homedir(),
  codexHome,
  rulesPath,
} = {}) {
  const codexRoot = resolveCodexHome({ userHome, codexHome });
  const resolvedRulesPath = rulesPath ?? path.join(codexRoot, "rules", "default.rules");
  const launcherPath = path.join(codexRoot, "bin", "imoten-local-operator");
  const runnerConfigPath = path.join(codexRoot, "imoten-local-operator.json");
  await uninstallRunnerFiles({ launcherPath, runnerConfigPath, rulesPath: resolvedRulesPath, removeRule: removeLocalOperatorRule });
  return { launcherPath, rulesPath: resolvedRulesPath, runnerConfigPath };
}

function modelEfforts(model) {
  return (model.supported_reasoning_levels ?? [])
    .map((entry) => typeof entry === "string" ? entry : entry?.effort)
    .filter((effort) => typeof effort === "string");
}

function renderLocalRoleSection(modelRoles) {
  const rows = [...parseRecommendedLocalRoles(modelRoles).entries()].map(([role, config]) => (
    `| ${role} | \`${config.backend}\` | \`${config.model}\` | \`${config.endpoint}\` | \`${config.max_concurrency}\` |`
  ));
  return `\n## Local role map\n\nUse the local runner only for bounded, read-only work with an automatic result check. The runner verifies the exact served model. If the endpoint is unavailable or the result asks to escalate, use the selected remote role.\n\n| Role | Backend | Model | Endpoint | Max concurrency |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

export function updateLocalRoleRule(content, modelRoles) {
  const section = renderLocalRoleSection(modelRoles).trimEnd();
  const pattern = /\n## Local role map\n[\s\S]*?(?=\n## |$)/u;
  if (pattern.test(content)) return `${content.replace(pattern, section).trimEnd()}\n`;
  return `${content.trimEnd()}\n${section}\n`;
}

export async function configureLocalOperator({
  pluginRoot,
  userHome = os.homedir(),
  codexHome,
  roleRulePath,
  nodePath,
} = {}) {
  if (!pluginRoot) throw new Error("pluginRoot is required");
  const resolvedCodexHome = resolveCodexHome({ userHome, codexHome });
  const resolvedRoleRulePath = roleRulePath ?? path.join(resolvedCodexHome, "imoten-models.md");
  const modelRoles = await fs.readFile(path.join(pluginRoot, "skills/setup-pstack/references/model-roles.md"), "utf8");
  let currentRule;
  try {
    currentRule = await fs.readFile(resolvedRoleRulePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`model role map is missing at ${resolvedRoleRulePath}; run models setup first`);
    throw error;
  }
  const localOperator = await installLocalOperator({ pluginRoot, userHome, codexHome: resolvedCodexHome, nodePath });
  await writeAtomic(resolvedRoleRulePath, updateLocalRoleRule(currentRule, modelRoles));
  return { status: "configured-local", roleRulePath: resolvedRoleRulePath, localOperator };
}

export function renderModelRoleRule({ modelRoles, observableModels } = {}) {
  if (!isRecord(observableModels) || observableModels.receipt?.source !== "direct-provider") {
    throw new Error("observable model catalog must include a provider receipt");
  }
  if (!Array.isArray(observableModels.catalog?.models)) {
    throw new Error("observable model catalog must include Codex models");
  }
  const model = observableModels.catalog.models[0];
  if (!model) throw new Error("direct provider catalog is empty");
  const effort = modelEfforts(model)[0];
  if (!effort) throw new Error(`direct provider model "${model.slug}" has no proved reasoning effort`);
  const roles = parseRecommendedRoles(modelRoles);
  const roleRows = [...roles.keys()].map((role) => `| ${role} | \`${model.slug}\` | \`${effort}\` |`);
  const generatedAt = observableModels.receipt.generated_at ?? new Date().toISOString();
  const providerName = observableModels.receipt.provider?.name ?? "direct-provider";
  return `# Imoten model roles\n\nVerified on ${generatedAt.slice(0, 10)} from the authenticated ${providerName} model list and a completed Responses API request.\n\n## Selection rule\n\nUse the exact model and reasoning-effort pair assigned to each role or panel lane. Validate it against the configured provider before dispatch. If the provider cannot serve it, stop that lane and report it. Do not inherit the parent model or select a substitute.\n\n## Provider model\n\n| Provider | Model | Proven reasoning effort |\n| --- | --- | --- |\n| ${providerName} | \`${model.slug}\` | \`${effort}\` |\n\n## Role map\n\n| Role | Model | Reasoning effort |\n| --- | --- | --- |\n${roleRows.join("\n")}\n| Arena runners | Shared review panel | See below |\n| Arena cross-judges | Shared review panel | See below |\n| Architect runners | Shared review panel | See below |\n| Interrogate reviewers | Shared review panel | See below |\n| Independent verifiers | Shared review panel | See below |\n\n## Shared review panel\n\n| Order | Model | Reasoning effort |\n| --- | --- | --- |\n| 1 | \`${model.slug}\` | \`${effort}\` |\n${renderLocalRoleSection(modelRoles)}`;
}

async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, content, { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function readJsonResponse(response, label) {
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${label} returned invalid JSON with HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}: ${parsed.error?.message ?? body}`);
  return parsed;
}

async function requestJson(fetchImpl, url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return await readJsonResponse(response, label);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`model request timed out after ${timeoutMs} ms`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function defaultRetryDelay() {
  const delayMs = 250 + Math.floor(Math.random() * 251);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function probeModel(fetchImpl, baseUrl, headers, providerName, model, reasoningEffort, requestTimeoutMs) {
  const endpoint = providerEndpoint(baseUrl, "responses");
  const label = `${providerName} request for ${model} at ${reasoningEffort}`;
  const body = await requestJson(fetchImpl, endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: reasoningEffort },
      input: "Reply only with OK.",
      max_output_tokens: 256,
    }),
  }, requestTimeoutMs, label);
  if (body.status !== "completed") throw new Error(`${providerName} request for "${model}" at "${reasoningEffort}" did not complete`);
  if (typeof body.model !== "string" || !servedModelMatches(model, body.model)) {
    throw new Error(`${providerName} served "${body.model ?? "unknown"}" for requested model "${model}"`);
  }
  return { model, reasoning_effort: reasoningEffort, served_model: body.model, status: "passed" };
}

async function probeModelWithRetry(fetchImpl, baseUrl, headers, providerName, model, reasoningEffort, requestTimeoutMs, retryDelay) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await probeModel(fetchImpl, baseUrl, headers, providerName, model, reasoningEffort, requestTimeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await retryDelay();
    }
  }
  throw lastError;
}

async function probePairs({ fetchImpl, provider, headers, pairs, requestTimeoutMs, retryDelay }) {
  const results = [];
  for (const pair of pairs) {
    results.push(await Promise.resolve()
      .then(() => probeModelWithRetry(
        fetchImpl,
        provider.baseUrl,
        headers,
        provider.name,
        pair.model,
        pair.reasoning_effort,
        requestTimeoutMs,
        retryDelay,
      ))
      .then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason }),
      ));
  }
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

async function buildDirectObservableModels({
  fetchImpl,
  provider,
  headers,
  requiredPairs,
  requestTimeoutMs,
  retryDelay,
  now,
}) {
  const reasoningEffort = provider.reasoningEffort ?? "high";
  const selectedPair = { model: provider.model, reasoning_effort: reasoningEffort };
  const requestedPairs = uniquePairs([selectedPair, ...requiredPairs]);
  const differentPair = requestedPairs.find((pair) => (
    pair.model !== selectedPair.model || pair.reasoning_effort !== selectedPair.reasoning_effort
  ));
  if (differentPair) {
    throw new Error(`direct DeepSeek setup supports the selected pair only: "${selectedPair.model}" at "${selectedPair.reasoning_effort}"`);
  }
  const providerModels = await requestJson(
    fetchImpl,
    providerEndpoint(provider.baseUrl, "models"),
    { headers: { ...headers, "user-agent": "imoten-model-catalog/1" } },
    requestTimeoutMs,
    "DeepSeek model list",
  );
  const verifiedRequests = await probePairs({
    fetchImpl,
    provider,
    headers,
    pairs: requestedPairs,
    requestTimeoutMs,
    retryDelay,
  });
  if (!verifiedRequests.some((request) => requestKey(request.model, request.reasoning_effort) === requestKey(selectedPair.model, selectedPair.reasoning_effort))) {
    throw new Error(`required model "${selectedPair.model}" at "${selectedPair.reasoning_effort}" failed its real DeepSeek request`);
  }
  return buildDirectProviderCatalog({
    provider,
    providerModels,
    model: selectedPair.model,
    reasoningEffort: selectedPair.reasoning_effort,
    verifiedRequests,
    generatedAt: now(),
  });
}

export async function refreshModelCatalog({
  pluginRoot,
  userHome = os.homedir(),
  codexHome,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  requiredPairs = [],
  requestTimeoutMs = MODEL_REQUEST_TIMEOUT_MS,
  retryDelay = defaultRetryDelay,
  configPath,
  catalogPath,
  proofPath,
  roleRulePath,
} = {}) {
  if (!pluginRoot) throw new Error("pluginRoot is required");
  const codexRoot = resolveCodexHome({ userHome, codexHome, env });
  const resolvedConfigPath = configPath ?? path.join(codexRoot, "config.toml");
  const resolvedRoleRulePath = roleRulePath ?? env.IMOTEN_MODEL_ROLE_RULE ?? path.join(codexRoot, "imoten-models.md");
  const config = await fs.readFile(resolvedConfigPath, "utf8");
  const provider = parseDirectProviderConfig(config);
  const token = env[provider.envKey];
  if (!token) throw new Error(`environment variable "${provider.envKey}" is required for provider "${provider.name}"`);
  const headers = { authorization: `Bearer ${token}` };
  const resolvedCatalogPath = catalogPath ?? path.join(codexRoot, `imoten-${provider.name}-models.json`);
  const resolvedProofPath = proofPath ?? path.join(codexRoot, `imoten-${provider.name}-models.receipt.json`);
  const modelRoles = await fs.readFile(path.join(pluginRoot, "skills/setup-pstack/references/model-roles.md"), "utf8");
  const buildOptions = {
    fetchImpl,
    provider,
    headers,
    modelRoles,
    requiredPairs,
    requestTimeoutMs,
    retryDelay,
    now,
  };
  const observableModels = await buildDirectObservableModels(buildOptions);
  const modelRule = renderModelRoleRule({ modelRoles, observableModels });
  await writeAtomic(resolvedCatalogPath, `${JSON.stringify(observableModels.catalog, null, 2)}\n`);
  await writeAtomic(resolvedProofPath, `${JSON.stringify(observableModels.receipt, null, 2)}\n`);
  await writeAtomic(resolvedRoleRulePath, modelRule);
  await writeAtomic(resolvedConfigPath, removeModelCatalogSetting(config));
  return {
    ...observableModels,
    provider,
    catalogPath: resolvedCatalogPath,
    proofPath: resolvedProofPath,
    configPath: resolvedConfigPath,
    roleRulePath: resolvedRoleRulePath,
  };
}

function layer(scope, projectRoot, userHome, codexHome) {
  if (scope === "project") {
    return {
      root: projectRoot,
      agentsDir: path.join(projectRoot, ".codex/agents"),
      receipt: path.join(projectRoot, ".codex/imoten-setup-receipt.json"),
      relative: (file) => path.relative(projectRoot, file),
    };
  }
  if (scope === "user") {
    const codexRoot = resolveCodexHome({ userHome, codexHome });
    return {
      root: codexRoot,
      agentsDir: path.join(codexRoot, "agents"),
      receipt: path.join(codexRoot, "imoten-setup-receipt.json"),
      relative: (file) => path.relative(codexRoot, file),
    };
  }
  throw new Error(`unsupported scope "${scope}"; expected project or user`);
}

async function listToml(directory, scope) {
  let filenames;
  try {
    filenames = await fs.readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const filename of filenames.sort()) {
    if (!filename.endsWith(".toml")) continue;
    const file = path.join(directory, filename);
    const content = await fs.readFile(file, "utf8");
    const match = content.match(/^\s*name\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/m);
    if (!match) continue;
    records.push({ name: match[1] === undefined ? match[2] : JSON.parse(`"${match[1]}"`), file, scope });
  }
  return records;
}

export async function scanAgentNames({ projectRoot = process.cwd(), userHome = os.homedir(), codexHome } = {}) {
  const codexRoot = resolveCodexHome({ userHome, codexHome });
  const records = [
    ...(await listToml(path.join(projectRoot, ".codex/agents"), "project")),
    ...(await listToml(path.join(codexRoot, "agents"), "user")),
  ];
  const byName = new Map();
  for (const record of records) {
    const matches = byName.get(record.name) ?? [];
    matches.push(record);
    byName.set(record.name, matches);
  }
  return {
    records,
    duplicates: [...byName.entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([name, matches]) => ({ name, files: matches.map((record) => record.file) })),
  };
}

export function parseRecommendedRoles(content) {
  const section = content.match(/## Recommended Codex map\n([\s\S]*?)(?=\n## |$)/u)?.[1] ?? "";
  const roles = new Map();
  for (const line of section.split("\n")) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|$/u);
    if (!match || match[1] === "Role") continue;
    roles.set(match[1], { model: match[2], reasoning_effort: match[3] });
  }
  if (!roles.size) throw new Error("recommended model role table is missing or empty");
  return roles;
}

export function parseRecommendedLocalRoles(content) {
  const section = content.match(/## Recommended local map\n([\s\S]*?)(?=\n## |$)/u)?.[1] ?? "";
  const roles = new Map();
  for (const line of section.split("\n")) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`(\d+)`\s*\|$/u);
    if (!match || match[1] === "Role") continue;
    const maxConcurrency = Number(match[5]);
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error(`local model role "${match[1]}" has an invalid max concurrency`);
    }
    roles.set(match[1], {
      backend: match[2],
      model: match[3],
      endpoint: match[4],
      max_concurrency: maxConcurrency,
    });
  }
  if (!roles.size) throw new Error("recommended local model role table is missing or empty");
  return roles;
}

export function resolveModelPolicy({ requested = null, observableModels = null } = {}) {
  if (!requested) throw new Error("an explicit model pair is required");
  if (!requested.model || !requested.reasoning_effort) {
    throw new Error("a model request must include both model and reasoning_effort");
  }
  if (observableModels === null) {
    throw new Error("an observable model list is required");
  }
  if (!isRecord(observableModels) || observableModels.receipt?.source !== "direct-provider") {
    throw new Error("observable model catalog must include a provider receipt");
  }
  const models = observableModels.catalog?.models;
  if (!Array.isArray(models)) throw new Error("observable model catalog must include Codex models");
  if (observableModels.receipt.generated_catalog_sha256 !== sha256(JSON.stringify(observableModels.catalog))) {
    throw new Error("observable model catalog does not match its provider receipt");
  }
  const model = models.find((candidate) => candidate.slug === requested.model);
  if (!model) throw new Error(`model "${requested.model}" is not in the observable model list`);
  const efforts = model.reasoning_efforts
    ?? model.supported_reasoning_levels?.map((entry) => typeof entry === "string" ? entry : entry.effort)
    ?? [];
  if (!efforts.includes(requested.reasoning_effort)) {
    throw new Error(`model "${requested.model}" does not support reasoning effort "${requested.reasoning_effort}"`);
  }
  const verifiedRequests = observableModels.receipt.verified_requests;
  if (!Array.isArray(verifiedRequests) || !verifiedRequests.some((record) => (
    record?.model === requested.model
    && record?.reasoning_effort === requested.reasoning_effort
    && record?.status === "passed"
  ))) {
    throw new Error(`model "${requested.model}" with reasoning effort "${requested.reasoning_effort}" lacks a real provider request proof`);
  }
  return {
    status: "verified-explicit",
    source: observableModels.receipt.source,
    requested,
    resolved: { ...requested },
    toml: { model: requested.model, model_reasoning_effort: requested.reasoning_effort },
  };
}

async function readReceipt(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function expectedRolePaths(target) {
  return ROLE_SPECS.map((role) => target.relative(path.join(target.agentsDir, `${role.name}.toml`)));
}

function validateReceipt(receipt, scope, target) {
  if (!receipt) return;
  if (receipt.schema_version !== 1 || receipt.owner !== "imoten/setup-pstack" || receipt.scope !== scope) {
    throw new Error("setup receipt has an unknown owner, schema, or scope; review it before continuing");
  }
  if (!Array.isArray(receipt.files)) throw new Error("setup receipt files must be an array");
  const expected = new Set(expectedRolePaths(target));
  const seen = new Set();
  for (const record of receipt.files) {
    if (!record || typeof record !== "object" || typeof record.path !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256 ?? "")) {
      throw new Error("setup receipt contains an invalid path or SHA-256");
    }
    if (seen.has(record.path)) throw new Error(`setup receipt contains duplicate path "${record.path}"`);
    if (!expected.has(record.path)) throw new Error(`setup receipt contains unexpected path "${record.path}"`);
    seen.add(record.path);
  }
  const missing = [...expected].filter((expectedPath) => !seen.has(expectedPath));
  if (missing.length) throw new Error(`setup receipt is missing expected path(s): ${missing.join(", ")}`);
}

async function inspectOwnedFiles(receipt, target) {
  if (!receipt) return [];
  const recordsByPath = new Map((receipt?.files ?? []).map((record) => [record.path, record]));
  const diagnostics = [];
  for (const role of ROLE_SPECS) {
    const absolute = path.join(target.agentsDir, `${role.name}.toml`);
    const relativePath = target.relative(absolute);
    const record = recordsByPath.get(relativePath);
    try {
      const content = await fs.readFile(absolute);
      const actual = sha256(content);
      if (actual !== record.sha256) {
        diagnostics.push({ path: relativePath, status: "modified", expected_sha256: record.sha256, actual_sha256: actual });
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        diagnostics.push({ path: relativePath, status: "missing", expected_sha256: record.sha256, actual_sha256: null });
      }
      else throw error;
    }
  }
  return diagnostics;
}

function renderTemplate(template, prompt, modelPolicy) {
  if (prompt.includes('"""')) throw new Error("portable prompt cannot contain a TOML multiline-string terminator");
  const modelLines = Object.entries(modelPolicy.toml)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join("\n");
  return template.replace("{{MODEL_CONFIG}}", modelLines).replace("{{PROMPT}}", prompt.trim());
}

export async function installAgents({
  pluginRoot,
  projectRoot = process.cwd(),
  userHome = os.homedir(),
  codexHome,
  scope = "project",
  profile = {},
  modelCatalogOptions = {},
  localOperatorOptions = {},
} = {}) {
  if (!pluginRoot) throw new Error("pluginRoot is required");
  const resolvedCodexHome = resolveCodexHome({ userHome, codexHome });
  const target = layer(scope, projectRoot, userHome, resolvedCodexHome);
  const currentReceipt = await readReceipt(target.receipt);
  validateReceipt(currentReceipt, scope, target);
  const divergence = await inspectOwnedFiles(currentReceipt, target);
  if (divergence.length) {
    const summary = divergence.map(({ path: file, status }) => `${file} (${status})`).join(", ");
    throw new Error(
      `review required for divergent Imoten-owned files: ${summary}; run uninstall to preserve changed files and archive the receipt`,
    );
  }

  const inventory = await scanAgentNames({ projectRoot, userHome, codexHome: resolvedCodexHome });
  if (inventory.duplicates.length) {
    const duplicate = inventory.duplicates[0];
    throw new Error(`duplicate custom-agent name "${duplicate.name}" across: ${duplicate.files.join(", ")}`);
  }
  const ownedPaths = new Set((currentReceipt?.files ?? []).map((record) => path.resolve(target.root, record.path)));
  for (const role of ROLE_SPECS) {
    const collision = inventory.records.find(
      (record) => record.name === role.name && !ownedPaths.has(path.resolve(record.file)),
    );
    if (collision) throw new Error(`custom-agent name "${role.name}" is already owned by ${collision.file}`);
  }

  const modelConfigPath = modelCatalogOptions.configPath ?? path.join(resolvedCodexHome, "config.toml");
  const provider = parseDirectProviderConfig(await fs.readFile(modelConfigPath, "utf8"));
  const selectedPair = { model: provider.model, reasoning_effort: provider.reasoningEffort ?? "high" };
  const requestedByRole = new Map(ROLE_SPECS.map((role) => [role.name, profile[role.name] ?? selectedPair]));
  const observableModels = await refreshModelCatalog({
    pluginRoot,
    userHome,
    codexHome: resolvedCodexHome,
    ...modelCatalogOptions,
    requiredPairs: [...requestedByRole.values()],
  });
  const localOperator = await installLocalOperator({ ...localOperatorOptions, pluginRoot, userHome, codexHome: resolvedCodexHome });
  const rendered = [];
  for (const role of ROLE_SPECS) {
    const requested = requestedByRole.get(role.name);
    const modelPolicy = resolveModelPolicy({ requested, observableModels });
    const [template, prompt] = await Promise.all([
      fs.readFile(path.join(pluginRoot, role.template), "utf8"),
      fs.readFile(path.join(pluginRoot, role.prompt), "utf8"),
    ]);
    const content = `${renderTemplate(template, prompt, modelPolicy).trim()}\n`;
    const file = path.join(target.agentsDir, `${role.name}.toml`);
    rendered.push({ role, modelPolicy, content, file, path: target.relative(file), sha256: sha256(content) });
  }

  await fs.mkdir(target.agentsDir, { recursive: true });
  for (const record of rendered) await fs.writeFile(record.file, record.content, { mode: 0o600 });
  const receipt = {
    schema_version: 1,
    owner: "imoten/setup-pstack",
    scope,
    created_at: new Date().toISOString(),
    files: rendered.map(({ role, modelPolicy, path: relativePath, sha256: hash }) => ({
      path: relativePath,
      sha256: hash,
      template: role.template,
      prompt: role.prompt,
      capability: role.capability,
      model_policy: modelPolicy,
    })),
  };
  await fs.mkdir(path.dirname(target.receipt), { recursive: true });
  await fs.writeFile(target.receipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return { status: "installed", scope, receiptPath: target.relative(target.receipt), files: receipt.files, localOperator };
}

export async function uninstallAgents({ projectRoot = process.cwd(), userHome = os.homedir(), codexHome, scope = "project" } = {}) {
  const target = layer(scope, projectRoot, userHome, codexHome);
  const receipt = await readReceipt(target.receipt);
  if (!receipt) return { status: "not-installed", scope, modified: [] };
  validateReceipt(receipt, scope, target);
  const divergence = await inspectOwnedFiles(receipt, target);
  const divergentPaths = new Set(divergence.map((record) => record.path));
  for (const role of ROLE_SPECS) {
    const absolute = path.join(target.agentsDir, `${role.name}.toml`);
    if (!divergentPaths.has(target.relative(absolute))) await fs.rm(absolute);
  }
  if (!divergence.length) {
    await fs.rm(target.receipt);
    return { status: "uninstalled", scope, modified: [] };
  }

  const archive = `${target.receipt}.preserved-${Date.now()}`;
  await fs.rename(target.receipt, archive);
  return {
    status: "uninstalled-with-preserved-files",
    scope,
    modified: divergence.map((record) => record.path),
    diagnostics: divergence,
    archivedReceipt: target.relative(archive),
    recovery: "Changed files were preserved and are no longer managed. Move or remove them before reinstalling, then delete the archived receipt after review.",
  };
}

function resolveCliCodexHome(options, userHome) {
  if (options["codex-home"]) return path.resolve(options["codex-home"]);
  if (options["user-home"]) return path.join(userHome, ".codex");
  return undefined;
}

async function main(argv) {
  const action = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`invalid argument near "${flag ?? ""}"`);
    options[flag.slice(2)] = value;
  }
  const allowedOptions = new Set(["scope", "project-root", "user-home", "codex-home", "profile", "role-rule"]);
  const unknownOption = Object.keys(options).find((name) => !allowedOptions.has(name));
  if (unknownOption) throw new Error(`unknown option "--${unknownOption}"`);
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const common = {
    pluginRoot,
    scope: options.scope ?? "project",
    projectRoot: path.resolve(options["project-root"] ?? process.cwd()),
    userHome: path.resolve(options["user-home"] ?? os.homedir()),
  };
  common.codexHome = resolveCliCodexHome(options, common.userHome);
  common.modelCatalogOptions = {
    roleRulePath: options["role-rule"]
      ? path.resolve(options["role-rule"])
      : path.join(resolveCodexHome(common), "imoten-models.md"),
  };
  if (options.profile) common.profile = JSON.parse(await fs.readFile(options.profile, "utf8"));
  let result;
  if (action === "install") result = await installAgents(common);
  else if (action === "local") {
    result = await configureLocalOperator({
      pluginRoot,
      userHome: common.userHome,
      codexHome: common.codexHome,
      roleRulePath: common.modelCatalogOptions.roleRulePath,
    });
  }
  else if (action === "models") {
    const refreshed = await refreshModelCatalog({ ...common, ...common.modelCatalogOptions });
    const localOperator = await installLocalOperator({ pluginRoot, userHome: common.userHome, codexHome: common.codexHome });
    result = {
      status: "configured",
      provider: refreshed.provider,
      configPath: refreshed.configPath,
      catalogPath: refreshed.catalogPath,
      proofPath: refreshed.proofPath,
      roleRulePath: refreshed.roleRulePath,
      models: refreshed.catalog.models.map((model) => model.slug),
      verifiedRequests: refreshed.receipt.verified_requests,
      localOperator,
    };
  }
  else if (action === "uninstall") result = await uninstallAgents(common);
  else if (action === "scan") result = await scanAgentNames(common);
  else throw new Error("usage: manage-agents.mjs <local|models|install|uninstall|scan> [--scope project|user] [--user-home home] [--codex-home home] [--profile file] [--role-rule file]");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
