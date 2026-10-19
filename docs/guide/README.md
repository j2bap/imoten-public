# The Imoten guide

This guide takes one task from installation through verification. Every Imoten skill is explicit-only, so examples use `$skill-name`.

1. [Set up Imoten](./01-setup.md).
2. [Route work through `$imoten:poteto-mode`](./02-poteto-mode.md).
3. [Understand the code](./03-understand.md).
4. [Design the change](./04-design.md).
5. [Build and clean the change](./05-build-and-clean.md).
6. [Verify and ship](./06-verify-and-ship.md).
7. [Run authorized overnight work](./07-overnight.md).
8. [Steer with principle names](./08-principles.md).
9. [Make the workflows yours](./09-make-it-yours.md).
10. [Use the recipes and avoid the pitfalls](./10-recipes-and-pitfalls.md).
11. [Hillclimb models and skills](./11-hillclimb-models-and-skills.md).

Start with a real, bounded task:

```text
$imoten:poteto-mode the export writes duplicate rows after a retry. Reproduce it first, then fix and verify it.
```

The goal and the finish condition matter more than a list of tools. Poteto Mode chooses the playbook and reports any capability fallback.

When you are stuck, or cannot tell which skill fits, type [`$poteto-help`](../../skills/poteto-help/SKILL.md) with your question:

```text
$poteto-help which skill should I use to review this branch?
```

It answers, hands you a prompt to send, and links the skill or guide page the answer came from. It does not start the work, because a run spends real tokens, so you send the prompt when you are ready.

Next: [Set up Imoten](./01-setup.md).
