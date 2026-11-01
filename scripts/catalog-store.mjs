import fs from "node:fs/promises";
import path from "node:path";
import {
  buildCatalog,
  catalogFacets,
  catalogItemView,
  isValidCatalog,
  ownedRecordIdForCatalogItem,
  ownedRecordLookup,
  searchCatalog,
} from "./catalog-data.mjs";

const VERSION_URL = "https://data.jsdelivr.com/v1/package/npm/bangumi-data";
const FALLBACK_VERSION_URL = "https://registry.npmjs.org/bangumi-data/latest";
const CACHE_FILE = ".cache/bangumi-data.catalog.json";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cleanString(value) {
  return String(value ?? "").trim();
}

function sourceUrl(version) {
  return `https://cdn.jsdelivr.net/npm/bangumi-data@${encodeURIComponent(version)}/dist/data.json`;
}

async function writeFileAtomic(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, text, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function requestJson(fetchImpl, url, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "myanimelife-admin",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function catalogError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export class CatalogStore {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.cacheFile = path.resolve(
      this.root,
      options.cacheFile ?? CACHE_FILE,
    );
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.catalog = null;
    this.loading = null;
  }

  async readCache() {
    try {
      const catalog = JSON.parse(await fs.readFile(this.cacheFile, "utf8"));
      return isValidCatalog(catalog) ? catalog : null;
    } catch {
      return null;
    }
  }

  async writeCache(catalog) {
    await writeFileAtomic(this.cacheFile, `${JSON.stringify(catalog)}\n`);
  }

  isFresh(catalog) {
    const now = new Date(this.now()).getTime();
    const checkedAt = new Date(catalog?.source?.checkedAt ?? "").getTime();
    return (
      Number.isFinite(now) &&
      Number.isFinite(checkedAt) &&
      now - checkedAt >= 0 &&
      now - checkedAt < this.maxAgeMs
    );
  }

  async fetchLatestVersion() {
    try {
      const metadata = await requestJson(this.fetchImpl, VERSION_URL, 15000);
      const version = cleanString(metadata?.tags?.latest);
      if (version) {
        return version;
      }
    } catch {
      // Fall through to npm metadata.
    }
    const metadata = await requestJson(
      this.fetchImpl,
      FALLBACK_VERSION_URL,
      15000,
    );
    const version = cleanString(metadata?.version);
    if (!version) {
      throw new Error("无法取得 bangumi-data 最新版本");
    }
    return version;
  }

  async downloadCatalog(version) {
    const url = sourceUrl(version);
    let raw;
    try {
      raw = await requestJson(this.fetchImpl, url);
    } catch {
      raw = await requestJson(
        this.fetchImpl,
        `https://unpkg.com/bangumi-data@${encodeURIComponent(version)}/dist/data.json`,
      );
    }
    const now = this.now();
    return buildCatalog(raw, {
      version,
      sourceUrl: url,
      fetchedAt: now,
      checkedAt: now,
    });
  }

  async load(options = {}) {
    if (this.catalog && !options.refresh && this.isFresh(this.catalog)) {
      return this.catalog;
    }
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.loadCatalog(options).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async loadCatalog(options) {
    const cached = this.catalog ?? (await this.readCache());
    if (cached && !options.refresh && this.isFresh(cached)) {
      this.catalog = cached;
      return cached;
    }
    if (options.refresh === false && cached) {
      this.catalog = cached;
      return cached;
    }

    try {
      const version = await this.fetchLatestVersion();
      if (cached?.source?.version === version) {
        this.catalog = {
          ...cached,
          source: {
            ...cached.source,
            checkedAt: this.now(),
          },
        };
        await this.writeCache(this.catalog);
        return this.catalog;
      }

      this.catalog = await this.downloadCatalog(version);
      await this.writeCache(this.catalog);
      return this.catalog;
    } catch (error) {
      if (cached) {
        this.catalog = cached;
        return cached;
      }
      throw catalogError(
        `全量番剧索引下载失败：${error.message || "未知网络错误"}`,
      );
    }
  }

  async replace() {
    const cached = this.catalog ?? (await this.readCache());
    const version = await this.fetchLatestVersion();
    if (cached?.source?.version === version) {
      this.catalog = {
        ...cached,
        source: {
          ...cached.source,
          checkedAt: this.now(),
        },
      };
      await this.writeCache(this.catalog);
      return {
        version,
        checkedAt: this.catalog.source.checkedAt,
        itemCount: this.catalog.itemCount,
        license: this.catalog.source.license,
        sourceUrl: this.catalog.source.sourceUrl,
        reused: true,
      };
    }
    const next = await this.downloadCatalog(version);
    await this.writeCache(next);
    this.catalog = next;
    return {
      version,
      checkedAt: next.source.checkedAt,
      itemCount: next.itemCount,
      license: next.source.license,
      sourceUrl: next.source.sourceUrl,
      reused: false,
    };
  }

  async search(options = {}, libraryIndex = []) {
    const catalog = await this.load({ refresh: Boolean(options.refresh) });
    const owned = ownedRecordLookup(libraryIndex);
    const result = searchCatalog(catalog.items, {
      ...options,
      ownedKeys: [...owned.keys()],
    });
    return {
      ...result,
      items: result.items.map((item) =>
        catalogItemView(item, ownedRecordIdForCatalogItem(item, owned)),
      ),
      meta: {
        itemCount: catalog.itemCount,
        version: catalog.source.version,
        checkedAt: catalog.source.checkedAt,
        license: catalog.source.license,
        sourceUrl: catalog.source.sourceUrl,
      },
      facets: catalogFacets(catalog.items),
    };
  }

  async getItem(itemId) {
    const catalog = await this.load();
    return catalog.items.find((item) => item.id === itemId) ?? null;
  }

  async getItems(itemIds) {
    const catalog = await this.load();
    const requested = new Set(itemIds);
    return catalog.items.filter((item) => requested.has(item.id));
  }
}
