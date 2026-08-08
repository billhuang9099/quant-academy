import { test } from "node:test";
import assert from "node:assert/strict";
import { QUESTION_BY_ID } from "../src/learning/catalog.js";
import {
  emptyLearningState,
  learningSummary,
  recordAttempt,
  togglePrep,
  updateReview
} from "../src/learning/model.js";

const DAY = 24 * 60 * 60 * 1000;

test("答错后进入错题本并安排次日复习", () => {
  const now = 1_000_000;
  const state = recordAttempt(emptyLearningState(), QUESTION_BY_ID["foundations-0"], "0", now, "A");
  const review = state.reviews["foundations-0"].value;
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].correct, false);
  assert.equal(review.mistakeCount, 1);
  assert.equal(review.nextReviewAt, now + DAY);
});

test("同一模块按四道客观题最近结果计算掌握度和置信度", () => {
  let state = emptyLearningState();
  const answers = { "foundations-0": "2", "foundations-1": "1", "foundations-2": "错", "foundations-3": "1" };
  let at = 100;
  for (const [id, answer] of Object.entries(answers)) {
    state = recordAttempt(state, QUESTION_BY_ID[id], answer, at++, "A");
  }
  const module = learningSummary(state).modules.find(item => item.id === "foundations");
  assert.equal(module.correct, 3);
  assert.equal(module.mastery, 75);
  assert.equal(module.confidence, 100);
});

test("重复点击同一答案不会重复累计作答事件", () => {
  const question = QUESTION_BY_ID["python-2"];
  const first = recordAttempt(emptyLearningState(), question, "rolling", 100, "A");
  const second = recordAttempt(first, question, "rolling", 200, "A");
  assert.equal(second.attempts.length, 1);
});

test("复习答对后延长间隔，仍不确定则回到一天", () => {
  const question = QUESTION_BY_ID["backtesting-2"];
  const wrong = recordAttempt(emptyLearningState(), question, "样本", 100, "A");
  const right = updateReview(wrong, question.id, "right", 200, "A");
  assert.equal(right.reviews[question.id].value.stage, 1);
  assert.equal(right.reviews[question.id].value.nextReviewAt, 200 + 3 * DAY);
  const uncertain = updateReview(right, question.id, "uncertain", 300, "A");
  assert.equal(uncertain.reviews[question.id].value.stage, 0);
  assert.equal(uncertain.reviews[question.id].value.nextReviewAt, 300 + DAY);
});

test("Python 预备营完成状态可切换", () => {
  const done = togglePrep(emptyLearningState(), "environment", 100, "A");
  assert.equal(done.prep.environment.value, true);
  const undone = togglePrep(done, "environment", 200, "A");
  assert.equal(undone.prep.environment.value, false);
});
