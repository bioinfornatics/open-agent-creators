#!/usr/bin/env python3
"""Validate and package a Goose/Open Plugins directory."""

import argparse
import subprocess
import sys
import time
import zipfile
from pathlib import Path

EXCLUDED_PARTS = {".git", ".hg", ".svn", "__pycache__", "node_modules"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo"}
ZIP_EPOCH = 315532800


def should_exclude(path: Path, root: Path) -> bool:
    relative = path.relative_to(root)
    return any(part in EXCLUDED_PARTS for part in relative.parts) or path.suffix in EXCLUDED_SUFFIXES


def add_file(archive: zipfile.ZipFile, path: Path, archive_name: Path):
    if path.stat().st_mtime >= ZIP_EPOCH:
        archive.write(path, archive_name)
        return
    info = zipfile.ZipInfo(str(archive_name), time.localtime(ZIP_EPOCH)[:6])
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (path.stat().st_mode & 0xFFFF) << 16
    archive.writestr(info, path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description="Validate and package a Goose/Open Plugins directory")
    parser.add_argument("plugin_dir")
    parser.add_argument("output", nargs="?", default=None)
    args = parser.parse_args()

    root = Path(args.plugin_dir).expanduser().resolve()
    validator = Path(__file__).with_name("validate_goose_plugin.py")
    subprocess.run([sys.executable, str(validator), str(root)], check=True)

    output = Path(args.output).expanduser().resolve() if args.output else root.parent / f"{root.name}.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file() and not should_exclude(path, root) and path.resolve() != output:
                add_file(archive, path, Path(root.name) / path.relative_to(root))
    print(output)


if __name__ == "__main__":
    main()
