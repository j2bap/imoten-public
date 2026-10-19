import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the two review personas remain separate", async () => {
  const [dev, thermo] = await Promise.all([
    fs.readFile(path.join(root, "skills/dev-review/SKILL.md"), "utf8"),
    fs.readFile(path.join(root, "skills/thermo-nuclear-code-quality-review/SKILL.md"), "utf8"),
  ]);
  assert.match(dev, /`blocker`, `major`, `minor`, or `nit`/);
  assert.match(dev, /security/i);
  assert.match(thermo, /maintainability/i);
  assert.match(thermo, /code judo/i);
});

test("the hand-picked dev-review personas remain", async () => {
  const personas = {
    "a11y.md": /Heydon Pickering/,
    "be-security.md": /Filippo Valsorda.*Tavis Ormandy/s,
    "build-perf.md": /Rich Harris.*Evan You/s,
    "complexity.md": /John Ousterhout/,
    "craft.md": /John Carmack.*Linus Torvalds/s,
    "data-layer.md": /Markus Winand.*D\. Richard Hipp/s,
    "design-eng.md": /Rauno Freiberg.*Emil Kowalski/s,
    "distsys.md": /Martin Kleppmann.*Kyle Kingsbury.*Jeff Dean/s,
    "fe-security.md": /Mike West/,
    "language-runtime.md": /Brian Goetz.*Joshua Bloch/s,
    "perf-ops.md": /Brendan Gregg.*Mike Acton/s,
    "react.md": /Sebastian Markbåge.*Dan Abramov/s,
    "testing.md": /John Hughes.*Will Wilson.*Gary Bernhardt/s,
    "types.md": /Anders Hejlsberg/,
  };

  for (const [file, pattern] of Object.entries(personas)) {
    const lens = await fs.readFile(path.join(root, "skills/dev-review/references/lenses", file), "utf8");
    assert.match(lens, pattern, file);
  }
});
