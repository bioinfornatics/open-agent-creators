#!/usr/bin/env node
// Add a minimal hook rule and script to an existing plugin directory.
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOOK_EVENTS } from "./hook_format.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(2);
  throw new Error("unreachable");
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let matcher: string | null = null;
  let timeout = 30;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--matcher") {
      matcher = argv[++i] ?? null;
    } else if (arg === "--timeout") {
      timeout = Number(argv[++i]);
    } else if (arg.startsWith("--matcher=")) {
      matcher = arg.slice("--matcher=".length);
    } else if (arg.startsWith("--timeout=")) {
      timeout = Number(arg.slice("--timeout=".length));
    } else {
      positional.push(arg);
    }
  }
  return { positional, matcher, timeout };
}

function main() {
  const { positional, matcher, timeout } = parseArgs(process.argv.slice(2));
  const [pluginDir, event, name] = positional;
  if (!pluginDir || !event || !name) {
    fail("usage: init_hook.js <plugin_dir> <event> <name> [--matcher <regex>] [--timeout <n>]");
  }
  if (!HOOK_EVENTS.has(event)) {
    fail(`invalid event: ${event} (choices: ${Array.from(HOOK_EVENTS).sort().join(", ")})`);
  }
  if (!NAME_RE.test(name)) {
    fail("Handler name must be lowercase kebab-case");
  }
  if (matcher !== null) {
    try {
      new RegExp(matcher);
    } catch (error) {
      fail(`Invalid matcher regex: ${(error as Error).message}`);
    }
  }
  if (!Number.isFinite(timeout) || timeout <= 0) {
    fail("Timeout must be positive");
  }

  const root = resolve(pluginDir);
  const manifest = join(root, "plugin.json");
  if (!existsSync(manifest)) {
    fail(`Plugin manifest not found: ${manifest}`);
  }

  const hooksPath = join(root, "hooks", "hooks.json");
  const scriptPath = join(root, "scripts", `${name}.sh`);
  if (existsSync(scriptPath)) {
    fail(`Refusing to overwrite existing script: ${scriptPath}`);
  }

  mkdirSync(join(root, "hooks"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });

  let document: { hooks: Record<string, unknown[]> };
  if (existsSync(hooksPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(hooksPath, "utf-8"));
    } catch (error) {
      fail(`Cannot update invalid hooks.json: ${(error as Error).message}`);
    }
    const candidate = parsed as { hooks?: unknown };
    if (typeof candidate.hooks !== "object" || candidate.hooks === null || Array.isArray(candidate.hooks)) {
      fail("Existing hooks.json must contain a top-level hooks object");
    }
    document = candidate as { hooks: Record<string, unknown[]> };
  } else {
    document = { hooks: {} };
  }

  const rule: Record<string, unknown> = {
    hooks: [
      {
        type: "command",
        command: `\${PLUGIN_ROOT}/scripts/${name}.sh`,
        timeout,
      },
    ],
  };
  if (matcher !== null) {
    rule.matcher = matcher;
  }
  document.hooks[event] = document.hooks[event] ?? [];
  document.hooks[event].push(rule);
  writeFileSync(hooksPath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");

  writeFileSync(
    scriptPath,
    "#!/usr/bin/env sh\n" +
      "set -eu\n" +
      "payload=$(cat 2>/dev/null || printf '{}')\n" +
      "# Implement trusted local automation using the JSON payload.\n" +
      "printf '%s' \"$payload\" >/dev/null\n" +
      "exit 0\n",
    "utf-8"
  );
  const mode = statSync(scriptPath).mode;
  chmodSync(scriptPath, mode | 0o111);

  console.log(hooksPath);
  console.log(scriptPath);
}

main();
