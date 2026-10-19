import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the release and Tracen scripts use the canonical verification commands", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.scripts.test, "npm run verify:release");
  assert.equal(manifest.scripts.tracen, "npm run verify:offline");
  assert.equal(manifest.scripts.verify, "npm run verify:offline");
  assert.match(manifest.scripts["verify:release"], /npm run verify:offline/);
  assert.match(manifest.scripts["verify:release"], /npm run test:installed/);
  assert.match(manifest.scripts["test:installed"], /IMOTEN_RUN_INSTALLED_SMOKE=1/);
});

test("owned links and inherited provenance name their actual repositories", async () => {
  const plugin = JSON.parse(await fs.readFile(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
  const marker = JSON.parse(await fs.readFile(path.join(root, "automations", "benny", "schemas", "marker.schema.json"), "utf8"));
  const state = JSON.parse(await fs.readFile(path.join(root, "automations", "benny", "schemas", "state.schema.json"), "utf8"));
  const notice = await fs.readFile(path.join(root, "NOTICE"), "utf8");

  assert.equal(plugin.repository, "https://github.com/j2bap/imoten-public");
  assert.match(marker.$id, /^https:\/\/github\.com\/j2bap\/imoten-public\//);
  assert.match(state.$id, /^https:\/\/github\.com\/j2bap\/imoten-public\//);
  assert.match(notice, /https:\/\/github\.com\/Aqua-123\/pstack-for-codex/);
  assert.doesNotMatch(`${marker.$id}\n${state.$id}\n${notice}`, /github\.com\/Aqua-123\/imoten/);
});
