import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { normalizeFiles } from "../skills/pr-review-walkthrough/scripts/walkthrough.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "skills/pr-review-walkthrough/scripts/walkthrough.mjs");
const run = promisify(execFile);
const hostilePatch = "@@ -1,2 +1,2 @@\n-const a = '</script><script>alert(1)</script>';\n+const a = \"safe & sound\";\n context";

test("normalizes GitHub slurped pages and GitLab diffs to one index", () => {
  const github = normalizeFiles([[{ filename: "src/a.ts", status: "modified", additions: 1, deletions: 1, patch: hostilePatch }], [{ filename: "b.md", status: "added", additions: 2, deletions: 0 }]]);
  assert.deepEqual(github.map(({ key, status, additions }) => [key, status, additions]), [["src_a_ts", "modified", 1], ["b_md", "added", 2]]);
  const gitlab = normalizeFiles([{ new_path: "src/a.ts", old_path: "src/a.ts", new_file: false, deleted_file: false, renamed_file: false, diff: hostilePatch }]);
  assert.deepEqual(gitlab.map(({ key, status, additions, deletions }) => [key, status, additions, deletions]), [["src_a_ts", "modified", 1, 1]]);
  assert.equal(normalizeFiles({ changes: [{ new_path: "x", new_file: true, diff: "" }] })[0].status, "added");
  assert.throws(() => normalizeFiles({}), /files JSON/);
});

test("assembles a page whose embedded diffs survive script-breaking text", async (context) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pr-walkthrough-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const files = path.join(dir, "files.json");
  const body = path.join(dir, "body.html");
  const out = path.join(dir, "page.html");
  await writeFile(files, JSON.stringify([{ filename: "src/a.ts", status: "modified", additions: 1, deletions: 1, patch: hostilePatch }]));
  await writeFile(body, '<div class="content"><div data-diff="src_a_ts"></div></div>');

  const index = JSON.parse((await run(process.execPath, [script, "index", files])).stdout);
  assert.deepEqual([index.files, index.additions, index.deletions, index.index[0].key], [1, 1, 1, "src_a_ts"]);

  const { stdout } = await run(process.execPath, [script, "assemble", "--files", files, "--body", body, "--out", out]);
  assert.equal(stdout.trim(), out);
  const html = await readFile(out, "utf8");
  assert.doesNotMatch(html, /INJECT_|__PR_DIFFS_PLACEHOLDER__/);
  assert.match(html, /function renderDiff/);
  assert.match(html, /data-diff="src_a_ts"/);
  const payload = html.match(/<script id="pr-diffs-json"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(payload, /[<>&]/);
  assert.deepEqual(JSON.parse(payload), { src_a_ts: hostilePatch });
});

test("reports usage and exits 1 on a bad command", async () => {
  await assert.rejects(run(process.execPath, [script, "nope"]), (error) => error.code === 1 && /Usage:/.test(error.stderr));
});
