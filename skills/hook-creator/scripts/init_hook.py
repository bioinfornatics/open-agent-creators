#!/usr/bin/env python3
"""Add a minimal hook rule and script to an existing plugin directory."""

import argparse
import json
import re
from pathlib import Path

from hook_format import HOOK_EVENTS

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def main():
    parser = argparse.ArgumentParser(description="Scaffold a Goose plugin hook")
    parser.add_argument("plugin_dir")
    parser.add_argument("event", choices=sorted(HOOK_EVENTS))
    parser.add_argument("name", help="Kebab-case handler name")
    parser.add_argument("--matcher", default=None)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    if not NAME_RE.fullmatch(args.name):
        parser.error("Handler name must be lowercase kebab-case")
    if args.matcher is not None:
        try:
            re.compile(args.matcher)
        except re.error as error:
            parser.error(f"Invalid matcher regex: {error}")
    if args.timeout <= 0:
        parser.error("Timeout must be positive")

    root = Path(args.plugin_dir).expanduser().resolve()
    manifest = root / "plugin.json"
    if not manifest.is_file():
        parser.error(f"Plugin manifest not found: {manifest}")

    hooks_path = root / "hooks" / "hooks.json"
    script_path = root / "scripts" / f"{args.name}.sh"
    if script_path.exists():
        parser.error(f"Refusing to overwrite existing script: {script_path}")

    hooks_path.parent.mkdir(parents=True, exist_ok=True)
    script_path.parent.mkdir(parents=True, exist_ok=True)
    if hooks_path.exists():
        try:
            document = json.loads(hooks_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            parser.error(f"Cannot update invalid hooks.json: {error}")
        if not isinstance(document.get("hooks"), dict):
            parser.error("Existing hooks.json must contain a top-level hooks object")
    else:
        document = {"hooks": {}}

    rule = {
        "hooks": [
            {
                "type": "command",
                "command": f"${{PLUGIN_ROOT}}/scripts/{args.name}.sh",
                "timeout": args.timeout,
            }
        ]
    }
    if args.matcher is not None:
        rule["matcher"] = args.matcher
    document["hooks"].setdefault(args.event, []).append(rule)
    hooks_path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    script_path.write_text(
        "#!/usr/bin/env sh\n"
        "set -eu\n"
        "payload=$(cat 2>/dev/null || printf '{}')\n"
        "# Implement trusted local automation using the JSON payload.\n"
        "printf '%s' \"$payload\" >/dev/null\n"
        "exit 0\n",
        encoding="utf-8",
    )
    script_path.chmod(script_path.stat().st_mode | 0o111)
    print(hooks_path)
    print(script_path)


if __name__ == "__main__":
    main()
