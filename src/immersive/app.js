import { MODULES } from "../learning/catalog.js";
import { adjacentStage, buildStages, normalizeStage, stagePosition } from "./model.js";

const PROGRESS_KEY = "q-academy-progress";
const IMMERSIVE_KEY = "q-academy-immersive.v1";

let renderQueued = false;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function moduleIdFor(view) {
  const title = view.querySelector(".module-hero h1")?.textContent?.trim();
  return MODULES.find(module => module.title === title)?.id
    || loadJSON(PROGRESS_KEY, {}).lastModule
    || MODULES[0].id;
}

function readStage(moduleId, stages) {
  const saved = loadJSON(IMMERSIVE_KEY, {});
  const progress = loadJSON(PROGRESS_KEY, {});
  return normalizeStage(saved[moduleId], stages, progress.lastModule === moduleId ? progress.lastLesson : 0);
}

function saveStage(moduleId, stageId) {
  const saved = loadJSON(IMMERSIVE_KEY, {});
  saved[moduleId] = stageId;
  localStorage.setItem(IMMERSIVE_KEY, JSON.stringify(saved));
}

function stageData(view) {
  const lessonButtons = [...view.querySelectorAll(".lesson-list > button")]
    .filter(button => !button.classList.contains("quiz-jump"));
  const questionCards = [...view.querySelectorAll(".question-card")];
  const stages = buildStages(lessonButtons.length, questionCards.length);
  return { lessonButtons, questionCards, stages };
}

function createControls(view, stages, moduleId) {
  const module = MODULES.find(item => item.id === moduleId);
  const title = view.querySelector(".module-hero h1")?.textContent?.trim() || module?.title || "当前模块";
  const label = view.querySelector(".module-label")?.textContent?.trim() || "沉浸学习";
  const head = document.createElement("header");
  head.className = "qa-immersive-head";
  head.innerHTML = `
    <div class="qa-focus-mark" aria-hidden="true"><i></i><span>FOCUS</span></div>
    <div class="qa-focus-title"><small>${escapeHTML(label)}</small><strong>${escapeHTML(title)}</strong></div>
    <div class="qa-focus-status"><span>当前阶段</span><strong data-qa-current-label>导学</strong></div>
    <button type="button" class="qa-exit-immersive" data-qa-exit>退出沉浸</button>`;

  const nav = document.createElement("nav");
  nav.className = "qa-immersive-stages";
  nav.setAttribute("aria-label", "本模块学习阶段");
  nav.innerHTML = stages.map((stage, index) => `
    <button type="button" data-qa-stage="${stage.id}" aria-label="${escapeHTML(stage.label)}">
      <i>${String(index + 1).padStart(2, "0")}</i><span>${escapeHTML(stage.shortLabel)}</span>
    </button>`).join("");

  const footer = document.createElement("footer");
  footer.className = "qa-immersive-footer";
  footer.innerHTML = `
    <button type="button" class="qa-stage-direction qa-stage-prev" data-qa-prev><span>←</span><b>上一阶段</b></button>
    <div class="qa-stage-meter">
      <div><span data-qa-position>1 / ${stages.length}</span><small data-qa-percent>8%</small></div>
      <i><b data-qa-progress></b></i>
    </div>
    <button type="button" class="qa-stage-direction primary qa-stage-next" data-qa-next><b>下一阶段</b><span>→</span></button>`;

  view.prepend(nav);
  view.prepend(head);
  view.append(footer);
}

function updateControls(view, stage, stages) {
  const position = stagePosition(stage.id, stages);
  for (const button of view.querySelectorAll("[data-qa-stage]")) {
    const active = button.dataset.qaStage === stage.id;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  const currentLabel = view.querySelector("[data-qa-current-label]");
  if (currentLabel) currentLabel.textContent = stage.label;
  const positionNode = view.querySelector("[data-qa-position]");
  if (positionNode) positionNode.textContent = `${position.index + 1} / ${position.total}`;
  const percentNode = view.querySelector("[data-qa-percent]");
  if (percentNode) percentNode.textContent = `${position.percent}%`;
  const progressNode = view.querySelector("[data-qa-progress]");
  if (progressNode) progressNode.style.width = `${position.percent}%`;

  const previous = view.querySelector("[data-qa-prev]");
  if (previous) previous.disabled = position.index === 0;
  const next = view.querySelector("[data-qa-next] b");
  if (next) {
    if (stage.kind === "lesson") next.textContent = "完成本节并继续";
    else if (position.index === position.total - 1) next.textContent = "进入下一模块";
    else next.textContent = adjacentStage(stage.id, stages, 1)?.label || "下一阶段";
  }
}

function resetVisibleScroll(view, stage) {
  const selector = stage.kind === "overview" ? ".orientation-grid"
    : stage.kind === "lesson" ? ".lesson-content"
      : stage.kind === "concepts" ? ".concept-section"
        : stage.kind === "case" ? ".case-section"
          : ".quiz-section";
  const panel = view.querySelector(selector);
  if (panel) panel.scrollTop = 0;
}

function applyStage(view, stageId, { resetScroll = false } = {}) {
  const { lessonButtons, questionCards, stages } = stageData(view);
  const moduleId = moduleIdFor(view);
  const safeId = normalizeStage(stageId, stages, 0);
  const stage = stages.find(item => item.id === safeId) || stages[0];
  const changed = view.dataset.immersiveStage !== stage.id;
  view.dataset.immersiveStage = stage.id;
  saveStage(moduleId, stage.id);

  questionCards.forEach((card, index) => {
    card.classList.toggle("qa-immersive-current-question", stage.kind === "quiz" && stage.index === index);
  });
  updateControls(view, stage, stages);

  if (stage.kind === "lesson") {
    const lessonButton = lessonButtons[stage.index];
    if (lessonButton && !lessonButton.classList.contains("active")) {
      lessonButton.click();
      scheduleRender();
    }
  }
  if ((changed || resetScroll) && !renderQueued) requestAnimationFrame(() => resetVisibleScroll(view, stage));
  return stage;
}

function ensureImmersiveView() {
  renderQueued = false;
  const view = document.querySelector(".module-view");
  document.body.classList.toggle("qa-immersive-active", !!view);
  if (!view) return;

  view.classList.add("qa-immersive");
  const moduleId = moduleIdFor(view);
  const { stages } = stageData(view);
  if (!view.querySelector(":scope > .qa-immersive-head")) createControls(view, stages, moduleId);
  applyStage(view, view.dataset.immersiveStage || readStage(moduleId, stages));
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(ensureImmersiveView);
}

function currentContext() {
  const view = document.querySelector(".module-view.qa-immersive");
  if (!view) return null;
  const data = stageData(view);
  const id = normalizeStage(view.dataset.immersiveStage, data.stages, 0);
  return { view, ...data, stage: data.stages.find(item => item.id === id) };
}

function goToAdjacent(direction) {
  const context = currentContext();
  if (!context) return;
  const { view, stages, stage } = context;
  const position = stagePosition(stage.id, stages);

  if (direction > 0 && position.index === position.total - 1) {
    const moduleId = moduleIdFor(view);
    const moduleIndex = MODULES.findIndex(module => module.id === moduleId);
    const railButtons = [...document.querySelectorAll(".rail-modules > button")];
    if (moduleIndex >= 0 && railButtons[moduleIndex + 1]) railButtons[moduleIndex + 1].click();
    else view.querySelector(".module-breadcrumb button")?.click();
    scheduleRender();
    return;
  }

  const target = adjacentStage(stage.id, stages, direction);
  if (!target || target.id === stage.id) return;
  if (direction > 0 && stage.kind === "lesson") {
    const complete = view.querySelector(".lesson-content .complete-button");
    if (complete && /标记完成/.test(complete.textContent || "")) {
      complete.click();
      window.setTimeout(() => {
        const fresh = document.querySelector(".module-view.qa-immersive");
        if (fresh) applyStage(fresh, target.id, { resetScroll: true });
      }, 180);
      return;
    }
  }
  applyStage(view, target.id, { resetScroll: true });
}

function exitImmersive() {
  const view = document.querySelector(".module-view.qa-immersive");
  view?.querySelector(".module-breadcrumb button")?.click();
  scheduleRender();
}

function bindInteractions() {
  document.addEventListener("click", event => {
    const stageButton = event.target.closest?.("[data-qa-stage]");
    if (stageButton) {
      const view = stageButton.closest(".module-view");
      if (view) applyStage(view, stageButton.dataset.qaStage, { resetScroll: true });
      return;
    }
    if (event.target.closest?.("[data-qa-prev]")) goToAdjacent(-1);
    if (event.target.closest?.("[data-qa-next]")) goToAdjacent(1);
    if (event.target.closest?.("[data-qa-exit]")) exitImmersive();
  });

  document.addEventListener("keydown", event => {
    if (!document.body.classList.contains("qa-immersive-active")) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (document.body.classList.contains("qa-learning-open") || document.body.classList.contains("qa-cloud-open")) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); goToAdjacent(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); goToAdjacent(1); }
  });
}

function initialize() {
  bindInteractions();
  new MutationObserver(scheduleRender).observe(document.getElementById("root"), { childList: true, subtree: true });
  scheduleRender();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
else initialize();
