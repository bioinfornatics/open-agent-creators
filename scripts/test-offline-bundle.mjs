#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const tmp = mkdtempSync(path.join(tmpdir(), "agent-plugins-offline-"));
const archive = path.join(tmp, "agent-plugins.zip");
const extracted = path.join(tmp, "extracted");
mkdirSync(extracted);

function run(script, args = [], cwd = extracted) {
  const result = spawnSync(node, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_PATH: "",
      npm_config_offline: "true",
      npm_config_cache: path.join(tmp, "empty-npm-cache"),
    },
  });
  if (result.status !== 0) {
    throw new Error(`Offline command failed: ${script} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  const packager = path.join(sourceRoot, "skills", "plugin-creator", "dist", "scripts", "package_goose_plugin.js");
  execFileSync(node, [packager, sourceRoot, archive], { stdio: "inherit" });
  execFileSync("unzip", ["-q", archive, "-d", extracted]);
  const plugin = path.join(extracted, "agent-plugins");

  const allFiles = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else allFiles.push(full);
    }
  }
  walk(plugin);

  const relative = allFiles.map((file) => path.relative(plugin, file).split(path.sep).join("/"));
  for (const excluded of [".agents/", ".claude/", ".codex/", "evaluations/"]) {
    if (relative.some((file) => file.startsWith(excluded))) throw new Error(`Archive contains repository-local metadata: ${excluded}`);
  }
  if (relative.includes("CLAUDE.md")) throw new Error("Archive contains repository-local CLAUDE.md");
  if (!relative.includes(".vscode/tasks.json")) throw new Error("Archive is missing maintained VS Code tasks");
  if (relative.some((file) => /(^|\/)node_modules\//.test(file) && !/(^|\/)vendor\/node_modules\//.test(file))) {
    throw new Error("Archive contains development node_modules outside vendor/");
  }
  for (const required of [
    "skills/skill-creator/dist/scripts/quick_validate.js",
    "skills/skill-creator/vendor/node_modules/js-yaml/package.json",
    "skills/skill-creator/vendor/node_modules/adm-zip/package.json",
    "skills/plugin-creator/vendor/node_modules/adm-zip/package.json",
    "skills/agent-creator/vendor/node_modules/js-yaml/package.json",
    "skills/hook-creator/vendor/manifest.json",
  ]) {
    if (!existsSync(path.join(plugin, required))) throw new Error(`Missing offline artifact: ${required}`);
  }

  run(path.join(plugin, "skills", "skill-creator", "dist", "scripts", "quick_validate.js"), [path.join(plugin, "skills", "skill-creator")]);
  const skillOut = path.join(tmp, "skill-out");
  mkdirSync(skillOut);
  run(path.join(plugin, "skills", "skill-creator", "dist", "scripts", "package_skill.js"), [path.join(plugin, "skills", "skill-creator"), skillOut]);
  const standaloneArchive = path.join(skillOut, "skill-creator.skill");
  const standaloneExtract = path.join(tmp, "standalone-skill");
  mkdirSync(standaloneExtract);
  execFileSync("unzip", ["-q", standaloneArchive, "-d", standaloneExtract]);
  const standaloneSkill = path.join(standaloneExtract, "skill-creator");
  run(path.join(standaloneSkill, "dist", "scripts", "quick_validate.js"), [standaloneSkill], standaloneExtract);

  const agent = path.join(tmp, "agent.md");
  writeFileSync(agent, "---\nname: offline-reviewer\ndescription: Reviews offline bundles\n---\n\nReview the bundle.\n");
  run(path.join(plugin, "skills", "agent-creator", "dist", "scripts", "validate_agent.js"), [agent]);
  run(path.join(plugin, "skills", "plugin-creator", "dist", "scripts", "validate_agent_plugin_schema.js"), [plugin, "--format", "json"]);
  run(path.join(plugin, "skills", "plugin-creator", "dist", "scripts", "validate_goose_plugin.js"), [plugin]);
  const repacked = path.join(tmp, "repacked.zip");
  run(path.join(plugin, "skills", "plugin-creator", "dist", "scripts", "package_goose_plugin.js"), [plugin, repacked]);
  if (!existsSync(repacked)) throw new Error("Offline plugin repack did not produce an archive");

  console.log(JSON.stringify({ status: "passed", archive, extractedPlugin: plugin, files: relative.length }, null, 2));
} finally {
  if (!process.env.KEEP_OFFLINE_TEST) rmSync(tmp, { recursive: true, force: true });
}