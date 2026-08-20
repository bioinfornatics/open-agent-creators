---
name: hook-creator
description: Create, edit, validate, test, and integrate Goose/Open Plugins lifecycle hooks under a plugin's hooks/hooks.json and scripts directory. Use for logging, notifications, formatting, policy gates, tool-call blocking, stop gates, or reactions to session, prompt, tool, file, and shell events. Do not use for general plugin assembly, standalone skills, or standalone custom agents.
---

# Hook Creator

Create trusted Goose lifecycle hooks as components of a plugin. A hook never lives independently under `.agents/hooks`; it belongs inside a plugin discovered from `.agents/plugins/`.

## Source of truth

Read `references/hooks.md` before creating or modifying hooks. It is a vendored snapshot of Goose's `guides/context-engineering/hooks` documentation and defines supported events, configuration fields, payloads, matchers, blocking behavior, and troubleshooting.

See `references/UPSTREAM.md` when refreshing the snapshot.

## Scope boundary

- Use this creator for `hooks/hooks.json` and hook command scripts.
- Use `open-agent-creators:skill-creator` (or standalone `skill-creator`) for standalone or plugin-bundled Agent Skills.
- Use `open-agent-creators:agent-creator` (or standalone `agent-creator`) for standalone `.agents/agents` definitions.

## Plugin Dependency

Unlike `skill-creator`, `hook-creator` has **no standalone mode** — a hook only ever exists as a component of a plugin's `hooks/hooks.json`, never independently under `.agents/hooks`. This creator can be invoked in isolation to author or fix one hook rule/script, but the surrounding plugin must already exist (with a valid `plugin.json`) or be created first.

| When to depend on `open-agent-creators:plugin-creator` (fallback: standalone `plugin-creator`) | Why | Success criteria before returning |
|---|---|---|
| No `plugin.json` exists yet at the target root | A hook cannot be added to a plugin that doesn't exist; `plugin-creator` owns scaffold creation | `plugin-creator` has created a minimal `plugin.json`; only then author the hook here |
| The user asks to validate, package, or install the *whole plugin*, not just this hook | Cross-component validation, packaging, and installation are `plugin-creator`'s domain, not this creator's | Hand back a hook component that passes this creator's own validator (`hook_format.ts`) — `plugin-creator` re-validates it as part of the full plugin, do not duplicate that step here |

When invoked from `plugin-creator`, return a validated hook component that can be assembled into the same plugin workspace. Do not create a second, unrelated plugin root.

## Workflow

1. Determine the desired behavior and whether a hook is the right mechanism:
   - choose a hook for event-driven local automation;
   - use a skill for procedural knowledge;
   - use an MCP server or extension for interactive tools;
   - use a recipe for repeatable orchestration.

2. Identify the event and matcher target from `references/hooks.md`. Supported events are:
   - `SessionStart`
   - `SessionEnd`
   - `Stop`
   - `UserPromptSubmit`
   - `PreToolUse`
   - `PostToolUse`
   - `PostToolUseFailure`
   - `BeforeReadFile`
   - `AfterFileEdit`
   - `BeforeShellExecution`
   - `AfterShellExecution`

3. Decide whether blocking is required. Only `PreToolUse` and `Stop` can block. Other events are observation-only even if a script prints a block decision.

4. Create or update:

   ```text
   <plugin>/
   ├── plugin.json
   ├── hooks/
   │   └── hooks.json
   └── scripts/
       └── handler.sh
   ```

5. Configure each rule:
   - `matcher` is an optional regular expression, not a glob;
   - omit it to match every event or use `.*` intentionally;
   - never use bare `*`;
   - use only the `command` action type currently supported by Goose;
   - use `${PLUGIN_ROOT}` for plugin-relative commands;
   - keep the timeout explicit when the default 30 seconds is unsuitable.

6. Write scripts defensively:
   - read the complete JSON payload from stdin;
   - treat event-specific fields as optional;
   - never interpolate untrusted payload values into shell commands unsafely;
   - document required commands such as `jq`;
   - prefer portable shell or Python;
   - make directly invoked scripts executable;
   - keep blocking hooks fast and deterministic.

7. For blocking hooks, use exactly one documented signal:
   - exit code `2` with the reason on stderr; or
   - JSON beginning with `{"decision":"block","reason":"..."}` on stdout.

   Unexpected failures and timeouts fail open. Do not rely on an ordinary non-zero exit to block.

8. Validate the plugin hook component:

   ```bash
   node <hook-creator>/dist/scripts/validate_hook.js <plugin-dir>
   ```

9. Test handlers with representative payloads. Check both matching and non-matching cases, allow and deny cases for blocking hooks, missing optional fields, malformed input, and absent external dependencies.

10. Return the changed hook files, event/matcher rationale, runtime prerequisites, safety notes, and test evidence to `plugin-creator` or the user.

## Blocking guidance

Use `PreToolUse` for policy enforcement before a tool executes. A denial should be specific and actionable. Do not ask the model to retry a prohibited action.

Use `Stop` sparingly. A blocking Stop hook keeps a turn running and can create loops; Goose enforces a consecutive block cap, configurable through `GOOSE_STOP_HOOK_BLOCK_CAP`.

Never use blocking hooks for telemetry or slow network calls.

## Quality gate

A hook component is ready only when:

- `hooks/hooks.json` is valid JSON;
- all event names are supported;
- every matcher compiles as a regular expression;
- each rule has at least one command action;
- command and timeout values are valid;
- every `${PLUGIN_ROOT}` file reference exists;
- scripts safely consume stdin and document dependencies;
- blocking behavior is used only with `PreToolUse` or `Stop`;
- representative smoke tests succeed;
- no unresolved placeholders remain.

## Bundled resources

- `references/hooks.md`: vendored Goose hooks documentation.
- `references/UPSTREAM.md`: source and refresh instructions.
- `dist/scripts/init_hook.js`: scaffold a hook component in a plugin.
- `dist/scripts/validate_hook.js`: validate hook configuration and references.
