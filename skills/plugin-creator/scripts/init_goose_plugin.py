#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def main():
    p = argparse.ArgumentParser(description="Create a minimal Goose/Open Plugins scaffold")
    p.add_argument("name")
    p.add_argument("--path", default=".")
    p.add_argument("--description", default=None)
    p.add_argument("--version", default="0.1.0")
    p.add_argument("--skill", action="append", default=[])
    p.add_argument("--with-hooks", action="store_true")
    args = p.parse_args()

    if not NAME_RE.match(args.name):
        raise SystemExit("Plugin name must be lowercase kebab-case")

    root = Path(args.path).expanduser().resolve() / args.name
    if root.exists() and any(root.iterdir()):
        raise SystemExit(f"Refusing to overwrite non-empty directory: {root}")
    root.mkdir(parents=True, exist_ok=True)

    manifest = {
        "name": args.name,
        "version": args.version,
        "description": args.description or f"Reusable goose workflows for {args.name}",
    }
    (root / "plugin.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    skill_names = args.skill or [args.name]
    for skill_name in skill_names:
        if not NAME_RE.match(skill_name):
            raise SystemExit(f"Invalid skill name: {skill_name}")
        d = root / "skills" / skill_name
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(
            "---\n"
            f"name: {skill_name}\n"
            f"description: TODO describe what {skill_name} does and the concrete requests that should trigger it\n"
            "---\n\n"
            f"# {skill_name.replace('-', ' ').title()}\n\n"
            "1. TODO define the workflow.\n"
            "2. TODO define verification steps.\n",
            encoding="utf-8",
        )

    if args.with_hooks:
        (root / "hooks").mkdir(parents=True, exist_ok=True)
        (root / "scripts").mkdir(parents=True, exist_ok=True)
        (root / "hooks" / "hooks.json").write_text(
            json.dumps({"hooks": {}}, indent=2) + "\n", encoding="utf-8"
        )

    print(root)


if __name__ == "__main__":
    main()
