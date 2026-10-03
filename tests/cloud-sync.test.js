import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPayload,
  captureProgress,
  emptyEnvelope,
  mergeEnvelopes,
  parsePayload,
  projectProgress,
  sanitizeEnvelope,
  SCHEMA_VERSION,
  MAX_ACADEMY_RECORDS
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

test("旧版 schema v1 云进度可以升级到当前版本且保留旧记录", () => {
  const old = { ...emptyEnvelope("A"), schemaVersion: 1 };
  delete old.learning;
  old.records.completed['foundations-0'] = { value: true, at: 10, deviceId: 'A' };
  const upgraded = parsePayload(JSON.stringify(old));
  assert.equal(upgraded.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(upgraded.learning, { attempts: [], prep: {}, reviews: {} });
  assert.equal(upgraded.records.completed['foundations-0'].value, true);
});

test('schema v2 兼容与 academy 类型过滤：坏结构不能进入新界面', () => {
  const envelope = emptyEnvelope('A'); envelope.schemaVersion = 2;
  envelope.academy = {
    'task:bad': { value: { text: 123, rubric: [] }, at: 1, deviceId: 'A' },
    'task:good': { value: { text: '合法草稿', rubric: [0, 0] }, at: 2, deviceId: 'A' },
    'project:code-run': { value: 'true', at: 3, deviceId: 'A' },
    'note:test': { value: '<script>untrusted text</script>', at: 4, deviceId: 'A' },
    'experiment:fake': { value: true, at: 5, deviceId: 'A' },
    location: { value: { lessonId: 'python-environment', phase: 'lab' }, at: 6, deviceId: 'A' },
  };
  const safe = sanitizeEnvelope(envelope);
  assert.equal(safe.schemaVersion, SCHEMA_VERSION);
  assert.equal(safe.academy['task:bad'], undefined);
  assert.equal(safe.academy['project:code-run'], undefined);
  assert.equal(safe.academy['experiment:fake'], undefined);
  assert.deepEqual(safe.academy['task:good'].value, { text: '合法草稿', rubric: [0] });
  assert.equal(safe.academy['note:test'].value, '<script>untrusted text</script>');
  assert.equal(safe.academy.location.value.phase, 'lab');
  assert.equal(safe.academy.location.value.section, 0);
});

test('概念分页断点支持 section 0..20，并兼容旧 location', () => {
  const envelope = emptyEnvelope('A');
  const location = section => ({ value: { lessonId: 'python-environment', phase: 'concept', section }, at: 1, deviceId: 'A' });
  for (const section of [0, 3, 20]) {
    envelope.academy.location = location(section);
    assert.equal(parsePayload(buildPayload(envelope)).academy.location.value.section, section);
  }
  for (const section of [undefined, -1, 21, 1.5, '3']) {
    envelope.academy.location = location(section);
    assert.equal(sanitizeEnvelope(envelope).academy.location.value.section, 0);
  }
});

test('600 条之后的记录仍保留；单条和总记录超限明确拒绝', () => {
  const envelope = emptyEnvelope('A');
  for (let i = 0; i < 601; i++) envelope.academy[`note:lesson-${i}`] = { value: `记录 ${i}`, at: i, deviceId: 'A' };
  assert.equal(Object.keys(parsePayload(buildPayload(envelope)).academy).length, 601);
  assert.equal(parsePayload(buildPayload(envelope)).academy['note:lesson-600'].value, '记录 600');
  envelope.academy['note:oversize'] = { value: 'x'.repeat(40001), at: 1, deviceId: 'A' };
  assert.throws(() => buildPayload(envelope), /单条大小上限/);
  delete envelope.academy['note:oversize'];
  for (let i = 601; i <= MAX_ACADEMY_RECORDS; i++) envelope.academy[`note:lesson-${i}`] = { value: 'x', at: i, deviceId: 'A' };
  assert.throws(() => sanitizeEnvelope(envelope), /数量超过上限/);
});

test('实验兼容净值数组和压缩标量指标，不能接受缺少运行字段的伪记录', () => {
  const envelope = emptyEnvelope('A');
  for (const [id, kind, summary] of [['one', 'compound', { equity: [1, 1.1, .99], totalReturn: -.01 }], ['two', 'backtest', { trainMetrics: { totalReturn: .01 }, dataset: 'synthetic-42' }]]) {
    envelope.academy[`experiment:${id}`] = { value: { kind, at: 1, observation: '观察'.repeat(20), parameters: { fast: 10 }, summary }, at: 1, deviceId: 'A' };
  }
  assert.equal(Object.keys(parsePayload(buildPayload(envelope)).academy).length, 2);
});

test('相同旧 writer 和时间戳仍确定性合并；序列化顺序稳定且防原型键', () => {
  const a = emptyEnvelope('A'), b = emptyEnvelope('A');
  a.academy['note:same'] = { value: 'alpha', at: 1, deviceId: 'old-writer' };
  b.academy['note:same'] = { value: 'beta', at: 1, deviceId: 'old-writer' };
  assert.equal(buildPayload(mergeEnvelopes(a, b)), buildPayload(mergeEnvelopes(b, a)));
  a.academy['note:z'] = { value: 'z', at: 2, deviceId: 'A' };
  b.academy['note:a'] = { value: 'a', at: 2, deviceId: 'A' };
  assert.equal(buildPayload(mergeEnvelopes(a, b)), buildPayload(mergeEnvelopes(b, a)));
  const attack = JSON.parse('{"schemaVersion":3,"academy":{"__proto__":{"value":null,"at":1,"deviceId":"A"}}}');
  assert.equal(Object.hasOwn(sanitizeEnvelope(attack).academy, '__proto__'), false);
});
