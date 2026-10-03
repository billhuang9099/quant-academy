import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { MODULES, LESSONS, LESSON_BY_ID, PHASES } from '../src/academy/curriculum.js';

const nonempty = (value, label) => assert.ok(typeof value === 'string' && value.trim(), `${label} must be nonempty text`);
const validId = (value, label) => assert.match(value, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, label);

test('课程导航包含完整路径，模块、课节和题目 ID 唯一且索引一致', () => {
  assert.ok(MODULES.length >= 10, '课程应覆盖至少 10 个模块');
  assert.ok(LESSONS.length >= 30, '课程应包含至少 30 课');
  const ids = new Set();
  for (const module of MODULES) {
    validId(module.id, 'module id'); assert.ok(!ids.has(module.id)); ids.add(module.id);
    nonempty(module.title, `${module.id}.title`);
    assert.ok(Array.isArray(module.lessons) && module.lessons.length > 0);
    for (const lesson of module.lessons) {
      validId(lesson.id, 'lesson id'); assert.ok(!ids.has(lesson.id), lesson.id); ids.add(lesson.id);
      assert.equal(LESSON_BY_ID[lesson.id].moduleId, module.id);
      assert.equal(LESSONS[LESSONS.findIndex(item => item.id === lesson.id)], LESSON_BY_ID[lesson.id]);
      for (const question of lesson.checks) {
        validId(question.id, 'question id'); assert.ok(!ids.has(question.id), question.id); ids.add(question.id);
      }
    }
  }
  assert.equal(Object.keys(LESSON_BY_ID).length, LESSONS.length);
  assert.deepEqual(PHASES.map(phase => phase.id), ['concept', 'worked', 'lab', 'check', 'task']);
});

test('每课有概念、推导、实验、测验和可执行起步代码，引用为有效 HTTPS 地址', () => {
  for (const lesson of LESSONS) {
    nonempty(lesson.title, `${lesson.id}.title`);
    nonempty(lesson.goal, `${lesson.id}.goal`);
    assert.ok(Number.isFinite(lesson.minutes) && lesson.minutes > 0, lesson.id);
    assert.ok(Array.isArray(lesson.sections) && lesson.sections.length >= 3, lesson.id);
    for (const section of lesson.sections) { nonempty(section.title, lesson.id); nonempty(section.body, lesson.id); }
    nonempty(lesson.formula.expression, lesson.id);
    assert.ok(Array.isArray(lesson.worked.steps) && lesson.worked.steps.length >= 3, lesson.id);
    lesson.worked.steps.forEach(step => nonempty(step, lesson.id));
    nonempty(lesson.worked.result, lesson.id);
    nonempty(lesson.lab, lesson.id);
    assert.ok(Array.isArray(lesson.checks) && lesson.checks.length >= 2, lesson.id);
    nonempty(lesson.task.prompt, lesson.id);
    nonempty(lesson.task.deliverable, lesson.id);
    assert.ok(Array.isArray(lesson.task.rubric) && lesson.task.rubric.length >= 3, lesson.id);
    nonempty(lesson.task.starterCode, lesson.id);
    assert.ok(lesson.task.starterCode.includes('\n'), `${lesson.id} needs actual multiline code`);
    assert.doesNotMatch(lesson.task.starterCode, /^\s*(?:TODO|待实现|\.\.\.)\s*$/, lesson.id);
    assert.ok(Array.isArray(lesson.sources) && lesson.sources.length > 0, lesson.id);
    for (const source of lesson.sources) {
      nonempty(source.title, lesson.id);
      assert.equal(new URL(source.url).protocol, 'https:', `${lesson.id} source URL`);
    }
  }
});

test('每题答案可评阅：数值与容差有限，选择题答案指向实际选项', () => {
  for (const lesson of LESSONS) for (const question of lesson.checks) {
    nonempty(question.prompt, question.id); nonempty(question.explanation, question.id);
    assert.ok(['number', 'choice'].includes(question.type), question.id);
    assert.equal(typeof question.answer, 'number', question.id);
    assert.ok(Number.isFinite(question.answer), question.id);
    if (question.type === 'number') {
      assert.ok(Number.isFinite(question.tolerance) && question.tolerance >= 0, question.id);
    } else {
      assert.ok(Array.isArray(question.options) && question.options.length >= 2, question.id);
      question.options.forEach(option => nonempty(option, question.id));
      assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < question.options.length, question.id);
      if (question.wrongExplanations) assert.equal(question.wrongExplanations.length, question.options.length, question.id);
    }
  }
});

// Python is optional for Node-only consumers, but available teaching environments run these regressions.
const python = ['python3', 'python'].find(command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0);
function runPython(code) {
  const result = spawnSync(python, ['-B', '-c', code], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout;
}

test('波动仓位起步代码拒绝 NaN、无穷、非数值与陈旧数据，不会变成满仓', { skip: !python && 'Python is not installed' }, () => {
  runPython(LESSON_BY_ID['portfolio-risk-budget'].task.starterCode + `
for invalid in [float('nan'), float('inf'), -float('inf'), None, '0.2', True, 0, -0.2]:
    assert target_weight(invalid) is None, repr(invalid)
assert target_weight(0.2, False) is None
assert target_weight(0.2) == 0.5
assert target_weight(0.08) == 1.0
assert target_weight(0.02) == 1.0
`);
});

test('首课原例和改变输入后的独立手算断言都能运行', { skip: !python && 'Python is not installed' }, () => {
  const code = LESSON_BY_ID['python-environment'].task.starterCode;
  assert.match(runPython(code), /1050\.0/);
  const revised = code.replace('principal = 1000', 'principal = 2000').replace('rate = 0.05', 'rate = -0.03').replace('expected = 1050', 'expected = 1940');
  assert.match(runPython(revised), /1940\.0/);
});
