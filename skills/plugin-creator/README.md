# Plugin Creator

A dedicated creator for Goose/Open Plugins installed under `.agents/plugins/`.
It creates, ports, validates, tests, and packages plugins containing skills,
hooks, MCP server declarations, or combinations of these components.

## Scope

| Asset | Location | Managed here? |
|---|---|---|
| Plugins | `.agents/plugins/`, `~/.agents/plugins/` | Yes |
| Standalone skills | `.agents/skills/`, `~/.agents/skills/` | No — use `agent-plugins:skill-creator` (or standalone `skill-creator`) |
| Standalone agents | `.agents/agents/`, `~/.agents/agents/` | No — use `agent-plugins:agent-creator` (or standalone `agent-creator`) |
| Repository guidance | `AGENTS.md` | No — instructions only |

Bundled skills under `<plugin>/skills/` are managed because they are plugin
components. This does not make the project a general-purpose skill creator.

## Component routing

- Bundled skills route to `agent-plugins:skill-creator` (or standalone `skill-creator`).
- Hooks and hook scripts route to `agent-plugins:hook-creator` (or standalone `hook-creator`).
- Standalone custom agents route to `agent-plugins:agent-creator` (or standalone `agent-creator`).
- Manifest, MCP, packaging, and whole-plugin validation stay in `agent-plugins:plugin-creator` (or standalone `plugin-creator`).

The current Goose custom-agent contract uses `.agents/agents`; do not package an
`agents/` directory unless the selected target format explicitly supports it.

## Unified CLI

Use `node dist/scripts/cli.js <init|validate|verify|package>`. All subcommands accept `--format text|json`, `--quiet`, and `--help`. Exit codes are `0` success, `1` failure, `2` usage, and `3` blocked. Packaging runs schema and structural validation.

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
# Agent Plugins 1.0.0 schema conformance (offline, machine-readable)
node dist/scripts/validate_agent_plugin_schema.js /path/to/my-plugin --format json

# Structural and Goose-specific operational checks
node dist/scripts/validate_goose_plugin.js /path/to/my-plugin
```

The validators check:

- `plugin.json` and component declarations;
- bundled `SKILL.md` files;
- hook events, matchers, actions, and referenced files;
- `.mcp.json` and MCP server definitions;
- plugin-relative paths and unresolved placeholders.

## Evaluate a complete plugin

Plugin evaluation goes beyond schema and structural validation. Load
`agent-plugins:plugin-creator` and request an evaluation; it coordinates the
specialized creators and requires traceable evidence before release.

```text
freeze baseline
  → evaluate every behaviorally changed Skill
  → run plugin integration scenarios
  → grade paired outputs
  → aggregate benchmark.json and benchmark.md
  → generate the HTML review viewer
  → verify component and plugin release gates
```

Integration scenarios should exercise routing between Skills, trigger overlap,
hook effects, and cross-component handoffs. Every changed Skill supplies its own
complete evaluation receipt. The plugin-level receipt records artifacts and
human-review status. Missing execution capabilities produce
`evaluation: blocked`; static validation or an ad-hoc comparison is not reported
as a successful behavioral evaluation.

Example Goose request:

```text
Load agent-plugins:plugin-creator and evaluate this plugin against the previous
release. Include Skill receipts, routing and hook integration scenarios, the
combined benchmark, release gates, and a static HTML review report.
```

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