# Repository instructions

This monorepo maintains independent open-format-first creator skills, with Goose as the reference runtime.

- Treat the repository root as an Open Plugins distribution and keep `plugin.json` valid.
- Keep each directory under `skills/` independently installable.
- Never reference runtime files outside a skill's own directory.
- Route by responsibility: skills → `open-agent-creators:skill-creator`, agents → `open-agent-creators:agent-creator`, hooks → `open-agent-creators:hook-creator`, whole plugins → `open-agent-creators:plugin-creator`; accept unqualified names for standalone installations.
- Plugin-creator orchestrates but does not duplicate specialized authoring logic.
- Treat vendored documentation in each creator's `references/` directory as its recorded source-of-truth snapshot.
- Refresh snapshots from upstream before changing a public format contract.
- Each creator is TypeScript compiled to `dist/`; run `npm run build && npm test` in each creator's directory before release, and keep runtime `node_modules` vendored (no network dependency at install time).
- Do not mutate live `~/.agents` directories in automated tests.
