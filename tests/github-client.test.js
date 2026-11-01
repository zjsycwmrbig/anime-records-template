import test from "node:test";
import assert from "node:assert/strict";
import {
  GitHubApiError,
  GitHubAdminStore,
  GitHubClient,
  base64ToText,
} from "../admin/github-client.js";
import { buildLibraryData } from "../scripts/admin-data.mjs";
import {
  parseBangumiCacheJsonl,
  serializeBangumiCache,
} from "../scripts/bangumi-cache-data.mjs";

const baseRecord = {
  $schema: "../../schemas/anime.schema.json",
  schemaVersion: 1,
  id: "manual-github-test",
  title: "远端测试",
  rating: null,
  review: "",
  coverUrl: null,
  note: "",
  externalIds: {},
  match: {
    status: "manual",
    method: "manual",
    source: "manual",
    confidence: 1,
    matchedTitle: "远端测试",
    matchedAt: "2026-10-25T12:00:00Z",
  },
  createdAt: "2026-10-25T12:00:00Z",
  updatedAt: "2026-10-25T12:00:00Z",
};

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function createSnapshot(oldLibrary, overrides = {}) {
  return {
    headSha: "a".repeat(40),
    baseTreeSha: "b".repeat(40),
    config: {
      dataFile: "data/anime.jsonl",
      indexFile: "data/anime-index.jsonl",
      backupDirectory: "data/backups",
      backupLimit: 2,
    },
    records: oldLibrary.records,
    index: oldLibrary.index,
    dataText: oldLibrary.dataText,
    indexText: oldLibrary.indexText,
    backups: [],
    ...overrides,
  };
}

function createPublishFetch(requests, options = {}) {
  let blobCount = 0;
  return async (url, init) => {
    const request = {
      url: String(url),
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : null,
    };
    requests.push(request);
    const path = new URL(url).pathname;

    if (path.endsWith("/git/blobs")) {
      blobCount += 1;
      return response({ sha: `blob-${blobCount}` });
    }
    if (path.endsWith("/git/trees")) {
      return response({ sha: "tree-new" });
    }
    if (path.endsWith("/git/commits")) {
      return response({ sha: "c".repeat(40) });
    }
    if (path.endsWith("/git/refs/heads/main")) {
      if (options.refConflict) {
        return response({ message: "Reference update failed" }, 422);
      }
      return response({ object: { sha: "c".repeat(40) } });
    }
    return response({ message: "Not found" }, 404);
  };
}

test("calls the default fetch with the global browser receiver", async () => {
  const originalFetch = globalThis.fetch;
  let receivedThis = null;
  globalThis.fetch = function fetchProbe() {
    receivedThis = this;
    return Promise.resolve(response({ full_name: "example/anime" }));
  };

  try {
    const client = new GitHubClient({ repository: "example/anime" });
    const result = await client.request("");
    assert.equal(receivedThis, globalThis);
    assert.equal(result.full_name, "example/anime");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries transient failures for idempotent GitHub requests", async () => {
  let attempts = 0;
  const delays = [];
  const client = new GitHubClient({
    repository: "example/anime",
    maxAttempts: 3,
    retryBaseDelayMs: 0,
    sleepImpl: async (delay) => delays.push(delay),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new TypeError("Failed to fetch");
      }
      return response({ full_name: "example/anime" });
    },
  });

  const result = await client.request("");

  assert.equal(result.full_name, "example/anime");
  assert.equal(attempts, 3);
  assert.equal(client.retryCount, 2);
  assert.deepEqual(delays, [0, 0]);
});

test("retries transient raw file responses", async () => {
  let attempts = 0;
  const client = new GitHubClient({
    repository: "example/anime",
    maxAttempts: 2,
    retryBaseDelayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return response({ message: "temporarily unavailable" }, 503);
      }
      return textResponse("archive content");
    },
  });

  const text = await client.requestRaw("admin/app.js", "main");

  assert.equal(text, "archive content");
  assert.equal(attempts, 2);
  assert.equal(client.retryCount, 1);
});

test("does not retry write requests or permanent client errors", async () => {
  let writeAttempts = 0;
  const writeClient = new GitHubClient({
    repository: "example/anime",
    maxAttempts: 3,
    retryBaseDelayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      writeAttempts += 1;
      return response({ message: "temporarily unavailable" }, 503);
    },
  });

  await assert.rejects(
    () => writeClient.request("/git/commits", { method: "POST", body: {} }),
    (error) => error instanceof GitHubApiError && error.status === 503,
  );
  assert.equal(writeAttempts, 1);

  let readAttempts = 0;
  const readClient = new GitHubClient({
    repository: "example/anime",
    maxAttempts: 3,
    retryBaseDelayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      readAttempts += 1;
      return response({ message: "Forbidden" }, 403);
    },
  });

  await assert.rejects(
    () => readClient.request(""),
    (error) =>
      error instanceof GitHubApiError &&
      error.status === 403 &&
      /Forbidden/u.test(error.message) &&
      /Workflows: Read and write/u.test(error.message),
  );
  assert.equal(readAttempts, 1);
});

test("aborts stalled GitHub reads and reports a timeout", async () => {
  const client = new GitHubClient({
    repository: "example/anime",
    maxAttempts: 1,
    requestTimeoutMs: 5,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  });

  await assert.rejects(
    () => client.request(""),
    (error) =>
      error instanceof GitHubApiError &&
      error.status === 0 &&
      /无法连接 GitHub \(api\.github\.com\).*请求超时/u.test(error.message),
  );
});

test("reads template file content through the authenticated Git Blob API", async () => {
  let request = null;
  const client = new GitHubClient({
    repository: "example/personal",
    token: "github_pat_secret",
    fetchImpl: async (url, init) => {
      request = {
        url: String(url),
        headers: init.headers,
      };
      return response({
        encoding: "base64",
        content: "Y29udGVudA==\n",
      });
    },
  });

  const content = await client.getBlobBase64For("example/template", "blob-sha");

  assert.equal(content, "Y29udGVudA==");
  assert.equal(
    request.url,
    "https://api.github.com/repos/example/template/git/blobs/blob-sha",
  );
  assert.equal(request.headers.Authorization, "Bearer github_pat_secret");
});

test("publishes data, index, and rotated backups in one Git Data commit", async () => {
  const oldLibrary = buildLibraryData([
    {
      ...baseRecord,
      title: "旧标题",
      updatedAt: "2026-10-25T10:00:00Z",
    },
  ]);
  const nextLibrary = buildLibraryData([
    {
      ...baseRecord,
      title: "新标题",
      rating: 9.2,
      updatedAt: "2026-10-25T13:00:00Z",
    },
  ]);
  const snapshot = createSnapshot(oldLibrary, {
    backups: [
      "library-2026-10-24T10-00-00-000Z-11111111.json",
      "library-2026-10-23T10-00-00-000Z-22222222.json",
    ],
  });
  const requests = [];
  const fetchImpl = createPublishFetch(requests);
  const client = new GitHubClient({
    repository: "example/anime",
    branch: "main",
    token: "github_pat_secret",
    fetchImpl,
    now: () => "2026-10-25T13:00:00.000Z",
  });

  const result = await client.publish(
    snapshot,
    nextLibrary,
    "chore(data): test atomic publish",
  );

  assert.equal(requests.length, 6);
  assert.equal(
    requests[0].headers.Authorization,
    "Bearer github_pat_secret",
  );
  assert.equal(base64ToText(requests[0].body.content), nextLibrary.dataText);
  assert.equal(base64ToText(requests[1].body.content), nextLibrary.indexText);
  assert.match(result.backupPath, /^data\/backups\/library-2026-10-25/u);

  const treeRequest = requests.find((request) =>
    request.url.endsWith("/git/trees"),
  );
  assert.equal(treeRequest.body.base_tree, snapshot.baseTreeSha);
  assert.equal(treeRequest.body.tree.length, 4);
  assert.equal(
    treeRequest.body.tree.find(
      (entry) => entry.path === snapshot.config.dataFile,
    ).sha,
    "blob-1",
  );
  assert.equal(
    treeRequest.body.tree.find(
      (entry) => entry.path === snapshot.config.indexFile,
    ).sha,
    "blob-2",
  );
  assert.equal(
    treeRequest.body.tree.find((entry) =>
      entry.path.endsWith("22222222.json"),
    ).sha,
    null,
  );

  const commitRequest = requests.find((request) =>
    request.url.endsWith("/git/commits"),
  );
  assert.deepEqual(commitRequest.body.parents, [snapshot.headSha]);
  assert.equal(commitRequest.body.tree, "tree-new");
  assert.equal(commitRequest.body.message, "chore(data): test atomic publish");

  const refRequest = requests.at(-1);
  assert.equal(refRequest.method, "PATCH");
  assert.deepEqual(refRequest.body, {
    sha: "c".repeat(40),
    force: false,
  });
});

test("does not call GitHub when the library is unchanged", async () => {
  const library = buildLibraryData([baseRecord]);
  let requestCount = 0;
  const client = new GitHubClient({
    repository: "example/anime",
    fetchImpl: async () => {
      requestCount += 1;
      return response({});
    },
  });

  const result = await client.publish(
    createSnapshot(library),
    library,
    "unused",
  );

  assert.equal(requestCount, 0);
  assert.equal(result.commit, "");
  assert.equal(result.backupPath, null);
});

test("loads the library and personal Bangumi cache from raw content", async () => {
  const library = buildLibraryData([baseRecord]);
  const bangumiCacheText = serializeBangumiCache([
    {
      subjectId: "400602",
      score: 8.7,
      tags: [{ name: "奇幻", count: 1200 }],
      fetchedAt: "2026-10-27T08:00:00Z",
      source: "bangumi-archive",
    },
  ]);
  const headSha = "a".repeat(40);
  const config = {
    dataFile: "data/anime.jsonl",
    indexFile: "data/anime-index.jsonl",
    bangumiCacheFile: "data/bangumi-cache.jsonl",
    backupDirectory: "data/backups",
    backupLimit: 5,
  };
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.pathname.endsWith(`/git/ref/heads/main`)) {
      return response({ object: { sha: headSha } });
    }
    if (parsed.pathname.endsWith(`/git/commits/${headSha}`)) {
      return response({ tree: { sha: "b".repeat(40) } });
    }
    if (parsed.pathname.endsWith("/config/site.json")) {
      return textResponse(JSON.stringify(config));
    }
    if (parsed.pathname.endsWith("/data/anime.jsonl")) {
      return textResponse(library.dataText);
    }
    if (parsed.pathname.endsWith("/data/anime-index.jsonl")) {
      return textResponse(library.indexText);
    }
    if (parsed.pathname.endsWith("/data/bangumi-cache.jsonl")) {
      return textResponse(bangumiCacheText);
    }
    return textResponse("Not found", 404);
  };
  const client = new GitHubClient({
    repository: "example/anime",
    branch: "main",
    fetchImpl,
  });

  const snapshot = await client.loadSnapshot();

  assert.equal(snapshot.headSha, headSha);
  assert.equal(snapshot.records[0].title, baseRecord.title);
  assert.equal(snapshot.dataText, library.dataText);
  assert.equal(snapshot.bangumiCacheText, bangumiCacheText);
  assert.equal(snapshot.bangumiCache[0].subjectId, "400602");
  assert.deepEqual(snapshot.backups, []);
  assert.equal(
    requests.filter((request) => request.hostname === "api.github.com").length,
    2,
  );
  assert.equal(
    requests.filter(
      (request) => request.hostname === "raw.githubusercontent.com",
    ).length,
    4,
  );
});

test("loads an authenticated personal Bangumi cache through the Git Blob API", async () => {
  const library = buildLibraryData([baseRecord]);
  const bangumiCacheText = serializeBangumiCache([
    {
      subjectId: "400602",
      score: 8.7,
      tags: [{ name: "奇幻", count: 1200 }],
      fetchedAt: "2026-10-27T08:00:00Z",
      source: "bangumi-archive",
    },
  ]);
  const headSha = "a".repeat(40);
  const treeSha = "b".repeat(40);
  const config = {
    dataFile: "data/anime.jsonl",
    indexFile: "data/anime-index.jsonl",
    bangumiCacheFile: "data/bangumi-cache.jsonl",
    backupDirectory: "data/backups",
    backupLimit: 5,
  };
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({
      path: parsed.pathname,
      headers: init.headers,
    });
    if (parsed.pathname.endsWith("/git/ref/heads/main")) {
      return response({ object: { sha: headSha } });
    }
    if (parsed.pathname.endsWith(`/git/commits/${headSha}`)) {
      return response({ tree: { sha: treeSha } });
    }
    if (parsed.pathname.endsWith("/contents/config/site.json")) {
      return response({
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(config)).toString("base64"),
      });
    }
    if (parsed.pathname.endsWith("/contents/data/anime.jsonl")) {
      return response({
        type: "file",
        encoding: "base64",
        content: Buffer.from(library.dataText).toString("base64"),
      });
    }
    if (parsed.pathname.endsWith("/contents/data/anime-index.jsonl")) {
      return response({
        type: "file",
        encoding: "base64",
        content: Buffer.from(library.indexText).toString("base64"),
      });
    }
    if (parsed.pathname.endsWith(`/git/trees/${treeSha}`)) {
      return response({
        truncated: false,
        tree: [
          {
            path: "data/bangumi-cache.jsonl",
            type: "blob",
            sha: "cache-blob-sha",
          },
        ],
      });
    }
    if (parsed.pathname.endsWith("/git/blobs/cache-blob-sha")) {
      return response({
        encoding: "base64",
        content: Buffer.from(bangumiCacheText).toString("base64"),
      });
    }
    return response({ message: "Not found" }, 404);
  };
  const client = new GitHubClient({
    repository: "example/anime",
    branch: "main",
    token: "github_pat_secret",
    fetchImpl,
  });

  const snapshot = await client.loadSnapshot();

  assert.equal(snapshot.bangumiCacheText, bangumiCacheText);
  assert.equal(snapshot.bangumiCache[0].subjectId, "400602");
  assert.ok(
    requests.some(
      (request) => request.path.endsWith("/git/blobs/cache-blob-sha"),
    ),
  );
  assert.equal(
    requests.some((request) =>
      request.path.endsWith("/contents/data/bangumi-cache.jsonl"),
    ),
    false,
  );
  assert.equal(
    requests.find((request) =>
      request.path.endsWith("/git/blobs/cache-blob-sha"),
    ).headers.Authorization,
    "Bearer github_pat_secret",
  );
});

test("prefers raw files for authenticated public repositories", async () => {
  const library = buildLibraryData([baseRecord]);
  const bangumiCacheText = serializeBangumiCache([
    {
      subjectId: "400602",
      score: 8.7,
      fetchedAt: "2026-10-27T08:00:00Z",
      source: "bangumi-archive",
    },
  ]);
  const headSha = "a".repeat(40);
  const config = {
    dataFile: "data/anime.jsonl",
    indexFile: "data/anime-index.jsonl",
    bangumiCacheFile: "data/bangumi-cache.jsonl",
    backupDirectory: "data/backups",
    backupLimit: 5,
  };
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.pathname.endsWith("/git/ref/heads/main")) {
      return response({ object: { sha: headSha } });
    }
    if (parsed.pathname.endsWith(`/git/commits/${headSha}`)) {
      return response({ tree: { sha: "b".repeat(40) } });
    }
    if (parsed.hostname === "raw.githubusercontent.com") {
      if (parsed.pathname.endsWith("/config/site.json")) {
        return textResponse(JSON.stringify(config));
      }
      if (parsed.pathname.endsWith("/data/anime.jsonl")) {
        return textResponse(library.dataText);
      }
      if (parsed.pathname.endsWith("/data/anime-index.jsonl")) {
        return textResponse(library.indexText);
      }
      if (parsed.pathname.endsWith("/data/bangumi-cache.jsonl")) {
        return textResponse(bangumiCacheText);
      }
    }
    return response({ message: "Not found" }, 404);
  };
  const client = new GitHubClient({
    repository: "example/anime",
    branch: "main",
    token: "github_pat_secret",
    fetchImpl,
  });

  const snapshot = await client.loadSnapshot();

  assert.equal(snapshot.bangumiCacheText, bangumiCacheText);
  assert.equal(snapshot.bangumiCache[0].subjectId, "400602");
  assert.equal(
    requests.some((request) =>
      request.pathname.includes("/git/trees/"),
    ),
    false,
  );
  assert.equal(
    requests.some((request) =>
      request.pathname.endsWith("/contents/data/bangumi-cache.jsonl"),
    ),
    false,
  );
});

test("publishes merged personal Bangumi cache with one file commit", async () => {
  const initialText = serializeBangumiCache([
    {
      subjectId: "101",
      score: 8.1,
      fetchedAt: "2026-10-27T08:00:00Z",
      source: "bangumi-archive",
    },
  ]);
  let published = null;
  const client = {
    token: "github_pat_secret",
    async loadSnapshot() {
      return {
        headSha: "a".repeat(40),
        baseTreeSha: "b".repeat(40),
        config: { bangumiCacheFile: "data/bangumi-cache.jsonl" },
        bangumiCache: parseBangumiCacheJsonl(initialText),
        bangumiCacheText: initialText,
      };
    },
    async publishFileChange(snapshot, filePath, text, message) {
      published = { snapshot, filePath, text, message };
      return { commit: "c".repeat(40), commitShort: "ccccccc" };
    },
  };
  const store = new GitHubAdminStore(client);
  const result = await store.saveBangumiCache({
    mode: "merge",
    message: "chore(data): sync personal Bangumi cache",
    entries: [
      {
        subjectId: "102",
        score: 9.1,
        tags: [{ name: "悬疑", count: 40 }],
        fetchedAt: "2026-10-27T09:00:00Z",
        source: "bangumi-api",
      },
    ],
  });

  assert.equal(result.changed, true);
  assert.equal(result.count, 2);
  assert.equal(result.commitShort, "ccccccc");
  assert.equal(published.filePath, "data/bangumi-cache.jsonl");
  assert.equal(
    published.message,
    "chore(data): sync personal Bangumi cache",
  );
  assert.deepEqual(
    parseBangumiCacheJsonl(published.text).map((entry) => entry.subjectId),
    ["101", "102"],
  );
});

test("publishes supplement mode without replacing an existing subject", async () => {
  const initialText = serializeBangumiCache([
    {
      subjectId: "201",
      score: 8.1,
      fetchedAt: "2026-10-27T08:00:00Z",
      source: "bangumi-archive",
    },
  ]);
  let published = null;
  const client = {
    token: "github_pat_secret",
    async loadSnapshot() {
      return {
        headSha: "a".repeat(40),
        baseTreeSha: "b".repeat(40),
        config: { bangumiCacheFile: "data/bangumi-cache.jsonl" },
        bangumiCache: parseBangumiCacheJsonl(initialText),
        bangumiCacheText: initialText,
      };
    },
    async publishFileChange(_snapshot, _filePath, text) {
      published = text;
      return { commit: "d".repeat(40), commitShort: "ddddddd" };
    },
  };
  const store = new GitHubAdminStore(client);

  const result = await store.saveBangumiCache({
    mode: "supplement",
    entries: [
      {
        subjectId: "201",
        score: 9.9,
        fetchedAt: "2026-10-27T12:00:00Z",
        source: "bangumi-api",
      },
      {
        subjectId: "202",
        score: 9.2,
        fetchedAt: "2026-10-27T11:00:00Z",
        source: "bangumi-api",
      },
    ],
  });

  const entries = parseBangumiCacheJsonl(published);
  assert.deepEqual(
    entries.map((entry) => [entry.subjectId, entry.score]),
    [
      ["201", 8.1],
      ["202", 9.2],
    ],
  );
  assert.equal(result.count, 2);
});

test("turns a stale branch update into an actionable conflict", async () => {
  const oldLibrary = buildLibraryData([baseRecord]);
  const nextLibrary = buildLibraryData([
    { ...baseRecord, rating: 8.6, updatedAt: "2026-10-25T13:00:00Z" },
  ]);
  const requests = [];
  const client = new GitHubClient({
    repository: "example/anime",
    branch: "main",
    token: "github_pat_secret",
    fetchImpl: createPublishFetch(requests, { refConflict: true }),
    now: () => "2026-10-25T13:00:00.000Z",
  });

  await assert.rejects(
    () =>
      client.publish(
        createSnapshot(oldLibrary, { backupLimit: 5 }),
        nextLibrary,
        "stale update",
      ),
    (error) =>
      error instanceof GitHubApiError &&
      error.status === 409 &&
      /刷新后重新操作/u.test(error.message),
  );
});
