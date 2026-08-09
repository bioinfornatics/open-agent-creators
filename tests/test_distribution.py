#!/usr/bin/env python3

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_NAME = "open-agent-creators"
EXPECTED_SKILLS = {
    "skill-creator",
    "agent-creator",
    "hook-creator",
    "plugin-creator",
}


class DistributionTest(unittest.TestCase):
    def test_open_plugins_manifest(self):
        manifest = json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["name"], PLUGIN_NAME)
        self.assertRegex(manifest["version"], r"^\d+\.\d+\.\d+$")
        self.assertTrue(manifest["description"].strip())

    def test_skills_are_self_contained_and_named_by_directory(self):
        found = set()
        for skill_file in sorted((ROOT / "skills").glob("*/SKILL.md")):
            text = skill_file.read_text(encoding="utf-8")
            match = re.search(r"^name:\s*([^\n]+)$", text, re.MULTILINE)
            self.assertIsNotNone(match, skill_file)
            name = match.group(1).strip().strip("'\"")
            self.assertEqual(name, skill_file.parent.name)
            found.add(name)
        self.assertEqual(found, EXPECTED_SKILLS)

    def test_plugin_creator_routes_to_qualified_names_with_fallbacks(self):
        text = (ROOT / "skills" / "plugin-creator" / "SKILL.md").read_text(encoding="utf-8")
        for name in ("skill-creator", "hook-creator", "agent-creator"):
            self.assertIn(f"{PLUGIN_NAME}:{name}", text)
            self.assertIn(f"`{name}`", text)

    def test_documentation_recommends_plugin_install(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn(
            "goose plugin install https://github.com/bioinfornatics/open-agent-creators.git",
            readme,
        )
        for name in EXPECTED_SKILLS:
            self.assertIn(f"{PLUGIN_NAME}:{name}", readme)


if __name__ == "__main__":
    unittest.main()
