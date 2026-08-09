#!/usr/bin/env python3
"""Validate a Goose custom-agent Markdown file."""

import argparse
from pathlib import Path

from agent_format import parse_agent


def main():
    parser = argparse.ArgumentParser(description="Validate a Goose custom-agent file")
    parser.add_argument("agent_file")
    parser.add_argument(
        "--require-filename-match",
        action="store_true",
        help="Require the file stem to equal the frontmatter name",
    )
    args = parser.parse_args()
    path = Path(args.agent_file).expanduser().resolve()
    try:
        agent = parse_agent(path)
        if args.require_filename_match and path.stem != agent.name:
            raise ValueError(
                f"Agent filename '{path.name}' must match frontmatter name '{agent.name}.md'"
            )
    except ValueError as error:
        print(f"ERROR: {error}")
        raise SystemExit(1)
    print(f"OK: {agent.name} ({path})")


if __name__ == "__main__":
    main()
