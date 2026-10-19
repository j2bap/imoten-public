import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { findAddedEffects } from "../skills/tracen/scripts/check-react-diff.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

test("Tracen reports added React effects with their new line numbers", () => {
  const source = [
    "import { useEffect, useInsertionEffect } from 'react';",
    "export function Card() {",
    "const value = source.value;",
    "useEffect(() => setValue(source.value), [source]);",
    "React.useLayoutEffect(() => subscribe(), []);",
    "export function Inline() { useInsertionEffect(() => inject(), []); useEffect(() => connect(), []); return null; }",
    "// useEffect(() => example(), []);",
    "/* useEffect(() => example(), []); */",
    "const example = \"useEffect(() => example(), [])\";",
    "return <div>{value}</div>;",
    "}",
  ].join("\n");
  const diff = [
    "diff --git a/src/Card.tsx b/src/Card.tsx",
    "--- a/src/Card.tsx",
    "+++ b/src/Card.tsx",
    "@@ -3,2 +3,5 @@ function Card() {",
    " const value = source.value;",
    "+useEffect(() => setValue(source.value), [source]);",
    "+React.useLayoutEffect(() => subscribe(), []);",
    "+export function Inline() { useInsertionEffect(() => inject(), []); useEffect(() => connect(), []); return null; }",
    "+// useEffect(() => example(), []);",
    "+/* useEffect(() => example(), []); */",
    "+const example = \"useEffect(() => example(), [])\";",
    " return <div>{value}</div>;",
  ].join("\n");

  assert.deepEqual(findAddedEffects(diff, { file: "src/Card.tsx", source }).map(({ column, ...effect }) => effect), [
    { file: "src/Card.tsx", line: 4, hook: "useEffect", source: "useEffect(() => setValue(source.value), [source]);" },
    { file: "src/Card.tsx", line: 5, hook: "useLayoutEffect", source: "React.useLayoutEffect(() => subscribe(), []);" },
    { file: "src/Card.tsx", line: 6, hook: "useInsertionEffect", source: "export function Inline() { useInsertionEffect(() => inject(), []); useEffect(() => connect(), []); return null; }" },
    { file: "src/Card.tsx", line: 6, hook: "useEffect", source: "export function Inline() { useInsertionEffect(() => inject(), []); useEffect(() => connect(), []); return null; }" },
  ]);
});

test("Tracen finds aliases in combined React imports", () => {
  const source = [
    'import React, { useEffect as sync } from "react";',
    "sync(() => connect(), []);",
  ].join("\n");
  const diff = [
    "@@ -1 +1,2 @@",
    ' import React, { useEffect as sync } from "react";',
    "+sync(() => connect(), []);",
  ].join("\n");

  assert.deepEqual(findAddedEffects(diff, { file: "Combined.tsx", source }).map(({ column, ...effect }) => effect), [
    { file: "Combined.tsx", line: 2, hook: "useEffect", source: "sync(() => connect(), []);" },
  ]);
});

test("Tracen ignores removed effects and non-React files", () => {
  const removed = [
    "diff --git a/src/old.jsx b/src/old.jsx",
    "--- a/src/old.jsx",
    "+++ b/src/old.jsx",
    "@@ -1 +0,0 @@",
    "-useEffect(() => sync(), []);",
  ].join("\n");
  const documentation = [
    "diff --git a/docs/example.md b/docs/example.md",
    "--- a/docs/example.md",
    "+++ b/docs/example.md",
    "@@ -0,0 +1 @@",
    "+useEffect(() => example(), []);",
  ].join("\n");

  assert.deepEqual(findAddedEffects(removed, { file: "src/old.jsx", source: "" }), []);
  assert.deepEqual(findAddedEffects(documentation, { file: "docs/example.md", source: "useEffect(() => example(), []);\n" }), []);
});

test("Tracen ignores Effects inside multiline comments and templates", () => {
  const source = [
    "/*",
    "useEffect(() => example(), []);",
    "*/",
    "useEffect(() => connect(), []);",
    "const example = `",
    "useLayoutEffect(() => example(), []);",
    "`;",
  ].join("\n");
  const diff = [
    "@@ -0,0 +1,7 @@",
    "+/*",
    "+useEffect(() => example(), []);",
    "+*/",
    "+useEffect(() => connect(), []);",
    "+const example = `",
    "+useLayoutEffect(() => example(), []);",
    "+`;",
  ].join("\n");

  assert.deepEqual(findAddedEffects(diff, { file: "Example.tsx", source }).map(({ column, ...effect }) => effect), [
    { file: "Example.tsx", line: 4, hook: "useEffect", source: "useEffect(() => connect(), []);" },
  ]);
});

test("Tracen keeps line numbers after non-BMP characters", () => {
  const source = "// 😀\nuseEffect(() => connect(), []);\n";
  const diff = [
    "@@ -1 +1,2 @@",
    " // 😀",
    "+useEffect(() => connect(), []);",
  ].join("\n");

  assert.deepEqual(findAddedEffects(diff, { file: "Emoji.tsx", source }).map(({ column, ...effect }) => effect), [
    { file: "Emoji.tsx", line: 2, hook: "useEffect", source: "useEffect(() => connect(), []);" },
  ]);
});

test("Poteto routes React changes through the installed Tracen skill", async () => {
  const [poteto, routing, tracen, evidence] = await Promise.all([
    fs.readFile(path.join(root, "skills/poteto-mode/SKILL.md"), "utf8"),
    fs.readFile(path.join(root, "skills/poteto-mode/references/task-routing.md"), "utf8"),
    fs.readFile(path.join(root, "skills/tracen/SKILL.md"), "utf8"),
    fs.readFile(path.join(root, "skills/tracen/references/evidence.md"), "utf8"),
  ]);

  assert.match(poteto, /After any React .* run \*\*tracen\*\* before completion/u);
  assert.match(routing, /React component, hook, context, or rendering change.*Use `tracen`/u);
  assert.match(tracen, /external system/u);
  assert.match(tracen, /check-react-diff\.mjs/u);
  assert.match(evidence, /react\.dev\/learn\/you-might-not-need-an-effect/u);
  assert.match(evidence, /10\.1145\/3763067/u);
});

test("Tracen CLI checks tracked and untracked React files", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "tracen-react-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await execFileAsync("git", ["init", "--quiet"], { cwd: temporary });
  await execFileAsync("git", ["config", "user.email", "tracen@example.test"], { cwd: temporary });
  await execFileAsync("git", ["config", "user.name", "Tracen Test"], { cwd: temporary });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: temporary });
  await fs.writeFile(path.join(temporary, "App.tsx"), "export function App() { return <main />; }\n");
  await fs.mkdir(path.join(temporary, "b"));
  await fs.writeFile(path.join(temporary, "b/Card.tsx"), "export function Card() { return null; }\n");
  await fs.writeFile(path.join(temporary, "Card\tDemo.tsx"), "export function Demo() { return null; }\n");
  await fs.writeFile(path.join(temporary, ":(literal)Card.tsx"), "export function Literal() { return null; }\n");
  await execFileAsync("git", ["add", "--all"], { cwd: temporary });
  await execFileAsync("git", ["commit", "--quiet", "-m", "base"], { cwd: temporary });
  await fs.writeFile(path.join(temporary, "App.tsx"), [
    "import { useEffect } from 'react';",
    "export function App() {",
    "  useEffect(() => connect(), []);",
    "  return <main />;",
    "}",
    "",
  ].join("\n"));
  await execFileAsync("git", ["add", "App.tsx"], { cwd: temporary });
  await fs.writeFile(path.join(temporary, "App.tsx"), "export function App() { return <main />; }\n");
  await fs.writeFile(path.join(temporary, "b/Card.tsx"), "export function Card() { React.useEffect(() => connect(), []); return null; }\n");
  await fs.writeFile(path.join(temporary, "Card\tDemo.tsx"), "useInsertionEffect(() => inject(), []);\n");
  await fs.writeFile(path.join(temporary, ":(literal)Card.tsx"), "useEffect(() => connectLiteral(), []);\n");
  await fs.writeFile(path.join(temporary, "Extra.jsx"), [
    "import { useLayoutEffect as syncLayout } from 'react';",
    "syncLayout(() => measure(), []);",
    "",
  ].join("\n"));

  const script = path.join(root, "skills/tracen/scripts/check-react-diff.mjs");
  const result = await execFileAsync(process.execPath, [script, "--cwd", temporary, "--json"])
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));

  assert.equal(result.code, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "review-required");
  assert.deepEqual(Object.fromEntries(report.effects.map(({ file, hook }) => [file, hook])), {
    ":(literal)Card.tsx": "useEffect",
    "App.tsx": "useEffect",
    "b/Card.tsx": "useEffect",
    "Card\tDemo.tsx": "useInsertionEffect",
    "Extra.jsx": "useLayoutEffect",
  });
});
