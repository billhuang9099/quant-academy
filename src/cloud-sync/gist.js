const API_BASE = "https://api.github.com";
const GIST_FILENAME = "quant-academy-progress.json";
const GIST_DESCRIPTION = "Quant Academy progress（量化学堂学习进度，请勿手动删除）";
const DEVICE_FILE_PATTERN = /^quant-academy-device-[a-zA-Z0-9_-]{1,100}\.json$/;
const MAX_FILE_BYTES = 900 * 1024;

export class GistError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function friendlyMessage(status) {
  if (status === 401) return "Token 无效或已过期（401）";
  if (status === 403) return "权限不足或触发限流（403），请确认 Token 具有 gist 权限";
  if (status === 404) return "Gist 不存在（404），请检查 Gist ID";
  if (status === 422) return "同步数据被 GitHub 拒绝（422）";
  return `GitHub API 错误（${status}）`;
}

async function request(token, path, options = {}, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.headers || {})
        }
      });
      if (!response.ok) throw new GistError(response.status, friendlyMessage(response.status));
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error instanceof GistError && error.status !== 403) break;
      if (attempt < retries - 1) await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw lastError instanceof GistError ? lastError : new GistError(0, "网络异常，无法连接 GitHub");
}

export async function createGist(token, content) {
  const data = await request(token, "/gists", {
    method: "POST",
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content } }
    })
  });
  return data.id;
}

export async function updateGist(token, gistId, content) {
  await request(token, `/gists/${encodeURIComponent(gistId)}`, {
    method: "PATCH",
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
  });
}

export async function fetchGistContent(token, gistId) {
  const data = await request(token, `/gists/${encodeURIComponent(gistId)}`);
  const file = data.files?.[GIST_FILENAME];
  if (!file || typeof file.content !== "string") {
    throw new GistError(404, `Gist 中未找到 ${GIST_FILENAME}`);
  }
  return file.content;
}

export function deviceGistFilename(deviceId) {
  if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(deviceId)) throw new Error('设备同步标识无效');
  return `quant-academy-device-${deviceId}.json`;
}

/** Read the unchanged legacy baseline and every device shard. Never read unrelated files. */
export async function fetchGistContents(token, gistId) {
  const data = await request(token, `/gists/${encodeURIComponent(gistId)}`);
  if (data.truncated) throw new GistError(0, 'Gist 文件列表被截断，无法确认所有设备数据；未覆盖云端');
  const files = Object.entries(data.files || {}).filter(([name]) => name === GIST_FILENAME || DEVICE_FILE_PATTERN.test(name));
  if (!files.length) throw new GistError(404, 'Gist 中没有量化学堂的学习进度文件');
  return Promise.all(files.map(async ([filename, file]) => {
    if (file.size > MAX_FILE_BYTES) throw new GistError(0, `${filename} 超过同步大小上限`);
    let content = file.content;
    if (file.truncated || typeof content !== 'string') {
      let url;
      try { url = new URL(file.raw_url); } catch { throw new GistError(0, `${filename} 没有可读取的内容`); }
      if (url.protocol !== 'https:' || url.hostname !== 'gist.githubusercontent.com') throw new GistError(0, 'Gist 原始文件地址不受支持');
      const response = await fetch(url.href, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new GistError(response.status, friendlyMessage(response.status));
      content = await response.text();
    }
    if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) throw new GistError(0, `${filename} 超过同步大小上限`);
    return { filename, content };
  }));
}

/** One browser owns one file. PATCH leaves all other devices and the legacy file untouched. */
export async function updateDeviceGist(token, gistId, deviceId, content) {
  const filename = deviceGistFilename(deviceId);
  await request(token, `/gists/${encodeURIComponent(gistId)}`, {
    method: 'PATCH', body: JSON.stringify({ files: { [filename]: { content } } }),
  });
}

export async function createDeviceGist(token, deviceId, content) {
  const filename = deviceGistFilename(deviceId);
  const data = await request(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [filename]: { content } } }),
  });
  if (!data.id) throw new GistError(0, 'GitHub 没有返回新 Gist ID，请检查后再重试');
  return data.id;
}
