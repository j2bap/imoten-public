#!/usr/bin/env node

import { readStdin } from "./read-stdin.mjs";

export const CLASSIFIER_PROVIDER = "classifier.dev";
const TIERS = new Set(["fast", "smart"]);
const DECISION_TYPES = new Set(["choice", "noul", "score"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireQuestion(question) {
  if (!isRecord(question) || !DECISION_TYPES.has(question.type)) {
    throw new Error("question.type must be choice, noul, or score");
  }
  if (question.instructions !== undefined && typeof question.instructions !== "string") {
    throw new Error("question.instructions must be text");
  }
}

function criteriaLabels(question) {
  if (Array.isArray(question.criteria)) return question.criteria;
  if (isRecord(question.criteria)) return Object.keys(question.criteria);
  throw new Error("question.criteria must be an object or array");
}

function decisionLabels(question) {
  requireQuestion(question);
  if (question.type === "noul") return ["yes", "no"];

  const labels = criteriaLabels(question);
  const filtered = question.type === "score" ? labels.filter((label) => label !== "no_match") : labels;
  if (filtered.length < 2 || filtered.length > 100) {
    throw new Error("question criteria must contain 2 to 100 labels");
  }
  if (filtered.some((label) => typeof label !== "string" || !label.trim())) {
    throw new Error("question criteria labels must be non-empty text");
  }
  if (new Set(filtered).size !== filtered.length) throw new Error("question criteria labels must be unique");
  return filtered;
}

function criteriaText(question) {
  if (!isRecord(question.criteria)) return "";
  return Object.entries(question.criteria)
    .map(([label, description]) => `${label}: ${typeof description === "string" ? description : JSON.stringify(description)}`)
    .join("\n");
}

export function buildClassifierRequest(question, { input, tier = "fast" } = {}) {
  const labels = decisionLabels(question);
  if (typeof input !== "string" || !input.trim()) throw new Error("input must be non-empty text");
  if (!TIERS.has(tier)) throw new Error("tier must be fast or smart");

  const instructions = [
    question.instructions,
    `Return exactly one label from: ${labels.join(", ")}.`,
    question.type === "choice" ? "Use no_match when none of the supplied choices fits." : null,
    criteriaText(question),
  ].filter(Boolean).join("\n");

  return {
    inputs: [input],
    labels,
    instructions,
    tier,
  };
}

function extractResult(raw) {
  if (raw?.isError) throw new Error("classifier.dev returned an error");
  const payload = isRecord(raw?.structuredContent) ? raw.structuredContent : raw;
  if (!isRecord(payload) || !Array.isArray(payload.results) || payload.results.length !== 1) {
    throw new Error("classifier.dev result must contain exactly one result");
  }
  const result = payload.results[0];
  if (!isRecord(result)) throw new Error("classifier.dev result must be an object");
  if (typeof result.label !== "string" || !result.label.trim()) throw new Error("classifier.dev result label is required");
  if (typeof result.confidence !== "number" || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
    throw new Error("classifier.dev result confidence must be a number from 0 to 1");
  }
  const model = result.model ?? payload.model ?? CLASSIFIER_PROVIDER;
  if (typeof model !== "string" || !model.trim()) throw new Error("classifier.dev result model must be text");
  return { label: result.label, confidence: result.confidence, scores: result.scores, model };
}

function probabilities(scores, labels) {
  if (!isRecord(scores)) throw new Error("classifier.dev result scores must be an object");
  const values = labels.map((label) => scores[label]);
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("classifier.dev result scores must cover every label from 0 to 1");
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || Math.abs(total - 1) > 0.02) throw new Error("classifier.dev result scores must sum to 1");
  return Object.fromEntries(labels.map((label, index) => [label, values[index] / total]));
}

function modelName(model) {
  if (model === CLASSIFIER_PROVIDER || model.startsWith(`${CLASSIFIER_PROVIDER}/`)) return model;
  return `${CLASSIFIER_PROVIDER}/${model}`;
}

export function adaptClassifierResult({ state, question, result } = {}) {
  if (!Object.hasOwn(arguments[0] ?? {}, "state")) throw new Error("state is required");
  if (!Object.hasOwn(arguments[0] ?? {}, "question")) throw new Error("question is required");
  if (!Object.hasOwn(arguments[0] ?? {}, "result")) throw new Error("result is required");

  const labels = decisionLabels(question);
  const classifier = extractResult(result);
  if (!labels.includes(classifier.label)) throw new Error(`classifier.dev returned an unknown label: ${classifier.label}`);
  const scores = probabilities(classifier.scores, labels);
  let answer;

  if (question.type === "choice") {
    answer = {
      type: "choice",
      choice: classifier.label,
      confidence: classifier.confidence,
      probabilities: scores,
    };
  } else if (question.type === "noul") {
    answer = {
      type: "noul",
      noul: scores.yes,
      confidence: classifier.confidence,
      probabilities: scores,
    };
  } else {
    const denominator = labels.length - 1;
    const score = labels.reduce((sum, label, index) => sum + scores[label] * (index / denominator), 0);
    answer = {
      type: "score",
      score: Number(score.toFixed(12)),
      confidence: classifier.confidence,
      probabilities: scores,
    };
  }

  return {
    provider: CLASSIFIER_PROVIDER,
    model: modelName(classifier.model),
    state,
    question,
    answer,
    confidence: classifier.confidence,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const input = JSON.parse(await readStdin());
    process.stdout.write(`${JSON.stringify(adaptClassifierResult(input))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
