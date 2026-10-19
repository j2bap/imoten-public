import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(root, "skills");

const FORBIDDEN_RUNTIME_PATTERNS = [
  [/\.cursor(?:\/|\b)/i, "Cursor filesystem path"],
  [/\bCursor(?:'s)?\b/i, "Cursor host claim"],
  [/\bagent-transcripts\b/i, "private transcript store"],
  [/\bTask\s+(?:tool|call|subagent)/i, "Cursor Task recipe"],
  [/`Task`|\bsubagent_type\b|\bcloud_base_branch\b|`environment:\s*"(?:cloud|local)"`|`readonly`:\s*(?:true|false)/i, "non-Codex agent schema"],
  [/\bAskQuestion\b/i, "Cursor question tool"],
  [/\brun_in_background\b/i, "Cursor background flag"],
  [/(?:terminal\s+)?\/loop\b|cloud-sleeper|monitored-shell[^\n]*sleep/i, "unsupported loop mechanic"],
  [/supported Codex task history\/?|supported task history\//i, "invented task-history path"],
  [/\bcreate-skill\b|`mcps\/`/i, "non-Codex skill or connector discovery"],
  [/\b(?:claude-fable-5-thinking-max|claude-opus-5-thinking-xhigh|gpt-5\.6-sol-max)\b/i, "combined model slug"],
];

// These are external GitHub review identities accepted as untrusted input, not
// host-runtime dependencies. Keep the list narrow and explicit.
const LEGACY_REVIEW_AUTHOR_ALLOWLIST = new Map([
  ["poteto-mode/references/bugbot-triage.md", [/\bBugbot\b/g]],
  ["poteto-mode/playbooks/babysit.md", [/\bBugbot\b/g, /\bbugbot\b/g]],
  ["poteto-mode/playbooks/autopilot-full.md", [/\bBugbot\b/g]],
  ["poteto-mode/playbooks/autopilot-stack.md", [/\bBugbot\b/g]],
  ["poteto-mode/playbooks/multi-phase-plan.md", [/\bBugbot\b/g]],
]);

const ALLOWED_RUNTIME_LITERALS = new Map([
  ["setup-pstack/SKILL.md", ["~/.codex/imoten-models.md"]],
  ["setup-pstack/references/model-roles.md", ["~/.codex/imoten-models.md"]],
  ["poteto-mode/references/codex-agent-runtime.md", ["~/.codex/imoten-models.md"]],
  ["poteto-mode/references/codex-agent-transport.md", ["~/.codex/imoten-models.md"]],
]);

async function markdownFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === "node_modules") return [];
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : [];
  }));
  return nested.flat();
}

test("all skill runtime instructions use the central Codex contract", async () => {
  const files = await markdownFiles(skillsRoot);
  const failures = [];

  for (const file of files) {
    const relative = path.relative(skillsRoot, file);
    let content = await fs.readFile(file, "utf8");
    for (const allowed of LEGACY_REVIEW_AUTHOR_ALLOWLIST.get(relative) ?? []) {
      content = content.replace(allowed, "LEGACY_REVIEW_AUTHOR");
    }
    for (const allowed of ALLOWED_RUNTIME_LITERALS.get(relative) ?? []) {
      content = content.replaceAll(allowed, "IMOTEN_MODEL_RULE");
    }
    for (const [pattern, label] of FORBIDDEN_RUNTIME_PATTERNS) {
      if (pattern.test(content)) failures.push(`${relative}: ${label}`);
    }
  }

  assert.deepEqual(failures, []);
});

test("setup and runtime share the upstream-compatible model role rule", async () => {
  const setup = await fs.readFile(path.join(skillsRoot, "setup-pstack", "SKILL.md"), "utf8");
  const roles = await fs.readFile(path.join(skillsRoot, "setup-pstack", "references", "model-roles.md"), "utf8");
  const runtime = await fs.readFile(path.join(skillsRoot, "poteto-mode", "references", "codex-agent-runtime.md"), "utf8");

  assert.match(setup, /Bare `\$setup-pstack`.*configure model roles/);
  assert.match(setup, /model_catalog_json/);
  for (const model of ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"]) {
    assert.match(roles, new RegExp(model.replaceAll(".", "\\.")));
  }
  for (const panel of [
    "Arena runners", "Arena cross-judges", "Architect runners",
    "Interrogate reviewers", "Independent verifiers",
  ]) {
    assert.match(roles, new RegExp("`" + panel + "`"));
  }
  assert.doesNotMatch(roles, /\| OpenAI \| `gpt-5\.5` \|/);
  assert.doesNotMatch(roles, /\| Google \| `gemini-3\.[5-7]-flash` \|/);
  assert.doesNotMatch(roles, /\| xAI \| `grok-4\.5` \|/);
  assert.doesNotMatch(roles, /\| Microsoft \| `mai-code-1-flash-picker` \|/);
  assert.doesNotMatch(roles, /\| Moonshot AI \| Kimi/);
  assert.match(roles, /Reflect Claude Code models in reports and policy text only/);
  assert.match(runtime, /active home's `imoten-models\.md`/);
  assert.match(runtime, /Do not inherit the parent model or select a substitute/);
});

test("child dispatch reads the trusted runtime receipt and the exact-path local runner", async () => {
  const poteto = await fs.readFile(path.join(skillsRoot, "poteto-mode", "SKILL.md"), "utf8");
  const runtime = await fs.readFile(path.join(skillsRoot, "poteto-mode", "references", "codex-agent-runtime.md"), "utf8");
  const transport = await fs.readFile(path.join(skillsRoot, "poteto-mode", "references", "codex-agent-transport.md"), "utf8");

  assert.match(runtime, /trusted `Imoten runtime receipt`/);
  assert.match(runtime, /Never infer `~\/\.codex` from a missing tool-process `CODEX_HOME`/);
  assert.match(runtime, /Choose the transport before the persona/);
  assert.match(runtime, /A workflow's references to profiles, generic agents, spawning, or subagents do not select the transport/);
  assert.match(runtime, /use a generic agent with the same persona and exact pair/);
  assert.match(transport, /codex-primary-session\.mjs/);
  assert.match(transport, /one Codex app-server connection/);
  assert.match(transport, /Do not route this native primary/);
  assert.match(runtime, /All\s+programmatic workflow callers use the workflow dispatcher/);
  assert.match(runtime, /\[`codex-agent-transport\.md`\]\(codex-agent-transport\.md\)/);
  assert.match(transport, /Read this file only when you call the workflow dispatcher/);
  assert.match(poteto, /Never infer another profile from a missing `CODEX_HOME`/);
  assert.doesNotMatch(poteto, /Use the exact custom profile `imoten-poteto-agent` for playbook delegates when installed/);
  assert.match(transport, /dispatch --request-file/);
  assert.match(transport, /The runner rejects a file with group or world access/);
  assert.match(transport, /Do not use a pipe, heredoc, redirection/);
});

test("bounded checked analysis uses the local operator before the selected remote role", async () => {
  const poteto = await fs.readFile(path.join(skillsRoot, "poteto-mode", "SKILL.md"), "utf8");
  const runtime = await fs.readFile(path.join(skillsRoot, "poteto-mode", "references", "codex-agent-runtime.md"), "utf8");
  const transport = await fs.readFile(path.join(skillsRoot, "poteto-mode", "references", "codex-agent-transport.md"), "utf8");
  const roles = await fs.readFile(path.join(skillsRoot, "setup-pstack", "references", "model-roles.md"), "utf8");

  assert.match(poteto, /bounded read-only analysis with an automatic check/);
  assert.match(runtime, /Before a read-only remote dispatch, test whether the `Local operator` can complete the work/);
  assert.match(runtime, /complete, fixed evidence packet/);
  assert.match(transport, /task-specific acceptance check/);
  assert.match(transport, /Dispatch the original packet once to the selected remote role/);
  assert.match(roles, /Fall back to the selected remote role/);
  assert.doesNotMatch(roles, /Fall back to the remote Fast profile/);
});

test("ready workflow lanes use the typed classifier with deterministic safety gates", async () => {
  const poteto = await fs.readFile(path.join(skillsRoot, "poteto-mode", "SKILL.md"), "utf8");
  const runtime = await fs.readFile(path.join(skillsRoot, "poteto-mode", "references", "codex-agent-runtime.md"), "utf8");
  const why = await fs.readFile(path.join(skillsRoot, "why", "SKILL.md"), "utf8");
  const how = await fs.readFile(path.join(skillsRoot, "how", "SKILL.md"), "utf8");
  const swarm = await fs.readFile(path.join(skillsRoot, "swarm", "SKILL.md"), "utf8");

  assert.match(poteto, /ready-lane gate/);
  assert.match(runtime, /## Classify and run ready lanes/);
  assert.match(runtime, /mcp__classifier__classify_texts/);
  assert.match(runtime, /mcp__jev__evaluate/);
  assert.match(runtime, /parallel-read/);
  assert.match(runtime, /parallel-isolated-write/);
  assert.match(runtime, /confidence gates, and fallbacks follow the table in \[`jev-decision-protocol\.md`\]/);
  assert.match(runtime, /A lane's fallback is `sequential-parent`/);
  assert.doesNotMatch(runtime, /below `0\.80`/);
  assert.match(runtime, /up to two in-flight lanes/);
  assert.match(runtime, /recompute readiness and refill/);
  assert.match(runtime, /sequential-parent/);
  assert.doesNotMatch(why, /Default to the full parallel investigation/);
  assert.match(why, /at\s+most two independent read-only investigators/);
  assert.match(how, /at\s+most two ready\s+explorers/);
  assert.match(swarm, /at most two ready workers/);
});

test("ordinary Poteto work keeps one parent context owner", async () => {
  const runtime = await fs.readFile(path.join(skillsRoot, "poteto-mode", "references", "codex-agent-runtime.md"), "utf8");
  const how = await fs.readFile(path.join(skillsRoot, "how", "SKILL.md"), "utf8");
  const feature = await fs.readFile(path.join(skillsRoot, "poteto-mode", "playbooks", "feature.md"), "utf8");
  const bugFix = await fs.readFile(path.join(skillsRoot, "poteto-mode", "playbooks", "bug-fix.md"), "utf8");

  assert.match(runtime, /The parent owns design, implementation, verification, and the final report/);
  assert.match(runtime, /Ordinary work uses one delegation level/);
  assert.match(how, /the parent explores and explains in one pass/);
  assert.match(how, /Synthesize in the parent/);
  assert.doesNotMatch(how, /How explainer/);
  assert.match(feature, /Keep code-coupled work in the parent/);
  assert.match(bugFix, /Keep the evidence and the edit in one context/);
});

test("Poteto uses Imoten laziness directly and keeps Ponytail optional", async () => {
  const poteto = await fs.readFile(path.join(skillsRoot, "poteto-mode", "SKILL.md"), "utf8");
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  const adaptation = await fs.readFile(path.join(root, "docs", "codex-adaptation.md"), "utf8");

  assert.match(poteto, /apply \*\*principle-laziness-protocol\*\* after reading the task-relevant flow/);
  assert.match(poteto, /Use \*\*ponytail\*\* only when the user asks/);
  assert.match(readme, /Imoten folds the useful Ponytail rule into `principle-laziness-protocol`/);
  assert.match(adaptation, /Imoten does not depend on it for normal coding/);
});

test("active skills do not prescribe model inheritance or substitution", async () => {
  const forbidden = [
    /generic agents? with inherited model/i,
    /inherit the parent when a configured pair/i,
    /model pair inherited or unverified/i,
    /default(?:s)? the configured (?:fast|judgment|instruction-following) profile/i,
    /retry on a different model/i,
    /follow that role's declared substitute, inherit/i,
  ];
  const failures = [];

  for (const file of await markdownFiles(skillsRoot)) {
    const content = await fs.readFile(file, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(content)) failures.push(`${path.relative(skillsRoot, file)}: ${pattern.source}`);
    }
  }

  assert.deepEqual(failures, []);
});

test("active instructions do not prescribe Git worktrees", async () => {
  const files = [
    ...(await markdownFiles(skillsRoot)),
    ...(await markdownFiles(path.join(root, "automations"))),
    ...(await markdownFiles(path.join(root, "docs", "guide"))),
    path.join(root, "README.md"),
    path.join(root, "docs", "codex-adaptation.md"),
    path.join(root, "docs", "adr", "0001-codex-first-runtime.md"),
  ];
  const failures = [];

  for (const file of files) {
    if (file.endsWith(path.join("playbooks", "worktree-cleanup.md"))) continue;
    const content = (await fs.readFile(file, "utf8")).replaceAll("Do not create Git worktrees", "WORKTREE_BAN");
    if (/worktrees?.{0,50}fallback|fallback.{0,50}worktrees?|use a worktree|isolated worktree|network-denied worktree/i.test(content)) {
      failures.push(path.relative(root, file));
    }
  }

  assert.deepEqual(failures, []);
});

test("representative behavior fixtures declare authority, fallback, and proof", async () => {
  const fixtureRoot = path.join(root, "tests", "skill-behavior");
  const fixtures = (await fs.readdir(fixtureRoot)).filter((name) => name.endsWith(".yaml"));
  assert.deepEqual(fixtures.sort(), [
    "capability-fallbacks.yaml",
    "lifecycle-authority.yaml",
    "orchestration.yaml",
    "recall.yaml",
  ]);

  for (const fixture of fixtures) {
    const content = await fs.readFile(path.join(fixtureRoot, fixture), "utf8");
    assert.match(content, /authority:/);
    assert.match(content, /expected:/);
    assert.match(content, /proof:/);
  }
});

test("all playbooks and orchestrated skills cite the runtime contract", async () => {
  const playbookRoot = path.join(skillsRoot, "poteto-mode", "playbooks");
  for (const file of await markdownFiles(playbookRoot)) {
    assert.match(await fs.readFile(file, "utf8"), /codex-agent-runtime\.md/, path.relative(root, file));
  }

  const orchestrated = [
    "architect", "arena", "automate-me", "blast-radius", "create-verification-skill",
    "figure-it-out", "how", "interrogate", "maintain-verification-skill", "no-comments",
    "recall", "reflect", "show-me-your-work", "swarm", "why",
  ];
  for (const name of orchestrated) {
    const file = path.join(skillsRoot, name, "SKILL.md");
    assert.match(await fs.readFile(file, "utf8"), /codex-agent-runtime\.md/, name);
  }
});

test("PR playbooks share one GitLab and GitHub forge contract", async () => {
  const playbooks = [
    "opening-a-pr.md",
    "babysit.md",
    "shipping.md",
    "autopilot-full.md",
    "autopilot-stack.md",
    "multi-phase-plan.md",
  ];

  for (const name of playbooks) {
    const content = await fs.readFile(path.join(skillsRoot, "poteto-mode", "playbooks", name), "utf8");
    assert.match(content, /forge\.md/, name);
  }

  const forge = await fs.readFile(path.join(skillsRoot, "poteto-mode", "references", "forge.md"), "utf8");
  assert.match(forge, /GitLab remote, run `glab repo view`/);
  assert.match(forge, /GitHub remote, run `gh repo view`/);
  assert.match(forge, /One actor owns base changes/);
});
