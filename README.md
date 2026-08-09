# Open Agent Creators

An open-format-first monorepo of focused authoring skills for agent ecosystems, with Goose as the initial reference runtime.

## Skills

| Creator | Responsibility | Primary target |
|---|---|---|
| `skill-creator` | Agent Skills authoring and evaluation | `.agents/skills/` |
| `agent-creator` | Reusable Goose role definitions | `.agents/agents/` |
| `hook-creator` | Plugin lifecycle hooks and handlers | `<plugin>/hooks/` |
| `plugin-creator` | Plugin architecture, MCP, assembly, validation, packaging | `.agents/plugins/` |

`plugin-creator` is the orchestrator for plugin components. It routes bundled
skills to `skill-creator`, hooks to `hook-creator`, and custom-agent work to
`agent-creator` only when the target host and plugin format explicitly support
that component.

## Installation

Each skill is self-contained and can be installed independently:

```bash
mkdir -p ~/.agents/skills
cp -R skills/skill-creator ~/.agents/skills/skill-creator
cp -R skills/agent-creator ~/.agents/skills/agent-creator
cp -R skills/hook-creator ~/.agents/skills/hook-creator
cp -R skills/plugin-creator ~/.agents/skills/plugin-creator
```

Do not make a skill depend on files outside its own directory. Cross-skill
coordination uses the host's skill-loading mechanism by name.

## Development

```bash
python -m py_compile skills/*/scripts/*.py skills/*/tests/*.py
python -m unittest discover -s skills/agent-creator/tests -v
python -m unittest discover -s skills/hook-creator/tests -v
python -m unittest discover -s skills/plugin-creator/tests -v
```

`skill-creator` has its own validator and packaging workflow documented in its
README.

## Sources of truth

- Skills: https://agentskills.io/specification
- Custom agents: Goose `guides/context-engineering/custom-agents`
- Hooks: https://goose-docs.ai/docs/guides/context-engineering/hooks
- Plugins: Goose's Open Plugins adapter and plugin documentation
