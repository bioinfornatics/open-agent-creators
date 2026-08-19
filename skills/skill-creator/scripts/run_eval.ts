#!/usr/bin/env node
// Evaluate whether a compatible agent loads a skill for a set of queries.
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { createRunner, RunnerError } from "./runners/index.js";
import { parseSkillMd } from "./utils.js";

interface EvalItem {
  query: string;
  should_trigger: boolean;
}

interface EvalResult {
  query: string;
  should_trigger: boolean;
  trigger_rate: number;
  triggers: number;
  runs: number;
  pass: boolean;
}

interface EvalOutput {
  skill_name: string;
  description: string;
  results: EvalResult[];
  summary: { total: number; passed: number; failed: number };
}

function copySkill(skillPath: string, projectRoot: string): { target: string; name: string } {
  const { name } = parseSkillMd(skillPath);
  const target = join(projectRoot, ".agents", "skills", name);
  mkdirSync(join(projectRoot, ".agents", "skills"), { recursive: true });
  cpSync(skillPath, target, {
    recursive: true,
    filter: (src) => !src.includes("__pycache__") && !src.endsWith(".pyc"),
  });
  return { target, name };
}

async function runSingleQuery(
  query: string,
  skillPath: string,
  timeoutMs: number,
  model: string | undefined,
  runner: string | undefined
): Promise<boolean> {
  const source = resolve(skillPath);
  const tmp = mkdtempSync(join(tmpdir(), "skill-trigger-eval-"));
  try {
    const { name: skillName } = copySkill(source, tmp);
    const runnerInstance = createRunner(runner);
    const child = runnerInstance.startStream(query, model ?? null, tmp);

    return await new Promise<boolean>((resolvePromise, reject) => {
      let buffer = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill();
          resolvePromise(false);
        }
      }, timeoutMs);

      const processLine = (line: string) => {
        if (settled) return;
        try {
          const event = JSON.parse(line);
          const decision = runnerInstance.eventLoadedSkill(event, skillName);
          if (decision !== null) {
            settled = true;
            clearTimeout(timer);
            child.kill();
            resolvePromise(decision);
          }
        } catch {
          // not JSON, ignore
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          processLine(line);
        }
      });

      child.on("close", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (buffer.trim()) processLine(buffer);
          if (!settled) resolvePromise(false);
        }
      });

      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function runEval(
  evalSet: EvalItem[],
  skillPath: string,
  numWorkers: number,
  timeoutMs: number,
  options: {
    runsPerQuery?: number;
    triggerThreshold?: number;
    model?: string;
    runner?: string;
    description?: string;
  } = {}
): Promise<EvalOutput> {
  const {
    runsPerQuery = 1,
    triggerThreshold = 0.5,
    model,
    runner,
    description: descriptionOverride,
  } = options;

  const { name, description: originalDescription } = parseSkillMd(skillPath);
  const description = descriptionOverride || originalDescription;

  const tmp = mkdtempSync(join(tmpdir(), "skill-description-"));
  let queryTriggers: Map<string, boolean[]>;
  let queryItems: Map<string, EvalItem>;
  try {
    const stagedSkill = join(tmp, basename(skillPath));
    cpSync(skillPath, stagedSkill, {
      recursive: true,
      filter: (src) => !src.includes("__pycache__") && !src.endsWith(".pyc"),
    });
    const skillMdPath = join(stagedSkill, "SKILL.md");
    let content = readFileSync(skillMdPath, "utf-8");

    if (originalDescription !== description) {
      const lines = content.split("\n");
      let frontmatterEnd = -1;
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].trim() === "---") {
          frontmatterEnd = i;
          break;
        }
      }
      if (frontmatterEnd === -1) {
        throw new Error("Could not locate the SKILL.md frontmatter");
      }
      let descriptionIndex = -1;
      for (let i = 1; i < frontmatterEnd; i += 1) {
        if (lines[i].startsWith("description:")) {
          descriptionIndex = i;
          break;
        }
      }
      if (descriptionIndex === -1) {
        throw new Error("Could not locate the SKILL.md description for evaluation");
      }
      let descriptionEnd = descriptionIndex + 1;
      const valueAfterColon = lines[descriptionIndex].split(":").slice(1).join(":").trim();
      if ([">", "|", ">-", "|-"].includes(valueAfterColon)) {
        while (
          descriptionEnd < frontmatterEnd &&
          (lines[descriptionEnd].startsWith("  ") || lines[descriptionEnd].startsWith("\t"))
        ) {
          descriptionEnd += 1;
        }
      }
      const escapedDescription = description.replace(/'/g, "''");
      lines.splice(descriptionIndex, descriptionEnd - descriptionIndex, `description: '${escapedDescription}'`);
      content = lines.join("\n");
      writeFileSync(skillMdPath, content, "utf-8");
    }

    queryTriggers = new Map();
    queryItems = new Map();

    const jobs: Array<{ item: EvalItem }> = [];
    for (const item of evalSet) {
      for (let i = 0; i < runsPerQuery; i += 1) {
        jobs.push({ item });
      }
    }

    await mapLimit(jobs, numWorkers, async ({ item }) => {
      queryItems.set(item.query, item);
      if (!queryTriggers.has(item.query)) queryTriggers.set(item.query, []);
      try {
        const result = await runSingleQuery(item.query, stagedSkill, timeoutMs, model, runner);
        queryTriggers.get(item.query)!.push(result);
      } catch (error) {
        console.error(`Warning: query failed: ${(error as Error).message}`);
        queryTriggers.get(item.query)!.push(false);
      }
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const results: EvalResult[] = [];
  for (const [query, triggers] of queryTriggers.entries()) {
    const item = queryItems.get(query)!;
    const triggerRate = triggers.filter(Boolean).length / triggers.length;
    const shouldTrigger = item.should_trigger;
    const didPass = shouldTrigger ? triggerRate >= triggerThreshold : triggerRate < triggerThreshold;
    results.push({
      query,
      should_trigger: shouldTrigger,
      trigger_rate: triggerRate,
      triggers: triggers.filter(Boolean).length,
      runs: triggers.length,
      pass: didPass,
    });
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    skill_name: name,
    description,
    results,
    summary: { total: results.length, passed, failed: results.length - passed },
  };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "eval-set": { type: "string" },
      "skill-path": { type: "string" },
      description: { type: "string" },
      "num-workers": { type: "string", default: "4" },
      timeout: { type: "string", default: "60" },
      "runs-per-query": { type: "string", default: "3" },
      "trigger-threshold": { type: "string", default: "0.5" },
      model: { type: "string" },
      runner: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
  });

  if (!values["eval-set"] || !values["skill-path"]) {
    console.error("usage: run_eval.js --eval-set <file> --skill-path <dir> [options]");
    process.exit(2);
  }

  const evalSet: EvalItem[] = JSON.parse(readFileSync(resolve(values["eval-set"] as string), "utf-8"));
  const skillPath = resolve(values["skill-path"] as string);
  if (!existsSync(join(skillPath, "SKILL.md"))) {
    console.error(`error: No SKILL.md found at ${skillPath}`);
    process.exit(2);
  }

  let output: EvalOutput;
  try {
    output = await runEval(
      evalSet,
      skillPath,
      Number(values["num-workers"]),
      Number(values.timeout) * 1000,
      {
        description: values.description as string | undefined,
        runsPerQuery: Number(values["runs-per-query"]),
        triggerThreshold: Number(values["trigger-threshold"]),
        model: values.model as string | undefined,
        runner: values.runner as string | undefined,
      }
    );
  } catch (error) {
    if (error instanceof RunnerError || error instanceof Error) {
      console.error(`error: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }

  if (values.verbose) {
    console.error(`Results: ${output.summary.passed}/${output.summary.total} passed`);
    for (const result of output.results) {
      const status = result.pass ? "PASS" : "FAIL";
      console.error(
        `  [${status}] rate=${result.triggers}/${result.runs} expected=${result.should_trigger}: ${result.query.slice(0, 70)}`
      );
    }
  }
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
