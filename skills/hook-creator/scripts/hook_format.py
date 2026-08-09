#!/usr/bin/env python3
"""Shared validation for Goose/Open Plugins hooks."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

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
BLOCKING_EVENTS = {"PreToolUse", "Stop"}


@dataclass(frozen=True)
class ValidationResult:
    errors: list[str]
    warnings: list[str]


def load_json(path: Path, errors: list[str]):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"{path}: invalid JSON: {error}")
        return None


def referenced_plugin_file(command: str) -> str | None:
    marker = "${PLUGIN_ROOT}/"
    if marker not in command:
        return None
    return command.split(marker, 1)[1].split()[0].strip('"\'')


def validate_hooks(plugin_root: Path) -> ValidationResult:
    errors: list[str] = []
    warnings: list[str] = []
    path = plugin_root / "hooks" / "hooks.json"
    if not path.is_file():
        return ValidationResult([f"Missing hook configuration: {path}"], warnings)

    document = load_json(path, errors)
    if not isinstance(document, dict):
        return ValidationResult(errors, warnings)
    if set(document) != {"hooks"}:
        errors.append("hooks/hooks.json must contain only the top-level 'hooks' field")
    hooks = document.get("hooks")
    if not isinstance(hooks, dict) or not hooks:
        errors.append("hooks/hooks.json: 'hooks' must be a non-empty object")
        return ValidationResult(errors, warnings)

    for event, rules in hooks.items():
        if event not in HOOK_EVENTS:
            errors.append(f"Unsupported hook event: {event}")
        if not isinstance(rules, list) or not rules:
            errors.append(f"Event '{event}' must map to a non-empty list")
            continue
        for index, rule in enumerate(rules):
            context = f"{event}[{index}]"
            if not isinstance(rule, dict):
                errors.append(f"{context}: rule must be an object")
                continue
            unknown_rule = set(rule) - {"matcher", "hooks"}
            if unknown_rule:
                errors.append(f"{context}: unsupported fields: {', '.join(sorted(unknown_rule))}")
            matcher = rule.get("matcher")
            if matcher == "*":
                errors.append(f"{context}: matcher '*' is invalid regex; omit it or use '.*'")
            if matcher is not None:
                if not isinstance(matcher, str):
                    errors.append(f"{context}: matcher must be a string")
                else:
                    try:
                        re.compile(matcher)
                    except re.error as error:
                        errors.append(f"{context}: invalid matcher regex: {error}")
            actions = rule.get("hooks")
            if not isinstance(actions, list) or not actions:
                errors.append(f"{context}: hooks must be a non-empty list")
                continue
            for action_index, action in enumerate(actions):
                action_context = f"{context}.hooks[{action_index}]"
                if not isinstance(action, dict):
                    errors.append(f"{action_context}: action must be an object")
                    continue
                unknown_action = set(action) - {"type", "command", "timeout"}
                if unknown_action:
                    errors.append(
                        f"{action_context}: unsupported fields: {', '.join(sorted(unknown_action))}"
                    )
                if action.get("type", "command") != "command":
                    errors.append(f"{action_context}: Goose currently supports only command actions")
                command = action.get("command")
                if not isinstance(command, str) or not command.strip():
                    errors.append(f"{action_context}: command must be a non-empty string")
                else:
                    relative = referenced_plugin_file(command)
                    if relative and not (plugin_root / relative).is_file():
                        errors.append(f"{action_context}: referenced file does not exist: {relative}")
                timeout = action.get("timeout")
                if timeout is not None and (
                    not isinstance(timeout, int) or isinstance(timeout, bool) or timeout <= 0
                ):
                    errors.append(f"{action_context}: timeout must be a positive integer")

    for script in (plugin_root / "scripts").glob("*") if (plugin_root / "scripts").is_dir() else []:
        if script.is_file() and script.suffix in {".sh", ".bash", ".py"}:
            text = script.read_text(encoding="utf-8", errors="ignore")
            if "TODO" in text:
                errors.append(f"{script}: unresolved TODO placeholder")
            if script.suffix in {".sh", ".bash"} and "cat" not in text:
                warnings.append(f"{script}: hook script may not read the JSON payload from stdin")

    return ValidationResult(errors, warnings)
