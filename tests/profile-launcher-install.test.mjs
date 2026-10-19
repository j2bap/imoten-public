import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  installProfileLauncher,
  inspectProfileLauncher,
  uninstallProfileLauncher,
} from "../skills/setup-pstack/scripts/install-profile-launcher.mjs";

test("profile launcher installs receipt-owned explicit switching commands", async (t) => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-profile-launcher-"));
  t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const installRoot = path.join(userHome, ".local", "share", "profile-runtime");
  const binDir = path.join(userHome, ".local", "bin");

  const installed = await installProfileLauncher({ userHome, installRoot, binDir });
  assert.equal(installed.status, "installed");
  assert.equal(installed.receipt_exists, true);
  assert.equal(installed.files.length, 3);
  assert.match(await fs.readFile(path.join(binDir, "codex-personal"), "utf8"), /--profile 'personal'/u);
  assert.match(await fs.readFile(path.join(binDir, "imoten-profile"), "utf8"), /imoten-profile\.mjs' "\$@"/u);

  const inspected = await inspectProfileLauncher({ userHome, installRoot, binDir });
  assert.equal(inspected.status, "installed");
  assert.equal(inspected.bin_on_path, false);

  const second = await installProfileLauncher({ userHome, installRoot, binDir });
  assert.equal(second.status, "installed");
});

test("profile launcher refuses unowned collisions and preserves divergent files", async (t) => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-profile-launcher-collision-"));
  t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const installRoot = path.join(userHome, "runtime");
  const binDir = path.join(userHome, "bin");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, "codex-personal"), "user-owned\n");
  await assert.rejects(
    installProfileLauncher({ userHome, installRoot, binDir }),
    /unowned profile launcher files/u,
  );
  assert.equal(await fs.readFile(path.join(binDir, "codex-personal"), "utf8"), "user-owned\n");

  await fs.rm(path.join(binDir, "codex-personal"));
  await installProfileLauncher({ userHome, installRoot, binDir });
  const original = await fs.readFile(path.join(binDir, "codex-personal"), "utf8");
  await fs.appendFile(path.join(binDir, "codex-personal"), "changed\n");
  const result = await uninstallProfileLauncher({ userHome, installRoot, binDir });
  assert.equal(result.status, "preserved-divergent-files");
  assert.deepEqual(result.preserved, [path.join(binDir, "codex-personal")]);
  assert.equal(await fs.readFile(path.join(binDir, "codex-personal"), "utf8"), `${original}changed\n`);
  assert.equal((await fs.readdir(installRoot)).some((name) => name.startsWith("profile-launcher.receipt.json.preserved-")), true);
});

test("profile launcher uninstall removes only unchanged managed files", async (t) => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), "imoten-profile-launcher-uninstall-"));
  t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const installRoot = path.join(userHome, "runtime");
  const binDir = path.join(userHome, "bin");
  await installProfileLauncher({ userHome, installRoot, binDir });
  const result = await uninstallProfileLauncher({ userHome, installRoot, binDir });
  assert.equal(result.status, "uninstalled");
  for (const file of [path.join(installRoot, "imoten-profile.mjs"), path.join(binDir, "codex-personal")]) {
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
  }
});
