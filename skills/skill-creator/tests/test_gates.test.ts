import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEvaluationReceipt } from "../dist/scripts/validate_evaluation_receipt.js";
import { sourceHash, verifySkill } from "../dist/scripts/verify_skill_gates.js";

function fixture() {
  const tmp = mkdtempSync(join(tmpdir(), "skill-gates-"));
  const root = join(tmp, "demo");
  mkdirSync(root);
  writeFileSync(
    join(root, "SKILL.md"),
    "---\nname: demo\ndescription: Handles demo work\n---\n\n# Demo\n",
  );
  return { tmp, root, workspace: join(tmp, "evaluation") };
}

function benchmark(workspace: string, hash: string, current = 0.9, baseline = 0.7): void {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    join(workspace, "benchmark.json"),
    JSON.stringify({
      metadata: { source_sha256: hash },
      run_summary: {
        with_skill: { pass_rate: { mean: current } },
        old_skill: { pass_rate: { mean: baseline } },
      },
    }),
  );
  writeFileSync(join(workspace, "review.html"), "ok");
}

test("static skill gates pass", () => {
  const { tmp, root } = fixture();
  try {
    const receipt = verifySkill({ skillPath: root, profile: "static" });
    assert.equal(receipt.status, "pass");
    assert.equal(receipt.gates.behavior.status, "na");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("positive delta cannot bypass absolute threshold", () => {
  const { tmp, root, workspace } = fixture();
  try {
    benchmark(workspace, sourceHash(root), 0.42, 0.29);
    const receipt = verifySkill({
      skillPath: root,
      profile: "evaluation",
      evaluation: workspace,
      testsStatus: "pass",
      humanReview: "pass",
    });
    assert.equal(receipt.gates.behavior.status, "fail");
    assert.equal(receipt.status, "fail");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("evaluation evidence is bound to current source hash", () => {
  const { tmp, root, workspace } = fixture();
  try {
    benchmark(workspace, "a".repeat(64));
    let receipt = verifySkill({
      skillPath: root,
      profile: "evaluation",
      evaluation: workspace,
      testsStatus: "pass",
      humanReview: "pass",
    });
    assert.equal(receipt.gates.behavior.status, "fail");

    const data = JSON.parse(requireText(join(workspace, "benchmark.json")));
    delete data.metadata.source_sha256;
    writeFileSync(join(workspace, "benchmark.json"), JSON.stringify(data));
    receipt = verifySkill({
      skillPath: root,
      profile: "release",
      evaluation: workspace,
      testsStatus: "pass",
      triggeringStatus: "pass",
      humanReview: "pass",
    });
    assert.equal(receipt.gates.behavior.status, "blocked");
    assert.equal(receipt.status, "blocked");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function requireText(path: string): string {
  return readFileSync(path, "utf8");
}

test("invalid runtime choices and numeric values are rejected", () => {
  const { tmp, root } = fixture();
  try {
    assert.throws(() => verifySkill({ skillPath: root, profile: "typo" }), /profile must be/);
    assert.throws(
      () => verifySkill({ skillPath: root, profile: "static", testsStatus: "yes" }),
      /tests status must be/,
    );
    assert.throws(
      () => verifySkill({ skillPath: root, profile: "static", humanReview: "yes" }),
      /human review must be/,
    );
    assert.throws(
      () => verifySkill({ skillPath: root, profile: "static", minPassRate: Number.NaN }),
      /finite number/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("non-finite and out-of-range benchmark pass rates fail closed", () => {
  const { tmp, root, workspace } = fixture();
  try {
    benchmark(workspace, sourceHash(root), 1.1, 0.7);
    const receipt = verifySkill({
      skillPath: root,
      profile: "evaluation",
      evaluation: workspace,
      testsStatus: "pass",
      humanReview: "pass",
    });
    assert.equal(receipt.gates.behavior.status, "fail");
    assert.match(receipt.gates.behavior.reason ?? "", /finite/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function createRun(runDir: string, passRate = 1): void {
  mkdirSync(join(runDir, "outputs"), { recursive: true });
  writeFileSync(join(runDir, "outputs", "result.txt"), "ok");
  writeFileSync(
    join(runDir, "grading.json"),
    JSON.stringify({
      summary: { pass_rate: passRate },
      expectations: [{ text: "works", passed: true, evidence: "result" }],
    }),
  );
  writeFileSync(join(runDir, "timing.json"), "{}");
}

for (const legacy of [false, true]) {
  test(`evaluation receipt accepts ${legacy ? "legacy runs/" : "run-N"} layout`, () => {
    const { tmp, workspace } = fixture();
    try {
      const evalRoot = legacy ? join(workspace, "runs", "eval-1") : join(workspace, "eval-1");
      mkdirSync(evalRoot, { recursive: true });
      writeFileSync(join(evalRoot, "eval_metadata.json"), "{}");
      for (const config of ["with_skill", "without_skill"]) {
        const configDir = join(evalRoot, config);
        createRun(legacy ? configDir : join(configDir, "run-1"));
        if (!legacy) createRun(join(configDir, "run-2"));
      }
      writeFileSync(
        join(workspace, "benchmark.json"),
        JSON.stringify({
          run_summary: {
            with_skill: { pass_rate: { mean: 1 } },
            without_skill: { pass_rate: { mean: 0.5 } },
          },
        }),
      );
      writeFileSync(join(workspace, "benchmark.md"), "summary");
      writeFileSync(join(workspace, "review.html"), "review");
      assert.equal(validateEvaluationReceipt(workspace).status, "complete");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
