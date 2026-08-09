#!/usr/bin/env python3

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from hook_format import validate_hooks


class HookToolsTest(unittest.TestCase):
    def make_plugin(self, root: Path) -> Path:
        plugin = root / "demo-plugin"
        plugin.mkdir()
        (plugin / "plugin.json").write_text(
            json.dumps({"name": "demo-plugin", "version": "1.0.0", "description": "Demo"})
        )
        return plugin

    def test_scaffold_and_validate(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin = self.make_plugin(Path(tmp))
            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "init_hook.py"),
                    str(plugin),
                    "PostToolUse",
                    "record-tool",
                    "--matcher",
                    "developer__shell",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            result = validate_hooks(plugin)
            self.assertEqual(result.errors, [])
            self.assertTrue((plugin / "scripts" / "record-tool.sh").stat().st_mode & 0o111)

    def test_rejects_unknown_event_and_bare_star(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin = self.make_plugin(Path(tmp))
            (plugin / "hooks").mkdir()
            (plugin / "hooks" / "hooks.json").write_text(json.dumps({
                "hooks": {
                    "SubagentStart": [{
                        "matcher": "*",
                        "hooks": [{"command": "echo hi"}],
                    }],
                },
            }))
            errors = validate_hooks(plugin).errors
            self.assertTrue(any("Unsupported hook event" in error for error in errors))
            self.assertTrue(any("invalid regex" in error for error in errors))

    def test_rejects_missing_plugin_relative_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin = self.make_plugin(Path(tmp))
            (plugin / "hooks").mkdir()
            (plugin / "hooks" / "hooks.json").write_text(json.dumps({
                "hooks": {
                    "PreToolUse": [{
                        "hooks": [{
                            "type": "command",
                            "command": "${PLUGIN_ROOT}/scripts/missing.sh",
                            "timeout": 5,
                        }],
                    }],
                },
            }))
            errors = validate_hooks(plugin).errors
            self.assertTrue(any("does not exist" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
