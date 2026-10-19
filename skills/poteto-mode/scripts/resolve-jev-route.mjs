#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

import { recordDecision, requireActiveCodexHome } from "./record-jev-decision.mjs";
import { readStdin } from "./read-stdin.mjs";
import { parseRecommendedRoles } from "../../setup-pstack/scripts/manage-agents.mjs";

export const DEFAULT_COMPLEXITY_ROLE_MAP = Object.freeze({
  trivial: "Fast profile",
  moderate: "Poteto agent",
  complex: "Hardest tasks",
});

export const DEFAULT_ROLE_MAP = DEFAULT_COMPLEXITY_ROLE_MAP;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function parseArgs(argv) {
  let logPath;
  let roleMapPath;
  for (let index = 0; index < argv.length; index += 1) {
    if (!["--log", "--role-map"].includes(argv[index]) || !argv[index + 1]) {
      throw new Error("usage: resolve-jev-route.mjs [--log PATH] [--role-map PATH]");
    }
    if (argv[index] === "--log") logPath = argv[index + 1];
    else roleMapPath = argv[index + 1];
    index += 1;
  }
  return { logPath, roleMapPath: roleMapPath ?? defaultRoleMapPath() };
}

function decisionConfidence(input) {
  const value = input.confidence ?? input.answer?.confidence ?? null;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("decision confidence must be a number from 0 to 1 or null");
  }
  return value;
}

function roleCandidates(input, required = false) {
  const candidates = input.role_candidates ?? input.state?.role_candidates;
  if (candidates === undefined) {
    if (required) throw new Error("decision.role_candidates is required for direct model routing");
    return null;
  }
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.some((role) => typeof role !== "string" || !role.trim())) {
    throw new Error("role_candidates must be a non-empty array of role names");
  }
  const normalized = candidates.map((role) => role.trim());
  if (new Set(normalized).size !== normalized.length) throw new Error("role_candidates must not contain duplicates");
  return normalized;
}

function rolePair(roleMap, roleAlias) {
  if (!roleMap) return null;
  const pair = roleMap instanceof Map ? roleMap.get(roleAlias) : roleMap[roleAlias];
  if (!pair) return null;
  if (typeof pair.model !== "string" || !pair.model.trim() || typeof pair.reasoning_effort !== "string" || !pair.reasoning_effort.trim()) {
    throw new Error(`role map entry for "${roleAlias}" must include model and reasoning_effort`);
  }
  return { model: pair.model, reasoning_effort: pair.reasoning_effort };
}

export function defaultRoleMapPath(env = process.env) {
  if (env.IMOTEN_MODEL_ROLE_RULE) return path.resolve(env.IMOTEN_MODEL_ROLE_RULE);
  return path.join(requireActiveCodexHome(env, "--role-map PATH"), "imoten-models.md");
}

export async function loadRoleMap(file = defaultRoleMapPath()) {
  const content = await fs.readFile(file, "utf8");
  const normalizedContent = content.replace(/^## Role map$/mu, "## Recommended Codex map");
  return parseRecommendedRoles(normalizedContent);
}

function routeGate({ roleAlias, candidates, pair, requirePair, confidence, destructive, humanConfirmation, noProvider }) {
  if (!roleAlias) {
    return {
      gate: "escalate",
      routeAllowed: false,
      action: candidates
        ? "escalate to the parent because the choice is outside the bounded role candidates"
        : "escalate to the parent because the choice has no role mapping",
    };
  }
  if (requirePair && !pair) {
    return {
      gate: "role-map-required",
      routeAllowed: false,
      action: `escalate to the parent because the exact pair for ${roleAlias} is not proven`,
    };
  }
  if (noProvider) {
    if (destructive) {
      return {
        gate: "human-confirmation",
        routeAllowed: false,
        action: "stop until a human confirms the irreversible action",
      };
    }
    return {
      gate: "default-role",
      routeAllowed: true,
      action: `route to the default role ${roleAlias} because no classifier provider is available, and flag the decision for review`,
    };
  }
  if (confidence === null) {
    return {
      gate: "review-required",
      routeAllowed: false,
      action: "escalate to the parent because confidence is missing",
    };
  }
  if (confidence < 0.5) {
    return {
      gate: "escalate",
      routeAllowed: false,
      action: "escalate to the parent because confidence is below 0.50",
    };
  }
  if (destructive && (confidence < 0.9 || !humanConfirmation)) {
    return {
      gate: "human-confirmation",
      routeAllowed: false,
      action: "stop until a human confirms the irreversible action",
    };
  }
  if (confidence < 0.8) {
    return {
      gate: "review",
      routeAllowed: true,
      action: `route to ${roleAlias} and flag the decision for review`,
    };
  }
  return { gate: "act", routeAllowed: true, action: `route to ${roleAlias}` };
}

export function resolveJevRoute(input, { roleMap = null, requirePair = false, requireCandidates = false } = {}) {
  if (!isRecord(input)) throw new Error("decision must be a JSON object");
  for (const field of ["state", "question", "answer"]) {
    if (!(field in input)) throw new Error(`decision.${field} is required`);
  }
  // provider "none" means the session exposes neither classifier nor Jev.
  // The deterministic fallback is the first bounded role candidate.
  const noProvider = input.provider === "none";
  if (!noProvider && (!isRecord(input.answer) || input.answer.type !== "choice")) {
    throw new Error("decision.answer must be a typed choice answer");
  }

  const confidence = noProvider ? null : decisionConfidence(input);
  const candidates = roleCandidates(input, requireCandidates || noProvider);
  const choice = noProvider ? candidates[0] : input.answer.choice;
  const roleAlias = candidates
    ? (candidates.includes(choice) ? choice : null)
    : DEFAULT_COMPLEXITY_ROLE_MAP[choice] ?? null;
  const pair = roleAlias ? rolePair(roleMap, roleAlias) : null;
  const destructive = input.destructive ?? input.state?.destructive ?? false;
  const humanConfirmation = input.human_confirmation ?? input.state?.human_confirmation ?? false;

  if (typeof destructive !== "boolean" || typeof humanConfirmation !== "boolean") {
    throw new Error("destructive and human_confirmation must be booleans");
  }

  const gate = routeGate({ roleAlias, candidates, pair, requirePair, confidence, destructive, humanConfirmation, noProvider });

  return {
    role_alias: gate.routeAllowed ? roleAlias : null,
    model: gate.routeAllowed ? pair?.model ?? null : null,
    reasoning_effort: gate.routeAllowed ? pair?.reasoning_effort ?? null : null,
    route_allowed: gate.routeAllowed,
    gate: gate.gate,
    confidence,
    review_required: gate.gate !== "act",
    action: gate.action,
  };
}

export async function routeAndRecord(input, options = {}) {
  const roleMap = options.roleMap ?? (options.roleMapPath ? await loadRoleMap(options.roleMapPath) : null);
  const route = resolveJevRoute(input, {
    roleMap,
    requirePair: options.requirePair ?? false,
    requireCandidates: options.requireCandidates ?? false,
  });
  await recordDecision({
    ...input,
    confidence: route.confidence,
    gate: route.gate,
    action: route.action,
  }, options);
  return route;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { logPath, roleMapPath } = parseArgs(process.argv.slice(2));
    const input = JSON.parse(await readStdin());
    const route = await routeAndRecord(input, {
      ...(logPath ? { logPath } : {}),
      roleMapPath,
      requirePair: true,
      requireCandidates: true,
    });
    process.stdout.write(`${JSON.stringify(route)}\n`);
    if (!route.route_allowed) process.exitCode = 3;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
