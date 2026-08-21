#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type AdmZipType from "adm-zip";
import { collectPackageFiles, sourceHash } from "./package_manifest.js";
import { loadRuntimeDependency } from "./runtime-deps.js";
import { validateAgentPluginSchema } from "./validate_agent_plugin_schema.js";
import { validate } from "./validate_goose_plugin.js";
const AdmZip = loadRuntimeDependency<typeof AdmZipType>("adm-zip");
export type Status = "pass" | "fail" | "blocked" | "na";
type Profile = "static" | "evaluation" | "release";
interface Gate {
    status: Status;
    required: boolean;
    checks: string[];
    evidence: string[];
    reason?: string;
}
export interface VerifyOptions {
    pluginPath: string;
    profile?: string;
    componentReceipts?: string[];
    integration?: string;
    archive?: string;
    testsStatus?: string;
    humanReview?: string;
    minPassRate?: number;
    minDelta?: number;
}
const PROFILES = new Set<Profile>(["static", "evaluation", "release"]);
const TEST_STATUSES = new Set<Status>(["pass", "fail", "blocked", "na"]);
const REVIEW_STATUSES = new Set(["pass", "pending", "na"]);
const COMPONENT_EXCLUDED = new Set([".git", ".verification", "dist", "node_modules", "vendor", "evaluations"]);
function isDirectory(path: string): boolean { try {
    return statSync(path).isDirectory();
}
catch {
    return false;
} }
function loadJson(path: string): any { try {
    return JSON.parse(readFileSync(path, "utf8"));
}
catch {
    return null;
} }
function makeGate(status: Status, required: boolean, checks: string[], evidence: string[], reason?: string): Gate { return { status, required, checks, evidence, ...(reason ? { reason } : {}) }; }
function assertOptions(options: VerifyOptions): {
    profile: Profile;
    testsStatus: Status;
    humanReview: "pass" | "pending" | "na";
    minPassRate: number;
    minDelta: number;
} {
    const profile = options.profile ?? "release";
    const testsStatus = options.testsStatus ?? (profile === "static" ? "na" : "blocked");
    const humanReview = options.humanReview ?? (profile === "static" ? "na" : "pending");
    const minPassRate = options.minPassRate ?? 0.8, minDelta = options.minDelta ?? 0;
    if (!PROFILES.has(profile as Profile))
        throw new Error("profile must be static, evaluation, or release");
    if (!TEST_STATUSES.has(testsStatus as Status))
        throw new Error("tests-status must be pass, fail, blocked, or na");
    if (!REVIEW_STATUSES.has(humanReview))
        throw new Error("human-review must be pass, pending, or na");
    if (!Number.isFinite(minPassRate) || !Number.isFinite(minDelta))
        throw new Error("benchmark thresholds must be finite numbers");
    if (minPassRate < 0 || minPassRate > 1)
        throw new Error("min-pass-rate must be between 0 and 1");
    return { profile: profile as Profile, testsStatus: testsStatus as Status, humanReview: humanReview as any, minPassRate, minDelta };
}
function walkComponent(root: string, current: string, out: string[]): void { for (const name of readdirSync(current).sort()) {
    if (COMPONENT_EXCLUDED.has(name))
        continue;
    const path = join(current, name);
    isDirectory(path) ? walkComponent(root, path, out) : out.push(path);
} }
export function componentHash(rootArg: string): string { const root = resolve(rootArg), files: string[] = []; walkComponent(root, root, files); const crypto = createHash("sha256"); for (const path of files) {
    crypto.update(relative(root, path).replaceAll("\\", "/"));
    crypto.update("\0");
    crypto.update(readFileSync(path));
    crypto.update("\0");
} return crypto.digest("hex"); }
function aggregate(gates: Record<string, Gate>): Status {
    const required = Object.values(gates).filter(gate => gate.required);
    if (required.some(gate => gate.status === "fail"))
        return "fail";
    if (required.some(gate => gate.status !== "pass"))
        return "blocked";
    return "pass";
}
function finiteRate(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null; }
function benchmarkGate(workspace: string, currentHash: string, minRate: number, minDelta: number): {
    status: Status;
    reason: string;
} {
    if (!workspace)
        return { status: "blocked", reason: "integration workspace missing" };
    const benchmark = loadJson(join(workspace, "benchmark.json"));
    if (!benchmark)
        return { status: "blocked", reason: "benchmark.json missing or invalid" };
    if (benchmark.metadata?.evaluated_source_sha256 !== currentHash)
        return { status: "blocked", reason: "benchmark source hash missing or stale" };
    const summary = benchmark.run_summary;
    if (!summary || typeof summary !== "object")
        return { status: "blocked", reason: "benchmark run_summary missing" };
    const currentKey = Object.keys(summary).find(key => key.includes("with_skill"));
    const baseKey = Object.keys(summary).find(key => key.includes("old_skill") || key.includes("without_skill"));
    const rate = finiteRate(currentKey ? summary[currentKey]?.pass_rate?.mean : undefined);
    const base = finiteRate(baseKey ? summary[baseKey]?.pass_rate?.mean : undefined);
    if (rate === null || base === null)
        return { status: "blocked", reason: "paired benchmark rates must be finite numbers between 0 and 1" };
    const delta = rate - base, pass = rate >= minRate && delta >= minDelta;
    return { status: pass ? "pass" : "fail", reason: `pass rate ${rate.toFixed(4)} (minimum ${minRate}); delta ${delta.toFixed(4)} (minimum ${minDelta})` };
}
function safeArchiveName(name: string): boolean { return Boolean(name) && !name.includes("\\") && !name.startsWith("/") && !/^[A-Za-z]:/.test(name) && !name.split("/").some(part => part === ".." || part === ""); }
function distributionGate(root: string, rootName: string, archiveArg: string | undefined): {
    status: Status;
    reason: string;
} {
    if (!archiveArg || !existsSync(resolve(archiveArg)))
        return { status: "blocked", reason: "archive missing" };
    const archive = resolve(archiveArg);
    try {
        const expected = new Map(collectPackageFiles(root, [archive]).map(file => [rootName + "/" + file.relative, file.sha256]));
        const actual = new Map<string, string>();
        const seen = new Set<string>();
        for (const entry of new AdmZip(archive).getEntries()) {
            const name = entry.entryName;
            if (!safeArchiveName(name))
                return { status: "fail", reason: "unsafe archive entry: " + name };
            if (seen.has(name))
                return { status: "fail", reason: "duplicate archive entry: " + name };
            seen.add(name);
            const unixType = (entry.attr >>> 16) & 0o170000;
            if (unixType === 0o120000)
                return { status: "fail", reason: "symbolic link archive entry: " + name };
            if (entry.isDirectory)
                continue;
            actual.set(name, createDigest(entry.getData()));
        }
        const mismatch = [...expected].find(([name, hash]) => actual.get(name) !== hash);
        const extra = [...actual.keys()].find(name => !expected.has(name));
        if (mismatch || extra || actual.size !== expected.size)
            return { status: "fail", reason: mismatch ? "archive content mismatch: " + mismatch[0] : extra ? "unexpected archive entry: " + extra : "archive file count mismatch" };
        return { status: "pass", reason: actual.size + " files match canonical package manifest" };
    }
    catch (error) {
        return { status: "fail", reason: "invalid archive: " + (error as Error).message };
    }
}
function createDigest(data: Buffer): string { return createHash("sha256").update(data).digest("hex"); }
export function verifyPlugin(options: VerifyOptions) {
    const parsed = assertOptions(options), root = resolve(options.pluginPath), strict = parsed.profile !== "static";
    const manifest = loadJson(join(root, "plugin.json")), name = manifest?.name ?? basename(root);
    const schema = validateAgentPluginSchema(root), operational = validate(root);
    const receipts = new Map<string, any>();
    for (const path of options.componentReceipts ?? []) {
        const receipt = loadJson(resolve(path));
        if (receipt?.name)
            receipts.set(receipt.name, receipt);
    }
    const skillsRoot = join(root, "skills"), skills = isDirectory(skillsRoot) ? readdirSync(skillsRoot).filter(name => isDirectory(join(skillsRoot, name))).sort() : [];
    const componentProblems: string[] = [];
    for (const skill of skills) {
        const receipt = receipts.get(skill);
        if (!receipt) {
            componentProblems.push(skill + ": receipt missing");
            continue;
        }
        if (receipt.artifact !== "skill" || receipt.schema_version !== "1.0")
            componentProblems.push(skill + ": invalid schema");
        if (receipt.status !== "pass")
            componentProblems.push(skill + ": receipt status " + String(receipt.status));
        if (receipt.source_sha256 !== componentHash(join(skillsRoot, skill)))
            componentProblems.push(skill + ": stale source hash");
    }
    const componentStatus: Status = componentProblems.some(p => p.includes("status fail")) ? "fail" : componentProblems.length ? "blocked" : "pass";
    const archive = options.archive ? resolve(options.archive) : undefined;
    const currentHash = sourceHash(root, archive ? [archive] : []);
    const benchmark = strict ? benchmarkGate(options.integration ? resolve(options.integration) : "", currentHash, parsed.minPassRate, parsed.minDelta) : { status: "na" as Status, reason: "not required" };
    const distribution = strict ? distributionGate(root, name, archive) : { status: "na" as Status, reason: "not required" };
    let review: Status = "na", reviewReason = "not required";
    const workspace = options.integration ? resolve(options.integration) : "";
    if (strict) {
        if (!workspace || !existsSync(join(workspace, "review.html"))) {
            review = "blocked";
            reviewReason = "integration review.html missing";
        }
        else if (parsed.humanReview === "pass") {
            review = "pass";
            reviewReason = "human review complete";
        }
        else {
            review = "blocked";
            reviewReason = "human review " + parsed.humanReview;
        }
    }
    const gates: Record<string, Gate> = {
        identity: makeGate(schema.valid && !operational.errors.length ? "pass" : "fail", true, ["Agent Plugins 1.0.0 schemas pass", "operational validation passes"], [...schema.errors.map(e => e.path + ": " + e.message), ...operational.errors, ...operational.warnings]),
        components: makeGate(componentStatus, true, ["every skill receipt passes", "receipt hashes are current"], componentProblems.length ? componentProblems : [skills.length + " receipts verified"], componentStatus === "blocked" ? "missing, non-passing, or stale receipt" : undefined),
        integration: makeGate(benchmark.status, strict, ["paired benchmark rates are valid", "source hash is current", "thresholds pass"], [benchmark.reason], benchmark.status === "blocked" ? benchmark.reason : undefined),
        distribution: makeGate(distribution.status, strict, ["entries are safe and unique", "archive matches canonical package manifest"], [distribution.reason], distribution.status === "blocked" ? distribution.reason : undefined),
        regression: makeGate(parsed.testsStatus, strict, ["component and plugin tests pass", "offline smoke passes"], ["reported: " + parsed.testsStatus], parsed.testsStatus === "blocked" ? "test evidence missing" : undefined),
        review: makeGate(review, strict, ["viewer exists", "human review complete"], [reviewReason], review === "blocked" ? reviewReason : undefined)
    };
    const status = aggregate(gates);
    return { schema_version: "1.0", artifact: "plugin", name, profile: parsed.profile, status, source_sha256: currentHash, generated_at: new Date().toISOString(), gates, critical_failures: Object.entries(gates).filter(([, gate]) => gate.required && gate.status === "fail").map(([gate]) => gate), release_eligible: parsed.profile === "release" && status === "pass", components: Object.fromEntries([...receipts].map(([component, receipt]) => [component, { status: receipt.status, source_sha256: receipt.source_sha256 }])), artifacts: { plugin: root, ...(workspace ? { integration_workspace: workspace, benchmark: join(workspace, "benchmark.json"), review: join(workspace, "review.html") } : {}), ...(archive ? { archive } : {}) } };
}
function main() { try {
    const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { profile: { type: "string", default: "release" }, "component-receipt": { type: "string", multiple: true }, integration: { type: "string" }, archive: { type: "string" }, "tests-status": { type: "string" }, "human-review": { type: "string" }, "min-pass-rate": { type: "string", default: "0.8" }, "min-delta": { type: "string", default: "0" }, output: { type: "string", short: "o" } } });
    if (!positionals[0])
        throw new Error("usage: verify_plugin_gates.js <plugin-dir> --component-receipt <receipt>... [options]");
    const receipt = verifyPlugin({ pluginPath: positionals[0], profile: values.profile, componentReceipts: values["component-receipt"], integration: values.integration, archive: values.archive, testsStatus: values["tests-status"], humanReview: values["human-review"], minPassRate: Number(values["min-pass-rate"]), minDelta: Number(values["min-delta"]) });
    const json = JSON.stringify(receipt, null, 2) + "\n";
    if (values.output) {
        mkdirSync(dirname(resolve(values.output)), { recursive: true });
        writeFileSync(resolve(values.output), json);
    }
    console.log(json.trim());
    process.exit(receipt.status === "pass" ? 0 : 1);
}
catch (error) {
    console.error((error as Error).message);
    process.exit(2);
} }
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main();
