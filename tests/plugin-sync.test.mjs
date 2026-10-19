import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSyncPlan,
  parseProfiles,
  resolveProfileHomes,
} from "../scripts/sync-local-plugin.mjs";

test("profile selection defaults to the isolated personal Codex home", () => {
  assert.deepEqual(parseProfiles(), ["personal"]);
  assert.deepEqual(parseProfiles("all"), ["personal"]);
  assert.deepEqual(parseProfiles("personal,personal"), ["personal"]);
});

test("profile selection rejects unknown homes", () => {
  assert.throws(() => parseProfiles("work"), /profiles must be personal or all/u);
});

test("profile homes follow the same resolver as the launcher", () => {
  assert.deepEqual(resolveProfileHomes({
    profiles: ["personal"],
    userHome: "/tmp/imoten-sync-user",
    env: {},
  }), {
    personal: "/tmp/imoten-sync-user/.codex-personal",
  });
});

test("sync plan reinstalls the profile only after source or version changes", () => {
  const state = {
    source_digest: "same",
    manifest_version: "0.2.0+codex.old",
    profiles: {
      personal: { installed_version: "0.2.0+codex.old" },
    },
  };
  assert.deepEqual(buildSyncPlan({
    sourceDigest: "same",
    manifestVersion: "0.2.0+codex.old",
    state,
    profiles: ["personal"],
  }), {
    source_changed: false,
    version_changed: false,
    needs_cachebuster: false,
    profiles_to_install: [],
    up_to_date: true,
  });
  assert.deepEqual(buildSyncPlan({
    sourceDigest: "new",
    manifestVersion: "0.2.0+codex.old",
    state,
    profiles: ["personal"],
  }).profiles_to_install, ["personal"]);
});
