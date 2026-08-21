# Skill Creator

A vendor-neutral fork of Anthropic's `skill-creator`, adapted to the open [Agent Skills](https://agentskills.io) format and the emerging `.agents/skills` interoperability convention used by Goose and other compatible agents.

## What changed

- Skills live in `.agents/skills/` or `~/.agents/skills/` and retain the standard `SKILL.md` format.
- Repository instructions use `AGENTS.md`; no `CLAUDE.md` or `.claude/` files are created.
- Scope is restricted to skills under `.agents/skills/`; agent definitions and plugins belong to separate creators.
- Trigger evaluation stages the skill in an isolated `.agents/skills/` project.
- Description optimization calls a configurable non-interactive agent CLI. Goose is the default.
- Viewer and report wording is vendor-neutral.

## Requirements

- Node.js 22+ (scripts are TypeScript compiled to `dist/`, with runtime `node_modules` vendored — no network access needed once installed)
- Goose on `PATH` for trigger evaluation and description optimization, unless another adapter is implemented

## Unified CLI

Build once, then use the unified entrypoint for validation, evaluation, aggregation, review, gate verification, and packaging:

```bash
npm install && npm run build
node dist/scripts/cli.js validate /path/to/skill
node dist/scripts/cli.js trigger-eval --eval-set /path/to/trigger-evals.json --skill-path /path/to/skill
node dist/scripts/cli.js aggregate /path/to/iteration-workspace
node dist/scripts/cli.js review /path/to/iteration-workspace --static review.html
node dist/scripts/cli.js verify /path/to/skill --evaluation benchmark.json --human-review feedback.json
node dist/scripts/cli.js package /path/to/skill ./dist-out
```

Every subcommand accepts `--help`, `--format text|json`, and `--quiet`. Exit codes are `0` for success, `1` for failure, `2` for invalid usage, and `3` when verification or execution is blocked. The former script entrypoints remain supported for compatibility.

## Legacy validate and package entrypoints

```bash
node dist/scripts/quick_validate.js /path/to/skill
node dist/scripts/package_skill.js /path/to/skill ./dist-out
```

## Trigger evaluation

```bash
node dist/scripts/run_eval.js \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --model provider/model-id \
  --verbose
```

The eval set is a JSON array of objects with `query` and `should_trigger` fields.

## Optimize a description

```bash
node dist/scripts/run_loop.js \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --model provider/model-id \
  --max-iterations 5 \
  --verbose
```

Use `--runner goose` or set `SKILL_CREATOR_RUNNER`. Additional hosts can be added as runner modules; unsupported runners fail explicitly.

## Portable paths and scope

| Asset | Project | User | Managed here? |
|---|---|---|---|
| Skills | `.agents/skills/` | `~/.agents/skills/` | Yes |
| Agents | `.agents/agents/` | `~/.agents/agents/` | No — use an agent creator |
| Plugins | `.agents/plugins/` | `~/.agents/plugins/` | No — use a plugin creator |
| Instructions | `AGENTS.md` | host-dependent | No — repository guidance only |

Only the skill directory and `SKILL.md` contract are covered by the Agent Skills specification. `.agents/skills` is an emerging installation convention. This repository intentionally does not define agent or plugin schemas.

## Attribution and license

This fork derives from Anthropic's skill creator. See `LICENSE.txt` for the upstream license and attribution.
