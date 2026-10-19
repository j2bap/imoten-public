# Set up Imoten

This tutorial installs the plugin, checks skill discovery, and runs one representative skill.

## Install for Codex

Install the marketplace from GitHub:

```bash
codex plugin marketplace add j2bap/imoten-public
codex plugin add imoten@imoten-local
codex plugin list --json
```

For development, pass the absolute checkout path to `codex plugin marketplace add`. Start a new Codex task after installation so the task receives the refreshed skill catalog.

`codex plugin list --json` confirms the plugin installation, but the tested Codex plugin CLI has no offline runtime skill-index command. The prompt below is the manual prompt-time discovery check; the automated release smoke validates the catalog files in the installed artifact without claiming model dispatch.

## Install for Claude Code

Run these commands inside Claude Code:

```text
/plugin marketplace add j2bap/imoten-public
/plugin install imoten@j2bap-imoten
```

Restart the session after installation so Claude Code reloads the skill catalog.

## Check one skill

Open a repository and ask for a read-only trace:

```text
$how explain how this repository validates plugin metadata.
```

Codex resolves `$how` to the installed `imoten` namespace. The response should cite code paths and separate observed behavior from inference.

## Run the main workflow

Start with a small task whose result you can check:

```text
$imoten:poteto-mode add a --json flag to this command. Keep text output byte-identical. Verify both modes.
```

Poteto Mode should show the matched playbook steps and report the checks it ran.

## Configure model roles

Run bare setup in a new task:

```text
$setup-pstack
```

The personal profile uses the host-provided native Codex catalog and writes a
native role map. With direct DeepSeek, setup verifies the selected model through
`/models`, proves its configured effort through `/responses`, and leaves
`model_catalog_json` unset. Every path writes `$CODEX_HOME/imoten-models.md`,
defaulting to `~/.codex/imoten-models.md`. Programmatic workflow callers use
`skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs`, which runs one
native primary session for the active profile.

## Use the personal profile

The personal profile keeps its Codex state in `~/.codex-personal`. Use the profile launcher instead of a shell alias:

```bash
node skills/setup-pstack/scripts/imoten-profile.mjs doctor --profile personal
node skills/setup-pstack/scripts/imoten-profile.mjs run --profile personal -- exec --help
```

The launcher selects `CODEX_HOME`, clears inherited `OPENAI_API_KEY` and `OPENAI_BASE_URL` values, and reports a missing model, reasoning effort, or role map. It does not share sessions or bypass managed-host approval. The personal profile's implicit provider is the host's native Codex default. It is configured when its model, reasoning effort, and native role map are present.

To run the profile as an explicit command in new shells, install the receipt-owned wrappers:

```bash
node skills/setup-pstack/scripts/install-profile-launcher.mjs install
imoten-profile doctor --profile personal
codex-personal exec --help
```

The installer uses `~/.local/bin` and does not modify `.zshrc`, credentials, or approval policy. Run the same script with `uninstall` to remove only unchanged files it owns.

## Sync a local plugin update

The repository is the source of truth for Imoten. Codex keeps a versioned plugin cache under each `CODEX_HOME`, so a skill edit is not visible until the plugin is reinstalled. Sync the profile with one command:

```bash
npm run plugin:sync
```

The sync validates the plugin, reads the local marketplace name, changes one cachebuster only when the source tree changed, reinstalls `imoten` into `~/.codex-personal`, refreshes the receipt-owned profile launcher, and records state under `.audit/plugin-sync.json`. It does not refresh model catalogs, credentials, or approval policy. Use `npm run plugin:sync:check` for a read-only plan. Start a new Codex thread after a sync so the updated skill index is loaded.

## Keep the cost in check

Imoten spends extra tokens on subagents and review panels. That is the price of the rigor. To spend fewer:

- Shorten a panel list. Each entry runs one subagent.
- Use `$imoten:poteto-mode` for work that needs rigor. A small, obvious edit does not.

## Install optional agent profiles

The plugin works without custom profiles. To add them, run:

```text
$setup-pstack install agents for this project.
```

Choose `project` or `user` scope when asked. Project scope writes `.codex/agents/*.toml`. User scope writes `$CODEX_HOME/agents/*.toml`. Setup scans both locations for duplicate agent names and refuses to overwrite unowned files.

Setup gives each profile the exact pair assigned to its role. To override it, provide both the model and `reasoning_effort`. Setup stops if the live Codex selector or provider cannot prove the pair.

The result includes the written paths, receipt path, hashes, and configuration status. New profiles apply to agents spawned after installation.

## Remove or upgrade owned profiles

Invoke `$setup-pstack` with an explicit action and scope:

```text
$setup-pstack inspect agents for this project.
$setup-pstack upgrade agents for this project.
$setup-pstack uninstall agents for this project.
```

Upgrade and uninstall touch only receipted files whose current hashes still match. A changed or relocated file produces `review-required` and remains untouched.

Next: [Route work through `$imoten:poteto-mode`](./02-poteto-mode.md).
