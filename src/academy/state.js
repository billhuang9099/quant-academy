import { emptyEnvelope, sanitizeEnvelope, sanitizeAcademyRecord, mergeEnvelopes, buildPayload, parsePayload, captureProgress } from '../cloud-sync/model.js';
import { LESSONS } from './curriculum.js';

const KEY = 'q-academy-gist-envelope.v1';
const DEVICE = 'q-academy-device-id';
const memory = new Map();
const questions = new Map(LESSONS.flatMap(lesson => lesson.checks.map(check => [check.id, check])));
export let storageWarning = '';
export function readLocal(key) {
  if (memory.has(key)) return memory.get(key);
  try { return localStorage.getItem(key); }
  catch { storageWarning = '浏览器禁止本地存储，请导出备份后再关闭页面。'; return null; }
}
export function writeLocal(key, value) {
  try { localStorage.setItem(key, value); memory.delete(key); return true; }
  catch { memory.set(key, value); storageWarning = '本地存储失败，请立即导出备份；当前更改仅在此页面内保留。'; return false; }
}
export function jsonLocal(key, fallback) {
  try { return JSON.parse(readLocal(key)) ?? fallback; } catch { return fallback; }
}
const savedDevice = readLocal(DEVICE);
export const deviceId = /^[a-zA-Z0-9_-]{1,100}$/.test(savedDevice || '') ? savedDevice : crypto.randomUUID();
writeLocal(DEVICE, deviceId);
// Tabs share a cloud shard, but unique writers break timestamp ties deterministically.
export const writerId = `${deviceId.slice(0, 60)}:${crypto.randomUUID()}`;
let lastDamagedRaw = null;
function backupDamaged(raw, error) {
  if (raw !== lastDamagedRaw) {
    const backupKey = `${KEY}.invalid.${Date.now()}`;
    const persisted = writeLocal(backupKey, raw);
    lastDamagedRaw = raw;
    storageWarning = `原进度无法读取（${error.message}）。原文已${persisted ? '另存' : '临时保留'}于 ${backupKey}；请保留该备份后再处理。`;
  }
}
function readDisk() {
  const raw = readLocal(KEY);
  if (!raw) return emptyEnvelope(deviceId);
  try { return parsePayload(raw); }
  catch (error) { backupDamaged(raw, error); return emptyEnvelope(deviceId); }
}
let state = readDisk();
const legacy = jsonLocal('q-academy-progress', null);
if (legacy && !state.records.location) state = captureProgress(state, {}, legacy, Date.now(), writerId);
state.deviceId = deviceId;
function latestState() {
  const merged = mergeEnvelopes(state, readDisk());
  merged.deviceId = deviceId;
  return merged;
}
function commit(candidate) {
  // Validate before replacing either the in-memory state or the last good persisted snapshot.
  candidate.deviceId = deviceId;
  const payload = buildPayload(candidate);
  writeLocal(KEY, payload);
  state = sanitizeEnvelope(candidate);
}
export function getValue(key, fallback = null) {
  const value = state.academy[key]?.value ?? fallback;
  if (key.startsWith('quiz:') && value && typeof value === 'object') {
    const check = questions.get(key.slice(5));
    if (check) return { ...value, correct: grade(check, value.answer) };
  }
  return value;
}
export function getRecords(prefix = '') {
  return Object.entries(state.academy).filter(([key, record]) => key.startsWith(prefix) && record.value !== null);
}
export function getEnvelope() {
  const candidate = latestState(); buildPayload(candidate);
  state = candidate; return structuredClone(state);
}
export function persist() { commit(latestState()); }
export function putValue(key, value) {
  const candidate = latestState();
  const previous = candidate.academy[key];
  const at = Math.max(Date.now(), candidate.updatedAt + 1, (previous?.at || 0) + 1);
  const record = sanitizeAcademyRecord(key, { value, at, deviceId: writerId });
  if (!record) throw new Error(`学习记录 ${key} 的字段格式无效，原记录未被替换`);
  candidate.academy[key] = record;
  candidate.updatedAt = at;
  commit(candidate);
  window.dispatchEvent(new CustomEvent('academy-change', { detail: { key } }));
}
export function mergeState(incoming) {
  commit(mergeEnvelopes(latestState(), incoming));
  window.dispatchEvent(new CustomEvent('academy-remote'));
}
export function exportState() { return buildPayload(latestState()); }
export function importState(text) { mergeState(parsePayload(text)); }
export function legacyCount() { return Object.values(state.records.completed).filter(record => record.value).length; }
globalThis.window?.addEventListener('storage', event => {
  if (event.key !== KEY || !event.newValue) return;
  try {
    const incoming = parsePayload(event.newValue);
    const candidate = mergeEnvelopes(latestState(), incoming);
    candidate.deviceId = deviceId;
    const payload = buildPayload(candidate);
    const before = buildPayload(state);
    if (payload !== readLocal(KEY)) writeLocal(KEY, payload);
    state = candidate;
    if (payload !== before) {
      window.dispatchEvent(new CustomEvent('academy-remote'));
      window.dispatchEvent(new CustomEvent('academy-change', { detail: { external: true } }));
    }
  } catch (error) { backupDamaged(event.newValue, error); }
});
export function grade(check, answer) {
  if (answer == null || typeof answer === 'boolean' || String(answer).trim() === '') return false;
  const number = Number(answer);
  const tolerance = check.type === 'number' ? (check.tolerance ?? 0.000001) : 0;
  return Number.isFinite(number) && Number.isFinite(Number(check.answer)) && Math.abs(number - Number(check.answer)) <= tolerance;
}
export function answerQuestion(lesson, check, answer) {
  const key = `quiz:${check.id}`;
  state = latestState();
  const old = getValue(key, {});
  const correct = grade(check, answer);
  // Repeated clicks before a review is due are not new spaced-retrieval evidence.
  if (old.reviewAt > Date.now() && (old.answer === String(answer) || (old.correct && correct))) return old;
  const stage = correct ? Math.min(4, (old.stage ?? -1) + 1) : 0;
  const days = [1, 3, 7, 14, 30];
  const value = { lessonId: lesson.id, answer: String(answer), correct,
    attempts: (old.attempts || 0) + 1, mistakes: (old.mistakes || 0) + (correct ? 0 : 1),
    stage, reviewAt: Date.now() + days[stage] * 86400000 };
  putValue(key, value); return value;
}
export function lessonStatus(lesson) {
  const right = lesson.checks.filter(check => grade(check, getValue(`quiz:${check.id}`)?.answer)).length;
  const experiment = getValue(`experiment:${lesson.id}`);
  const exercise = !!experiment && typeof experiment.observation === 'string' && [...experiment.observation.replace(/\s/g,'')].length >= 30
    && experiment.kind === lesson.lab && !!experiment.parameters && !!experiment.summary && Number.isFinite(experiment.at);
  const submission = getValue(`task:${lesson.id}`, {});
  const task = typeof submission.text === 'string' && [...submission.text.replace(/\s/g,'')].length >= 80
    && Array.isArray(submission.rubric) && lesson.task.rubric.every((_, index) => submission.rubric.includes(index));
  return { right, total: lesson.checks.length, exercise, task, complete: right === lesson.checks.length && exercise && task };
}
export function downloadFile(name, contents, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
