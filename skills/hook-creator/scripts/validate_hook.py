#!/usr/bin/env python3
"""Validate the hook component of a Goose/Open Plugins plugin."""

import argparse
from pathlib import Path

from hook_format import validate_hooks


def main():
    parser = argparse.ArgumentParser(description="Validate Goose plugin hooks")
    parser.add_argument("plugin_dir")
    args = parser.parse_args()
    root = Path(args.plugin_dir).expanduser().resolve()
    result = validate_hooks(root)
    for warning in result.warnings:
        print(f"WARNING: {warning}")
    if result.errors:
        for error in result.errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)
    print(f"OK: {root / 'hooks' / 'hooks.json'}")


if __name__ == "__main__":
    main()
