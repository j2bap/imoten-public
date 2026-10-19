import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  buildProfileEnvironment,
  inspectProfile,
  parseCodexIdentity,
  resolveProfile,
} from "../skills/setup-pstack/scripts/imoten-profile.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const script = path.join(root, "skills/setup-pstack/scripts/imoten-profile.mjs");

test("profile resolution uses the isolated personal home and rejects unknown profiles", () => {
  const userHome = "/tmp/imoten-profile-user";
  assert.equal(resolveProfile("personal", { userHome }).codexHome, "/tmp/imoten-profile-user/.codex-personal");
  assert.equal(resolveProfile("personal", { userHome, env: { IMOTEN_PERSONAL_CODEX_HOME: "/tmp/override" } }).codexHome, "/tmp/override");
  assert.throws(() => resolveProfile("work", { userHome }), /profile must be one of personal/u);
});
test("profile identity parses only top-level Codex settings", () => {
  assert.deepEqual(parseCodexIdentity(`model = "deepseek-flash"
model_provider = "deepseek"
model_reasoning_effort = "high"
model_catalog_json = "/tmp/catalog.json"
default_permissions = "naru"
approvals_reviewer = "auto_review"

[model_providers.deepseek]
base_url = "https://api.deepseek.com"
`), {
    provider: "deepseek",
    model: "deepseek-flash",
    reasoning_effort: "high",
    model_catalog_json: "/tmp/catalog.json",
    default_permissions: "naru",
    approvals_reviewer: "auto_review",
  });
});

test("personal environment clears inherited provider variables", () => {
  const environment = buildProfileEnvironment("personal", {
    PATH: "/bin",
    OPENAI_API_KEY: "inherited-secret",
    OPENAI_BASE_URL: "http://inherited-proxy",
  }, { userHome: "/tmp/user" });
  assert.equal(environment.CODEX_HOME, "/tmp/user/.codex-personal");
  assert.equal(environment.IMOTEN_ACTIVE_CODEX_HOME, "/tmp/user/.codex-personal");
  assert.equal(environment.PATH, "/bin");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.OPENAI_BASE_URL, undefined);
});

test("doctor accepts the personal native provider when its role map exists", async () => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-profiles-"));
  const personal = path.join(userHome, ".codex-personal");
  await fs.mkdir(personal, { recursive: true });
  await fs.writeFile(path.join(personal, "config.toml"), `model = "gpt-5.6-luna"
model_reasoning_effort = "max"
`);
  const missingRoleMap = await inspectProfile("personal", { userHome });
  assert.equal(missingRoleMap.identity_status, "review-required");
  assert.deepEqual(missingRoleMap.warnings, ["imoten-models.md is missing"]);
  await fs.writeFile(path.join(personal, "imoten-models.md"), "# native roles\n");

  const personalReport = await inspectProfile("personal", { userHome });
  assert.equal(personalReport.identity_status, "configured");
  assert.equal(personalReport.provider, "native-default");
  assert.deepEqual(personalReport.warnings, []);
});

test("run applies the selected profile environment without using a shell alias", async () => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-profile-run-"));
  const command = path.join(userHome, "capture.mjs");
  const output = path.join(userHome, "output.json");
  await fs.writeFile(command, `import { promises as fs } from "node:fs";
await fs.writeFile(process.env.IMOTEN_CAPTURE_OUTPUT, JSON.stringify({ codexHome: process.env.CODEX_HOME, activeCodexHome: process.env.IMOTEN_ACTIVE_CODEX_HOME, openai: process.env.OPENAI_API_KEY ?? null, openaiBaseUrl: process.env.OPENAI_BASE_URL ?? null }));
`);
  const env = {
    ...process.env,
    HOME: userHome,
    IMOTEN_PERSONAL_CODEX_HOME: path.join(userHome, ".personal"),
    IMOTEN_PERSONAL_CODEX_COMMAND: process.execPath,
    IMOTEN_CAPTURE_OUTPUT: output,
    OPENAI_API_KEY: "do-not-forward",
    OPENAI_BASE_URL: "do-not-forward",
  };
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "run", "--profile", "personal", "--", command], { cwd: root, env, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  assert.equal(result, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), {
    codexHome: path.join(userHome, ".personal"),
    activeCodexHome: path.join(userHome, ".personal"),
    openai: null,
    openaiBaseUrl: null,
  });
});
