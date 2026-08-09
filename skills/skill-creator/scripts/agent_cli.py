#!/usr/bin/env python3
"""Non-interactive agent CLI adapters used by skill-creator scripts."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_AGENT_CLI = "goose"


class AgentCliError(RuntimeError):
    """Raised when an agent CLI cannot execute or expose required events."""


@dataclass(frozen=True)
class AgentCli:
    command: tuple[str, ...]

    @classmethod
    def from_value(cls, value: str | None) -> "AgentCli":
        raw = value or os.environ.get("AGENT_SKILL_CREATOR_CLI", DEFAULT_AGENT_CLI)
        command = tuple(shlex.split(raw))
        if not command:
            raise AgentCliError("Agent CLI command cannot be empty")
        return cls(command)

    @property
    def executable(self) -> str:
        return Path(self.command[0]).name

    def text_command(self, model: str | None) -> list[str]:
        if self.executable == "goose":
            cmd = [*self.command, "run", "--no-session", "--quiet", "--output-format", "text", "--instructions", "-"]
            if model:
                cmd.extend(["--model", model])
            return cmd
        raise AgentCliError(
            f"Unsupported agent CLI '{self.executable}'. Add an adapter in scripts/agent_cli.py."
        )

    def stream_command(self, query: str, model: str | None) -> list[str]:
        if self.executable == "goose":
            cmd = [*self.command, "run", "--no-session", "--quiet", "--output-format", "stream-json", "--text", query]
            if model:
                cmd.extend(["--model", model])
            return cmd
        raise AgentCliError(
            f"Unsupported trigger-eval CLI '{self.executable}'. Add stream parsing in scripts/agent_cli.py."
        )

    def run_text(
        self,
        prompt: str,
        model: str | None,
        timeout: int = 300,
        cwd: Path | None = None,
    ) -> str:
        cmd = self.text_command(model)
        try:
            result = subprocess.run(
                cmd,
                input=prompt,
                capture_output=True,
                text=True,
                cwd=cwd,
                timeout=timeout,
            )
        except FileNotFoundError as error:
            raise AgentCliError(f"Agent CLI not found: {self.command[0]}") from error
        if result.returncode != 0:
            raise AgentCliError(
                f"Agent CLI exited {result.returncode}: {' '.join(cmd)}\nstderr: {result.stderr.strip()}"
            )
        return result.stdout

    def start_stream(
        self,
        query: str,
        model: str | None,
        cwd: Path,
    ) -> subprocess.Popen:
        cmd = self.stream_command(query, model)
        try:
            return subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                cwd=cwd,
            )
        except FileNotFoundError as error:
            raise AgentCliError(f"Agent CLI not found: {self.command[0]}") from error

    def event_loaded_skill(self, event: dict, skill_name: str) -> bool | None:
        """Return True/False for decisive events, or None when undecided."""
        if self.executable != "goose":
            raise AgentCliError(f"No event parser for agent CLI '{self.executable}'")

        event_type = event.get("type")
        if event_type == "complete":
            return False
        if event_type == "error":
            return False
        if event_type != "message":
            return None

        message = event.get("message", {})
        for content in message.get("content", []):
            if content.get("type") not in ("toolRequest", "tool_request"):
                continue
            tool_call = content.get("toolCall", content.get("tool_call", {}))
            if isinstance(tool_call, dict) and "Ok" in tool_call:
                tool_call = tool_call["Ok"]
            if isinstance(tool_call, dict) and "value" in tool_call:
                tool_call = tool_call["value"]
            if not isinstance(tool_call, dict):
                continue
            name = str(tool_call.get("name", ""))
            arguments = tool_call.get("arguments", {})
            if name.rsplit("__", 1)[-1] != "load_skill":
                continue
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {}
            loaded = arguments.get("name", "") if isinstance(arguments, dict) else ""
            return loaded == skill_name or loaded.startswith(f"{skill_name}/")
        return None


def parse_ndjson(lines: Iterable[str]) -> Iterable[dict]:
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            yield value
