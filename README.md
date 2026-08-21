# Agent Plugins

Open-format-first creators that help Goose **create, evaluate, validate, and package** Agent Skills, custom agents, hooks, and complete plugins.

## What you can do

- Create or improve an Agent Skill from a plain-language request.
- Create and install a reusable Goose custom agent.
- Create a complete plugin containing skills, hooks, and MCP server declarations.
- Generate realistic evaluation scenarios and quantitative assertions.
- Compare a new implementation with a previous version or a neutral baseline.
- Grade runs, aggregate a benchmark, and generate an HTML review report.
- Validate and package artifacts for offline distribution.

## Quick start

### 1. Install all creators

```bash
goose plugin install https://github.com/bioinfornatics/agent-plugins.git
```

Requirements: Goose, Node.js 22+, and a configured model provider. Released archives include compiled scripts and runtime dependencies, so consumers do not need to run `npm install` or have network access after installation. Some evaluations require Goose on `PATH`, a model/grader, and a browser for interactive review; missing capabilities are reported as `evaluation: blocked` rather than silently skipped.

### 2. Choose the creator

| I want to… | Load this creator | Primary target |
|---|---|---|
| Create, test, or evaluate one Skill | `agent-plugins:skill-creator` | `.agents/skills/` |
| Create, test, or evaluate a custom agent | `agent-plugins:agent-creator` | `.agents/agents/` |
| Create or validate a plugin hook | `agent-plugins:hook-creator` | `<plugin>/hooks/` |
| Create, integrate, evaluate, or package a complete plugin | `agent-plugins:plugin-creator` | `.agents/plugins/` |

### 3. Copy a prompt

```text
Load agent-plugins:skill-creator and create a Skill that reviews SQL
migrations before execution. Include realistic evaluation scenarios.
```

```text
Load agent-plugins:agent-creator and create a custom agent specialized
in TypeScript security reviews, then evaluate it against a neutral baseline.
```

```text
Load agent-plugins:plugin-creator and create a plugin containing a code-review
Skill and a PostToolUse hook. Validate and package the complete plugin.
```

```text
Load agent-plugins:skill-creator and evaluate this Skill against its previous
version. Create the scenarios, run paired tests, grade them, aggregate the
benchmark, and generate the HTML review report.
```

## Evaluation, not just validation

Static validation checks whether an artifact is well formed. Behavioral evaluation checks whether it actually improves outcomes. The creators support this end-to-end flow:

```text
scenarios → paired isolated runs → grading → benchmark → HTML review → release gates
```

| Target | Typical evidence |
|---|---|
| Skill | Trigger positives/negatives, `with_skill` vs `old_skill`/`without_skill`, assertions, timing, benchmark, human review |
| Custom agent | Specialized delegated agent vs neutral or previous-agent baseline, grading, benchmark, review viewer |
| Complete plugin | Receipts for changed Skills plus integration scenarios for routing, overlap, hooks, and cross-component handoffs |

An official evaluation produces traceable artifacts rather than a prose-only verdict. If a model, runner, grader, or browser is unavailable, completed artifacts are preserved and the result is explicitly marked **blocked**.

### Example result layout

```text
sql-review-workspace/iteration-1/
├── evals/evals.json
├── eval-0/
│   ├── with_skill/outputs/
│   ├── without_skill/outputs/
│   ├── grading.json
│   └── timing.json
├── benchmark.json
├── benchmark.md
├── review.html
└── evaluation-receipt.json
```

Possible final statuses are `pass`, `fail`, `blocked`, and `na`; release gates are not weakened when evidence is missing.

## How the creators work together

`plugin-creator` orchestrates the plugin as a whole but routes specialist work instead of duplicating it:

```text
plugin-creator
  ├─ skill-creator  → every bundled Skill under <plugin>/skills/
  ├─ hook-creator   → hooks/hooks.json and hook scripts
  └─ agent-creator  → only when the target format explicitly supports bundled agents
```

- `skill-creator` and `agent-creator` normally work standalone.
- A hook always belongs to a plugin, although `hook-creator` can modify one hook in an existing plugin.
- Current Goose custom agents are discovered from `.agents/agents/`. Do not assume an `agents/` directory inside a plugin is installed automatically.
- Skill directories and `SKILL.md` frontmatter remain unqualified (`name: skill-creator`). Goose exposes the qualified name only after plugin installation.

See each creator’s `SKILL.md` for its complete routing and success criteria.

## Output examples

A standalone Skill:

```text
.agents/skills/sql-review/
├── SKILL.md
├── references/
└── scripts/
```

A complete plugin:

```text
my-plugin/
├── plugin.json
├── skills/sql-review/SKILL.md
├── hooks/hooks.json
├── scripts/
└── .mcp.json                 # only when MCP tools are required
```

## Installation options

### Managed plugin installation (recommended)

Install the creators together so their versions and routing stay aligned:

```bash
goose plugin install --auto-update \
  https://github.com/bioinfornatics/agent-plugins.git
```

### One standalone creator

Each directory under `skills/` is independently installable:

```bash
mkdir -p ~/.agents/skills
cp -R skills/skill-creator ~/.agents/skills/skill-creator
```

A standalone copy is loaded by its plain name, such as `skill-creator`. It never references runtime files outside its own directory.

## Terminology

| Term | Meaning in this repository |
|---|---|
| **Agent Skill** | A portable `SKILL.md`-based capability, usually installed under `.agents/skills/` |
| **Custom agent** | A reusable Goose role definition installed under `.agents/agents/` |
| **Plugin** | A package rooted at `plugin.json` that can combine Skills, hooks, and MCP declarations |
| **Agent Plugins** | The open plugin format/ecosystem; **agent-plugins** is the name of this particular distribution |
| **Creator** | One of the four authoring Skills shipped by this project |

## Developer and contributor guide

Each creator is a TypeScript project compiled to `dist/`, with production dependencies vendored for offline use:

```bash
cd skills/agent-creator && npm install && npm run build && npm test
cd skills/hook-creator && npm install && npm run build && npm test
cd skills/plugin-creator && npm install && npm run build && npm test
cd skills/skill-creator && npm install && npm run build && npm test
```

Prepare and verify the complete offline distribution from the repository root:

```bash
npm run prepare:offline
npm test
npm run test:offline
```

## Format sources of truth

- Skills: <https://agentskills.io/specification>
- Custom agents: Goose `guides/context-engineering/custom-agents`
- Hooks: <https://goose-docs.ai/docs/guides/context-engineering/hooks>
- Plugins: Goose Open Plugins adapter and plugin documentation

Vendored snapshots in each creator’s `references/` directory make authoring and validation reproducible.

## Project status and license

- Current plugin version: see [`plugin.json`](plugin.json).
- Compatibility target: Goose as the reference runtime, Agent Skills for portable Skills, and Agent Plugins 1.0.0 for the plugin manifest.
- License: [CeCILL-C](LICENSE).
- Validation: `npm test` runs all creator suites, distribution checks, and an isolated offline-bundle smoke test.
