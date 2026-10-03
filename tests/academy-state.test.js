import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyEnvelope, buildPayload, parsePayload } from '../src/cloud-sync/model.js';
import { fetchGistContents, updateDeviceGist, createDeviceGist, deviceGistFilename } from '../src/cloud-sync/gist.js';
import { LESSONS } from '../src/academy/curriculum.js';

const KEY = 'q-academy-gist-envelope.v1';
let moduleNumber = 0;
function browser(initial = {}) {
  const values = new Map(Object.entries(initial));
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: { ...storage, getItem: () => null }, configurable: true });
  globalThis.window = new EventTarget();
  return { values, storage };
}
const stateModule = () => import(`../src/academy/state.js?test=${++moduleNumber}`);
function storageEvent(value, key = KEY) {
  const event = new Event('storage');
  Object.defineProperties(event, { key: { value: key }, newValue: { value } });
  window.dispatchEvent(event);
}

test('多标签写前合并、不同 writer、storage 修复与稳定序列化不丢独立字段', async () => {
  const { values } = browser({ 'q-academy-device-id': 'same-browser' });
  const a = await stateModule(), b = await stateModule();
  assert.equal(a.deviceId, b.deviceId); assert.notEqual(a.writerId, b.writerId);
  a.putValue('note:first', '来自 A');
  const onlyA = values.get(KEY);
  b.putValue('note:second', '来自 B');
  assert.deepEqual(Object.keys(parsePayload(values.get(KEY)).academy), ['note:first', 'note:second']);
  values.set(KEY, onlyA); storageEvent(onlyA);
  const healed = values.get(KEY);
  assert.deepEqual(Object.keys(parsePayload(healed).academy), ['note:first', 'note:second']);
  storageEvent(healed); assert.equal(values.get(KEY), healed);
  assert.equal(a.getValue('note:second'), '来自 B');
});

test('同毫秒连续更新按逻辑时间推进且不依赖时钟前进', async () => {
  browser(); const a = await stateModule(), b = await stateModule();
  const original = Date.now; Date.now = () => 1000;
  try {
    a.putValue('note:same', '第一版'); b.putValue('note:same', '第二版');
    assert.equal(a.getEnvelope().academy['note:same'].value, '第二版');
    assert.ok(b.getEnvelope().academy['note:same'].at > 1000);
  } finally { Date.now = original; }
});

test('损坏原始 JSON 在覆盖前另存备份并显示警告', async () => {
  const raw = '{broken JSON'; const { values } = browser({ [KEY]: raw });
  const state = await stateModule();
  assert.match(state.storageWarning, /原进度无法读取/);
  const backups = [...values].filter(([key]) => key.startsWith(`${KEY}.invalid.`));
  assert.equal(backups.length, 1); assert.equal(backups[0][1], raw);
  state.putValue('note:new', '新笔记');
  assert.equal(values.get(backups[0][0]), raw);
  assert.equal(parsePayload(values.get(KEY)).academy['note:new'].value, '新笔记');
});

test('超限与坏结构写入不改变上一版快照，导入坏作业也不会使状态计算崩溃', async () => {
  const { values } = browser(); const state = await stateModule();
  state.putValue('note:safe', '原来的完整笔记'); const before = values.get(KEY);
  assert.throws(() => state.putValue('note:safe', 'x'.repeat(40001)), /大小上限/);
  assert.throws(() => state.putValue('task:bad', { text: 123, rubric: [] }), /字段格式无效/);
  assert.equal(values.get(KEY), before); assert.equal(state.getValue('note:safe'), '原来的完整笔记');
  const incoming = emptyEnvelope('remote'); incoming.academy[`task:${LESSONS[0].id}`] = { value: { text: 123, rubric: [] }, at: 1, deviceId: 'remote' };
  state.importState(JSON.stringify(incoming));
  assert.doesNotThrow(() => state.lessonStatus(LESSONS[0]));
  assert.equal(state.lessonStatus(LESSONS[0]).task, false);
});

test('判题拒绝空白和布尔值，完成度依据答案而非可伪造的 correct 字段', async () => {
  browser(); const state = await stateModule(); const lesson = LESSONS[0], question = lesson.checks[0];
  assert.equal(state.grade({ type: 'number', answer: 0 }, '   '), false);
  assert.equal(state.grade({ type: 'number', answer: 0 }, false), false);
  assert.equal(state.grade({ type: 'number', answer: 0, tolerance: 0 }, '0.0000001'), false);
  state.putValue(`quiz:${question.id}`, { lessonId: lesson.id, answer: String(question.answer + 999), correct: true });
  assert.equal(state.getValue(`quiz:${question.id}`).correct, false);
  assert.equal(state.lessonStatus(lesson).right, 0);
  state.putValue(`quiz:${question.id}`, { lessonId: lesson.id, answer: String(question.answer), correct: false });
  assert.equal(state.getValue(`quiz:${question.id}`).correct, true);
  assert.equal(state.lessonStatus(lesson).right, 1);
  assert.equal(state.lessonStatus(lesson).complete, false);
});

test('复习到期前重复正确答案和数值等价答案不增加次数或拉长间隔，到期后才推进', async () => {
  const { values } = browser(); const state = await stateModule();
  const lesson = LESSONS[0], check = lesson.checks.find(question => question.type === 'number');
  assert.ok(check, '首课应有可测试数值等价答案的数值题');
  const original = Date.now; let now = 1000; Date.now = () => now;
  try {
    const first = state.answerQuestion(lesson, check, String(check.answer));
    assert.equal(first.stage, 0); assert.equal(first.attempts, 1); assert.equal(first.mistakes, 0);
    assert.equal(first.reviewAt, now + 86400000);
    const persisted = values.get(KEY);
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(state.answerQuestion(lesson, check, String(check.answer)), first);
      assert.deepEqual(state.answerQuestion(lesson, check, ` ${Number(check.answer).toFixed(2)} `), first);
    }
    assert.equal(values.get(KEY), persisted, '重复点击不应写入新的进度记录');
    now = first.reviewAt - 1;
    assert.deepEqual(state.answerQuestion(lesson, check, String(check.answer)), first);
    now = first.reviewAt;
    const reviewed = state.answerQuestion(lesson, check, String(check.answer));
    assert.equal(reviewed.stage, 1); assert.equal(reviewed.attempts, 2); assert.equal(reviewed.mistakes, 0);
    assert.equal(reviewed.reviewAt, now + 3 * 86400000);
  } finally { Date.now = original; }
});

test('复习到期前重复错误答案不累计错题次数，但修改为正确答案仍可提交', async () => {
  browser(); const state = await stateModule(); const lesson = LESSONS[0], check = lesson.checks[0];
  const original = Date.now; Date.now = () => 1000;
  try {
    const wrong = String(check.answer + 999);
    const first = state.answerQuestion(lesson, check, wrong);
    assert.equal(first.correct, false); assert.equal(first.attempts, 1); assert.equal(first.mistakes, 1);
    for (let i = 0; i < 5; i++) assert.deepEqual(state.answerQuestion(lesson, check, wrong), first);
    const corrected = state.answerQuestion(lesson, check, String(check.answer));
    assert.equal(corrected.correct, true); assert.equal(corrected.attempts, 2); assert.equal(corrected.mistakes, 1);
    assert.equal(state.lessonStatus(lesson).right, 1);
    assert.deepEqual(state.answerQuestion(lesson, check, String(check.answer)), corrected);
  } finally { Date.now = original; }
});

test('实验和作业按非空白 Unicode 字符计数，不能用空格换行或双码元字符凑字数', async () => {
  browser(); const state = await stateModule(); const lesson = LESSONS[0];
  for (const check of lesson.checks) state.answerQuestion(lesson, check, String(check.answer));
  const whitespace = ' \t\n\r\u3000';
  const experiment = { kind: lesson.lab, at: 1000, parameters: {}, summary: {} };
  const rubric = lesson.task.rubric.map((_, index) => index);
  state.putValue(`experiment:${lesson.id}`, { ...experiment, observation: ` ${'📊'.repeat(29)}${whitespace.repeat(10)}` });
  state.putValue(`task:${lesson.id}`, { text: `${'研'.repeat(79)}${whitespace.repeat(20)}`, rubric });
  assert.deepEqual(state.lessonStatus(lesson), { right: lesson.checks.length, total: lesson.checks.length, exercise: false, task: false, complete: false });
  state.putValue(`experiment:${lesson.id}`, { ...experiment, observation: `${'📊'.repeat(30)}${whitespace}` });
  assert.equal(state.lessonStatus(lesson).exercise, true); assert.equal(state.lessonStatus(lesson).complete, false);
  state.putValue(`task:${lesson.id}`, { text: `${'研'.repeat(80)}${whitespace}`, rubric });
  assert.equal(state.lessonStatus(lesson).task, true); assert.equal(state.lessonStatus(lesson).complete, true);
});

test('本地存储不可写时，内存回退可读取与导出且明确提示', async () => {
  const { storage } = browser(); storage.setItem = () => { throw new Error('quota'); };
  const state = await stateModule(); state.putValue('note:offline', '需要立即备份');
  assert.equal(state.getValue('note:offline'), '需要立即备份');
  assert.equal(parsePayload(state.exportState()).academy['note:offline'].value, '需要立即备份');
  assert.match(state.storageWarning, /本地存储失败/);
});

test('Gist 分设备写只更新所属文件，合并读取保留旧基线与其他设备', async () => {
  const files = { 'quant-academy-progress.json': { content: buildPayload(emptyEnvelope('legacy')) }, 'unrelated.txt': { content: 'do not touch' } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'PATCH') Object.assign(files, JSON.parse(options.body).files);
    if (options.method === 'POST') return { ok: true, json: async () => ({ id: 'abcde', ...JSON.parse(options.body) }) };
    return { ok: true, json: async () => ({ files }) };
  };
  try {
    await Promise.all([updateDeviceGist('fake', 'abcde', 'A', buildPayload(emptyEnvelope('A'))), updateDeviceGist('fake', 'abcde', 'B', buildPayload(emptyEnvelope('B')))]);
    assert.equal(files['unrelated.txt'].content, 'do not touch');
    assert.deepEqual((await fetchGistContents('fake', 'abcde')).map(file => file.filename).sort(), ['quant-academy-device-A.json', 'quant-academy-device-B.json', 'quant-academy-progress.json']);
    assert.equal(await createDeviceGist('fake', 'A', buildPayload(emptyEnvelope('A'))), 'abcde');
    assert.throws(() => deviceGistFilename('../unsafe'), /无效/);
  } finally { globalThis.fetch = originalFetch; }
});

test('同步 PATCH 期间的本地更改排队补传，旧基线保持不变且拉取不写远端', async () => {
  browser({ 'q-academy-device-id': 'sync-browser' });
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_name, work) => work() } }, configurable: true });
  const state = await import('../src/academy/state.js');
  const sync = await import('../src/academy/sync.js');
  const originalFetch = globalThis.fetch;
  const baseline = emptyEnvelope('legacy'); baseline.records.completed.old = { value: true, at: 1, deviceId: 'old' };
  const baselineText = buildPayload(baseline);
  const files = { 'quant-academy-progress.json': { content: baselineText } };
  let releasePatch, reachedPatch, patchCount = 0;
  const patchStarted = new Promise(resolve => { reachedPatch = resolve; });
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'PATCH') {
      patchCount++;
      if (patchCount === 1) { reachedPatch(); await new Promise(resolve => { releasePatch = resolve; }); }
      Object.assign(files, JSON.parse(options.body).files);
    }
    return { ok: true, json: async () => ({ files: structuredClone(files) }) };
  };
  try {
    sync.configureSync({ newToken: 'fake-test-token', gistId: 'abcde', sessionOnly: true });
    state.putValue('note:before', 'before');
    const first = sync.synchronize(); await patchStarted;
    state.putValue('note:during', 'during');
    const second = sync.synchronize(); releasePatch(); await Promise.all([first, second]);
    assert.equal(patchCount, 2);
    const remote = parsePayload(files[deviceGistFilename(state.deviceId)].content);
    assert.equal(remote.academy['note:before'].value, 'before');
    assert.equal(remote.academy['note:during'].value, 'during');
    assert.equal(files['quant-academy-progress.json'].content, baselineText);
    assert.equal(state.legacyCount(), 1);
    assert.ok(sync.syncConfig().lastSyncedAt);
    await sync.synchronize({ pullOnly: true }); assert.equal(patchCount, 2);
  } finally { sync.clearSync(); globalThis.fetch = originalFetch; }
});

const CONFIG = 'q-academy-gist-config.v1';
const syncModule = () => import(`../src/academy/sync.js?tab=${++moduleNumber}`);

test('另一标签断开连接会取消在途同步；旧 PATCH 完成不会复活持久 Token 或 Gist', async () => {
  const { values } = browser();
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_name, work) => work() } }, configurable: true });
  const a = await syncModule();
  a.configureSync({ newToken: 'persistent-secret-for-regression', gistId: 'abcde', sessionOnly: false });
  const b = await syncModule();
  const originalFetch = globalThis.fetch;
  let reached, release, requests = 0;
  const started = new Promise(resolve => { reached = resolve; });
  globalThis.fetch = async (_url, options = {}) => {
    requests++;
    if (options.method === 'PATCH') { reached(); await new Promise(resolve => { release = resolve; }); }
    return { ok: true, json: async () => ({ files: { 'quant-academy-progress.json': { content: buildPayload(emptyEnvelope('remote')) } } }) };
  };
  try {
    const syncing = a.synchronize(); await started;
    b.clearSync(); storageEvent(values.get(CONFIG), CONFIG);
    assert.equal(a.syncConfig().hasToken, false);
    release(); await assert.rejects(syncing, /同步配置已改变/);
    assert.equal(a.syncConfig().gistId, '');
    assert.equal(b.syncConfig().hasToken, false);
    assert.ok(!values.get(CONFIG).includes('persistent-secret-for-regression'));
    assert.ok(!values.get(CONFIG).includes('abcde'));
    const before = requests;
    await assert.rejects(a.synchronize(), /请先填写/);
    window.dispatchEvent(new CustomEvent('academy-change', { detail: { key: 'note:after-clear' } }));
    assert.equal(requests, before);
  } finally { a.clearSync(); b.clearSync(); globalThis.fetch = originalFetch; }
});

test('等待同步锁时即使 storage 事件尚未到达也重新检查配置，断开后不发网络请求', async () => {
  browser(); let startWork;
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: (_name, work) => new Promise((resolve, reject) => { startWork = () => Promise.resolve().then(work).then(resolve, reject); }) } }, configurable: true });
  const a = await syncModule(); a.configureSync({ newToken: 'old-token', gistId: 'abcde', sessionOnly: false });
  const b = await syncModule();
  let requests = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests++; throw new Error('unexpected network'); };
  try {
    const pending = a.synchronize();
    b.clearSync(); // Deliberately no storage event: lock acquisition must still see revocation.
    startWork(); await assert.rejects(pending, /同步配置已改变/);
    assert.equal(requests, 0); assert.equal(a.syncConfig().hasToken, false);
  } finally { a.clearSync(); b.clearSync(); globalThis.fetch = originalFetch; }
});

test('lastSyncedAt 元数据变化不取消正常同步，完成仅写无凭证状态记录', async () => {
  const { values } = browser();
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_name, work) => work() } }, configurable: true });
  const a = await syncModule(); a.configureSync({ newToken: 'safe-test-token', gistId: 'abcde', sessionOnly: false });
  const credentials = values.get(CONFIG);
  let reached, release, patches = 0; const started = new Promise(resolve => { reached = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'PATCH') patches++;
    else { reached(); await new Promise(resolve => { release = resolve; }); }
    return { ok: true, json: async () => ({ files: { 'quant-academy-progress.json': { content: buildPayload(emptyEnvelope('remote')) } } }) };
  };
  try {
    const syncing = a.synchronize(); await started;
    const next = { ...JSON.parse(credentials), lastSyncedAt: 100 };
    values.set(CONFIG, JSON.stringify(next)); storageEvent(values.get(CONFIG), CONFIG);
    release(); await syncing;
    assert.equal(patches, 1); assert.equal(a.syncConfig().hasToken, true);
    assert.equal(values.get(CONFIG), JSON.stringify(next));
    const metadata = values.get(`${CONFIG}.status`);
    assert.ok(metadata); assert.ok(!metadata.includes('safe-test-token'));
  } finally { a.clearSync(); globalThis.fetch = originalFetch; }
});

test('同连接两标签首次同步复用创建出的 Gist，仅创建一次且不重写凭证', async () => {
  const { values } = browser(); let queue = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: (_name, work) => { const result = queue.then(work); queue = result.catch(() => {}); return result; } } }, configurable: true });
  const a = await syncModule(); a.configureSync({ newToken: 'create-test-token', gistId: '', sessionOnly: false });
  const b = await syncModule(); const credentials = values.get(CONFIG);
  const originalFetch = globalThis.fetch; let posts = 0, patches = 0; let files = {};
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'POST') { posts++; files = JSON.parse(options.body).files; return { ok: true, json: async () => ({ id: 'abcde' }) }; }
    if (options.method === 'PATCH') { patches++; Object.assign(files, JSON.parse(options.body).files); }
    return { ok: true, json: async () => ({ files: structuredClone(files) }) };
  };
  try {
    await Promise.all([a.synchronize(), b.synchronize()]);
    assert.equal(posts, 1); assert.equal(patches, 1);
    assert.equal(a.syncConfig().gistId, 'abcde'); assert.equal(b.syncConfig().gistId, 'abcde');
    assert.equal(values.get(CONFIG), credentials);
    assert.ok(!values.get(`${CONFIG}.created`).includes('create-test-token'));
  } finally { a.clearSync(); b.clearSync(); globalThis.fetch = originalFetch; }
});
