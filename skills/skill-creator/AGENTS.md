# Repository instructions

This repository maintains a portable, vendor-neutral Agent Skill Creator.

- Use the Agent Skills `SKILL.md` specification for skills.
- Scope all generated artifacts to Agent Skills under `.agents/skills`; do not generate `.agents/agents` or `.agents/plugins` assets.
- Do not add `.claude` paths or `CLAUDE.md` except for explicitly requested compatibility documentation.
- Keep agent and plugin schemas host-aware; they are not part of the Agent Skills specification.
- Keep runner-specific behavior isolated in `scripts/runners/`.
- Run `npm run build` (TypeScript compile) after script changes.
- Run `node dist/scripts/quick_validate.js .` after `SKILL.md` changes.
