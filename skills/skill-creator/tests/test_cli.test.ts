import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = resolve("dist/scripts/cli.js");
function invoke(args: string[]) { return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" }); }
function skill(valid = true) {
  const root = mkdtempSync(join(tmpdir(), "skill-cli-"));
  const dir = join(root, "demo"); mkdirSync(dir);
  writeFileSync(join(dir, "SKILL.md"), valid ? "---\nname: demo\ndescription: A useful demo skill.\n---\n# Demo\n" : "# invalid\n");
  return dir;
}

test("top-level and command help are successful", () => {
  const top = invoke(["--help"]); assert.equal(top.status, 0); assert.match(top.stdout, /trigger-eval/);
  const command = invoke(["validate", "--help"]); assert.equal(command.status, 0); assert.match(command.stdout, /validate <skill-directory>/);
});

test("unknown command and missing arguments are usage errors", () => {
  assert.equal(invoke(["unknown"]).status, 2);
  assert.equal(invoke(["validate"]).status, 2);
  assert.equal(invoke(["--format", "yaml"]).status, 2);
});

test("validate supports JSON output and failure exit codes", () => {
  const ok = invoke(["validate", skill(), "--format", "json"]); assert.equal(ok.status, 0);
  const body = JSON.parse(ok.stdout); assert.equal(body.command, "validate"); assert.equal(body.status, "success");
  const bad = invoke(["validate", skill(false), "--format=json"]); assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stdout).status, "failure");
});

test("quiet suppresses successful text output", () => {
  const result = invoke(["validate", skill(), "--quiet"]); assert.equal(result.status, 0); assert.equal(result.stdout, "");
});

test("every unified subcommand exposes help", () => {
  for (const command of ["validate", "trigger-eval", "aggregate", "review", "verify", "package"]) assert.equal(invoke([command, "--help"]).status, 0, command);
});

test("verify maps an incomplete release pipeline to blocked", () => {
  const result = invoke(["verify", skill(), "--format", "json"]);
  assert.equal(result.status, 3);
  const body = JSON.parse(result.stdout);
  assert.equal(body.status, "blocked");
  assert.equal(body.exit_code, 3);
});
