#!/usr/bin/env python3
"""Runner contracts for non-interactive skill evaluation."""

from __future__ import annotations

import subprocess
from abc import ABC, abstractmethod
from pathlib import Path


class RunnerError(RuntimeError):
    """Raised when a runner cannot execute or expose required events."""


class Runner(ABC):
    """Execute prompts and detect skill-loading events for one agent host."""

    @abstractmethod
    def run_text(
        self,
        prompt: str,
        model: str | None,
        timeout: int = 300,
        cwd: Path | None = None,
    ) -> str:
        """Run a one-shot prompt and return plain assistant text."""

    @abstractmethod
    def start_stream(
        self,
        query: str,
        model: str | None,
        cwd: Path,
    ) -> subprocess.Popen:
        """Start a query that emits newline-delimited structured events."""

    @abstractmethod
    def event_loaded_skill(self, event: dict, skill_name: str) -> bool | None:
        """Return True or False for decisive events, otherwise None."""
