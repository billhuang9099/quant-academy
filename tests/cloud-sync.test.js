import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPayload,
  captureProgress,
  emptyEnvelope,
  mergeEnvelopes,
  parsePayload,
  projectProgress
} from "../src/cloud-sync/model.js";

const progress = (overrides = {}) => ({
  completed: [], answers: {}, verified: [], lastModule: "foundations", lastLesson: 0, ...overrides
});

test("captureProgress 将本地学习状态转换为可合并事件", () => {
  const envelope = captureProgress(
    emptyEnvelope("A"),
    progress(),
    progress({ completed: ["foundations-0"], answers: { "foundations-0": "2" }, verified: ["foundations-0"] }),
    100,
    "A"
  );
  assert.deepEqual(projectProgress(envelope), progress({
    completed: ["foundations-0"], answers: { "foundations-0": "2" }, verified: ["foundations-0"]
  }));
});

test("多设备修改按字段合并，不互相整包覆盖", () => {
  const a = captureProgress(emptyEnvelope("A"), progress(), progress({ completed: ["foundations-0"] }), 100, "A");
  const b = captureProgress(emptyEnvelope("B"), progress(), progress({ answers: { "risk-return-0": "1" } }), 110, "B");
  const merged = mergeEnvelopes(a, b);
  assert.deepEqual(projectProgress(merged), progress({ completed: ["foundations-0"], answers: { "risk-return-0": "1" } }));
});

test("较新的取消完成状态可以覆盖旧设备记录", () => {
  const first = captureProgress(emptyEnvelope("A"), progress(), progress({ completed: ["foundations-0"] }), 100, "A");
  const removed = captureProgress(first, progress({ completed: ["foundations-0"] }), progress(), 200, "A");
  const staleRemote = captureProgress(emptyEnvelope("B"), progress(), progress({ completed: ["foundations-0"] }), 150, "B");
  assert.deepEqual(projectProgress(mergeEnvelopes(removed, staleRemote)).completed, []);
});

test("相同时间戳使用 deviceId 稳定决胜，合并顺序不影响结果", () => {
  const left = captureProgress(emptyEnvelope("A"), progress(), progress({ answers: { q1: "左" } }), 100, "A");
  const right = captureProgress(emptyEnvelope("Z"), progress(), progress({ answers: { q1: "右" } }), 100, "Z");
  assert.equal(projectProgress(mergeEnvelopes(left, right)).answers.q1, "右");
  assert.equal(projectProgress(mergeEnvelopes(right, left)).answers.q1, "右");
});

test("云端载荷只包含学习事件，不包含 Token", () => {
  const envelope = captureProgress(emptyEnvelope("A"), progress(), progress({ completed: ["foundations-0"] }), 100, "A");
  const payload = buildPayload(envelope);
  assert.ok(!payload.toLowerCase().includes("token"));
  assert.deepEqual(projectProgress(parsePayload(payload)).completed, ["foundations-0"]);
});

test("无效或不兼容同步文件会被拒绝", () => {
  assert.throws(() => parsePayload("not-json"), /有效 JSON/);
  assert.throws(() => parsePayload(JSON.stringify({ schemaVersion: 99 })), /版本不兼容/);
});

test("学习作答事件、预备营和复习计划均可跨设备合并", () => {
  const left = emptyEnvelope("A");
  left.learning.attempts.push({ id: "a1", questionId: "foundations-0", moduleId: "foundations", answer: "0", correct: false, at: 100, deviceId: "A", source: "module" });
  left.learning.reviews["foundations-0"] = { value: { questionId: "foundations-0", moduleId: "foundations", prompt: "测试", nextReviewAt: 1000, stage: 0, lastResult: "wrong", mistakeCount: 1 }, at: 100, deviceId: "A" };
  const right = emptyEnvelope("B");
  right.learning.attempts.push({ id: "b1", questionId: "python-2", moduleId: "python", answer: "rolling", correct: true, at: 200, deviceId: "B", source: "module" });
  right.learning.prep.environment = { value: true, at: 200, deviceId: "B" };
  const merged = mergeEnvelopes(left, right);
  assert.deepEqual(merged.learning.attempts.map(item => item.id), ["a1", "b1"]);
  assert.equal(merged.learning.prep.environment.value, true);
  assert.equal(merged.learning.reviews["foundations-0"].value.mistakeCount, 1);
});

test("旧版 schema v1 云进度可以无损升级到 v2", () => {
  const old = { ...emptyEnvelope("A"), schemaVersion: 1 };
  delete old.learning;
  const upgraded = parsePayload(JSON.stringify(old));
  assert.equal(upgraded.schemaVersion, 2);
  assert.deepEqual(upgraded.learning, { attempts: [], prep: {}, reviews: {} });
});
