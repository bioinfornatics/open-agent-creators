#!/usr/bin/env node
/**
 * Aggregate individual run results into benchmark summary statistics.
 *
 * Reads grading.json files from run directories and produces:
 * - run_summary with mean, stddev, min, max for each metric
 * - delta between with_skill and without_skill configurations
 *
 * Usage:
 *   node aggregate_benchmark.js <benchmark_dir>
 *
 * The script supports two directory layouts:
 *
 *   Workspace layout (from skill-creator iterations):
 *   <benchmark_dir>/
 *   └── eval-N/
 *       ├── with_skill/
 *       │   ├── run-1/grading.json
 *       │   └── run-2/grading.json
 *       └── without_skill/
 *           ├── run-1/grading.json
 *           └── run-2/grading.json
 *
 *   Legacy layout (with runs/ subdirectory):
 *   <benchmark_dir>/
 *   └── runs/
 *       └── eval-N/
 *           ├── with_skill/
 *           │   └── run-1/grading.json
 *           └── without_skill/
 *               └── run-1/grading.json
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";

interface Stats {
  mean: number | null;
  stddev: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

interface RunResult {
  eval_id: string | number;
  run_number: number;
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds: number | null;
  tokens?: number | null;
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
  if (!values.length) return { mean: null, stddev: null, min: null, max: null, count: 0 };
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
    count: values.length,
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

    const configPriority = (name: string) =>
      name.includes("with_skill") ? 0 : name.includes("old_skill") || name.includes("without_skill") ? 1 : 2;
    const configDirs = readdirSync(evalDir)
      .filter((name) => isDir(join(evalDir, name)))
      .sort((a, b) => configPriority(a) - configPriority(b) || a.localeCompare(b));
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
          time_seconds: null,
          expectations: grading.expectations ?? [],
          notes: [],
        };

        const timing = grading.timing ?? {};
        result.time_seconds = typeof timing.total_duration_seconds === "number" ? timing.total_duration_seconds : null;
        const timingFile = join(runDir, "timing.json");
        if (existsSync(timingFile)) {
          try {
            const timingData = JSON.parse(readFileSync(timingFile, "utf-8"));
            if (result.time_seconds === null && typeof timingData.total_duration_seconds === "number") {
              result.time_seconds = timingData.total_duration_seconds;
            }
            result.tokens = typeof timingData.total_tokens === "number" ? timingData.total_tokens : null;
          } catch {
            // ignore malformed timing.json
          }
        }

        const metrics = grading.execution_metrics ?? {};
        result.tool_calls = metrics.total_tool_calls ?? 0;
        if (result.tokens === undefined && typeof metrics.output_chars === "number") {
          result.tokens = metrics.output_chars;
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
        pass_rate: calculateStats([]),
        time_seconds: calculateStats([]),
        tokens: calculateStats([]),
      };
      continue;
    }
    const passRates = runs.map((r) => r.pass_rate);
    const times = runs.map((r) => r.time_seconds).filter((value): value is number => typeof value === "number");
    const tokens = runs.map((r) => r.tokens).filter((value): value is number => typeof value === "number");
    runSummary[config] = {
      pass_rate: calculateStats(passRates),
      time_seconds: calculateStats(times),
      tokens: calculateStats(tokens),
    };
  }

  const primary = configs.length >= 1 ? runSummary[configs[0]] ?? {} : {};
  const baseline = configs.length >= 2 ? runSummary[configs[1]] ?? {} : {};

  const deltaPassRate = (primary.pass_rate?.mean ?? 0) - (baseline.pass_rate?.mean ?? 0);
  const deltaTime = primary.time_seconds?.mean !== null && baseline.time_seconds?.mean !== null ? primary.time_seconds.mean - baseline.time_seconds.mean : null;
  const deltaTokens = primary.tokens?.mean !== null && baseline.tokens?.mean !== null ? primary.tokens.mean - baseline.tokens.mean : null;

  runSummary.delta = {
    pass_rate: `${deltaPassRate >= 0 ? "+" : ""}${deltaPassRate.toFixed(2)}`,
    time_seconds: deltaTime === null ? null : `${deltaTime >= 0 ? "+" : ""}${deltaTime.toFixed(1)}`,
    tokens: deltaTokens === null ? null : `${deltaTokens >= 0 ? "+" : ""}${deltaTokens.toFixed(0)}`,
  };

  return runSummary;
}

function generateBenchmark(benchmarkDir: string, skillName: string, skillPath: string) {
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
          tokens: result.tokens ?? null,
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
      skill_name: skillName || "<skill-name>",
      skill_path: skillPath || "<path/to/skill>",
      executor_model: "<model-name>",
      analyzer_model: "<model-name>",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      evals_run: evalIds,
      runs_per_configuration: Object.fromEntries(Object.entries(results).map(([name, runs]) => [name, runs.length])),
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
    `# Skill Benchmark: ${metadata.skill_name}`,
    "",
    `**Model**: ${metadata.executor_model}`,
    `**Date**: ${metadata.timestamp}`,
    `**Evals**: ${metadata.evals_run.join(", ")} (runs per configuration: ${JSON.stringify(metadata.runs_per_configuration)})`,
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
  const formatMetric = (value: number | null | undefined, digits = 0) =>
    value === null || value === undefined ? "n/a" : value.toFixed(digits);
  lines.push(
    `| Time | ${formatMetric(aTime.mean, 1)}s ± ${formatMetric(aTime.stddev, 1)}s | ${formatMetric(bTime.mean, 1)}s ± ${formatMetric(bTime.stddev, 1)}s | ${delta.time_seconds ?? "—"} |`
  );

  const aTokens = aSummary.tokens ?? {};
  const bTokens = bSummary.tokens ?? {};
  lines.push(
    `| Tokens | ${formatMetric(aTokens.mean)} ± ${formatMetric(aTokens.stddev)} | ${formatMetric(bTokens.mean)} ± ${formatMetric(bTokens.stddev)} | ${delta.tokens ?? "—"} |`
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
      "skill-name": { type: "string", default: "" },
      "skill-path": { type: "string", default: "" },
      output: { type: "string", short: "o" },
    },
  });

  const [benchmarkDirArg] = positionals;
  if (!benchmarkDirArg) {
    console.error("usage: aggregate_benchmark.js <benchmark_dir> [--skill-name <name>] [--skill-path <path>] [-o <output.json>]");
    process.exit(2);
  }
  if (!existsSync(benchmarkDirArg)) {
    console.log(`Directory not found: ${benchmarkDirArg}`);
    process.exit(1);
  }

  const benchmark = generateBenchmark(
    benchmarkDirArg,
    values["skill-name"] as string,
    values["skill-path"] as string
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
