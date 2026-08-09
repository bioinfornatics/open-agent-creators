# Hook Creator

Creates and validates Goose/Open Plugins lifecycle-hook components.

Hooks belong inside a plugin:

```text
<plugin>/
├── plugin.json
├── hooks/hooks.json
└── scripts/handler.sh
```

The source of truth is Goose's
[`guides/context-engineering/hooks`](https://goose-docs.ai/docs/guides/context-engineering/hooks),
vendored as `references/hooks.md`.

## Create

```bash
python scripts/init_hook.py /path/to/plugin PostToolUse record-tool \
  --matcher 'developer__shell' \
  --timeout 10
```

## Validate

```bash
python scripts/validate_hook.py /path/to/plugin
```

## Scope

- Hook creation and hook-specific testing: this skill.
- Complete plugin assembly and packaging: `plugin-creator`.
- Skills: `skill-creator`.
- Custom agents: `agent-creator`.
