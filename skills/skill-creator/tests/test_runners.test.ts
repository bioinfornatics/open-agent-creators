import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunner, RunnerError } from "../dist/scripts/runners/index.js";
import { GooseRunner } from "../dist/scripts/runners/goose.js";

test("default runner is goose", () => {
  const original = process.env.SKILL_CREATOR_RUNNER;
  delete process.env.SKILL_CREATOR_RUNNER;
  try {
    assert.ok(createRunner() instanceof GooseRunner);
  } finally {
    if (original !== undefined) process.env.SKILL_CREATOR_RUNNER = original;
  }
});

test("environment selects runner", () => {
  const original = process.env.SKILL_CREATOR_RUNNER;
  process.env.SKILL_CREATOR_RUNNER = "goose";
  try {
    assert.ok(createRunner() instanceof GooseRunner);
  } finally {
    if (original !== undefined) process.env.SKILL_CREATOR_RUNNER = original;
    else delete process.env.SKILL_CREATOR_RUNNER;
  }
});

test("unknown runner fails", () => {
  assert.throws(
    () => createRunner("unknown"),
    (error: unknown) => error instanceof RunnerError && /Unsupported runner/.test(error.message)
  );
});

test("goose commands", () => {
  const runner = new GooseRunner("/opt/goose --profile eval");
  assert.deepEqual(runner.textCommand("model-id"), [
    "/opt/goose",
    "--profile",
    "eval",
    "run",
    "--no-session",
    "--quiet",
    "--output-format",
    "text",
    "--instructions",
    "-",
    "--model",
    "model-id",
  ]);
  const stream = runner.streamCommand("query", null);
  assert.deepEqual(stream.slice(-2), ["--text", "query"]);
  assert.ok(stream.includes("stream-json"));
});

test("goose detects loaded skill", () => {
  const runner = new GooseRunner();
  const event = {
    type: "message",
    message: {
      content: [
        {
          type: "toolRequest",
          toolCall: {
            value: {
              name: "skills__load_skill",
              arguments: { name: "review" },
            },
          },
        },
      ],
    },
  };
  assert.equal(runner.eventLoadedSkill(event, "review"), true);
  assert.equal(runner.eventLoadedSkill({ type: "message", message: {} }, "review"), null);
  assert.equal(runner.eventLoadedSkill({ type: "complete" }, "review"), false);
});
