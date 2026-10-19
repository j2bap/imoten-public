import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultLogPath, normalizeDecisionRecord, recordDecision } from "../skills/poteto-mode/scripts/record-jev-decision.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("typed classifier protocol defines provider routing, gates, logging, and fallback", async () => {
  const protocol = await fs.readFile(path.join(root, "skills/poteto-mode/references/jev-decision-protocol.md"), "utf8");
  for (const marker of ["mcp__classifier__classify_texts", "mcp__jev__evaluate", "classifier-decision-adapter.mjs", "resolve-jev-route.mjs", "confidence", "0.80", "0.50", "0.90", "Log every answer", "jev_screen", "Do not ask a full LLM to choose a model"]) {
    assert.match(protocol, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(protocol, /choice/);
  assert.match(protocol, /noul/);
  assert.match(protocol, /score/);
});

test("confidence-bearing classifications have one typed provider boundary", async () => {
  const files = await Promise.all([
    "skills/poteto-mode/SKILL.md",
    "skills/poteto-mode/references/task-routing.md",
    "skills/poteto-mode/references/codex-agent-runtime.md",
    "skills/poteto-mode/references/jev-decision-protocol.md",
    "skills/poteto-mode/references/bugbot-triage.md",
    "skills/reflect/SKILL.md",
    "skills/dev-review/SKILL.md",
    "docs/guide/02-poteto-mode.md",
  ].map((relative) => fs.readFile(path.join(root, relative), "utf8")));
  const [poteto, routing, runtime, protocol, bugbot, reflect, devReview, guide] = files;

  assert.match(protocol, /Any bounded semantic classification that carries a `confidence`, `probability`,\s+score, or confidence level must go through one of the two classifier providers/);
  assert.match(protocol, /Exact lexical, schema, threshold, availability, and state-machine checks that\s+emit no confidence remain deterministic/);
  assert.match(protocol, /If both providers fail, leave the item unclassified/);
  assert.match(protocol, /Never call an absent tool to test it/);
  assert.match(protocol, /\| The classifier is absent \| Skip it without a call\. Ask `mcp__jev__evaluate` the same question\. \|/);
  assert.match(protocol, /\| Ready lane \| `sequential-parent`\. \|/);
  assert.match(protocol, /\| Bugbot triage \| `ask`\. \|/);
  assert.match(protocol, /"provider": "none"/);
  assert.doesNotMatch(protocol, /~\/\.codex\/|\$CODEX_HOME\//);
  for (const file of [poteto, routing, runtime, bugbot]) assert.match(file, /jev-decision-protocol\.md/);
  assert.match(poteto, /Treat confidence-bearing semantic classifications as typed classifier\s+decisions/);
  assert.match(routing, /confidence-bearing semantic classification/);
  assert.match(runtime, /classify it with `mcp__classifier__classify_texts`, or with `mcp__jev__evaluate` when the classifier is absent or fails/);
  assert.match(runtime, /Dispatch the original task once with that pair/);
  assert.match(bugbot, /Classify each Bugbot thread before acting through the \[typed classifier decision protocol\]/);
  assert.match(reflect, /every bounded structural-learning classification or priority that carries confidence/);
  assert.match(devReview, /use the adapter's typed score for the finding confidence/);
  assert.match(guide, /Any confidence-bearing semantic classification in a Poteto workflow goes through/);
});

test("decision logging keeps the typed answer and redacts secrets", () => {
  const record = normalizeDecisionRecord({
    provider: "classifier.dev",
    model: "jev-1.13.0",
    state: { task: "route", api_key: "apikey-secret" },
    question: { type: "choice", instructions: "Choose a role" },
    answer: { choice: "Fast profile", probability: 0.97 },
    confidence: 0.97,
    gate: "act",
    action: "use Fast profile",
  }, new Date("2026-09-17T19:00:00.000Z"));
  assert.equal(record.ts, "2026-09-17T19:00:00.000Z");
  assert.equal(record.state.api_key, "<redacted>");
  assert.equal(record.answer.choice, "Fast profile");
  assert.equal(record.confidence, 0.97);
  assert.equal(record.provider, "classifier.dev");
});

test("decision logger appends one JSONL record", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-jev-log-"));
  const logPath = path.join(directory, "decisions.jsonl");
  await recordDecision({
    state: { task: "review" },
    question: "needs security review",
    answer: { noul: 0.2 },
    confidence: null,
  }, { logPath, now: new Date("2026-09-17T19:01:00.000Z") });
  const lines = (await fs.readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    ts: "2026-09-17T19:01:00.000Z",
    model: "jev-latest",
    provider: "jev",
    state: { task: "review" },
    question: "needs security review",
    answer: { noul: 0.2 },
    confidence: null,
    gate: "review-required",
    action: "",
  });
});

test("decision log path follows the active home and fails closed", async () => {
  assert.equal(defaultLogPath({ IMOTEN_ACTIVE_CODEX_HOME: "/tmp/personal", CODEX_HOME: "/tmp/work" }), "/tmp/personal/jev-decisions.jsonl");
  assert.equal(defaultLogPath({ CODEX_HOME: "/tmp/work" }), "/tmp/work/jev-decisions.jsonl");
  assert.equal(defaultLogPath({ JEV_DECISION_LOG: "/tmp/log.jsonl", CODEX_HOME: "/tmp/work" }), "/tmp/log.jsonl");
  assert.throws(() => defaultLogPath({}), /active Codex home is unknown/);
  await assert.rejects(
    recordDecision({ state: {}, question: "q", answer: null, confidence: null }, { env: {} }),
    /active Codex home is unknown/,
  );
});
