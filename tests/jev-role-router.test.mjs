import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultRoleMapPath, loadRoleMap, routeAndRecord, resolveJevRoute } from "../skills/poteto-mode/scripts/resolve-jev-route.mjs";

const ROLE_MAP = new Map([
  ["Fast profile", { model: "gpt-5.6-luna", reasoning_effort: "medium" }],
  ["Feature delegate", { model: "gpt-5.6-luna", reasoning_effort: "max" }],
  ["Hardest tasks", { model: "gpt-5.6-terra", reasoning_effort: "max" }],
]);

const decision = (choice, confidence, extra = {}) => ({
  model: "jev-1.13.0",
  state: { task: "route a bounded Imoten task", role_candidates: ["Fast profile", "Feature delegate", "Hardest tasks"], ...extra },
  question: { type: "choice", instructions: "Choose the trigger role for routing." },
  answer: { type: "choice", choice, confidence, probabilities: { [choice]: 1 } },
});

test("high-confidence Jev role maps to the exact model and effort pair", () => {
  assert.deepEqual(resolveJevRoute(decision("Feature delegate", 0.97), { roleMap: ROLE_MAP, requirePair: true }), {
    role_alias: "Feature delegate",
    model: "gpt-5.6-luna",
    reasoning_effort: "max",
    route_allowed: true,
    gate: "act",
    confidence: 0.97,
    review_required: false,
    action: "route to Feature delegate",
  });
});

test("medium-confidence Jev role routes but remains flagged for review", () => {
  const route = resolveJevRoute(decision("Feature delegate", 0.79), { roleMap: ROLE_MAP, requirePair: true });
  assert.equal(route.role_alias, "Feature delegate");
  assert.equal(route.model, "gpt-5.6-luna");
  assert.equal(route.reasoning_effort, "max");
  assert.equal(route.route_allowed, true);
  assert.equal(route.gate, "review");
  assert.equal(route.review_required, true);
});

test("low confidence, missing confidence, and unknown choices cannot route", () => {
  for (const input of [decision("Feature delegate", 0.49), decision("Feature delegate", null), decision("no_match", 1)]) {
    const route = resolveJevRoute(input, { roleMap: ROLE_MAP, requirePair: true });
    assert.equal(route.route_allowed, false);
    assert.equal(route.role_alias, null);
  }
});

test("irreversible routing needs high confidence and human confirmation", () => {
  assert.equal(resolveJevRoute(decision("Hardest tasks", 0.95, { destructive: true }), { roleMap: ROLE_MAP, requirePair: true }).route_allowed, false);
  assert.equal(resolveJevRoute(decision("Hardest tasks", 0.95, { destructive: true, human_confirmation: true }), { roleMap: ROLE_MAP, requirePair: true }).route_allowed, true);
});

test("routing records the gated decision", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-jev-route-"));
  const logPath = path.join(directory, "decisions.jsonl");
  const route = await routeAndRecord(decision("Feature delegate", 0.79), { roleMap: ROLE_MAP, logPath, now: new Date("2026-09-17T20:00:00.000Z") });
  assert.equal(route.role_alias, "Feature delegate");
  assert.equal(route.model, "gpt-5.6-luna");
  const record = JSON.parse(await fs.readFile(logPath, "utf8"));
  assert.equal(record.gate, "review");
  assert.equal(record.action, "route to Feature delegate and flag the decision for review");
});

test("a Jev choice outside the workflow candidates cannot route", () => {
  const route = resolveJevRoute(decision("Bug-fix delegate", 0.99), { roleMap: ROLE_MAP, requirePair: true });
  assert.equal(route.route_allowed, false);
  assert.equal(route.gate, "escalate");
  assert.equal(route.role_alias, null);
});

test("a missing proven pair blocks direct model dispatch", () => {
  const route = resolveJevRoute(decision("Hardest tasks", 0.99), {
    roleMap: new Map([["Feature delegate", ROLE_MAP.get("Feature delegate")]]),
    requirePair: true,
  });
  assert.equal(route.route_allowed, false);
  assert.equal(route.gate, "role-map-required");
  assert.equal(route.model, null);
});

test("direct model routing requires bounded role candidates", () => {
  const input = decision("moderate", 0.99);
  delete input.state.role_candidates;
  assert.throws(
    () => resolveJevRoute(input, { roleMap: ROLE_MAP, requirePair: true, requireCandidates: true }),
    /decision\.role_candidates is required/,
  );
});

test("direct routing loads the generated Role map format", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-jev-role-map-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "imoten-models.md");
  await fs.writeFile(file, `# Imoten model roles\n\n## Role map\n\n| Role | Model | Reasoning effort |\n| --- | --- | --- |\n| Feature delegate | \`gpt-5.6-luna\` | \`max\` |\n`);
  const roleMap = await loadRoleMap(file);
  const route = resolveJevRoute(decision("Feature delegate", 0.97), { roleMap, requirePair: true });
  assert.equal(route.model, "gpt-5.6-luna");
  assert.equal(route.reasoning_effort, "max");
});

test("with no provider, routing uses the first bounded role candidate", () => {
  const input = { ...decision("Feature delegate", null), provider: "none", answer: null };
  const route = resolveJevRoute(input, { roleMap: ROLE_MAP, requirePair: true });
  assert.equal(route.role_alias, "Fast profile");
  assert.equal(route.model, "gpt-5.6-luna");
  assert.equal(route.reasoning_effort, "medium");
  assert.equal(route.gate, "default-role");
  assert.equal(route.review_required, true);
  const destructive = resolveJevRoute({ ...input, state: { ...input.state, destructive: true } }, { roleMap: ROLE_MAP, requirePair: true });
  assert.equal(destructive.route_allowed, false);
  const noCandidates = { ...input, state: { task: "route" } };
  assert.throws(() => resolveJevRoute(noCandidates, { roleMap: ROLE_MAP }), /role_candidates is required/);
});

test("the role map path comes from the active home and never guesses ~/.codex", () => {
  assert.equal(defaultRoleMapPath({ IMOTEN_ACTIVE_CODEX_HOME: "/tmp/personal", CODEX_HOME: "/tmp/work" }), "/tmp/personal/imoten-models.md");
  assert.equal(defaultRoleMapPath({ CODEX_HOME: "/tmp/work" }), "/tmp/work/imoten-models.md");
  assert.equal(defaultRoleMapPath({ IMOTEN_MODEL_ROLE_RULE: "/tmp/rule.md" }), "/tmp/rule.md");
  assert.throws(() => defaultRoleMapPath({}), /active Codex home is unknown/);
});

test("the resolver CLI fails closed without an active Codex home", () => {
  const env = { ...process.env };
  for (const name of ["IMOTEN_ACTIVE_CODEX_HOME", "CODEX_HOME", "IMOTEN_MODEL_ROLE_RULE", "JEV_DECISION_LOG"]) delete env[name];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../skills/poteto-mode/scripts/resolve-jev-route.mjs", import.meta.url))], {
    encoding: "utf8",
    env: { ...env, HOME: os.tmpdir() },
    input: JSON.stringify(decision("Fast profile", 0.99)),
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /active Codex home is unknown/);
});
