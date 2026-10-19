# Upstream maintenance

This repository derives from `pstack` in `https://github.com/cursor/plugins`. The locked source is version `0.15.28` at commit `d457567332aa6989e753ea289f30ea2bfbc80bc0`.

The delivered repository contains only the modified Codex version. Do not push a raw upstream branch or snapshot commit. Do not keep an upstream remote in the delivered checkout.

## Provenance files

- [`NOTICE`](./NOTICE) records attribution and the source commit.
- [`upstream.lock.json`](./upstream.lock.json) records the 172 source paths, sizes, and SHA-256 hashes.
- [`compatibility/pstack-map.json`](./compatibility/pstack-map.json) assigns each source path a Codex path, classification, invariant, and validation.
- [`compatibility/report.md`](./compatibility/report.md) is the generated human-readable report.

## Check the locked source

Use a temporary local source checkout. The import helper removes its own temporary clone when you pass a repository URL, and it never writes into the derived tree.

```bash
node scripts/import-upstream.mjs \
  --source https://github.com/cursor/plugins \
  --subdirectory pstack \
  --commit d457567332aa6989e753ea289f30ea2bfbc80bc0 \
  --verify-lock \
  --dry-run
```

The command must report `Verified 172 files`.

## Review a newer source commit

Get the current upstream commit SHA. Then run the review command. The command creates a temporary sparse checkout, prints the changed `pstack` paths, and deletes the checkout.

```bash
git ls-remote https://github.com/cursor/plugins refs/heads/main
npm run upstream:review -- --commit 7314f723a487ec406b6369fe5865ba034cfed166
```

The command requires a full 40-character commit SHA. To print the exact Git patch, add `--patch`.

1. Run `npm run upstream:review -- --commit <full-sha>`.
2. Review every added, changed, deleted, or renamed path. Record a `refreshDisposition` in `compatibility/pstack-map.json` before adapting code.
3. Port behavior into the Codex tree. Do not copy host-specific installation or runtime claims.
4. Update the source metadata and hashes in `upstream.lock.json` only after review.
5. Regenerate `compatibility/report.md` and run the full release checks.
6. Confirm that the delivered repository has no upstream remote or raw source branch.

To inspect a candidate without changing the committed report, run:

```bash
node scripts/generate-compatibility-report.mjs \
  --check \
  --upstream-dir /absolute/path/to/temporary/plugins/pstack
```

The command exits with blocking findings until every source delta has an explicit disposition. The import helper refuses to overwrite an existing output directory, and the inventory rejects symlinks.

## Version 0.15.0 refresh

This refresh adds `principle-attack-the-premise` and `principle-test-behavior-not-implementation`. It also ports the upstream prose and workflow cleanup across the skill and playbook set.

The upstream `how` skill no longer owns architecture critique. Imoten removes its two obsolete critic references and keeps architecture review in `interrogate`. Codex session, model-role, forge, authority, and capability contracts remain local adaptations.

## Version 0.15.2 refresh

This refresh adds the 0.15.1 evidence-label rule, uses operator-neutral wording in the autonomous playbooks, and makes the multi-phase audit tick require an in-chat status update. Imoten keeps its Codex runtime, goal, heartbeat, forge, and authority adaptations.

## Version 0.15.5 refresh

This refresh ports the model-neutral workflow changes from 0.15.3 through 0.15.5. Autopilot owners now report a code-ready head, and the root verifies each round from that head on. Owners keep a `children.tsv` of their subagents, rebase their own branches with a lease, and wait for CI after merge prep. Shipping gains the patch-id noise rule. Swarm briefs name exact SHAs and methods. Decision logs gain run `start` rows and an append-only audit. Plan live lanes use the `Swarm worker` pair.

Imoten skips three kinds of upstream change:

- Cursor model slugs, alias entries, and rejected-slug fallback rules. [ADR 0002](./docs/adr/0002-require-exact-model-role-pairs.md) requires exact proven pairs.
- The setup reasoning-budget remap. It rewrites every effort, and each new pair would need live proof under ADR 0002.
- Removal-only cuts of instructions that one model follows without the text. [ADR 0015](./docs/adr/0015-keep-guardrails-upstream-cuts-for-one-model.md) keeps them because Imoten runs several model families.

## Other upstream plugins

Imoten also ports skills from five other plugins in the same repository. Each has its own lock, map, and report under `compatibility/plugins/<upstream-directory>/`, as [ADR 0016](./docs/adr/0016-track-each-upstream-plugin-with-its-own-lock.md) records. The skills use Imoten names, so only these files and `NOTICE` name the source plugin.

To review a newer commit for one plugin, pass its lock and map:

```bash
node scripts/review-upstream.mjs --commit <full-sha> \
  --lock compatibility/plugins/<upstream-directory>/upstream.lock.json \
  --map compatibility/plugins/<upstream-directory>/map.json
```

Then follow the same numbered steps as pstack, and regenerate that plugin's report with the same `--lock` and `--map` plus `--output compatibility/plugins/<upstream-directory>/report.md`. `npm run compatibility:check` checks every plugin.

## Regenerate the report

After the lock and compatibility map agree, run:

```bash
node scripts/generate-compatibility-report.mjs
node scripts/generate-compatibility-report.mjs --check
node --test tests/upstream-provenance.test.mjs tests/compatibility-map.test.mjs
```

Review the generated diff. A complete report accounts for every locked path and has no unresolved source delta.

## Version 0.15.10 refresh

This refresh adds `poteto-help`, `correct`, `benchmark-checklist`, and `principle-explain-the-number`. It ports benchmark validation, ordered performance strategies, agent-safe design checks, stronger TypeScript validators, shorter PR descriptions, and built-in PR tool selection. Agents start fresh for new work except when required state is costly to move. Autopilot owners push after each verifiable unit. A verified green head can tolerate later trunk movement only after conflict and changed-path checks.

The Codex runtime keeps ownership of goals, thread heartbeats, isolation, and exact model-role pairs. Audit ticks now run hourly through an authorized heartbeat. Cursor Custom Modes and `/loop 1h` remain upstream host features. Imoten keeps trusted sticky hooks and source attribution under ADR 0015. Every one of the 25 changed or added source paths has a refresh disposition in the compatibility map.

## Version 0.15.25 refresh

This refresh adds `ketchup`, `sharpen`, `in-your-own-words`, two `poteto-help` references, and the `check-plan` fence test. It ports the shorter `$ketchup` catch-up reply with screenshots, videos, and diagrams, the single-writer autopilot and shipping steps, the `-b` base option for `worktree-audit.sh`, and principles restated as reasoning.

Imoten skips upstream's effort-matching rule for subagents, the Cursor Custom Modes and `/loop` text, and the `/make-bot-ui` guide section. [ADR 0002](./docs/adr/0002-require-exact-model-role-pairs.md) requires exact proven model-role pairs. Removal-only cuts stay out under [ADR 0015](./docs/adr/0015-keep-guardrails-upstream-cuts-for-one-model.md). The `check-plan` test fixture now matches the local Codex plan rules. Every one of the 105 changed or added source paths has a refresh disposition in the compatibility map.

## Version 0.15.28 refresh

This refresh adds `create-formal-verification-skill` and `maintain-formal-verification-skill`. It ports the `$ketchup` reply that lists every item waiting on you with its evidence and risk, the type-guard rule for branded TypeScript types, and the guide and help text for `$sharpen`, `$in-your-own-words`, `$ketchup`, and formal verification.

Imoten skips three kinds of upstream change:

- The Claude Code adapter in `docs/harness/claude-code.md` and its install text. It maps Cursor names, but Imoten skills already use Codex names, and [ADR 0002](./docs/adr/0002-require-exact-model-role-pairs.md) requires exact model-role pairs instead of slug mapping.
- The formal verification offer in `setup-pstack`. Local setup configures model-role pairs only and makes no verification offers.
- Removal-only cuts in `sharpen`, `swarm`, the `interrogate` lead-judgment reference, and the type-system and migrate-callers principles. [ADR 0015](./docs/adr/0015-keep-guardrails-upstream-cuts-for-one-model.md) keeps them.

Every one of the 30 changed or added source paths has a refresh disposition in the compatibility map.
