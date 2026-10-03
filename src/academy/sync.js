import { createDeviceGist, fetchGistContents, updateDeviceGist } from '../cloud-sync/gist.js';
import { mergeEnvelopes, parsePayload, buildPayload } from '../cloud-sync/model.js';
import { getEnvelope, mergeState, jsonLocal, writeLocal, deviceId } from './state.js';

const CONFIG = 'q-academy-gist-config.v1', SESSION = 'q-academy-gist-token';
const CREATED = `${CONFIG}.created`, STATUS = `${CONFIG}.status`;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const disconnected = value => value.disconnected === true || (!Object.hasOwn(value, 'gistId') && !value.token && !value.connectionId);
const connectionKey = value => value.connectionId || `legacy:${value.gistId || ''}:${value.sessionOnly !== false}`;
function storedObject(key) {
  // Read current disk, not a stale memory fallback, when checking revocation from another tab.
  try { return object(JSON.parse(localStorage.getItem(key) || '{}')); }
  catch { return object(jsonLocal(key, {})); }
}
function sharedConfig() {
  const next = storedObject(CONFIG);
  if (disconnected(next)) return next;
  const created = storedObject(CREATED);
  if (!next.gistId && next.connectionId && created.connectionId === next.connectionId && /^[a-f0-9]{5,64}$/i.test(created.gistId || '')) next.gistId = created.gistId;
  const status = storedObject(STATUS);
  if (status.connectionId === connectionKey(next) && status.gistId === (next.gistId || '')) next.lastSyncedAt = status.lastSyncedAt;
  return next;
}
let config = sharedConfig(), token = '', running = null, timer, dirty = false, generation = 0;
try {
  if (disconnected(config)) sessionStorage.removeItem(SESSION);
  else token = config.sessionOnly === false ? String(config.token || '') : sessionStorage.getItem(SESSION) || '';
} catch {}
const announce = message => window.dispatchEvent(new CustomEvent('academy-sync', { detail: message }));
function reloadSharedConfig() {
  const next = sharedConfig();
  const sameConnection = (next.connectionId || '') === (config.connectionId || '')
    && (next.sessionOnly !== false) === (config.sessionOnly !== false)
    && String(next.token || '') === String(config.token || '')
    && disconnected(next) === disconnected(config);
  const sameTarget = (next.gistId || '') === (config.gistId || '');
  // A Gist created for this exact connection is a completion of setup, not a reconnection.
  const creationCompleted = sameConnection && !config.gistId && !!next.gistId && !!next.connectionId;
  if (!sameConnection || (!sameTarget && !creationCompleted)) {
    generation += 1; dirty = false; clearTimeout(timer);
    token = !disconnected(next) && next.sessionOnly === false ? String(next.token || '') : '';
    try { sessionStorage.removeItem(SESSION); } catch {}
  }
  if (disconnected(next)) token = '';
  config = next;
}
export function syncConfig() {
  reloadSharedConfig();
  return { gistId: config.gistId || '', sessionOnly: config.sessionOnly !== false, hasToken: !!token, lastSyncedAt: config.lastSyncedAt };
}
export function configureSync({ newToken, gistId, sessionOnly = true }) {
  reloadSharedConfig();
  const id = String(gistId || '').trim();
  if (id && !/^[a-f0-9]{5,64}$/i.test(id)) throw new Error('Gist ID 只应包含字母 a–f 和数字，请填 ID 而非完整链接。');
  const nextToken = newToken ? String(newToken).trim() : token;
  const changed = disconnected(config) || !config.connectionId || id !== (config.gistId || '')
    || (sessionOnly !== false) !== (config.sessionOnly !== false) || nextToken !== token;
  if (changed) generation += 1;
  clearTimeout(timer);
  token = nextToken;
  config = { ...config, connectionId: changed ? crypto.randomUUID() : config.connectionId,
    disconnected: false, gistId: id, sessionOnly: sessionOnly !== false, token: sessionOnly !== false ? '' : token };
  try { if (sessionOnly !== false) sessionStorage.setItem(SESSION, token); else sessionStorage.removeItem(SESSION); } catch {}
  writeLocal(CONFIG, JSON.stringify(config));
}
export function clearSync() {
  generation += 1; dirty = false; clearTimeout(timer);
  token = ''; config = { sessionOnly: true, disconnected: true, connectionId: crypto.randomUUID() };
  try { sessionStorage.removeItem(SESSION); } catch {}
  writeLocal(CONFIG, JSON.stringify(config));
}
function current(generationAtStart, target) {
  reloadSharedConfig();
  if (generationAtStart !== generation) throw new Error('同步配置已改变，旧同步已停止；本地记录仍保留。');
  if (target && !target.gistId && config.gistId) target.gistId = config.gistId;
}
async function withDeviceLock(work) {
  // A stable per-browser file must have only one writer in flight across same-origin tabs.
  if (!globalThis.navigator?.locks?.request) throw new Error('此浏览器不支持安全的多标签同步锁；请使用支持 Web Locks 的新版浏览器，或先导出备份。');
  return navigator.locks.request(`quant-academy-device-sync:${deviceId}`, work);
}
async function syncOnce(target, pullOnly, expectedGeneration) {
  current(expectedGeneration, target);
  if (!target.gistId) {
    const content = buildPayload(getEnvelope());
    const id = await createDeviceGist(target.token, deviceId, content);
    current(expectedGeneration, target);
    target.gistId = id;
    // Async completions never rewrite credential-bearing CONFIG. Revoked connections cannot revive it.
    writeLocal(CREATED, JSON.stringify({ connectionId: config.connectionId, gistId: id }));
    config = sharedConfig();
    return;
  }
  const files = await fetchGistContents(target.token, target.gistId);
  current(expectedGeneration, target);
  let merged = getEnvelope();
  for (const { content } of files) merged = mergeEnvelopes(merged, parsePayload(content));
  // Validate before PATCH; bad files or an oversized merge do not overwrite any shard.
  const payload = buildPayload(merged);
  if (!pullOnly) await updateDeviceGist(target.token, target.gistId, deviceId, payload);
  current(expectedGeneration, target);
  mergeState(merged); // Includes newer local edits made while PATCH was in flight.
}
export async function synchronize({ pullOnly = false } = {}) {
  reloadSharedConfig();
  if (!token) throw new Error('请先填写仅含 gist 权限的 GitHub Token。');
  if (pullOnly && !config.gistId) throw new Error('拉取时需要已有 Gist ID。');
  if (running) { if (!pullOnly) dirty = true; return running; }
  clearTimeout(timer);
  const expectedGeneration = generation;
  const target = { token, gistId: config.gistId || '' };
  running = withDeviceLock(async () => {
    current(expectedGeneration, target);
    announce('正在同步…');
    let readOnly = pullOnly;
    do {
      dirty = false;
      await syncOnce(target, readOnly, expectedGeneration);
      current(expectedGeneration, target);
      readOnly = false; // Edits queued during a pull require a follow-up push.
    } while (dirty);
    config.lastSyncedAt = Date.now();
    writeLocal(STATUS, JSON.stringify({ connectionId: connectionKey(config), gistId: config.gistId || '', lastSyncedAt: config.lastSyncedAt }));
    announce(pullOnly ? '已拉取并合并' : '已同步');
    return syncConfig();
  }).catch(error => {
    if (expectedGeneration === generation) announce('同步失败，本地记录仍保留');
    throw error;
  }).finally(() => { running = null; });
  return running;
}
window.addEventListener('academy-change', () => {
  reloadSharedConfig();
  dirty = true;
  clearTimeout(timer);
  if (running) return; // The running loop will push another snapshot before reporting success.
  if (token && config.gistId) timer = setTimeout(() => synchronize().catch(() => {}), 2000);
});
window.addEventListener('storage', event => {
  if (event.key !== null && ![CONFIG, CREATED, STATUS].includes(event.key)) return;
  reloadSharedConfig();
});
