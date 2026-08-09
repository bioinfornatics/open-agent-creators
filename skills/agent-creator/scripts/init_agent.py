#!/usr/bin/env python3
"""Create a minimal Goose custom-agent definition."""

import argparse
from pathlib import Path

from agent_format import NAME_RE, render_agent


def main():
    parser = argparse.ArgumentParser(description="Create a Goose custom-agent file")
    parser.add_argument("name")
    parser.add_argument("--path", default=".", help="Output directory")
    parser.add_argument("--description", default=None)
    parser.add_argument("--model", default=None)
    parser.add_argument("--role", default=None, help="Initial instruction body")
    args = parser.parse_args()

    if not NAME_RE.fullmatch(args.name) or len(args.name) > 64:
        parser.error("Agent name must be lowercase kebab-case and at most 64 characters")

    output_dir = Path(args.path).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{args.name}.md"
    if output.exists():
        parser.error(f"Refusing to overwrite existing file: {output}")

    body = args.role or (
        f"You are the {args.name.replace('-', ' ')} specialist.\n\n"
        "Define the role's priorities, boundaries, verification expectations, and output style."
    )
    output.write_text(
        render_agent(args.name, args.description, args.model, body),
        encoding="utf-8",
    )
    print(output)


if __name__ == "__main__":
    main()
