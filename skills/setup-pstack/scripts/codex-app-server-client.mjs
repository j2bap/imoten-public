#!/usr/bin/env node

import { spawn as defaultSpawn } from "node:child_process";
import { createInterface } from "node:readline";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TURN_TIMEOUT_MS = 300_000;
const MAX_STDERR_BYTES = 8 * 1024;
const MAX_OBSERVER_TRACE_EVENTS = 128;
const ASSISTANT_MESSAGE_ITEM_TYPES = new Set(["agent_message", "agentMessage"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be non-empty text`);
  return value;
}

function assertFiniteInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function normalizeUsage(value) {
  if (!isRecord(value)) return null;
  const read = (...keys) => {
    for (const key of keys) {
      if (Number.isSafeInteger(value[key])) return value[key];
    }
    return null;
  };
  const usage = {
    input_tokens: read("inputTokens", "input_tokens"),
    cached_input_tokens: read("cachedInputTokens", "cached_input_tokens"),
    cache_write_input_tokens: read("cacheWriteInputTokens", "cache_write_input_tokens"),
    output_tokens: read("outputTokens", "output_tokens"),
    reasoning_output_tokens: read("reasoningOutputTokens", "reasoning_output_tokens"),
    total_tokens: read("totalTokens", "total_tokens"),
  };
  return Object.values(usage).some((entry) => entry !== null) ? usage : null;
}

function turnUsage(total, baseline) {
  if (!total || !baseline) return null;
  return Object.fromEntries(Object.entries(total).map(([key, value]) => {
    const previous = Object.hasOwn(baseline, key) ? baseline[key] : 0;
    return [key, value !== null && previous !== null && value >= previous ? value - previous : null];
  }));
}

function countOpaqueKeys(value, seen = new Set()) {
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + countOpaqueKeys(entry, seen), 0);
  if (!isRecord(value)) return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (["encrypted_content", "encryptedContent"].includes(key)) count += 1;
    count += countOpaqueKeys(child, seen);
  }
  seen.delete(value);
  return count;
}

function classifyStderr(stderr) {
  if (/failed to initialize sqlite state runtime|failed to initialize state runtime/u.test(stderr)) return "state_runtime_init_failed";
  if (/failed to initialize in-process app-server client/u.test(stderr)) return "nested_app_server_init_failed";
  if (/operation not permitted/u.test(stderr)) return "operation_not_permitted";
  if (/authentication|unauthorized|forbidden/u.test(stderr)) return "provider_auth_failed";
  if (stderr.trim()) return "provider_error_unclassified";
  return null;
}

function classifyTurnFailure(params) {
  const info = params?.turn?.error?.codexErrorInfo ?? params?.error?.codexErrorInfo;
  const fields = info && typeof info === "object" ? Object.keys(info) : [];
  const known = new Map([
    ["ContextWindowExceeded", "context_window_exceeded"],
    ["UsageLimitExceeded", "usage_limit_exceeded"],
    ["HttpConnectionFailed", "http_connection_failed"],
    ["ResponseStreamConnectionFailed", "response_stream_connection_failed"],
    ["ResponseStreamDisconnected", "response_stream_disconnected"],
    ["ResponseTooManyFailedAttempts", "response_too_many_failed_attempts"],
    ["Unauthorized", "provider_unauthorized"],
    ["SandboxError", "sandbox_error"],
    ["BadRequest", "bad_request"],
    ["InternalServerError", "provider_internal_error"],
  ]);
  for (const field of fields) {
    if (known.has(field)) return known.get(field);
  }
  for (const value of [info?.type, info?.name, info?.code]) {
    if (typeof value === "string" && known.has(value)) return known.get(value);
  }
  return params?.turn?.status === "failed" ? "provider_turn_failed" : null;
}

function rpcError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function readTurnId(params) {
  return params?.turn?.id ?? params?.turnId ?? null;
}

function readThreadId(params) {
  return params?.threadId ?? params?.thread?.id ?? null;
}

export class CodexAppServerClient {
  constructor({
    command = "codex",
    args = ["app-server", "--listen", "stdio://"],
    cwd = process.cwd(),
    env = process.env,
    spawnImpl = defaultSpawn,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
    onEvent = null,
    onOpaqueItem = null,
  } = {}) {
    this.command = assertText(command, "command");
    if (!Array.isArray(args) || !args.every((entry) => typeof entry === "string")) throw new TypeError("args must be text[]");
    this.args = [...args];
    this.cwd = assertText(cwd, "cwd");
    this.env = { ...env };
    this.spawnImpl = spawnImpl;
    this.requestTimeoutMs = assertFiniteInteger(requestTimeoutMs, "requestTimeoutMs", { min: 100, max: 3_600_000 });
    this.turnTimeoutMs = assertFiniteInteger(turnTimeoutMs, "turnTimeoutMs", { min: 100, max: 3_600_000 });
    this.onEvent = onEvent;
    this.onOpaqueItem = onOpaqueItem;
    this.child = null;
    this.readline = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.turnWaiters = new Map();
    this.threadUsage = new Map();
    this.stderr = "";
    this.closed = false;
    this.connected = false;
    this.threadId = null;
    this.threadIds = new Set();
    this.serverRequestCount = 0;
    this.protocolEventCount = 0;
  }

  async connect() {
    if (this.connected) return this;
    if (this.child) throw new Error("app-server connection is already starting");
    this.closed = false;
    let child;
    try {
      child = this.spawnImpl(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      throw rpcError("failed to start Codex app-server", { cause: error, kind: "spawn_failed" });
    }
    this.child = child;
    child.stderr?.on("data", (chunk) => {
      const next = `${this.stderr}${String(chunk)}`;
      this.stderr = Buffer.byteLength(next) > MAX_STDERR_BYTES ? next.slice(-MAX_STDERR_BYTES) : next;
    });
    child.once("error", (error) => this.failConnection(rpcError("Codex app-server process failed", { cause: error, kind: "process_error" })));
    child.once("close", (code, signal) => {
      this.failConnection(rpcError("Codex app-server process closed", {
        kind: "process_closed",
        exitCode: code,
        signal,
        stderrKind: classifyStderr(this.stderr),
      }));
    });
    this.readline = createInterface({ input: child.stdout });
    this.readline.on("line", (line) => this.handleLine(line));
    try {
      await this.request("initialize", {
        clientInfo: { name: "pstack-context-manager", title: "Pstack context manager", version: "0.1.0" },
      });
      this.notify("initialized", {});
      this.connected = true;
      return this;
    } catch (error) {
      this.failConnection(error);
      throw this.decorateError(error);
    }
  }

  async startThread({ model = null, reasoningEffort = null, cwd = this.cwd, sandbox = "read-only", ephemeral = true, approvalPolicy = "never" } = {}) {
    await this.connect();
    if (sandbox !== "read-only" && sandbox !== "workspace-write" && sandbox !== "danger-full-access") {
      throw new TypeError("sandbox must be read-only, workspace-write, or danger-full-access");
    }
    const result = await this.request("thread/start", {
      model,
      cwd,
      sandbox,
      ephemeral: Boolean(ephemeral),
      approvalPolicy,
      ...(reasoningEffort === null ? {} : { config: { model_reasoning_effort: reasoningEffort } }),
      threadSource: "appServer",
    });
    const threadId = result?.thread?.id;
    if (typeof threadId !== "string" || !threadId) throw new Error("app-server did not return a thread ID");
    this.threadId = threadId;
    this.threadIds.add(threadId);
    this.threadUsage.set(threadId, {});
    return {
      threadId,
      settings: {
        model: result.model ?? null,
        reasoning_effort: result.reasoningEffort ?? null,
        cwd: result.cwd ?? null,
        approval_policy: result.approvalPolicy ?? null,
        sandbox: result.sandbox ?? null,
      },
    };
  }

  async runTurn({ threadId = this.threadId, input, model, cwd, sandboxPolicy, approvalPolicy, timeoutMs = this.turnTimeoutMs } = {}) {
    if (!this.connected || !threadId || !this.threadIds.has(threadId)) throw new Error("app-server thread is not started");
    if (!Array.isArray(input) || input.length === 0) throw new TypeError("input must be a non-empty array");
    assertFiniteInteger(timeoutMs, "timeoutMs", { min: 100, max: 3_600_000 });
    const startedAt = process.hrtime.bigint();
    const state = {
      threadId,
      turnId: null,
      startedAt,
      firstEventMs: null,
      firstTokenMs: null,
      eventCount: 0,
      observerTrace: [],
      observerTraceTruncated: false,
      opaqueItemsSeen: 0,
      compactionItemsSeen: 0,
      usage: null,
      usageBaseline: this.threadUsage.get(threadId) ?? null,
      threadUsage: null,
      lastUsage: null,
      status: null,
      failureKind: null,
      error: null,
      settled: false,
      completion: null,
      assistantText: "",
      assistantTextTruncated: false,
      completionTimer: null,
      resolve: null,
      reject: null,
      timer: null,
    };
    const completion = new Promise((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });
    this.turnWaiters.set(threadId, state);
    state.timer = setTimeout(() => {
      const error = rpcError("Codex app-server turn timed out", { kind: "turn_timeout", threadId: state.threadId, turnId: state.turnId });
      state.error = error;
      if (!state.settled) {
        state.settled = true;
        state.reject(error);
      }
      if (state.completionTimer) clearImmediate(state.completionTimer);
      this.turnWaiters.delete(threadId);
      if (state.turnId) void this.request("turn/interrupt", { threadId: state.threadId, turnId: state.turnId }).catch(() => {});
    }, timeoutMs);
    try {
      const response = await this.request("turn/start", {
        threadId,
        input,
        model,
        cwd,
        sandboxPolicy,
        approvalPolicy,
        turnTrigger: "pstack-pilot",
      });
      state.turnId = response?.turn?.id ?? state.turnId;
      return await completion;
    } catch (error) {
      state.reject(error);
      throw this.decorateError(error);
    } finally {
      clearTimeout(state.timer);
      this.threadUsage.set(threadId, state.threadUsage);
      this.turnWaiters.delete(threadId);
    }
  }

  async steer({ threadId = this.threadId, expectedTurnId, input } = {}) {
    assertText(threadId, "threadId");
    assertText(expectedTurnId, "expectedTurnId");
    if (!Array.isArray(input) || input.length === 0) throw new TypeError("input must be a non-empty array");
    return this.request("turn/steer", { threadId, expectedTurnId, input });
  }

  async interrupt({ threadId = this.threadId, turnId } = {}) {
    assertText(threadId, "threadId");
    assertText(turnId, "turnId");
    return this.request("turn/interrupt", { threadId, turnId });
  }

  async compact({ threadId = this.threadId } = {}) {
    assertText(threadId, "threadId");
    return this.request("thread/compact/start", { threadId });
  }

  async close() {
    if (!this.child) return;
    this.closed = true;
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.child = null;
      this.readline = null;
      this.connected = false;
      this.threadId = null;
      this.threadIds.clear();
      this.threadUsage.clear();
      return;
    }
    this.readline?.close();
    this.child.kill?.("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child?.kill?.("SIGKILL");
        resolve();
      }, 2_000);
      this.child?.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = null;
    this.readline = null;
    this.connected = false;
    this.threadId = null;
    this.threadIds.clear();
    this.threadUsage.clear();
  }

  request(method, params) {
    assertText(method, "method");
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(rpcError(`Codex app-server request timed out: ${method}`, { kind: "request_timeout", method, id }));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    assertText(method, "method");
    this.write({ method, params });
  }

  write(message) {
    if (this.closed || !this.child?.stdin?.writable) throw new Error("Codex app-server is not writable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.protocolEventCount += 1;
      this.emitEvent({ kind: "malformed_line" });
      return;
    }
    this.protocolEventCount += 1;
    if (message?.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(rpcError(message.error.message ?? `Codex app-server request failed: ${pending.method}`, {
          kind: "rpc_error",
          method: pending.method,
          rpcCode: message.error.code,
        }));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message?.method === "string") {
      if (message.id !== undefined) {
        this.serverRequestCount += 1;
        try {
          this.write({ id: message.id, error: { code: -32601, message: "pstack pilot does not handle server requests" } });
        } catch {
          // The connection-close path will reject the active request.
        }
      }
      this.handleNotification(message.method, message.params);
    }
  }

  handleNotification(method, params) {
    const threadId = readThreadId(params);
    const state = threadId ? this.turnWaiters.get(threadId) : null;
    if (method === "thread/tokenUsage/updated" && threadId) {
      this.threadUsage.set(threadId, normalizeUsage(params?.tokenUsage?.total));
    }
    const opaqueItem = params?.item;
    const completedCompaction = method === "item/completed" && opaqueItem?.type === "contextCompaction";
    if (method === "item/completed" && opaqueItem && (countOpaqueKeys(opaqueItem) > 0 || completedCompaction) && typeof this.onOpaqueItem === "function") {
      this.onOpaqueItem(opaqueItem);
    }
    if (state) {
      state.eventCount += 1;
      if (state.observerTrace.length < MAX_OBSERVER_TRACE_EVENTS) {
        const run = method.startsWith("hook/") && isRecord(params?.run) ? params.run : null;
        state.observerTrace.push({
          index: state.eventCount,
          elapsed_ms: Math.round(elapsedMs(state.startedAt)),
          method,
          item_type: params?.item?.type ?? null,
          hook_event: run?.eventName ?? null,
          hook_handler: run?.handlerType ?? null,
          hook_mode: run?.executionMode ?? null,
          hook_scope: run?.scope ?? null,
          hook_source: run?.source ?? null,
          hook_duration_ms: run?.durationMs ?? null,
        });
      } else {
        state.observerTraceTruncated = true;
      }
      state.opaqueItemsSeen += countOpaqueKeys(params);
      if (method === "item/completed" && params?.item?.type === "contextCompaction") state.compactionItemsSeen += 1;
      if (method === "item/agentMessage/delta") {
        const delta = typeof params?.delta === "string" ? params.delta : typeof params?.text === "string" ? params.text : "";
        const nextBytes = Buffer.byteLength(state.assistantText, "utf8") + Buffer.byteLength(delta, "utf8");
        if (delta && nextBytes <= 1_048_576) state.assistantText += delta;
        else if (delta) state.assistantTextTruncated = true;
      }
      if (method === "item/completed" && ASSISTANT_MESSAGE_ITEM_TYPES.has(params?.item?.type) && typeof params.item.text === "string" && !state.assistantText) {
        const text = params.item.text;
        if (Buffer.byteLength(text, "utf8") <= 1_048_576) state.assistantText = text;
        else {
          state.assistantText = Buffer.from(text, "utf8").subarray(0, 1_048_576).toString("utf8");
          state.assistantTextTruncated = true;
        }
      }
      if (state.firstEventMs === null && ["turn/started", "item/started", "item/agentMessage/delta", "item/commandExecution/outputDelta"].includes(method)) {
        state.firstEventMs = elapsedMs(state.startedAt);
      }
      if (state.firstTokenMs === null && /\/delta$/u.test(method)) state.firstTokenMs = elapsedMs(state.startedAt);
      if (method === "turn/started" && !state.turnId) state.turnId = readTurnId(params);
      if (method === "thread/tokenUsage/updated") {
        state.lastUsage = normalizeUsage(params?.tokenUsage?.last);
        state.threadUsage = this.threadUsage.get(threadId);
        state.usage = turnUsage(state.threadUsage, state.usageBaseline);
      }
      if (method === "turn/completed" && !state.settled && !state.completion) {
        state.turnId = readTurnId(params) ?? state.turnId;
        state.status = params?.turn?.status ?? "completed";
        state.failureKind = classifyTurnFailure(params);
        state.completion = {
          threadId,
          turnId: state.turnId,
          status: state.status,
          failure_kind: state.failureKind,
          elapsed_ms: Math.round(elapsedMs(state.startedAt)),
          first_event_ms: state.firstEventMs === null ? null : Math.round(state.firstEventMs),
          first_token_ms: state.firstTokenMs === null ? null : Math.round(state.firstTokenMs),
          event_count: state.eventCount,
          observer_trace: state.observerTrace,
          observer_trace_truncated: state.observerTraceTruncated,
          opaque_items_seen: state.opaqueItemsSeen,
          compaction_items_seen: state.compactionItemsSeen,
          assistant_text: state.assistantText,
          assistant_text_truncated: state.assistantTextTruncated,
        };
        state.completionTimer = setImmediate(() => {
          state.completionTimer = null;
          if (state.settled || !state.completion) return;
          state.settled = true;
          state.resolve({ ...state.completion, usage: state.usage, thread_usage: state.threadUsage, last_usage: state.lastUsage });
        });
      }
    }
    if (method.endsWith("/requestApproval") || method === "item/tool/requestUserInput") this.serverRequestCount += 1;
    this.emitEvent({
      kind: "notification",
      method,
      threadId,
      turnId: readTurnId(params),
      item_type: params?.item?.type ?? null,
      elapsed_ms: state ? Math.round(elapsedMs(state.startedAt)) : null,
      opaque_items_seen: countOpaqueKeys(params),
    });
  }

  emitEvent(event) {
    if (typeof this.onEvent === "function") this.onEvent(Object.freeze({ ...event }));
  }

  failConnection(error) {
    if (this.closed && !this.child) return;
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    for (const state of this.turnWaiters.values()) state.reject(error);
    this.turnWaiters.clear();
    this.connected = false;
    this.threadIds.clear();
    this.threadUsage.clear();
    if (!this.closed) this.closed = true;
  }

  decorateError(error) {
    if (!(error instanceof Error)) return error;
    if (error.stderrKind === undefined) error.stderrKind = classifyStderr(this.stderr);
    if (error.stderrBytes === undefined) error.stderrBytes = Buffer.byteLength(this.stderr);
    return error;
  }
}

export { assertFiniteInteger, classifyStderr, classifyTurnFailure, elapsedMs, normalizeUsage };
