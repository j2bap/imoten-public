import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { reviewUpstream } from "../scripts/review-upstream.mjs";
import {
  buildCompatibilityMap,
  buildLock,
  inventoryDirectory,
  sha256,
} from "../scripts/generate-compatibility-report.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/review-upstream.mjs");

test("review prints evidence before blocking unrecorded upstream changes", async (context) => {
  const fixture = await createFixture(context);
  const before = await provenanceSnapshot(fixture.derived);
  const result = await runCli(fixture, fixture.changedCommit, true);

  assert.equal(result.code, 1);
  assert.match(result.stdout, new RegExp(`Locked commit: ${fixture.lockedCommit}`));
  assert.match(result.stdout, new RegExp(`Candidate commit: ${fixture.changedCommit}`));
  assert.match(result.stdout, /\| changed\.md \| changed \|.*\| adapted \| changed\.md \| required \|/);
  assert.match(result.stdout, /\| renamed-new\.md \| added \|.*\| unclassified \| - \| required \|/);
  assert.match(result.stdout, /\| renamed-old\.md \| deleted-or-renamed \|.*\| adapted \| renamed-old\.md \| required \|/);
  assert.match(result.stdout, /\| binary\.bin \| changed \|/);
  assert.match(result.stdout, /\| added\.md \| added \|/);
  assert.match(result.stdout, /\| deleted\.md \| deleted-or-renamed \|/);
  assert.match(result.stdout, /\|.*\| required \|/);
  assert.match(result.stdout, /Blocking findings:/);
  assert.match(result.stdout, /GIT binary patch/);
  assert.doesNotMatch(result.stdout, /outside\.txt/);
  assert.deepEqual(await provenanceSnapshot(fixture.derived), before);
  assert.deepEqual(await fs.readdir(fixture.tempParent), []);
});

test("review accepts a recorded changed disposition", async (context) => {
  const fixture = await createFixture(context);
  const mapPath = path.join(fixture.derived, "compatibility", "pstack-map.json");
  const map = JSON.parse(await fs.readFile(mapPath, "utf8"));
  const entry = map.entries.find((item) => item.upstreamPath === "changed.md");
  entry.refreshDisposition = {
    upstreamSha256: sha256("changed v2\n"),
    disposition: "port",
    rationale: "The upstream change is reviewed.",
  };
  await fs.writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  const before = await provenanceSnapshot(fixture.derived);

  const result = await runCli(fixture, fixture.recordedCommit, false);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /\| changed\.md \| changed \|/);
  assert.match(result.stdout, /\|.*\| recorded \|/);
  assert.deepEqual(await provenanceSnapshot(fixture.derived), before);
  assert.deepEqual(await fs.readdir(fixture.tempParent), []);
});

test("review succeeds when the candidate is unchanged", async (context) => {
  const fixture = await createFixture(context);
  const result = await reviewUpstream({
    root: fixture.derived,
    source: fixture.repository,
    commit: fixture.lockedCommit,
    temporaryParent: fixture.tempParent,
  });

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(await fs.readdir(fixture.tempParent), []);
});

test("review rejects a short SHA before it creates a checkout", async (context) => {
  const fixture = await createFixture(context);
  const result = await runCli(fixture, fixture.lockedCommit.slice(0, 12), false);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /--commit must be a full 40-character hexadecimal SHA/);
  assert.deepEqual(await fs.readdir(fixture.tempParent), []);
});

async function createFixture(context) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pstack-upstream-review-test-"));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const repository = path.join(temporary, "plugins");
  const derived = path.join(temporary, "derived");
  const tempParent = path.join(temporary, "checkout");
  await fs.mkdir(path.join(repository, "pstack"), { recursive: true });
  await fs.mkdir(path.join(derived, "compatibility"), { recursive: true });
  await fs.mkdir(tempParent);
  await git(repository, ["init", "--initial-branch=main"]);
  await git(repository, ["config", "user.name", "Pstack Test"]);
  await git(repository, ["config", "user.email", "pstack@example.invalid"]);
  await git(repository, ["config", "commit.gpgsign", "false"]);
  await git(repository, ["config", "core.fsmonitor", "false"]);
  await fs.writeFile(path.join(repository, "pstack", "changed.md"), "changed v1\n");
  await fs.writeFile(path.join(repository, "pstack", "deleted.md"), "deleted\n");
  await fs.writeFile(path.join(repository, "pstack", "renamed-old.md"), "rename me\n");
  await fs.writeFile(path.join(repository, "pstack", "binary.bin"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(repository, "outside.txt"), "outside v1\n");
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "locked"]);
  const lockedCommit = await git(repository, ["rev-parse", "HEAD"]);
  const lock = buildLock(await inventoryDirectory(path.join(repository, "pstack")), {
    repository,
    subdirectory: "pstack",
    commit: lockedCommit,
    version: "1.0.0",
    retrievedAt: "2026-09-03",
  });
  const map = buildCompatibilityMap(lock);
  await fs.writeFile(path.join(derived, "upstream.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  await fs.writeFile(path.join(derived, "compatibility", "pstack-map.json"), `${JSON.stringify(map, null, 2)}\n`);
  await fs.writeFile(path.join(derived, "compatibility", "report.md"), "locked report\n");

  await fs.writeFile(path.join(repository, "pstack", "changed.md"), "changed upstream\n");
  await fs.rm(path.join(repository, "pstack", "deleted.md"));
  await fs.rename(path.join(repository, "pstack", "renamed-old.md"), path.join(repository, "pstack", "renamed-new.md"));
  await fs.writeFile(path.join(repository, "pstack", "added.md"), "added\n");
  await fs.writeFile(path.join(repository, "pstack", "binary.bin"), Buffer.from([3, 4, 5]));
  await fs.writeFile(path.join(repository, "outside.txt"), "outside v2\n");
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "unrecorded changes"]);
  const changedCommit = await git(repository, ["rev-parse", "HEAD"]);

  await git(repository, ["checkout", "--detach", lockedCommit]);
  await fs.writeFile(path.join(repository, "pstack", "changed.md"), "changed v2\n");
  await git(repository, ["add", "pstack/changed.md"]);
  await git(repository, ["commit", "-m", "recorded change"]);
  const recordedCommit = await git(repository, ["rev-parse", "HEAD"]);

  return { repository, derived, tempParent, lockedCommit, changedCommit, recordedCommit };
}

async function runCli(fixture, commit, patch) {
  return await new Promise((resolve, reject) => {
    const args = [
      script,
      "--root", fixture.derived,
      "--source", fixture.repository,
      "--commit", commit,
      "--temporary-parent", fixture.tempParent,
    ];
    if (patch) args.push("--patch");
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

async function git(cwd, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`git exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function provenanceSnapshot(root) {
  return {
    lock: await fs.readFile(path.join(root, "upstream.lock.json"), "utf8"),
    map: await fs.readFile(path.join(root, "compatibility", "pstack-map.json"), "utf8"),
    report: await fs.readFile(path.join(root, "compatibility", "report.md"), "utf8"),
  };
}
