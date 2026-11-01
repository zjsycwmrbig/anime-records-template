import { BrowserCatalogStore } from "./browser-catalog-store.js";
import {
  GitHubAdminStore,
  GitHubClient,
} from "./github-client.js";
import { readAllBangumiMetadata } from "./bangumi-metadata-cache.js";
import { findDuplicateGroups } from "../scripts/duplicate-data.mjs";

const SETTINGS_KEY = "myanimelife.admin.github.settings";
const TOKEN_KEY = "myanimelife.admin.github.token";
const LIBRARY_CACHE_VERSION = 3;
const LIBRARY_REVALIDATE_INTERVAL = 30 * 1000;

function cleanString(value) {
  return String(value ?? "").trim();
}

function readStorage(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function inferPagesRepository() {
  const hostname = location.hostname;
  if (!hostname.endsWith(".github.io")) {
    return "";
  }
  const owner = hostname.slice(0, -".github.io".length);
  const repository = location.pathname.split("/").filter(Boolean)[0] ?? "";
  return owner && repository ? `${owner}/${repository}` : "";
}

const injected = globalThis.ANIME_ADMIN_CONFIG ?? {};
const inferredPagesRepository = inferPagesRepository();
const injectedRepository = cleanString(injected.repository);
const pageRepository = injectedRepository || inferredPagesRepository;
const scopedSettingsKey = pageRepository
  ? `${SETTINGS_KEY}:${encodeURIComponent(pageRepository)}`
  : SETTINGS_KEY;
const scopedSettings = readStorage(localStorage, scopedSettingsKey) ?? {};
const legacySettings = readStorage(localStorage, SETTINGS_KEY) ?? {};
const storedSettings =
  Object.keys(scopedSettings).length > 0
    ? scopedSettings
    : pageRepository && cleanString(legacySettings.repository) === pageRepository
      ? legacySettings
      : pageRepository
        ? {}
        : legacySettings;
const isLocalAdmin =
  ["127.0.0.1", "localhost", "::1"].includes(location.hostname) &&
  location.protocol === "http:";
const mode = isLocalAdmin ? "local" : "github";
const settings = {
  repository:
    cleanString(storedSettings.repository) ||
    pageRepository,
  branch:
    cleanString(storedSettings.branch) ||
    cleanString(injected.branch) ||
    "main",
};

function clearLegacyLibraryCaches() {
  try {
    const prefix = "myanimelife.admin.library.v";
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index) ?? "";
      if (/^myanimelife\.admin\.library\.v[12]:/u.test(key)) {
        localStorage.removeItem(key);
      } else if (key.startsWith(prefix) && !key.includes(".v3:")) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

clearLegacyLibraryCaches();

function readCachedToken() {
  try {
    const localToken = cleanString(localStorage.getItem(TOKEN_KEY));
    if (localToken) {
      return localToken;
    }
    const legacyToken = cleanString(sessionStorage.getItem(TOKEN_KEY));
    if (legacyToken) {
      localStorage.setItem(TOKEN_KEY, legacyToken);
      return legacyToken;
    }
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return "";
}

let token = readCachedToken();
let onlineStore = null;
let catalogStore = null;
let libraryCache = null;
let libraryRevalidatePromise = null;
let lastLibraryRevalidateAt = 0;

const elements = {
  runtimeBadge: document.querySelector("#runtimeBadge"),
  connectionButton: document.querySelector("#connectionButton"),
  connectionDialog: document.querySelector("#connectionDialog"),
  connectionForm: document.querySelector("#connectionForm"),
  connectionClose: document.querySelector("#connectionClose"),
  connectionCancel: document.querySelector("#connectionCancel"),
  connectionDisconnect: document.querySelector("#connectionDisconnect"),
  connectionStatus: document.querySelector("#connectionStatus"),
  repositoryInput: document.querySelector("#repositoryInput"),
  branchInput: document.querySelector("#branchInput"),
  tokenInput: document.querySelector("#tokenInput"),
  connectionSubmit: document.querySelector("#connectionSubmit"),
};

function createOnlineStore() {
  const client = new GitHubClient({
    repository: settings.repository,
    branch: settings.branch,
    token,
  });
  return new GitHubAdminStore(client);
}

function getOnlineStore() {
  if (!settings.repository) {
    throw new Error(
      "尚未配置数据仓库。请点击右上角“连接 GitHub”填写 owner/repository",
    );
  }
  onlineStore ??= createOnlineStore();
  return onlineStore;
}

function getCatalogStore() {
  catalogStore ??= new BrowserCatalogStore();
  return catalogStore;
}

function libraryCacheKey() {
  return `myanimelife.admin.library.v${LIBRARY_CACHE_VERSION}:${encodeURIComponent(
    settings.repository,
  )}:${encodeURIComponent(settings.branch)}`;
}

function readPersistentLibraryCache() {
  if (!settings.repository) {
    return null;
  }
  try {
    const cached = readStorage(localStorage, libraryCacheKey());
    if (!cached || !Array.isArray(cached.records) || !Array.isArray(cached.index)) {
      return null;
    }
    return {
      ...cached,
      config: cached.config ?? {},
      backups: [],
    };
  } catch {
    return null;
  }
}

function writePersistentLibraryCache(snapshot) {
  if (!settings.repository || !snapshot) {
    return;
  }
  try {
    localStorage.setItem(
      libraryCacheKey(),
      JSON.stringify({
        version: LIBRARY_CACHE_VERSION,
        repository: settings.repository,
        branch: settings.branch,
        headSha: snapshot.headSha ?? "",
        fetchedAt: new Date().toISOString(),
        config: snapshot.config ?? {},
        records: snapshot.records ?? [],
        index: snapshot.index ?? [],
        backupLimit: snapshot.config?.backupLimit ?? 5,
      }),
    );
  } catch {
    // Large repositories or private browsing must not break online mode.
  }
}

function clearPersistentLibraryCache() {
  if (!settings.repository) {
    return;
  }
  try {
    localStorage.removeItem(libraryCacheKey());
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function notifyLibraryChanged(source, headSha) {
  window.dispatchEvent(
    new CustomEvent("anime-library:changed", {
      detail: { source, headSha },
    }),
  );
}

async function revalidateLibraryCache(previousHeadSha) {
  if (libraryRevalidatePromise) {
    return libraryRevalidatePromise;
  }
  lastLibraryRevalidateAt = Date.now();
  libraryRevalidatePromise = getOnlineStore()
    .load()
    .then((snapshot) => {
      const changed =
        Boolean(previousHeadSha) && previousHeadSha !== snapshot.headSha;
      libraryCache = snapshot;
      writePersistentLibraryCache(snapshot);
      if (changed) {
        notifyLibraryChanged("remote", snapshot.headSha);
      }
      return snapshot;
    })
    .finally(() => {
      libraryRevalidatePromise = null;
    });
  return libraryRevalidatePromise;
}

function scheduleLibraryRevalidation(snapshot) {
  if (
    Date.now() - lastLibraryRevalidateAt < LIBRARY_REVALIDATE_INTERVAL ||
    libraryRevalidatePromise
  ) {
    return;
  }
  void revalidateLibraryCache(snapshot?.headSha).catch(() => {
    // Keep the cached snapshot available when GitHub is temporarily offline.
  });
}

function invalidateLibraryCache(options = {}) {
  libraryCache = null;
  lastLibraryRevalidateAt = 0;
  if (options.clearPersistent !== false) {
    clearPersistentLibraryCache();
  }
}

function renderRuntime() {
  if (!elements.runtimeBadge || !elements.connectionButton) {
    return;
  }
  if (mode === "local") {
    elements.runtimeBadge.textContent = "本地服务";
    elements.runtimeBadge.className = "runtime-badge is-local";
    elements.connectionButton.textContent = "本地管理模式";
    return;
  }
  elements.runtimeBadge.textContent = token ? "GitHub 可写" : "GitHub 只读";
  elements.runtimeBadge.className = `runtime-badge is-github${
    token ? " is-writable" : ""
  }`;
  elements.connectionButton.textContent = [
    settings.repository || "配置仓库",
    token ? "已连接" : "连接 GitHub",
  ].join(" · ");
}

function setConnectionStatus(message, options = {}) {
  if (!elements.connectionStatus) {
    return;
  }
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.classList.toggle(
    "is-error",
    Boolean(options.error),
  );
  elements.connectionStatus.classList.toggle(
    "is-success",
    Boolean(options.success),
  );
}

function openConnectionDialog() {
  if (!elements.connectionDialog) {
    return;
  }
  elements.repositoryInput.value = settings.repository;
  elements.branchInput.value = settings.branch;
  elements.tokenInput.value = token;
  elements.connectionDisconnect.hidden = !token;
  if (mode === "local") {
    elements.repositoryInput.disabled = true;
    elements.branchInput.disabled = true;
    elements.tokenInput.disabled = true;
    elements.connectionSubmit.hidden = true;
    setConnectionStatus(
      "当前由本地管理服务写入文件。GitHub Pages 版会自动启用在线模式。",
      { success: true },
    );
  } else {
    setConnectionStatus(
      token
        ? `当前以 ${settings.repository} 的 ${settings.branch} 分支连接。`
        : "当前为公开只读模式。填写 Token 后可编辑并直接提交。",
      { success: token },
    );
  }
  if (typeof elements.connectionDialog.showModal === "function") {
    elements.connectionDialog.showModal();
  } else {
    elements.connectionDialog.setAttribute("open", "");
  }
}

function closeConnectionDialog() {
  if (typeof elements.connectionDialog?.close === "function") {
    elements.connectionDialog.close();
  } else {
    elements.connectionDialog?.removeAttribute("open");
  }
}

async function saveConnection(event) {
  event.preventDefault();
  if (mode === "local") {
    closeConnectionDialog();
    return;
  }

  const repository = cleanString(elements.repositoryInput.value);
  const branch = cleanString(elements.branchInput.value) || "main";
  const nextToken = cleanString(elements.tokenInput.value);
  elements.connectionSubmit.disabled = true;
  elements.connectionSubmit.classList.add("is-loading");
  setConnectionStatus("正在验证仓库和 Token...");
  try {
    const probe = new GitHubClient({ repository, branch, token: nextToken });
    const repositoryInfo = await probe.getRepository();
    await probe.getRef();
    settings.repository = repositoryInfo.full_name || repository;
    settings.branch = branch;
    token = nextToken;
    localStorage.setItem(scopedSettingsKey, JSON.stringify(settings));
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    }
    onlineStore = null;
    invalidateLibraryCache();
    catalogStore = null;
    renderRuntime();
    setConnectionStatus(
      token
        ? `连接成功，可写入 ${settings.repository}`
        : "连接成功。当前没有 Token，仅能读取公开仓库。",
      { success: true },
    );
    window.dispatchEvent(
      new CustomEvent("anime-runtime:changed", {
        detail: { mode, repository: settings.repository, token: Boolean(token) },
      }),
    );
    setTimeout(closeConnectionDialog, 350);
  } catch (error) {
    setConnectionStatus(error.message, { error: true });
  } finally {
    elements.connectionSubmit.disabled = false;
    elements.connectionSubmit.classList.remove("is-loading");
  }
}

function disconnectToken() {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  onlineStore = null;
  invalidateLibraryCache();
  elements.tokenInput.value = "";
  elements.connectionDisconnect.hidden = true;
  renderRuntime();
  setConnectionStatus("已移除浏览器本地缓存中的 Token，当前切换为只读。", {
    success: true,
  });
  window.dispatchEvent(
    new CustomEvent("anime-runtime:changed", {
      detail: { mode, repository: settings.repository, token: false },
    }),
  );
}

async function localApi(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  return payload;
}

function parseBody(options) {
  if (!options.body) {
    return {};
  }
  try {
    return JSON.parse(options.body);
  } catch {
    throw new Error("请求内容不是有效 JSON");
  }
}

async function githubLibrary(fresh = false) {
  if (!fresh) {
    if (libraryCache) {
      scheduleLibraryRevalidation(libraryCache);
      return libraryCache;
    }
    const cached = readPersistentLibraryCache();
    if (cached) {
      libraryCache = cached;
      scheduleLibraryRevalidation(cached);
      return cached;
    }
  }
  const snapshot = await getOnlineStore().load();
  libraryCache = snapshot;
  writePersistentLibraryCache(snapshot);
  lastLibraryRevalidateAt = Date.now();
  return snapshot;
}

async function onlineApi(path, options) {
  const method = options.method ?? "GET";
  const url = new URL(path, location.href);
  const store = getOnlineStore();

  if (url.pathname === "/api/library" && method === "GET") {
    const library = await githubLibrary();
    return {
      records: library.records,
      index: library.index,
      backupLimit: library.backupLimit,
      git: {
        branch: settings.branch,
        remote: settings.repository,
        dirty: false,
        changes: [],
        mode: "github",
      },
    };
  }
  if (url.pathname === "/api/status" && method === "GET") {
    return store.status();
  }
  if (url.pathname === "/api/settings" && method === "GET") {
    return store.siteSettings();
  }
  if (url.pathname === "/api/settings" && method === "PUT") {
    return store.saveSiteSettings(parseBody(options));
  }
  if (url.pathname === "/api/bangumi-cache" && method === "GET") {
    const library = await githubLibrary(
      url.searchParams.get("fresh") === "1",
    );
    const text = library.bangumiCacheText ?? "";
    return {
      entries: library.bangumiCache ?? [],
      count: (library.bangumiCache ?? []).length,
      size: new TextEncoder().encode(text).length,
      updatedAt:
        (library.bangumiCache ?? [])
          .map((entry) => entry.fetchedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      file:
        library.config?.bangumiCacheFile ?? "data/bangumi-cache.jsonl",
    };
  }
  if (url.pathname === "/api/bangumi-cache" && method === "PUT") {
    const result = await store.saveBangumiCache(parseBody(options));
    invalidateLibraryCache();
    return result;
  }
  if (url.pathname === "/api/bangumi-cache" && method === "DELETE") {
    const body = parseBody(options);
    const result = await store.saveBangumiCache(
      body.all
        ? { mode: "replace", entries: [] }
        : { mode: "remove", subjectIds: body.subjectIds },
    );
    invalidateLibraryCache();
    return result;
  }
  if (url.pathname === "/api/template/status" && method === "GET") {
    return store.templateStatus({ onProgress: options.onProgress });
  }
  if (url.pathname === "/api/template/update" && method === "POST") {
    const result = await store.updateTemplate({ onProgress: options.onProgress });
    invalidateLibraryCache();
    return result;
  }
  if (url.pathname === "/api/duplicates" && method === "GET") {
    const library = await githubLibrary(true);
    const groups = findDuplicateGroups(library.records);
    return {
      groups,
      recordCount: library.records.length,
      groupCount: groups.length,
      confirmedCount: groups.filter(
        (group) => group.severity === "confirmed",
      ).length,
    };
  }
  if (url.pathname === "/api/catalog" && method === "GET") {
    const library = await githubLibrary();
    const metadataEntries = await readAllBangumiMetadata().catch(() => []);
    const payload = await getCatalogStore().search(
      {
        query: url.searchParams.get("q") ?? "",
        year: url.searchParams.get("year") ?? "",
        source: url.searchParams.get("source") ?? "",
        owned: url.searchParams.get("owned") ?? "",
        offset: url.searchParams.get("offset") ?? "0",
        limit: url.searchParams.get("limit") ?? "30",
        refresh: url.searchParams.get("refresh") === "1",
        tags: url.searchParams.getAll("tag"),
        scoreMin: url.searchParams.get("scoreMin") ?? "",
        scoreMax: url.searchParams.get("scoreMax") ?? "",
        availability: url.searchParams.get("availability") ?? "all",
        sort: url.searchParams.get("sort") ?? "default",
        metadataEntries,
      },
      library.index,
    );
    return payload;
  }
  if (url.pathname === "/api/catalog/bangumi-items" && method === "GET") {
    return {
      items: await getCatalogStore().getBangumiItems(),
    };
  }
  if (url.pathname === "/api/catalog/bulk" && method === "POST") {
    const body = parseBody(options);
    const selections = Array.isArray(body.items) ? body.items : [];
    if (!selections.length) {
      throw new Error("没有选择要添加的番剧");
    }
    if (selections.length > 100) {
      throw new Error("单次最多添加 100 部番剧");
    }
    const uniqueIds = [
      ...new Set(
        selections
          .map((selection) => cleanString(selection?.id))
          .filter(Boolean),
      ),
    ];
    const catalogItems = await getCatalogStore().getItems(uniqueIds);
    const byId = new Map(catalogItems.map((item) => [item.id, item]));
    const missing = selections
      .filter((selection) => !byId.has(cleanString(selection?.id)))
      .map((selection) => ({
        catalogId: cleanString(selection?.id) || null,
        title: cleanString(selection?.title) || "未知候选",
        reason: "catalog-not-found",
        message: "全量索引中已找不到该候选",
      }));
    const entries = selections
      .map((selection) => {
        const item = byId.get(cleanString(selection?.id));
        return item ? { item, ...selection } : null;
      })
      .filter(Boolean);
    const result = await store.addCatalogRecords(entries);
    invalidateLibraryCache();
    return {
      ...result,
      skipped: [...missing, ...(result.skipped ?? [])],
      backupLimit: result.config?.backupLimit,
      sync:
        body.sync && result.addedRecords?.length
          ? {
              commit: result.commitShort ?? result.commit ?? "",
              branch: settings.branch,
            }
          : null,
      syncError: null,
    };
  }
  if (url.pathname === "/api/library/batch" && method === "POST") {
    const body = parseBody(options);
    const edits = Array.isArray(body.edits) ? body.edits : [];
    const selections = Array.isArray(body.additions) ? body.additions : [];
    if (selections.length > 100) {
      throw new Error("单次最多添加 100 部番剧");
    }
    const uniqueIds = [
      ...new Set(
        selections
          .map((selection) => cleanString(selection?.id))
          .filter(Boolean),
      ),
    ];
    const catalogItems = uniqueIds.length
      ? await getCatalogStore().getItems(uniqueIds)
      : [];
    const byId = new Map(catalogItems.map((item) => [item.id, item]));
    const missing = selections
      .filter((selection) => !byId.has(cleanString(selection?.id)))
      .map((selection) => ({
        catalogId: cleanString(selection?.id) || null,
        title: cleanString(selection?.title) || "未知候选",
        reason: "catalog-not-found",
        message: "全量索引中已找不到该候选",
      }));
    const additions = selections
      .map((selection) => {
        const item = byId.get(cleanString(selection?.id));
        return item ? { item, ...selection } : null;
      })
      .filter(Boolean);
    const result = await store.batchUpdate(edits, additions);
    invalidateLibraryCache();
    return {
      ...result,
      skipped: [...missing, ...(result.skipped ?? [])],
      sync: result.changed
        ? { commit: result.commitShort ?? result.commit ?? "", branch: settings.branch }
        : null,
      syncError: null,
    };
  }
  if (url.pathname.startsWith("/api/records/") && method === "PUT") {
    const recordId = decodeURIComponent(
      url.pathname.slice("/api/records/".length),
    );
    const result = await store.saveRecord(recordId, parseBody(options));
    invalidateLibraryCache();
    return result;
  }
  if (url.pathname === "/api/records" && method === "DELETE") {
    const result = await store.deleteRecords(parseBody(options).ids);
    invalidateLibraryCache();
    return result;
  }
  if (url.pathname === "/api/sync" && method === "POST") {
    return store.sync(parseBody(options).message);
  }
  throw new Error(`在线管理不支持接口：${url.pathname}`);
}

export function api(path, options = {}) {
  return mode === "local" ? localApi(path, options) : onlineApi(path, options);
}

export function getRuntime() {
  return {
    mode,
    repository: settings.repository,
    branch: settings.branch,
    writable: mode === "local" || Boolean(token),
  };
}

export function replaceCatalog(options = {}) {
  if (mode === "local") {
    return localApi("/api/catalog/replace", { method: "POST" });
  }
  return getCatalogStore().replace(options);
}

export function refreshRuntimeLibrary() {
  invalidateLibraryCache();
}

renderRuntime();

elements.connectionButton?.addEventListener("click", openConnectionDialog);
elements.connectionClose?.addEventListener("click", closeConnectionDialog);
elements.connectionCancel?.addEventListener("click", closeConnectionDialog);
elements.connectionDisconnect?.addEventListener("click", disconnectToken);
elements.connectionForm?.addEventListener("submit", saveConnection);
elements.connectionDialog?.addEventListener("click", (event) => {
  if (event.target === elements.connectionDialog) {
    closeConnectionDialog();
  }
});
