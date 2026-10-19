#!/usr/bin/env node

import { CodexAppServerClient, elapsedMs } from "./codex-app-server-client.mjs";
import { ContextManager, stableJson } from "./context-manager.mjs";

const CAPABILITIES = Object.freeze({
  observe: true,
  cancel: true,
  send_next_turn: true,
  steer_live: true,
  fork: false,
  inject_visible_items: false,
});

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(label + " must be non-empty text");
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(label + " must be an array");
  return value;
}

function appServerInput(text) {
  return [{ type: "text", text }];
}

function elapsedMilliseconds(startedAt) {
  return Math.round(elapsedMs(startedAt));
}

function providerTiming(result) {
  return {
    provider_turn_ms: result.elapsed_ms,
    provider_first_event_ms: result.first_event_ms,
    provider_first_token_ms: result.first_token_ms,
    provider_after_first_token_ms: result.first_token_ms === null ? null : Math.max(0, result.elapsed_ms - result.first_token_ms),
  };
}

function promptText(prepared, mode) {
  if (mode === "full") return stableJson(prepared.runner_request);
  const suffix = prepared.runner_request.context.slice(prepared.cache.boundary_index);
  return stableJson({
    schema_version: prepared.runner_request.schema_version,
    context: suffix,
    task: prepared.runner_request.task,
  });
}

function observation(result, client, timing) {
  return {
    transport: "app-server",
    status: result.status,
    thread_id: result.threadId,
    turn_id: result.turnId,
    failure_kind: result.failure_kind ?? null,
    elapsed_ms: result.elapsed_ms,
    first_event_ms: result.first_event_ms,
    first_token_ms: result.first_token_ms,
    observer_trace: result.observer_trace ?? [],
    observer_trace_truncated: result.observer_trace_truncated === true,
    event_count: result.event_count,
    opaque_items_seen: result.opaque_items_seen,
    compaction_items_seen: result.compaction_items_seen,
    server_requests: client.serverRequestCount,
    usage: result.usage ?? null,
    timing: Object.freeze({ ...timing }),
  };
}

export class CodexPrimarySession {
  constructor({
    rootDir,
    branchId,
    modelFamily,
    providerScope = "codex",
    commonPrefix = [],
    model,
    reasoningEffort = null,
    cwd = process.cwd(),
    command = "codex",
    commandArgs = ["app-server", "--listen", "stdio://"],
    env = process.env,
    sandbox = "read-only",
    ephemeral = false,
    approvalPolicy = "never",
    requestTimeoutMs,
    turnTimeoutMs,
    onEvent = null,
    client = null,
  } = {}) {
    this.model = assertText(model, "model");
    this.reasoningEffort = reasoningEffort;
    this.cwd = assertText(cwd, "cwd");
    this.sandbox = sandbox;
    this.ephemeral = Boolean(ephemeral);
    this.approvalPolicy = approvalPolicy;
    this.manager = new ContextManager({
      rootDir: assertText(rootDir, "rootDir"),
      branchId: assertText(branchId, "branchId"),
      modelFamily: assertText(modelFamily, "modelFamily"),
      providerScope,
      commonPrefix,
    });
    this.opaqueQueue = Promise.resolve();
    this.opaqueDescriptors = [];
    this.thread = null;
    this.activeTurnId = null;
    this.lastTurnId = null;
    this.turnCount = 0;
    this.steerLiveProven = false;
    this.pendingSteers = [];
    this.running = false;
    this.initialized = false;
    this.initializationTiming = null;
    const handleEvent = (event) => {
      if (event.method === "turn/started") this.activeTurnId = event.turnId;
      if (typeof onEvent === "function") onEvent(event);
    };
    if (client) {
      this.client = client;
      const previousOnEvent = client.onEvent;
      const previousOnOpaqueItem = client.onOpaqueItem;
      client.onEvent = (event) => {
        handleEvent(event);
        if (typeof previousOnEvent === "function") previousOnEvent(event);
      };
      client.onOpaqueItem = (item) => {
        this.queueOpaqueItem(item);
        if (typeof previousOnOpaqueItem === "function") previousOnOpaqueItem(item);
      };
    } else {
      this.client = new CodexAppServerClient({
        command,
        args: commandArgs,
        cwd,
        env,
        requestTimeoutMs,
        turnTimeoutMs,
        onEvent: handleEvent,
        onOpaqueItem: (item) => this.queueOpaqueItem(item),
      });
    }
  }

  get capabilities() {
    return Object.freeze({ ...CAPABILITIES, steer_live: this.steerLiveProven });
  }

  async init() {
    if (this.initialized) return this;
    const initStartedAt = process.hrtime.bigint();
    const managerStartedAt = process.hrtime.bigint();
    await this.manager.init();
    const managerInitMs = elapsedMilliseconds(managerStartedAt);
    const connectionStartedAt = process.hrtime.bigint();
    await this.client.connect();
    const connectMs = elapsedMilliseconds(connectionStartedAt);
    const threadStartedAt = process.hrtime.bigint();
    this.thread = await this.client.startThread({
      model: this.model,
      reasoningEffort: this.reasoningEffort,
      cwd: this.cwd,
      sandbox: this.sandbox,
      ephemeral: this.ephemeral,
      approvalPolicy: this.approvalPolicy,
    });
    this.initializationTiming = Object.freeze({
      total_ms: elapsedMilliseconds(initStartedAt),
      manager_init_ms: managerInitMs,
      connect_ms: connectMs,
      thread_start_ms: elapsedMilliseconds(threadStartedAt),
    });
    this.initialized = true;
    return this;
  }

  async run({ task, skillReference = null, selectedBundleIds = null, retrieveBundleIds = [] } = {}) {
    if (this.running) throw new Error("a primary turn is already running");
    assertText(task, "task");
    if (skillReference !== null) assertText(skillReference, "skillReference");
    assertArray(retrieveBundleIds, "retrieveBundleIds");
    if (!retrieveBundleIds.every((value) => typeof value === "string" && value.trim())) {
      throw new TypeError("retrieveBundleIds must contain non-empty text");
    }
    await this.init();
    if (this.running) throw new Error("a primary turn is already running");
    this.running = true;
    const runStartedAt = process.hrtime.bigint();
    const timing = {
      initialization: this.initializationTiming,
      append_visible_ms: null,
      prepare_ms: null,
      ...providerTiming({ elapsed_ms: null, first_event_ms: null, first_token_ms: null }),
      opaque_drain_ms: null,
      accept_ms: null,
      finalize_ms: null,
      session_run_ms: null,
    };
    try {
      const appendStartedAt = process.hrtime.bigint();
      const userEvent = await this.manager.appendVisible({
        kind: "message",
        value: { role: "user", text: task },
      });
      timing.append_visible_ms = elapsedMilliseconds(appendStartedAt);
      const mode = this.turnCount === 0 ? "full" : "suffix";
      const selected = mode === "full"
        ? selectedBundleIds
        : [...new Set([userEvent.bundle_id, ...retrieveBundleIds])];
      const prepareStartedAt = process.hrtime.bigint();
      const prepared = await this.manager.prepare({
        task,
        skillReference,
        selectedBundleIds: selected,
        retrieveBundleIds,
      });
      timing.prepare_ms = elapsedMilliseconds(prepareStartedAt);
      const providerStartedAt = process.hrtime.bigint();
      const result = await this.client.runTurn({
        threadId: this.thread.threadId,
        input: appServerInput(promptText(prepared, mode)),
        model: this.model,
        cwd: this.cwd,
      });
      timing.provider_turn_call_ms = elapsedMilliseconds(providerStartedAt);
      Object.assign(timing, providerTiming(result));
      const opaqueStartedAt = process.hrtime.bigint();
      await this.opaqueQueue;
      timing.opaque_drain_ms = elapsedMilliseconds(opaqueStartedAt);
      const observed = observation(result, this.client, timing);
      const acceptStartedAt = process.hrtime.bigint();
      await this.manager.accept({
        preparedId: prepared.id,
        observed,
        expectedHead: prepared.expected_head,
      });
      timing.accept_ms = elapsedMilliseconds(acceptStartedAt);
      const finalizeStartedAt = process.hrtime.bigint();
      for (const receipt of this.pendingSteers.splice(0)) {
        await this.manager.appendVisible({ kind: "steering", value: receipt });
      }
      for (const descriptor of this.opaqueDescriptors.splice(0)) {
        if (descriptor.item_type === "compaction") {
          await this.manager.recordCompaction({ state: "sealed", descriptor });
        }
      }
      if (result.assistant_text) {
        await this.manager.appendVisible({
          kind: "message",
          value: {
            role: "assistant",
            text: result.assistant_text,
            truncated: result.assistant_text_truncated === true,
          },
        });
      }
      timing.finalize_ms = elapsedMilliseconds(finalizeStartedAt);
      timing.session_run_ms = elapsedMilliseconds(runStartedAt);
      this.lastTurnId = result.turnId;
      this.turnCount += 1;
      if (result.turnId && result.usage) this.steerLiveProven = true;
      return Object.freeze({
        prepared_id: prepared.id,
        expected_head: prepared.expected_head,
        prompt_mode: mode,
        cache: prepared.cache,
        selected_bundle_ids: prepared.selected_bundle_ids,
        cold_bundle_ids: prepared.cold_bundle_ids,
        timing: Object.freeze({ ...timing }),
        ...result,
      });
    } catch (error) {
      await this.opaqueQueue;
      this.pendingSteers = [];
      throw error;
    } finally {
      this.activeTurnId = null;
      this.running = false;
    }
  }

  async steer(input) {
    if (!this.thread?.threadId || !this.activeTurnId) throw new Error("no active primary turn");
    const expectedTurnId = this.activeTurnId;
    const result = await this.client.steer({
      threadId: this.thread.threadId,
      expectedTurnId,
      input: appServerInput(assertText(input, "steer input")),
    });
    const receipt = Object.freeze({
      state: "queued",
      thread_id: this.thread.threadId,
      turn_id: expectedTurnId,
      text: input,
      provider_result: result ?? null,
    });
    this.pendingSteers.push(receipt);
    return receipt;
  }

  async interrupt() {
    if (!this.thread?.threadId || !this.activeTurnId) throw new Error("no active primary turn");
    return this.client.interrupt({ threadId: this.thread.threadId, turnId: this.activeTurnId });
  }

  async compact() {
    if (!this.thread?.threadId) throw new Error("no active primary thread");
    return this.client.compact({ threadId: this.thread.threadId });
  }

  async close() {
    await this.opaqueQueue;
    await this.client.close();
    this.initialized = false;
    this.initializationTiming = null;
    this.thread = null;
    this.activeTurnId = null;
  }

  queueOpaqueItem(item) {
    const itemType = item?.type === "contextCompaction" ? "compaction" : item?.type === "reasoning" ? "reasoning" : "provider";
    const bytes = JSON.stringify(item);
    this.opaqueQueue = this.opaqueQueue.then(async () => {
      const descriptor = await this.manager.storeOpaque({ itemType, bytes });
      this.opaqueDescriptors.push(descriptor);
    });
  }
}

export { CAPABILITIES, appServerInput, promptText };
