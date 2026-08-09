#!/usr/bin/env python3
"""Validate a Goose/Open Plugins directory without installing it."""

import argparse
import json
import re
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
HOOK_EVENTS = {
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
}
MANIFEST_KEYS = {"name", "version", "description", "skills", "mcpServers"}


def load_json(path: Path, errors: list[str]):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"{path}: invalid JSON: {error}")
        return None


def valid_name(name: str) -> bool:
    return (
        bool(NAME_RE.fullmatch(name))
        and "--" not in name
        and ".." not in name
        and len(name) <= 64
    )


def validate_component_path(value: str, context: str, errors: list[str]):
    path = Path(value)
    if not value.startswith("./"):
        errors.append(f"{context}: component path must start with './': {value}")
    if path.is_absolute() or ".." in path.parts:
        errors.append(f"{context}: component path must stay within the plugin: {value}")


def component_paths(value, context: str, errors: list[str]) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = value
    elif isinstance(value, dict) and set(value).issubset({"paths", "exclusive"}):
        raw = value.get("paths", [])
        values = [raw] if isinstance(raw, str) else raw
        if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
            errors.append(f"{context}: paths must be a string or list of strings")
            return []
        if "exclusive" in value and not isinstance(value["exclusive"], bool):
            errors.append(f"{context}: exclusive must be a boolean")
    else:
        errors.append(f"{context}: expected a path, list of paths, or paths/exclusive object")
        return []
    if not all(isinstance(item, str) for item in values):
        errors.append(f"{context}: component paths must be strings")
        return []
    for item in values:
        validate_component_path(item, context, errors)
    return values


def parse_frontmatter(path: Path, errors: list[str]) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        errors.append(f"{path}: missing YAML frontmatter")
        return {}
    try:
        end = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration:
        errors.append(f"{path}: unclosed YAML frontmatter")
        return {}

    data = {}
    index = 1
    while index < end:
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            index += 1
            continue
        if ":" not in line:
            errors.append(f"{path}: unsupported frontmatter line: {line}")
            index += 1
            continue
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if value in (">", "|", ">-", "|-"):
            continuation = []
            index += 1
            while index < end and lines[index].startswith(("  ", "\t")):
                continuation.append(lines[index].strip())
                index += 1
            data[key] = " ".join(continuation)
            continue
        data[key] = value.strip('"\'')
        index += 1
    return data


def validate_skill(path: Path, errors: list[str]):
    frontmatter = parse_frontmatter(path, errors)
    name = frontmatter.get("name", "")
    description = frontmatter.get("description", "")
    if not valid_name(name):
        errors.append(f"{path}: name must be a valid lowercase plugin component name")
    elif path.parent.name != name:
        errors.append(f"{path}: directory '{path.parent.name}' must match skill name '{name}'")
    if not description:
        errors.append(f"{path}: missing frontmatter description")
    if len(description) > 1024:
        errors.append(f"{path}: description exceeds 1024 characters")
    if "TODO" in path.read_text(encoding="utf-8"):
        errors.append(f"{path}: unresolved TODO placeholder")


def validate_mcp_server(name: str, server, context: str, root: Path, errors: list[str]):
    if not isinstance(server, dict):
        errors.append(f"{context}: MCP server '{name}' must be an object")
        return
    command = server.get("command")
    if not isinstance(command, str) or not command.strip():
        errors.append(f"{context}: MCP server '{name}' command must be a non-empty string")
    args = server.get("args", [])
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        errors.append(f"{context}: MCP server '{name}' args must be a list of strings")
    env = server.get("env", {})
    if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
        errors.append(f"{context}: MCP server '{name}' env must map strings to strings")
    if "cwd" in server and not isinstance(server["cwd"], str):
        errors.append(f"{context}: MCP server '{name}' cwd must be a string")
    if isinstance(command, str) and command.startswith("${PLUGIN_ROOT}/"):
        relative = command.removeprefix("${PLUGIN_ROOT}/").split()[0]
        if not (root / relative).exists():
            errors.append(f"{context}: MCP server '{name}' command does not exist: {relative}")


def validate_mcp_document(value, context: str, root: Path, errors: list[str]):
    if not isinstance(value, dict):
        errors.append(f"{context}: document must be an object")
        return
    servers = value.get("mcpServers")
    if not isinstance(servers, dict) or not servers:
        errors.append(f"{context}: mcpServers must be a non-empty object")
        return
    for name, server in servers.items():
        validate_mcp_server(name, server, context, root, errors)


def validate_manifest_mcp(value, root: Path, errors: list[str]):
    if isinstance(value, dict) and not set(value).issubset({"paths", "exclusive"}):
        for name, server in value.items():
            validate_mcp_server(name, server, "plugin.json:mcpServers", root, errors)
        return
    component_paths(value, "plugin.json:mcpServers", errors)


def validate_hooks(path: Path, root: Path, errors: list[str]):
    document = load_json(path, errors)
    if not isinstance(document, dict):
        return
    hooks = document.get("hooks")
    if not isinstance(hooks, dict):
        errors.append("hooks/hooks.json: top-level 'hooks' must be an object")
        return
    for event, rules in hooks.items():
        if event not in HOOK_EVENTS:
            errors.append(f"hooks/hooks.json: unsupported event '{event}'")
        if not isinstance(rules, list):
            errors.append(f"hooks/hooks.json: event '{event}' must map to a list")
            continue
        for index, rule in enumerate(rules):
            context = f"hooks/hooks.json: {event}[{index}]"
            if not isinstance(rule, dict):
                errors.append(f"{context} must be an object")
                continue
            matcher = rule.get("matcher")
            if matcher == "*":
                errors.append(f"{context}: matcher '*' is invalid regex; use '.*' or omit it")
            if matcher is not None:
                if not isinstance(matcher, str):
                    errors.append(f"{context}: matcher must be a string")
                else:
                    try:
                        re.compile(matcher)
                    except re.error as error:
                        errors.append(f"{context}: invalid matcher: {error}")
            actions = rule.get("hooks")
            if not isinstance(actions, list) or not actions:
                errors.append(f"{context}.hooks must be a non-empty list")
                continue
            for action_index, action in enumerate(actions):
                action_context = f"{context}.hooks[{action_index}]"
                if not isinstance(action, dict):
                    errors.append(f"{action_context} must be an object")
                    continue
                if action.get("type", "command") != "command":
                    errors.append(f"{action_context}: only command hooks are supported")
                command = action.get("command")
                if not isinstance(command, str) or not command.strip():
                    errors.append(f"{action_context}: command must be a non-empty string")
                elif "${PLUGIN_ROOT}/" in command:
                    relative = command.split("${PLUGIN_ROOT}/", 1)[1].split()[0].strip('"\'')
                    if not (root / relative).exists():
                        errors.append(f"{action_context}: referenced file does not exist: {relative}")
                timeout = action.get("timeout")
                if timeout is not None and (not isinstance(timeout, int) or timeout <= 0):
                    errors.append(f"{action_context}: timeout must be a positive integer")


def validate(root: Path) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    if not root.is_dir():
        return [f"Not a directory: {root}"], warnings

    manifest_path = root / "plugin.json"
    if not manifest_path.is_file():
        errors.append("Missing plugin.json at plugin root")
        manifest = None
    else:
        manifest = load_json(manifest_path, errors)
        if isinstance(manifest, dict):
            unknown = set(manifest) - MANIFEST_KEYS
            if unknown:
                warnings.append(f"plugin.json: unrecognized fields preserved: {', '.join(sorted(unknown))}")
            for key in ("name", "version", "description"):
                if not isinstance(manifest.get(key), str) or not manifest[key].strip():
                    errors.append(f"plugin.json: {key} must be a non-empty string")
            name = manifest.get("name", "")
            if isinstance(name, str) and name and not valid_name(name):
                errors.append("plugin.json: name must be lowercase and contain only letters, numbers, dashes, and periods")
            if isinstance(name, str) and name and root.name != name:
                warnings.append(f"Directory name '{root.name}' differs from plugin name '{name}'")
            version = manifest.get("version", "")
            if isinstance(version, str) and version and not SEMVER_RE.fullmatch(version):
                warnings.append("plugin.json: version does not look like semantic versioning")
            if "skills" in manifest:
                component_paths(manifest["skills"], "plugin.json:skills", errors)
            if "mcpServers" in manifest:
                validate_manifest_mcp(manifest["mcpServers"], root, errors)

    skills = sorted(root.glob("skills/*/SKILL.md"))
    for skill in skills:
        validate_skill(skill, errors)

    hooks_path = root / "hooks" / "hooks.json"
    if hooks_path.is_file():
        validate_hooks(hooks_path, root, errors)

    mcp_path = root / ".mcp.json"
    if mcp_path.is_file():
        validate_mcp_document(load_json(mcp_path, errors), ".mcp.json", root, errors)

    manifest_has_mcp = isinstance(manifest, dict) and "mcpServers" in manifest
    if not skills and not hooks_path.is_file() and not mcp_path.is_file() and not manifest_has_mcp:
        errors.append("Plugin contains no skills, hooks, or MCP servers")

    for path in root.rglob("*"):
        if not path.is_file() or any(part in {".git", "__pycache__"} for part in path.parts):
            continue
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".zip", ".pyc"}:
            continue
        if path.name != "SKILL.md" and "TODO" in path.read_text(encoding="utf-8", errors="ignore"):
            warnings.append(f"Possible unresolved placeholder: {path.relative_to(root)}")

    return errors, warnings


def main():
    parser = argparse.ArgumentParser(description="Validate a Goose/Open Plugins directory")
    parser.add_argument("plugin_dir")
    args = parser.parse_args()
    root = Path(args.plugin_dir).expanduser().resolve()
    errors, warnings = validate(root)
    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)
    print(f"OK: {root}")


if __name__ == "__main__":
    main()
