#!/usr/bin/env node
/** Unified command-line interface for skill-creator workflows. */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const commands = {
    validate: { entry: "quick_validate.js", usage: "validate <skill-directory>", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "trigger-eval": { entry: "run_eval.js", usage: "trigger-eval --eval-set <file> --skill-path <dir> [options]", required: (a) => hasValue(a, "--eval-set") && hasValue(a, "--skill-path") },
    aggregate: { entry: "aggregate_benchmark.js", usage: "aggregate <benchmark-directory> [options]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    review: { entry: "../eval-viewer/generate_review.js", usage: "review <workspace> [options]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    verify: { entry: "verify_skill_gates.js", usage: "verify <skill-directory> [options]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    package: { entry: "package_skill.js", usage: "package <skill-directory> [output-directory]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
};
function hasValue(args, option) {
    const index = args.indexOf(option);
    return index >= 0 && Boolean(args[index + 1] && !args[index + 1].startsWith("-"));
}
function help(command) {
    if (command)
        return `Usage: skill-creator ${commands[command].usage}

Common options:
  --format text|json  Select output format (default: text)
  --quiet             Suppress successful text output
  --help              Show this help`;
    return `Usage: skill-creator <command> [options]

Commands:
  validate      Validate a skill directory
  trigger-eval  Run trigger-description evaluation
  aggregate     Aggregate behavioral benchmark runs
  review        Generate or serve the evaluation review viewer
  verify        Verify release gates
  package       Build a distributable .skill archive

Run "skill-creator <command> --help" for command usage.`;
}
function parseCommon(argv) {
    const args = [];
    let format = "text";
    let quiet = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--quiet")
            quiet = true;
        else if (argv[i] === "--format") {
            const value = argv[++i];
            if (value !== "text" && value !== "json")
                return { args, format, quiet, error: "--format must be text or json" };
            format = value;
        }
        else if (argv[i].startsWith("--format=")) {
            const value = argv[i].slice(9);
            if (value !== "text" && value !== "json")
                return { args, format, quiet, error: "--format must be text or json" };
            format = value;
        }
        else
            args.push(argv[i]);
    }
    return { args, format, quiet };
}
function maybeJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value || null;
    }
}
function run() {
    const argv = process.argv.slice(2);
    if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
        console.log(help());
        return 0;
    }
    const name = argv.shift();
    if (!(name in commands)) {
        console.error(`Unknown command: ${name}

${help()}`);
        return 2;
    }
    const parsed = parseCommon(argv);
    if (parsed.error) {
        console.error(`Error: ${parsed.error}

${help(name)}`);
        return 2;
    }
    if (parsed.args.includes("--help") || parsed.args.includes("-h")) {
        console.log(help(name));
        return 0;
    }
    const config = commands[name];
    if (!config.required(parsed.args)) {
        console.error(help(name));
        return 2;
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const child = spawnSync(process.execPath, [join(here, config.entry), ...parsed.args], { encoding: "utf8" });
    const rawCode = child.status ?? 1;
    const stdout = (child.stdout ?? "").trimEnd();
    const stderr = (child.stderr ?? "").trimEnd();
    let code = rawCode === 0 ? 0 : rawCode === 2 ? 2 : 1;
    let payload = maybeJson(stdout);
    if (name === "verify" && payload && typeof payload === "object" && "status" in payload) {
        const status = payload.status;
        code = status === "pass" ? 0 : status === "blocked" ? 3 : 1;
    }
    else if (name === "trigger-eval" && rawCode !== 0 && /(command not found|unsupported runner|exited \d+|timed? out)/i.test(stderr)) {
        // A valid evaluation that cannot use its configured execution backend is blocked.
        code = 3;
    }
    if (parsed.format === "json") {
        console.log(JSON.stringify({ command: name, status: code === 0 ? "success" : code === 3 ? "blocked" : code === 2 ? "usage" : "failure", exit_code: code, output: payload, stderr: stderr || null }, null, 2));
    }
    else {
        if (stdout && (!parsed.quiet || code !== 0))
            console.log(stdout);
        if (stderr)
            console.error(stderr);
    }
    return code;
}
process.exitCode = run();
