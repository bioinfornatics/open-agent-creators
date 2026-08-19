#!/usr/bin/env node
// Grade paired custom-agent eval outputs with deterministic or LLM grading.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";

function execFileWithInput(
  bin: string,
  args: string[],
  input: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16, encoding: "utf-8" },
      (error, stdout, stderr) => {
        if (error) {
          (error as any).stderr = stderr;
          reject(error);
          return;
        }
        resolvePromise({ stdout, stderr });
      }
    );
    child.stdin?.write(input);
    child.stdin?.end();
  });
}

interface GradeResult {
  passed: boolean;
  evidence: string;
}

export function deterministicGrade(assertion: string, response: string): GradeResult | null {
  let match = /^contains:\s*(.+)$/is.exec(assertion.trim());
  if (match) {
    const needle = match[1];
    const passed = response.toLowerCase().includes(needle.toLowerCase());
    return { passed, evidence: `Expected response to contain: '${needle}'` };
  }
  match = /^not-contains:\s*(.+)$/is.exec(assertion.trim());
  if (match) {
    const needle = match[1];
    const passed = !response.toLowerCase().includes(needle.toLowerCase());
    return { passed, evidence: `Expected response not to contain: '${needle}'` };
  }
  match = /^regex:\s*(.+)$/is.exec(assertion.trim());
  if (match) {
    const pattern = match[1];
    let passed: boolean;
    try {
      passed = new RegExp(pattern, "m").test(response);
    } catch (error) {
      throw new Error(`Invalid assertion regex '${pattern}': ${(error as Error).message}`);
    }
    return { passed, evidence: `Regex '${pattern}' ${passed ? "matched" : "did not match"}` };
  }
  return null;
}

async function llmGrade(
  prompt: string,
  response: string,
  assertion: string,
  command: string[],
  model: string | undefined
): Promise<{ passed: boolean; evidence: string }> {
  const gradingPrompt = `Grade one custom-agent evaluation assertion.

Task:
${prompt}

Agent response:
${response}

Assertion:
${assertion}

Return JSON only with exactly these fields:
{"passed": true, "evidence": "specific evidence from the response"}
Use passed=false when the evidence is missing, contradicted, or unverifiable.
`;
  const args = ["run", "--no-session", "--quiet", "--output-format", "text", "--instructions", "-"];
  if (model) args.push("--model", model);

  const [bin, ...baseArgs] = command;
  let stdout: string;
  try {
    const result = await execFileWithInput(bin, [...baseArgs, ...args], gradingPrompt, 300_000);
    stdout = result.stdout;
  } catch (error: any) {
    throw new Error(`Grader failed: ${(error.stderr ?? error.message ?? "").trim()}`);
  }
  const text = stdout.trim();
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error(`Grader did not return JSON: ${text}`);
  const document = JSON.parse(match[0]);
  if (typeof document.passed !== "boolean" || typeof document.evidence !== "string") {
    throw new Error(`Invalid grader result: ${JSON.stringify(document)}`);
  }
  return document;
}

async function gradeRun(
  runDir: string,
  prompt: string,
  assertions: string[],
  command: string[],
  model: string | undefined,
  useLlm: boolean
) {
  const responsePath = join(runDir, "outputs", "response.md");
  const response = existsSync(responsePath) ? readFileSync(responsePath, "utf-8") : "";
  const results: Array<{ text: string } & GradeResult> = [];
  for (const assertion of assertions) {
    const deterministic = deterministicGrade(assertion, response);
    let result: GradeResult;
    if (deterministic !== null) {
      result = deterministic;
    } else if (useLlm) {
      result = await llmGrade(prompt, response, assertion, command, model);
    } else {
      result = {
        passed: false,
        evidence: "Assertion requires LLM grading; rerun with --llm-grader",
      };
    }
    results.push({ text: assertion, ...result });
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  let timing: unknown = {};
  const timingPath = join(runDir, "timing.json");
  if (existsSync(timingPath)) {
    timing = JSON.parse(readFileSync(timingPath, "utf-8"));
  }
  const grading = {
    expectations: results,
    summary: {
      passed,
      failed: total - passed,
      total,
      pass_rate: total ? passed / total : 0.0,
    },
    timing,
  };
  writeFileSync(join(runDir, "grading.json"), `${JSON.stringify(grading, null, 2)}\n`);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "llm-grader": { type: "boolean", default: false },
      "goose-cli": { type: "string", default: process.env.AGENT_CREATOR_GOOSE_CLI ?? "goose" },
      model: { type: "string" },
    },
  });

  const [workspaceArg] = positionals;
  if (!workspaceArg) {
    console.error("usage: grade_agent_eval.js <workspace> [--llm-grader] [--goose-cli <cmd>] [--model <name>]");
    process.exit(2);
  }

  const workspace = resolve(workspaceArg);
  const command = (values["goose-cli"] as string).split(/\s+/).filter(Boolean);
  let graded = 0;

  const evalDirs = readdirSync(workspace)
    .filter((name) => name.startsWith("eval-"))
    .sort();
  for (const evalName of evalDirs) {
    const evalDir = join(workspace, evalName);
    const metadataPath = join(evalDir, "eval_metadata.json");
    if (!existsSync(metadataPath)) continue;
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    const runDirs = readdirSync(evalDir)
      .filter((name) => isDirectory(join(evalDir, name)))
      .sort();
    for (const runName of runDirs) {
      const runDir = join(evalDir, runName);
      if (!isDirectory(join(runDir, "outputs"))) continue;
      await gradeRun(
        runDir,
        metadata.prompt ?? "",
        metadata.assertions ?? [],
        command,
        values.model as string | undefined,
        values["llm-grader"] as boolean
      );
      graded += 1;
    }
  }
  console.log(`Graded ${graded} runs in ${workspace}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
