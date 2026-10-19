# 0016: Track each upstream plugin with its own lock

## Context

Imoten began as a port of one upstream plugin, pstack. The provenance tools
(`upstream.lock.json`, `compatibility/pstack-map.json`, and
`scripts/generate-compatibility-report.mjs`) assume that one source.

Imoten now also ports skills from four other plugins in the same upstream
repository, plus a fifth one that it already partly used. One earlier
skill from those plugins had only a `NOTICE` line and no hash record, so a
later upstream change to it had no review path.

## Decision

Keep the pstack lock and map where they are. Give every other upstream
plugin its own set under `compatibility/plugins/<upstream-directory>/`:

- `upstream.lock.json` records the source commit, version, and file hashes.
- `map.json` gives every upstream file a derived path, a classification, and
  a disposition, in the same schema as the pstack map.
- `report.md` is generated from the two files.

The existing scripts already accept `--lock`, `--map`, `--output`, and
`--subdirectory`, so no new tool is needed. `npm run compatibility:check`
checks every set.

Ported skills use Imoten names and wording. The upstream plugin name appears
only in provenance files and license attribution.

## Reason

One lock per upstream plugin keeps each review small, and it lets each plugin
move to a new commit on its own schedule. It reuses the tested pstack review
path instead of adding a second format. Keeping the source name out of skill
names and descriptions keeps the surface host-neutral, while the lock and
`NOTICE` still meet the license and let a sync find every changed file.
