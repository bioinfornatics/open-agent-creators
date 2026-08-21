---
name: plugin-creator
description: "Work on an entire Goose/Open Plugin package: create, adapt, audit, validate, test, behaviorally evaluate, benchmark, package, release, or migrate a plugin directory containing plugin.json and one or more skills, hooks, MCP servers, or other components. Use for multi-skill changes, cross-component integration, plugin-level baselines, packaging, and plugin manifests. Do not use for one isolated SKILL.md or for asking whether a single skill generates better outputs; use skill-creator. Do not use for standalone custom agents or isolated hook implementation."
---

# Plugin Creator

## Offline runtime

Released distributions include compiled scripts and production dependencies under `vendor/node_modules`. Run scripts from `dist/`; consumer machines need Node.js but must not run `npm install` or require network access. A missing vendor dependency is a packaging defect: report it and rebuild with the repository's `scripts/prepare-offline-bundle.mjs`.


Create production-ready Goose/Open Plugins, not just example snippets.

## Evaluation mode has execution priority

If the user's current request says evaluate, test, benchmark, compare, or prove a plugin/skill improvement, do not merely describe an evaluation protocol. Execute the Behavioral Evaluation Contract in this task: freeze the baseline, route modified components to their specialized creators, run paired behavior cases and plugin integration cases, grade them, run the official aggregator, and generate the viewer. A plan-only response fails the request unless the user explicitly requested only a plan.

Before packaging, delivery, or a claim that evaluation passed, verify the complete artifact receipt. If execution is impossible, return `evaluation: blocked`; never downgrade silently to static validation or an ad-hoc two-agent comparison.

Then run `dist/scripts/verify_plugin_gates.js` with one current skill receipt per bundled skill. The plugin gate verifies receipt hashes, integration thresholds, tests, offline distribution, archive identity, and human review. A plugin is release-eligible only when every required component and plugin gate passes.

Create production-ready Goose/Open Plugins, not just example snippets. Keep the scope strictly within `.agents/plugins`: use the skill creator for standalone `.agents/skills` and an agent creator for standalone `.agents/agents`. Prefer the smallest valid plugin architecture that satisfies the request.

## Skill Dependencies

`plugin-creator` owns architecture, the plugin root, `plugin.json`, MCP declarations, cross-component validation, installation, and packaging. It never authors a bundled skill's internal content, a hook script's behavior, or a standalone agent's persona itself — that work is always routed to the specialized creator listed below, before implementing it.

| Skill | When to invoke | Why | Success criteria before continuing |
|---|---|---|---|
| `agent-plugins:skill-creator` (fallback: standalone `skill-creator`) | Any new or modified bundled skill under `<plugin>/skills/` | `plugin-creator` does not own `SKILL.md` authoring quality, triggering-description tuning, or skill evaluation; `skill-creator` is the single source of truth for that | The bundled `SKILL.md` has valid frontmatter (`name` matches its directory, non-empty `description` under 1024 chars), passes `skill-creator`'s `quick_validate`, and — when the plugin ships more than one skill or a routing hub — has been checked for triggering overlap with sibling skills |
| `agent-plugins:hook-creator` (fallback: standalone `hook-creator`) | Any new or modified `hooks/hooks.json` rule or hook command script | Hook event/matcher semantics, blocking behavior, and security review of executable hook commands are `hook-creator`'s domain, not `plugin-creator`'s | `hooks/hooks.json` passes `hook-creator`'s validator with no errors, every referenced script exists and is executable, and blocking events (`PreToolUse`, `Stop`) have been reviewed for unintended side effects |
| `agent-plugins:agent-creator` (fallback: standalone `agent-creator`) | Only when the target host and plugin format explicitly support bundled custom-agent components — do not assume a plugin's `agents/` directory is auto-installed; current Goose custom agents are discovered from `.agents/agents`, not from a plugin | Persona/role definition quality and supported-frontmatter rules are `agent-creator`'s domain | The agent file passes `agent-creator`'s `validate_agent` and its installation path (project or user scope) has been explicitly confirmed with the user |

**Dependency is task-scoped, not permanent.** A request to package, validate, or install an *entire* plugin always needs this routing (at minimum `skill-creator` if any skill is bundled). A request that only touches one component in isolation — e.g. "fix the wording in this one hook script" with no other plugin change — can stay entirely within the specialized creator without `plugin-creator` being involved at all; see that creator's own `SKILL.md` for when it works standalone.

Prefer loading the creator instructions into the current context when assembling one plugin. Delegate only when component work is isolated into disjoint files, and never let multiple delegates modify the same plugin files concurrently.

If a required creator is unavailable, state the limitation and follow its documented source of truth directly rather than inventing a schema.

## Behavioral Evaluation Contract

When plugin evaluation is explicitly requested, static validation is necessary but insufficient. Require a complete evaluation receipt from `skill-creator` for every behaviorally changed skill, plus plugin-level integration scenarios.

Completion requires:

1. paired `with_skill` and `old_skill`/`without_skill` outputs;
2. `grading.json` for every run with `text`, `passed`, and `evidence`;
3. `timing.json`, using null with a reason when metrics are unavailable;
4. plugin-level integration scenarios covering routing and cross-component handoffs;
5. `aggregate_benchmark.js` generates the combined benchmark as `benchmark.json` and `benchmark.md`;
6. a review viewer generated by `eval-viewer/generate_review.js`, either live or as static review HTML;
7. a final receipt listing all artifacts and human-review status.

If any required capability is unavailable, report `evaluation: blocked`. Never replace this pipeline with an ad-hoc comparison. If asked to “just run two subagents and call it official,” refuse the substitution, do not create custom agents, and run the official paired-run → grading → aggregation → viewer workflow instead. Do not package or release while the requested evaluation receipt is incomplete.

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
   - load `agent-plugins:skill-creator` (or standalone `skill-creator`) before authoring bundled skills;
   - load `agent-plugins:hook-creator` (or standalone `hook-creator`) before authoring hooks;
   - load `agent-plugins:agent-creator` (or standalone `agent-creator`) only for an explicitly supported standalone-agent target.

   Use the local references as a fallback, not as a replacement for routing when the specialized creator is available.

5. Create the plugin with `dist/scripts/init_goose_plugin.js` when starting from scratch. Do not hand-create the basic scaffold unless the script cannot be used.

6. Implement only the resources needed:
   - `plugin.json` at plugin root.
   - `skills/<skill-name>/SKILL.md` for reusable Agent Skills.
   - skill-local scripts, references, templates, or assets when they improve reliability.
   - `hooks/hooks.json` plus `scripts/` only when lifecycle behavior is explicitly needed.
   - `.mcp.json` or manifest `mcpServers` only when runtime tools are required.
   - Do not invent a standalone custom agent, recipe, MCP server, or hook when a Skill is sufficient.

7. After loading `agent-plugins:skill-creator` or its standalone fallback, for every bundled Skill:
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
    - Run `dist/scripts/validate_agent_plugin_schema.js <plugin-dir> --format json` for deterministic, offline Agent Plugins 1.0.0 schema conformance. This validates `plugin.json` and `mcp.json`/`.mcp.json` against the vendored canonical schema snapshot; it does not call an external validator or download schemas at runtime.
    - Run `dist/scripts/validate_goose_plugin.js <plugin-dir>` for structural and Goose-specific operational checks.
    - Validate JSON syntax for `plugin.json`, `hooks/hooks.json`, and `.mcp.json` when present.
    - Validate every `SKILL.md` frontmatter and name/path consistency.
    - Run the `agent-plugins:hook-creator` validator or its standalone fallback for hooks, then check hook event names and matcher syntax conservatively.
    - Check MCP server commands, paths, environment declarations, and `${PLUGIN_ROOT}` references.
    - Run or syntax-check bundled executable scripts when feasible.
    - If the `goose` CLI is installed, additionally run the most relevant native validation/list/install smoke checks available without mutating unrelated user configuration.

12. Package the result with `dist/scripts/package_goose_plugin.js <plugin-dir> [output.zip]` when the user requests a distributable artifact.

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

- `dist/scripts/cli.js`: unified `init`, `validate`, `verify`, and `package` CLI.
- `dist/scripts/init_goose_plugin.js`: create a minimal goose plugin scaffold.
- `dist/scripts/validate_agent_plugin_schema.js`: validate `plugin.json` and MCP configuration against the vendored Agent Plugins 1.0.0 schemas, with text, JSON, and quiet CI modes.
- `dist/scripts/validate_goose_plugin.js`: statically validate manifest, Skills, hooks, MCP servers, and references.
- `dist/scripts/package_goose_plugin.js`: validate then create a distributable ZIP.
- `references/goose-plugin-format.md`: canonical Goose plugin layout and installation model.
- `references/goose-hooks.md`: lifecycle hooks format and safe patterns.
d`: canonical Goose plugin layout and installation model.
- `references/goose-hooks.md`: lifecycle hooks format and safe patterns.