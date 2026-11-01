import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LibraryAdminStore } from "./admin-store.mjs";
import { CatalogStore } from "./catalog-store.mjs";
import { findDuplicateGroups } from "./duplicate-data.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(
  process.env.ADMIN_ROOT || path.resolve(scriptDirectory, ".."),
);
const adminDirectory = path.join(root, "admin");
const scriptsDirectory = path.join(root, "scripts");
const store = new LibraryAdminStore(root);
const catalogStore = new CatalogStore(root);
const host = process.env.ADMIN_HOST || "127.0.0.1";
const port = Number(process.env.ADMIN_PORT || 4174);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendError(response, error) {
  sendJson(response, Number(error.status) || 400, {
    error: error.message || "请求失败",
  });
}

function bangumiCachePayload(result) {
  const { text: _text, ...payload } = result;
  return payload;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) {
      throw new Error("请求内容过大");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求内容不是有效 JSON");
  }
}

function commitTitle(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 48);
}

function commitTitleSummary(records, limit = 5) {
  const titles = [...new Set(
    (records ?? []).map((record) => commitTitle(record?.title)).filter(Boolean),
  )];
  const visible = titles.slice(0, limit);
  if (!visible.length) {
    return "待处理番剧";
  }
  return `${visible.join("、")}${titles.length > visible.length ? ` 等 ${titles.length} 部` : ""}`;
}

function batchCommitMessage(result) {
  const updated = result.updatedRecords ?? [];
  const added = result.addedRecords ?? [];
  return `chore(data): update anime library (修改 ${updated.length} · 新增 ${added.length}): ${commitTitleSummary([...updated, ...added])}`;
}

function assertLocalRequest(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }
  const allowed = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
  if (!allowed.has(origin)) {
    throw new Error("仅允许本地管理页发起写操作");
  }
}

async function serveStatic(pathname, response) {
  const sharedScript = pathname.startsWith("/scripts/");
  const baseDirectory = sharedScript ? scriptsDirectory : adminDirectory;
  const relativePath = sharedScript
    ? decodeURIComponent(pathname.slice("/scripts/".length))
    : pathname === "/" || pathname === "/admin/"
      ? "index.html"
      : pathname.replace(/^\/admin\/?/u, "");
  const filePath = path.resolve(baseDirectory, relativePath);
  if (
    filePath !== baseDirectory &&
    !filePath.startsWith(`${baseDirectory}${path.sep}`)
  ) {
    sendJson(response, 404, { error: "页面不存在" });
    return;
  }
  try {
    const contents = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type":
        CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(contents);
  } catch {
    sendJson(response, 404, { error: "页面不存在" });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || host}`);
  try {
    if (url.pathname === "/api/library" && request.method === "GET") {
      const library = await store.load();
      sendJson(response, 200, {
        records: library.records,
        index: library.index,
        backupLimit: library.config.backupLimit,
        git: await store.gitStatus(),
      });
      return;
    }
    if (url.pathname === "/api/settings" && request.method === "GET") {
      sendJson(response, 200, await store.siteSettings());
      return;
    }
    if (url.pathname === "/api/settings" && request.method === "PUT") {
      assertLocalRequest(request);
      sendJson(
        response,
        200,
        await store.saveSiteSettings(await readBody(request)),
      );
      return;
    }
    if (url.pathname === "/api/bangumi-cache" && request.method === "GET") {
      sendJson(response, 200, bangumiCachePayload(await store.loadBangumiCache()));
      return;
    }
    if (url.pathname === "/api/bangumi-cache" && request.method === "PUT") {
      assertLocalRequest(request);
      const result = await store.saveBangumiCache(await readBody(request));
      sendJson(response, 200, bangumiCachePayload(result));
      return;
    }
    if (url.pathname === "/api/bangumi-cache" && request.method === "DELETE") {
      assertLocalRequest(request);
      const body = await readBody(request);
      const result = body.all
        ? await store.saveBangumiCache({ mode: "replace", entries: [] })
        : await store.saveBangumiCache({
            mode: "remove",
            subjectIds: body.subjectIds,
          });
      sendJson(response, 200, bangumiCachePayload(result));
      return;
    }
    if (url.pathname === "/api/catalog" && request.method === "GET") {
      const library = await store.load();
      const metadataEntries = await store
        .loadBangumiCache()
        .then((cache) => cache.entries ?? [])
        .catch(() => []);
      const result = await catalogStore.search(
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
      sendJson(response, 200, result);
      return;
    }
    if (url.pathname === "/api/catalog/replace" && request.method === "POST") {
      assertLocalRequest(request);
      sendJson(response, 200, await catalogStore.replace());
      return;
    }
    if (url.pathname === "/api/catalog/bulk" && request.method === "POST") {
      assertLocalRequest(request);
      const body = await readBody(request);
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
            .map((selection) => String(selection?.id ?? "").trim())
            .filter(Boolean),
        ),
      ];
      const catalogItems = await catalogStore.getItems(uniqueIds);
      const byId = new Map(catalogItems.map((item) => [item.id, item]));
      const missing = selections
        .filter((selection) => !byId.has(String(selection?.id ?? "").trim()))
        .map((selection) => ({
          catalogId: String(selection?.id ?? "").trim() || null,
          title: String(selection?.title ?? "未知候选").trim(),
          reason: "catalog-not-found",
          message: "全量索引中已找不到该候选",
        }));
      const entries = selections
        .map((selection) => {
          const item = byId.get(String(selection?.id ?? "").trim());
          return item ? { item, ...selection } : null;
        })
        .filter(Boolean);
      const result = entries.length
        ? await store.addCatalogRecords(entries)
        : await store.load().then((library) => ({
            records: library.records,
            index: library.index,
            backupPath: null,
            addedRecords: [],
            skipped: [],
          }));
      let sync = null;
      let syncError = null;
      if (body.sync && result.addedRecords.length) {
        try {
          sync = await store.sync(
            String(body.message ?? "").trim() ||
              `chore(data): add ${result.addedRecords.length} anime records: ${commitTitleSummary(result.addedRecords)}`,
          );
        } catch (error) {
          syncError = error.message;
        }
      }
      sendJson(response, 201, {
        addedRecords: result.addedRecords,
        skipped: [...missing, ...(result.skipped ?? [])],
        records: result.records,
        index: result.index,
        backupPath: result.backupPath
          ? path.relative(root, result.backupPath)
          : null,
        sync,
        syncError,
      });
      return;
    }
    if (url.pathname === "/api/library/batch" && request.method === "POST") {
      assertLocalRequest(request);
      const body = await readBody(request);
      const edits = Array.isArray(body.edits) ? body.edits : [];
      const selections = Array.isArray(body.additions) ? body.additions : [];
      if (selections.length > 100) {
        throw new Error("单次最多添加 100 部番剧");
      }
      const uniqueIds = [
        ...new Set(
          selections
            .map((selection) => String(selection?.id ?? "").trim())
            .filter(Boolean),
        ),
      ];
      const catalogItems = uniqueIds.length
        ? await catalogStore.getItems(uniqueIds)
        : [];
      const byId = new Map(catalogItems.map((item) => [item.id, item]));
      const missing = selections
        .filter((selection) => !byId.has(String(selection?.id ?? "").trim()))
        .map((selection) => ({
          catalogId: String(selection?.id ?? "").trim() || null,
          title: String(selection?.title ?? "未知候选").trim(),
          reason: "catalog-not-found",
          message: "全量索引中已找不到该候选",
        }));
      const additions = selections
        .map((selection) => {
          const item = byId.get(String(selection?.id ?? "").trim());
          return item ? { item, ...selection } : null;
        })
        .filter(Boolean);
      const result = await store.batchUpdate(edits, additions);
      let sync = null;
      let syncError = null;
      if (body.sync && result.changed) {
        try {
          sync = await store.sync(
            String(body.message ?? "").trim() || batchCommitMessage(result),
          );
        } catch (error) {
          syncError = error.message;
        }
      }
      sendJson(response, 200, {
        ...result,
        skipped: [...missing, ...(result.skipped ?? [])],
        sync,
        syncError,
      });
      return;
    }
    if (
      url.pathname.startsWith("/api/catalog/") &&
      request.method === "POST"
    ) {
      assertLocalRequest(request);
      const catalogId = decodeURIComponent(
        url.pathname.slice("/api/catalog/".length),
      );
      const item = await catalogStore.getItem(catalogId);
      if (!item) {
        sendJson(response, 404, { error: "没有找到选中的全量索引" });
        return;
      }
      const result = await store.addCatalogRecord(item, await readBody(request));
      sendJson(response, 201, {
        record: result.record,
        records: result.records,
        index: result.index,
        backupPath: result.backupPath
          ? path.relative(root, result.backupPath)
          : null,
      });
      return;
    }
    if (url.pathname === "/api/status" && request.method === "GET") {
      sendJson(response, 200, await store.gitStatus());
      return;
    }
    if (url.pathname === "/api/duplicates" && request.method === "GET") {
      const library = await store.load();
      const groups = findDuplicateGroups(library.records);
      sendJson(response, 200, {
        groups,
        recordCount: library.records.length,
        groupCount: groups.length,
        confirmedCount: groups.filter(
          (group) => group.severity === "confirmed",
        ).length,
      });
      return;
    }
    if (
      url.pathname.startsWith("/api/records/") &&
      request.method === "PUT"
    ) {
      assertLocalRequest(request);
      const recordId = decodeURIComponent(url.pathname.slice("/api/records/".length));
      const result = await store.saveRecord(recordId, await readBody(request));
      sendJson(response, 200, {
        record: result.record,
        records: result.records,
        index: result.index,
        backupPath: result.backupPath
          ? path.relative(root, result.backupPath)
          : null,
      });
      return;
    }
    if (url.pathname === "/api/records" && request.method === "DELETE") {
      assertLocalRequest(request);
      const body = await readBody(request);
      const result = await store.deleteRecords(body.ids);
      sendJson(response, 200, {
        records: result.records,
        index: result.index,
        backupPath: result.backupPath
          ? path.relative(root, result.backupPath)
          : null,
      });
      return;
    }
    if (url.pathname === "/api/sync" && request.method === "POST") {
      assertLocalRequest(request);
      const body = await readBody(request);
      sendJson(response, 200, await store.sync(body.message));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "接口不存在" });
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      sendJson(response, 405, { error: "不支持该请求方法" });
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(port, host, () => {
  console.log(`Anime Records Manager: http://${host}:${port}/admin/`);
});
