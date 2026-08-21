import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
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
    JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "demo-plugin", version: "1.0.0", description: "A test plugin" })
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

test("placeholder detection distinguishes unfinished content from documentation and detector code", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    writeFileSync(join(plugin, "README.md"), "Search tasks with `rg TODO` and do not use TodoWrite.\n");
    writeFileSync(join(plugin, "detector.ts"), "if (text.includes(\"TODO\")) console.log(\"unresolved TODO placeholder\");\n");
    assert.deepEqual(validate(plugin).warnings, []);

    writeFileSync(join(plugin, "README.md"), "# TODO: finish the release instructions\n");
    assert.ok(validate(plugin).warnings.some((warning) => warning.includes("README.md")));

    writeFileSync(
      join(plugin, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: Use this skill for demo tasks\n---\n\n- FIXME add verification steps\n",
    );
    assert.ok(validate(plugin).errors.some((error) => error.includes("unresolved placeholder")));
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

test("package uses the manifest name as the archive root", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const checkout = makePlugin(tmp);
    writeFileSync(
      join(checkout, "plugin.json"),
      JSON.stringify({ "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "renamed-plugin", version: "1.0.0", description: "A renamed plugin" })
    );
    const output = join(tmp, "plugin.zip");
    execFileSync("node", [join(DIST, "package_goose_plugin.js"), checkout, output]);
    const names = new AdmZip(output).getEntries().map((entry) => entry.entryName);
    assert.ok(names.length > 0);
    assert.ok(names.every((name) => name.startsWith("renamed-plugin/")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("package includes vendor dependencies but excludes development node_modules", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    const skill = join(plugin, "skills", "demo");
    const vendorDependency = join(skill, "vendor", "node_modules", "demo-runtime");
    mkdirSync(join(skill, "dist"), { recursive: true });
    mkdirSync(vendorDependency, { recursive: true });
    mkdirSync(join(skill, "node_modules", "typescript"), { recursive: true });
    writeFileSync(join(skill, "package.json"), JSON.stringify({ offlineBundle: true, dependencies: { "demo-runtime": "1.0.0" } }));
    writeFileSync(join(skill, "dist", "tool.js"), "console.log('ok');\n");
    writeFileSync(join(skill, "vendor", "manifest.json"), JSON.stringify({ packages: [{ name: "demo-runtime", version: "1.0.0" }] }));
    writeFileSync(join(vendorDependency, "package.json"), JSON.stringify({ name: "demo-runtime", version: "1.0.0" }));
    writeFileSync(join(skill, "node_modules", "typescript", "package.json"), JSON.stringify({ name: "typescript" }));
    writeFileSync(join(skill, "THIRD_PARTY_NOTICES.md"), "# Notices\n");
    const output = join(tmp, "plugin.zip");
    execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output]);
    const names = new AdmZip(output).getEntries().map((entry) => entry.entryName);
    assert.ok(names.some((name) => name.includes("/vendor/node_modules/demo-runtime/package.json")));
    assert.ok(!names.some((name) => name.includes("/skills/demo/node_modules/typescript")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("package rejects an incomplete declared offline bundle", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    const skill = join(plugin, "skills", "demo");
    writeFileSync(join(skill, "package.json"), JSON.stringify({ offlineBundle: true, dependencies: { "demo-runtime": "1.0.0" } }));
    const output = join(tmp, "plugin.zip");
    assert.throws(() => execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output]), /status 1|Command failed/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});


test("MCP operational validation is transport-aware", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    writeFileSync(join(plugin, ".mcp.json"), JSON.stringify({ mcpServers: { remote: { type: "streamable-http", url: "https://example.test/mcp", headers: { Authorization: "token" } } } }));
    assert.deepEqual(validate(plugin).errors, []);
    writeFileSync(join(plugin, ".mcp.json"), JSON.stringify({ mcpServers: { remote: { type: "sse", command: "node" } } }));
    assert.ok(validate(plugin).errors.some((error) => error.includes("url must be non-empty")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("package rejects symbolic links", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    const target = join(tmp, "outside.txt");
    writeFileSync(target, "outside");
    symlinkSync(target, join(plugin, "escape.txt"));
    const output = join(tmp, "plugin.zip");
    assert.throws(() => execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output]), /status 1|Command failed/);
    assert.equal(existsSync(output), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
