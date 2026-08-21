import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseAgent, renderAgent, AgentFormatError } from "../dist/scripts/agent_format.js";
import { extractAssistantText, validateEvalSet } from "../dist/scripts/run_agent_eval.js";
import { deterministicGrade } from "../dist/scripts/grade_agent_eval.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist", "scripts");

function writeAgent(directory: string, name = "code-reviewer"): string {
  const path = join(directory, `${name}.md`);
  writeFileSync(
    path,
    renderAgent(
      name,
      "Reviews code for correctness and risk",
      "test-model",
      "You are a senior code reviewer. Prioritize correctness and security."
    ),
    "utf-8"
  );
  return path;
}

test("parses valid agent", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const agent = parseAgent(writeAgent(tmp));
    assert.equal(agent.name, "code-reviewer");
    assert.equal(agent.model, "test-model");
    assert.ok(agent.body);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects unsupported frontmatter", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const path = join(tmp, "reviewer.md");
    writeFileSync(path, "---\nname: reviewer\ntools: shell\n---\n\nReview code.\n", "utf-8");
    assert.throws(() => parseAgent(path), (error: unknown) => {
      return error instanceof AgentFormatError && /Unsupported frontmatter/.test(error.message);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects empty body", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const path = join(tmp, "reviewer.md");
    writeFileSync(path, "---\nname: reviewer\n---\n", "utf-8");
    assert.throws(() => parseAgent(path), (error: unknown) => {
      return error instanceof AgentFormatError && /body must not be empty/.test(error.message);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("project install uses canonical path", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const sourceDir = join(tmp, "source");
    mkdirSync(sourceDir);
    const source = writeAgent(sourceDir);
    const project = join(tmp, "project");
    mkdirSync(project);
    const stdout = execFileSync(
      "node",
      [join(DIST, "install_agent.js"), source, "--project", project],
      { encoding: "utf-8" }
    );
    const expected = join(project, ".agents", "agents", "code-reviewer.md");
    assert.equal(stdout.trim(), expected);
    assert.equal(parseAgent(expected).name, "code-reviewer");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("install refuses overwrite", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const source = writeAgent(tmp);
    const project = join(tmp, "project");
    const args = [join(DIST, "install_agent.js"), source, "--project", project];
    execFileSync("node", args, { encoding: "utf-8" });
    assert.throws(() => execFileSync("node", args, { encoding: "utf-8", stdio: "pipe" }));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("eval set validation and output extraction", () => {
  const cases = validateEvalSet({
    evals: [{ id: 1, prompt: "Review this", assertions: ["contains: risk"] }],
  });
  assert.equal(cases[0].id, 1);
  const text = extractAssistantText({
    messages: [{ role: "assistant", content: [{ type: "text", text: "Found a risk" }] }],
  });
  assert.equal(text, "Found a risk");
});

test("deterministic eval grading", () => {
  assert.deepEqual(deterministicGrade("contains: security", "Security issue"), {
    passed: true,
    evidence: "Expected response to contain: 'security'",
  });
  assert.equal(deterministicGrade("not-contains: safe", "unsafe change")?.passed, false);
  assert.ok(deterministicGrade("regex: risk\\s+found", "risk found")?.passed);
  assert.equal(deterministicGrade("Explains the root cause", "response"), null);
});

test("unified CLI exposes help and usage exits", () => {
  const cli = join(DIST, "cli.js");
  const help = execFileSync("node", [cli, "--help"], { encoding: "utf-8" });
  assert.match(help, /Commands:/);
  assert.match(help, /evaluate/);
  assert.throws(() => execFileSync("node", [cli, "unknown"], { encoding: "utf-8", stdio: "pipe" }), (error: any) => error.status === 2);
});

test("unified CLI supports JSON, quiet, and blocked exit status", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-cli-test-"));
  const cli = join(DIST, "cli.js");
  try {
    const initJson = JSON.parse(execFileSync("node", [cli, "init", "reviewer", "--path", tmp, "--format", "json"], { encoding: "utf-8" }));
    assert.equal(initJson.ok, true);
    assert.equal(initJson.command, "init");
    assert.equal(initJson.exitCode, 0);
    assert.equal(execFileSync("node", [cli, "validate", join(tmp, "reviewer.md"), "--quiet"], { encoding: "utf-8" }), "");
    assert.throws(() => execFileSync("node", [cli, "init", "reviewer", "--path", tmp], { encoding: "utf-8", stdio: "pipe" }), (error: any) => error.status === 3);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("unified CLI main guard supports symlinks and imports without side effects", async () => {
  const cliUrl = new URL("../dist/scripts/cli.js", import.meta.url);
  const module = await import(cliUrl.href);
  assert.equal(typeof module.runCli, "function");

  const tmp = mkdtempSync(join(tmpdir(), "agent-cli-link-"));
  try {
    const link = join(tmp, "agent-creator");
    symlinkSync(fileURLToPath(cliUrl), link);
    const help = execFileSync("node", [link, "--help"], { encoding: "utf-8" });
    assert.match(help, /Usage: agent-creator/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
