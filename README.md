# Agent Plugins

An open-format-first monorepo of focused authoring skills for agent ecosystems, with Goose as the initial reference runtime.

## Skills

Goose prefixes every skill in this plugin with the plugin name (`agent-plugins:`)
once installed via `goose plugin install`. Skill directories and `SKILL.md` frontmatter use
the plain, unqualified name (e.g. `skill-creator`); the table below shows the qualified name
used to load each skill after installation.

| Creator (qualified name) | Responsibility | Primary target |
|---|---|---|
| `agent-plugins:skill-creator` | Agent Skills authoring and evaluation | `.agents/skills/` |
| `agent-plugins:agent-creator` | Reusable Goose role definitions | `.agents/agents/` |
| `agent-plugins:hook-creator` | Plugin lifecycle hooks and handlers | `<plugin>/hooks/` |
| `agent-plugins:plugin-creator` | Plugin architecture, MCP, assembly, validation, packaging | `.agents/plugins/` |

`plugin-creator` is the orchestrator for plugin components. It routes bundled
skills to `skill-creator`, hooks to `hook-creator`, and custom-agent work to
`agent-creator` only when the target host and plugin format explicitly support
that component. Once installed as a plugin, load these by their qualified name
(`agent-plugins:plugin-creator`, etc.); a standalone copy uses the plain name.

## Skill Dependencies

Each creator declares, in its own `SKILL.md`, exactly when it depends on another
creator, why, and what must be true before handing work back. This keeps
component-only tasks (e.g. "fix this one hook script") from unnecessarily
pulling in the whole plugin workflow, while plugin-scoped tasks always route
through the right specialist first.

```text
plugin-creator
  ├─ depends on skill-creator   → whenever a skill is bundled under <plugin>/skills/
  ├─ depends on hook-creator    → whenever hooks/hooks.json or a hook script changes
  └─ depends on agent-creator   → only if the target format explicitly supports
                                   bundled agent components (rare)

skill-creator   → standalone by default; depends on plugin-creator only when the
                   skill is bundled in a plugin, or the user asks for a plugin-level
                   package/install rather than a standalone .skill file

hook-creator    → never standalone; a hook always belongs to a plugin. Can be
                   invoked directly to fix one hook once plugin.json already exists

agent-creator   → standalone by default (.agents/agents); depends on plugin-creator
                   only when explicitly bundling the agent inside a plugin
```

See the "Plugin Dependency" / "Skill Dependencies" section in each creator's
`SKILL.md` for the full when/why/success-criteria table.

## Installation

### Recommended: install the plugin

Install all creators together from the Git repository:

```bash
goose plugin install https://github.com/bioinfornatics/agent-plugins.git
```

Enable managed updates when desired:

```bash
goose plugin install --auto-update \
  https://github.com/bioinfornatics/agent-plugins.git
```

Goose prefixes every skill in this plugin with the plugin name once it is installed via
`goose plugin install`. Anticipate the qualified form when routing between skills or
instructing the agent:

```text
agent-plugins:skill-creator
agent-plugins:agent-creator
agent-plugins:hook-creator
agent-plugins:plugin-creator
```

For example:

```text
Load agent-plugins:plugin-creator and create a plugin containing a skill and a hook.
```

Skill directories and `SKILL.md` frontmatter `name:` stay unqualified (e.g. `name: plugin-creator`),
per the Agent Skills specification — only the runtime-exposed, loadable name is plugin-qualified.

The plugin is the recommended distribution boundary because the creators are
versioned together and route work between one another.

### Optional: install one skill standalone

Each skill remains self-contained and can still be copied independently:

```bash
mkdir -p ~/.agents/skills
cp -R skills/skill-creator ~/.agents/skills/skill-creator
```

Standalone skills keep their unqualified names, such as `skill-creator`.
Do not make a skill depend on files outside its own directory. Cross-skill
coordination uses the host's skill-loading mechanism and accepts either the
plugin-qualified name or the standalone fallback.

## Development

Each creator is a small TypeScript project compiled to plain JavaScript (`dist/`) with its
runtime `node_modules` vendored so it works without network access once installed. Build and
test each one from its own directory:

```bash
cd skills/agent-creator && npm install && npm run build && npm test
cd skills/hook-creator && npm install && npm run build && npm test
cd skills/plugin-creator && npm install && npm run build && npm test
cd skills/skill-creator && npm install && npm run build && npm test
```

`skill-creator` has its own validator and packaging workflow documented in its
README.

## Sources of truth

- Skills: https://agentskills.io/specification
- Custom agents: Goose `guides/context-engineering/custom-agents`
- Hooks: https://goose-docs.ai/docs/guides/context-engineering/hooks
- Plugins: Goose's Open Plugins adapter and plugin documentation

## Offline distribution

Released plugin archives include each creator's compiled `dist/` scripts and production-only dependencies under `vendor/node_modules/`. Consumer machines need Node.js but do not need `npm install` or network access to run the shipped scripts. Development dependencies such as TypeScript and `@types/*` are not included.

Prepare and verify the offline bundle before packaging or release:

```bash
npm run prepare:offline
npm run test:offline
```

The offline smoke test packages the plugin, extracts it into an isolated temporary directory with an empty `NODE_PATH` and npm offline mode, then executes the skill validator, standalone skill packager, agent validator, plugin validator, and plugin packager from the extracted archive. Packaging fails when a creator marked `offlineBundle: true` is missing `dist/`, its vendor manifest, notices, or a declared runtime dependency.
