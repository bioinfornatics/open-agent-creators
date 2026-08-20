---
name: agent-creator
description: Create, edit, validate, test, and install Goose custom agent definitions under .agents/agents using Markdown with YAML frontmatter. Use when asked to define a reusable role, persona, specialist, reviewer, writer, planner, or delegated subagent; migrate an agent from .goose/agents or .claude/agents; or audit an existing custom agent. Do not use for Agent Skills under .agents/skills, plugins under .agents/plugins, or repeatable workflows that belong in recipes.
---

# Agent Creator

Create focused Goose custom agents that define **who Goose should be** for a task. Keep generated files under `.agents/agents/` for project scope or `~/.agents/agents/` for user scope.

## Scope boundary

Do not confuse these concepts:

- **Custom agent**: reusable role, behavior, expertise, and optional model preference.
- **Skill**: reusable procedural or domain knowledge loaded on demand; use the skill creator.
- **Plugin**: package containing components such as skills, hooks, or MCP declarations; use the plugin creator.
- **Recipe**: repeatable workflow with prompts, settings, parameters, extensions, or scheduling.
- **Ad-hoc subagent**: one isolated delegated task that does not need a persistent agent file.

A custom agent does not define extensions, MCP servers, scheduled jobs, recipe parameters, or a multi-step orchestration graph. If those are required, recommend a recipe or plugin instead of overloading the agent file.

## Plugin Dependency

`agent-creator` works standalone for its normal case: an agent under `.agents/agents/` (project) or `~/.agents/agents/` (user). Current Goose custom agents are discovered from `.agents/agents`, not from inside a plugin — most requests never need `plugin-creator` at all.

Depend on `open-agent-creators:plugin-creator` (fallback: standalone `plugin-creator`) only when:

| When | Why | Success criteria before returning to plugin work |
|---|---|---|
| The user explicitly asks to bundle this agent definition as a plugin component | Bundled-agent support is host/format-specific and `plugin-creator` is the one that confirms the target format actually installs agents from inside a plugin — do not assume a plugin's `agents/` directory is auto-discovered | `plugin-creator` has confirmed the target host/format explicitly supports bundled agent components before this creator authors anything beyond a standard `.agents/agents/` file |
| The user asks to package or install the *whole plugin* the agent is part of | Manifest wiring, packaging, and installation are `plugin-creator`'s domain | Hand back an agent file that passes `validate_agent`; do not attempt plugin-level packaging here |

If `plugin-creator` is unavailable and one of these cases applies, state the limitation explicitly rather than guessing whether the target format supports bundled agents.

## Source of truth

Read `references/custom-agents.md` before creating or modifying an agent. It is a vendored snapshot of Goose's `guides/context-engineering/custom-agents` documentation and defines the supported format, paths, discovery behavior, and usage model.

When changing this creator, compare that reference with the current Goose documentation and implementation. Record the upstream revision or refresh date in `references/UPSTREAM.md` whenever the snapshot is updated.

## Workflow

1. Determine the desired role from the request and existing context:
   - responsibilities and non-goals;
   - inputs and expected output style;
   - quality and safety constraints;
   - whether the role should be globally reusable or project-specific;
   - whether a model preference is genuinely needed.

2. Confirm that a custom agent is the right abstraction:
   - use an agent for role, expertise, behavior, tone, or delegated specialization;
   - use a skill for reusable procedures or knowledge;
   - use a recipe for repeatable steps, extensions, parameters, or scheduling;
   - use a plugin for packaged runtime components.

3. Inspect nearby agent definitions when adapting an existing repository. Preserve useful local conventions without introducing unsupported frontmatter.

4. Create one Markdown file:
   - project: `<project>/.agents/agents/<name>.md`;
   - user: `~/.agents/agents/<name>.md`.

5. Use the supported frontmatter:

   ```markdown
   ---
   name: code-reviewer
   description: Reviews code for correctness, maintainability, and risk
   model: gpt-5.5
   ---

   You are a senior code reviewer...
   ```

   `name` is required. `description` and `model` are optional. The body should contain meaningful instructions.

6. Write the instructions:
   - state the role and objective first;
   - define priorities and decision criteria;
   - define important boundaries and escalation conditions;
   - specify the expected response structure only when useful;
   - keep task-specific input out of the reusable agent file;
   - avoid embedding workflows better represented as recipes;
   - do not claim unavailable tools, extensions, or permissions.

7. Validate with:

   ```bash
   node <agent-creator>/dist/scripts/validate_agent.js <path/to/agent.md>
   ```

8. When installing or copying an agent, use:

   ```bash
   node <agent-creator>/dist/scripts/install_agent.js <path/to/agent.md> --project <project-root>
   node <agent-creator>/dist/scripts/install_agent.js <path/to/agent.md> --global
   ```

   Refuse to overwrite an existing agent unless the user explicitly requests it and `--force` is provided.

9. Test discovery in a new Goose session when feasible. Ask Goose to list available sources or invoke the agent by name. Loading adds the instructions to the current context; delegation runs the agent in an isolated session.

10. For non-trivial agents, offer the evaluation loop in **Agent evaluation** below before declaring the agent ready.

11. Deliver the agent file, installation location, validation results, and a short usage example such as:

    ```text
    @code-reviewer review the current diff
    ```

## Agent evaluation

Evaluate the custom agent as a reusable role, not as a skill trigger. The key question is whether delegating the same realistic task to the specialized agent produces better, more consistent results than a controlled baseline.

1. Create 2–3 realistic tasks covering the role's core responsibilities, boundaries, and likely failure modes. Ask the user to review them.
2. Save them in an eval JSON file:

   ```json
   {
     "agent_name": "code-reviewer",
     "evals": [
       {
         "id": 1,
         "name": "security-sensitive-review",
         "prompt": "Review this change and report correctness and security risks...",
         "assertions": [
           "Identifies the unsafe authorization bypass with specific evidence",
           "not-contains: looks good to me"
         ]
       }
     ]
   }
   ```

3. Run paired evaluations in isolated temporary projects:

   ```bash
   node <agent-creator>/dist/scripts/run_agent_eval.js \
     --agent <path/to/agent.md> \
     --eval-set <path/to/evals.json> \
     --workspace <agent-name>-workspace/iteration-1
   ```

   Each task runs twice in the same batch:
   - `with_agent`: the real custom-agent instructions;
   - `without_agent_instructions`: a neutral delegated baseline using the same model preference when possible.

   When improving an existing agent, pass `--baseline-agent <old-agent.md>` to compare against the old instructions instead.

4. Grade objective assertions first. Prefix simple assertions with `contains:`, `not-contains:`, or `regex:` for deterministic grading. Use the LLM grader only for substantive semantic criteria:

   ```bash
   node <agent-creator>/dist/scripts/grade_agent_eval.js \
     <workspace>/iteration-1 \
     --llm-grader
   ```

5. Aggregate results:

   ```bash
   node <agent-creator>/dist/scripts/aggregate_benchmark.js \
     <workspace>/iteration-1 \
     --agent-name <name> \
     --agent-path <path/to/agent.md>
   ```

6. Generate the review viewer before revising the agent:

   ```bash
   node <agent-creator>/dist/eval-viewer/generate_review.js \
     <workspace>/iteration-1 \
     --agent-name <name> \
     --benchmark <workspace>/iteration-1/benchmark.json
   ```

   Use `--static <output.html>` in a headless environment.

7. Review qualitative output, assertion pass rates, time, token use, and variance. An agent may be better even when it costs more, but the trade-off must be visible.
8. Revise durable role instructions rather than overfitting to test prompts. Repeat in `iteration-2`, passing `--previous-workspace` to the viewer.
9. Stop when the user is satisfied, the specialized agent consistently beats the baseline on discriminating criteria, or further changes no longer improve the role.

### Evaluation principles

- Keep the controller and execution environment the same across paired runs.
- Compare isolated delegated executions; do not evaluate by merely loading instructions into the parent context.
- Use the same task inputs and assertions for specialized and baseline runs.
- Prefer deterministic checks for factual or structural requirements and human review for judgment quality.
- Test non-goals and restraint, not only successful task completion.
- Preserve transcripts and timing so regressions can be explained.
- Treat the neutral baseline as a control, not as a claim that Goose has no general capabilities.

## Writing guidance

Prefer concise, durable instructions over a giant prompt. Explain why constraints matter. Make the description distinctive enough that Goose can identify when the role is appropriate.

A strong agent body usually covers:

1. role and objective;
2. priorities;
3. operating boundaries;
4. evidence or verification expectations;
5. output conventions.

Do not duplicate generic system behavior, repository instructions already supplied through `AGENTS.md`, or full skill content. Agents can use skills discoverable in their session.

## Migration guidance

When migrating from `.goose/agents/` or `.claude/agents/`:

- place new shared definitions in `.agents/agents/`;
- preserve the semantic role and instructions;
- retain only `name`, `description`, and `model` frontmatter supported by Goose;
- move tool lists, permissions, hooks, MCP declarations, or workflow configuration to the appropriate Goose abstraction;
- preserve the original source unless the user explicitly requests removal;
- report anything that could not be mapped safely.

## Quality gate

An agent is ready only when:

- frontmatter is valid YAML;
- `name` is present, non-empty, and unique in the intended scope;
- the file uses a `.md` extension;
- `description` and `model`, when present, are strings;
- no unsupported frontmatter keys remain;
- the instruction body is non-empty and role-focused;
- no unresolved placeholders remain;
- the selected installation scope is explicit;
- validation succeeds.

## Bundled resources

- `references/custom-agents.md`: vendored Goose custom-agents documentation.
- `references/UPSTREAM.md`: source and refresh instructions for the reference snapshot.
- `dist/scripts/init_agent.js`: create a minimal agent definition.
- `dist/scripts/validate_agent.js`: validate agent frontmatter and body.
- `dist/scripts/install_agent.js`: install an agent at project or user scope.
- `dist/scripts/run_agent_eval.js`: run paired isolated agent and baseline evaluations.
- `dist/scripts/grade_agent_eval.js`: grade deterministic and semantic assertions.
- `dist/scripts/aggregate_benchmark.js`: aggregate pass rate, timing, and token metrics.
- `dist/eval-viewer/generate_review.js`: review qualitative outputs and benchmark results.
