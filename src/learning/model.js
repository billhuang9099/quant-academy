import { MODULES, QUESTIONS } from "./catalog.js";

const DAY = 24 * 60 * 60 * 1000;
const REVIEW_DAYS = [1, 3, 7, 21, 45];

export function emptyLearningState() {
  return { attempts: [], prep: {}, reviews: {} };
}

export function normalizeAnswer(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(" ", "");
}

export function isCorrect(question, answer) {
  if (!question || !normalizeAnswer(answer)) return false;
  return question.accepted.some(value => normalizeAnswer(value) === normalizeAnswer(answer));
}

export function recordAttempt(state, question, answer, now, deviceId, source = "module") {
  const next = structuredClone(state || emptyLearningState());
  const latest = [...next.attempts].reverse().find(item => item.questionId === question.id && item.source === source);
  if (latest && latest.answer === answer && source === "module") return next;
  const correct = isCorrect(question, answer);
  next.attempts.push({
    id: `${deviceId}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    questionId: question.id,
    moduleId: question.moduleId,
    answer: String(answer),
    correct,
    at: now,
    deviceId,
    source
  });
  next.attempts = next.attempts.slice(-1000);

  const previous = next.reviews[question.id]?.value;
  if (!correct || previous) {
    const stage = correct ? Math.min(4, (previous?.stage || 0) + 1) : 0;
    next.reviews[question.id] = {
      value: {
        questionId: question.id,
        moduleId: question.moduleId,
        prompt: question.prompt,
        nextReviewAt: now + REVIEW_DAYS[stage] * DAY,
        stage,
        lastResult: correct ? "right" : "wrong",
        mistakeCount: (previous?.mistakeCount || 0) + (correct ? 0 : 1)
      },
      at: now,
      deviceId
    };
  }
  return next;
}

export function updateReview(state, questionId, result, now, deviceId) {
  const next = structuredClone(state || emptyLearningState());
  const record = next.reviews[questionId];
  if (!record) return next;
  const current = record.value;
  const stage = result === "right" ? Math.min(4, current.stage + 1) : 0;
  next.reviews[questionId] = {
    value: {
      ...current,
      nextReviewAt: now + REVIEW_DAYS[stage] * DAY,
      stage,
      lastResult: result,
      mistakeCount: current.mistakeCount + (result === "right" ? 0 : 1)
    },
    at: now,
    deviceId
  };
  return next;
}

export function togglePrep(state, prepId, now, deviceId) {
  const next = structuredClone(state || emptyLearningState());
  const value = !next.prep[prepId]?.value;
  next.prep[prepId] = { value, at: now, deviceId };
  return next;
}

export function learningSummary(state, now = Date.now()) {
  const safe = state || emptyLearningState();
  const latest = new Map();
  for (const attempt of safe.attempts || []) latest.set(attempt.questionId, attempt);
  const modules = MODULES.map(module => {
    const questions = QUESTIONS.filter(item => item.moduleId === module.id);
    const attempted = questions.filter(item => latest.has(item.id)).length;
    const correct = questions.filter(item => latest.get(item.id)?.correct).length;
    return {
      ...module,
      attempted,
      correct,
      total: questions.length,
      mastery: questions.length ? Math.round((correct / questions.length) * 100) : 0,
      confidence: questions.length ? Math.round((attempted / questions.length) * 100) : 0
    };
  });
  const reviews = Object.values(safe.reviews || {}).map(record => record.value).filter(Boolean);
  return {
    modules,
    attempts: safe.attempts?.length || 0,
    mistakes: reviews.filter(item => item.mistakeCount > 0).sort((a, b) => b.mistakeCount - a.mistakeCount),
    due: reviews.filter(item => item.nextReviewAt <= now).sort((a, b) => a.nextReviewAt - b.nextReviewAt),
    prepCompleted: Object.values(safe.prep || {}).filter(record => record.value).length
  };
}
