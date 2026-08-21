import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const creatorNames = ["skill-creator", "agent-creator", "hook-creator", "plugin-creator"];

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const name of creatorNames) {
  const creatorRoot = path.join(root, "skills", name);
  console.log(`\n> Testing ${name}`);
  run([path.join(creatorRoot, "scripts", "test.mjs")], creatorRoot);
}

console.log("\n> Testing distribution");
run(["--test", path.join(root, "tests", "test_distribution.test.ts")]);

console.log("\n> Testing offline bundle");
run([path.join(root, "scripts", "test-offline-bundle.mjs")]);
