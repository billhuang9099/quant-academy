export function buildStages(lessonCount = 4, questionCount = 5) {
  const safeLessons = Math.max(0, Number.isInteger(lessonCount) ? lessonCount : 0);
  const safeQuestions = Math.max(0, Number.isInteger(questionCount) ? questionCount : 0);
  return [
    { id: "overview", kind: "overview", label: "导学", shortLabel: "导学" },
    ...Array.from({ length: safeLessons }, (_, index) => ({
      id: `lesson-${index}`,
      kind: "lesson",
      index,
      label: `第 ${index + 1} 节`,
      shortLabel: `课 ${index + 1}`
    })),
    { id: "concepts", kind: "concepts", label: "核心术语", shortLabel: "术语" },
    { id: "case", kind: "case", label: "案例拆解", shortLabel: "案例" },
    ...Array.from({ length: safeQuestions }, (_, index) => ({
      id: `quiz-${index}`,
      kind: "quiz",
      index,
      label: `测验 ${index + 1}`,
      shortLabel: `测 ${index + 1}`
    }))
  ];
}

export function normalizeStage(stageId, stages, fallbackLesson = 0) {
  const list = Array.isArray(stages) ? stages : [];
  if (list.some(stage => stage.id === stageId)) return stageId;
  const preferred = `lesson-${Math.max(0, Number.isInteger(fallbackLesson) ? fallbackLesson : 0)}`;
  if (list.some(stage => stage.id === preferred)) return preferred;
  return list[0]?.id || "overview";
}

export function adjacentStage(stageId, stages, direction = 1) {
  const list = Array.isArray(stages) ? stages : [];
  const index = list.findIndex(stage => stage.id === stageId);
  if (index < 0 || !list.length) return null;
  const nextIndex = Math.max(0, Math.min(list.length - 1, index + Math.sign(direction || 1)));
  return list[nextIndex] || null;
}

export function stagePosition(stageId, stages) {
  const list = Array.isArray(stages) ? stages : [];
  const index = Math.max(0, list.findIndex(stage => stage.id === stageId));
  return { index, total: list.length, percent: list.length ? Math.round(((index + 1) / list.length) * 100) : 0 };
}
