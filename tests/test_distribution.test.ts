import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_NAME = "agent-plugins";
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
    readme.includes("goose plugin install https://github.com/bioinfornatics/agent-plugins.git")
  );
  for (const name of EXPECTED_SKILLS) {
    assert.ok(readme.includes(`${PLUGIN_NAME}:${name}`));
  }
});

test("explicit skill evaluation requests require the official completion receipt", () => {
  const text = readFileSync(join(ROOT, "skills", "skill-creator", "SKILL.md"), "utf-8");
  for (const required of [
    "Evaluation Completion Contract",
    "paired runs",
    "grading.json",
    "aggregate_benchmark.js",
    "eval-viewer/generate_review.js",
    "evaluation: blocked",
    "Never silently substitute an ad-hoc benchmark",
  ]) assert.ok(text.includes(required), required);
});

test("explicit plugin evaluation requests require behavioral skill and integration evidence", () => {
  const text = readFileSync(join(ROOT, "skills", "plugin-creator", "SKILL.md"), "utf-8");
  for (const required of [
    "Behavioral Evaluation Contract",
    "complete evaluation receipt",
    "plugin-level integration scenarios",
    "combined benchmark",
    "review viewer",
    "evaluation: blocked",
  ]) assert.ok(text.includes(required), required);
});

test("every creator ships a complete offline runtime bundle", () => {
  for (const name of EXPECTED_SKILLS) {
    const skill = join(ROOT, "skills", name);
    const pkg = JSON.parse(readFileSync(join(skill, "package.json"), "utf-8"));
    assert.equal(pkg.offlineBundle, true, `${name}: offlineBundle`);
    assert.ok(existsSync(join(skill, "dist")), `${name}: dist`);
    assert.ok(existsSync(join(skill, "vendor", "manifest.json")), `${name}: vendor manifest`);
    assert.ok(existsSync(join(skill, "THIRD_PARTY_NOTICES.md")), `${name}: notices`);
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      assert.ok(existsSync(join(skill, "vendor", "node_modules", dependency, "package.json")), `${name}: ${dependency}`);
    }
  }
});

test("offline vendors contain production dependencies only", () => {
  for (const name of EXPECTED_SKILLS) {
    const skill = join(ROOT, "skills", name);
    const pkg = JSON.parse(readFileSync(join(skill, "package.json"), "utf-8"));
    const manifest = JSON.parse(readFileSync(join(skill, "vendor", "manifest.json"), "utf-8"));
    const bundled = new Set(manifest.packages.map((item: { name: string }) => item.name));
    for (const dependency of Object.keys(pkg.dependencies ?? {})) assert.ok(bundled.has(dependency));
    for (const devDependency of Object.keys(pkg.devDependencies ?? {})) assert.ok(!bundled.has(devDependency), `${name}: bundled dev dependency ${devDependency}`);
  }
});
