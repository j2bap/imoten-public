# Codex agent transport

Read this file only when you call the workflow dispatcher or the local operator. [`codex-agent-runtime.md`](codex-agent-runtime.md) decides when to delegate, which role and pair to use, and which fallback applies. This file owns how each transport runs.

## Run the native primary session

Keep ordinary coupled work in the parent Codex session. When a programmatic workflow needs one long-lived GPT thread, call `skills/setup-pstack/scripts/imoten-workflow-dispatch.mjs`. It routes to `codex-primary-session-runner.mjs`, backed by `codex-primary-session.mjs`, which owns one context branch and one Codex app-server connection. Steer or interrupt only while an active app-server turn ID exists. Do not route this native primary work through the local operator.

## Use the installed local operator

`$setup-pstack` installs `bin/imoten-local-operator` and its config under the active Codex home. The config fixes the endpoint, exact model, limits, and maximum concurrency. The runner checks the loopback endpoint, request fields, served model, and result shape itself. Do not let an individual skill choose an endpoint, model, concurrency limit, or fallback role.

Call the launcher by its resolved exact path. `$setup-pstack` installs one execution-policy rule for that exact path. Pass each request this way:

1. Write the request to a new private temporary file without shell interpolation. The runner rejects a file with group or world access.
2. Pass its absolute path with `dispatch --request-file`.
3. Trash the file after the runner accepts or rejects it.

Do not use a pipe, heredoc, redirection, environment expansion, or wrapper shell, because those forms cannot match the exact-path execution rule. Use `--request-json` only from an argument-array API that does not invoke a shell.

Run a local batch in this order:

1. Run `imoten-local-operator probe` once before the batch.
2. Put the fixed evidence and acceptance rule in `prompt.context` and the bounded task in `prompt.task`.
3. Send independent tasks as separate runner processes, at most the configured concurrency at once. The runner has no broker, queue, or shared lock.

Accept a local result only when the runner exits with code 0, the result `status` is `completed`, and the result passes the task-specific acceptance check. A valid local result needs no remote review.

Dispatch the original packet once to the selected remote role after any local failure. Failures include a failed probe, a timeout, a non-zero exit, an `escalate` status, and a failed acceptance check. Do not retry the local turn.
