#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const usage = `Usage:
  walkthrough.mjs index <files.json>
  walkthrough.mjs assemble --files <files.json> --body <body.html> --out <page.html>`;

export function diffKey(filePath) {
  return filePath.replace(/[^a-zA-Z0-9]/g, "_");
}

function fileStatus(entry) {
  if (entry.status) return entry.status;
  if (entry.new_file) return "added";
  if (entry.deleted_file) return "removed";
  if (entry.renamed_file) return "renamed";
  return "modified";
}

function countLines(patch, marker) {
  return patch.split("\n").filter((line) => line.startsWith(marker) && !line.startsWith(marker.repeat(3))).length;
}

export function normalizeFiles(raw) {
  let entries = Array.isArray(raw) ? raw : raw?.changes;
  if (!Array.isArray(entries)) throw new Error("files JSON must be an array, an array of pages, or an object with a changes array");
  entries = entries.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
  return entries.map((entry) => {
    const filePath = entry.filename ?? entry.new_path ?? entry.old_path;
    if (typeof filePath !== "string") throw new Error("each file needs filename (GitHub) or new_path (GitLab)");
    const patch = entry.patch ?? entry.diff ?? "";
    return {
      key: diffKey(filePath),
      path: filePath,
      status: fileStatus(entry),
      additions: entry.additions ?? countLines(patch, "+"),
      deletions: entry.deletions ?? countLines(patch, "-"),
      patch,
    };
  });
}

export function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export async function assemble({ files, body }) {
  const [css, js, template] = await Promise.all(
    ["styles.css", "renderer.js", "template.html"].map((name) => readFile(path.join(assets, name), "utf8")),
  );
  const patches = Object.fromEntries(files.map((file) => [file.key, file.patch]));
  const parts = { "/* INJECT_CSS */": css, "/* INJECT_JS */": js, "<!-- INJECT_BODY -->": body, '{"__PR_DIFFS_PLACEHOLDER__":true}': scriptSafeJson(patches) };
  let html = template;
  for (const [marker, value] of Object.entries(parts)) {
    if (!html.includes(marker)) throw new Error(`template is missing ${marker}`);
    html = html.replace(marker, () => value);
  }
  return html;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`missing ${name}\n${usage}`);
  return args[index + 1];
}

async function readFiles(file) {
  return normalizeFiles(JSON.parse(await readFile(file, "utf8")));
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (command === "index" && rest[0]) {
    const files = await readFiles(rest[0]);
    const index = files.map(({ patch, ...file }) => file);
    const totals = index.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 });
    console.log(JSON.stringify({ files: index.length, ...totals, index }, null, 2));
    return;
  }
  if (command === "assemble") {
    const files = await readFiles(option(rest, "--files"));
    const body = await readFile(option(rest, "--body"), "utf8");
    const out = path.resolve(option(rest, "--out"));
    await writeFile(out, await assemble({ files, body }));
    console.log(out);
    return;
  }
  throw new Error(usage);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
