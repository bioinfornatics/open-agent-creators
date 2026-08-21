# Hook Creator

Creates and validates Goose/Open Plugins lifecycle-hook components. The package is
standalone-installable and requires only Node.js at runtime.

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

## Unified CLI

After building, invoke the CLI directly or through the package's `hook-creator`
bin mapping:

```bash
node dist/cli.js --help
hook-creator init /path/to/plugin PostToolUse record-tool \
  --matcher 'developer__shell' --timeout 10
hook-creator validate /path/to/plugin
```

Common options can appear before or after the command:

- `--format text|json` selects human-readable or machine-readable output;
- `--quiet` suppresses successful output (failures remain visible);
- `--help` or `-h` prints help.

Exit codes are `0` for success, `1` for an operational or validation
failure, and `2` for invalid command-line usage.

### JSON examples

```bash
hook-creator init ./my-plugin PreToolUse policy-check --format json
hook-creator validate ./my-plugin --format json
```

JSON output includes an `ok` boolean and command-specific paths, warnings, or
errors.

## Legacy entrypoints

The original entrypoints remain supported for compatibility:

```bash
node dist/init_hook.js /path/to/plugin PostToolUse record-tool \
  --matcher 'developer__shell' --timeout 10
node dist/validate_hook.js /path/to/plugin
```

## Development

```bash
npm run build
npm test
```

## Use with Goose

```text
Load agent-plugins:hook-creator and add a PostToolUse hook to /path/to/plugin
that records shell tool usage. Validate its matcher, command, and referenced
files, and explain any security implications.
```

A hook is evaluated through focused handler tests and, when whole-plugin
behavior is requested, integration scenarios coordinated by
`agent-plugins:plugin-creator`. Blocking hooks such as `PreToolUse` require an
explicit side-effect and failure-mode review.

## Scope

- Hook creation and hook-specific testing: this skill.
- Complete plugin assembly and packaging: `plugin-creator`.
- Skills: `skill-creator`.
- Custom agents: `agent-creator`.
