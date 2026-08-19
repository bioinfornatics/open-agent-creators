#!/usr/bin/env node
/**
 * Aggregate individual run results into benchmark summary statistics.
 *
 * Reads grading.json files from run directories and produces:
 * - run_summary with mean, stddev, min, max for each metric
 * - delta between with_agent and without_agent configurations
 *
 * Usage:
 *   node aggregate_benchmark.js <benchmark_dir>
 *
 * The script supports two directory layouts:
 *
 *   Workspace layout (from agent-creator iterations):
 *   <benchmark_dir>/
 *   └── eval-N/
 *       ├── with_agent/
 *       │   ├── run-1/grading.json
 *       │   └── run-2/grading.json
 *       └── without_agent/
 *           ├── run-1/grading.json
 *           └── run-2/grading.json
 *
 *   Legacy layout (with runs/ subdirectory):
 *   <benchmark_dir>/
 *   └── runs/
 *       └── eval-N/
 *           ├── with_agent/
 *           │   └── run-1/grading.json
 *           └── without_agent/
 *               └── run-1/grading.json
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";

interface Stats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

interface RunResult {
  eval_id: string | number;
  run_number: number;
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds: number;
  tokens?: number;
  tool_calls?: number;
  errors?: number;
  expectations: unknown[];
  notes: string[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function calculateStats(values: number[]): Stats {
  if (!values.length) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let stddev = 0;
  if (n > 1) {
    const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    stddev = Math.sqrt(variance);
  }
  return {
    mean: round(mean, 4),
    stddev: round(stddev, 4),
    min: round(Math.min(...values), 4),
    max: round(Math.max(...values), 4),
  };
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listSubdirs(dir: string, prefix: string): string[] {
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && isDir(join(dir, name)))
    .sort();
}

function loadRunResults(benchmarkDir: string): Record<string, RunResult[]> {
  const runsDir = join(benchmarkDir, "runs");
  let searchDir: string;
  if (isDir(runsDir)) {
    searchDir = runsDir;
  } else if (listSubdirs(benchmarkDir, "eval-").length) {
    searchDir = benchmarkDir;
  } else {
    console.log(`No eval directories found in ${benchmarkDir} or ${runsDir}`);
    return {};
  }

  const results: Record<string, RunResult[]> = {};
  const evalDirs = listSubdirs(searchDir, "eval-");

  evalDirs.forEach((evalName, evalIdx) => {
    const evalDir = join(searchDir, evalName);
    const metadataPath = join(evalDir, "eval_metadata.json");
    let evalId: string | number = evalIdx;
    if (existsSync(metadataPath)) {
      try {
        const parsed = JSON.parse(readFileSync(metadataPath, "utf-8"));
        evalId = parsed.eval_id ?? evalIdx;
      } catch {
        evalId = evalIdx;
      }
    } else {
      const parts = evalName.split("-");
      const parsedNum = Number(parts[1]);
      evalId = Number.isFinite(parsedNum) ? parsedNum : evalIdx;
    }

    const configDirs = readdirSync(evalDir)
      .filter((name) => isDir(join(evalDir, name)))
      .sort();
    for (const config of configDirs) {
      const configDir = join(evalDir, config);
      let runDirs = listSubdirs(configDir, "run-");
      if (!runDirs.length && existsSync(join(configDir, "grading.json"))) {
        runDirs = ["."];
      }
      if (!runDirs.length) continue;
      results[config] = results[config] ?? [];

      runDirs.forEach((runName, runIndex) => {
        const runDir = runName === "." ? configDir : join(configDir, runName);
        const runNumber = runName.startsWith("run-")
          ? Number(runName.split("-")[1])
          : runIndex + 1;
        const gradingFile = join(runDir, "grading.json");
        if (!existsSync(gradingFile)) {
          console.log(`Warning: grading.json not found in ${runDir}`);
          return;
        }
        let grading: any;
        try {
          grading = JSON.parse(readFileSync(gradingFile, "utf-8"));
        } catch (error) {
          console.log(`Warning: Invalid JSON in ${gradingFile}: ${(error as Error).message}`);
          return;
        }

        const summary = grading.summary ?? {};
        const result: RunResult = {
          eval_id: evalId,
          run_number: runNumber,
          pass_rate: summary.pass_rate ?? 0.0,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          total: summary.total ?? 0,
          time_seconds: 0,
          expectations: grading.expectations ?? [],
          notes: [],
        };

        const timing = grading.timing ?? {};
        result.time_seconds = timing.total_duration_seconds ?? 0.0;
        const timingFile = join(runDir, "timing.json");
        if (existsSync(timingFile)) {
          try {
            const timingData = JSON.parse(readFileSync(timingFile, "utf-8"));
            if (result.time_seconds === 0.0) {
              result.time_seconds = timingData.total_duration_seconds ?? 0.0;
            }
            result.tokens = timingData.total_tokens ?? 0;
          } catch {
            // ignore malformed timing.json
          }
        }

        const metrics = grading.execution_metrics ?? {};
        result.tool_calls = metrics.total_tool_calls ?? 0;
        if (!result.tokens) {
          result.tokens = metrics.output_chars ?? 0;
        }
        result.errors = metrics.errors_encountered ?? 0;

        const rawExpectations: any[] = grading.expectations ?? [];
        for (const exp of rawExpectations) {
          if (!("text" in exp) || !("passed" in exp)) {
            console.log(
              `Warning: expectation in ${gradingFile} missing required fields (text, passed, evidence): ${JSON.stringify(exp)}`
            );
          }
        }
        result.expectations = rawExpectations;

        const notesSummary = grading.user_notes_summary ?? {};
        const notes: string[] = [
          ...(notesSummary.uncertainties ?? []),
          ...(notesSummary.needs_review ?? []),
          ...(notesSummary.workarounds ?? []),
        ];
        result.notes = notes;

        results[config].push(result);
      });
    }
  });

  return results;
}

function aggregateResults(results: Record<string, RunResult[]>): Record<string, any> {
  const runSummary: Record<string, any> = {};
  const configs = Object.keys(results);

  for (const config of configs) {
    const runs = results[config] ?? [];
    if (!runs.length) {
      runSummary[config] = {
        pass_rate: { mean: 0, stddev: 0, min: 0, max: 0 },
        time_seconds: { mean: 0, stddev: 0, min: 0, max: 0 },
        tokens: { mean: 0, stddev: 0, min: 0, max: 0 },
      };
      continue;
    }
    const passRates = runs.map((r) => r.pass_rate);
    const times = runs.map((r) => r.time_seconds);
    const tokens = runs.map((r) => r.tokens ?? 0);
    runSummary[config] = {
      pass_rate: calculateStats(passRates),
      time_seconds: calculateStats(times),
      tokens: calculateStats(tokens),
    };
  }

  const primary = configs.length >= 1 ? runSummary[configs[0]] ?? {} : {};
  const baseline = configs.length >= 2 ? runSummary[configs[1]] ?? {} : {};

  const deltaPassRate = (primary.pass_rate?.mean ?? 0) - (baseline.pass_rate?.mean ?? 0);
  const deltaTime = (primary.time_seconds?.mean ?? 0) - (baseline.time_seconds?.mean ?? 0);
  const deltaTokens = (primary.tokens?.mean ?? 0) - (baseline.tokens?.mean ?? 0);

  runSummary.delta = {
    pass_rate: `${deltaPassRate >= 0 ? "+" : ""}${deltaPassRate.toFixed(2)}`,
    time_seconds: `${deltaTime >= 0 ? "+" : ""}${deltaTime.toFixed(1)}`,
    tokens: `${deltaTokens >= 0 ? "+" : ""}${deltaTokens.toFixed(0)}`,
  };

  return runSummary;
}

function generateBenchmark(benchmarkDir: string, agentName: string, agentPath: string) {
  const results = loadRunResults(benchmarkDir);
  const runSummary = aggregateResults(results);

  const runs: any[] = [];
  for (const config of Object.keys(results)) {
    for (const result of results[config]) {
      runs.push({
        eval_id: result.eval_id,
        configuration: config,
        run_number: result.run_number,
        result: {
          pass_rate: result.pass_rate,
          passed: result.passed,
          failed: result.failed,
          total: result.total,
          time_seconds: result.time_seconds,
          tokens: result.tokens ?? 0,
          tool_calls: result.tool_calls ?? 0,
          errors: result.errors ?? 0,
        },
        expectations: result.expectations,
        notes: result.notes,
      });
    }
  }

  const evalIds = Array.from(
    new Set(Object.values(results).flat().map((r) => r.eval_id))
  ).sort((a, b) => String(a).localeCompare(String(b)));

  return {
    metadata: {
      skill_name: agentName || "<agent-name>",
      skill_path: agentPath || "<path/to/agent>",
      executor_model: "<model-name>",
      analyzer_model: "<model-name>",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      evals_run: evalIds,
      runs_per_configuration: 3,
    },
    runs,
    run_summary: runSummary,
    notes: [] as string[],
  };
}

function generateMarkdown(benchmark: any): string {
  const metadata = benchmark.metadata;
  const runSummary = benchmark.run_summary;
  const configs = Object.keys(runSummary).filter((k) => k !== "delta");
  const configA = configs[0] ?? "config_a";
  const configB = configs[1] ?? "config_b";
  const titleCase = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const lines: string[] = [
    `# Agent Benchmark: ${metadata.skill_name}`,
    "",
    `**Model**: ${metadata.executor_model}`,
    `**Date**: ${metadata.timestamp}`,
    `**Evals**: ${metadata.evals_run.join(", ")} (${metadata.runs_per_configuration} runs each per configuration)`,
    "",
    "## Summary",
    "",
    `| Metric | ${titleCase(configA)} | ${titleCase(configB)} | Delta |`,
    "|--------|------------|---------------|-------|",
  ];

  const aSummary = runSummary[configA] ?? {};
  const bSummary = runSummary[configB] ?? {};
  const delta = runSummary.delta ?? {};

  const aPr = aSummary.pass_rate ?? {};
  const bPr = bSummary.pass_rate ?? {};
  lines.push(
    `| Pass Rate | ${((aPr.mean ?? 0) * 100).toFixed(0)}% ± ${((aPr.stddev ?? 0) * 100).toFixed(0)}% | ${((bPr.mean ?? 0) * 100).toFixed(0)}% ± ${((bPr.stddev ?? 0) * 100).toFixed(0)}% | ${delta.pass_rate ?? "—"} |`
  );

  const aTime = aSummary.time_seconds ?? {};
  const bTime = bSummary.time_seconds ?? {};
  lines.push(
    `| Time | ${(aTime.mean ?? 0).toFixed(1)}s ± ${(aTime.stddev ?? 0).toFixed(1)}s | ${(bTime.mean ?? 0).toFixed(1)}s ± ${(bTime.stddev ?? 0).toFixed(1)}s | ${delta.time_seconds ?? "—"}s |`
  );

  const aTokens = aSummary.tokens ?? {};
  const bTokens = bSummary.tokens ?? {};
  lines.push(
    `| Tokens | ${(aTokens.mean ?? 0).toFixed(0)} ± ${(aTokens.stddev ?? 0).toFixed(0)} | ${(bTokens.mean ?? 0).toFixed(0)} ± ${(bTokens.stddev ?? 0).toFixed(0)} | ${delta.tokens ?? "—"} |`
  );

  if (benchmark.notes?.length) {
    lines.push("", "## Notes", "");
    for (const note of benchmark.notes) lines.push(`- ${note}`);
  }

  return lines.join("\n");
}

function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "agent-name": { type: "string", default: "" },
      "agent-path": { type: "string", default: "" },
      output: { type: "string", short: "o" },
    },
  });

  const [benchmarkDirArg] = positionals;
  if (!benchmarkDirArg) {
    console.error("usage: aggregate_benchmark.js <benchmark_dir> [--agent-name <name>] [--agent-path <path>] [-o <output.json>]");
    process.exit(2);
  }
  if (!existsSync(benchmarkDirArg)) {
    console.log(`Directory not found: ${benchmarkDirArg}`);
    process.exit(1);
  }

  const benchmark = generateBenchmark(
    benchmarkDirArg,
    values["agent-name"] as string,
    values["agent-path"] as string
  );

  const outputJson = (values.output as string) || join(benchmarkDirArg, "benchmark.json");
  const outputMd = outputJson.replace(/\.json$/, ".md");

  writeFileSync(outputJson, JSON.stringify(benchmark, null, 2));
  console.log(`Generated: ${outputJson}`);

  const markdown = generateMarkdown(benchmark);
  writeFileSync(outputMd, markdown);
  console.log(`Generated: ${outputMd}`);

  const runSummary = benchmark.run_summary;
  const configs = Object.keys(runSummary).filter((k) => k !== "delta");
  const delta = runSummary.delta ?? {};

  console.log("\nSummary:");
  for (const config of configs) {
    const pr = runSummary[config].pass_rate.mean;
    const label = config.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    console.log(`  ${label}: ${(pr * 100).toFixed(1)}% pass rate`);
  }
  console.log(`  Delta:         ${delta.pass_rate ?? "—"}`);
}

main();
