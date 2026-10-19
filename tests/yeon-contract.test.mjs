import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Yeon keeps CLI ownership and returns compact program results", async () => {
  const yeon = await fs.readFile(path.join(root, "skills/yeon/SKILL.md"), "utf8");
  for (const phrase of [
    "functions.exec",
    '"answer"',
    '"evidence"',
    '"artifacts"',
    '"warnings"',
    "Promise.all",
    "glab",
    "jira",
    "confl",
    "$atlassian-curl",
    "user's existing authorization",
  ]) assert.match(yeon, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(yeon, /does not add an MCP server, connector, proxy, or command framework\./);
});
