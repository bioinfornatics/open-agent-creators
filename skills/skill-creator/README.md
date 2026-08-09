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

- Python 3.10+
- PyYAML for validation
- Goose on `PATH` for trigger evaluation and description optimization, unless another adapter is implemented

## Validate and package

```bash
python -m scripts.quick_validate /path/to/skill
python -m scripts.package_skill /path/to/skill ./dist
```

## Trigger evaluation

```bash
python -m scripts.run_eval \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --model provider/model-id \
  --verbose
```

The eval set is a JSON array of objects with `query` and `should_trigger` fields.

## Optimize a description

```bash
python -m scripts.run_loop \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --model provider/model-id \
  --max-iterations 5 \
  --verbose
```

Use `--agent-cli "goose"` or set `AGENT_SKILL_CREATOR_CLI`. Additional hosts can be added in `scripts/agent_cli.py`; unsupported CLIs fail explicitly.

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
