#!/usr/bin/env python3
"""Shared parsing and validation for Goose custom-agent files."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

ALLOWED_FIELDS = {"name", "description", "model"}
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass(frozen=True)
class AgentDocument:
    name: str
    description: str | None
    model: str | None
    body: str


def parse_agent(path: Path) -> AgentDocument:
    if path.suffix.lower() != ".md":
        raise ValueError("Agent file must use the .md extension")
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ValueError(f"Cannot read agent file: {error}") from error

    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("Agent file must start with YAML frontmatter")
    try:
        end = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration as error:
        raise ValueError("Agent frontmatter is not closed with ---") from error

    try:
        metadata = yaml.safe_load("\n".join(lines[1:end]))
    except yaml.YAMLError as error:
        raise ValueError(f"Invalid YAML frontmatter: {error}") from error
    if not isinstance(metadata, dict):
        raise ValueError("Agent frontmatter must be a YAML mapping")

    unknown = set(metadata) - ALLOWED_FIELDS
    if unknown:
        raise ValueError(f"Unsupported frontmatter fields: {', '.join(sorted(unknown))}")

    name = metadata.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Frontmatter field 'name' must be a non-empty string")
    name = name.strip()
    if not NAME_RE.fullmatch(name):
        raise ValueError("Agent name must be lowercase kebab-case")
    if len(name) > 64:
        raise ValueError("Agent name must not exceed 64 characters")

    description = metadata.get("description")
    if description is not None and (not isinstance(description, str) or not description.strip()):
        raise ValueError("Frontmatter field 'description' must be a non-empty string when present")
    if isinstance(description, str):
        description = description.strip()

    model = metadata.get("model")
    if model is not None and (not isinstance(model, str) or not model.strip()):
        raise ValueError("Frontmatter field 'model' must be a non-empty string when present")
    if isinstance(model, str):
        model = model.strip()

    body = "\n".join(lines[end + 1 :]).strip()
    if not body:
        raise ValueError("Agent instruction body must not be empty")
    if "TODO" in body:
        raise ValueError("Agent instruction body contains an unresolved TODO")

    return AgentDocument(name=name, description=description, model=model, body=body)


def render_agent(name: str, description: str | None, model: str | None, body: str) -> str:
    metadata = {"name": name}
    if description:
        metadata["description"] = description
    if model:
        metadata["model"] = model
    frontmatter = yaml.safe_dump(metadata, sort_keys=False, allow_unicode=True).strip()
    return f"---\n{frontmatter}\n---\n\n{body.strip()}\n"
