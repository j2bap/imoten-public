import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { IMPLICIT_SKILLS } from "../scripts/validate-plugin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { cases } = JSON.parse(await fs.readFile(path.join(root, "evals/cases/implicit-triggers.yaml"), "utf8"));

test("every implicit skill has one positive and at least one negative trigger case", () => {
  const positives = cases.filter((entry) => entry.polarity === "positive").map((entry) => entry.skill);
  assert.deepEqual([...positives].sort(), [...IMPLICIT_SKILLS].sort());
  for (const skill of IMPLICIT_SKILLS) {
    assert.ok(cases.some((entry) => entry.skill === skill && entry.polarity === "negative"), `${skill} lacks a negative case`);
  }
  assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length);
});

test("trigger cases use natural prompts and resolvable owners", async () => {
  for (const entry of cases) {
    assert.ok(["positive", "negative"].includes(entry.polarity), entry.id);
    assert.doesNotMatch(entry.input, /\$/u, `${entry.id} names a skill explicitly`);
    assert.ok(entry.reason.length > 20, entry.id);
    await fs.access(path.join(root, entry.expected.owner));
    const expected = entry.expected.implicit_skill;
    assert.ok(expected === null || IMPLICIT_SKILLS.has(expected), `${entry.id} expects a non-implicit skill`);
    if (entry.polarity === "positive") {
      assert.equal(expected, entry.skill, entry.id);
      assert.equal(entry.expected.owner, `skills/${entry.skill}/SKILL.md`, entry.id);
    } else {
      assert.notEqual(expected, entry.skill, entry.id);
      assert.notEqual(entry.expected.owner, `skills/${entry.skill}/SKILL.md`, entry.id);
    }
  }
});
