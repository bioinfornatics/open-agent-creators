#!/usr/bin/env python3
"""Goose runner for skill description and trigger evaluation."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
from pathlib import Path

from .base import Runner, RunnerError


class GooseRunner(Runner):
    def __init__(self, command: str | None = None):
        raw = command or os.environ.get("SKILL_CREATOR_GOOSE_COMMAND", "goose")
        self.command = tuple(shlex.split(raw))
        if not self.command:
            raise RunnerError("SKILL_CREATOR_GOOSE_COMMAND cannot be empty")

    def _text_command(self, model: str | None) -> list[str]:
        command = [
            *self.command,
            "run",
            "--no-session",
            "--quiet",
            "--output-format",
            "text",
            "--instructions",
            "-",
        ]
        if model:
            command.extend(["--model", model])
        return command

    def _stream_command(self, query: str, model: str | None) -> list[str]:
        command = [
            *self.command,
            "run",
            "--no-session",
            "--quiet",
            "--output-format",
            "stream-json",
            "--text",
            query,
        ]
        if model:
            command.extend(["--model", model])
        return command

    def run_text(
        self,
        prompt: str,
        model: str | None,
        timeout: int = 300,
        cwd: Path | None = None,
    ) -> str:
        command = self._text_command(model)
        try:
            result = subprocess.run(
                command,
                input=prompt,
                capture_output=True,
                text=True,
                cwd=cwd,
                timeout=timeout,
            )
        except FileNotFoundError as error:
            raise RunnerError(f"Goose command not found: {self.command[0]}") from error
        if result.returncode != 0:
            raise RunnerError(
                f"Goose exited {result.returncode}: {' '.join(command)}\n"
                f"stderr: {result.stderr.strip()}"
            )
        return result.stdout

    def start_stream(
        self,
        query: str,
        model: str | None,
        cwd: Path,
    ) -> subprocess.Popen:
        command = self._stream_command(query, model)
        try:
            return subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                cwd=cwd,
            )
        except FileNotFoundError as error:
            raise RunnerError(f"Goose command not found: {self.command[0]}") from error

    def event_loaded_skill(self, event: dict, skill_name: str) -> bool | None:
        event_type = event.get("type")
        if event_type in {"complete", "error"}:
            return False
        if event_type != "message":
            return None

        message = event.get("message", {})
        for content in message.get("content", []):
            if content.get("type") not in {"toolRequest", "tool_request"}:
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
