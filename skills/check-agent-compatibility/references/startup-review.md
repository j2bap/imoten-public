# Startup review

Try the cold-start path and report how much work it takes to get the repository running.

## Trigger

Use this prompt when the user wants to know whether a repository is actually easy to start, not just whether it claims to be.

## Workflow

1. If a compatibility scan result is already available from the parent task, use it as context. Otherwise run the compatibility scan once, as the scan prompt describes. If the scanner cannot run, continue without it.
2. Read the obvious startup surfaces: `README`, scripts, toolchain files, env examples, and workflow docs.
3. Pick the most likely bootstrap path and startup command.
4. Try to reach first success inside the time budget that the parent set.
5. If the first path fails, allow a small amount of recovery and note what you had to infer.
6. Do not infer a startup failure from a lockfile, a bound port, or an existing repository-local process by itself.
7. Only call startup blocked or failed when your own startup attempt fails, or when the documented startup path cannot be completed within the budget.
8. Pick a specific score instead of a round bucket. Start from these anchors and move a few points if the evidence clearly warrants it:
   - around `93/100` if the main startup path works inside the time budget, even if it needs ordinary local prerequisites such as Docker or a database.
   - around `84/100` if the repository starts, but only after some digging, a recovery step, or heavier setup than the docs suggest.
   - around `68/100` if a startup path probably exists but stays too manual, too ambiguous, or too expensive for normal agent use.
   - around `27/100` if you cannot get a credible startup path working from the repository and docs you have.
   - around `12/100` if the path is blocked on secrets, accounts, or infrastructure you cannot reasonably access.
9. Prefer a specific score such as `82`, `85`, or `91` over a multiple of ten when that is the more honest read.
10. Stop every server or background process you started. Do not edit tracked files.
11. Return the result in the same plain-text report shape as the deterministic scan.

## Output

Reply in plain text only: no Markdown fences, no `#` headings, and no emphasis syntax. Use this layout:

First line: `Startup Compatibility Score: <score>/100`

Then a short summary paragraph.

Then the line `Problems`, followed by one bullet per line using `- `.

- Base the score on what happened when you actually tried to start the repository.
- Build `Problems` from the real startup friction you observed.
- If the repository is blocked on secrets, accounts, or external infrastructure, say that plainly and still use the same output shape.
- Do not assume a Next.js lockfile or a port that does not answer HTTP immediately is a repository problem.
- Do not require an HTTP response unless the documented startup path clearly implies one and you actually started that path yourself.
- If the environment starts successfully, treat that as a strong result. Record the friction, but do not score it like a near-failure.
- Treat Docker, local services, and other standard development prerequisites as friction, not failure.
- Error-message quality is secondary here unless it actually prevents startup or recovery.
- If you could not attempt startup at all because of your own tool environment, write `Startup Compatibility Score: BLOCKED` on the first line and name what stopped you. Never guess a score.
