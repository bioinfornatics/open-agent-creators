import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_NAME = "open-agent-creators";
const EXPECTED_SKILLS = new Set(["skill-creator", "agent-creator", "hook-creator", "plugin-creator"]);

test("open plugins manifest", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf-8"));
  assert.equal(manifest.name, PLUGIN_NAME);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description.trim());
});

test("skills are self-contained and named by directory", () => {
  const found = new Set<string>();
  const skillsDir = join(ROOT, "skills");
  for (const entry of readdirSync(skillsDir).sort()) {
    const skillFile = join(skillsDir, entry, "SKILL.md");
    let text: string;
    try {
      text = readFileSync(skillFile, "utf-8");
    } catch {
      continue;
    }
    const match = /^name:\s*([^\n]+)$/m.exec(text);
    assert.ok(match, skillFile);
    const name = match![1].trim().replace(/^['"]|['"]$/g, "");
    assert.equal(name, entry);
    found.add(name);
  }
  assert.deepEqual(found, EXPECTED_SKILLS);
});

test("plugin-creator routes to qualified names with fallbacks", () => {
  const text = readFileSync(join(ROOT, "skills", "plugin-creator", "SKILL.md"), "utf-8");
  for (const name of ["skill-creator", "hook-creator", "agent-creator"]) {
    assert.ok(text.includes(`${PLUGIN_NAME}:${name}`));
    assert.ok(text.includes(`\`${name}\``));
  }
});

test("documentation recommends plugin install", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  assert.ok(
    readme.includes("goose plugin install https://github.com/bioinfornatics/open-agent-creators.git")
  );
  for (const name of EXPECTED_SKILLS) {
    assert.ok(readme.includes(`${PLUGIN_NAME}:${name}`));
  }
});
