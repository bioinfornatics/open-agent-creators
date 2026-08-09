#!/usr/bin/env python3
"""Grade paired custom-agent eval outputs with deterministic or LLM grading."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
from pathlib import Path


def deterministic_grade(assertion: str, response: str) -> tuple[bool, str] | None:
    match = re.fullmatch(r"contains:\s*(.+)", assertion, re.IGNORECASE)
    if match:
        needle = match.group(1)
        passed = needle.casefold() in response.casefold()
        return passed, f"Expected response to contain: {needle!r}"
    match = re.fullmatch(r"not-contains:\s*(.+)", assertion, re.IGNORECASE)
    if match:
        needle = match.group(1)
        passed = needle.casefold() not in response.casefold()
        return passed, f"Expected response not to contain: {needle!r}"
    match = re.fullmatch(r"regex:\s*(.+)", assertion, re.IGNORECASE)
    if match:
        pattern = match.group(1)
        try:
            passed = re.search(pattern, response, re.MULTILINE) is not None
        except re.error as error:
            raise ValueError(f"Invalid assertion regex {pattern!r}: {error}") from error
        return passed, f"Regex {pattern!r} {'matched' if passed else 'did not match'}"
    return None


def llm_grade(prompt: str, response: str, assertion: str, command: tuple[str, ...], model: str | None) -> dict:
    grading_prompt = f"""Grade one custom-agent evaluation assertion.

Task:
{prompt}

Agent response:
{response}

Assertion:
{assertion}

Return JSON only with exactly these fields:
{{"passed": true, "evidence": "specific evidence from the response"}}
Use passed=false when the evidence is missing, contradicted, or unverifiable.
"""
    args = [*command, "run", "--no-session", "--quiet", "--output-format", "text", "--instructions", "-"]
    if model:
        args.extend(["--model", model])
    result = subprocess.run(args, input=grading_prompt, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"Grader failed: {result.stderr.strip()}")
    text = result.stdout.strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise RuntimeError(f"Grader did not return JSON: {text}")
    document = json.loads(match.group(0))
    if not isinstance(document.get("passed"), bool) or not isinstance(document.get("evidence"), str):
        raise RuntimeError(f"Invalid grader result: {document}")
    return document


def grade_run(
    run_dir: Path,
    prompt: str,
    assertions: list[str],
    command: tuple[str, ...],
    model: str | None,
    use_llm: bool,
):
    response_path = run_dir / "outputs" / "response.md"
    response = response_path.read_text(encoding="utf-8") if response_path.is_file() else ""
    results = []
    for assertion in assertions:
        deterministic = deterministic_grade(assertion, response)
        if deterministic is not None:
            passed, evidence = deterministic
            result = {"passed": passed, "evidence": evidence}
        elif use_llm:
            result = llm_grade(prompt, response, assertion, command, model)
        else:
            result = {
                "passed": False,
                "evidence": "Assertion requires LLM grading; rerun with --llm-grader",
            }
        results.append({"text": assertion, **result})

    passed = sum(1 for result in results if result["passed"])
    total = len(results)
    timing = {}
    timing_path = run_dir / "timing.json"
    if timing_path.is_file():
        timing = json.loads(timing_path.read_text(encoding="utf-8"))
    grading = {
        "expectations": results,
        "summary": {
            "passed": passed,
            "failed": total - passed,
            "total": total,
            "pass_rate": passed / total if total else 0.0,
        },
        "timing": timing,
    }
    (run_dir / "grading.json").write_text(json.dumps(grading, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description="Grade custom-agent eval outputs")
    parser.add_argument("workspace")
    parser.add_argument("--llm-grader", action="store_true", help="Use Goose for free-form assertions")
    parser.add_argument("--goose-cli", default=os.environ.get("AGENT_CREATOR_GOOSE_CLI", "goose"))
    parser.add_argument("--model", default=None)
    args = parser.parse_args()

    workspace = Path(args.workspace).expanduser().resolve()
    command = tuple(shlex.split(args.goose_cli))
    graded = 0
    for eval_dir in sorted(workspace.glob("eval-*")):
        metadata_path = eval_dir / "eval_metadata.json"
        if not metadata_path.is_file():
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        for run_dir in sorted(path for path in eval_dir.iterdir() if path.is_dir()):
            if not (run_dir / "outputs").is_dir():
                continue
            grade_run(
                run_dir,
                metadata.get("prompt", ""),
                metadata.get("assertions", []),
                command,
                args.model,
                args.llm_grader,
            )
            graded += 1
    print(f"Graded {graded} runs in {workspace}")


if __name__ == "__main__":
    main()
