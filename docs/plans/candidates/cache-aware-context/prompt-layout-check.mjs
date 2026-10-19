#!/usr/bin/env node

/**
 * Throwaway prompt-layout probe.
 *
 * It uses the same JSON shape as a structured prompt renderer.
 * It does not call Codex. It measures exact reusable byte prefixes and checks
 * that dependency groups stay whole when the dynamic suffix is filtered.
 */

import { createHash } from "node:crypto";

const BRANCHES = ["alpha", "beta", "gamma", "delta"];

const stableContext = Object.freeze([
  { name: "system", text: "You are a coding agent. Preserve user intent and report verified work.\n".repeat(180) },
  { name: "project-rules", text: "Use the repository rules, keep one source of truth, and preserve exact provider artifacts.\n".repeat(220) },
  { name: "schemas", text: "schema_version=2; event=visible; tool_call and tool_output form one dependency group.\n".repeat(130) },
  { name: "stable-tools", text: "read_file, apply_patch, test, and report are stable tool definitions.\n".repeat(160) },
]);

const dynamicGroups = Object.freeze([
  { id: "g1", call: "tool_call read_file src/a.js", output: "tool_output src/a.js exact visible bytes" },
  { id: "g2", call: "tool_call test unit-a", output: "tool_output unit-a passed with receipt" },
  { id: "g3", call: "tool_call read_file src/b.js", output: "tool_output src/b.js exact visible bytes" },
  { id: "g4", call: "tool_call test unit-b", output: "tool_output unit-b passed with receipt" },
]);

function renderedPrompt(context, task) {
  return Buffer.from(JSON.stringify({ schema_version: 2, context, task }), "utf8");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function commonPrefixBytes(buffers) {
  if (buffers.length === 0) return 0;
  const first = buffers[0];
  let offset = 0;
  while (offset < first.length) {
    const byte = first[offset];
    if (buffers.some((buffer) => buffer[offset] !== byte)) return offset;
    offset += 1;
  }
  return offset;
}

function dependencyGroups(selectedIds) {
  const selected = new Set(selectedIds);
  return dynamicGroups.filter((group) => selected.has(group.id));
}

function groupText(groups) {
  return groups.flatMap((group) => [
    { name: `${group.id}-call`, text: group.call },
    { name: `${group.id}-output`, text: group.output },
  ]);
}

function renderLegacy(branch) {
  const skill = { name: "skill", text: `full skill prompt for ${branch}; workflow instructions differ by branch.\n`.repeat(45) };
  const context = [skill, ...stableContext, ...groupText(dynamicGroups)];
  return renderedPrompt(context, `task for ${branch}`);
}

function renderRedesign(branch) {
  const skillReference = { name: "skill-reference", text: "poteto-mode@pinned-v1" };
  const branchPacket = { name: "task-packet", text: `task for ${branch}; selected visible bundles follow.` };
  const context = [...stableContext, skillReference, branchPacket, ...groupText(dynamicGroups)];
  return renderedPrompt(context, `task for ${branch}`);
}

function inspectLayout(name, render) {
  const prompts = BRANCHES.map(render);
  const common = commonPrefixBytes(prompts);
  const stableOnly = renderedPrompt(stableContext, "");
  return {
    name,
    branchCount: prompts.length,
    commonPrefixBytes: common,
    commonPrefixTokenEstimate: Math.floor(common / 4),
    stablePrefixBytes: stableOnly.length,
    totalPromptBytes: prompts.reduce((sum, prompt) => sum + prompt.length, 0),
    commonPrefixShare: common / Math.max(1, prompts[0].length),
    prefixFingerprint: digest(prompts[0].subarray(0, common)),
  };
}

function checkDependencyClosure() {
  const selected = dependencyGroups(["g1", "g3"]);
  const rendered = groupText(selected);
  const names = new Set(rendered.map((entry) => entry.name));
  return dynamicGroups.every((group) => (
    !["g1", "g3"].includes(group.id)
    || (names.has(`${group.id}-call`) && names.has(`${group.id}-output`))
  ));
}

const legacy = inspectLayout("skill-before-prefix", renderLegacy);
const redesign = inspectLayout("skill-after-cache-boundary", renderRedesign);

console.log("Prompt layout check");
console.log("status=offline_only provider_calls=0");
console.log(JSON.stringify({ legacy, redesign }, null, 2));
console.log(`dependency_closure=${checkDependencyClosure()}`);
console.log(`common_prefix_gain_bytes=${redesign.commonPrefixBytes - legacy.commonPrefixBytes}`);
console.log(`common_prefix_gain_token_estimate=${redesign.commonPrefixTokenEstimate - legacy.commonPrefixTokenEstimate}`);
console.log(`recommendation=${redesign.commonPrefixBytes > legacy.commonPrefixBytes ? "keep_skill_after_cache_boundary" : "investigate_layout"}`);
