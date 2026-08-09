#!/usr/bin/env python3

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.runners import RunnerError, create_runner
from scripts.runners.goose import GooseRunner


class RunnerTest(unittest.TestCase):
    def test_default_runner_is_goose(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsInstance(create_runner(), GooseRunner)

    def test_environment_selects_runner(self):
        with patch.dict(os.environ, {"SKILL_CREATOR_RUNNER": "goose"}, clear=True):
            self.assertIsInstance(create_runner(), GooseRunner)

    def test_unknown_runner_fails(self):
        with self.assertRaisesRegex(RunnerError, "Unsupported runner"):
            create_runner("unknown")

    def test_goose_commands(self):
        runner = GooseRunner("/opt/goose --profile eval")
        self.assertEqual(
            runner._text_command("model-id"),
            [
                "/opt/goose",
                "--profile",
                "eval",
                "run",
                "--no-session",
                "--quiet",
                "--output-format",
                "text",
                "--instructions",
                "-",
                "--model",
                "model-id",
            ],
        )
        stream = runner._stream_command("query", None)
        self.assertEqual(stream[-2:], ["--text", "query"])
        self.assertIn("stream-json", stream)

    def test_goose_detects_loaded_skill(self):
        runner = GooseRunner()
        event = {
            "type": "message",
            "message": {
                "content": [
                    {
                        "type": "toolRequest",
                        "toolCall": {
                            "value": {
                                "name": "skills__load_skill",
                                "arguments": {"name": "review"},
                            }
                        },
                    }
                ]
            },
        }
        self.assertTrue(runner.event_loaded_skill(event, "review"))
        self.assertIsNone(runner.event_loaded_skill({"type": "message", "message": {}}, "review"))
        self.assertFalse(runner.event_loaded_skill({"type": "complete"}, "review"))


if __name__ == "__main__":
    unittest.main()
