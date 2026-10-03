import { FOUNDATION_MODULES } from './curriculum-foundations.js';
import { PRACTICE_MODULES } from './curriculum-practice.js';
export const MODULES = [...FOUNDATION_MODULES, ...PRACTICE_MODULES];
export const LESSONS = MODULES.flatMap((module, moduleIndex) => module.lessons.map((lesson, lessonIndex) => ({ ...lesson, moduleId: module.id, moduleTitle: module.title, moduleIndex, lessonIndex })));
export const LESSON_BY_ID = Object.fromEntries(LESSONS.map(lesson => [lesson.id, lesson]));
export const PHASES = [{id:'concept',title:'理解概念'}, {id:'worked',title:'跟着推导'}, {id:'lab',title:'动手实验'}, {id:'check',title:'检验理解'}, {id:'task',title:'迁移应用'}];
