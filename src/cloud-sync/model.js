export const SCHEMA_VERSION = 3;
export const MAX_PAYLOAD_BYTES = 900 * 1024;
export const MAX_ACADEMY_RECORDS = 10000;
export const MAX_ACADEMY_VALUE_CHARS = 40000;

const MAX_RECORDS = 200;
const MAX_LEARNING_ATTEMPTS = 1000;
const DEFAULT_PROGRESS = {
  completed: [],
  answers: {},
  verified: [],
  lastModule: "foundations",
  lastLesson: 0
};

function cleanString(value, max = 5000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function cleanIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === "string").map(item => item.slice(0, 100)))].slice(0, MAX_RECORDS);
}

export function normalizeProgress(input) {
  const source = input && typeof input === "object" ? input : {};
  const answers = {};
  for (const [key, value] of Object.entries(source.answers || {}).slice(0, MAX_RECORDS)) {
    if (typeof key === "string" && typeof value === "string") answers[key.slice(0, 100)] = cleanString(value);
  }
  return {
    completed: cleanIds(source.completed),
    answers,
    verified: cleanIds(source.verified),
    lastModule: cleanString(source.lastModule, 100) || DEFAULT_PROGRESS.lastModule,
    lastLesson: Number.isInteger(source.lastLesson) && source.lastLesson >= 0 && source.lastLesson < 100
      ? source.lastLesson
      : DEFAULT_PROGRESS.lastLesson
  };
}

export function emptyEnvelope(deviceId = "unknown") {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: 0,
    records: { completed: {}, verified: {}, answers: {}, location: null },
    learning: { attempts: [], prep: {}, reviews: {} },
    academy: {},
    deviceId: cleanString(deviceId, 100) || "unknown"
  };
}

function sanitizeLearningRecord(record, kind) {
  if (!record || typeof record !== "object" || !Number.isFinite(record.at)) return null;
  let value;
  if (kind === "prep") {
    value = !!record.value;
  } else {
    const source = record.value && typeof record.value === "object" ? record.value : {};
    value = {
      questionId: cleanString(source.questionId, 100),
      moduleId: cleanString(source.moduleId, 100),
      prompt: cleanString(source.prompt, 500),
      nextReviewAt: Number.isFinite(source.nextReviewAt) ? Math.max(0, source.nextReviewAt) : 0,
      stage: Number.isInteger(source.stage) ? Math.max(0, Math.min(4, source.stage)) : 0,
      lastResult: ["wrong", "right", "uncertain"].includes(source.lastResult) ? source.lastResult : "wrong",
      mistakeCount: Number.isInteger(source.mistakeCount) ? Math.max(0, source.mistakeCount) : 0
    };
  }
  return { value, at: Math.max(0, record.at), deviceId: cleanString(record.deviceId, 100) || "unknown" };
}

function sanitizeLearningMap(input, kind) {
  const output = {};
  if (!input || typeof input !== "object") return output;
  for (const [key, record] of Object.entries(input).slice(0, MAX_RECORDS)) {
    const safe = sanitizeLearningRecord(record, kind);
    if (safe) output[key.slice(0, 100)] = safe;
  }
  return output;
}

export function sanitizeLearningState(input) {
  const source = input && typeof input === "object" ? input : {};
  const attempts = [];
  for (const attempt of Array.isArray(source.attempts) ? source.attempts.slice(-MAX_LEARNING_ATTEMPTS) : []) {
    if (!attempt || typeof attempt !== "object" || typeof attempt.id !== "string" || typeof attempt.questionId !== "string") continue;
    attempts.push({
      id: attempt.id.slice(0, 120),
      questionId: attempt.questionId.slice(0, 100),
      moduleId: cleanString(attempt.moduleId, 100),
      answer: cleanString(attempt.answer),
      correct: !!attempt.correct,
      at: Number.isFinite(attempt.at) ? Math.max(0, attempt.at) : 0,
      deviceId: cleanString(attempt.deviceId, 100) || "unknown",
      source: attempt.source === "review" ? "review" : "module"
    });
  }
  return {
    attempts,
    prep: sanitizeLearningMap(source.prep, "prep"),
    reviews: sanitizeLearningMap(source.reviews, "review")
  };
}

function sanitizeRecord(record, kind) {
  if (!record || typeof record !== "object" || !Number.isFinite(record.at)) return null;
  let value;
  if (kind === "flag") value = !!record.value;
  else if (kind === "answer") value = record.value === null ? null : cleanString(record.value);
  else {
    if (!record.value || typeof record.value !== "object") return null;
    value = {
      lastModule: cleanString(record.value.lastModule, 100) || DEFAULT_PROGRESS.lastModule,
      lastLesson: Number.isInteger(record.value.lastLesson) ? record.value.lastLesson : 0
    };
  }
  return { value, at: Math.max(0, record.at), deviceId: cleanString(record.deviceId, 100) || "unknown" };
}

function sanitizeRecordMap(input, kind) {
  const output = {};
  if (!input || typeof input !== "object") return output;
  for (const [key, record] of Object.entries(input).slice(0, MAX_RECORDS)) {
    const safe = sanitizeRecord(record, kind);
    if (safe) output[key.slice(0, 100)] = safe;
  }
  return output;
}

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const textWithin = (value, max) => typeof value === 'string' && value.length <= max;
const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
function safeJSON(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => safeJSON(item, depth + 1));
  return plainObject(value) && Object.entries(value).every(([key, item]) =>
    !['__proto__', 'prototype', 'constructor'].includes(key) && safeJSON(item, depth + 1));
}

/** Validate the data consumed by the new UI. Invalid structures never reach renderers. */
export function sanitizeAcademyValue(key, value) {
  if (value === null) return null; // A tombstone must survive merges.
  if (key === 'location') {
    if (!plainObject(value) || !identifier(value.lessonId) || !['concept', 'worked', 'lab', 'check', 'task'].includes(value.phase)) return undefined;
    return { lessonId: value.lessonId, phase: value.phase,
      section: Number.isInteger(value.section) && value.section >= 0 && value.section <= 20 ? value.section : 0 };
  }
  const [prefix, id, ...extra] = key.split(':');
  if (!id || extra.length || !identifier(id)) return undefined;
  if (prefix === 'note') return textWithin(value, 12000) ? value : undefined;
  if (prefix === 'project') {
    if (['code-run', 'drill'].includes(id)) return typeof value === 'boolean' ? value : undefined;
    if (['hypothesis', 'data', 'method', 'results', 'risk', 'operations', 'code-notes', 'drill-notes'].includes(id)) return textWithin(value, 12000) ? value : undefined;
    return undefined;
  }
  if (!plainObject(value)) return undefined;
  if (prefix === 'quiz') {
    if (!identifier(value.lessonId) || !textWithin(value.answer, 1000)) return undefined;
    return { lessonId: value.lessonId, answer: value.answer, correct: value.correct === true,
      attempts: counter(value.attempts), mistakes: counter(value.mistakes),
      stage: Number.isInteger(value.stage) ? Math.max(0, Math.min(4, value.stage)) : 0,
      reviewAt: nonnegative(value.reviewAt) ? value.reviewAt : 0 };
  }
  if (prefix === 'task') {
    if (!textWithin(value.text, 12000) || !Array.isArray(value.rubric) || value.rubric.some(index => !Number.isInteger(index) || index < 0 || index > 100)) return undefined;
    return { text: value.text, rubric: [...new Set(value.rubric)] };
  }
  if (prefix === 'experiment') {
    if (!['compound', 'risk', 'cost', 'leakage', 'backtest', 'portfolio', 'execution'].includes(value.kind)
      || !nonnegative(value.at) || !textWithin(value.observation, 6000)
      || !plainObject(value.parameters) || !plainObject(value.summary) || !safeJSON(value.parameters) || !safeJSON(value.summary)) return undefined;
    return { kind: value.kind, at: value.at, observation: value.observation,
      parameters: structuredClone(value.parameters), summary: structuredClone(value.summary) };
  }
  if (prefix === 'holdout') {
    if (!nonnegative(value.at) || !plainObject(value.parameters) || !safeJSON(value.parameters)) return undefined;
    return { at: value.at, parameters: structuredClone(value.parameters) };
  }
  if (prefix === 'journal') {
    if (!validDay(id) || value.date !== id || typeof value.equity !== 'number' || !Number.isFinite(value.equity) || value.equity <= 0
      || !nonnegative(value.difference) || !textWithin(value.note, 6000) || !textWithin(value.evidence, 2000)
      || typeof value.tradingDay !== 'boolean' || typeof value.reconciled !== 'boolean') return undefined;
    return { date: id, equity: value.equity, difference: value.difference, note: value.note, evidence: value.evidence,
      tradingDay: value.tradingDay, reconciled: value.reconciled && value.difference === 0 };
  }
  return undefined;
}

export function sanitizeAcademyRecord(key, record) {
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)
    || !plainObject(record) || !Number.isFinite(record.at)) return null;
  const serialized = JSON.stringify(record.value ?? null);
  if (serialized.length > MAX_ACADEMY_VALUE_CHARS) throw new Error(`学习记录 ${key} 超过单条大小上限；请缩短内容或仅保存实验摘要，原记录未被替换`);
  const value = sanitizeAcademyValue(key, record.value ?? null);
  if (value === undefined) return null;
  return { value, at: Math.max(0, record.at), deviceId: cleanString(record.deviceId, 100) || 'unknown' };
}

export function sanitizeEnvelope(input) {
  if (!input || typeof input !== "object") throw new Error("同步数据不是有效对象");
  if (![1, 2, SCHEMA_VERSION].includes(input.schemaVersion)) throw new Error("同步数据版本不兼容");
  const envelope = emptyEnvelope(input.deviceId);
  envelope.updatedAt = Number.isFinite(input.updatedAt) ? Math.max(0, input.updatedAt) : 0;
  envelope.records.completed = sanitizeRecordMap(input.records?.completed, "flag");
  envelope.records.verified = sanitizeRecordMap(input.records?.verified, "flag");
  envelope.records.answers = sanitizeRecordMap(input.records?.answers, "answer");
  envelope.records.location = sanitizeRecord(input.records?.location, "location");
  envelope.learning = sanitizeLearningState(input.learning);
  const academyEntries = Object.entries(input.academy || {});
  if (academyEntries.length > MAX_ACADEMY_RECORDS) throw new Error('学习记录数量超过上限，请先导出备份；未删除任何记录');
  for (const [key, record] of academyEntries) {
    const safe = sanitizeAcademyRecord(key, record);
    if (safe) envelope.academy[key] = safe;
  }
  return envelope;
}

function newer(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (left.at !== right.at) return left.at > right.at ? left : right;
  if (String(left.deviceId) !== String(right.deviceId)) return String(left.deviceId) > String(right.deviceId) ? left : right;
  // Old clients may reuse the same writer and millisecond. Make even that tie commutative.
  return JSON.stringify(canonical(left.value)) >= JSON.stringify(canonical(right.value)) ? left : right;
}

function mergeMap(left, right) {
  const output = {};
  for (const key of new Set([...Object.keys(left || {}), ...Object.keys(right || {})])) {
    output[key] = newer(left?.[key], right?.[key]);
  }
  return output;
}

function mergeAttempts(left, right) {
  const byId = new Map();
  for (const attempt of [...(left || []), ...(right || [])]) {
    if (!byId.has(attempt.id)) byId.set(attempt.id, attempt);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-MAX_LEARNING_ATTEMPTS);
}

export function mergeEnvelopes(local, remote) {
  const left = sanitizeEnvelope(local);
  const right = sanitizeEnvelope(remote);
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
    deviceId: left.deviceId,
    academy: mergeMap(left.academy, right.academy),
    records: {
      completed: mergeMap(left.records.completed, right.records.completed),
      verified: mergeMap(left.records.verified, right.records.verified),
      answers: mergeMap(left.records.answers, right.records.answers),
      location: newer(left.records.location, right.records.location)
    },
    learning: {
      attempts: mergeAttempts(left.learning.attempts, right.learning.attempts),
      prep: mergeMap(left.learning.prep, right.learning.prep),
      reviews: mergeMap(left.learning.reviews, right.learning.reviews)
    }
  };
}

export function projectProgress(envelope) {
  const safe = sanitizeEnvelope(envelope);
  const completed = Object.entries(safe.records.completed).filter(([, record]) => record.value).map(([key]) => key).sort();
  const verified = Object.entries(safe.records.verified).filter(([, record]) => record.value).map(([key]) => key).sort();
  const answers = {};
  for (const [key, record] of Object.entries(safe.records.answers)) {
    if (record.value !== null) answers[key] = record.value;
  }
  return normalizeProgress({
    completed,
    verified,
    answers,
    ...(safe.records.location?.value || {})
  });
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function captureFlags(records, before, after, at, deviceId) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  for (const key of new Set([...beforeSet, ...afterSet])) {
    const previousValue = beforeSet.has(key);
    const nextValue = afterSet.has(key);
    if (previousValue !== nextValue || !records[key]) records[key] = { value: nextValue, at, deviceId };
  }
}

export function captureProgress(envelope, previousProgress, currentProgress, at = Date.now(), deviceId) {
  const safe = sanitizeEnvelope(envelope);
  const before = normalizeProgress(previousProgress);
  const after = normalizeProgress(currentProgress);
  const owner = cleanString(deviceId || safe.deviceId, 100) || "unknown";

  captureFlags(safe.records.completed, before.completed, after.completed, at, owner);
  captureFlags(safe.records.verified, before.verified, after.verified, at, owner);

  for (const key of new Set([...Object.keys(before.answers), ...Object.keys(after.answers)])) {
    const previousValue = Object.hasOwn(before.answers, key) ? before.answers[key] : null;
    const nextValue = Object.hasOwn(after.answers, key) ? after.answers[key] : null;
    if (previousValue !== nextValue || !safe.records.answers[key]) {
      safe.records.answers[key] = { value: nextValue, at, deviceId: owner };
    }
  }

  const previousLocation = { lastModule: before.lastModule, lastLesson: before.lastLesson };
  const nextLocation = { lastModule: after.lastModule, lastLesson: after.lastLesson };
  if (!sameValue(previousLocation, nextLocation) || !safe.records.location) {
    safe.records.location = { value: nextLocation, at, deviceId: owner };
  }
  safe.deviceId = owner;
  safe.updatedAt = Math.max(safe.updatedAt, at);
  return safe;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function buildPayload(envelope) {
  // Stable ordering prevents two tabs from repeatedly rewriting equivalent snapshots.
  const payload = JSON.stringify(canonical(sanitizeEnvelope(envelope)), null, 2);
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES) throw new Error("学习进度超过云同步大小上限，请先导出备份");
  return payload;
}

export function parsePayload(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_PAYLOAD_BYTES) throw new Error("同步文件过大或格式无效");
  try {
    return sanitizeEnvelope(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("同步文件不是有效 JSON");
    throw error;
  }
}
