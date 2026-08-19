# Repository instructions

This repository maintains the Goose custom-agent creator skill.

- Treat `references/custom-agents.md` as the vendored source of truth.
- Scope generated definitions to `.agents/agents`.
- Do not generate skills, plugins, or recipes from this creator.
- Support only `name`, `description`, and `model` frontmatter unless the Goose source-of-truth documentation changes.
- Keep agents role-focused; move workflows and runtime configuration to the proper abstraction.
- Run `npm run build` (TypeScript compile) after script changes.
- Run `npm test` before release.
- Test project installation only in temporary directories; do not mutate live user agent files during automated tests.
