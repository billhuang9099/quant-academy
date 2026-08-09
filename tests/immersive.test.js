import { test } from "node:test";
import assert from "node:assert/strict";
import { adjacentStage, buildStages, normalizeStage, stagePosition } from "../src/immersive/model.js";

test("沉浸式流程把导学、课节、术语、案例和每道测验拆成独立阶段", () => {
  const stages = buildStages(4, 5);
  assert.equal(stages.length, 12);
  assert.deepEqual(stages.map(stage => stage.id), [
    "overview", "lesson-0", "lesson-1", "lesson-2", "lesson-3",
    "concepts", "case", "quiz-0", "quiz-1", "quiz-2", "quiz-3", "quiz-4"
  ]);
});

test("无效阶段会恢复到最近课节", () => {
  const stages = buildStages(4, 5);
  assert.equal(normalizeStage("missing", stages, 2), "lesson-2");
  assert.equal(normalizeStage("quiz-3", stages, 0), "quiz-3");
});

test("上一阶段和下一阶段不会越界", () => {
  const stages = buildStages(2, 1);
  assert.equal(adjacentStage("overview", stages, -1).id, "overview");
  assert.equal(adjacentStage("lesson-0", stages, 1).id, "lesson-1");
  assert.equal(adjacentStage("quiz-0", stages, 1).id, "quiz-0");
});

test("阶段进度按当前位置计算", () => {
  const stages = buildStages(4, 5);
  assert.deepEqual(stagePosition("case", stages), { index: 6, total: 12, percent: 58 });
});
