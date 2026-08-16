# Repository instructions

This monorepo maintains independent open-format-first creator skills, with Goose as the reference runtime.

- Treat the repository root as an Open Plugins distribution and keep `plugin.json` valid.
- Keep each directory under `skills/` independently installable.
- Never reference runtime files outside a skill's own directory.
- Route by responsibility: skills → `skill-creator`, agents → `agent-creator`, hooks → `hook-creator`, whole plugins → `plugin-creator`; accept unqualified names for standalone installations.
- Plugin-creator orchestrates but does not duplicate specialized authoring logic.
- Treat vendored documentation in each creator's `references/` directory as its recorded source-of-truth snapshot.
- Refresh snapshots from upstream before changing a public format contract.
- Run all Python compilation and test commands before release.
- Do not mutate live `~/.agents` directories in automated tests.
