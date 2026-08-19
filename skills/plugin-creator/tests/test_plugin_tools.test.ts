import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { validate } from "../dist/scripts/validate_goose_plugin.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist", "scripts");

function makePlugin(root: string): string {
  const plugin = join(root, "demo-plugin");
  mkdirSync(join(plugin, "skills", "demo"), { recursive: true });
  writeFileSync(
    join(plugin, "plugin.json"),
    JSON.stringify({ name: "demo-plugin", version: "1.0.0", description: "A test plugin" })
  );
  writeFileSync(
    join(plugin, "skills", "demo", "SKILL.md"),
    "---\nname: demo\ndescription: Use this skill for demo tasks\n---\n\n# Demo\n"
  );
  return plugin;
}

test("valid skills plugin", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const { errors } = validate(makePlugin(tmp));
    assert.deepEqual(errors, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("valid hook and mcp plugin", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = join(tmp, "automation");
    mkdirSync(join(plugin, "hooks"), { recursive: true });
    mkdirSync(join(plugin, "scripts"));
    mkdirSync(join(plugin, "servers"));
    writeFileSync(
      join(plugin, "plugin.json"),
      JSON.stringify({ name: "automation", version: "1.0.0", description: "Automation plugin" })
    );
    writeFileSync(join(plugin, "scripts", "guard.sh"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(plugin, "servers", "tool"), "#!/bin/sh\n");
    writeFileSync(
      join(plugin, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: ".*",
              hooks: [
                {
                  type: "command",
                  command: "${PLUGIN_ROOT}/scripts/guard.sh",
                  timeout: 5,
                },
              ],
            },
          ],
        },
      })
    );
    writeFileSync(
      join(plugin, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          tool: {
            command: "${PLUGIN_ROOT}/servers/tool",
            args: ["--stdio"],
            env: { MODE: "test" },
          },
        },
      })
    );
    const { errors } = validate(plugin);
    assert.deepEqual(errors, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects bare star and missing file", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = join(tmp, "bad-plugin");
    mkdirSync(join(plugin, "hooks"), { recursive: true });
    writeFileSync(
      join(plugin, "plugin.json"),
      JSON.stringify({ name: "bad-plugin", version: "1.0.0", description: "Bad plugin" })
    );
    writeFileSync(
      join(plugin, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "*", hooks: [{ command: "${PLUGIN_ROOT}/scripts/missing.sh" }] },
          ],
        },
      })
    );
    const { errors } = validate(plugin);
    assert.ok(errors.some((e) => e.includes("invalid regex")));
    assert.ok(errors.some((e) => e.includes("does not exist")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("package excludes git metadata", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    mkdirSync(join(plugin, ".git", "objects"), { recursive: true });
    writeFileSync(join(plugin, ".git", "config"), "secret metadata");
    const output = join(tmp, "dist", "plugin.zip");
    execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output], {
      encoding: "utf-8",
    });
    const zip = new AdmZip(output);
    const names = zip.getEntries().map((e) => e.entryName);
    assert.ok(!names.some((n) => n.includes("/.git/")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
