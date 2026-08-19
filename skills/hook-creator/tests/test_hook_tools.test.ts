import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateHooks } from "../dist/hook_format.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");

function makePlugin(root: string): string {
  const plugin = join(root, "demo-plugin");
  mkdirSync(plugin);
  writeFileSync(
    join(plugin, "plugin.json"),
    JSON.stringify({ name: "demo-plugin", version: "1.0.0", description: "Demo" })
  );
  return plugin;
}

test("scaffold and validate", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-test-"));
  try {
    const plugin = makePlugin(tmp);
    execFileSync(
      "node",
      [
        join(DIST, "init_hook.js"),
        plugin,
        "PostToolUse",
        "record-tool",
        "--matcher",
        "developer__shell",
      ],
      { encoding: "utf-8" }
    );
    const result = validateHooks(plugin);
    assert.deepEqual(result.errors, []);
    const mode = statSync(join(plugin, "scripts", "record-tool.sh")).mode;
    assert.ok(mode & 0o111);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects unknown event and bare star", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-test-"));
  try {
    const plugin = makePlugin(tmp);
    mkdirSync(join(plugin, "hooks"));
    writeFileSync(
      join(plugin, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          SubagentStart: [{ matcher: "*", hooks: [{ command: "echo hi" }] }],
        },
      })
    );
    const errors = validateHooks(plugin).errors;
    assert.ok(errors.some((e) => e.includes("Unsupported hook event")));
    assert.ok(errors.some((e) => e.includes("invalid") && e.includes("regex")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects missing plugin-relative script", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-test-"));
  try {
    const plugin = makePlugin(tmp);
    mkdirSync(join(plugin, "hooks"));
    writeFileSync(
      join(plugin, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: "command",
                  command: "${PLUGIN_ROOT}/scripts/missing.sh",
                  timeout: 5,
                },
              ],
            },
          ],
        },
      })
    );
    const errors = validateHooks(plugin).errors;
    assert.ok(errors.some((e) => e.includes("does not exist")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
