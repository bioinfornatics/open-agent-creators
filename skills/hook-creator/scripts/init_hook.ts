#!/usr/bin/env node
// Add a minimal hook rule and script to an existing plugin directory.
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, statSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOOK_EVENTS } from "./hook_format.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class UsageError extends Error {}

export interface InitOptions {
  pluginDir: string;
  event: string;
  name: string;
  matcher: string | null;
  timeout: number;
}

export interface InitResult {
  hooksPath: string;
  scriptPath: string;
}

export function parseInitArgs(argv: string[]): InitOptions {
  const positional: string[] = [];
  let matcher: string | null = null;
  let timeout = 30;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--matcher") {
      const value = argv[++i];
      if (value === undefined) throw new UsageError("--matcher requires a value");
      matcher = value;
    } else if (arg === "--timeout") {
      const value = argv[++i];
      if (value === undefined) throw new UsageError("--timeout requires a value");
      timeout = Number(value);
    } else if (arg.startsWith("--matcher=")) {
      matcher = arg.slice("--matcher=".length);
    } else if (arg.startsWith("--timeout=")) {
      timeout = Number(arg.slice("--timeout=".length));
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 3) {
    throw new UsageError("usage: init_hook.js <plugin_dir> <event> <name> [--matcher <regex>] [--timeout <n>]");
  }
  const [pluginDir, event, name] = positional;
  if (!HOOK_EVENTS.has(event)) {
    throw new UsageError(`invalid event: ${event} (choices: ${Array.from(HOOK_EVENTS).sort().join(", ")})`);
  }
  if (!NAME_RE.test(name)) throw new UsageError("Handler name must be lowercase kebab-case");
  if (matcher !== null) {
    try { new RegExp(matcher); } catch (error) {
      throw new UsageError(`Invalid matcher regex: ${(error as Error).message}`);
    }
  }
  if (!Number.isFinite(timeout) || !Number.isInteger(timeout) || timeout <= 0) {
    throw new UsageError("Timeout must be a positive integer");
  }
  return { pluginDir, event, name, matcher, timeout };
}

export function initHook(options: InitOptions): InitResult {
  const { pluginDir, event, name, matcher, timeout } = options;
  const root = resolve(pluginDir);
  const manifest = join(root, "plugin.json");
  if (!existsSync(manifest)) throw new Error(`Plugin manifest not found: ${manifest}`);

  const hooksPath = join(root, "hooks", "hooks.json");
  const scriptPath = join(root, "scripts", `${name}.sh`);
  if (existsSync(scriptPath)) throw new Error(`Refusing to overwrite existing script: ${scriptPath}`);

  mkdirSync(join(root, "hooks"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  let document: { hooks: Record<string, unknown[]> };
  if (existsSync(hooksPath)) {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(hooksPath, "utf-8")); } catch (error) {
      throw new Error(`Cannot update invalid hooks.json: ${(error as Error).message}`);
    }
    const candidate = parsed as { hooks?: unknown };
    if (typeof candidate.hooks !== "object" || candidate.hooks === null || Array.isArray(candidate.hooks)) {
      throw new Error("Existing hooks.json must contain a top-level hooks object");
    }
    document = candidate as { hooks: Record<string, unknown[]> };
  } else {
    document = { hooks: {} };
  }

  const rule: Record<string, unknown> = { hooks: [{ type: "command", command: `\${PLUGIN_ROOT}/scripts/${name}.sh`, timeout }] };
  if (matcher !== null) rule.matcher = matcher;
  document.hooks[event] = document.hooks[event] ?? [];
  document.hooks[event].push(rule);
  writeFileSync(hooksPath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  writeFileSync(scriptPath,
    "#!/usr/bin/env sh\nset -eu\npayload=$(cat 2>/dev/null || printf '{}')\n" +
    "# Implement trusted local automation using the JSON payload.\n" +
    "printf '%s' \"$payload\" >/dev/null\nexit 0\n", "utf-8");
  chmodSync(scriptPath, statSync(scriptPath).mode | 0o111);
  return { hooksPath, scriptPath };
}

function isMain(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(process.argv[1])); } catch { return false; }
}

function legacyMain(): void {
  try {
    const result = initHook(parseInitArgs(process.argv.slice(2)));
    console.log(result.hooksPath);
    console.log(result.scriptPath);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 2;
  }
}

if (isMain(import.meta.url)) legacyMain();
