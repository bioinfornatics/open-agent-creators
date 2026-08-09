#!/usr/bin/env python3
"""Run paired custom-agent evaluations with Goose."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from agent_format import AgentDocument, parse_agent, render_agent


def extract_assistant_text(document: dict) -> str:
    chunks = []
    for message in document.get("messages", []):
        if message.get("role") != "assistant":
            continue
        for item in message.get("content", []):
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                chunks.append(item["text"])
    return "\n\n".join(chunks).strip()


def baseline_agent(agent: AgentDocument, name: str) -> str:
    description = f"Baseline role for comparison with {agent.name}"
    body = (
        "Complete the delegated task using your general capabilities. "
        "Follow the user's request, but do not assume specialized role instructions "
        "that are not present in the task itself."
    )
    return render_agent(name, description, agent.model, body)


def run_case(
    case: dict,
    configuration: str,
    agent_path: Path,
    workspace: Path,
    goose_command: tuple[str, ...],
    model: str | None,
    timeout: int,
    max_turns: int,
) -> dict:
    eval_id = case["id"]
    run_dir = workspace / f"eval-{eval_id}" / configuration
    outputs = run_dir / "outputs"
    outputs.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="agent-eval-") as temporary:
        project = Path(temporary)
        agent = parse_agent(agent_path)
        installed = project / ".agents" / "agents" / f"{agent.name}.md"
        installed.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(agent_path, installed)

        prompt = (
            f"Delegate this task to the custom agent named {agent.name}. "
            "Return only the delegated agent's final task result, without discussing the delegation.\n\n"
            f"Task:\n{case['prompt']}"
        )
        command = [
            *goose_command,
            "run",
            "--no-session",
            "--quiet",
            "--output-format",
            "json",
            "--max-turns",
            str(max_turns),
            "--text",
            prompt,
        ]
        if model:
            command.extend(["--model", model])

        started = time.monotonic()
        result = subprocess.run(
            command,
            cwd=project,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        duration = time.monotonic() - started
        if result.returncode != 0:
            raise RuntimeError(
                f"Goose failed for eval {eval_id}/{configuration}: {result.stderr.strip()}"
            )
        try:
            document = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"Goose returned invalid JSON: {error}") from error

    output_text = extract_assistant_text(document)
    (outputs / "response.md").write_text(output_text + "\n", encoding="utf-8")
    (run_dir / "transcript.json").write_text(json.dumps(document, indent=2) + "\n")
    metadata = document.get("metadata", {})
    timing = {
        "total_tokens": metadata.get("total_tokens", 0),
        "total_duration_seconds": round(duration, 3),
    }
    (run_dir / "timing.json").write_text(json.dumps(timing, indent=2) + "\n")
    return {"eval_id": eval_id, "configuration": configuration, **timing}


def validate_eval_set(document: dict) -> list[dict]:
    if not isinstance(document, dict) or not isinstance(document.get("evals"), list):
        raise ValueError("Eval set must be an object containing an 'evals' list")
    cases = document["evals"]
    seen = set()
    for case in cases:
        if not isinstance(case, dict):
            raise ValueError("Each eval must be an object")
        if not isinstance(case.get("id"), (str, int)) or case["id"] in seen:
            raise ValueError("Each eval must have a unique string or integer id")
        seen.add(case["id"])
        if not isinstance(case.get("prompt"), str) or not case["prompt"].strip():
            raise ValueError(f"Eval {case['id']} must have a non-empty prompt")
        assertions = case.get("assertions", [])
        if not isinstance(assertions, list) or not all(isinstance(item, str) for item in assertions):
            raise ValueError(f"Eval {case['id']} assertions must be a list of strings")
    return cases


def main():
    parser = argparse.ArgumentParser(description="Run paired Goose custom-agent evaluations")
    parser.add_argument("--agent", required=True, help="Custom-agent Markdown file")
    parser.add_argument("--eval-set", required=True, help="Agent eval JSON file")
    parser.add_argument("--workspace", required=True, help="Output workspace")
    parser.add_argument("--baseline-agent", default=None, help="Optional old/baseline agent file")
    parser.add_argument("--goose-cli", default=os.environ.get("AGENT_CREATOR_GOOSE_CLI", "goose"))
    parser.add_argument("--model", default=None, help="Optional controller model override")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--max-turns", type=int, default=20)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()

    agent_path = Path(args.agent).expanduser().resolve()
    agent = parse_agent(agent_path)
    cases = validate_eval_set(json.loads(Path(args.eval_set).read_text(encoding="utf-8")))
    workspace = Path(args.workspace).expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)

    for case in cases:
        eval_dir = workspace / f"eval-{case['id']}"
        eval_dir.mkdir(parents=True, exist_ok=True)
        (eval_dir / "eval_metadata.json").write_text(
            json.dumps(
                {
                    "eval_id": case["id"],
                    "eval_name": case.get("name", str(case["id"])),
                    "prompt": case["prompt"],
                    "assertions": case.get("assertions", []),
                },
                indent=2,
            )
            + "\n"
        )

    with tempfile.TemporaryDirectory(prefix="agent-baseline-") as temporary:
        if args.baseline_agent:
            baseline_path = Path(args.baseline_agent).expanduser().resolve()
            parse_agent(baseline_path)
            baseline_configuration = "old_agent"
        else:
            baseline_name = f"{agent.name}-baseline"
            baseline_path = Path(temporary) / f"{baseline_name}.md"
            baseline_path.write_text(baseline_agent(agent, baseline_name), encoding="utf-8")
            baseline_configuration = "without_agent_instructions"

        jobs = []
        for case in cases:
            jobs.append((case, "with_agent", agent_path))
            jobs.append((case, baseline_configuration, baseline_path))

        results = []
        command = tuple(shlex.split(args.goose_cli))
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [
                executor.submit(
                    run_case,
                    case,
                    configuration,
                    path,
                    workspace,
                    command,
                    args.model,
                    args.timeout,
                    args.max_turns,
                )
                for case, configuration, path in jobs
            ]
            for future in as_completed(futures):
                results.append(future.result())
                result = results[-1]
                print(
                    f"Completed eval {result['eval_id']} / {result['configuration']} "
                    f"({result['total_duration_seconds']}s)"
                )

    summary = {
        "agent": agent.name,
        "agent_path": str(agent_path),
        "eval_count": len(cases),
        "configurations": ["with_agent", baseline_configuration],
        "runs": sorted(results, key=lambda value: (str(value["eval_id"]), value["configuration"])),
    }
    (workspace / "run_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(workspace)


if __name__ == "__main__":
    main()
