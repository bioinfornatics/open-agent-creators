#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initHook, parseInitArgs, UsageError } from "./init_hook.js";
import { validateHook } from "./validate_hook.js";

type Format = "text" | "json";
interface Common { format: Format; quiet: boolean; help: boolean; rest: string[]; }

const HELP = `Usage: hook-creator [--format text|json] [--quiet] <command> [options]

Commands:
  init <plugin_dir> <event> <name> [--matcher <regex>] [--timeout <n>]
  validate <plugin_dir>

Common options:
  --format <text|json>  Select human-readable or JSON output (default: text)
  --quiet               Suppress successful output
  -h, --help            Show help
`;

function parseCommon(argv: string[]): Common {
  let format: Format = "text";
  let quiet = false;
  let help = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--format") {
      const value = argv[++i];
      if (value !== "text" && value !== "json") throw new UsageError("--format must be text or json");
      format = value;
    } else if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value !== "text" && value !== "json") throw new UsageError("--format must be text or json");
      format = value;
    } else if (arg === "--quiet") quiet = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else rest.push(arg);
  }
  return { format, quiet, help, rest };
}

function output(value: unknown, format: Format, quiet: boolean, lines: string[]): void {
  if (quiet) return;
  if (format === "json") console.log(JSON.stringify(value));
  else for (const line of lines) console.log(line);
}

function failure(error: Error, format: Format, usage: boolean): number {
  if (format === "json") console.log(JSON.stringify({ ok: false, error: error.message, usage }));
  else console.error(`error: ${error.message}`);
  return usage ? 2 : 1;
}

export function run(argv: string[]): number {
  let common: Common;
  try { common = parseCommon(argv); } catch (error) { return failure(error as Error, "text", true); }
  const [command, ...args] = common.rest;
  if (common.help) {
    output({ ok: true, help: HELP }, common.format, false, [HELP.trimEnd()]);
    return 0;
  }
  if (!command) return failure(new UsageError("a command is required; use --help"), common.format, true);
  try {
    if (command === "init") {
      const result = initHook(parseInitArgs(args));
      output({ ok: true, command, ...result }, common.format, common.quiet, [result.hooksPath, result.scriptPath]);
      return 0;
    }
    if (command === "validate") {
      if (args.length !== 1) throw new UsageError("usage: hook-creator validate <plugin_dir>");
      const result = validateHook(args[0]);
      const ok = result.errors.length === 0;
      output({ ok, command, ...result }, common.format, common.quiet && ok,
        [...result.warnings.map((x) => `WARNING: ${x}`), ...result.errors.map((x) => `ERROR: ${x}`), ...(ok ? [`OK: ${result.path}`] : [])]);
      return ok ? 0 : 1;
    }
    throw new UsageError(`unknown command: ${command}`);
  } catch (error) {
    return failure(error as Error, common.format, error instanceof UsageError);
  }
}

function isMain(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(process.argv[1])); } catch { return false; }
}

if (isMain(import.meta.url)) process.exitCode = run(process.argv.slice(2));
