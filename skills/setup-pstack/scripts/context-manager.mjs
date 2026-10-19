#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const PROMPT_SCHEMA_VERSION = 2;
const EVENT_KINDS = new Set([
  "message",
  "tool_call",
  "tool_output",
  "handoff",
  "task_packet",
  "result_packet",
  "runner_observation",
  "steering",
  "compaction",
]);
const PLACEMENTS = new Set(["warm", "cold"]);
const COMPACTION_STATES = new Set(["idle", "needed", "in_flight", "sealed"]);
const OPAQUE_KEYS = new Set([
  "encrypted_content",
  "opaque",
  "reasoning",
  "compaction",
  "provider_handle",
  "raw_provider_event",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be non-empty text`);
  return value;
}

function assertSafeSegment(value, label) {
  assertText(value, label);
  if (value === "." || value === ".." || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new TypeError(`${label} must be a safe path segment`);
  }
  return value;
}

function assertFiniteNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a finite number from ${min} to ${max}`);
  }
  return value;
}

function hasOpaqueKey(value, seen = new Set()) {
  if (Array.isArray(value)) return value.some((entry) => hasOpaqueKey(entry, seen));
  if (!isRecord(value)) return false;
  if (seen.has(value)) throw new TypeError("visible value must not contain cycles");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (OPAQUE_KEYS.has(key) || hasOpaqueKey(child, seen)) return true;
  }
  seen.delete(value);
  return false;
}

function sortValue(value, seen = new Set()) {
  if (Array.isArray(value)) return value.map((entry) => sortValue(entry, seen));
  if (!isRecord(value)) {
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
      throw new TypeError("value must contain only JSON data");
    }
    return value;
  }
  if (seen.has(value)) throw new TypeError("value must not contain cycles");
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = sortValue(value[key], seen);
  seen.delete(value);
  return result;
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function freezeCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeCopy(entry)));
  if (!isRecord(value)) return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freezeCopy(child)])));
}

function visibleText(value) {
  return typeof value === "string" ? value : stableJson(value);
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

async function writeAtomic(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(temporary, value, { mode });
  await fs.rename(temporary, file);
}

async function writeIfAbsent(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(file, value, { mode, flag: "wx" });
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return false;
  }
}

async function appendJsonLine(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.appendFile(file, `${stableJson(value)}\n`, { mode: 0o600 });
}

async function readJson(file, label) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unavailable or invalid at ${file}`, { cause: error });
  }
}

async function readJsonLines(file, label) {
  let content;
  try {
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`${label} is unavailable at ${file}`, { cause: error });
  }
  return content.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${label} line ${index + 1} is invalid`, { cause: error });
    }
  });
}

function validateContextBlocks(blocks, label = "context") {
  if (!Array.isArray(blocks)) throw new TypeError(`${label} must be an array`);
  const names = new Set();
  return blocks.map((block, index) => {
    assertRecord(block, `${label}[${index}]`);
    const name = assertText(block.name, `${label}[${index}].name`);
    const text = assertText(block.text, `${label}[${index}].text`);
    if (names.has(name)) throw new TypeError(`${label} names must be unique`);
    names.add(name);
    return { name, text };
  });
}

function validateVisibleValue(value, label = "visible value") {
  if (!(typeof value === "string" || isRecord(value) || Array.isArray(value))) {
    throw new TypeError(`${label} must be text or JSON data`);
  }
  if (hasOpaqueKey(value)) throw new TypeError(`${label} must not contain opaque provider state`);
  stableJson(value);
  return value;
}

export function validateTaskPacket(packet) {
  assertRecord(packet, "task packet");
  const allowed = new Set(["id", "objective", "inputBundles", "allowedPaths", "writeMode", "expectedResult", "deadlineMs"]);
  for (const key of Object.keys(packet)) if (!allowed.has(key)) throw new TypeError(`task packet has unknown field ${key}`);
  const id = assertText(packet.id, "task packet.id");
  const objective = assertText(packet.objective, "task packet.objective");
  if (objective.length > 8000) throw new TypeError("task packet.objective is too large");
  if (!Array.isArray(packet.inputBundles) || packet.inputBundles.length > 100) throw new TypeError("task packet.inputBundles must contain at most 100 items");
  if (!packet.inputBundles.every((value) => typeof value === "string" && value.trim())) throw new TypeError("task packet.inputBundles must contain text IDs");
  if (!Array.isArray(packet.allowedPaths) || packet.allowedPaths.length > 100) throw new TypeError("task packet.allowedPaths must contain at most 100 items");
  if (!packet.allowedPaths.every((value) => typeof value === "string" && value.trim())) throw new TypeError("task packet.allowedPaths must contain text paths");
  if (!new Set(["read_only", "isolated_write"]).has(packet.writeMode)) throw new TypeError("task packet.writeMode must be read_only or isolated_write");
  if (!new Set(["answer", "patch", "test_report"]).has(packet.expectedResult)) throw new TypeError("task packet.expectedResult is invalid");
  if (packet.deadlineMs !== null) assertFiniteNumber(packet.deadlineMs, "task packet.deadlineMs", { min: 100, max: 3_600_000 });
  return freezeCopy({ id, objective, inputBundles: [...packet.inputBundles], allowedPaths: [...packet.allowedPaths], writeMode: packet.writeMode, expectedResult: packet.expectedResult, deadlineMs: packet.deadlineMs });
}

export function evaluateSubagentGate({ packet, sharedMutablePaths = [], openDependencyCount = 0, compaction = "idle", crossFamilyHandoff = false, classifier = null } = {}) {
  const reasons = [];
  let validatedPacket;
  try {
    validatedPacket = validateTaskPacket(packet);
  } catch (error) {
    return {
      action: "defer",
      reasonCodes: ["invalid_task_packet"],
      provider: "deterministic",
      confidence: null,
      compaction,
      error: error.message,
    };
  }
  if (validatedPacket.writeMode === "isolated_write" && sharedMutablePaths.length > 0) reasons.push("shared_mutable_path");
  if (openDependencyCount > 0) reasons.push("open_tool_dependency");
  if (crossFamilyHandoff) reasons.push("cross_family_handoff");
  if (!COMPACTION_STATES.has(compaction)) reasons.push("invalid_compaction_state");
  if (["needed", "in_flight", "sealed"].includes(compaction)) reasons.push("compaction_active");
  if (reasons.length > 0) {
    return {
      action: compaction === "idle" ? "keep_primary" : "defer",
      reasonCodes: reasons,
      provider: "deterministic",
      confidence: null,
      compaction,
    };
  }
  if (!classifier || !isRecord(classifier)) {
    return { action: "defer", reasonCodes: ["classifier_required"], provider: "deterministic", confidence: null, compaction };
  }
  const provider = classifier.provider;
  const label = classifier.label ?? classifier.answer?.choice;
  const confidence = classifier.confidence;
  if (!new Set(["classifier.dev", "jev"]).has(provider) || !new Set(["spawn", "keep_primary"]).has(label) || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { action: "defer", reasonCodes: ["malformed_classifier_result"], provider: "deterministic", confidence: null, compaction };
  }
  if (confidence < 0.8) return { action: "defer", reasonCodes: ["low_classifier_confidence"], provider, confidence, compaction };
  return { action: label, reasonCodes: ["classifier_approved"], provider, confidence, compaction };
}

export class ContextManager {
  constructor({ rootDir, branchId, modelFamily, providerScope = "codex", commonPrefix = [] } = {}) {
    this.rootDir = path.resolve(assertText(rootDir, "rootDir"));
    this.branchId = assertSafeSegment(branchId, "branchId");
    this.modelFamily = assertSafeSegment(modelFamily, "modelFamily");
    this.providerScope = assertSafeSegment(providerScope, "providerScope");
    this.commonPrefix = validateContextBlocks(commonPrefix, "commonPrefix");
    this.prefixFingerprint = sha256(stableJson(this.commonPrefix));
    this.writeQueue = Promise.resolve();
    this.paths = {
      manifest: path.join(this.rootDir, "manifest.json"),
      prefix: path.join(this.rootDir, "prefix.json"),
      ledger: path.join(this.rootDir, "ledger.jsonl"),
      placements: path.join(this.rootDir, "placements.jsonl"),
      blocks: path.join(this.rootDir, "blocks"),
      opaque: path.join(this.rootDir, "opaque"),
      prepared: path.join(this.rootDir, "prepared"),
      receipts: path.join(this.rootDir, "receipts"),
    };
  }

  async init() {
    await Promise.all([
      fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.paths.blocks, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.paths.opaque, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.paths.prepared, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.paths.receipts, { recursive: true, mode: 0o700 }),
    ]);
    const manifest = {
      schema_version: SCHEMA_VERSION,
      branch_id: this.branchId,
      model_family: this.modelFamily,
      provider_scope: this.providerScope,
      prefix_fingerprint: this.prefixFingerprint,
    };
    try {
      const existing = await readJson(this.paths.manifest, "context manifest");
      if (!sameJson(existing, manifest)) throw new Error("context manifest does not match branch or prefix ownership");
    } catch (error) {
      if (error.cause?.code !== "ENOENT") throw error;
      await writeAtomic(this.paths.manifest, `${stableJson(manifest)}\n`);
    }
    try {
      const existingPrefix = await readJson(this.paths.prefix, "context prefix");
      if (!sameJson(existingPrefix, this.commonPrefix)) throw new Error("common prefix is immutable");
    } catch (error) {
      if (error.cause?.code !== "ENOENT") throw error;
      await writeAtomic(this.paths.prefix, `${stableJson(this.commonPrefix)}\n`);
    }
    return this;
  }

  async readLedger({ includeValues = false } = {}) {
    await this.init();
    const events = await readJsonLines(this.paths.ledger, "context ledger");
    if (!includeValues) return events;
    return Promise.all(events.map(async (event) => ({ ...event, value: await this.readBlock(event.block_digest) })));
  }

  async readBlock(digest) {
    assertSafeSegment(digest, "block digest");
    return readJson(path.join(this.paths.blocks, `${digest}.json`), "visible block");
  }

  async head() {
    const events = await this.readLedger();
    return { count: events.length, lastEventId: events.at(-1)?.id ?? null };
  }

  async appendVisible({ kind, value, bundleId = null, metadata = {} } = {}) {
    return this.enqueueWrite(() => this.appendVisibleUnsafe({ kind, value, bundleId, metadata }));
  }

  async appendVisibleUnsafe({ kind, value, bundleId = null, metadata = {} } = {}) {
    await this.init();
    if (!EVENT_KINDS.has(kind)) throw new TypeError(`unknown visible event kind ${kind}`);
    validateVisibleValue(value);
    assertRecord(metadata, "event metadata");
    validateVisibleValue(metadata, "event metadata");
    const id = randomUUID();
    const resolvedBundleId = bundleId ?? id;
    assertSafeSegment(resolvedBundleId, "bundleId");
    if (kind === "tool_output") {
      const prior = await this.readLedger();
      const call = prior.find((event) => event.bundle_id === resolvedBundleId && event.kind === "tool_call");
      const output = prior.find((event) => event.bundle_id === resolvedBundleId && event.kind === "tool_output");
      if (!call) throw new Error("tool output requires a prior tool call");
      if (output) throw new Error("tool dependency already has an output");
    }
    const blockBytes = Buffer.from(`${stableJson(value)}\n`, "utf8");
    const blockDigest = sha256(blockBytes);
    await writeIfAbsent(path.join(this.paths.blocks, `${blockDigest}.json`), blockBytes);
    const event = {
      schema_version: SCHEMA_VERSION,
      id,
      branch_id: this.branchId,
      bundle_id: resolvedBundleId,
      kind,
      block_digest: blockDigest,
      metadata: sortValue(metadata),
      created_at: new Date().toISOString(),
    };
    await appendJsonLine(this.paths.ledger, event);
    return freezeCopy(event);
  }

  async appendToolCall({ bundleId = randomUUID(), name, arguments: callArguments = {} } = {}) {
    assertSafeSegment(bundleId, "bundleId");
    assertText(name, "tool name");
    validateVisibleValue(callArguments, "tool arguments");
    return this.appendVisible({ kind: "tool_call", bundleId, value: { name, arguments: callArguments } });
  }

  async appendToolOutput({ bundleId, output, status = "completed" } = {}) {
    assertSafeSegment(bundleId, "bundleId");
    assertText(status, "tool status");
    validateVisibleValue(output, "tool output");
    return this.appendVisible({ kind: "tool_output", bundleId, value: { status, output } });
  }

  async appendTaskPacket(packet) {
    const validated = validateTaskPacket(packet);
    return this.appendVisible({ kind: "task_packet", bundleId: validated.id, value: validated });
  }

  async appendResultPacket(result) {
    assertRecord(result, "result packet");
    const allowed = new Set(["taskId", "status", "discoveries", "filesChanged", "toolResults", "unresolved", "recommendedNextAction"]);
    for (const key of Object.keys(result)) if (!allowed.has(key)) throw new TypeError(`result packet has unknown field ${key}`);
    assertText(result.taskId, "result packet.taskId");
    if (!new Set(["completed", "failed", "cancelled"]).has(result.status)) throw new TypeError("result packet.status is invalid");
    for (const field of ["discoveries", "filesChanged", "toolResults", "unresolved"]) {
      if (!Array.isArray(result[field]) || !result[field].every((value) => typeof value === "string")) throw new TypeError(`result packet.${field} must be text[]`);
    }
    if (result.recommendedNextAction !== null && typeof result.recommendedNextAction !== "string") throw new TypeError("result packet.recommendedNextAction must be text or null");
    return this.appendVisible({ kind: "result_packet", bundleId: result.taskId, value: result });
  }

  async setPlacement(bundleId, placement) {
    return this.enqueueWrite(async () => {
    assertSafeSegment(bundleId, "bundleId");
    if (!PLACEMENTS.has(placement)) throw new TypeError("placement must be warm or cold");
    const events = await this.readLedger();
    if (!events.some((event) => event.bundle_id === bundleId)) throw new Error(`unknown bundle ${bundleId}`);
    await appendJsonLine(this.paths.placements, { schema_version: SCHEMA_VERSION, bundle_id: bundleId, placement, created_at: new Date().toISOString() });
    return { bundleId, placement };
    });
  }

  async currentPlacements() {
    const entries = await readJsonLines(this.paths.placements, "context placements");
    return new Map(entries.map((entry) => [entry.bundle_id, entry.placement]));
  }

  async dependencyGroups() {
    const events = await this.readLedger({ includeValues: true });
    const groups = new Map();
    for (const event of events) {
      if (!groups.has(event.bundle_id)) groups.set(event.bundle_id, []);
      groups.get(event.bundle_id).push(event);
    }
    return groups;
  }

  async assertCompleteBundle(bundleId) {
    const groups = await this.dependencyGroups();
    const events = groups.get(bundleId);
    if (!events) throw new Error(`unknown bundle ${bundleId}`);
    const hasCall = events.some((event) => event.kind === "tool_call");
    const hasOutput = events.some((event) => event.kind === "tool_output");
    if (hasCall !== hasOutput) throw new Error(`bundle ${bundleId} has an open tool dependency`);
    return events;
  }

  async prepare({ task, skillReference = null, selectedBundleIds = null, retrieveBundleIds = [] } = {}) {
    await this.init();
    assertText(task, "task");
    if (skillReference !== null) assertText(skillReference, "skillReference");
    if (selectedBundleIds !== null && (!Array.isArray(selectedBundleIds) || !selectedBundleIds.every((value) => typeof value === "string"))) {
      throw new TypeError("selectedBundleIds must be text[] or null");
    }
    if (!Array.isArray(retrieveBundleIds) || !retrieveBundleIds.every((value) => typeof value === "string")) throw new TypeError("retrieveBundleIds must be text[]");
    const groups = await this.dependencyGroups();
    const placements = await this.currentPlacements();
    const allIds = [...groups.keys()];
    const warmIds = allIds.filter((id) => placements.get(id) !== "cold");
    const selectedIds = [...new Set([...(selectedBundleIds ?? warmIds), ...retrieveBundleIds])];
    for (const id of selectedIds) await this.assertCompleteBundle(id);
    const events = await this.readLedger({ includeValues: true });
    const selected = events.filter((event) => selectedIds.includes(event.bundle_id));
    const suffix = [];
    if (skillReference !== null) suffix.push({ name: "skill-reference", text: skillReference });
    suffix.push(...selected.map((event) => ({ name: `visible:${event.id}`, text: visibleText(event.value) })));
    const context = validateContextBlocks([...this.commonPrefix, ...suffix], "rendered context");
    const prompt = { schema_version: PROMPT_SCHEMA_VERSION, context, task };
    const expectedHead = await this.head();
    const preparedId = randomUUID();
    const prepared = {
      schema_version: SCHEMA_VERSION,
      id: preparedId,
      branch_id: this.branchId,
      model_family: this.modelFamily,
      expected_head: expectedHead,
      selected_bundle_ids: selectedIds,
      cold_bundle_ids: allIds.filter((id) => !selectedIds.includes(id)),
      cache: {
        prefix_fingerprint: this.prefixFingerprint,
        prompt_fingerprint: sha256(stableJson(prompt)),
        prefix_bytes: Buffer.byteLength(stableJson({ schema_version: PROMPT_SCHEMA_VERSION, context: this.commonPrefix }), "utf8"),
        boundary_index: this.commonPrefix.length,
      },
      runner_request: prompt,
      created_at: new Date().toISOString(),
    };
    await writeAtomic(path.join(this.paths.prepared, `${preparedId}.json`), `${stableJson(prepared)}\n`);
    return freezeCopy(prepared);
  }

  async accept({ preparedId, observed, expectedHead } = {}) {
    return this.enqueueWrite(() => this.acceptUnsafe({ preparedId, observed, expectedHead }));
  }

  async acceptUnsafe({ preparedId, observed, expectedHead } = {}) {
    assertSafeSegment(preparedId, "preparedId");
    validateVisibleValue(observed, "runner observation");
    assertRecord(expectedHead, "expectedHead");
    const receiptPath = path.join(this.paths.receipts, `${preparedId}.json`);
    try {
      const existing = await readJson(receiptPath, "acceptance receipt");
      if (!sameJson(existing.observed, observed)) throw new Error("prepared turn was already accepted with a different observation");
      return freezeCopy(existing);
    } catch (error) {
      if (error.cause?.code !== "ENOENT") throw error;
    }
    const prepared = await readJson(path.join(this.paths.prepared, `${preparedId}.json`), "prepared turn");
    const currentHead = await this.head();
    if (!sameJson(prepared.expected_head, expectedHead) || !sameJson(currentHead, expectedHead)) throw new Error("stale context head");
    const event = await this.appendVisibleUnsafe({ kind: "runner_observation", value: observed, metadata: { prepared_id: preparedId } });
    const receipt = {
      schema_version: SCHEMA_VERSION,
      id: randomUUID(),
      prepared_id: preparedId,
      observation_event_id: event.id,
      observed,
      accepted_at: new Date().toISOString(),
    };
    await writeAtomic(receiptPath, `${stableJson(receipt)}\n`);
    return freezeCopy(receipt);
  }

  async storeOpaque({ family = this.modelFamily, branch = this.branchId, provider = this.providerScope, conversation = null, itemType, bytes } = {}) {
    return this.enqueueWrite(() => this.storeOpaqueUnsafe({ family, branch, provider, conversation, itemType, bytes }));
  }

  async storeOpaqueUnsafe({ family = this.modelFamily, branch = this.branchId, provider = this.providerScope, conversation = null, itemType, bytes } = {}) {
    const safeFamily = assertSafeSegment(family, "opaque family");
    const safeBranch = assertSafeSegment(branch, "opaque branch");
    const safeProvider = assertSafeSegment(provider, "opaque provider");
    const safeType = assertSafeSegment(itemType, "opaque itemType");
    if (conversation !== null && typeof conversation !== "string") throw new TypeError("opaque conversation must be text or null");
    const raw = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(assertText(bytes, "opaque bytes"), "utf8");
    const digest = sha256(raw);
    const directory = path.join(this.paths.opaque, safeProvider, safeFamily, safeBranch, safeType);
    const rawPath = path.join(directory, `${digest}.bin`);
    const metadataPath = path.join(directory, `${digest}.json`);
    await writeIfAbsent(rawPath, raw, 0o600);
    const descriptor = {
      schema_version: SCHEMA_VERSION,
      family: safeFamily,
      branch: safeBranch,
      provider: safeProvider,
      conversation,
      item_type: safeType,
      sha256: digest,
      byte_length: raw.byteLength,
      artifact: path.relative(this.rootDir, rawPath),
    };
    const created = await writeIfAbsent(metadataPath, `${stableJson(descriptor)}\n`);
    if (!created) {
      const existing = await readJson(metadataPath, "opaque descriptor");
      if (!sameJson(existing, descriptor)) throw new Error("opaque descriptor collision");
    }
    return freezeCopy(descriptor);
  }

  async readOpaque(descriptor) {
    assertRecord(descriptor, "opaque descriptor");
    if (descriptor.family !== this.modelFamily || descriptor.branch !== this.branchId || descriptor.provider !== this.providerScope) {
      throw new Error("opaque artifact ownership mismatch");
    }
    assertSafeSegment(descriptor.item_type, "opaque item_type");
    assertSafeSegment(descriptor.sha256, "opaque sha256");
    if (!/^[a-f0-9]{64}$/u.test(descriptor.sha256)) throw new TypeError("opaque sha256 must be a SHA-256 digest");
    if (!Number.isSafeInteger(descriptor.byte_length) || descriptor.byte_length < 0) {
      throw new TypeError("opaque byte_length must be a non-negative integer");
    }
    const expectedArtifact = path.relative(
      this.rootDir,
      path.join(this.paths.opaque, this.providerScope, this.modelFamily, this.branchId, descriptor.item_type, `${descriptor.sha256}.bin`),
    );
    if (descriptor.artifact !== expectedArtifact) throw new Error("opaque artifact path does not match its ownership descriptor");
    const rawPath = path.join(this.rootDir, expectedArtifact);
    const raw = await fs.readFile(rawPath);
    if (sha256(raw) !== descriptor.sha256 || raw.byteLength !== descriptor.byte_length) throw new Error("opaque artifact digest mismatch");
    return Buffer.from(raw);
  }

  async sealCompaction({ bytes, conversation = null } = {}) {
    const descriptor = await this.storeOpaque({ itemType: "compaction", bytes, conversation });
    const event = await this.recordCompaction({ state: "sealed", descriptor });
    return { descriptor, event };
  }

  async recordCompaction({ state, descriptor = null, sourceHead = null } = {}) {
    if (!COMPACTION_STATES.has(state)) throw new TypeError("compaction state is invalid");
    if (descriptor !== null) {
      assertRecord(descriptor, "compaction descriptor");
      if (descriptor.family !== this.modelFamily || descriptor.branch !== this.branchId || descriptor.provider !== this.providerScope) {
        throw new Error("compaction descriptor ownership mismatch");
      }
      assertSafeSegment(descriptor.item_type, "compaction descriptor item_type");
      assertSafeSegment(descriptor.sha256, "compaction descriptor sha256");
      if (!/^[a-f0-9]{64}$/u.test(descriptor.sha256)) throw new TypeError("compaction descriptor sha256 must be a SHA-256 digest");
      if (!Number.isSafeInteger(descriptor.byte_length) || descriptor.byte_length < 0) {
        throw new TypeError("compaction descriptor byte_length must be a non-negative integer");
      }
      const expectedArtifact = path.relative(
        this.rootDir,
        path.join(this.paths.opaque, this.providerScope, this.modelFamily, this.branchId, descriptor.item_type, `${descriptor.sha256}.bin`),
      );
      if (descriptor.artifact !== expectedArtifact) throw new Error("compaction descriptor artifact path is invalid");
    }
    if (sourceHead !== null) {
      assertRecord(sourceHead, "compaction source head");
      if (!Number.isSafeInteger(sourceHead.count) || sourceHead.count < 0) throw new TypeError("compaction source head count is invalid");
      if (sourceHead.lastEventId !== null && typeof sourceHead.lastEventId !== "string") throw new TypeError("compaction source head event ID is invalid");
    }
    return this.appendVisible({
      kind: "compaction",
      value: {
        state,
        descriptor: descriptor === null ? null : {
          family: descriptor.family,
          branch: descriptor.branch,
          provider: descriptor.provider,
          item_type: descriptor.item_type,
          sha256: descriptor.sha256,
          byte_length: descriptor.byte_length,
          artifact: descriptor.artifact,
        },
        source_head: sourceHead,
      },
    });
  }

  enqueueWrite(operation) {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => {});
    return next;
  }
}

export { COMPACTION_STATES, EVENT_KINDS, PROMPT_SCHEMA_VERSION, SCHEMA_VERSION, stableJson };
