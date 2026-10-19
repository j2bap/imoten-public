---
name: umamusume-naming
description: "Use Umamusume character names for Codex-owned codenames such as agent lanes, tasks, branches, worktrees, prototypes, and temporary artifacts. Do not replace names set by the user, repository, product, API, ticket, or domain."
---

# Umamusume naming

When you choose a non-semantic codename, base it on an Umamusume character. Keep the work's purpose readable.

- Use this rule only for names that Codex owns. Preserve names from the user, repository, product, API, ticket, and domain.
- Keep semantic source-code names. Do not rename a symbol only to add an Umamusume reference.
- Add the purpose when the name must explain its job. Use `tokai_teio_tests`, `tokai-teio-tests`, or `Tokai Teio tests` to match the target format.
- Give concurrent lanes distinct character names. Keep each name stable for the life of that lane.
- Use a known character name. Good defaults are Special Week, Silence Suzuka, Tokai Teio, Mejiro McQueen, Gold Ship, Rice Shower, Haru Urara, Oguri Cap, Nice Nature, Twin Turbo, Agnes Tachyon, Manhattan Cafe, Kitasan Black, and Satono Diamond.

If the target accepts only a strict machine identifier, transliterate the character name and use the required separator. For example, a Codex `task_name` can use `rice_shower_review`.
