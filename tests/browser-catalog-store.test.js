import test from "node:test";
import assert from "node:assert/strict";
import { BrowserCatalogStore } from "../admin/browser-catalog-store.js";

class FakeWorker {
  constructor(payload) {
    this.payload = payload;
    this.listeners = new Map();
    this.lastMessage = null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    this.lastMessage = message;
    queueMicrotask(() => {
      const event = new Event("message");
      Object.defineProperty(event, "data", {
        value: {
          type: "result",
          requestId: message.requestId,
          payload: this.payload,
        },
      });
      for (const listener of this.listeners.get("message") ?? []) {
        listener(event);
      }
    });
  }

  terminate() {}
}

test("passes owned identities to the catalog worker before pagination", async () => {
  const worker = new FakeWorker({
    total: 1,
    offset: 0,
    limit: 30,
    items: [
      {
        id: "bangumi:100",
        title: "テスト",
        displayTitle: "测试番剧",
        names: ["测试番剧", "テスト"],
        type: "tv",
        begin: "2024-01-01T00:00:00.000Z",
        year: 2024,
        sites: { bangumi: "100" },
        season: { key: "bangumi:100", number: null, label: null, year: 2024 },
        coverUrl: null,
      },
    ],
  });
  const metadataEntries = [
    {
      subjectId: "100",
      score: 8.8,
      tags: [{ name: "奇幻", count: 20 }],
      storageSource: "personal",
    },
  ];
  const store = new BrowserCatalogStore({
    createWorker: () => worker,
  });
  const result = await store.search(
    {
      owned: "owned",
      limit: 30,
      offset: 0,
      tags: ["奇幻"],
      metadataEntries,
    },
    [{ id: "bgm-100", externalIds: { bangumi: "100" } }],
  );

  assert.equal(worker.lastMessage.options.owned, "owned");
  assert.deepEqual(worker.lastMessage.options.metadataEntries, metadataEntries);
  assert.deepEqual(worker.lastMessage.options.tags, ["奇幻"]);
  assert.deepEqual(worker.lastMessage.options.ownedKeys, [
    "id:bgm-100",
    "bangumi:100",
  ]);
  assert.equal(result.items[0].ownedRecordId, "bgm-100");
});

test("falls back to the main-thread catalog when a worker cannot start", async () => {
  const fallbackOptions = [];
  const store = new BrowserCatalogStore({
    createWorker() {
      throw new Error("Worker disabled");
    },
    fallbackEngine: {
      async search(options) {
        fallbackOptions.push(options);
        return {
          total: 1,
          offset: 0,
          limit: 30,
          items: [
            {
              id: "bangumi:200",
              title: "フォールバック",
              displayTitle: "回退索引",
              names: ["回退索引", "フォールバック"],
              type: "tv",
              begin: "2025-01-01T00:00:00.000Z",
              year: 2025,
              sites: { bangumi: "200" },
              season: { key: "bangumi:200", number: null, label: null, year: 2025 },
              coverUrl: null,
            },
          ],
          facets: { years: [], sources: [] },
          meta: { version: "test" },
        };
      },
    },
  });

  const result = await store.search({ query: "回退", limit: 30 });

  assert.equal(fallbackOptions.length, 1);
  assert.deepEqual(fallbackOptions[0].ownedKeys, []);
  assert.equal(result.items[0].displayTitle, "回退索引");
  assert.equal(store.workerUnavailable, true);
});
