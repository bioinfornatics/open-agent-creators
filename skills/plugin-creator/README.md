# Plugin Creator

A dedicated creator for Goose/Open Plugins installed under `.agents/plugins/`.
It creates, ports, validates, tests, and packages plugins containing skills,
hooks, MCP server declarations, or combinations of these components.

## Scope

| Asset | Location | Managed here? |
|---|---|---|
| Plugins | `.agents/plugins/`, `~/.agents/plugins/` | Yes |
| Standalone skills | `.agents/skills/`, `~/.agents/skills/` | No — use `open-agent-creators:skill-creator` (or standalone `skill-creator`) |
| Standalone agents | `.agents/agents/`, `~/.agents/agents/` | No — use `open-agent-creators:agent-creator` (or standalone `agent-creator`) |
| Repository guidance | `AGENTS.md` | No — instructions only |

Bundled skills under `<plugin>/skills/` are managed because they are plugin
components. This does not make the project a general-purpose skill creator.

## Component routing

- Bundled skills route to `open-agent-creators:skill-creator` (or standalone `skill-creator`).
- Hooks and hook scripts route to `open-agent-creators:hook-creator` (or standalone `hook-creator`).
- Standalone custom agents route to `open-agent-creators:agent-creator` (or standalone `agent-creator`).
- Manifest, MCP, packaging, and whole-plugin validation stay in `open-agent-creators:plugin-creator` (or standalone `plugin-creator`).

The current Goose custom-agent contract uses `.agents/agents`; do not package an
`agents/` directory unless the selected target format explicitly supports it.

## Create a plugin

```bash
node dist/scripts/init_goose_plugin.js my-plugin \
  --path /tmp \
  --description "Reusable Goose workflows" \
  --skill my-workflow \
  --with-hooks
```

## Validate

```bash
node dist/scripts/validate_goose_plugin.js /path/to/my-plugin
```

The validator checks:

- `plugin.json` and component declarations;
- bundled `SKILL.md` files;
- hook events, matchers, actions, and referenced files;
- `.mcp.json` and MCP server definitions;
- plugin-relative paths and unresolved placeholders.

## Package

```bash
node dist/scripts/package_goose_plugin.js /path/to/my-plugin ./dist/my-plugin.zip
```

## Installation

```bash
goose plugin install https://github.com/example/my-plugin.git
```

For local development, place the plugin under the project or user
`.agents/plugins/` directory and start a new Goose session.

## Format status

The project targets Goose's Open Plugins adapter and the Open Plugins
conventions. Plugin manifests, hooks, and MCP runtime behavior are not part of
the Agent Skills specification. Host-specific behavior is documented as such.
