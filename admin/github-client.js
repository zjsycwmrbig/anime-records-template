import {
  ANIME_INDEX_JSONL_PATH,
  ANIME_JSONL_PATH,
  BACKUP_DIRECTORY,
  buildAnimeIndex,
  createBackupSnapshot,
  parseJsonl,
  sortRecordsById,
} from "../scripts/library-data.mjs";
import {
  appendCatalogRecords,
  applyLibraryChanges,
  removeLibraryRecords,
  updateLibraryRecord,
} from "../scripts/admin-data.mjs";
import {
  getTemplateStatus,
  getTemplateUpdateStatus,
  updateFromTemplate,
} from "./template-updater.js";
import {
  applySiteSettings,
  siteSettingsPayload,
} from "../scripts/site-settings.mjs";
import {
  BANGUMI_CACHE_JSONL_PATH,
  bangumiCacheStatistics,
  mergeBangumiCacheEntries,
  parseBangumiCacheJsonl,
  removeBangumiCacheEntries,
  serializeBangumiCache,
  supplementBangumiCacheEntries,
} from "../scripts/bangumi-cache-data.mjs";

const API_ROOT = "https://api.github.com";
const RAW_ROOT = "https://raw.githubusercontent.com";
const DEFAULT_BACKUP_LIMIT = 5;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 400;
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);

function defaultFetch(...args) {
  return Reflect.apply(globalThis.fetch, globalThis, args);
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function commitTitle(value) {
  return cleanString(value).replace(/\s+/gu, " ").slice(0, 48);
}

function commitTitleSummary(records, limit = 5) {
  const titles = [...new Set(
    (records ?? []).map((record) => commitTitle(record?.title)).filter(Boolean),
  )];
  if (!titles.length) {
    return "";
  }
  const visible = titles.slice(0, limit);
  const suffix = titles.length > visible.length ? ` 等 ${titles.length} 部` : "";
  return `${visible.join("、")}${suffix}`;
}

function encodePath(value) {
  return String(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function assertRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("仓库地址必须使用 owner/repository 格式");
  }
}

function assertRelativePath(value, label) {
  const cleaned = cleanString(value);
  if (
    !cleaned ||
    cleaned.startsWith("/") ||
    cleaned.split("/").includes("..")
  ) {
    throw new Error(`${label}必须是仓库内的相对路径`);
  }
  return cleaned.replace(/\/+$/u, "");
}

function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToText(value) {
  const binary = atob(String(value ?? "").replace(/\s+/gu, ""));
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

async function readGitHubResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!contentType.includes("json")) {
    return text;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function responseErrorDetail(response) {
  const text = await response.text().catch(() => "");
  if (!text) {
    return "";
  }
  try {
    const payload = JSON.parse(text);
    return cleanString(payload?.message) || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

function backupName(createdAt, animeText, indexText) {
  const safeTime = createdAt.replace(/[:.]/gu, "-");
  const hash = shortHash(`${animeText}\n${indexText}`);
  return `library-${safeTime}-${hash}.json`;
}

function normalizeConfig(value) {
  const config = value && typeof value === "object" ? value : {};
  const backupLimit = Number(config.backupLimit);
  return {
    ...config,
    dataFile: assertRelativePath(
      config.dataFile ?? ANIME_JSONL_PATH,
      "数据文件路径",
    ),
    indexFile: assertRelativePath(
      config.indexFile ?? ANIME_INDEX_JSONL_PATH,
      "索引文件路径",
    ),
    bangumiCacheFile: assertRelativePath(
      config.bangumiCacheFile ?? BANGUMI_CACHE_JSONL_PATH,
      "Bangumi 缓存文件路径",
    ),
    backupDirectory: assertRelativePath(
      config.backupDirectory ?? BACKUP_DIRECTORY,
      "备份目录",
    ),
    backupLimit:
      Number.isInteger(backupLimit) && backupLimit >= 1 && backupLimit <= 20
        ? backupLimit
        : DEFAULT_BACKUP_LIMIT,
  };
}

function sameLibrary(left, right) {
  return left.dataText === right.dataText && left.indexText === right.indexText;
}

function bangumiCacheResult(entries, text, file) {
  return {
    ...bangumiCacheStatistics(entries, text),
    entries,
    file,
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function retryAfterMs(response, maxDelayMs) {
  const value = response.headers.get("retry-after");
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0
    ? Math.min(delay, maxDelayMs)
    : null;
}

export class GitHubApiError extends Error {
  constructor(status, message, payload = null, options = {}) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.payload = payload;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export class GitHubClient {
  constructor(options = {}) {
    this.repository = cleanString(options.repository);
    this.branch = cleanString(options.branch) || "main";
    this.token = cleanString(options.token);
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxAttempts = positiveInteger(
      options.maxAttempts,
      DEFAULT_MAX_ATTEMPTS,
    );
    this.requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
    this.retryBaseDelayMs = nonNegativeNumber(
      options.retryBaseDelayMs,
      DEFAULT_RETRY_BASE_DELAY_MS,
    );
    this.retryMaxDelayMs = nonNegativeNumber(
      options.retryMaxDelayMs,
      DEFAULT_RETRY_MAX_DELAY_MS,
    );
    this.sleepImpl =
      options.sleepImpl ??
      ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
    this.retryCount = 0;
  }

  configure({ repository, branch, token }) {
    this.repository = cleanString(repository ?? this.repository);
    this.branch = cleanString(branch ?? this.branch) || "main";
    this.token = cleanString(token ?? this.token);
    assertRepository(this.repository);
  }

  async request(path, options = {}) {
    return this.requestRepository(this.repository, path, options);
  }

  async requestRepository(repository, path, options = {}) {
    assertRepository(repository);
    const method = String(options.method ?? "GET").toUpperCase();
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    };
    if (this.token && options.authenticate !== false) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    return this.requestWithRetry(
      `${API_ROOT}/repos/${repository}${path}`,
      {
        method,
        headers,
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
      },
      {
        method,
        allowNotFound: options.allowNotFound,
        readResponse: readGitHubResponse,
        describeHttpError(status, detail) {
          let message = `GitHub 请求失败 (HTTP ${status})`;
          if (detail) {
            message += `：${detail}`;
          }
          if (status === 401) {
            message = "GitHub Token 无效或已过期，请重新填写";
          } else if (status === 403) {
            message = `GitHub 拒绝访问 (HTTP 403)${
              detail ? `：${detail}` : ""
            }。请确认 Token 对该仓库拥有 Contents: Read and write，且 API 额度未耗尽；从模板更新管理页时，还需要 Workflows: Read and write`;
          }
          return message;
        },
      },
    );
  }

  async requestRaw(path, ref, allowNotFound = false) {
    return this.requestRawRepository(
      this.repository,
      path,
      ref,
      allowNotFound,
    ).then((result) => (result === null ? null : result.text));
  }

  async requestRawRepository(repository, path, ref, allowNotFound = false) {
    return this.requestWithRetry(
      `${RAW_ROOT}/${repository}/${encodeURIComponent(ref)}/${encodePath(path)}`,
      {
        method: "GET",
        headers: { Accept: "text/plain" },
      },
      {
        method: "GET",
        allowNotFound,
        readResponse: async (response) => ({
          text: await response.text(),
        }),
        describeHttpError(status, detail) {
          return `GitHub 原始文件请求失败 (HTTP ${status})${detail ? `：${detail}` : ""}`;
        },
      },
    );
  }

  async requestWithRetry(url, init, options) {
    const method = String(options.method ?? init.method ?? "GET").toUpperCase();
    const maxAttempts = IDEMPOTENT_METHODS.has(method) ? this.maxAttempts : 1;
    let lastError = null;
    let attemptsUsed = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      attemptsUsed = attempt + 1;
      const timeout = this.createTimeout();
      try {
        let response;
        try {
          response = await this.fetchImpl(url, {
            ...init,
            signal: timeout.signal,
          });
        } catch (error) {
          throw this.transportError(error, timeout, url);
        }

        if (options.allowNotFound && response.status === 404) {
          return null;
        }
        if (!response.ok) {
          const detail = await responseErrorDetail(response);
          throw new GitHubApiError(
            response.status,
            options.describeHttpError(response.status, detail),
            null,
            {
              retryAfterMs: retryAfterMs(response, this.retryMaxDelayMs),
            },
          );
        }
        return await options.readResponse(response);
      } catch (error) {
        lastError =
          error instanceof GitHubApiError
            ? error
            : new GitHubApiError(
                0,
                `无法读取 GitHub 响应：${error.message || "未知错误"}`,
              );
        const canRetry =
          attemptsUsed < maxAttempts && this.isRetryable(lastError);
        if (!canRetry) {
          break;
        }
        this.retryCount += 1;
        await this.waitBeforeRetry(lastError, attempt);
      } finally {
        timeout.cleanup();
      }
    }

    const suffix =
      attemptsUsed > 1 ? `（已自动尝试 ${attemptsUsed} 次）` : "";
    throw new GitHubApiError(
      lastError.status,
      `${lastError.message}${suffix}`,
      lastError.payload,
    );
  }

  createTimeout() {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timer),
      timedOut: () => timedOut,
    };
  }

  transportError(error, timeout, url = "") {
    const message =
      timeout.timedOut() ||
      error?.name === "AbortError" ||
      error?.name === "TimeoutError"
        ? "请求超时"
        : error?.message || "网络错误";
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      // Keep the generic GitHub message for non-standard test URLs.
    }
    return new GitHubApiError(
      0,
      `无法连接 GitHub${host ? ` (${host})` : ""}：${message}`,
    );
  }

  isRetryable(error) {
    return error.status === 0 || RETRYABLE_STATUS_CODES.has(error.status);
  }

  async waitBeforeRetry(error, attempt) {
    const exponentialDelay = Math.min(
      this.retryMaxDelayMs,
      this.retryBaseDelayMs * 2 ** attempt,
    );
    const jitter =
      this.retryBaseDelayMs > 0
        ? Math.floor(Math.random() * Math.max(1, this.retryBaseDelayMs / 4))
        : 0;
    const delay = error.retryAfterMs ?? exponentialDelay + jitter;
    await this.sleepImpl(delay);
  }

  async getRepository() {
    return this.request("");
  }

  async getRef() {
    return this.getRefFor(this.repository, this.branch);
  }

  async getRefFor(repository, branch) {
    return this.requestRepository(
      repository,
      `/git/ref/heads/${encodePath(branch)}`,
      { authenticate: Boolean(this.token) },
    );
  }

  async getCommit(commitSha) {
    return this.request(`/git/commits/${encodeURIComponent(commitSha)}`);
  }

  async getCommitFor(repository, commitSha) {
    return this.requestRepository(
      repository,
      `/git/commits/${encodeURIComponent(commitSha)}`,
      { authenticate: Boolean(this.token) },
    );
  }

  async getTreeFor(repository, treeSha) {
    const payload = await this.requestRepository(
      repository,
      `/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
      { authenticate: Boolean(this.token) },
    );
    if (payload?.truncated) {
      throw new Error("仓库文件过多，GitHub 返回了不完整的文件树");
    }
    return payload;
  }

  async getBlobFor(repository, blobSha) {
    return this.requestRepository(
      repository,
      `/git/blobs/${encodeURIComponent(blobSha)}`,
      { authenticate: Boolean(this.token) },
    );
  }

  async getBlobBase64For(repository, blobSha) {
    const payload = await this.getBlobFor(repository, blobSha);
    if (payload?.encoding !== "base64" || !cleanString(payload.content)) {
      throw new Error(`无法读取 GitHub 文件内容：${blobSha}`);
    }
    return cleanString(payload.content).replace(/\s+/gu, "");
  }

  async getTextFromTree(
    repository,
    treePayload,
    filePath,
    allowNotFound = false,
  ) {
    const entry = (treePayload?.tree ?? []).find(
      (item) => item?.type === "blob" && item.path === filePath,
    );
    if (!entry?.sha) {
      if (allowNotFound) {
        return null;
      }
      throw new Error(`Git 树中找不到文件：${filePath}`);
    }
    const content = await this.getBlobBase64For(repository, entry.sha);
    return {
      type: "file",
      path: filePath,
      sha: entry.sha,
      text: base64ToText(content),
    };
  }

  async getContentAtRef(filePath, ref, allowNotFound = false) {
    return this.request(
      `/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`,
      { allowNotFound },
    );
  }

  async getTextAtRef(filePath, ref, allowNotFound = false) {
    if (/^[a-f0-9]{40,64}$/iu.test(String(ref))) {
      try {
        const text = await this.requestRaw(filePath, ref, allowNotFound);
        if (text !== null || !this.token) {
          return text === null
            ? null
            : {
                type: "file",
                path: filePath,
                text,
              };
        }
      } catch (error) {
        if (!this.token) {
          throw error;
        }
      }
    }
    const payload = await this.getContentAtRef(filePath, ref, allowNotFound);
    if (!payload) {
      return null;
    }
    if (Array.isArray(payload) || payload.type !== "file") {
      throw new Error(`${filePath} 不是可读取的文件`);
    }
    return {
      ...payload,
      text: base64ToText(payload.content),
    };
  }

  async listBackups(ref) {
    const payload = await this.getContentAtRef(
      this.backupDirectory,
      ref,
      true,
    );
    if (!payload) {
      return [];
    }
    if (!Array.isArray(payload)) {
      throw new Error("备份目录读取结果无效");
    }
    return payload
      .filter(
        (entry) =>
          entry.type === "file" && /^library-.*\.json$/u.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, "en"));
  }

  async loadSnapshot(options = {}) {
    const ref = await this.getRef();
    const headSha = ref?.object?.sha;
    if (!headSha) {
      throw new Error(`找不到分支 ${this.branch}`);
    }
    const commit = await this.getCommit(headSha);
    if (!commit?.tree?.sha) {
      throw new Error("无法读取分支 HEAD 的 Git 树");
    }

    const configFile = await this.getTextAtRef("config/site.json", headSha, true);
    let config = {};
    if (configFile) {
      try {
        config = JSON.parse(configFile.text);
      } catch {
        throw new Error("config/site.json 不是有效的 JSON");
      }
    }
    config = normalizeConfig(config);
    this.backupDirectory = config.backupDirectory;

    // Prefer Raw for public repositories. Private repositories fall back to
    // the Git Blob API, which also avoids the Contents API's 1 MB limit.
    const loadBangumiCacheFile = async () => {
      try {
        const text = await this.requestRaw(
          config.bangumiCacheFile,
          headSha,
          true,
        );
        if (text !== null || !this.token) {
          return text === null
            ? null
            : {
                type: "file",
                path: config.bangumiCacheFile,
                text,
              };
        }
      } catch (error) {
        if (!this.token) {
          throw error;
        }
      }
      const repositoryTree = await this.getTreeFor(
        this.repository,
        commit.tree.sha,
      );
      return this.getTextFromTree(
        this.repository,
        repositoryTree,
        config.bangumiCacheFile,
        true,
      );
    };
    const [dataFile, indexFile, bangumiCacheFile, backups] = await Promise.all([
      this.getTextAtRef(config.dataFile, headSha),
      this.getTextAtRef(config.indexFile, headSha),
      loadBangumiCacheFile(),
      options.includeBackups ? this.listBackups(headSha) : [],
    ]);
    const records = sortRecordsById(parseJsonl(dataFile.text, config.dataFile));
    const index = sortRecordsById(
      parseJsonl(indexFile.text, config.indexFile),
    );
    const bangumiCacheText = bangumiCacheFile?.text ?? "";
    const bangumiCache = parseBangumiCacheJsonl(
      bangumiCacheText,
      config.bangumiCacheFile,
    );
    const expectedIndex = buildAnimeIndex(records);
    if (JSON.stringify(index) !== JSON.stringify(expectedIndex)) {
      throw new Error(
        "远端 anime-index.jsonl 与 anime.jsonl 不一致，请先修复数据仓库",
      );
    }

    return {
      headSha,
      baseTreeSha: commit.tree.sha,
      config,
      records,
      index,
      dataText: dataFile.text,
      indexText: indexFile.text,
      bangumiCache,
      bangumiCacheText,
      backups,
    };
  }

  async createBlob(text) {
    return this.createBlobPayload({
      content: textToBase64(text),
      encoding: "base64",
    });
  }

  async createBlobBase64(content) {
    return this.createBlobPayload({
      content: String(content ?? "").replace(/\s+/gu, ""),
      encoding: "base64",
    });
  }

  async createBlobPayload(body) {
    const payload = await this.request("/git/blobs", {
      method: "POST",
      body,
    });
    if (!payload?.sha) {
      throw new Error("GitHub 没有返回 blob SHA");
    }
    return payload.sha;
  }

  async publishFileChange(snapshot, filePath, text, message) {
    const blob = await this.createBlob(text);
    const tree = await this.request("/git/trees", {
      method: "POST",
      body: {
        base_tree: snapshot.baseTreeSha,
        tree: [
          {
            path: filePath,
            mode: "100644",
            type: "blob",
            sha: blob,
          },
        ],
      },
    });
    const commit = await this.request("/git/commits", {
      method: "POST",
      body: {
        message,
        tree: tree.sha,
        parents: [snapshot.headSha],
      },
    });
    try {
      await this.request(`/git/refs/heads/${encodePath(this.branch)}`, {
        method: "PATCH",
        body: { sha: commit.sha, force: false },
      });
    } catch (error) {
      if (error instanceof GitHubApiError && [409, 422].includes(error.status)) {
        throw new GitHubApiError(
          409,
          "远端分支在保存设置期间已有新提交，未覆盖任何内容。请刷新后重试",
          error.payload,
        );
      }
      throw error;
    }
    return {
      commit: commit.sha,
      commitShort: commit.sha.slice(0, 7),
    };
  }

  async publish(snapshot, library, message) {
    if (sameLibrary(snapshot, library)) {
      return {
        commit: "",
        backupPath: null,
        records: snapshot.records,
        index: snapshot.index,
      };
    }

    const createdAt = this.now();
    const hasPreviousData = Boolean(snapshot.dataText || snapshot.indexText);
    const newBackupName = hasPreviousData
      ? backupName(createdAt, snapshot.dataText, snapshot.indexText)
      : null;
    const backupText = newBackupName
      ? `${JSON.stringify(
          createBackupSnapshot({
            animeText: snapshot.dataText,
            indexText: snapshot.indexText,
            createdAt,
          }),
          null,
          2,
        )}\n`
      : null;
    const retainedBackups = [
      ...(newBackupName ? [newBackupName] : []),
      ...(snapshot.backups ?? []).filter((name) => name !== newBackupName),
    ].sort((left, right) => right.localeCompare(left, "en"));
    const staleBackups = retainedBackups.slice(snapshot.config.backupLimit);

    const [dataBlob, indexBlob, backupBlob] = await Promise.all([
      this.createBlob(library.dataText),
      this.createBlob(library.indexText),
      backupText ? this.createBlob(backupText) : null,
    ]);
    const treeEntries = [
      {
        path: snapshot.config.dataFile,
        mode: "100644",
        type: "blob",
        sha: dataBlob,
      },
      {
        path: snapshot.config.indexFile,
        mode: "100644",
        type: "blob",
        sha: indexBlob,
      },
    ];
    if (newBackupName && backupBlob) {
      treeEntries.push({
        path: `${snapshot.config.backupDirectory}/${newBackupName}`,
        mode: "100644",
        type: "blob",
        sha: backupBlob,
      });
    }
    for (const stale of staleBackups) {
      treeEntries.push({
        path: `${snapshot.config.backupDirectory}/${stale}`,
        mode: "100644",
        type: "blob",
        sha: null,
      });
    }

    const tree = await this.request("/git/trees", {
      method: "POST",
      body: {
        base_tree: snapshot.baseTreeSha,
        tree: treeEntries,
      },
    });
    const commit = await this.request("/git/commits", {
      method: "POST",
      body: {
        message:
          cleanString(message) ||
          `chore(data): update anime library ${createdAt.slice(0, 10)}`,
        tree: tree.sha,
        parents: [snapshot.headSha],
      },
    });

    try {
      await this.request(
        `/git/refs/heads/${encodePath(this.branch)}`,
        {
          method: "PATCH",
          body: {
            sha: commit.sha,
            force: false,
          },
        },
      );
    } catch (error) {
      if (error instanceof GitHubApiError && [409, 422].includes(error.status)) {
        throw new GitHubApiError(
          409,
          "远端分支在本次编辑期间已有新提交，未覆盖任何内容。请刷新后重新操作",
          error.payload,
        );
      }
      throw error;
    }

    return {
      commit: commit.sha,
      commitShort: commit.sha.slice(0, 7),
      backupPath: newBackupName
        ? `${snapshot.config.backupDirectory}/${newBackupName}`
        : null,
      records: library.records,
      index: library.index,
    };
  }
}

export class GitHubAdminStore {
  constructor(client) {
    this.client = client;
  }

  async load() {
    const snapshot = await this.client.loadSnapshot();
    return {
      ...snapshot,
      backupLimit: snapshot.config.backupLimit,
    };
  }

  async loadBangumiCache() {
    const snapshot = await this.client.loadSnapshot();
    return bangumiCacheResult(
      snapshot.bangumiCache,
      snapshot.bangumiCacheText,
      snapshot.config.bangumiCacheFile,
    );
  }

  async saveBangumiCache(input = {}) {
    this.requireWriteAccess();
    const snapshot = await this.client.loadSnapshot();
    const currentEntries = snapshot.bangumiCache ?? [];
    const mode = cleanString(input.mode) || "merge";
    let entries;
    if (mode === "remove") {
      entries = removeBangumiCacheEntries(currentEntries, input.subjectIds);
    } else if (mode === "replace") {
      if (!Array.isArray(input.entries)) {
        throw new Error("替换 Bangumi 缓存时缺少 entries");
      }
      entries = parseBangumiCacheJsonl(
        serializeBangumiCache(input.entries),
        "提交的 Bangumi 缓存",
      );
    } else if (mode === "merge") {
      if (!Array.isArray(input.entries)) {
        throw new Error("合并 Bangumi 缓存时缺少 entries");
      }
      entries = mergeBangumiCacheEntries(currentEntries, input.entries);
    } else if (mode === "supplement") {
      if (!Array.isArray(input.entries)) {
        throw new Error("补充 Bangumi 缓存时缺少 entries");
      }
      entries = supplementBangumiCacheEntries(currentEntries, input.entries);
    } else {
      throw new Error(`不支持的 Bangumi 缓存操作：${mode}`);
    }

    const previousText = snapshot.bangumiCacheText ?? "";
    const text = serializeBangumiCache(entries);
    if (text === previousText) {
      return {
        ...bangumiCacheResult(
          entries,
          text,
          snapshot.config.bangumiCacheFile,
        ),
        changed: false,
        commit: "",
        commitShort: "",
      };
    }
    const result = await this.client.publishFileChange(
      snapshot,
      snapshot.config.bangumiCacheFile,
      text,
      cleanString(input.message) ||
        `chore(data): sync Bangumi cache (${entries.length} subjects)`,
    );
    return {
      ...bangumiCacheResult(
        entries,
        text,
        snapshot.config.bangumiCacheFile,
      ),
      changed: true,
      ...result,
    };
  }

  requireWriteAccess() {
    if (!this.client.token) {
      throw new Error("在线管理需要先在 GitHub 连接设置中填写 Token");
    }
  }

  async saveRecord(recordId, changes) {
    this.requireWriteAccess();
    const snapshot = await this.client.loadSnapshot({ includeBackups: true });
    const result = updateLibraryRecord(
      snapshot.records,
      recordId,
      changes,
      this.client.now(),
    );
    const published = await this.client.publish(
      snapshot,
      result,
      `chore(data): update ${result.record.title}`,
    );
    return {
      ...published,
      record: result.record,
    };
  }

  async addCatalogRecords(entries) {
    this.requireWriteAccess();
    const snapshot = await this.client.loadSnapshot({ includeBackups: true });
    const result = appendCatalogRecords(
      snapshot.records,
      entries,
      this.client.now(),
    );
    if (!result.addedRecords.length) {
      return {
        ...result,
        commit: "",
        backupPath: null,
      };
    }
    const published = await this.client.publish(
      snapshot,
      result,
      `chore(data): add ${result.addedRecords.length} anime records: ${commitTitleSummary(result.addedRecords)}`,
    );
    return {
      ...published,
      addedRecords: result.addedRecords,
      skipped: result.skipped,
    };
  }

  async batchUpdate(edits = [], additions = []) {
    this.requireWriteAccess();
    const snapshot = await this.client.loadSnapshot({ includeBackups: true });
    const result = applyLibraryChanges(
      snapshot.records,
      { edits, additions },
      this.client.now(),
    );
    if (!result.updatedRecords.length && !result.addedRecords.length) {
      return {
        ...result,
        commit: "",
        backupPath: null,
        records: snapshot.records,
        index: snapshot.index,
        changed: false,
      };
    }
    const published = await this.client.publish(
      snapshot,
      result,
      `chore(data): update anime library (修改 ${result.updatedRecords.length} · 新增 ${result.addedRecords.length}): ${commitTitleSummary([...result.updatedRecords, ...result.addedRecords])}`,
    );
    return {
      ...published,
      updatedRecords: result.updatedRecords,
      addedRecords: result.addedRecords,
      skipped: result.skipped,
      changed: true,
    };
  }

  async deleteRecords(recordIds) {
    this.requireWriteAccess();
    const snapshot = await this.client.loadSnapshot({ includeBackups: true });
    const result = removeLibraryRecords(snapshot.records, recordIds);
    const published = await this.client.publish(
      snapshot,
      result,
      `chore(data): delete ${recordIds.length} anime records`,
    );
    return published;
  }

  async status() {
    await this.client.getRef();
    return {
      branch: this.client.branch,
      remote: this.client.repository,
      dirty: false,
      changes: [],
      mode: "github",
    };
  }

  async sync() {
    this.requireWriteAccess();
    return {
      commit: "",
      pushed: false,
      branch: this.client.branch,
      online: true,
    };
  }

  async siteSettings() {
    const snapshot = await this.client.loadSnapshot();
    return siteSettingsPayload(snapshot.config);
  }

  async saveSiteSettings(input) {
    this.requireWriteAccess();
    const snapshot = await this.client.loadSnapshot();
    const next = applySiteSettings(snapshot.config, input);
    const result = await this.client.publishFileChange(
      snapshot,
      "config/site.json",
      `${JSON.stringify(next, null, 2)}\n`,
      "chore(config): update site appearance",
    );
    return {
      ...result,
      settings: siteSettingsPayload(next),
      file: "config/site.json",
    };
  }

  async templateStatus(options = {}) {
    return getTemplateUpdateStatus(this.client, options);
  }

  async updateTemplate(options = {}) {
    this.requireWriteAccess();
    return updateFromTemplate(this.client, options);
  }
}

export { base64ToText, textToBase64 };
