const API_BASE = "https://api.github.com";
const GIST_FILENAME = "quant-academy-progress.json";
const GIST_DESCRIPTION = "Quant Academy progress（量化学堂学习进度，请勿手动删除）";

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
