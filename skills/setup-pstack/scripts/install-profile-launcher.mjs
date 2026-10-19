#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "imoten-profile.mjs";
const RECEIPT_NAME = "profile-launcher.receipt.json";
const COMMANDS = Object.freeze([
  Object.freeze({ name: "imoten-profile", kind: "passthrough" }),
  Object.freeze({ name: "codex-personal", kind: "profile", profile: "personal" }),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function resolvePaths({ userHome = os.homedir(), installRoot, binDir } = {}) {
  const home = path.resolve(userHome);
  const root = path.resolve(installRoot ?? path.join(home, ".local", "share", "imoten-profile"));
  const bin = path.resolve(binDir ?? path.join(home, ".local", "bin"));
  return {
    userHome: home,
    installRoot: root,
    binDir: bin,
    scriptPath: path.join(root, SCRIPT_NAME),
    receiptPath: path.join(root, RECEIPT_NAME),
    commandPaths: Object.fromEntries(COMMANDS.map(({ name }) => [name, path.join(bin, name)])),
  };
}

function renderWrapper({ kind, profile, nodePath, scriptPath }) {
  const node = shellQuote(nodePath);
  const script = shellQuote(scriptPath);
  if (kind === "passthrough") return `#!/bin/sh\nexec ${node} ${script} "$@"\n`;
  if (kind === "profile") return `#!/bin/sh\nexec ${node} ${script} run --profile ${shellQuote(profile)} -- "$@"\n`;
  throw new Error(`unknown wrapper kind "${kind}"`);
}

async function readOptional(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertOwnedFile(file, expectedHash, label) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return { status: "missing", path: file };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular file: ${file}`);
  const content = await fs.readFile(file);
  const actualHash = sha256(content);
  if (expectedHash && actualHash !== expectedHash) {
    return { status: "modified", path: file, expected_sha256: expectedHash, actual_sha256: actualHash };
  }
  return { status: "unchanged", path: file, sha256: actualHash };
}

function expectedRecords(paths, contents) {
  return [
    { path: path.relative(paths.installRoot, paths.scriptPath), sha256: sha256(contents.script), kind: "script" },
    ...COMMANDS.map(({ name }) => ({
      path: path.relative(paths.installRoot, paths.commandPaths[name]),
      sha256: sha256(contents.commands[name]),
      kind: "command",
    })),
  ];
}

async function readReceipt(paths) {
  const content = await readOptional(paths.receiptPath);
  if (content === null) return null;
  let receipt;
  try {
    receipt = JSON.parse(content);
  } catch {
    throw new Error(`profile launcher receipt is invalid JSON: ${paths.receiptPath}`);
  }
  if (receipt.schema_version !== 1 || receipt.owner !== "imoten/setup-pstack" || !Array.isArray(receipt.files)) {
    throw new Error(`profile launcher receipt has an unknown owner or schema: ${paths.receiptPath}`);
  }
  const expected = new Set([
    path.relative(paths.installRoot, paths.scriptPath),
    ...COMMANDS.map(({ name }) => path.relative(paths.installRoot, paths.commandPaths[name])),
  ]);
  const seen = new Set();
  for (const record of receipt.files) {
    if (!record || typeof record.path !== "string" || !/^[a-f0-9]{64}$/u.test(record.sha256 ?? "")) {
      throw new Error("profile launcher receipt contains an invalid file record");
    }
    if (seen.has(record.path) || !expected.has(record.path)) throw new Error(`profile launcher receipt contains an unexpected path: ${record.path}`);
    seen.add(record.path);
  }
  if (seen.size !== expected.size) throw new Error("profile launcher receipt is missing a managed file");
  return receipt;
}

async function writeAtomic(file, content, mode = 0o700) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, content, { mode });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function sourceScriptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), SCRIPT_NAME);
}

async function renderContents(paths, sourcePath = sourceScriptPath()) {
  const script = await fs.readFile(sourcePath, "utf8");
  const commands = Object.fromEntries(COMMANDS.map(({ name, kind, profile }) => [
    name,
    renderWrapper({ kind, profile, nodePath: process.execPath, scriptPath: paths.scriptPath }),
  ]));
  return { script, commands };
}

async function inspectFiles(paths, receipt) {
  const records = new Map((receipt?.files ?? []).map((record) => [path.resolve(paths.installRoot, record.path), record]));
  return [
    await assertOwnedFile(paths.scriptPath, records.get(paths.scriptPath)?.sha256, "profile launcher script"),
    ...await Promise.all(COMMANDS.map(({ name }) => assertOwnedFile(
      paths.commandPaths[name],
      records.get(paths.commandPaths[name])?.sha256,
      `profile launcher command ${name}`,
    ))),
  ];
}

export async function inspectProfileLauncher(options = {}) {
  const paths = resolvePaths(options);
  const receipt = await readReceipt(paths);
  const files = receipt ? await inspectFiles(paths, receipt) : [];
  const divergent = files.filter((file) => file.status !== "unchanged");
  const pathEntries = process.env.PATH?.split(path.delimiter) ?? [];
  return {
    ...paths,
    receipt_exists: Boolean(receipt),
    status: receipt ? (divergent.length ? "review-required" : "installed") : "not-installed",
    bin_on_path: pathEntries.some((entry) => path.resolve(entry) === paths.binDir),
    files,
  };
}

export async function installProfileLauncher(options = {}) {
  const paths = resolvePaths(options);
  const receipt = await readReceipt(paths);
  if (receipt) {
    const current = await inspectFiles(paths, receipt);
    const divergent = current.filter((file) => file.status !== "unchanged");
    if (divergent.length) {
      throw new Error(`review required for divergent profile launcher files: ${divergent.map((file) => file.path).join(", ")}`);
    }
  } else {
    const existing = [paths.scriptPath, ...Object.values(paths.commandPaths)];
    const collisions = [];
    for (const file of existing) {
      try {
        await fs.lstat(file);
        collisions.push(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (collisions.length) throw new Error(`review required for unowned profile launcher files: ${collisions.join(", ")}`);
  }

  const contents = await renderContents(paths);
  await writeAtomic(paths.scriptPath, contents.script, 0o700);
  await fs.chmod(paths.scriptPath, 0o700);
  for (const command of COMMANDS) {
    const file = paths.commandPaths[command.name];
    await writeAtomic(file, contents.commands[command.name], 0o700);
    await fs.chmod(file, 0o700);
  }
  const receiptContent = {
    schema_version: 1,
    owner: "imoten/setup-pstack",
    created_at: new Date().toISOString(),
    install_root: paths.installRoot,
    bin_dir: paths.binDir,
    files: expectedRecords(paths, contents),
  };
  await writeAtomic(paths.receiptPath, `${JSON.stringify(receiptContent, null, 2)}\n`, 0o600);
  await fs.chmod(paths.receiptPath, 0o600);
  return { status: "installed", ...await inspectProfileLauncher(options) };
}

export async function uninstallProfileLauncher(options = {}) {
  const paths = resolvePaths(options);
  const receipt = await readReceipt(paths);
  if (!receipt) return { status: "not-installed", ...paths, preserved: [] };
  const current = await inspectFiles(paths, receipt);
  const divergent = current.filter((file) => file.status !== "unchanged");
  if (divergent.length) {
    const archive = `${paths.receiptPath}.preserved-${Date.now()}`;
    await fs.rename(paths.receiptPath, archive);
    return {
      status: "preserved-divergent-files",
      ...paths,
      preserved: divergent.map((file) => file.path),
      archived_receipt: archive,
    };
  }
  await Promise.all([
    fs.rm(paths.scriptPath, { force: true }),
    ...Object.values(paths.commandPaths).map((file) => fs.rm(file, { force: true })),
    fs.rm(paths.receiptPath, { force: true }),
  ]);
  return { status: "uninstalled", ...paths, preserved: [] };
}

function parseArgs(argv) {
  const action = argv[0];
  if (!action || !["install", "uninstall", "doctor"].includes(action)) {
    throw new Error("usage: install-profile-launcher.mjs <install|uninstall|doctor> [--user-home HOME] [--install-root ROOT] [--bin-dir DIR]");
  }
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${flag ?? "end of command"}`);
    const key = flag.slice(2);
    if (!["user-home", "install-root", "bin-dir"].includes(key)) throw new Error(`unknown option "${flag}"`);
    options[key.replaceAll("-", "_")] = value;
  }
  return { action, options: { userHome: options.user_home, installRoot: options.install_root, binDir: options.bin_dir } };
}

async function main(argv) {
  const { action, options } = parseArgs(argv);
  const result = action === "install"
    ? await installProfileLauncher(options)
    : action === "uninstall" ? await uninstallProfileLauncher(options) : await inspectProfileLauncher(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "review-required") process.exitCode = 3;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
