import {
  catalogItemView,
  ownedRecordIdForCatalogItem,
  ownedRecordLookup,
} from "../scripts/catalog-data.mjs";
import {
  getBangumiCatalogItems,
  getCatalogItems,
  replaceCatalogIndex,
  searchCatalogIndex,
} from "./catalog-worker.js";

function workerFailure(message, cause = null) {
  const error = new Error(message || "索引 Worker 运行失败");
  error.name = "CatalogWorkerError";
  error.isWorkerFailure = true;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

export class BrowserCatalogStore {
  constructor(options = {}) {
    this.createWorker =
      options.createWorker ??
      (() =>
        new Worker(new URL("./catalog-worker.js", import.meta.url), {
          type: "module",
        }));
    this.fallbackEngine = options.fallbackEngine ?? {
      getItems: getCatalogItems,
      getBangumiItems: getBangumiCatalogItems,
      replace: replaceCatalogIndex,
      search: searchCatalogIndex,
    };
    this.worker = null;
    this.workerUnavailable = false;
    this.sequence = 0;
    this.pending = new Map();
  }

  ensureWorker() {
    if (this.workerUnavailable) {
      throw workerFailure("索引 Worker 不可用");
    }
    if (this.worker) {
      return this.worker;
    }
    try {
      this.worker = this.createWorker();
    } catch (error) {
      this.workerUnavailable = true;
      throw workerFailure(error.message, error);
    }
    this.worker.addEventListener("message", (event) => {
      if (event.data.type === "catalog-updated") {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("anime-catalog:changed", {
              detail: event.data.payload,
            }),
          );
        }
        return;
      }
      if (event.data.type === "progress") {
        const pending = this.pending.get(event.data.requestId);
        pending?.onProgress?.(event.data.payload);
        return;
      }
      const requestId = event.data?.requestId;
      const pending = this.pending.get(requestId);
      if (!pending) {
        return;
      }
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      if (event.data.type === "error") {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve(event.data.payload);
      }
    });
    this.worker.addEventListener("error", (event) => {
      const error = workerFailure(
        [event.message, event.filename ? `${event.filename}:${event.lineno ?? 0}` : ""]
          .filter(Boolean)
          .join(" · "),
      );
      this.workerUnavailable = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    });
    return this.worker;
  }

  requestWorker(type, options = {}, timeoutMs = 120000, onProgress = null) {
    let worker;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("全量索引处理超时，请检查网络后重试"));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, onProgress });
      worker.postMessage({ type, requestId, options });
    });
  }

  async requestFallback(type, options = {}, onProgress = null) {
    if (type === "search") {
      return this.fallbackEngine.search(options);
    }
    if (type === "getItems") {
      return this.fallbackEngine.getItems(options.ids ?? []);
    }
    if (type === "getBangumiItems") {
      return this.fallbackEngine.getBangumiItems();
    }
    if (type === "replace") {
      return this.fallbackEngine.replace(onProgress ?? options.onProgress);
    }
    throw new Error(`不支持的索引请求：${type}`);
  }

  async request(type, options = {}, timeoutMs = 120000, onProgress = null) {
    try {
      return await this.requestWorker(type, options, timeoutMs, onProgress);
    } catch (error) {
      if (!error?.isWorkerFailure) {
        throw error;
      }
      return this.requestFallback(type, options, onProgress);
    }
  }

  async search(options = {}, libraryIndex = []) {
    const owned = ownedRecordLookup(libraryIndex);
    const payload = await this.request("search", {
      ...options,
      ownedKeys: [...owned.keys()],
    });
    return {
      ...payload,
      items: payload.items.map((item) =>
        catalogItemView(item, ownedRecordIdForCatalogItem(item, owned)),
      ),
    };
  }

  async getItems(itemIds) {
    return this.request("getItems", { ids: itemIds });
  }

  async getItem(itemId) {
    const items = await this.getItems([itemId]);
    return items[0] ?? null;
  }

  async getBangumiItems() {
    return this.request("getBangumiItems", {}, 120000);
  }

  async replace(options = {}) {
    return this.request("replace", {}, 180000, options.onProgress);
  }
}
