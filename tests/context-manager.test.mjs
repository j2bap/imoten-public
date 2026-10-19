import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ContextManager,
  evaluateSubagentGate,
  stableJson,
} from "../skills/setup-pstack/scripts/context-manager.mjs";

async function withManager(options = {}, callback) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "pstack-context-manager-"));
  try {
    const manager = new ContextManager({
      rootDir,
      branchId: "branch-a",
      modelFamily: "gpt-5-6",
      providerScope: "codex",
      commonPrefix: [
        { name: "system", text: "stable system instructions" },
        { name: "schema", text: "stable schema v1" },
      ],
      ...options,
    });
    await callback(manager, rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

function taskPacket(overrides = {}) {
  return {
    id: "task-1",
    objective: "Inspect the fixture and return a report.",
    inputBundles: [],
    allowedPaths: ["docs/"],
    writeMode: "read_only",
    expectedResult: "test_report",
    deadlineMs: 10_000,
    ...overrides,
  };
}

test("renders a deterministic prompt with the skill after the cache boundary", async () => {
  await withManager({}, async (manager) => {
    const first = await manager.prepare({ task: "same task", skillReference: "skill@v1" });
    const second = await manager.prepare({ task: "same task", skillReference: "skill@v1" });
    assert.equal(stableJson(first.runner_request), stableJson(second.runner_request));
    assert.equal(first.cache.prefix_fingerprint, second.cache.prefix_fingerprint);
    assert.equal(first.cache.boundary_index, 2);
    assert.deepEqual(first.runner_request.context.slice(0, 2), [
      { name: "system", text: "stable system instructions" },
      { name: "schema", text: "stable schema v1" },
    ]);
    assert.equal(first.runner_request.context[2].name, "skill-reference");
    assert.equal(first.runner_request.context.some((entry) => /encrypted_content|opaque/u.test(entry.text)), false);
  });
});

test("preserves tool dependency groups and moves complete bundles to cold storage", async () => {
  await withManager({}, async (manager) => {
    const call = await manager.appendToolCall({ bundleId: "tool-1", name: "read_file", arguments: { path: "docs/README.md" } });
    await assert.rejects(
      manager.prepare({ task: "before output" }),
      /open tool dependency/u,
    );
    const output = await manager.appendToolOutput({ bundleId: call.bundle_id, output: "contents" });
    assert.equal(output.bundle_id, call.bundle_id);
    await manager.setPlacement(call.bundle_id, "cold");
    const warm = await manager.prepare({ task: "omit cold bundle" });
    assert.deepEqual(warm.selected_bundle_ids, []);
    assert.deepEqual(warm.cold_bundle_ids, ["tool-1"]);
    const retrieved = await manager.prepare({ task: "retrieve cold bundle", retrieveBundleIds: ["tool-1"] });
    assert.deepEqual(retrieved.selected_bundle_ids, ["tool-1"]);
    assert.equal(retrieved.runner_request.context.filter((entry) => entry.name.startsWith("visible:")).length, 2);
  });
});

test("accepts a prepared turn once and rejects a stale head", async () => {
  await withManager({}, async (manager) => {
    const prepared = await manager.prepare({ task: "record observation" });
    const observed = { status: "completed", events: 3, usage: { inputTokens: 10 } };
    const receipt = await manager.accept({ preparedId: prepared.id, observed, expectedHead: prepared.expected_head });
    const duplicate = await manager.accept({ preparedId: prepared.id, observed, expectedHead: prepared.expected_head });
    assert.deepEqual(duplicate, receipt);
    const stale = await manager.prepare({ task: "stale check" });
    await manager.appendVisible({ kind: "message", value: "changed after prepare" });
    await assert.rejects(
      manager.accept({ preparedId: stale.id, observed: { status: "completed" }, expectedHead: stale.expected_head }),
      /stale context head/u,
    );
  });
});

test("serializes concurrent writes through one manager queue", async () => {
  await withManager({}, async (manager) => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => manager.appendVisible({ kind: "message", value: `message-${index}` })));
    const ledger = await manager.readLedger({ includeValues: true });
    assert.equal(ledger.length, 12);
    assert.equal(new Set(ledger.map((event) => event.id)).size, 12);
    assert.deepEqual(new Set(ledger.map((event) => event.value)), new Set(Array.from({ length: 12 }, (_, index) => `message-${index}`)));
  });
});

test("stores bounded task and result packets as visible ledger events", async () => {
  await withManager({}, async (manager) => {
    const task = taskPacket({ id: "task-visible" });
    const taskEvent = await manager.appendTaskPacket(task);
    const resultEvent = await manager.appendResultPacket({
      taskId: task.id,
      status: "completed",
      discoveries: ["visible discovery"],
      filesChanged: [],
      toolResults: ["test passed"],
      unresolved: [],
      recommendedNextAction: null,
    });
    assert.equal(taskEvent.kind, "task_packet");
    assert.equal(resultEvent.kind, "result_packet");
    const values = await manager.readLedger({ includeValues: true });
    assert.deepEqual(values.map((event) => event.kind), ["task_packet", "result_packet"]);
    assert.equal(values[1].value.taskId, "task-visible");
  });
});

test("keeps opaque artifacts immutable and branch-scoped", async () => {
  await withManager({}, async (manager) => {
    const descriptor = await manager.storeOpaque({ itemType: "reasoning", bytes: Buffer.from("opaque bytes") });
    assert.deepEqual(await manager.readOpaque(descriptor), Buffer.from("opaque bytes"));
    const sealed = await manager.sealCompaction({ bytes: Buffer.from("sealed window"), conversation: "conversation-1" });
    assert.equal(sealed.event.kind, "compaction");
    assert.equal(sealed.event.block_digest.length, 64);
    assert.deepEqual(await manager.readOpaque(sealed.descriptor), Buffer.from("sealed window"));
    await assert.rejects(
      manager.readOpaque({ ...descriptor, artifact: "../../outside.bin" }),
      /artifact path/u,
    );
    const otherBranch = new ContextManager({ rootDir: manager.rootDir, branchId: "branch-b", modelFamily: "gpt-5-6" });
    await assert.rejects(otherBranch.readOpaque(descriptor), /ownership mismatch/u);
  });
});

test("vetoes unsafe subagent work before classification and defers weak results", () => {
  const packet = taskPacket({ writeMode: "isolated_write" });
  assert.deepEqual(
    evaluateSubagentGate({ packet, sharedMutablePaths: ["src/shared.js"], classifier: { provider: "classifier.dev", label: "spawn", confidence: 0.99 } }),
    {
      action: "keep_primary",
      reasonCodes: ["shared_mutable_path"],
      provider: "deterministic",
      confidence: null,
      compaction: "idle",
    },
  );
  assert.deepEqual(
    evaluateSubagentGate({ packet: taskPacket(), openDependencyCount: 1, classifier: { provider: "classifier.dev", label: "spawn", confidence: 0.99 } }).action,
    "keep_primary",
  );
  assert.deepEqual(
    evaluateSubagentGate({ packet: taskPacket(), classifier: { provider: "classifier.dev", label: "spawn", confidence: 0.79 } }),
    {
      action: "defer",
      reasonCodes: ["low_classifier_confidence"],
      provider: "classifier.dev",
      confidence: 0.79,
      compaction: "idle",
    },
  );
  assert.equal(
    evaluateSubagentGate({ packet: taskPacket(), classifier: { provider: "classifier.dev", label: "spawn", confidence: 0.9 } }).action,
    "spawn",
  );
  assert.equal(
    evaluateSubagentGate({ packet: taskPacket(), compaction: "in_flight", classifier: { provider: "classifier.dev", label: "spawn", confidence: 0.9 } }).action,
    "defer",
  );
});
