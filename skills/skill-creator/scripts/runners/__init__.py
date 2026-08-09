"""Select a non-interactive runner for skill evaluation."""

from __future__ import annotations

import os

from .base import Runner, RunnerError
from .goose import GooseRunner

RUNNERS = {
    "goose": GooseRunner,
}


def create_runner(name: str | None = None) -> Runner:
    runner_name = name or os.environ.get("SKILL_CREATOR_RUNNER", "goose")
    runner_class = RUNNERS.get(runner_name)
    if runner_class is None:
        supported = ", ".join(sorted(RUNNERS))
        raise RunnerError(f"Unsupported runner '{runner_name}'. Supported runners: {supported}")
    return runner_class()


__all__ = ["Runner", "RunnerError", "create_runner"]
