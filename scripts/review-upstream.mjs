#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inventoryDirectory,
  validateCompatibility,
} from "./generate-compatibility-report.mjs";
import { withUpstreamCheckout } from "./import-upstream.mjs";

function parseArgs(argv) {
  const result = { patch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--patch") result.patch = true;
    else if (arg.startsWith("--")) result[arg.slice(2)] = argv[++index];
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!isFullSha(result.commit)) throw new Error("--commit must be a full 40-character hexadecimal SHA");
  return result;
}

function isFullSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

async function capture(command, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trimEnd());
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function buildFindings(deltas, lock, map, candidateFiles) {
  const lockedByPath = new Map(lock.files.map((file) => [file.path, file]));
  const candidateByPath = new Map(candidateFiles.map((file) => [file.path, file]));
  const mapByPath = new Map(map.entries.map((entry) => [entry.upstreamPath, entry]));
  return deltas.map((delta) => {
    const entry = mapByPath.get(delta.path);
    return {
      path: delta.path,
      kind: delta.kind,
      oldSha256: lockedByPath.get(delta.path)?.sha256 ?? null,
      newSha256: candidateByPath.get(delta.path)?.sha256 ?? null,
      classification: entry?.classification ?? "unclassified",
      codexPath: entry?.derivedPath ?? null,
      disposition: delta.review,
    };
  });
}

function renderReview(result) {
  const lines = [
    `Locked commit: ${result.lockedCommit}`,
    `Candidate commit: ${result.candidateCommit}`,
    "",
    "| Path | Kind | Old SHA-256 | New SHA-256 | Classification | Codex path | Disposition |",
    "|---|---|---|---|---|---|---|",
  ];
  if (result.findings.length === 0) lines.push("| none | unchanged | - | - | - | - | recorded |");
  for (const finding of result.findings) {
    lines.push(`| ${finding.path} | ${finding.kind} | ${finding.oldSha256 ?? "-"} | ${finding.newSha256 ?? "-"} | ${finding.classification} | ${finding.codexPath ?? "-"} | ${finding.disposition} |`);
  }
  if (result.errors.length) lines.push("", "Blocking findings:", ...result.errors.map((error) => `- ${error}`));
  if (result.patch) lines.push("", "Upstream patch:", result.patch);
  return `${lines.join("\n")}\n`;
}

export async function reviewUpstream(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const lockPath = path.resolve(root, options.lock ?? "upstream.lock.json");
  const mapPath = path.resolve(root, options.map ?? "compatibility/pstack-map.json");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  const map = JSON.parse(await fs.readFile(mapPath, "utf8"));
  const repository = options.repository ?? options.source ?? lock.source.repository;
  const subdirectory = options.subdirectory ?? lock.source.subdirectory;
  const candidateCommit = options.commit;
  if (!isFullSha(candidateCommit)) throw new Error("--commit must be a full 40-character hexadecimal SHA");
  if (!isFullSha(lock.source.commit)) throw new Error("The locked source commit must be a full 40-character hexadecimal SHA");

  return await withUpstreamCheckout({
    cwd: root,
    source: repository,
    commit: candidateCommit,
    subdirectory,
    forceClone: true,
    temporaryParent: options.temporaryParent,
  }, async ({ checkoutRoot, sourceRoot }) => {
    const candidateFiles = await inventoryDirectory(sourceRoot);
    const compatibility = validateCompatibility(lock, map, candidateFiles);
    const patch = options.patch ? await capture("git", [
      "-C", checkoutRoot, "diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--full-index", "--binary",
      lock.source.commit, candidateCommit, "--", subdirectory,
    ], root) : "";
    return {
      lockedCommit: lock.source.commit,
      candidateCommit,
      findings: buildFindings(compatibility.deltas, lock, map, candidateFiles),
      errors: compatibility.errors,
      patch,
    };
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await reviewUpstream({
    ...args,
    temporaryParent: args["temporary-parent"],
  });
  process.stdout.write(renderReview(result));
  if (result.errors.length) process.exitCode = 1;
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
