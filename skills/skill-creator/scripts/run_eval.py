#!/usr/bin/env python3
"""Evaluate whether a compatible agent loads a skill for a set of queries."""

import argparse
import json
import os
import select
import shutil
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from scripts.runners import RunnerError, create_runner
from scripts.utils import parse_skill_md


def find_project_root() -> Path:
    """Find the nearest project root using portable agent conventions."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".agents").is_dir() or (parent / "AGENTS.md").is_file():
            return parent
        if (parent / ".git").exists():
            return parent
    return current


def _ignore_generated(_directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name == "__pycache__" or name.endswith(".pyc")}


def _copy_skill(skill_path: Path, project_root: Path) -> tuple[Path, str]:
    """Copy a skill into an isolated project's canonical .agents/skills path."""
    name, _, _ = parse_skill_md(skill_path)
    target = project_root / ".agents" / "skills" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(skill_path, target, ignore=_ignore_generated)
    return target, name


def run_single_query(
    query: str,
    skill_path: str,
    timeout: int,
    model: str | None = None,
    runner: str | None = None,
) -> bool:
    """Run one query in an isolated project and report whether the skill loaded."""
    source = Path(skill_path).resolve()
    with tempfile.TemporaryDirectory(prefix="skill-trigger-eval-") as tmp:
        project_root = Path(tmp)
        _, skill_name = _copy_skill(source, project_root)
        process = create_runner(runner).start_stream(query, model, project_root)
        if process.stdout is None:
            raise RunnerError("Runner did not expose stdout")

        start_time = time.time()
        buffer = ""
        try:
            while time.time() - start_time < timeout:
                if process.poll() is not None:
                    remaining = process.stdout.read()
                    if remaining:
                        buffer += remaining.decode("utf-8", errors="replace")
                    break

                ready, _, _ = select.select([process.stdout], [], [], 1.0)
                if not ready:
                    continue
                chunk = os.read(process.stdout.fileno(), 8192)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", errors="replace")

                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    decision = create_runner(runner).event_loaded_skill(event, skill_name)
                    if decision is not None:
                        return decision

            if buffer.strip():
                try:
                    event = json.loads(buffer)
                    decision = create_runner(runner).event_loaded_skill(event, skill_name)
                    if decision is not None:
                        return decision
                except json.JSONDecodeError:
                    pass
            return False
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def run_eval(
    eval_set: list[dict],
    skill_path: Path,
    num_workers: int,
    timeout: int,
    runs_per_query: int = 1,
    trigger_threshold: float = 0.5,
    model: str | None = None,
    runner: str | None = None,
    description: str | None = None,
) -> dict:
    """Run the full eval set and return aggregate results."""
    name, original_description, _ = parse_skill_md(skill_path)
    description = description or original_description
    results = []

    with tempfile.TemporaryDirectory(prefix="skill-description-") as tmp:
        staged_skill = Path(tmp) / skill_path.name
        shutil.copytree(skill_path, staged_skill, ignore=_ignore_generated)
        skill_md = staged_skill / "SKILL.md"
        content = skill_md.read_text()
        if original_description != description:
            lines = content.splitlines()
            frontmatter_end = next(
                (index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"),
                None,
            )
            if frontmatter_end is None:
                raise ValueError("Could not locate the SKILL.md frontmatter")
            description_index = next(
                (
                    index
                    for index, line in enumerate(lines[1:frontmatter_end], start=1)
                    if line.startswith("description:")
                ),
                None,
            )
            if description_index is None:
                raise ValueError("Could not locate the SKILL.md description for evaluation")
            description_end = description_index + 1
            if lines[description_index].split(":", 1)[1].strip() in (">", "|", ">-", "|-"):
                while description_end < frontmatter_end and lines[description_end].startswith(("  ", "\t")):
                    description_end += 1
            escaped_description = description.replace("'", "''")
            lines[description_index:description_end] = [f"description: '{escaped_description}'"]
            skill_md.write_text("\n".join(lines))

        with ProcessPoolExecutor(max_workers=num_workers) as executor:
            future_to_item = {}
            for item in eval_set:
                for _ in range(runs_per_query):
                    future = executor.submit(
                        run_single_query,
                        item["query"],
                        str(staged_skill),
                        timeout,
                        model,
                        runner,
                    )
                    future_to_item[future] = item

            query_triggers: dict[str, list[bool]] = {}
            query_items: dict[str, dict] = {}
            for future in as_completed(future_to_item):
                item = future_to_item[future]
                query = item["query"]
                query_items[query] = item
                query_triggers.setdefault(query, [])
                try:
                    query_triggers[query].append(future.result())
                except Exception as error:
                    print(f"Warning: query failed: {error}", file=sys.stderr)
                    query_triggers[query].append(False)

    for query, triggers in query_triggers.items():
        item = query_items[query]
        trigger_rate = sum(triggers) / len(triggers)
        should_trigger = item["should_trigger"]
        did_pass = trigger_rate >= trigger_threshold if should_trigger else trigger_rate < trigger_threshold
        results.append({
            "query": query,
            "should_trigger": should_trigger,
            "trigger_rate": trigger_rate,
            "triggers": sum(triggers),
            "runs": len(triggers),
            "pass": did_pass,
        })

    passed = sum(1 for result in results if result["pass"])
    return {
        "skill_name": name,
        "description": description,
        "results": results,
        "summary": {"total": len(results), "passed": passed, "failed": len(results) - passed},
    }


def main():
    parser = argparse.ArgumentParser(description="Run skill trigger evaluation")
    parser.add_argument("--eval-set", required=True, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument("--description", default=None, help="Override description to test")
    parser.add_argument("--num-workers", type=int, default=4, help="Number of parallel workers")
    parser.add_argument("--timeout", type=int, default=60, help="Timeout per query in seconds")
    parser.add_argument("--runs-per-query", type=int, default=3, help="Number of runs per query")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger rate threshold")
    parser.add_argument("--model", default=None, help="Model override passed to the runner")
    parser.add_argument("--runner", choices=["goose"], default=None, help="Evaluation runner (default: SKILL_CREATOR_RUNNER or goose)")
    parser.add_argument("--verbose", action="store_true", help="Print progress to stderr")
    args = parser.parse_args()

    eval_set = json.loads(Path(args.eval_set).read_text())
    skill_path = Path(args.skill_path).resolve()
    if not (skill_path / "SKILL.md").exists():
        parser.error(f"No SKILL.md found at {skill_path}")

    try:
        output = run_eval(
            eval_set=eval_set,
            skill_path=skill_path,
            description=args.description,
            num_workers=args.num_workers,
            timeout=args.timeout,
            runs_per_query=args.runs_per_query,
            trigger_threshold=args.trigger_threshold,
            model=args.model,
            runner=args.runner,
        )
    except (RunnerError, ValueError) as error:
        parser.error(str(error))

    if args.verbose:
        summary = output["summary"]
        print(f"Results: {summary['passed']}/{summary['total']} passed", file=sys.stderr)
        for result in output["results"]:
            status = "PASS" if result["pass"] else "FAIL"
            print(
                f"  [{status}] rate={result['triggers']}/{result['runs']} "
                f"expected={result['should_trigger']}: {result['query'][:70]}",
                file=sys.stderr,
            )
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
