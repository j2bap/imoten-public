import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EXPECTED_SKILL_COUNT, listSkillRecords } from "../scripts/validate-plugin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));

test("fork and upstream identities remain separate", async () => {
  const [manifest, packageJson, lock] = await Promise.all([
    readJson(".codex-plugin/plugin.json"),
    readJson("package.json"),
    readJson("upstream.lock.json"),
  ]);
  assert.equal(manifest.version.split("+", 1)[0], packageJson.version);
  assert.equal(packageJson.version, "0.2.0");
  assert.equal(lock.source.version, "0.15.28");
  assert.equal(lock.source.commit, "d457567332aa6989e753ea289f30ea2bfbc80bc0");
  assert.equal(lock.inventory.fileCount, 172);
});

test("inventory accounts for every upstream file, skill, and playbook", async () => {
  const [lock, compatibility, records] = await Promise.all([
    readJson("upstream.lock.json"),
    readJson("compatibility/pstack-map.json"),
    listSkillRecords(root),
  ]);
  assert.equal(new Set(lock.files.map((entry) => entry.path)).size, 172);
  assert.equal(compatibility.entries.length, 172);
  assert.deepEqual(
    new Set(compatibility.entries.map((entry) => entry.upstreamPath)),
    new Set(lock.files.map((entry) => entry.path)),
  );

  const upstreamSkills = lock.files
    .map((entry) => entry.path.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1])
    .filter(Boolean)
    .sort();
  assert.equal(upstreamSkills.length, 56);
  assert.equal(records.length, EXPECTED_SKILL_COUNT);
  const localExtensions = new Set([
    "dev-review",
    "thermo-nuclear-code-quality-review",
    "advisor",
    "check-agent-compatibility",
    "check-compiler-errors",
    "cli-for-agents",
    "control-cli",
    "control-ui",
    "deslop",
    "fix-ci",
    "fix-merge-conflicts",
    "get-pr-comments",
    "loop-on-ci",
    "make-pr-easy-to-review",
    "new-branch-and-pr",
    "pr-review-walkthrough",
    "review-and-ship",
    "run-smoke-tests",
    "thermo-nuclear-review",
    "thermos",
    "verify-this",
    "weekly-review",
    "what-did-i-get-done",
    "tracen",
    "umamusume-naming",
    "yeon",
  ]);
  assert.deepEqual(
    records.map((record) => record.directory)
      .filter((name) => name !== "setup-benny" && !localExtensions.has(name))
      .sort(),
    upstreamSkills.filter((name) => name !== "make-bot-ui"),
  );
  assert.equal(records.filter((record) => record.directory === "setup-benny").length, 1);
  assert.deepEqual(records.map((record) => record.directory).filter((name) => localExtensions.has(name)).sort(), [...localExtensions].sort());

  const playbooks = lock.files
    .map((entry) => entry.path.match(/^skills\/poteto-mode\/playbooks\/([^/]+)\.md$/)?.[1])
    .filter(Boolean)
    .sort();
  assert.equal(playbooks.length, 23);
});

test("behavioral coverage maps all 55 active upstream skills and all 23 playbooks", async () => {
  const [lock, coverage, representative] = await Promise.all([
    readJson("upstream.lock.json"),
    readJson("evals/cases/coverage.yaml"),
    readJson("evals/cases/representative.yaml"),
  ]);
  const upstreamSkills = lock.files
    .map((entry) => entry.path.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1])
    .filter(Boolean)
    .filter((name) => name !== "make-bot-ui")
    .sort();
  const playbooks = lock.files
    .map((entry) => entry.path.match(/^skills\/poteto-mode\/playbooks\/([^/]+)\.md$/)?.[1])
    .filter(Boolean)
    .sort();
  assert.deepEqual(coverage.upstream_skills.map((entry) => entry.id.slice(6)).sort(), upstreamSkills);
  assert.deepEqual(coverage.playbooks.map((entry) => entry.id.slice(9)).sort(), playbooks);
  for (const entry of [...coverage.upstream_skills, ...coverage.playbooks]) {
    assert.equal(entry.verdict, "passed-offline-contract");
    assert.match(entry.disposition, /explicit-only/);
    assert.ok(entry.positive_outcome.length > 20);
    for (const dimension of ["workflow", "role", "authority", "evidence", "stop_condition"]) {
      assert.equal(entry.grades[dimension], "required");
    }
    for (const boundary of ["authority", "capability", "negative-trigger"]) {
      assert.ok(entry.boundaries.includes(boundary), `${entry.id} lacks ${boundary}`);
    }
  }
  assert.deepEqual(
    new Set(representative.cases.map((entry) => entry.category)),
    new Set(["direct", "indirect", "incomplete-input", "negative-trigger", "unsupported-action", "setup", "hook", "connector-boundary"]),
  );
  for (const entry of representative.cases) {
    assert.deepEqual(Object.keys(entry.expected).sort(), ["authority", "evidence", "role", "stop_condition", "workflow"]);
  }
});

test("repository contains no abandoned host or generated-profile artifacts", async () => {
  const prohibited = [
    ".cursor-plugin",
    ".cursor",
    ".codex/agents",
    ".codex/plugins",
    ".codex/automations",
    "agents",
    "worktrees",
  ];
  for (const relative of prohibited) {
    const stat = await fs.stat(path.join(root, relative)).catch(() => null);
    assert.equal(stat, null, `${relative} must not ship`);
  }
});

test("Tracen keeps temporary and generated paths out of tracked source", async () => {
  const [gitIgnore, codexIgnore] = await Promise.all([
    fs.readFile(path.join(root, ".gitignore"), "utf8"),
    fs.readFile(path.join(root, ".codexignore"), "utf8"),
  ]);
  const gitIgnored = new Set(gitIgnore.split(/\r?\n/));
  const codexIgnored = new Set(codexIgnore.split(/\r?\n/));
  for (const artifactRoot of [".audit/", ".worktrees/", "apps/", "deploy/"]) {
    assert.equal(gitIgnored.has(artifactRoot), true);
    assert.equal(codexIgnored.has(artifactRoot), true);
  }

  const tracked = execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  const prohibited = [
    /^\.audit\//,
    /^\.worktrees\//,
    /^apps\//,
    /^deploy\//,
    /(?:^|\/)(?:node_modules|coverage|dist|build|\.tmp|\.temp)\//,
    /(?:^|\/)\.DS_Store$/,
    /\.log$/,
  ];

  assert.deepEqual(tracked.filter((file) => prohibited.some((pattern) => pattern.test(file))), []);
});
