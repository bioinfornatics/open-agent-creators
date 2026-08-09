#!/usr/bin/env python3
"""Install a validated Goose custom agent at project or user scope."""

import argparse
import shutil
from pathlib import Path

from agent_format import parse_agent


def main():
    parser = argparse.ArgumentParser(description="Install a Goose custom-agent file")
    parser.add_argument("agent_file")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--project", help="Project root for .agents/agents installation")
    scope.add_argument("--global", dest="global_scope", action="store_true")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing agent")
    args = parser.parse_args()

    source = Path(args.agent_file).expanduser().resolve()
    try:
        agent = parse_agent(source)
    except ValueError as error:
        parser.error(str(error))

    if args.global_scope:
        destination_dir = Path.home() / ".agents" / "agents"
    else:
        destination_dir = Path(args.project).expanduser().resolve() / ".agents" / "agents"
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{agent.name}.md"

    if destination.exists() and not args.force:
        parser.error(f"Refusing to overwrite existing agent: {destination}; pass --force to replace it")
    shutil.copy2(source, destination)
    print(destination)


if __name__ == "__main__":
    main()
