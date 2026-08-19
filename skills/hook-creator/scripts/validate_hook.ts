#!/usr/bin/env node
// Validate the hook component of a Goose/Open Plugins plugin.
import { resolve, join } from "node:path";
import { validateHooks } from "./hook_format.js";

function main() {
  const [pluginDir] = process.argv.slice(2);
  if (!pluginDir) {
    console.error("usage: validate_hook.js <plugin_dir>");
    process.exit(2);
  }
  const root = resolve(pluginDir);
  const result = validateHooks(root);
  for (const warning of result.warnings) {
    console.log(`WARNING: ${warning}`);
  }
  if (result.errors.length) {
    for (const error of result.errors) {
      console.log(`ERROR: ${error}`);
    }
    process.exit(1);
  }
  console.log(`OK: ${join(root, "hooks", "hooks.json")}`);
}

main();
