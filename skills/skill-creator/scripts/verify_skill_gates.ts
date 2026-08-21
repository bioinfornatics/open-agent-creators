#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateSkill } from "./quick_validate.js";

export type GateStatus = "pass" | "fail" | "blocked" | "na";
export type VerificationProfile = "static" | "evaluation" | "release";
export type HumanReviewStatus = "pass" | "fail" | "blocked";

export interface Gate {
  status: GateStatus;
  required: boolean;
  checks: string[];
  evidence: string[];
  reason?: string;
}

export interface VerifySkillOptions {
  skillPath: string;
  profile?: VerificationProfile | string;
  evaluation?: string;
  testsStatus?: GateStatus | string;
  triggeringStatus?: GateStatus | string;
  triggeringReason?: string;
  humanReview?: HumanReviewStatus | string;
  minPassRate?: number;
  minDelta?: number;
}

const PROFILES = new Set<VerificationProfile>(["static", "evaluation", "release"]);
const GATE_STATUSES = new Set<GateStatus>(["pass", "fail", "blocked", "na"]);
const HUMAN_REVIEW_STATUSES = new Set<HumanReviewStatus>(["pass", "fail", "blocked"]);
const EXCLUDED = new Set([".git", ".verification", "dist", "node_modules", "vendor", "evaluations"]);

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walk(root: string, current: string, out: string[]): void {
  for (const name of readdirSync(current).sort()) {
    if (EXCLUDED.has(name)) continue;
    const path = join(current, name);
    if (isDir(path)) walk(root, path, out);
    else out.push(path);
  }
}

export function sourceHash(rootArg: string): string {
  const root = resolve(rootArg);
  const files: string[] = [];
  walk(root, root, files);
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function gate(
  status: GateStatus,
  required: boolean,
  checks: string[],
  evidence: string[],
  reason?: string,
): Gate {
  return { status, required, checks, evidence, ...(reason ? { reason } : {}) };
}

function aggregate(gates: Record<string, Gate>): GateStatus {
  const required = Object.values(gates).filter((item) => item.required);
  if (required.some((item) => item.status === "fail")) return "fail";
  if (required.some((item) => item.status !== "pass")) return "blocked";
  return "pass";
}

function loadJson(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function requireChoice<T extends string>(
  label: string,
  value: string | undefined,
  allowed: Set<T>,
  fallback?: T,
): T | undefined {
  if (value === undefined) return fallback;
  if (!allowed.has(value as T)) {
    throw new TypeError(`${label} must be one of: ${[...allowed].join(", ")}`);
  }
  return value as T;
}

function requireFiniteRange(label: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

function passRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function benchmarkSummary(data: any): {
  current: number | null;
  baseline: number | null;
  invalid: string[];
} {
  const summary = data?.run_summary;
  if (!summary || typeof summary !== "object") {
    return { current: null, baseline: null, invalid: [] };
  }
  const keys = Object.keys(summary);
  const currentKey = keys.find((key) => key.includes("with_skill"));
  const baselineKey = keys.find(
    (key) => key.includes("old_skill") || key.includes("without_skill"),
  );
  const invalid: string[] = [];
  const readRate = (key: string | undefined, role: string): number | null => {
    if (!key) return null;
    const raw = summary[key]?.pass_rate?.mean;
    const parsed = passRate(raw);
    if (parsed === null) invalid.push(`${role} pass rate must be finite and in [0,1]`);
    return parsed;
  };
  return {
    current: readRate(currentKey, "current"),
    baseline: readRate(baselineKey, "baseline"),
    invalid,
  };
}

function benchmarkSourceHash(benchmark: any): { value: string | null; malformed: boolean } {
  const metadata = benchmark?.metadata;
  if (!metadata || typeof metadata !== "object") return { value: null, malformed: false };
  const candidates = [metadata.source_sha256, metadata.skill_source_sha256, metadata.source_hash]
    .filter((value) => value !== undefined);
  if (!candidates.length) return { value: null, malformed: false };
  const value = candidates[0];
  return {
    value: typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null,
    malformed: typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value),
  };
}

export function verifySkill(options: VerifySkillOptions) {
  const profile = requireChoice("profile", options.profile, PROFILES, "release")!;
  const testsInput = requireChoice("tests status", options.testsStatus, GATE_STATUSES);
  const triggeringInput = requireChoice(
    "triggering status",
    options.triggeringStatus,
    GATE_STATUSES,
  );
  const humanReview = requireChoice(
    "human review",
    options.humanReview,
    HUMAN_REVIEW_STATUSES,
  );
  const minimum = requireFiniteRange("minimum pass rate", options.minPassRate ?? 0.8, 0, 1);
  const minDelta = requireFiniteRange("minimum delta", options.minDelta ?? 0, -1, 1);

  const root = resolve(options.skillPath);
  const name = basename(root);
  const strict = profile !== "static";
  const currentSourceHash = sourceHash(root);
  const [valid, message] = validateSkill(root);

  const pkg = loadJson(join(root, "package.json"));
  const offline = Boolean(pkg?.offlineBundle);
  const missing: string[] = [];
  if (offline) {
    for (const path of ["dist", "vendor/manifest.json", "THIRD_PARTY_NOTICES.md"]) {
      if (!existsSync(join(root, path))) missing.push(path);
    }
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      const manifest = join(root, "vendor", "node_modules", dependency, "package.json");
      if (!existsSync(manifest)) missing.push(`vendor/node_modules/${dependency}`);
    }
  }

  const tests = testsInput ?? (strict ? "blocked" : "na");
  const triggeringRequired = profile === "release";
  const triggering = triggeringInput ?? (triggeringRequired ? "blocked" : "na");
  const workspace = options.evaluation ? resolve(options.evaluation) : "";
  const benchmark = workspace ? loadJson(join(workspace, "benchmark.json")) : null;
  const summary = benchmarkSummary(benchmark);
  const provenance = benchmarkSourceHash(benchmark);
  const delta = summary.current !== null && summary.baseline !== null
    ? summary.current - summary.baseline
    : null;

  let behavior: GateStatus = "na";
  let behaviorReason = "not required";
  if (strict) {
    if (!benchmark) {
      behavior = "blocked";
      behaviorReason = "paired benchmark missing";
    } else if (summary.invalid.length) {
      behavior = "fail";
      behaviorReason = summary.invalid.join("; ");
    } else if (summary.current === null || summary.baseline === null) {
      behavior = "blocked";
      behaviorReason = "paired benchmark missing";
    } else if (provenance.malformed) {
      behavior = "fail";
      behaviorReason = "benchmark source provenance is malformed";
    } else if (!provenance.value) {
      behavior = "blocked";
      behaviorReason = "benchmark source provenance missing";
    } else if (provenance.value !== currentSourceHash) {
      behavior = "fail";
      behaviorReason = "benchmark source hash does not match current skill sources";
    } else {
      behavior = summary.current >= minimum && delta! >= minDelta ? "pass" : "fail";
      behaviorReason =
        `pass rate ${summary.current.toFixed(4)} (minimum ${minimum}); ` +
        `delta ${delta!.toFixed(4)} (minimum ${minDelta})`;
    }
  }

  let review: GateStatus = "na";
  let reviewReason = "not required";
  if (strict) {
    if (!workspace || !existsSync(join(workspace, "review.html"))) {
      review = "blocked";
      reviewReason = "review.html missing";
    } else if (!humanReview) {
      review = "blocked";
      reviewReason = "human review pending";
    } else {
      review = humanReview;
      reviewReason = humanReview === "pass" ? "human review complete" : `human review ${humanReview}`;
    }
  }

  const gates: Record<string, Gate> = {
    structure: gate(
      valid ? "pass" : "fail",
      true,
      ["valid frontmatter", "name matches directory"],
      [message],
    ),
    portability: gate(
      missing.length ? "fail" : "pass",
      true,
      ["self-contained", "offline bundle complete"],
      [missing.length ? `missing: ${missing.join(", ")}` : "complete"],
    ),
    tests: gate(
      tests,
      strict,
      ["build and deterministic tests pass"],
      [`reported: ${tests}`],
      tests !== "pass" && strict ? "passing test evidence missing" : undefined,
    ),
    triggering: gate(
      triggering,
      triggeringRequired,
      ["positive and difficult-negative routing thresholds pass", "sibling overlap checked"],
      [options.triggeringReason ?? `reported: ${triggering}`],
      triggering !== "pass" && triggeringRequired ? "passing trigger evidence missing" : undefined,
    ),
    behavior: gate(
      behavior,
      strict,
      ["paired runs exist", "pass rates are valid", "source hash matches", "thresholds pass"],
      [behaviorReason],
      behavior !== "pass" && strict ? behaviorReason : undefined,
    ),
    review: gate(
      review,
      strict,
      ["viewer exists", "human review complete"],
      [reviewReason],
      review !== "pass" && strict ? reviewReason : undefined,
    ),
  };
  const status = aggregate(gates);

  return {
    schema_version: "1.0",
    artifact: "skill",
    name,
    source_sha256: currentSourceHash,
    profile,
    status,
    generated_at: new Date().toISOString(),
    gates,
    critical_failures: Object.entries(gates)
      .filter(([, item]) => item.required && item.status === "fail")
      .map(([gateName]) => gateName),
    artifacts: {
      skill: root,
      ...(workspace
        ? {
            evaluation_workspace: workspace,
            benchmark: join(workspace, "benchmark.json"),
            review: join(workspace, "review.html"),
          }
        : {}),
    },
  };
}

function main(): void {
  try {
    const { positionals, values } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        profile: { type: "string", default: "release" },
        evaluation: { type: "string" },
        "tests-status": { type: "string" },
        "triggering-status": { type: "string" },
        "triggering-reason": { type: "string" },
        "human-review": { type: "string" },
        "min-pass-rate": { type: "string", default: "0.8" },
        "min-delta": { type: "string", default: "0" },
        output: { type: "string", short: "o" },
      },
    });
    if (!positionals[0]) throw new TypeError("skill directory is required");

    const receipt = verifySkill({
      skillPath: positionals[0],
      profile: values.profile,
      evaluation: values.evaluation,
      testsStatus: values["tests-status"],
      triggeringStatus: values["triggering-status"],
      triggeringReason: values["triggering-reason"],
      humanReview: values["human-review"],
      minPassRate: Number(values["min-pass-rate"]),
      minDelta: Number(values["min-delta"]),
    });
    const json = JSON.stringify(receipt, null, 2) + "\n";
    if (values.output) {
      mkdirSync(dirname(resolve(values.output)), { recursive: true });
      writeFileSync(resolve(values.output), json);
    }
    console.log(json.trim());
    process.exit(receipt.status === "pass" ? 0 : 1);
  } catch (error) {
    console.error(`verify_skill_gates: ${(error as Error).message}`);
    process.exit(2);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) main();
