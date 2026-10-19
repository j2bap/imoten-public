---
name: tracen
description: "Run after any React component, hook, context, or rendering change. Find each added Effect and reject derived state, event handling, stale dependencies, and other work that does not synchronize with an external system."
---

# Tracen

Review every React change before completion. Tracen applies the repository's Dune-style React rules. It does not ban Effects. It requires each Effect to prove that it synchronizes React with an external system.

Read [the evidence](references/evidence.md) and the [React review lens](../dev-review/references/lenses/react.md).

## Check the diff

Resolve the merge base. Include committed, staged, unstaged, and untracked React files. Run:

```bash
node <this-skill-directory>/scripts/check-react-diff.mjs --cwd <repository> --base <merge-base> --json
```

Exit 0 means the probe found no supported added Effect call. Exit 2 means review is required. Neither result replaces source review, and exit 2 is not proof of a defect.

Inspect every changed React file. Use the report as an inventory of direct, namespace, and named-import alias calls. Also inspect materially changed existing Effects and syntax that the probe cannot classify.

For each Effect, name:

- the external system;
- the state or resource synchronized with it;
- why render logic or the event handler cannot do the work;
- how cleanup reverses setup;
- how the dependency list covers every reactive value.

Remove an Effect when it derives state, handles a user event, resets state after a prop change, chains state updates, or mirrors values that render can calculate. Keep synchronization with browser APIs, network connections, subscriptions, timers, or non-React widgets when the code meets the checks above.

Run the repository's existing React Hooks lint, type check, and closest behavior test. Do not add a second lint stack when the repository already has one. If the repository lacks React Hooks lint, report that gap. Do not claim Tracen passed while an Effect remains unexplained.

When the user asked for implementation, fix verified misuse before you finish. Report the changed React files, Effect count, each kept Effect with its external system, each removed Effect with its replacement, and the commands with exit codes.
