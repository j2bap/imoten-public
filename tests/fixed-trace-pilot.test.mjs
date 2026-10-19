import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const pilot = path.join(root, "docs/plans/candidates/cache-aware-context/fixed-trace-pilot.mjs");
const fakeCodex = path.join(root, "tests/fixtures/fake-codex-app-server.mjs");

test("fixed-trace pilot records valid app-server observations", async () => {
  await chmod(fakeCodex, 0o700);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "pstack-fixed-trace-pilot-"));
  const output = path.join(outputDir, "pilot.jsonl");
  try {
    const result = await execFileAsync(process.execPath, [
      pilot,
      "--run-provider",
      "--codex-command",
      fakeCodex,
      "--max-calls",
      "4",
      "--output",
      output,
    ], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
    assert.match(result.stdout, /transport=app-server/);
    assert.match(result.stdout, /provider_attempts=4/);
    const rows = (await readFile(output, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    assert.equal(rows.length, 4);
    assert.equal(rows.every((row) => row.provider?.valid_observation === true), true);
    assert.equal(rows.every((row) => row.usage?.cached_input_tokens === 900), true);
    assert.equal(rows.every((row) => row.observer?.trace_truncated === false), true);
    assert.equal(rows.every((row) => row.observer?.hook_count === 0), true);
    assert.equal(rows.every((row) => row.observer?.user_message_completed_ms === null), true);
    for (const arm of ["legacy", "redesign"]) {
      const armRows = rows.filter((row) => row.arm === arm);
      assert.equal(new Set(armRows.map((row) => row.provider.thread_id)).size, armRows.length);
    }
    assert.equal(rows.every((row) => row.provider.compaction_items_seen === 0), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
