#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] ?? join(root, "dist", "agent-plugins.zip"));
mkdirSync(dirname(output), { recursive: true });

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(join(root, "scripts", "prepare-offline-bundle.mjs"));
run(join(root, "scripts", "test-offline-bundle.mjs"));
run(join(root, "skills", "plugin-creator", "dist", "scripts", "package_goose_plugin.js"), [root, output]);
if (!existsSync(output)) process.exit(2);
console.log(JSON.stringify({ status: "packaged", output }, null, 2));
