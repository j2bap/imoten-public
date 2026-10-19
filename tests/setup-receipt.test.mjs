import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installAgents, uninstallAgents } from "../skills/setup-pstack/scripts/manage-agents.mjs";

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

async function install(options) {
  return installAgents({
    ...options,
    modelCatalogOptions: modelCatalogOptions(options.userHome),
    localOperatorOptions: {
      nodePath: path.join(options.userHome, "bin/node"),
    },
  });
}

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "pstack-receipt-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const projectRoot = path.join(temporary, "project");
  const userHome = path.join(temporary, "home");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(userHome, { recursive: true });
  await fs.mkdir(path.join(userHome, ".codex"), { recursive: true });
  await fs.mkdir(path.join(userHome, "bin"), { recursive: true });
  await fs.writeFile(path.join(userHome, "bin/node"), "#!/bin/sh\necho v24.0.0\n", { mode: 0o700 });
  await fs.writeFile(path.join(userHome, ".codex/config.toml"), `model = "deepseek-flash"\nmodel_provider = "deepseek"\nmodel_reasoning_effort = "high"\n[model_providers.deepseek]\nbase_url = "https://api.deepseek.com"\nenv_key = "DEEPSEEK_API_KEY"\nwire_api = "responses"\n`);
  return { projectRoot, userHome };
}

test("an unchanged project-scoped install is reversible from its hash receipt", async (t) => {
  const { projectRoot, userHome } = await fixture(t);
  const installed = await install({ pluginRoot: root, projectRoot, userHome, scope: "project" });
  const receipt = JSON.parse(await fs.readFile(path.join(projectRoot, installed.receiptPath), "utf8"));
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.scope, "project");
  assert.equal(receipt.files.length, 2);
  assert.ok(receipt.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));

  const removed = await uninstallAgents({ projectRoot, userHome, scope: "project" });
  assert.equal(removed.status, "uninstalled");
  for (const file of receipt.files) {
    await assert.rejects(fs.stat(path.join(projectRoot, file.path)), { code: "ENOENT" });
  }
});

test("a locally modified installed profile requires review and remains untouched", async (t) => {
  const { projectRoot, userHome } = await fixture(t);
  const installed = await install({ pluginRoot: root, projectRoot, userHome, scope: "project" });
  const target = path.join(projectRoot, installed.files[0].path);
  const unchanged = path.join(projectRoot, installed.files[1].path);
  await fs.appendFile(target, "\n# local change\n");

  await assert.rejects(
    install({ pluginRoot: root, projectRoot, userHome, scope: "project" }),
    /review required for divergent Imoten-owned files.*modified.*run uninstall to preserve changed files/,
  );

  const removed = await uninstallAgents({ projectRoot, userHome, scope: "project" });
  assert.equal(removed.status, "uninstalled-with-preserved-files");
  assert.deepEqual(removed.modified, [installed.files[0].path]);
  assert.deepEqual(removed.diagnostics.map(({ path: file, status }) => ({ path: file, status })), [
    { path: installed.files[0].path, status: "modified" },
  ]);
  assert.match(removed.recovery, /Move or remove them before reinstalling/);
  assert.match(await fs.readFile(target, "utf8"), /local change/);
  await assert.rejects(fs.stat(unchanged), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(projectRoot, installed.receiptPath)), { code: "ENOENT" });
  await fs.stat(path.join(projectRoot, removed.archivedReceipt));
});

test("a missing managed profile is diagnosed and uninstall remains recoverable", async (t) => {
  const { projectRoot, userHome } = await fixture(t);
  const installed = await install({ pluginRoot: root, projectRoot, userHome, scope: "project" });
  await fs.rm(path.join(projectRoot, installed.files[0].path));

  await assert.rejects(
    install({ pluginRoot: root, projectRoot, userHome, scope: "project" }),
    /\(missing\).*run uninstall to preserve changed files/,
  );
  const removed = await uninstallAgents({ projectRoot, userHome, scope: "project" });
  assert.equal(removed.status, "uninstalled-with-preserved-files");
  assert.equal(removed.diagnostics[0].status, "missing");
  await fs.stat(path.join(projectRoot, removed.archivedReceipt));
});

test("forged receipt paths cannot select uninstall targets", async (t) => {
  const { projectRoot, userHome } = await fixture(t);
  const installed = await install({ pluginRoot: root, projectRoot, userHome, scope: "project" });
  const receiptPath = path.join(projectRoot, installed.receiptPath);
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  const victim = path.join(projectRoot, ".codex/keep-me.txt");
  await fs.writeFile(victim, "user data\n");
  receipt.files[0].path = ".codex/keep-me.txt";
  receipt.files[0].sha256 = "0".repeat(64);
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  await assert.rejects(uninstallAgents({ projectRoot, userHome, scope: "project" }), /unexpected path/);
  assert.equal(await fs.readFile(victim, "utf8"), "user data\n");
  for (const file of installed.files) await fs.stat(path.join(projectRoot, file.path));
  await fs.stat(receiptPath);
});

test("duplicate and missing role paths invalidate a setup receipt", async (t) => {
  await t.test("duplicate", async (t) => {
    const { projectRoot, userHome } = await fixture(t);
    const installed = await install({ pluginRoot: root, projectRoot, userHome, scope: "project" });
    const receiptPath = path.join(projectRoot, installed.receiptPath);
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    receipt.files[1].path = receipt.files[0].path;
    await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await assert.rejects(uninstallAgents({ projectRoot, userHome, scope: "project" }), /duplicate path/);
  });

  await t.test("missing", async (t) => {
    const { projectRoot, userHome } = await fixture(t);
    const installed = await install({ pluginRoot: root, projectRoot, userHome, scope: "project" });
    const receiptPath = path.join(projectRoot, installed.receiptPath);
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    receipt.files.pop();
    await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await assert.rejects(uninstallAgents({ projectRoot, userHome, scope: "project" }), /missing expected path/);
  });
});

test("user-scoped installs write only beneath the supplied Codex home", async (t) => {
  const { projectRoot, userHome } = await fixture(t);
  const installed = await install({ pluginRoot: root, projectRoot, userHome, scope: "user" });
  assert.ok(installed.files.every((file) => file.path.startsWith("agents/")));
  for (const file of installed.files) await fs.stat(path.join(userHome, ".codex", file.path));
  await assert.rejects(fs.stat(path.join(projectRoot, ".codex/agents")), { code: "ENOENT" });
});
