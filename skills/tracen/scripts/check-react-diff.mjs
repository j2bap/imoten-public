#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const reactExtension = /\.(?:[cm]?[jt]sx?)$/u;
const effectHooks = ["useEffect", "useLayoutEffect", "useInsertionEffect"];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskSource(source) {
  const result = source.split("");
  let state = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (character === "\n") state = "code";
      else result[index] = " ";
    } else if (state === "block-comment") {
      result[index] = character === "\n" ? "\n" : " ";
      if (character === "*" && next === "/") {
        result[index + 1] = " ";
        index += 1;
        state = "code";
      }
    } else if (state !== "code") {
      result[index] = character === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === state) state = "code";
    } else if (character === "/" && next === "/") {
      result[index] = result[index + 1] = " ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result[index] = result[index + 1] = " ";
      index += 1;
      state = "block-comment";
    } else if (character === "\"" || character === "'" || character === "`") {
      result[index] = " ";
      state = character;
    }
  }
  return result.join("");
}

function effectAliases(source, masked) {
  const bare = new Map(effectHooks.map((hook) => [hook, hook]));
  const namespaces = new Set(["React"]);
  for (const match of source.matchAll(/import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*["']react["']/gu)) {
    if (masked.slice(match.index, match.index + 6) !== "import") continue;
    for (const specifier of match[1].split(",")) {
      const imported = specifier.trim().match(/^(useEffect|useLayoutEffect|useInsertionEffect)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
      if (imported) bare.set(imported[2] ?? imported[1], imported[1]);
    }
  }
  for (const match of source.matchAll(/import\s+(?:\*\s+as\s+|)([A-Za-z_$][\w$]*)\s+from\s*["']react["']/gu)) {
    if (masked.slice(match.index, match.index + 6) === "import") namespaces.add(match[1]);
  }
  return { bare, namespaces };
}

function effectCalls(line, originalLine, aliases) {
  const calls = [];
  for (const [alias, hook] of aliases.bare) {
    const pattern = new RegExp(`(?<![\\w$.])${escapeRegex(alias)}\\s*\\(`, "gu");
    for (const match of line.matchAll(pattern)) calls.push({ column: [...originalLine.slice(0, match.index)].length + 1, hook });
  }
  for (const namespace of aliases.namespaces) {
    for (const hook of effectHooks) {
      const pattern = new RegExp(`\\b${escapeRegex(namespace)}\\s*\\.\\s*${hook}\\s*\\(`, "gu");
      for (const match of line.matchAll(pattern)) calls.push({ column: [...originalLine.slice(0, match.index)].length + 1, hook });
    }
  }
  return calls.sort((left, right) => left.column - right.column || left.hook.localeCompare(right.hook));
}

function addedLines(diff) {
  const lines = new Set();
  let newLine = null;
  for (const line of diff.split(/\r?\n/u)) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (newLine === null) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lines.add(newLine);
      newLine += 1;
    } else if (line.startsWith(" ")) newLine += 1;
  }
  return lines;
}

function findEffects(source, file, selectedLines = null) {
  if (!reactExtension.test(file)) return [];
  const masked = maskSource(source);
  const aliases = effectAliases(source, masked);
  const originalLines = source.split(/\r?\n/u);
  const maskedLines = masked.split(/\r?\n/u);
  const effects = [];
  for (const [index, line] of maskedLines.entries()) {
    const lineNumber = index + 1;
    if (selectedLines && !selectedLines.has(lineNumber)) continue;
    for (const call of effectCalls(line, originalLines[index], aliases)) {
      effects.push({
        file,
        line: lineNumber,
        column: call.column,
        hook: call.hook,
        source: originalLines[index].trim().slice(0, 240),
      });
    }
  }
  return effects;
}

export function findAddedEffects(diff, { file, source }) {
  return findEffects(source, file, addedLines(diff));
}

function parseArgs(argv) {
  const options = { cwd: process.cwd(), base: "HEAD", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--cwd" && argv[index + 1]) options.cwd = path.resolve(argv[++index]);
    else if (arg === "--base" && argv[index + 1]) options.base = argv[++index];
    else throw new Error("usage: check-react-diff.mjs [--cwd PATH] [--base REF] [--json]");
  }
  return options;
}

async function runGit(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-c", "core.quotePath=false", "--literal-pathspecs", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function readWorkingFile(repository, file) {
  const target = path.resolve(repository, file);
  if (!target.startsWith(`${repository}${path.sep}`)) return null;
  const stat = await fs.lstat(target).catch(() => null);
  return stat?.isFile() ? fs.readFile(target, "utf8") : null;
}

async function changedFiles(repository, base, cached) {
  const args = ["diff"];
  if (cached) args.push("--cached");
  args.push("--name-only", "--diff-filter=ACMR", "-z", base, "--");
  return (await runGit(repository, args)).split("\0").filter((file) => file && reactExtension.test(file));
}

async function inspectSnapshot(repository, base, cached) {
  const effects = [];
  for (const file of await changedFiles(repository, base, cached)) {
    const source = cached ? await runGit(repository, ["show", `:./${file}`]) : await readWorkingFile(repository, file);
    if (source === null) continue;
    const args = ["diff"];
    if (cached) args.push("--cached");
    args.push("--unified=0", "--no-ext-diff", "--no-color", "--no-prefix", base, "--", file);
    effects.push(...findAddedEffects(await runGit(repository, args), { file, source }));
  }
  return effects;
}

async function inspectReactDiff(options) {
  if (options.base.startsWith("-")) throw new Error("base must be a Git revision, not an option");
  const repository = (await runGit(options.cwd, ["rev-parse", "--show-toplevel"])).trim();
  const base = (await runGit(repository, ["rev-parse", "--verify", `${options.base}^{commit}`])).trim();
  const effects = [
    ...await inspectSnapshot(repository, base, false),
    ...await inspectSnapshot(repository, base, true),
  ];
  const untracked = (await runGit(repository, ["ls-files", "--full-name", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter((file) => file && reactExtension.test(file));
  for (const file of untracked) {
    const source = await readWorkingFile(repository, file);
    if (source !== null) effects.push(...findEffects(source, file));
  }
  return [...new Map(effects.map((effect) => [`${effect.file}\0${effect.line}\0${effect.column}\0${effect.hook}\0${effect.source}`, effect])).values()]
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const effects = await inspectReactDiff(options);
  const result = { status: effects.length ? "review-required" : "no-matches", effects };
  if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (effects.length) {
    for (const effect of effects) process.stdout.write(`${effect.file}:${effect.line}:${effect.column} ${effect.hook} ${effect.source}\n`);
  } else process.stdout.write("No added React effect matches.\n");
  if (effects.length) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
