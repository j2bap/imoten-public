#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveProfile } from "../skills/setup-pstack/scripts/imoten-profile.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_NAME = "imoten";
const PROFILE_NAMES = Object.freeze(["personal"]);
const IGNORED_DIRECTORIES = new Set([".audit", ".git", ".worktrees", "node_modules"]);
const PROGRESS_HEARTBEAT_MS = 10_000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function progress(message) {
  process.stderr.write(`[plugin-sync] ${message}\n`);
}

function parseArgs(argv) {
  const options = {
    profiles: "personal",
    dryRun: false,
    force: false,
    validate: true,
    codex: process.env.IMOTEN_CODEX_COMMAND || "codex",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profiles" || arg === "--profile") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options.profiles = value;
    }
    else if (arg === "--dry-run" || arg === "--check") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--no-validate") options.validate = false;
    else if (["--codex", "--marketplace-path", "--state-file", "--creator-root"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--codex") options.codex = value;
      if (arg === "--marketplace-path") options.marketplacePath = value;
      if (arg === "--state-file") options.statePath = value;
      if (arg === "--creator-root") options.creatorRoot = value;
    }
    else if (arg === "--help") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export function parseProfiles(value = "personal") {
  const requested = value === "all" ? PROFILE_NAMES : value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (requested.length === 0 || requested.some((entry) => !PROFILE_NAMES.includes(entry))) {
    throw new Error("profiles must be personal or all");
  }
  return [...new Set(requested)];
}

export function resolveProfileHomes({ profiles = PROFILE_NAMES, userHome = os.homedir(), env = process.env } = {}) {
  return Object.fromEntries(parseProfiles(profiles.join(",")).map((profile) => {
    const resolved = resolveProfile(profile, { userHome, env });
    return [profile, resolved.codexHome];
  }));
}

async function runCommand(file, args, options = {}) {
  const { progressLabel, ...execOptions } = options;
  const startedAt = Date.now();
  let heartbeat;
  if (progressLabel) {
    progress(`${progressLabel} started`);
    heartbeat = setInterval(() => {
      progress(`${progressLabel} still running (${Date.now() - startedAt} ms)`);
    }, PROGRESS_HEARTBEAT_MS);
    heartbeat.unref();
  }
  try {
    return await execFileAsync(file, args, {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
      ...execOptions,
    });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || "command failed").trim();
    throw new Error(`${file} ${args.join(" ")} failed: ${detail}`, { cause: error });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (progressLabel) progress(`${progressLabel} finished in ${Date.now() - startedAt} ms`);
  }
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(file, label) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unavailable or invalid at ${file}`, { cause: error });
  }
}

async function readOptionalJson(file, label) {
  if (!(await pathExists(file))) return null;
  return readJson(file, label);
}

async function writeAtomic(file, content, mode = 0o600) {
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

function creatorRootCandidates({ userHome = os.homedir(), env = process.env, explicit } = {}) {
  const roots = [
    explicit,
    env.IMOTEN_PLUGIN_CREATOR_ROOT,
    env.CODEX_HOME,
    path.join(userHome, ".codex-personal"),
    path.join(userHome, ".codex"),
    path.join(userHome, ".agents"),
  ].filter(Boolean);
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export async function findPluginCreatorRoot(options = {}) {
  for (const candidate of creatorRootCandidates(options)) {
    const roots = [
      candidate,
      path.join(candidate, "skills", ".system", "plugin-creator"),
      path.join(candidate, "skills", "plugin-creator"),
    ];
    for (const root of roots) {
      if (await pathExists(path.join(root, "scripts", "update_plugin_cachebuster.py"))) return root;
    }
  }
  throw new Error("the plugin-creator cachebuster helper was not found; pass --creator-root or install plugin-creator");
}

async function readManifest(repoRoot) {
  const manifestPath = path.join(repoRoot, ".codex-plugin", "plugin.json");
  const manifest = await readJson(manifestPath, "plugin manifest");
  if (manifest.name !== PLUGIN_NAME) throw new Error(`plugin manifest name must be ${PLUGIN_NAME}`);
  if (typeof manifest.version !== "string" || !manifest.version.trim()) throw new Error("plugin manifest version is missing");
  return { manifest, manifestPath };
}

async function validateMarketplace(repoRoot, marketplacePath) {
  const marketplace = await readJson(marketplacePath, "marketplace manifest");
  const entry = marketplace.plugins?.find((plugin) => plugin?.name === PLUGIN_NAME);
  if (!entry) throw new Error(`marketplace has no ${PLUGIN_NAME} entry: ${marketplacePath}`);
  if (entry.source?.source !== "local" || typeof entry.source.path !== "string") {
    throw new Error(`marketplace entry ${PLUGIN_NAME} is not a local source`);
  }
  const expected = path.resolve(repoRoot);
  const roots = [
    path.dirname(marketplacePath),
    path.dirname(path.dirname(marketplacePath)),
    path.dirname(path.dirname(path.dirname(marketplacePath))),
  ];
  const sources = [...new Set(roots.map((root) => path.resolve(root, entry.source.path)))];
  if (!sources.includes(expected)) {
    throw new Error(`marketplace ${PLUGIN_NAME} source resolves to ${sources.join(", ")}, expected ${expected}`);
  }
  return marketplace;
}

async function readMarketplaceName(creatorRoot, marketplacePath) {
  const helper = path.join(creatorRoot, "scripts", "read_marketplace_name.py");
  const result = await runCommand("python3", [helper, "--marketplace-path", marketplacePath], {
    progressLabel: "reading marketplace name",
  });
  const name = result.stdout.trim().split(/\r?\n/u).at(-1);
  if (!name) throw new Error(`marketplace name helper returned no name for ${marketplacePath}`);
  return name;
}

async function sourceDigest(repoRoot) {
  const hash = createHash("sha256");
  let fileCount = 0;
  async function visit(directory, relativeDirectory = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const relative = path.join(relativeDirectory, entry.name).split(path.sep).join("/");
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`refusing symlink in plugin source: ${relative}`);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      let content = await fs.readFile(absolute);
      if (relative === ".codex-plugin/plugin.json") {
        const manifest = JSON.parse(content.toString("utf8"));
        delete manifest.version;
        content = Buffer.from(JSON.stringify(manifest));
      }
      hash.update(relative);
      hash.update("\0");
      hash.update(content);
      hash.update("\0");
      fileCount += 1;
    }
  }
  await visit(repoRoot);
  return { sha256: hash.digest("hex"), file_count: fileCount };
}

export function buildSyncPlan({ sourceDigest: digest, manifestVersion, state, profiles, force = false }) {
  const sourceChanged = force || !state || state.source_digest !== digest;
  const versionChanged = !state || state.manifest_version !== manifestVersion;
  const profilesToInstall = profiles.filter((profile) => (
    force
    || sourceChanged
    || versionChanged
    || state?.profiles?.[profile]?.installed_version !== manifestVersion
  ));
  return {
    source_changed: sourceChanged,
    version_changed: versionChanged,
    needs_cachebuster: sourceChanged,
    profiles_to_install: profilesToInstall,
    up_to_date: !sourceChanged && !versionChanged && profilesToInstall.length === 0,
  };
}

function parseCommandJson(output) {
  const text = output.trim();
  try {
    return JSON.parse(text);
  } catch {
    for (let index = text.indexOf("{"); index >= 0; index = text.indexOf("{", index + 1)) {
      try {
        return JSON.parse(text.slice(index));
      } catch {
        // Try the next object boundary. Warnings may precede JSON output.
      }
    }
  }
  throw new Error(`command returned no JSON object: ${text.slice(0, 300)}`);
}

async function bumpCachebuster(creatorRoot, repoRoot) {
  const helper = path.join(creatorRoot, "scripts", "update_plugin_cachebuster.py");
  await runCommand("python3", [helper, repoRoot], { progressLabel: "updating plugin cachebuster" });
}

async function installForProfile({ codex, profile, codexHome, marketplaceName, manifestVersion, repoRoot }) {
  const result = await runCommand(codex, ["plugin", "add", `${PLUGIN_NAME}@${marketplaceName}`, "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CODEX_HOME: codexHome },
    progressLabel: `installing ${profile} profile`,
  });
  const report = parseCommandJson(result.stdout);
  if (report.version !== manifestVersion) {
    throw new Error(`${profile} installed ${report.version ?? "an unknown version"}, expected ${manifestVersion}`);
  }
  return {
    profile,
    codex_home: codexHome,
    plugin_id: report.pluginId ?? `${PLUGIN_NAME}@${marketplaceName}`,
    version: report.version,
    installed_path: report.installedPath ?? null,
  };
}

async function refreshProfileLauncher(repoRoot) {
  const installer = path.join(repoRoot, "skills", "setup-pstack", "scripts", "install-profile-launcher.mjs");
  const result = await runCommand(process.execPath, [installer, "install"], {
    cwd: repoRoot,
    progressLabel: "refreshing profile launcher",
  });
  return parseCommandJson(result.stdout);
}

function initialState(state, digest, fileCount, manifestVersion) {
  return {
    schema_version: 1,
    owner: "imoten/sync-local-plugin",
    plugin: PLUGIN_NAME,
    source_digest: digest,
    source_file_count: fileCount,
    manifest_version: manifestVersion,
    profiles: { ...(state?.profiles ?? {}) },
    updated_at: new Date().toISOString(),
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Usage: sync-local-plugin.mjs [--profiles personal|all] [--dry-run] [--force] [--no-validate]\n");
    return;
  }

  const repoRoot = REPO_ROOT;
  const profiles = parseProfiles(options.profiles);
  progress(`starting for ${profiles.join(", ")} profile${profiles.length === 1 ? "" : "s"}`);
  const marketplacePath = path.resolve(options.marketplacePath ?? path.join(repoRoot, ".agents", "plugins", "marketplace.json"));
  const statePath = path.resolve(options.statePath ?? path.join(repoRoot, ".audit", "plugin-sync.json"));
  const creatorRoot = await findPluginCreatorRoot({ explicit: options.creatorRoot });
  const { manifest } = await readManifest(repoRoot);
  await validateMarketplace(repoRoot, marketplacePath);
  if (options.validate) {
    await runCommand(process.execPath, [path.join(repoRoot, "scripts", "validate-plugin.mjs"), "--root", repoRoot, "--no-bun-probe"], {
      progressLabel: "validating plugin",
    });
  }
  const marketplaceName = await readMarketplaceName(creatorRoot, marketplacePath);
  progress("hashing plugin source");
  const digestStartedAt = Date.now();
  const digest = await sourceDigest(repoRoot);
  progress(`source hash finished in ${Date.now() - digestStartedAt} ms`);
  const state = await readOptionalJson(statePath, "plugin sync state");
  const plan = buildSyncPlan({
    sourceDigest: digest.sha256,
    manifestVersion: manifest.version,
    state,
    profiles,
    force: options.force,
  });

  if (options.dryRun) {
    progress("dry-run complete");
    process.stdout.write(`${JSON.stringify({
      status: plan.up_to_date ? "up-to-date" : "dry-run",
      plugin: PLUGIN_NAME,
      marketplace: marketplaceName,
      manifest_version: manifest.version,
      source_digest: digest.sha256,
      source_file_count: digest.file_count,
      profiles,
      plan,
      would_bump_cachebuster: plan.needs_cachebuster,
      would_refresh_profile_launcher: !plan.up_to_date,
    }, null, 2)}\n`);
    return;
  }

  let { manifest: currentManifest } = await readManifest(repoRoot);
  if (plan.needs_cachebuster) {
    await bumpCachebuster(creatorRoot, repoRoot);
    ({ manifest: currentManifest } = await readManifest(repoRoot));
  }

  const nextState = initialState(state, digest.sha256, digest.file_count, currentManifest.version);

  const installations = [];
  for (const profile of plan.profiles_to_install) {
    const { codexHome } = resolveProfile(profile);
    const installed = await installForProfile({
      codex: options.codex,
      profile,
      codexHome,
      marketplaceName,
      manifestVersion: currentManifest.version,
      repoRoot,
    });
    installations.push(installed);
    nextState.profiles[profile] = {
      codex_home: codexHome,
      installed_version: installed.version,
      synced_at: new Date().toISOString(),
    };
    nextState.updated_at = new Date().toISOString();
  }

  const launcher = plan.up_to_date ? null : await refreshProfileLauncher(repoRoot);
  progress(plan.up_to_date ? "already up to date" : "sync complete");
  if (!plan.up_to_date) await writeAtomic(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: plan.up_to_date ? "up-to-date" : "synced",
    plugin: PLUGIN_NAME,
    marketplace: marketplaceName,
    manifest_version: currentManifest.version,
    source_digest: digest.sha256,
    source_file_count: digest.file_count,
    profiles,
    installations,
    profile_launcher: launcher,
    state_path: statePath,
    new_thread_required: installations.length > 0,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
