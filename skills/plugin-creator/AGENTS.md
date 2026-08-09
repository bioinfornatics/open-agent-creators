# Repository instructions

This repository maintains the Goose/Open Plugins creator skill.

- Scope generated artifacts to plugins installed under `.agents/plugins`.
- Do not generate standalone `.agents/skills` or `.agents/agents` assets.
- Bundled skills under a plugin's `skills/` directory are in scope.
- Treat hooks as executable security-sensitive code.
- Keep Goose-specific behavior explicit and source-verified.
- Preserve portable components when migrating another plugin ecosystem.
- Run `python -m py_compile scripts/*.py` after Python changes.
- Run the validator's automated tests and a package smoke test before release.
