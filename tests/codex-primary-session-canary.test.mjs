import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const canary = path.join(root, "skills/setup-pstack/scripts/codex-primary-session-canary.mjs");
const fakeServer = path.join(root, "tests/fixtures/fake-codex-app-server.mjs");

test("canary verifies steering, compaction, and per-turn usage offline", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "imoten-canary-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const bin = path.join(temporary, "bin");
  await mkdir(bin);
  await chmod(fakeServer, 0o700);
  await symlink(fakeServer, path.join(bin, "codex"));
  const output = path.join(temporary, "report.json");
  const requests = path.join(temporary, "requests.jsonl");
  const result = await execFileAsync(process.execPath, [canary,
    "--mode", "both", "--pressure-turns", "2", "--pressure-bytes", "1000",
    "--turn-timeout-ms", "10000", "--require-applied", "--require-compaction",
    "--output", output,
  ], {
    cwd: temporary,
    env: { ...process.env, FAKE_APP_SERVER_REQUESTS: requests, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    timeout: 60_000,
  });
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(JSON.parse(result.stdout), report);
  assert.equal(report.steering.status, "completed");
  assert.equal(report.steering.steer_accepted, true);
  assert.equal(report.steering.applied_marker_seen, true);
  assert.equal(report.pressure.status, "completed");
  assert.deepEqual(report.pressure.turns.map((turn) => turn.input_tokens), [1001, 1002]);
  assert.equal(report.pressure.forced_compaction, true);
  assert.equal(report.pressure.compaction_items, 1);
  assert.equal(report.pressure.ledger_compactions, 1);
  const calls = (await readFile(requests, "utf8")).trim().split("\n").map(JSON.parse);
  const steer = calls.find((call) => call.method === "turn/steer");
  assert.equal(steer.params.expectedTurnId, report.steering.turn_id);
  assert.equal(steer.params.threadId, report.steering.thread_id);
  assert.match(steer.params.input[0].text, /LIVE_STEER_ACK/);
  assert.equal(calls.filter((call) => call.method === "thread/compact/start").length, 1);
});
