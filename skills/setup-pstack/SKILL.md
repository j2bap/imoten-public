---
name: setup-pstack
description: "Detect available Codex models, configure Imoten's inherited pstack roles, or manage the two optional Codex agent profiles. Use for setup-pstack or requests to configure Imoten agents and models."
---

# Set up Imoten

Bare `$setup-pstack`, `configure`, and `models` configure model roles. Read `references/model-roles.md` and write `$CODEX_HOME/imoten-models.md`. When `CODEX_HOME` is unset, `$CODEX_HOME` means `~/.codex`.

Use `scripts/imoten-profile.mjs` to run Codex in the personal Codex home without relying on shell aliases:

```text
node skills/setup-pstack/scripts/imoten-profile.mjs doctor --profile personal
node skills/setup-pstack/scripts/imoten-profile.mjs run --profile personal -- exec --help
```

The launcher sets the selected `CODEX_HOME` and `IMOTEN_ACTIVE_CODEX_HOME`, then removes inherited `OPENAI_API_KEY` and `OPENAI_BASE_URL` values. Poteto's trusted hook exposes `IMOTEN_ACTIVE_CODEX_HOME` as the runtime receipt because Codex tool processes may omit `CODEX_HOME`. It does not merge sessions, credentials, model proofs, or approval state. The personal profile's implicit provider is the host's native Codex default and needs a native role map. Any `review-required` doctor result must remain visible.

For a shell-independent command, install the receipt-owned commands once:

```text
node scripts/install-profile-launcher.mjs install
imoten-profile doctor --profile personal
codex-personal exec --help
```

The installer writes only `~/.local/share/imoten-profile` and `~/.local/bin`, refuses unowned collisions, and never edits shell startup files or approval settings. Use `node scripts/install-profile-launcher.mjs uninstall` to remove unchanged managed files.

Use `node scripts/manage-agents.mjs local` to install or refresh only the local operator. This action updates the local section of the existing role map and makes no remote model requests.

Only `install agents`, `inspect agents`, `upgrade agents`, or `uninstall agents` manage the optional TOML profiles. For those actions, read `references/model-profile.md` and use `scripts/manage-agents.mjs`.

## Configure model roles

1. Inspect the selected profile first. For the personal profile's native default, validate the recommended pairs against the host-provided native collaboration catalog and write the native role map directly. For direct DeepSeek, run `node scripts/manage-agents.mjs models`. The helper reads the selected Codex provider, fetches `/models`, proves the selected model and effort with `/responses`, and leaves `model_catalog_json` unset. It stops for any other provider. It also installs the exact-path `imoten-local-operator` launcher and its loopback oMLX config.
2. Read the current rule when it exists. A line whose role is not in the recommended map in `references/model-roles.md` is from a retired role. Drop it.
3. Show every role, its current value, and the recommended value in one compact table. Also list each line step 2 dropped.
4. For direct DeepSeek, use the selected Codex model and effort for every role.
   Per-task role selection uses [the typed classifier decision protocol](../poteto-mode/references/jev-decision-protocol.md) through Poteto Mode. Setup itself remains deterministic and must not use either classifier provider to prove model availability or served-model identity.
5. Use only pairs in the active profile's validated catalog. For direct DeepSeek, require the generated receipt. For native collaboration, require the host catalog and validate again at dispatch. Stop if the provider, pair, or served model cannot be validated. Create the parent directory when needed.
6. Read the finished rule and report its path and selected map.
7. When the local oMLX server is running, run `$CODEX_HOME/bin/imoten-local-operator probe`. Require the exact model from the local role map. The server can remain stopped when local inference is optional.

Do not install agent profiles during model-role setup unless the user asks for both actions.

## Manage optional agent profiles

The profiles are `imoten-poteto-agent` and `imoten-comment-sicko`. They are optional. The portable prompts in their owning skills remain authoritative.

- Require explicit user intent for install, upgrade, or uninstall.
- Ask for `project` or `user` scope when unclear.
- Scan project and user agent directories before a write. Stop on duplicate TOML `name` fields.
- Update or remove only files whose SHA-256 matches this setup's receipt.
- Never claim a served model or effective permission without live proof.

Use the helper relative to this skill:

```text
node scripts/manage-agents.mjs scan --project-root <repo>
node scripts/manage-agents.mjs local
node scripts/manage-agents.mjs models
node scripts/manage-agents.mjs install --scope project --project-root <repo>
node scripts/manage-agents.mjs install --scope user --project-root <repo>
node scripts/manage-agents.mjs uninstall --scope project --project-root <repo>
```

The helper uses the active `CODEX_HOME`. Pass `--user-home <home>` to target a different home with its default `.codex` directory, or pass `--codex-home <codex-home>` to target an exact Codex state root.

`install` refreshes the generated catalog before it writes profiles. It supports direct DeepSeek only. Add `--profile <json-file>` only for explicit custom pairs. The helper writes an exact pair for every profile and stops when a live request or served-model check fails. On a collision or `review-required`, show the exact paths and stop.
