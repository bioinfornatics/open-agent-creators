#!/usr/bin/env python3

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from validate_goose_plugin import validate


class PluginToolsTest(unittest.TestCase):
    def make_plugin(self, root: Path):
        plugin = root / "demo-plugin"
        (plugin / "skills" / "demo").mkdir(parents=True)
        (plugin / "plugin.json").write_text(
            json.dumps({
                "name": "demo-plugin",
                "version": "1.0.0",
                "description": "A test plugin",
            })
        )
        (plugin / "skills" / "demo" / "SKILL.md").write_text(
            "---\nname: demo\ndescription: Use this skill for demo tasks\n---\n\n# Demo\n"
        )
        return plugin

    def test_valid_skills_plugin(self):
        with tempfile.TemporaryDirectory() as tmp:
            errors, _ = validate(self.make_plugin(Path(tmp)))
            self.assertEqual(errors, [])

    def test_valid_hook_and_mcp_plugin(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin = Path(tmp) / "automation"
            (plugin / "hooks").mkdir(parents=True)
            (plugin / "scripts").mkdir()
            (plugin / "servers").mkdir()
            (plugin / "plugin.json").write_text(json.dumps({
                "name": "automation",
                "version": "1.0.0",
                "description": "Automation plugin",
            }))
            (plugin / "scripts" / "guard.sh").write_text("#!/bin/sh\nexit 0\n")
            (plugin / "servers" / "tool").write_text("#!/bin/sh\n")
            (plugin / "hooks" / "hooks.json").write_text(json.dumps({
                "hooks": {
                    "PreToolUse": [{
                        "matcher": ".*",
                        "hooks": [{
                            "type": "command",
                            "command": "${PLUGIN_ROOT}/scripts/guard.sh",
                            "timeout": 5,
                        }],
                    }],
                },
            }))
            (plugin / ".mcp.json").write_text(json.dumps({
                "mcpServers": {
                    "tool": {
                        "command": "${PLUGIN_ROOT}/servers/tool",
                        "args": ["--stdio"],
                        "env": {"MODE": "test"},
                    },
                },
            }))
            errors, _ = validate(plugin)
            self.assertEqual(errors, [])

    def test_rejects_bare_star_and_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin = Path(tmp) / "bad-plugin"
            (plugin / "hooks").mkdir(parents=True)
            (plugin / "plugin.json").write_text(json.dumps({
                "name": "bad-plugin",
                "version": "1.0.0",
                "description": "Bad plugin",
            }))
            (plugin / "hooks" / "hooks.json").write_text(json.dumps({
                "hooks": {
                    "PreToolUse": [{
                        "matcher": "*",
                        "hooks": [{"command": "${PLUGIN_ROOT}/scripts/missing.sh"}],
                    }],
                },
            }))
            errors, _ = validate(plugin)
            self.assertTrue(any("invalid regex" in error for error in errors))
            self.assertTrue(any("does not exist" in error for error in errors))

    def test_package_excludes_git_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            plugin = self.make_plugin(base)
            (plugin / ".git" / "objects").mkdir(parents=True)
            (plugin / ".git" / "config").write_text("secret metadata")
            output = base / "dist" / "plugin.zip"
            subprocess.run(
                [sys.executable, str(SCRIPTS / "package_goose_plugin.py"), str(plugin), str(output)],
                check=True,
                capture_output=True,
                text=True,
            )
            with zipfile.ZipFile(output) as archive:
                self.assertFalse(any("/.git/" in name for name in archive.namelist()))
                self.assertIsNone(archive.testzip())


if __name__ == "__main__":
    unittest.main()
