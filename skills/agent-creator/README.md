# Agent Creator

A dedicated creator for Goose custom-agent definitions stored under
`.agents/agents/`.

The source of truth is Goose's
`guides/context-engineering/custom-agents` documentation, vendored in
`references/custom-agents.md` for reproducible authoring and validation.

## Scope

| Asset | Location | Managed here? |
|---|---|---|
| Custom agents | `.agents/agents/`, `~/.agents/agents/` | Yes |
| Skills | `.agents/skills/`, `~/.agents/skills/` | No — use `skill-creator` |
| Plugins | `.agents/plugins/`, `~/.agents/plugins/` | No — use `plugin-creator` |
| Recipes | Goose recipe locations | No — use recipe tooling |

## Agent format

```markdown
---
name: code-reviewer
description: Reviews code for correctness, maintainability, and risk
model: gpt-5.5
---

You are a senior code reviewer...
```

Only `name` is required. `description` and `model` are optional. The
instruction body must be non-empty.

## Unified CLI

The package exposes **agent-creator** (mapped to dist/scripts/cli.js) with init, validate, evaluate, grade, aggregate, and install commands. The legacy compiled entrypoints remain available.

    agent-creator --help
    agent-creator init code-reviewer --path /tmp/agents
    agent-creator validate /tmp/agents/code-reviewer.md --format json
    agent-creator install /tmp/agents/code-reviewer.md --project /path/to/project --quiet

All commands accept --format text|json, --quiet, and --help. Exit codes are 0 for success, 1 for failure, 2 for invalid usage, and 3 when an operation is blocked (for example, a refused overwrite).

## Create

```bash
node dist/scripts/init_agent.js code-reviewer \
  --path /tmp/agents \
  --description "Reviews code for correctness and risk" \
  --role "You are a senior code reviewer. Prioritize correctness, security, and tests."
```

## Validate

```bash
node dist/scripts/validate_agent.js /tmp/agents/code-reviewer.md \
  --require-filename-match
```

## Install

Project scope:

```bash
node dist/scripts/install_agent.js /tmp/agents/code-reviewer.md \
  --project /path/to/project
```

User scope:

```bash
node dist/scripts/install_agent.js /tmp/agents/code-reviewer.md --global
```

Existing files are not overwritten unless `--force` is supplied.

## Use

Start a new Goose session where the agent is discoverable, then invoke it by
name:

```text
@code-reviewer review the current diff
```

You may also load its instructions into the current context or delegate an
isolated task to it.

## Evaluate

Create an eval set with realistic delegated tasks and objective assertions. For
example:

```json
{
  "evals": [
    {
      "id": "typescript-auth-review",
      "prompt": "Review the authentication changes in the supplied diff.",
      "assertions": [
        "Identifies the token validation risk",
        "Proposes a concrete regression test"
      ]
    }
  ]
}
```

Then run the specialized agent and a neutral delegated baseline on exactly the
same tasks:

```bash
node dist/scripts/run_agent_eval.js \
  --agent /path/to/code-reviewer.md \
  --eval-set /path/to/evals.json \
  --workspace /tmp/code-reviewer-workspace/iteration-1

node dist/scripts/grade_agent_eval.js \
  /tmp/code-reviewer-workspace/iteration-1 \
  --llm-grader

node dist/scripts/aggregate_benchmark.js \
  /tmp/code-reviewer-workspace/iteration-1 \
  --agent-name code-reviewer \
  --agent-path /path/to/code-reviewer.md

node dist/eval-viewer/generate_review.js \
  /tmp/code-reviewer-workspace/iteration-1 \
  --agent-name code-reviewer \
  --benchmark /tmp/code-reviewer-workspace/iteration-1/benchmark.json
```

For an existing agent, use `--baseline-agent old-agent.md` to compare the new
instructions against the previous version. The evaluation preserves the custom
agent model: tasks run through isolated delegation rather than by converting the
agent into a skill or recipe.
