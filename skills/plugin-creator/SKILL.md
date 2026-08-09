---
name: plugin-creator
description: Create, adapt, validate, test, and package Goose/Open Plugins under .agents/plugins. Use when asked to build or audit a plugin, migrate a plugin from another agent ecosystem, bundle skills, configure lifecycle hooks or MCP servers, or generate plugin.json, hooks/hooks.json, or .mcp.json. Do not use for standalone skills under .agents/skills or standalone agent definitions under .agents/agents.
---

# Plugin Creator

Create production-ready Goose/Open Plugins, not just example snippets. Keep the scope strictly within `.agents/plugins`: use the skill creator for standalone `.agents/skills` and an agent creator for standalone `.agents/agents`. Prefer the smallest valid plugin architecture that satisfies the request.

## Component routing

`plugin-creator` owns architecture, the plugin root, `plugin.json`, MCP declarations, cross-component validation, installation, and packaging. Route specialized component work before implementing it:

- Load `open-agent-creators:skill-creator` for every new or modified bundled skill under `<plugin>/skills/`; fall back to `skill-creator` when installed standalone.
- Load `open-agent-creators:hook-creator` for every new or modified `hooks/hooks.json` rule or hook command script; fall back to `hook-creator` when installed standalone.
- Load `open-agent-creators:agent-creator` only when the target host and plugin format explicitly support bundled agent components; fall back to `agent-creator` when installed standalone. Current Goose custom agents are discovered from `.agents/agents`; do not assume a plugin's `agents/` directory installs them.

Prefer loading the creator instructions into the current context when assembling one plugin. Delegate only when component work is isolated into disjoint files, and never let multiple delegates modify the same plugin files concurrently.

If a required creator is unavailable, state the limitation and follow its documented source of truth directly rather than inventing a schema.

## Workflow

1. Determine the requested plugin behavior from concrete examples.
   - Identify expected inputs.
   - Identify expected outputs or side effects.
   - Identify required external tools, MCP extensions, CLIs, APIs, or credentials.
   - If these are already clear from the request or surrounding context, do not ask again.

2. Classify the plugin before creating files:
   - **Skills-only plugin**: reusable instructions, workflows, references, templates, or helper scripts.
   - **Hook plugin**: needs lifecycle automation such as blocking a tool call, formatting after edits, logging, notifications, or validation.
   - **MCP plugin**: contributes one or more MCP server configurations.
   - **Hybrid plugin**: combines Skills, hooks, and/or MCP servers.
   - **Ported plugin**: adapts an existing plugin format to goose while preserving reusable content.

3. Consult `references/goose-plugin-format.md` for the canonical directory layout, manifest rules, skill discovery, and installation commands.

4. Route components to their specialized creators:
   - load `open-agent-creators:skill-creator` (or standalone `skill-creator`) before authoring bundled skills;
   - load `open-agent-creators:hook-creator` (or standalone `hook-creator`) before authoring hooks;
   - load `open-agent-creators:agent-creator` (or standalone `agent-creator`) only for an explicitly supported standalone-agent target.

   Use the local references as a fallback, not as a replacement for routing when the specialized creator is available.

5. Create the plugin with `scripts/init_goose_plugin.py` when starting from scratch. Do not hand-create the basic scaffold unless the script cannot be used.

6. Implement only the resources needed:
   - `plugin.json` at plugin root.
   - `skills/<skill-name>/SKILL.md` for reusable Agent Skills.
   - skill-local scripts, references, templates, or assets when they improve reliability.
   - `hooks/hooks.json` plus `scripts/` only when lifecycle behavior is explicitly needed.
   - `.mcp.json` or manifest `mcpServers` only when runtime tools are required.
   - Do not invent a standalone custom agent, recipe, MCP server, or hook when a Skill is sufficient.

7. After loading `open-agent-creators:skill-creator` or its standalone fallback, for every bundled Skill:
   - Require YAML frontmatter with only `name` and `description`.
   - Keep the name lowercase and concise.
   - Put triggering conditions in `description`, not in a body section named “When to use”.
   - Write direct, imperative instructions.
   - Keep the entrypoint focused; move large reference material into adjacent files.
   - Add explicit verification steps for deterministic workflows.

8. For external dependencies:
   - Separate **plugin contents** from **runtime prerequisites**.
   - Document required goose extensions/MCP servers, CLIs, environment variables, and credentials in the plugin README or relevant Skill.
   - Never place secrets or credentials in the plugin.
   - Do not imply a plugin manifest automatically installs an MCP extension unless current goose documentation explicitly supports that behavior.

9. For a port from another ecosystem:
   - Inventory source manifests, skills, agents, hooks, scripts, assets, templates, and tool bindings.
   - Preserve portable Agent Skills and generic assets whenever possible.
   - Replace ecosystem-specific manifest locations with root `plugin.json`.
   - Map source-specific tool names to goose capabilities or document the missing dependency.
   - Remove unsupported metadata only after preserving any behavior it encoded elsewhere.
   - Produce a compatibility table: `portable`, `adapt`, `replace`, or `unsupported`.

10. Validate before delivery:
    - Run `scripts/validate_goose_plugin.py <plugin-dir>`.
    - Validate JSON syntax for `plugin.json`, `hooks/hooks.json`, and `.mcp.json` when present.
    - Validate every `SKILL.md` frontmatter and name/path consistency.
    - Run the `open-agent-creators:hook-creator` validator or its standalone fallback for hooks, then check hook event names and matcher syntax conservatively.
    - Check MCP server commands, paths, environment declarations, and `${PLUGIN_ROOT}` references.
    - Run or syntax-check bundled executable scripts when feasible.
    - If the `goose` CLI is installed, additionally run the most relevant native validation/list/install smoke checks available without mutating unrelated user configuration.

11. Package the result with `scripts/package_goose_plugin.py <plugin-dir> [output.zip]` when the user requests a distributable artifact.

12. Deliver:
    - the plugin archive or directory,
    - a short architecture summary,
    - runtime prerequisites,
    - validation results,
    - the install command, typically `goose plugin install <git-repository-url>` for a git-backed plugin, or the appropriate local plugin placement for local development.

## Architecture Rules

Prefer this minimal shape:

```text
my-plugin/
├── plugin.json
└── skills/
    └── my-workflow/
        └── SKILL.md
```

Add hooks only when needed:

```text
my-plugin/
├── plugin.json
├── skills/
│   └── my-workflow/
│       └── SKILL.md
├── hooks/
│   └── hooks.json
└── scripts/
    └── hook-command.sh
```

Do not confuse these concepts:

- **Plugin**: distribution/package boundary for reusable components.
- **Skill**: on-demand procedural knowledge and reusable workflow.
- **Hook**: event-driven local command executed by goose.
- **Extension/MCP server**: runtime tool capability exposed to goose.
- **Recipe**: reusable session/workflow configuration; do not add merely to package Skills.
- **Custom agent**: reusable role/persona/configuration; do not add merely to package Skills.

## Safety and Portability

- Treat hook scripts as executable code and flag this clearly in plugin documentation.
- Prefer portable shell/Python code; document platform-specific dependencies.
- Use `${PLUGIN_ROOT}` inside hook commands for plugin-relative paths.
- Do not use bare `*` as a hook matcher; matcher values are regular expressions. Omit the matcher to match all events or use `.*` intentionally.
- Avoid network downloads during installation unless the user explicitly wants them and the mechanism is documented.
- Never silently weaken security controls during a port.

## Quality Bar

A plugin is ready only when:

- `plugin.json` is valid and has `name`, `version`, and `description`.
- At least one useful component exists (Skill, hook, and/or MCP server).
- Every Skill has valid frontmatter and coherent instructions.
- Every referenced file exists.
- Hook scripts referenced by `hooks/hooks.json` exist.
- Runtime prerequisites are explicit.
- No unresolved placeholder or example files remain unless intentionally part of a template.
- Validation succeeds.

## Bundled Utilities

- `scripts/init_goose_plugin.py`: create a minimal goose plugin scaffold.
- `scripts/validate_goose_plugin.py`: statically validate manifest, Skills, hooks, MCP servers, and references.
- `scripts/package_goose_plugin.py`: validate then create a distributable ZIP.
- `references/goose-plugin-format.md`: canonical Goose plugin layout and installation model.
- `references/goose-hooks.md`: lifecycle hooks format and safe patterns.
