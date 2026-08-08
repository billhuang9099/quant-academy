import { MODULES, PYTHON_PREP, QUESTION_BY_ID } from "./catalog.js";
import {
  emptyLearningState,
  learningSummary,
  recordAttempt,
  togglePrep,
  updateReview
} from "./model.js";

const LEARNING_KEY = "q-academy-learning.v1";
const PROGRESS_KEY = "q-academy-progress";
const DEVICE_KEY = "q-academy-device-id";

let state = loadState();
let modal;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadState() {
  const stored = loadJSON(LEARNING_KEY, emptyLearningState());
  return {
    attempts: Array.isArray(stored.attempts) ? stored.attempts : [],
    prep: stored.prep && typeof stored.prep === "object" ? stored.prep : {},
    reviews: stored.reviews && typeof stored.reviews === "object" ? stored.reviews : {}
  };
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `qa-${Date.now()}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function saveState(next) {
  state = next;
  localStorage.setItem(LEARNING_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("q-academy-learning-change"));
  updateButton();
  if (modal && !modal.hidden) renderModal();
}

function updateButton() {
  const button = document.querySelector(".qa-learning-button");
  if (!button) return;
  const { due } = learningSummary(state);
  button.classList.toggle("has-due", due.length > 0);
  const badge = button.querySelector("b");
  badge.textContent = due.length > 9 ? "9+" : String(due.length);
  badge.hidden = due.length === 0;
}

function ensureButton() {
  if (document.querySelector(".qa-learning-button")) return;
  const syncButton = document.querySelector(".sync-button");
  if (!syncButton) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "qa-learning-button";
  button.setAttribute("aria-label", "学习复盘与 Python 预备营");
  button.innerHTML = `<i>↻</i><span>学习复盘</span><b hidden>0</b>`;
  button.addEventListener("click", openModal);
  syncButton.insertAdjacentElement("afterend", button);
  updateButton();
}

function masteryLabel(module) {
  if (!module.attempted) return "待开始";
  if (module.mastery >= 80 && module.confidence >= 75) return "已掌握";
  if (module.mastery >= 60) return "巩固中";
  return "需复习";
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}

function renderModal() {
  const summary = learningSummary(state);
  const moduleCards = summary.modules.map(module => `
    <article class="qa-mastery-card" style="--module:${module.color}">
      <div><span>${escapeHTML(module.title)}</span><strong>${module.mastery}%</strong></div>
      <i><b style="width:${module.mastery}%"></b></i>
      <p>${masteryLabel(module)} · 已测 ${module.attempted}/${module.total} · 置信度 ${module.confidence}%</p>
    </article>`).join("");

  const prepCards = PYTHON_PREP.map((lesson, index) => {
    const completed = !!state.prep[lesson.id]?.value;
    return `
      <article class="qa-prep-card ${completed ? "done" : ""}">
        <div class="qa-prep-head"><span>0${index + 1}</span><small>${lesson.duration}</small></div>
        <h3>${escapeHTML(lesson.title)}</h3>
        <p>${escapeHTML(lesson.summary)}</p>
        <pre><code>${escapeHTML(lesson.code)}</code></pre>
        <div class="qa-prep-task"><strong>动手任务</strong><p>${escapeHTML(lesson.task)}</p></div>
        <button type="button" data-prep="${lesson.id}">${completed ? "✓ 已完成" : "标记完成"}</button>
      </article>`;
  }).join("");

  const dueCards = summary.due.length ? summary.due.map(item => `
    <article class="qa-review-card">
      <span>${escapeHTML(MODULES.find(module => module.id === item.moduleId)?.title || item.moduleId)}</span>
      <h3>${escapeHTML(item.prompt)}</h3>
      <p>累计错误 ${item.mistakeCount} 次 · 当前复习阶段 ${item.stage + 1}/5</p>
      <div>
        <button type="button" data-review="${item.questionId}" data-result="uncertain">仍不确定</button>
        <button type="button" class="primary" data-review="${item.questionId}" data-result="right">已经掌握</button>
      </div>
    </article>`).join("") : `<div class="qa-empty">今天没有到期复习。继续完成模块测验，错题会自动进入这里。</div>`;

  const mistakes = summary.mistakes.length ? summary.mistakes.slice(0, 12).map(item => `
    <li><span>${escapeHTML(MODULES.find(module => module.id === item.moduleId)?.title || item.moduleId)}</span><p>${escapeHTML(item.prompt)}</p><small>${item.lastResult === "right" ? "最近答对" : "最近答错"} · 下次 ${formatDate(item.nextReviewAt)}</small></li>`).join("") : `<li class="qa-empty">尚无错题记录。</li>`;

  modal.querySelector(".qa-learning-content").innerHTML = `
    <section class="qa-learning-hero">
      <div><span>LEARNING SYSTEM V2</span><h2 id="qa-learning-title">把“看懂”变成真正掌握</h2><p>模块测验会自动形成掌握度、错题与复习计划；Python 预备营帮助你从第一周开始写代码。</p></div>
      <div class="qa-learning-metrics"><article><strong>${summary.prepCompleted}/4</strong><span>预备营</span></article><article><strong>${summary.due.length}</strong><span>今日复习</span></article><article><strong>${summary.attempts}</strong><span>有效作答</span></article></div>
    </section>
    <section class="qa-learning-section"><div class="qa-learning-heading"><div><span>掌握度地图</span><h3>不是完成率，而是答题证据</h3></div><p>掌握度取每道客观题最近一次结果；置信度反映覆盖了多少知识点。</p></div><div class="qa-mastery-grid">${moduleCards}</div></section>
    <section class="qa-learning-section tint"><div class="qa-learning-heading"><div><span>第 0 周</span><h3>Python 与 pandas 预备营</h3></div><p>建议在基础认知模块之前或同步完成，总时长约 4 小时。</p></div><div class="qa-prep-grid">${prepCards}</div></section>
    <section class="qa-learning-section"><div class="qa-learning-heading"><div><span>间隔复习</span><h3>今天需要重新确认的内容</h3></div><p>答错后按 1、3、7、21、45 天逐步拉长复习间隔。</p></div><div class="qa-review-grid">${dueCards}</div></section>
    <section class="qa-learning-section mistakes"><div class="qa-learning-heading"><div><span>错题本</span><h3>优先修复薄弱知识点</h3></div></div><ul class="qa-mistake-list">${mistakes}</ul></section>`;
}

function createModal() {
  const wrapper = document.createElement("div");
  wrapper.className = "qa-learning-backdrop";
  wrapper.hidden = true;
  wrapper.innerHTML = `<section class="qa-learning-modal" role="dialog" aria-modal="true" aria-labelledby="qa-learning-title"><button type="button" class="qa-learning-close" aria-label="关闭学习复盘">×</button><div class="qa-learning-content"></div></section>`;
  document.body.appendChild(wrapper);
  wrapper.querySelector(".qa-learning-close").addEventListener("click", closeModal);
  wrapper.addEventListener("click", event => {
    if (event.target === wrapper) closeModal();
    const prep = event.target.closest?.("[data-prep]");
    if (prep) saveState(togglePrep(state, prep.dataset.prep, Date.now(), deviceId()));
    const review = event.target.closest?.("[data-review]");
    if (review) saveState(updateReview(state, review.dataset.review, review.dataset.result, Date.now(), deviceId()));
  });
  return wrapper;
}

function openModal() {
  renderModal();
  modal.hidden = false;
  document.body.classList.add("qa-learning-open");
  modal.querySelector(".qa-learning-close").focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.classList.remove("qa-learning-open");
}

function captureQuizAttempt(cardIndex) {
  const progress = loadJSON(PROGRESS_KEY, {});
  const moduleId = progress.lastModule;
  const questionId = `${moduleId}-${cardIndex}`;
  const progressQuestionId = `${moduleId}::${cardIndex}`;
  const question = QUESTION_BY_ID[questionId];
  if (!question || !Array.isArray(progress.verified) || !progress.verified.includes(progressQuestionId)) return;
  const answer = progress.answers?.[progressQuestionId];
  if (typeof answer !== "string") return;
  saveState(recordAttempt(state, question, answer, Date.now(), deviceId()));
}

function initialize() {
  modal = createModal();
  ensureButton();
  new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", event => {
    const button = event.target.closest?.(".question-card .secondary-button");
    if (!button || button.disabled) return;
    const card = button.closest(".question-card");
    const cards = [...document.querySelectorAll(".question-card")];
    const index = cards.indexOf(card);
    if (index >= 0 && index < 4) window.setTimeout(() => captureQuizAttempt(index), 220);
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });
  window.addEventListener("q-academy-learning-reloaded", () => {
    state = loadState();
    updateButton();
    if (!modal.hidden) renderModal();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
else initialize();
