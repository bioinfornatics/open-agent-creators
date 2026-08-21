#!/usr/bin/env node
// Run paired custom-agent evaluations with Goose.
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAgent, renderAgent } from "./agent_format.js";
const execFileAsync = promisify(execFile);
export function extractAssistantText(document) {
    const chunks = [];
    for (const message of document?.messages ?? []) {
        if (message?.role !== "assistant")
            continue;
        for (const item of message?.content ?? []) {
            if (item?.type === "text" && typeof item?.text === "string") {
                chunks.push(item.text);
            }
        }
    }
    return chunks.join("\n\n").trim();
}
function baselineAgent(agent, name) {
    const description = `Baseline role for comparison with ${agent.name}`;
    const body = "Complete the delegated task using your general capabilities. " +
        "Follow the user's request, but do not assume specialized role instructions " +
        "that are not present in the task itself.";
    return renderAgent(name, description, agent.model, body);
}
async function runCase(evalCase, configuration, agentPath, workspace, gooseCommand, model, timeoutMs, maxTurns) {
    const evalId = evalCase.id;
    const runDir = join(workspace, `eval-${evalId}`, configuration);
    const outputs = join(runDir, "outputs");
    mkdirSync(outputs, { recursive: true });
    const temporary = mkdtempSync(join(tmpdir(), "agent-eval-"));
    let document;
    let duration;
    try {
        const agent = parseAgent(agentPath);
        const installed = join(temporary, ".agents", "agents", `${agent.name}.md`);
        mkdirSync(dirname(installed), { recursive: true });
        copyFileSync(agentPath, installed);
        const prompt = `Delegate this task to the custom agent named ${agent.name}. ` +
            "Return only the delegated agent's final task result, without discussing the delegation.\n\n" +
            `Task:\n${evalCase.prompt}`;
        const args = [
            "run",
            "--no-session",
            "--quiet",
            "--output-format",
            "json",
            "--max-turns",
            String(maxTurns),
            "--text",
            prompt,
        ];
        if (model)
            args.push("--model", model);
        const [command, ...baseArgs] = gooseCommand;
        const started = performance.now();
        let stdout;
        try {
            const result = await execFileAsync(command, [...baseArgs, ...args], {
                cwd: temporary,
                timeout: timeoutMs,
                maxBuffer: 1024 * 1024 * 64,
            });
            stdout = result.stdout;
        }
        catch (error) {
            throw new Error(`Goose failed for eval ${evalId}/${configuration}: ${(error.stderr ?? error.message ?? "").trim()}`);
        }
        duration = (performance.now() - started) / 1000;
        try {
            document = JSON.parse(stdout);
        }
        catch (error) {
            throw new Error(`Goose returned invalid JSON: ${error.message}`);
        }
    }
    finally {
        rmSync(temporary, { recursive: true, force: true });
    }
    const outputText = extractAssistantText(document);
    writeFileSync(join(outputs, "response.md"), `${outputText}\n`, "utf-8");
    writeFileSync(join(runDir, "transcript.json"), `${JSON.stringify(document, null, 2)}\n`, "utf-8");
    const metadata = document.metadata ?? {};
    const timing = {
        total_tokens: metadata.total_tokens ?? 0,
        total_duration_seconds: Math.round(duration * 1000) / 1000,
    };
    writeFileSync(join(runDir, "timing.json"), `${JSON.stringify(timing, null, 2)}\n`, "utf-8");
    return { eval_id: evalId, configuration, ...timing };
}
export function validateEvalSet(document) {
    if (typeof document !== "object" || document === null || !Array.isArray(document.evals)) {
        throw new Error("Eval set must be an object containing an 'evals' list");
    }
    const cases = document.evals;
    const seen = new Set();
    for (const evalCase of cases) {
        if (typeof evalCase !== "object" || evalCase === null) {
            throw new Error("Each eval must be an object");
        }
        if ((typeof evalCase.id !== "string" && typeof evalCase.id !== "number") ||
            seen.has(evalCase.id)) {
            throw new Error("Each eval must have a unique string or integer id");
        }
        seen.add(evalCase.id);
        if (typeof evalCase.prompt !== "string" || !evalCase.prompt.trim()) {
            throw new Error(`Eval ${evalCase.id} must have a non-empty prompt`);
        }
        const assertions = evalCase.assertions ?? [];
        if (!Array.isArray(assertions) || !assertions.every((item) => typeof item === "string")) {
            throw new Error(`Eval ${evalCase.id} assertions must be a list of strings`);
        }
    }
    return cases;
}
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
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
async function main() {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            agent: { type: "string" },
            "eval-set": { type: "string" },
            workspace: { type: "string" },
            "baseline-agent": { type: "string" },
            "goose-cli": { type: "string", default: process.env.AGENT_CREATOR_GOOSE_CLI ?? "goose" },
            model: { type: "string" },
            timeout: { type: "string", default: "600" },
            "max-turns": { type: "string", default: "20" },
            workers: { type: "string", default: "2" },
        },
    });
    if (!values.agent || !values["eval-set"] || !values.workspace) {
        console.error("usage: run_agent_eval.js --agent <file> --eval-set <file> --workspace <dir> [options]");
        process.exit(2);
    }
    const agentPath = resolve(values.agent);
    const agent = parseAgent(agentPath);
    const cases = validateEvalSet(JSON.parse(readFileSync(resolve(values["eval-set"]), "utf-8")));
    const workspace = resolve(values.workspace);
    mkdirSync(workspace, { recursive: true });
    for (const evalCase of cases) {
        const evalDir = join(workspace, `eval-${evalCase.id}`);
        mkdirSync(evalDir, { recursive: true });
        writeFileSync(join(evalDir, "eval_metadata.json"), `${JSON.stringify({
            eval_id: evalCase.id,
            eval_name: evalCase.name ?? String(evalCase.id),
            prompt: evalCase.prompt,
            assertions: evalCase.assertions ?? [],
        }, null, 2)}\n`);
    }
    const temporary = mkdtempSync(join(tmpdir(), "agent-baseline-"));
    let baselineConfiguration;
    let baselinePath;
    try {
        if (values["baseline-agent"]) {
            baselinePath = resolve(values["baseline-agent"]);
            parseAgent(baselinePath);
            baselineConfiguration = "old_agent";
        }
        else {
            const baselineName = `${agent.name}-baseline`;
            baselinePath = join(temporary, `${baselineName}.md`);
            writeFileSync(baselinePath, baselineAgent(agent, baselineName), "utf-8");
            baselineConfiguration = "without_agent_instructions";
        }
        const jobs = [];
        for (const evalCase of cases) {
            jobs.push({ evalCase, configuration: "with_agent", path: agentPath });
            jobs.push({ evalCase, configuration: baselineConfiguration, path: baselinePath });
        }
        const gooseCommand = values["goose-cli"].split(/\s+/).filter(Boolean);
        const workers = Number(values.workers);
        const timeoutMs = Number(values.timeout) * 1000;
        const maxTurns = Number(values["max-turns"]);
        const results = await mapLimit(jobs, workers, async (job) => {
            const result = await runCase(job.evalCase, job.configuration, job.path, workspace, gooseCommand, values.model, timeoutMs, maxTurns);
            console.log(`Completed eval ${result.eval_id} / ${result.configuration} (${result.total_duration_seconds}s)`);
            return result;
        });
        const summary = {
            agent: agent.name,
            agent_path: agentPath,
            eval_count: cases.length,
            configurations: ["with_agent", baselineConfiguration],
            runs: results.sort((a, b) => String(a.eval_id) === String(b.eval_id)
                ? a.configuration.localeCompare(b.configuration)
                : String(a.eval_id).localeCompare(String(b.eval_id))),
        };
        writeFileSync(join(workspace, "run_summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
        console.log(workspace);
    }
    finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error?.message ?? error);
        process.exit(1);
    });
}
