# 0005: Use Tracen for repository guardrails

The Context, Decision, and Reason below preserve the policy recorded after the 2026-09-21 removal of the scanner and Tracen workflows. The update below describes the public copy.

## Context

Imoten has one complete offline verification command. GitHub Actions is not part of the repository verification path, so local checks must remain complete and deterministic.

Agent instructions also cannot prevent every known bad change. Repeated failures need checks that stop the change without relying on memory.

## Decision

Name the guardrail layer Tracen. `npm run tracen` remains the deterministic local verification path for this repository. GitHub Actions workflows are not used. Release verification continues to add the installed-plugin smoke test.

Poteto Mode also runs the `tracen` skill after every React change. Its dependency-free probe finds added Effect calls in the Git diff. A focused review then requires each Effect to name the external system it synchronizes with, justify why render or an event handler cannot do the work, reverse setup during cleanup, and use complete dependencies. The probe requests review but does not ban Effects by itself.

Tracen keeps temporary, generated, deployment, worktree, and cache paths out of tracked source. Git and Codex also ignore the local artifact roots. Add future guardrails to the existing validator, tests, type system, or compatibility check. Add a separate rule engine or waiver format only when a concrete rule cannot fit those owners.

## Reason

This gives repository guardrails one clear name. Deterministic checks stay in the existing local and CI path. React semantics stay in a focused review because a text scanner cannot decide whether an external synchronization boundary is real. The small probe makes every added Effect visible without adding another lint framework or blocking valid Effects.

## Update: the public copy

The public copy ships with no GitHub Actions workflows. `npm run tracen` is the complete
local offline gate, and `npm run verify:release` adds the installed-plugin smoke test.
