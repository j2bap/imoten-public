import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installAgents, scanAgentNames } from "../skills/setup-pstack/scripts/manage-agents.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function modelCatalogOptions(userHome) {
  return {
    configPath: path.join(userHome, ".codex/config.toml"),
    catalogPath: path.join(userHome, ".codex/models.json"),
    proofPath: path.join(userHome, ".codex/models.receipt.json"),
    roleRulePath: path.join(userHome, ".codex/imoten-models.md"),
    env: { DEEPSEEK_API_KEY: "secret" },
    now: () => "2026-09-06T00:00:00.000Z",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ object: "list", data: [{ id: "deepseek-flash" }] }), { status: 200 });
      }
      const request = JSON.parse(options.body);
      return new Response(JSON.stringify({ status: "completed", model: request.model, output: [] }), { status: 200 });
    },
  };
}

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "pstack-agents-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const projectRoot = path.join(temporary, "project");
  const userHome = path.join(temporary, "home");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(userHome, { recursive: true });
  await fs.mkdir(path.join(userHome, ".codex"), { recursive: true });
  const bin = path.join(temporary, "bin");
  const nodePath = path.join(bin, "node");
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(nodePath, "#!/bin/sh\necho v24.0.0\n", { mode: 0o700 });
  await fs.writeFile(path.join(userHome, ".codex/config.toml"), `model = "deepseek-flash"\nmodel_provider = "deepseek"\nmodel_reasoning_effort = "high"\n[model_providers.deepseek]\nbase_url = "https://api.deepseek.com"\nenv_key = "DEEPSEEK_API_KEY"\nwire_api = "responses"\n`);
  return { projectRoot, userHome, localOperatorOptions: { nodePath } };
}

test("portable prompt assets replace the legacy top-level personas", async () => {
  await assert.rejects(fs.stat(path.join(root, "agents/poteto-agent.md")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(root, "agents/comment-sicko.md")), { code: "ENOENT" });

  const poteto = await fs.readFile(path.join(root, "skills/poteto-mode/references/poteto-agent-prompt.md"), "utf8");
  const comments = await fs.readFile(path.join(root, "skills/no-comments/references/comment-sicko-prompt.md"), "utf8");
  assert.match(poteto, /Treat the parent brief as the task and authority contract/);
  assert.match(poteto, /scope is self-contained/);
  assert.match(poteto, /Otherwise, read applicable repository instructions/);
  assert.match(poteto, /Do not start another delegate/);
  assert.doesNotMatch(poteto, /Keep one Poteto delegate per parent task/);
  assert.ok(poteto.trim().split(/\s+/u).length <= 120);
  assert.match(comments, /Yes\.\.\. Ha ha ha\.\.\. Yes!/);
});

test("project-scoped templates render supported Codex agent TOML", async (t) => {
  const { projectRoot, userHome, localOperatorOptions } = await fixture(t);
  const result = await installAgents({ pluginRoot: root, projectRoot, userHome, scope: "project", modelCatalogOptions: modelCatalogOptions(userHome), localOperatorOptions });

  assert.equal(result.status, "installed");
  assert.equal(result.files.length, 2);
  assert.equal(result.localOperator.launcherPath, path.join(userHome, ".codex/bin/imoten-local-operator"));
  assert.match(await fs.readFile(path.join(userHome, ".codex/rules/default.rules"), "utf8"), /# imoten-local-operator:begin/u);
  for (const file of result.files) {
    assert.match(file.path, /^\.codex\/agents\/imoten-/);
    const content = await fs.readFile(path.join(projectRoot, file.path), "utf8");
    assert.match(content, /^name = "imoten-/m);
    assert.match(content, /^description = /m);
    assert.match(content, /^model = "deepseek-flash"$/m);
    assert.match(content, /^model_reasoning_effort = "high"$/m);
    assert.equal(file.model_policy.source, "direct-provider");
    assert.match(content, /^developer_instructions = """/m);
    assert.doesNotMatch(content, /\{\{PROMPT\}\}/);
  }
  const potetoProfile = await fs.readFile(
    path.join(projectRoot, ".codex/agents/imoten-poteto-agent.toml"),
    "utf8",
  );
  assert.match(potetoProfile, /one delegate per independent lane, with at most two in flight/);
  assert.doesNotMatch(potetoProfile, /one per parent task/);
  const commentProfile = await fs.readFile(
    path.join(projectRoot, ".codex/agents/imoten-comment-sicko.toml"),
    "utf8",
  );
  assert.match(commentProfile, /^sandbox_mode = "read-only"$/m);
  assert.match(commentProfile, /Do not use connectors or external network tools/);
});

test("duplicate TOML names are detected across project and user layers regardless of filename", async (t) => {
  const { projectRoot, userHome, localOperatorOptions } = await fixture(t);
  await fs.mkdir(path.join(projectRoot, ".codex/agents"), { recursive: true });
  await fs.mkdir(path.join(userHome, ".codex/agents"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".codex/agents/first.toml"), "name = 'same-name'\n");
  await fs.writeFile(path.join(userHome, ".codex/agents/completely-different.toml"), 'name = "same-name"\n');

  const inventory = await scanAgentNames({ projectRoot, userHome });
  assert.equal(inventory.duplicates.length, 1);
  assert.equal(inventory.duplicates[0].name, "same-name");
  await assert.rejects(
    installAgents({ pluginRoot: root, projectRoot, userHome, scope: "project", modelCatalogOptions: modelCatalogOptions(userHome), localOperatorOptions }),
    /duplicate custom-agent name "same-name"/,
  );
});

test("an existing differently named file with an Imoten agent name is never overwritten", async (t) => {
  const { projectRoot, userHome, localOperatorOptions } = await fixture(t);
  await fs.mkdir(path.join(userHome, ".codex/agents"), { recursive: true });
  const unrelated = path.join(userHome, ".codex/agents/my-local-agent.toml");
  await fs.writeFile(unrelated, 'name = "imoten-poteto-agent"\ndeveloper_instructions = "mine"\n');

  await assert.rejects(
    installAgents({ pluginRoot: root, projectRoot, userHome, scope: "project", modelCatalogOptions: modelCatalogOptions(userHome), localOperatorOptions }),
    /custom-agent name "imoten-poteto-agent" is already owned by/,
  );
  assert.match(await fs.readFile(unrelated, "utf8"), /mine/);
});

test("install rejects a custom pair that the direct provider did not select", async (t) => {
  const { projectRoot, userHome, localOperatorOptions } = await fixture(t);
  await assert.rejects(
    installAgents({
      pluginRoot: root,
      projectRoot,
      userHome,
      scope: "project",
      profile: { "imoten-poteto-agent": { model: "deepseek-pro", reasoning_effort: "high" } },
      modelCatalogOptions: modelCatalogOptions(userHome),
      localOperatorOptions,
    }),
    /direct DeepSeek setup supports the selected pair only: "deepseek-flash" at "high"/,
  );
  await assert.rejects(fs.stat(path.join(projectRoot, ".codex")), { code: "ENOENT" });
});

test("install stops before writing when the model catalog is unavailable", async (t) => {
  const { projectRoot, userHome, localOperatorOptions } = await fixture(t);
  await assert.rejects(
    installAgents({ pluginRoot: root, projectRoot, userHome, scope: "project", modelCatalogOptions: { ...modelCatalogOptions(userHome), fetchImpl: async () => { throw new Error("connection refused"); } }, localOperatorOptions }),
    /connection refused/,
  );
  await assert.rejects(fs.stat(path.join(projectRoot, ".codex")), { code: "ENOENT" });
});
