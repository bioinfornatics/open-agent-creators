# Repository instructions

This repository maintains a portable, vendor-neutral Agent Skill Creator.

- Use the Agent Skills `SKILL.md` specification for skills.
- Scope all generated artifacts to Agent Skills under `.agents/skills`; do not generate `.agents/agents` or `.agents/plugins` assets.
- Do not add `.claude` paths or `CLAUDE.md` except for explicitly requested compatibility documentation.
- Keep agent and plugin schemas host-aware; they are not part of the Agent Skills specification.
- Keep CLI-specific behavior isolated in `scripts/agent_cli.py`.
- Run `python -m py_compile scripts/*.py eval-viewer/generate_review.py` after Python changes.
- Run `python -m scripts.quick_validate .` after `SKILL.md` changes.
