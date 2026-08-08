import { createGist, fetchGistContent, updateGist } from "./gist.js";
import {
  buildPayload,
  captureProgress,
  emptyEnvelope,
  mergeEnvelopes,
  normalizeProgress,
  parsePayload,
  projectProgress
} from "./model.js";

const PROGRESS_KEY = "q-academy-progress";
const LEARNING_KEY = "q-academy-learning.v1";
const LEGACY_SYNC_KEY = "q-academy-sync-code";
const CONFIG_KEY = "q-academy-gist-config.v1";
const ENVELOPE_KEY = "q-academy-gist-envelope.v1";
const DEVICE_KEY = "q-academy-device-id";
const SESSION_TOKEN_KEY = "q-academy-gist-token";

let modal;
let envelope;
let config;
let lastProgressJSON = "";
let lastLearningJSON = "";
let syncTimer;
let syncInFlight = false;
let syncAgain = false;

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `qa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadJSON(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function deviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = randomId();
    localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

function loadConfig() {
  const stored = loadJSON(localStorage, CONFIG_KEY, {});
  return {
    gistId: typeof stored.gistId === "string" ? stored.gistId : "",
    sessionOnly: stored.sessionOnly !== false,
    token: stored.sessionOnly === false
      ? String(stored.token || "")
      : String(sessionStorage.getItem(SESSION_TOKEN_KEY) || ""),
    lastSyncedAt: Number.isFinite(stored.lastSyncedAt) ? stored.lastSyncedAt : 0,
    lastStatus: typeof stored.lastStatus === "string" ? stored.lastStatus : ""
  };
}

function saveConfig() {
  if (config.sessionOnly) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, config.token || "");
  } else {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify({
    gistId: config.gistId,
    sessionOnly: config.sessionOnly,
    token: config.sessionOnly ? "" : config.token,
    lastSyncedAt: config.lastSyncedAt,
    lastStatus: config.lastStatus
  }));
}

function readProgress() {
  return normalizeProgress(loadJSON(localStorage, PROGRESS_KEY, {}));
}

function saveEnvelope() {
  localStorage.setItem(ENVELOPE_KEY, buildPayload(envelope));
}

function loadEnvelope() {
  const stored = loadJSON(localStorage, ENVELOPE_KEY, null);
  try {
    return stored ? parsePayload(JSON.stringify(stored)) : emptyEnvelope(deviceId());
  } catch {
    return emptyEnvelope(deviceId());
  }
}

function sameProgress(left, right) {
  return JSON.stringify(normalizeProgress(left)) === JSON.stringify(normalizeProgress(right));
}

function recordCurrentProgress() {
  const current = readProgress();
  const serialized = JSON.stringify(current);
  if (serialized === lastProgressJSON) return false;
  const previous = projectProgress(envelope);
  envelope = captureProgress(envelope, previous, current, Date.now(), deviceId());
  saveEnvelope();
  lastProgressJSON = serialized;
  if (syncInFlight) syncAgain = true;
  return true;
}

function recordCurrentLearning() {
  const current = loadJSON(localStorage, LEARNING_KEY, { attempts: [], prep: {}, reviews: {} });
  const serialized = JSON.stringify(current);
  if (serialized === lastLearningJSON) return false;
  const incoming = emptyEnvelope(deviceId());
  incoming.learning = current;
  envelope = mergeEnvelopes(envelope, incoming);
  saveEnvelope();
  lastLearningJSON = JSON.stringify(envelope.learning);
  if (syncInFlight) syncAgain = true;
  return true;
}

function applyEnvelope(nextEnvelope, reload = false) {
  envelope = nextEnvelope;
  saveEnvelope();
  const current = readProgress();
  const projected = projectProgress(envelope);
  const changed = !sameProgress(current, projected);
  const currentLearning = loadJSON(localStorage, LEARNING_KEY, { attempts: [], prep: {}, reviews: {} });
  const learningJSON = JSON.stringify(envelope.learning);
  const learningChanged = JSON.stringify(currentLearning) !== learningJSON;
  if (learningChanged) {
    localStorage.setItem(LEARNING_KEY, learningJSON);
    lastLearningJSON = learningJSON;
    window.dispatchEvent(new CustomEvent("q-academy-learning-reloaded"));
  }
  if (changed) {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(projected));
    lastProgressJSON = JSON.stringify(projected);
    if (reload) window.setTimeout(() => window.location.reload(), 250);
  }
  return changed || learningChanged;
}

function setStatus(message, kind = "") {
  config.lastStatus = message;
  saveConfig();
  if (!modal) return;
  const status = modal.querySelector("[data-sync-status]");
  status.textContent = message;
  status.className = `qa-cloud-status ${kind}`;
}

function formatTime(timestamp) {
  return timestamp ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(timestamp) : "尚未同步";
}

function updateButton() {
  const button = document.querySelector(".sync-button");
  if (!button) return;
  button.dataset.cloudSync = config.gistId ? (config.token ? "ready" : "token-needed") : "off";
  const label = button.querySelector("span");
  const text = config.gistId
    ? (config.token ? "Gist 云同步" : "云同步需 Token")
    : "连接 Gist 云同步";
  if (label && label.textContent !== text) label.textContent = text;
  button.setAttribute("aria-label", text);
  for (const paragraph of document.querySelectorAll("p")) {
    if (paragraph.textContent.includes("连接同步码后可跨设备继续学习")) {
      paragraph.textContent = paragraph.textContent.replace("连接同步码后可跨设备继续学习", "连接 Gist 云同步后可跨设备继续学习");
    }
  }
}

async function syncNow({ pullOnly = false, reloadOnRemote = false } = {}) {
  if (syncInFlight) return;
  recordCurrentProgress();
  recordCurrentLearning();
  if (!config.token) {
    const error = new Error("请先填写 GitHub Token");
    setStatus(error.message, "error");
    throw error;
  }
  if (pullOnly && !config.gistId) {
    const error = new Error("请先填写 Gist ID");
    setStatus(error.message, "error");
    throw error;
  }

  syncInFlight = true;
  setStatus(pullOnly ? "正在从云端拉取并合并…" : "正在拉取、合并并推送…", "syncing");
  try {
    let id = config.gistId;
    let merged = envelope;
    if (id) {
      const remote = parsePayload(await fetchGistContent(config.token, id));
      recordCurrentProgress();
      recordCurrentLearning();
      merged = mergeEnvelopes(envelope, remote);
      if (!pullOnly) await updateGist(config.token, id, buildPayload(merged));
    } else {
      id = await createGist(config.token, buildPayload(envelope));
    }
    recordCurrentProgress();
    recordCurrentLearning();
    merged = mergeEnvelopes(envelope, merged);
    config.gistId = id;
    config.lastSyncedAt = Date.now();
    applyEnvelope(merged, reloadOnRemote);
    setStatus(`${pullOnly ? "拉取" : "同步"}成功 · ${formatTime(config.lastSyncedAt)}`, "ok");
    saveConfig();
    updateButton();
    refreshModalFields();
  } catch (error) {
    setStatus(`同步失败：${error.message}（本地进度未丢失）`, "error");
    throw error;
  } finally {
    syncInFlight = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync();
    }
  }
}

function scheduleSync() {
  if (!config.token || !config.gistId) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => syncNow().catch(() => {}), 1800);
}

function createModal() {
  const wrapper = document.createElement("div");
  wrapper.className = "qa-cloud-backdrop";
  wrapper.hidden = true;
  wrapper.innerHTML = `
    <section class="qa-cloud-modal" role="dialog" aria-modal="true" aria-labelledby="qa-cloud-title">
      <button class="qa-cloud-close" type="button" aria-label="关闭云同步设置">×</button>
      <span class="qa-cloud-kicker">PRIVATE GITHUB GIST</span>
      <h2 id="qa-cloud-title">安全地跨设备继续学习</h2>
      <p class="qa-cloud-lead">同步前先拉取并按字段事件合并，避免电脑和手机互相覆盖。Token 只会发送给 GitHub 官方 API，不会写入进度文件。</p>
      <label class="qa-cloud-field">
        <span>GitHub Personal Access Token（仅需 gist 权限）</span>
        <input data-token type="password" autocomplete="new-password" placeholder="ghp_xxxxxxxxxxxxxxxx" />
      </label>
      <label class="qa-cloud-field">
        <span>Gist ID（第一台设备留空，首次同步自动创建）</span>
        <input data-gist-id type="text" autocomplete="off" spellcheck="false" placeholder="换设备时填写同一个 Gist ID" />
      </label>
      <label class="qa-cloud-check">
        <input data-session-only type="checkbox" />
        <span>Token 仅保存到本次浏览器会话（推荐）</span>
      </label>
      <div class="qa-cloud-actions">
        <button data-save type="button">保存设置</button>
        <button data-sync class="primary" type="button">立即同步</button>
        <button data-pull type="button">仅从云端拉取</button>
      </div>
      <p class="qa-cloud-status" data-sync-status role="status"></p>
      <p class="qa-cloud-last">上次成功：<span data-last-sync>尚未同步</span></p>
      <details class="qa-cloud-help">
        <summary>如何申请 Token？</summary>
        <ol>
          <li>GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)</li>
          <li>Generate new token (classic)，只勾选 <strong>gist</strong> 权限</li>
          <li>第一台设备填写 Token 后点击“立即同步”，复制自动生成的 Gist ID</li>
          <li>其他设备填写同一个 Token 与 Gist ID，再点击“仅从云端拉取”</li>
        </ol>
      </details>
      <div class="qa-cloud-backup">
        <div>
          <strong>本地备份</strong>
          <small>可导出 JSON；导入时按事件时间合并，不直接清空现有进度。</small>
        </div>
        <div class="qa-cloud-actions compact">
          <button data-export type="button">导出进度</button>
          <label class="qa-cloud-file">导入进度<input data-import type="file" accept="application/json,.json" hidden /></label>
          <button data-clear class="danger" type="button">清除凭证</button>
        </div>
      </div>
      <p class="qa-cloud-privacy">任何持有 Token 和 Gist ID 的人都可能读取或修改进度。公共电脑请保持“仅本次会话”开启，并在离开前清除凭证。</p>
    </section>`;
  document.body.appendChild(wrapper);
  return wrapper;
}

function refreshModalFields() {
  if (!modal) return;
  modal.querySelector("[data-token]").value = config.token;
  modal.querySelector("[data-gist-id]").value = config.gistId;
  modal.querySelector("[data-session-only]").checked = config.sessionOnly;
  modal.querySelector("[data-last-sync]").textContent = formatTime(config.lastSyncedAt);
  const status = modal.querySelector("[data-sync-status]");
  if (!status.textContent) status.textContent = config.lastStatus || "尚未连接云端；本地学习进度仍会自动保存。";
}

function openModal() {
  refreshModalFields();
  modal.hidden = false;
  document.body.classList.add("qa-cloud-open");
  window.setTimeout(() => modal.querySelector(config.token ? "[data-gist-id]" : "[data-token]").focus(), 0);
}

function closeModal() {
  modal.hidden = true;
  document.body.classList.remove("qa-cloud-open");
}

function readModalConfig() {
  config.token = modal.querySelector("[data-token]").value.trim();
  config.gistId = modal.querySelector("[data-gist-id]").value.trim();
  config.sessionOnly = modal.querySelector("[data-session-only]").checked;
  saveConfig();
  updateButton();
}

function downloadBackup() {
  recordCurrentProgress();
  const blob = new Blob([buildPayload(envelope)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `quant-academy-progress-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("进度 JSON 已导出。", "ok");
}

async function importBackup(file) {
  const imported = parsePayload(await file.text());
  recordCurrentProgress();
  const merged = mergeEnvelopes(envelope, imported);
  const changed = applyEnvelope(merged, true);
  setStatus(changed ? "导入并合并成功，正在刷新课程进度…" : "导入成功，没有发现更新的进度。", "ok");
}

function bindModal() {
  modal.querySelector(".qa-cloud-close").addEventListener("click", closeModal);
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  modal.querySelector("[data-save]").addEventListener("click", () => {
    readModalConfig();
    setStatus("设置已保存；学习进度仍保留在本机。", "ok");
    refreshModalFields();
  });
  modal.querySelector("[data-sync]").addEventListener("click", async () => {
    readModalConfig();
    await syncNow({ reloadOnRemote: true }).catch(() => {});
  });
  modal.querySelector("[data-pull]").addEventListener("click", async () => {
    readModalConfig();
    await syncNow({ pullOnly: true, reloadOnRemote: true }).catch(() => {});
  });
  modal.querySelector("[data-export]").addEventListener("click", downloadBackup);
  modal.querySelector("[data-import]").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (file) await importBackup(file).catch(error => setStatus(`导入失败：${error.message}`, "error"));
    event.target.value = "";
  });
  modal.querySelector("[data-clear]").addEventListener("click", () => {
    config.token = "";
    config.gistId = "";
    config.lastStatus = "凭证已清除；本地学习进度没有删除。";
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    saveConfig();
    refreshModalFields();
    updateButton();
    setStatus(config.lastStatus, "ok");
  });
}

function initialize() {
  try {
    const legacyCode = localStorage.getItem(LEGACY_SYNC_KEY);
    if (legacyCode) {
      localStorage.setItem("q-academy-legacy-sync-code", legacyCode);
      localStorage.removeItem(LEGACY_SYNC_KEY);
    }
  } catch { /* storage 不可用时保留纯本地模式 */ }

  config = loadConfig();
  envelope = loadEnvelope();
  const current = readProgress();
  envelope = captureProgress(envelope, projectProgress(envelope), current, Date.now(), deviceId());
  const initialLearning = loadJSON(localStorage, LEARNING_KEY, { attempts: [], prep: {}, reviews: {} });
  const learningEnvelope = emptyEnvelope(deviceId());
  learningEnvelope.learning = initialLearning;
  envelope = mergeEnvelopes(envelope, learningEnvelope);
  saveEnvelope();
  localStorage.setItem(LEARNING_KEY, JSON.stringify(envelope.learning));
  lastProgressJSON = JSON.stringify(current);
  lastLearningJSON = JSON.stringify(envelope.learning);

  modal = createModal();
  bindModal();
  updateButton();

  document.addEventListener("click", event => {
    const button = event.target.closest?.(".sync-button");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openModal();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  new MutationObserver(updateButton).observe(document.body, { childList: true, subtree: true });
  window.setInterval(() => {
    const progressChanged = recordCurrentProgress();
    const learningChanged = recordCurrentLearning();
    if (progressChanged || learningChanged) scheduleSync();
  }, 900);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && config.token && config.gistId) syncNow().catch(() => {});
  });
  window.addEventListener("online", () => {
    if (config.token && config.gistId) syncNow().catch(() => {});
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
else initialize();
