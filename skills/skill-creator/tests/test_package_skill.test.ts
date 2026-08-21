import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageSkill } from "../dist/scripts/package_skill.js";

test("skill packaging rejects symbolic links", () => {
  const tmp = mkdtempSync(join(tmpdir(), "package-skill-"));
  try {
    const root = join(tmp, "demo");
    mkdirSync(root);
    writeFileSync(join(root, "SKILL.md"), "---\nname: demo\ndescription: Demo work\n---\n\n# Demo\n");
    writeFileSync(join(tmp, "secret.txt"), "secret");
    symlinkSync(join(tmp, "secret.txt"), join(root, "secret-link"));
    const oldLog = console.log;
    console.log = () => {};
    try { assert.equal(packageSkill(root, join(tmp, "out")), null); }
    finally { console.log = oldLog; }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
