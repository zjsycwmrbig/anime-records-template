import {
  buildCatalog,
  buildCatalogFromCompact,
  catalogFacets,
  isValidCatalog,
  searchCatalog,
} from "../scripts/catalog-data.mjs";

const VERSION_URL = "https://data.jsdelivr.com/v1/package/npm/bangumi-data";
const FALLBACK_VERSION_URL = "https://registry.npmjs.org/bangumi-data/latest";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DATABASE_NAME = "myanimelife-catalog";
const STORE_NAME = "catalog";
const CACHE_KEY = "bangumi-data";
const BUNDLED_CATALOG_URL = new URL("./bangumi-public-catalog.json", import.meta.url);

let catalog = null;
let catalogPromise = null;

function sourceUrl(version) {
  return `https://cdn.jsdelivr.net/npm/bangumi-data@${encodeURIComponent(version)}/dist/data.json`;
}

async function requestJson(url, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("无法打开本地索引数据库")),
    );
  });
}

async function readCache() {
  try {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(CACHE_KEY);
        request.addEventListener("success", () => {
          const value = request.result;
          resolve(isValidCatalog(value) ? value : null);
        });
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("读取本地索引失败")),
        );
      });
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

async function writeCache(catalog) {
  try {
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(catalog, CACHE_KEY);
        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("error", () =>
          reject(transaction.error ?? new Error("写入本地索引失败")),
        );
      });
    } finally {
      database.close();
    }
  } catch {
    // The bundled catalog remains usable when persistent storage is blocked.
  }
}

async function readBundledCatalog() {
  try {
    const response = await fetch(BUNDLED_CATALOG_URL, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const catalog = buildCatalogFromCompact(payload);
    return isValidCatalog(catalog) ? catalog : null;
  } catch {
    return null;
  }
}

function isFresh(catalog) {
  const checkedAt = new Date(catalog?.source?.checkedAt ?? "").getTime();
  const age = Date.now() - checkedAt;
  return Number.isFinite(checkedAt) && age >= 0 && age < MAX_AGE_MS;
}

async function fetchLatestVersion() {
  try {
    const metadata = await requestJson(VERSION_URL, 15000);
    if (metadata?.tags?.latest) {
      return String(metadata.tags.latest);
    }
  } catch {
    // Fall through to npm metadata.
  }
  const metadata = await requestJson(FALLBACK_VERSION_URL, 15000);
  if (!metadata?.version) {
    throw new Error("无法取得 bangumi-data 最新版本");
  }
  return String(metadata.version);
}

async function downloadCatalog(version, onProgress = () => {}) {
  const url = sourceUrl(version);
  let raw;
  try {
    raw = await requestJsonWithProgress(url, onProgress);
  } catch {
    raw = await requestJsonWithProgress(
      `https://unpkg.com/bangumi-data@${encodeURIComponent(version)}/dist/data.json`,
      onProgress,
    );
  }
  const now = new Date().toISOString();
  return buildCatalog(raw, {
    version,
    sourceUrl: url,
    fetchedAt: now,
    checkedAt: now,
  });
}

async function requestJsonWithProgress(url, onProgress) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body?.getReader) {
      const text = await response.text();
      onProgress({ phase: "download", loaded: text.length, total, indeterminate: !total });
      return JSON.parse(text);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let loaded = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      loaded += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
      onProgress({ phase: "download", loaded, total, indeterminate: !total });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function loadCatalog(refresh) {
  const cached = await readCache();
  if (cached && !refresh && isFresh(cached)) {
    return cached;
  }

  if (cached && !refresh) {
    void refreshStaleCatalog(cached);
    return cached;
  }

  if (!refresh) {
    const bundled = await readBundledCatalog();
    if (bundled) {
      await writeCache(bundled);
      void refreshStaleCatalog(bundled);
      return bundled;
    }
  }

  try {
    const version = await fetchLatestVersion();
    if (cached?.source?.version === version) {
      const updated = {
        ...cached,
        source: {
          ...cached.source,
          checkedAt: new Date().toISOString(),
        },
      };
      await writeCache(updated);
      return updated;
    }
    const downloaded = await downloadCatalog(version);
    await writeCache(downloaded);
    return downloaded;
  } catch (error) {
    if (cached) {
      return cached;
    }
    throw new Error(`全量番剧索引下载失败：${error.message || "网络错误"}`);
  }
}

const isWorkerContext =
  typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;

async function refreshStaleCatalog(cached) {
  try {
    const version = await fetchLatestVersion();
    const updated =
      cached.source?.version === version
        ? {
            ...cached,
            source: {
              ...cached.source,
              checkedAt: new Date().toISOString(),
            },
          }
        : await downloadCatalog(version);
    await writeCache(updated);
    catalog = updated;
    if (isWorkerContext) {
      self.postMessage({
        type: "catalog-updated",
        payload: {
          version: updated.source.version,
          checkedAt: updated.source.checkedAt,
        },
      });
    }
  } catch {
    // The stale local index remains usable while the network is unavailable.
  }
}

export async function replaceCatalogIndex(onProgress = () => {}) {
  onProgress({ phase: "version", message: "正在检查 bangumi-data 版本" });
  const version = await fetchLatestVersion();
  const cached = await readCache();
  onProgress({ phase: "version", version, message: `发现 bangumi-data ${version}` });
  if (cached?.source?.version === version) {
    const updated = {
      ...cached,
      source: { ...cached.source, checkedAt: new Date().toISOString() },
    };
    await writeCache(updated);
    catalog = updated;
    onProgress({ phase: "done", version, itemCount: updated.itemCount, reused: true });
    return { ...updated, reused: true };
  }
  const downloaded = await downloadCatalog(version, onProgress);
  onProgress({ phase: "parse", version, message: "正在建立索引" });
  await writeCache(downloaded);
  catalog = downloaded;
  catalogPromise = Promise.resolve(downloaded);
  onProgress({ phase: "done", version, itemCount: downloaded.itemCount });
  return downloaded;
}

function getCatalog(refresh = false) {
  if (catalog && refresh) {
    catalog = null;
    catalogPromise = null;
  }
  if (catalog) {
    return Promise.resolve(catalog);
  }
  if (!catalogPromise) {
    catalogPromise = loadCatalog(refresh)
      .then((loaded) => {
        catalog = loaded;
        return loaded;
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

export async function searchCatalogIndex(options = {}) {
  const catalog = await getCatalog(Boolean(options.refresh));
  return {
    ...searchCatalog(catalog.items, options),
    meta: {
      itemCount: catalog.itemCount,
      version: catalog.source.version,
      checkedAt: catalog.source.checkedAt,
      license: catalog.source.license,
      sourceUrl: catalog.source.sourceUrl,
      seededFrom: catalog.source.seededFrom ?? null,
    },
    facets: catalogFacets(catalog.items),
  };
}

export async function getCatalogItems(ids) {
  const loaded = await getCatalog(false);
  const requested = new Set(ids ?? []);
  return loaded.items.filter((item) => requested.has(item.id));
}

export async function getBangumiCatalogItems() {
  const loaded = await getCatalog(false);
  return loaded.items
    .filter((item) => item.sites?.bangumi)
    .map((item) => ({
      id: item.id,
      displayTitle: item.displayTitle,
      title: item.title,
      year: item.year,
      sites: { bangumi: item.sites.bangumi },
      coverUrl: item.coverUrl ?? null,
    }));
}

export function resetCatalogIndex() {
  catalog = null;
  catalogPromise = null;
}

async function handleWorkerMessage(event) {
  const { type, requestId, options = {} } = event.data ?? {};
  if (type === "reset") {
    resetCatalogIndex();
    self.postMessage({ type: "reset", requestId });
    return;
  }
  if (type === "getItems") {
    try {
      self.postMessage({
        type: "result",
        requestId,
        payload: await getCatalogItems(options.ids),
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        requestId,
        error: error.message || "索引读取失败",
      });
    }
    return;
  }
  if (type === "getBangumiItems") {
    try {
      self.postMessage({
        type: "result",
        requestId,
        payload: await getBangumiCatalogItems(),
      });
    } catch (error) {
      self.postMessage({ type: "error", requestId, error: error.message || "索引读取失败" });
    }
    return;
  }
  if (type === "replace") {
    try {
      const payload = await replaceCatalogIndex((progress) =>
        self.postMessage({ type: "progress", requestId, payload: progress }),
      );
      self.postMessage({
        type: "result",
        requestId,
        payload: {
          version: payload.source.version,
          checkedAt: payload.source.checkedAt,
          itemCount: payload.itemCount,
          reused: Boolean(payload.reused),
          license: payload.source.license,
          sourceUrl: payload.source.sourceUrl,
        },
      });
    } catch (error) {
      self.postMessage({ type: "error", requestId, error: error.message || "索引替换失败" });
    }
    return;
  }
  if (type !== "search") {
    return;
  }
  try {
    const payload = await searchCatalogIndex(options);
    self.postMessage({ type: "result", requestId, payload });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: error.message || "索引读取失败",
    });
  }
}

if (isWorkerContext) {
  self.addEventListener("message", handleWorkerMessage);
}
