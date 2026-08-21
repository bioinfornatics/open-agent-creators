# Goose Plugin Format Reference

Use this reference when creating, porting, auditing, or packaging a goose plugin.

## Core model

Goose plugins package reusable components such as Agent Skills and hooks. Git-backed plugins can be installed with `goose plugin install <URL>` and updated by plugin name.

Installed git-backed plugins are stored under `~/.agents/plugins/<plugin-name>/`.

Local plugins may also live at:

- user scope: `~/.agents/plugins/<plugin-name>/`
- project scope: `<project>/.agents/plugins/<plugin-name>/`

## Minimal plugin

```text
my-plugin/
├── plugin.json
└── skills/
    └── review/
        └── SKILL.md
```

Minimal `plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "Reusable goose workflows for my project"
}
```

Keep plugin names lowercase and repository-friendly. Prefer semantic versions.

## Skills inside plugins

Plugin-provided Agent Skills live under `skills/<skill-name>/SKILL.md`.

A Skill requires YAML frontmatter:

```markdown
---
name: review
description: Review a change using the project checklist and required verification steps
---

# Review

1. Inspect the changed files.
2. Check correctness and security.
3. Run the relevant tests.
4. Report blocking findings first.
```

For Open Plugins, goose exposes plugin skills with a plugin namespace such as `my-plugin:review` when explicitly loaded.

Supporting files can live beside the Skill entrypoint, for example:

```text
skills/review/
├── SKILL.md
├── references/
│   └── policy.md
└── scripts/
    └── verify.py
```

## Plugin + hooks

```text
my-plugin/
├── plugin.json
├── hooks/
│   └── hooks.json
└── scripts/
    └── command.sh
```

See `goose-hooks.md` for the hook schema and event rules.

## Runtime dependencies

A plugin can depend on capabilities that are not contained in the plugin itself, such as:

- goose Developer extension
- browser or Playwright MCP server
- GitHub MCP server
- external CLI
- API key or other environment variable

Document these dependencies. Do not encode secrets in files.

## Git-backed installation

Typical commands:

```bash
goose plugin install https://github.com/example/my-goose-plugin.git
goose plugin install --auto-update https://github.com/example/my-goose-plugin.git
goose plugin update my-goose-plugin
```

## Porting another plugin ecosystem

Map source concepts explicitly:

| Source component | Goose target |
|---|---|
| Agent Skill / `SKILL.md` | `skills/<name>/SKILL.md` |
| Codex/OpenAI plugin manifest | root `plugin.json` plus documented dependencies |
| lifecycle hook | `hooks/hooks.json` + command script |
| tool binding / connector | goose extension or MCP dependency |
| static template / asset | keep with relevant Skill or plugin resource |
| source-specific app UI | usually requires replacement; do not claim direct compatibility |
| source custom agent | optional goose custom agent, only if role-level config is genuinely needed |

Always distinguish file-format compatibility from runtime-tool compatibility.

## Scope boundary

This creator manages complete plugins under `.agents/plugins/`. A plugin may
bundle skills under its own `skills/` directory because those skills are plugin
components. Standalone skills in `.agents/skills/` and standalone agent
definitions in `.agents/agents/` are outside this creator's scope.

## MCP servers

Goose loads a default `.mcp.json` from the plugin root. The document uses an
`mcpServers` object:

```json
{
  "mcpServers": {
    "database": {
      "command": "${PLUGIN_ROOT}/servers/database",
      "args": ["--stdio"],
      "env": {"DB_PATH": "${PLUGIN_ROOT}/data"},
      "cwd": "${PLUGIN_ROOT}"
    }
  }
}
```

The manifest may also declare `mcpServers` inline or provide component paths.
Component paths must begin with `./` and remain inside the plugin. Never put
credentials directly in the manifest or `.mcp.json`; document required
environment variables instead.

## Agent Plugins 1.0.0 schema validation

The deterministic schema snapshot is stored under `references/agent-plugins-1.0.0/`.
Validate without network access:

```bash
node dist/scripts/validate_agent_plugin_schema.js <plugin-directory> --format json
```

The validator discovers `plugin.json` and `mcp.json` or `.mcp.json`, emits stable
JSON diagnostics, and exits 0 for valid, 1 for invalid, and 2 for usage errors.
Schema conformance and Goose operational validation are separate required checks.
