import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_SKILL_COUNT,
  IMPLICIT_SKILLS,
  SKILL_DESCRIPTION_LIMIT,
  assessSkillCapacity,
  listSkillRecords,
  parseFrontmatter,
  validatePlugin,
} from "../scripts/validate-plugin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all skills are discoverable, unique, standard, and explicit-only unless listed as implicit", async () => {
  const records = await listSkillRecords(root);
  assert.equal(records.length, EXPECTED_SKILL_COUNT);
  assert.equal(new Set(records.map((record) => record.name)).size, EXPECTED_SKILL_COUNT);

  for (const record of records) {
    assert.deepEqual(Object.keys(record.frontmatter).sort(), ["description", "name"]);
    assert.ok(record.frontmatter.description.length <= SKILL_DESCRIPTION_LIMIT);
    assert.match(record.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.deepEqual(Object.keys(record.metadata.policy), ["allow_implicit_invocation"]);
    assert.equal(record.metadata.policy.allow_implicit_invocation, IMPLICIT_SKILLS.has(record.name));
    assert.match(record.metadata.interface.default_prompt, new RegExp(`\\$(?:imoten:)?${record.name}\\b`));
  }
});

test("Poteto root stays a small progressive-disclosure router", async () => {
  const content = await fs.readFile(path.join(root, "skills/poteto-mode/SKILL.md"), "utf8");
  const { body } = parseFrontmatter(content, "skills/poteto-mode/SKILL.md");
  const words = body.trim().split(/\s+/u).filter(Boolean);

  assert.ok(words.length <= 500, `Poteto root has ${words.length} words`);
  assert.match(body, /references\/task-routing\.md/);
  assert.match(body, /references\/codex-agent-runtime\.md/);
  assert.doesNotMatch(body, /^## (?:Principles|Playbooks|Writing the reply|Comments)$/mu);
});

test("capacity fallback is deterministic and never drops a skill", async () => {
  const report = await validatePlugin(root, { probeBun: false });
  const records = await listSkillRecords(root);
  assert.deepEqual(report.errors, []);
  assert.equal(report.inventory.discovered, records.length);
  assert.equal(report.inventory.capacity.evaluated, records.length);
  assert.equal(
    records.every((record) => `${report.plugin}:${record.name}`.length <= report.inventory.capacity.identityLimit),
    true,
  );
  assert.equal(report.inventory.capacity.status, "fits-with-normalized-aliases");
  assert.deepEqual(report.inventory.capacity.aliases, {
    "principle-migrate-callers-then-delete-legacy-apis": "principle-migrate-callers-delete-legacy-apis",
    "principle-separate-before-serializing-shared-state": "principle-separate-shared-state",
  });
  assert.equal(report.inventory.capacity.dropped.length, 0);
});

test("capacity results are computed from the plugin identity and discovered records", () => {
  const overLimitName = "x".repeat(65);
  const report = assessSkillCapacity("imoten", [
    { directory: "long-upstream-name", name: "short-name" },
    { directory: overLimitName, name: overLimitName },
  ]);
  assert.equal(report.evaluated, 2);
  assert.equal(report.status, "exceeds-identity-limit");
  assert.deepEqual(report.aliases, { "long-upstream-name": "short-name" });
  assert.deepEqual(report.dropped, [overLimitName]);
});

test("a skill has one trigger path: explicit, routed, or implicit", async () => {
  const routing = await fs.readFile(path.join(root, "skills/poteto-mode/references/task-routing.md"), "utf8");
  for (const name of IMPLICIT_SKILLS) {
    assert.doesNotMatch(routing, new RegExp("\\$" + name + "\\b"), `${name} is both implicit and routed`);
  }
  for (const name of ["poteto-mode", "setup-pstack", "thermos", "thermo-nuclear-review", "advisor", "dev-review"]) {
    assert.equal(IMPLICIT_SKILLS.has(name), false, name);
  }
});
