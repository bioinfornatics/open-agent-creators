// Shared validation for Goose/Open Plugins hooks.
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const HOOK_EVENTS = new Set([
  "SessionStart",
  "SessionEnd",
  "Stop",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "BeforeReadFile",
  "AfterFileEdit",
  "BeforeShellExecution",
  "AfterShellExecution",
]);

export const BLOCKING_EVENTS = new Set(["PreToolUse", "Stop"]);

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function loadJson(path: string, errors: string[]): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    errors.push(`${path}: invalid JSON: ${(error as Error).message}`);
    return null;
  }
}

export function referencedPluginFile(command: string): string | null {
  const marker = "${PLUGIN_ROOT}/";
  const index = command.indexOf(marker);
  if (index === -1) return null;
  const rest = command.slice(index + marker.length);
  const token = rest.split(/\s/)[0];
  return token.replace(/^['"]|['"]$/g, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function validateHooks(pluginRoot: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const path = join(pluginRoot, "hooks", "hooks.json");
  if (!isFile(path)) {
    return { errors: [`Missing hook configuration: ${path}`], warnings };
  }

  const document = loadJson(path, errors);
  if (!isPlainObject(document)) {
    return { errors, warnings };
  }
  const documentKeys = Object.keys(document);
  if (documentKeys.length !== 1 || documentKeys[0] !== "hooks") {
    errors.push("hooks/hooks.json must contain only the top-level 'hooks' field");
  }
  const hooks = document.hooks;
  if (!isPlainObject(hooks) || Object.keys(hooks).length === 0) {
    errors.push("hooks/hooks.json: 'hooks' must be a non-empty object");
    return { errors, warnings };
  }

  for (const [event, rules] of Object.entries(hooks)) {
    if (!HOOK_EVENTS.has(event)) {
      errors.push(`Unsupported hook event: ${event}`);
    }
    if (!Array.isArray(rules) || rules.length === 0) {
      errors.push(`Event '${event}' must map to a non-empty list`);
      continue;
    }
    rules.forEach((rule, index) => {
      const context = `${event}[${index}]`;
      if (!isPlainObject(rule)) {
        errors.push(`${context}: rule must be an object`);
        return;
      }
      const unknownRule = Object.keys(rule).filter((k) => !["matcher", "hooks"].includes(k));
      if (unknownRule.length) {
        errors.push(`${context}: unsupported fields: ${unknownRule.sort().join(", ")}`);
      }
      const matcher = rule.matcher;
      if (matcher === "*") {
        errors.push(`${context}: matcher '*' is invalid regex; omit it or use '.*'`);
      }
      if (matcher !== undefined && matcher !== null) {
        if (typeof matcher !== "string") {
          errors.push(`${context}: matcher must be a string`);
        } else if (!isValidRegex(matcher)) {
          errors.push(`${context}: invalid matcher regex`);
        }
      }
      const actions = rule.hooks;
      if (!Array.isArray(actions) || actions.length === 0) {
        errors.push(`${context}: hooks must be a non-empty list`);
        return;
      }
      actions.forEach((action, actionIndex) => {
        const actionContext = `${context}.hooks[${actionIndex}]`;
        if (!isPlainObject(action)) {
          errors.push(`${actionContext}: action must be an object`);
          return;
        }
        const unknownAction = Object.keys(action).filter(
          (k) => !["type", "command", "timeout"].includes(k)
        );
        if (unknownAction.length) {
          errors.push(`${actionContext}: unsupported fields: ${unknownAction.sort().join(", ")}`);
        }
        if ((action.type ?? "command") !== "command") {
          errors.push(`${actionContext}: Goose currently supports only command actions`);
        }
        const command = action.command;
        if (typeof command !== "string" || !command.trim()) {
          errors.push(`${actionContext}: command must be a non-empty string`);
        } else {
          const relative = referencedPluginFile(command);
          if (relative && !isFile(join(pluginRoot, relative))) {
            errors.push(`${actionContext}: referenced file does not exist: ${relative}`);
          }
        }
        const timeout = action.timeout;
        if (
          timeout !== undefined &&
          timeout !== null &&
          (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0)
        ) {
          errors.push(`${actionContext}: timeout must be a positive integer`);
        }
      });
    });
  }

  const scriptsDir = join(pluginRoot, "scripts");
  if (isDir(scriptsDir)) {
    for (const entry of readdirSync(scriptsDir)) {
      const scriptPath = join(scriptsDir, entry);
      if (!isFile(scriptPath)) continue;
      const suffix = entry.includes(".") ? entry.slice(entry.lastIndexOf(".")) : "";
      if ([".sh", ".bash", ".py"].includes(suffix)) {
        const text = readFileSync(scriptPath, "utf-8");
        if (text.includes("TODO")) {
          errors.push(`${scriptPath}: unresolved TODO placeholder`);
        }
        if ([".sh", ".bash"].includes(suffix) && !text.includes("cat")) {
          warnings.push(`${scriptPath}: hook script may not read the JSON payload from stdin`);
        }
      }
    }
  }

  return { errors, warnings };
}
