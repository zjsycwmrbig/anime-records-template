import {
  catalogItemView,
  ownedRecordIdForCatalogItem,
  ownedRecordLookup,
} from "../scripts/catalog-data.mjs";

export class BrowserCatalogStore {
  constructor(options = {}) {
    this.createWorker =
      options.createWorker ??
      (() =>
        new Worker(new URL("./catalog-worker.js", import.meta.url), {
          type: "module",
        }));
    this.worker = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  ensureWorker() {
    if (this.worker) {
      return this.worker;
    }
    this.worker = this.createWorker();
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
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(event.message || "索引 Worker 运行失败"));
      }
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    });
    return this.worker;
  }

  request(type, options = {}, timeoutMs = 120000, onProgress = null) {
    const worker = this.ensureWorker();
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
