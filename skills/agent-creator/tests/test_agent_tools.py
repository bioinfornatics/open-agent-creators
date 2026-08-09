#!/usr/bin/env python3

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from agent_format import parse_agent, render_agent


class AgentToolsTest(unittest.TestCase):
    def write_agent(self, directory: Path, name: str = "code-reviewer") -> Path:
        path = directory / f"{name}.md"
        path.write_text(
            render_agent(
                name,
                "Reviews code for correctness and risk",
                "test-model",
                "You are a senior code reviewer. Prioritize correctness and security.",
            ),
            encoding="utf-8",
        )
        return path

    def test_parses_valid_agent(self):
        with tempfile.TemporaryDirectory() as tmp:
            agent = parse_agent(self.write_agent(Path(tmp)))
            self.assertEqual(agent.name, "code-reviewer")
            self.assertEqual(agent.model, "test-model")
            self.assertTrue(agent.body)

    def test_rejects_unsupported_frontmatter(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reviewer.md"
            path.write_text(
                "---\nname: reviewer\ntools: shell\n---\n\nReview code.\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "Unsupported frontmatter"):
                parse_agent(path)

    def test_rejects_empty_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reviewer.md"
            path.write_text("---\nname: reviewer\n---\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "body must not be empty"):
                parse_agent(path)

    def test_project_install_uses_canonical_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_dir = root / "source"
            source_dir.mkdir()
            source = self.write_agent(source_dir)
            project = root / "project"
            project.mkdir()
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "install_agent.py"),
                    str(source),
                    "--project",
                    str(project),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            expected = project / ".agents" / "agents" / "code-reviewer.md"
            self.assertEqual(Path(result.stdout.strip()), expected)
            self.assertTrue(expected.is_file())
            self.assertEqual(parse_agent(expected).name, "code-reviewer")

    def test_install_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.write_agent(root)
            project = root / "project"
            command = [
                sys.executable,
                str(SCRIPTS / "install_agent.py"),
                str(source),
                "--project",
                str(project),
            ]
            subprocess.run(command, check=True, capture_output=True, text=True)
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Refusing to overwrite", result.stderr)

    def test_eval_set_validation_and_output_extraction(self):
        from run_agent_eval import extract_assistant_text, validate_eval_set

        cases = validate_eval_set({
            "evals": [{"id": 1, "prompt": "Review this", "assertions": ["contains: risk"]}]
        })
        self.assertEqual(cases[0]["id"], 1)
        text = extract_assistant_text({
            "messages": [
                {"role": "assistant", "content": [{"type": "text", "text": "Found a risk"}]}
            ]
        })
        self.assertEqual(text, "Found a risk")

    def test_deterministic_eval_grading(self):
        from grade_agent_eval import deterministic_grade

        self.assertEqual(deterministic_grade("contains: security", "Security issue"), (True, "Expected response to contain: 'security'"))
        self.assertEqual(deterministic_grade("not-contains: safe", "unsafe change")[0], False)
        self.assertTrue(deterministic_grade(r"regex: risk\s+found", "risk found")[0])
        self.assertIsNone(deterministic_grade("Explains the root cause", "response"))


if __name__ == "__main__":
    unittest.main()
