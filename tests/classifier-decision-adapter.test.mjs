import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptClassifierResult,
  buildClassifierRequest,
} from "../skills/poteto-mode/scripts/classifier-decision-adapter.mjs";

const choiceQuestion = {
  type: "choice",
  instructions: "Choose the workflow role.",
  criteria: {
    "Fast profile": "Use for a narrow deterministic check.",
    "Poteto agent": "Use for a normal implementation task.",
    "Hardest tasks": "Use for a complex or high-risk task.",
    no_match: "The supplied facts do not support a role.",
  },
};

const classifierResult = (label, confidence, scores) => ({
  structuredContent: {
    model: "jev-1.13.0",
    results: [{ label, confidence, scores }],
  },
});

test("buildClassifierRequest sends one labelled MCP classification", () => {
  const request = buildClassifierRequest(choiceQuestion, {
    input: "Update the policy and add a response adapter across several files.",
    tier: "smart",
  });

  assert.deepEqual(request.inputs, ["Update the policy and add a response adapter across several files."]);
  assert.deepEqual(request.labels, ["Fast profile", "Poteto agent", "Hardest tasks", "no_match"]);
  assert.equal(request.tier, "smart");
  assert.match(request.instructions, /Choose the workflow role/);
  assert.match(request.instructions, /no_match/);
});

test("choice results become the existing typed decision envelope", () => {
  const state = { task: "route the workflow", role_candidates: ["Poteto agent", "Hardest tasks"] };
  const decision = adaptClassifierResult({
    state,
    question: choiceQuestion,
    result: classifierResult("Hardest tasks", 0.91, {
      "Fast profile": 0.02,
      "Poteto agent": 0.07,
      "Hardest tasks": 0.91,
      no_match: 0,
    }),
  });

  assert.deepEqual(decision, {
    provider: "classifier.dev",
    model: "classifier.dev/jev-1.13.0",
    state,
    question: choiceQuestion,
    answer: {
      type: "choice",
      choice: "Hardest tasks",
      confidence: 0.91,
      probabilities: {
        "Fast profile": 0.02,
        "Poteto agent": 0.07,
        "Hardest tasks": 0.91,
        no_match: 0,
      },
    },
    confidence: 0.91,
  });
});

test("yes/no results preserve noul probability and confidence", () => {
  const question = {
    type: "noul",
    instructions: "Does the endpoint answer the request?",
  };
  const decision = adaptClassifierResult({
    state: { task: "check the endpoint" },
    question,
    result: classifierResult("yes", 0.84, { yes: 0.84, no: 0.16 }),
  });

  assert.equal(decision.answer.type, "noul");
  assert.equal(decision.answer.noul, 0.84);
  assert.equal(decision.answer.confidence, 0.84);
  assert.deepEqual(decision.answer.probabilities, { yes: 0.84, no: 0.16 });
});

test("ordered labels become a probability-weighted score", () => {
  const question = {
    type: "score",
    instructions: "Rate the workflow complexity.",
    criteria: {
      low: "One small local edit.",
      medium: "Several related files.",
      high: "A cross-cutting or risky change.",
    },
  };
  const decision = adaptClassifierResult({
    state: { task: "rate complexity" },
    question,
    result: classifierResult("medium", 0.5, { low: 0.2, medium: 0.5, high: 0.3 }),
  });

  assert.equal(decision.answer.type, "score");
  assert.equal(decision.answer.score, 0.55);
  assert.equal(decision.answer.confidence, 0.5);
  assert.deepEqual(decision.answer.probabilities, { low: 0.2, medium: 0.5, high: 0.3 });
});

test("malformed classifier results fail closed for Jev fallback", () => {
  assert.throws(
    () => adaptClassifierResult({
      state: { task: "route" },
      question: choiceQuestion,
      result: classifierResult("Hardest tasks", 0.91, null),
    }),
    /scores must be an object/,
  );

  assert.throws(
    () => adaptClassifierResult({
      state: { task: "route" },
      question: choiceQuestion,
      result: { structuredContent: { results: [] } },
    }),
    /exactly one result/,
  );
});
