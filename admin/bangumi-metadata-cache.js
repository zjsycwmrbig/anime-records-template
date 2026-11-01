import {
  bangumiSubjectId,
  fetchBangumiSubject,
} from "./bangumi-subject.js";
import { normalizeBangumiCacheEntry } from "../scripts/bangumi-cache-data.mjs";

const DATABASE_NAME = "myanimelife-bangumi-metadata";
const STORE_NAME = "subjects";
const DATABASE_VERSION = 1;
const FETCH_CONCURRENCY = 3;
const PUBLIC_SNAPSHOT_URL = new URL("./bangumi-public.json", import.meta.url);
const PUBLIC_SNAPSHOT_SCHEMA_VERSION = 1;
const TAG_ALIASES = new Map([
  ["漫改", "漫画改"],
  ["轻改", "轻小说改"],
]);
const IGNORED_DISPLAY_TAGS = new Set([
  "tv",
  "ova",
  "oad",
  "web",
  "剧场版",
  "总集篇",
  "日本",
  "日本动画",
  "动画",
]);

let publicSnapshot = null;
let publicSnapshotPromise = null;

function clean(value) {
  return String(value ?? "").trim();
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayTagKey(value) {
  return clean(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

export function collectBangumiTagHeat(publicSnapshot) {
  const stats = new Map();
  const subjects = publicSnapshot?.subjects;
  if (!subjects || typeof subjects !== "object" || Array.isArray(subjects)) {
    return [];
  }
  for (const compactSubject of Object.values(subjects)) {
    if (!Array.isArray(compactSubject) || !Array.isArray(compactSubject[3])) {
      continue;
    }
    const subjectTags = new Set();
    for (const rawTag of compactSubject[3]) {
      const sourceName = clean(Array.isArray(rawTag) ? rawTag[0] : rawTag?.name);
      const normalized = displayTagKey(sourceName);
      if (
        !normalized ||
        /^\d{4}(?:年(?:\d{1,2}月)?)?$/u.test(normalized) ||
        IGNORED_DISPLAY_TAGS.has(normalized)
      ) {
        continue;
      }
      const key = TAG_ALIASES.get(normalized) ?? normalized;
      const name = TAG_ALIASES.get(normalized) ?? sourceName;
      const count = Math.max(
        0,
        Math.trunc(Number(Array.isArray(rawTag) ? rawTag[1] : rawTag?.count) || 0),
      );
      const previous = stats.get(key) ?? {
        name,
        heat: 0,
        subjectCount: 0,
      };
      previous.heat += count;
      if (!subjectTags.has(key)) {
        previous.subjectCount += 1;
        subjectTags.add(key);
      }
      stats.set(key, previous);
    }
  }
  return [...stats.values()].sort(
    (left, right) =>
      right.heat - left.heat ||
      right.subjectCount - left.subjectCount ||
      left.name.localeCompare(right.name, "zh-CN"),
  );
}

export function collectBangumiTagHeatFromEntries(entries) {
  const stats = new Map();
  for (const entry of entries ?? []) {
    const subjectTags = new Set();
    for (const rawTag of entry?.tags ?? []) {
      const sourceName = clean(rawTag?.name ?? rawTag);
      const normalized = displayTagKey(sourceName);
      if (
        !normalized ||
        /^\d{4}(?:年(?:\d{1,2}月)?)?$/u.test(normalized) ||
        IGNORED_DISPLAY_TAGS.has(normalized)
      ) {
        continue;
      }
      const key = TAG_ALIASES.get(normalized) ?? normalized;
      const name = TAG_ALIASES.get(normalized) ?? sourceName;
      const count = Math.max(0, Math.trunc(Number(rawTag?.count) || 0));
      const previous = stats.get(key) ?? { name, heat: 0, subjectCount: 0 };
      previous.heat += count;
      if (!subjectTags.has(key)) {
        previous.subjectCount += 1;
        subjectTags.add(key);
      }
      stats.set(key, previous);
    }
  }
  return [...stats.values()].sort(
    (left, right) =>
      right.subjectCount - left.subjectCount ||
      right.heat - left.heat ||
      left.name.localeCompare(right.name, "zh-CN"),
  );
}

export async function readKnownBangumiTags(options = {}) {
  const entries = await readAllBangumiMetadata();
  if (entries.length) {
    return collectBangumiTagHeatFromEntries(entries);
  }
  if (options.allowSnapshot === false) {
    return [];
  }
  const snapshot = await loadPublicSnapshot(options);
  return collectBangumiTagHeat(snapshot);
}

export function normalizeBangumiMetadata(
  payload,
  subjectId,
  fetchedAt = new Date().toISOString(),
) {
  const id = clean(subjectId) || clean(payload?.id);
  if (!id) {
    throw new Error("Bangumi 元数据缺少条目 ID");
  }
  return normalizeBangumiCacheEntry({
    subjectId: id,
    score: payload?.rating?.score,
    ratingCount: payload?.rating?.total ?? payload?.rating?.count,
    rank: payload?.rank,
    tags: payload?.tags,
    summary: payload?.summary,
    coverUrl:
      payload?.images?.large ??
      payload?.images?.common ??
      payload?.images?.medium,
    fetchedAt,
    source: "bangumi-api",
  });
}

export function normalizeBangumiSnapshotSubject(
  subjectId,
  compactSubject,
  fetchedAt,
) {
  const id = clean(subjectId);
  if (!id || !Array.isArray(compactSubject)) {
    return null;
  }
  const [score, ratingCount, rank, rawTags] = compactSubject;
  return normalizeBangumiCacheEntry({
    subjectId: id,
    score,
    ratingCount,
    rank,
    tags: (
      (Array.isArray(rawTags) ? rawTags : []).map((tag) => ({
        name: tag?.[0],
        count: tag?.[1],
      }))
    ),
    fetchedAt: clean(fetchedAt) || new Date().toISOString(),
    source: "bangumi-archive",
  });
}

export function toBangumiCacheEntry(metadata) {
  return normalizeBangumiCacheEntry({
    ...metadata,
    source: metadata?.source ?? "bangumi-admin",
  });
}

async function loadPublicSnapshot(options = {}) {
  if (!options.refresh && publicSnapshot) {
    return publicSnapshot;
  }
  if (!options.refresh && publicSnapshotPromise) {
    return publicSnapshotPromise;
  }
  const request = fetch(PUBLIC_SNAPSHOT_URL, {
    cache: options.refresh ? "no-store" : "default",
    headers: { Accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`公共快照读取失败 (HTTP ${response.status})`);
      }
      const payload = await response.json();
      if (
        payload?.schemaVersion !== PUBLIC_SNAPSHOT_SCHEMA_VERSION ||
        !payload?.subjects ||
        typeof payload.subjects !== "object"
      ) {
        throw new Error("公共快照格式无效");
      }
      publicSnapshot = payload;
      return payload;
    })
    .finally(() => {
      if (publicSnapshotPromise === request) {
        publicSnapshotPromise = null;
      }
    });
  publicSnapshotPromise = request;
  return request;
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("无法打开 Bangumi 元数据缓存")),
    );
  });
}

export async function readBangumiMetadata(subjectIds) {
  const ids = [
    ...new Set(
      (subjectIds ?? []).map((value) => bangumiSubjectId(value)).filter(Boolean),
    ),
  ];
  if (!ids.length) {
    return new Map();
  }
  const database = await openDatabase();
  if (!database) {
    return new Map();
  }
  try {
    return await new Promise((resolve, reject) => {
      const values = new Map();
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      for (const id of ids) {
        const request = store.get(id);
        request.addEventListener("success", () => {
          if (request.result?.subjectId) {
            values.set(id, request.result);
          }
        });
      }
      transaction.addEventListener("complete", () => resolve(values));
      transaction.addEventListener("error", () =>
        reject(transaction.error ?? new Error("读取 Bangumi 元数据缓存失败")),
      );
    });
  } finally {
    database.close();
  }
}

export async function countBangumiMetadata() {
  const database = await openDatabase();
  if (!database) {
    return 0;
  }
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).count();
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("统计 Bangumi 元数据缓存失败")),
      );
    });
  } finally {
    database.close();
  }
}

export async function readAllBangumiMetadata() {
  const database = await openDatabase();
  if (!database) {
    return [];
  }
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.addEventListener("success", () => resolve(request.result ?? []));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("读取 Bangumi 元数据缓存失败")),
      );
    });
  } finally {
    database.close();
  }
}

async function writeBangumiMetadata(entries, options = {}) {
  if (!entries.size) {
    return;
  }
  const database = await openDatabase();
  if (!database) {
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const [subjectId, rawMetadata] of entries) {
        const previous = options.previous?.get(subjectId);
        const storageSource =
          rawMetadata.storageSource ??
          options.storageSource ??
          previous?.storageSource ??
          "browser";
        const pendingSync =
          rawMetadata.pendingSync ??
          options.pendingSync ??
          (storageSource === "personal" && !options.fromPersonal);
        store.put(
          {
            ...rawMetadata,
            storageSource,
            pendingSync,
          },
          subjectId,
        );
      }
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () =>
        reject(transaction.error ?? new Error("写入 Bangumi 元数据缓存失败")),
      );
    });
  } finally {
    database.close();
  }
}

export async function importBangumiMetadata(
  entries,
  storageSource = "personal",
) {
  const map = new Map();
  for (const rawEntry of entries ?? []) {
    try {
      const entry = toBangumiCacheEntry(rawEntry);
      map.set(entry.subjectId, entry);
    } catch {
      // A malformed personal entry must not block the rest of the cache.
    }
  }
  await writeBangumiMetadata(map, {
    storageSource,
    pendingSync: false,
    fromPersonal: storageSource === "personal",
  });
  return map;
}

export async function replaceBangumiMetadataBySource(
  entries,
  storageSource = "personal",
) {
  const map = new Map();
  for (const rawEntry of entries ?? []) {
    try {
      const entry = toBangumiCacheEntry(rawEntry);
      map.set(entry.subjectId, entry);
    } catch {
      // Keep the rest of the personal cache usable when one line is malformed.
    }
  }
  const database = await openDatabase();
  if (!database) {
    return map;
  }
  const remaining = new Map(map);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const cursorRequest = store.openCursor();
      cursorRequest.addEventListener("success", () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          for (const [subjectId, entry] of remaining) {
            store.put(
              {
                ...entry,
                storageSource,
                pendingSync: false,
              },
              subjectId,
            );
          }
          return;
        }
        const subjectId = cursor.value?.subjectId ?? cursor.primaryKey;
        const existingSource = cursor.value?.storageSource ?? "browser";
        const incoming = remaining.get(subjectId);
        if (existingSource === storageSource) {
          if (!incoming) {
            if (!cursor.value?.pendingSync) {
              cursor.delete();
            }
          } else {
            const localIsNewer =
              cursor.value?.pendingSync &&
              timestamp(cursor.value?.fetchedAt) >=
                timestamp(incoming?.fetchedAt);
            if (!localIsNewer) {
              cursor.update({
                ...incoming,
                storageSource,
                pendingSync: false,
              });
            }
            remaining.delete(subjectId);
          }
        } else if (incoming) {
          const localIsNewer =
            cursor.value?.pendingSync &&
            timestamp(cursor.value?.fetchedAt) >= timestamp(incoming?.fetchedAt);
          if (!localIsNewer) {
            cursor.update({
              ...incoming,
              storageSource,
              pendingSync: false,
            });
          }
          remaining.delete(subjectId);
        }
        cursor.continue();
      });
      cursorRequest.addEventListener("error", () =>
        reject(cursorRequest.error ?? new Error("同步 Bangumi 元数据缓存失败")),
      );
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () =>
        reject(transaction.error ?? new Error("同步 Bangumi 元数据缓存失败")),
      );
    });
  } finally {
    database.close();
  }
  return map;
}

export async function markBangumiMetadataPersonal(entries) {
  const map = new Map();
  for (const rawEntry of entries ?? []) {
    try {
      const entry = toBangumiCacheEntry(rawEntry);
      map.set(entry.subjectId, {
        ...entry,
        storageSource: "personal",
        pendingSync: false,
      });
    } catch {
      // Ignore malformed local copies after a successful repository write.
    }
  }
  await writeBangumiMetadata(map, {
    storageSource: "personal",
    pendingSync: false,
    fromPersonal: true,
  });
}

export async function removeBangumiMetadata(subjectIds) {
  const ids = [...new Set((subjectIds ?? []).map(clean).filter(Boolean))];
  if (!ids.length) {
    return;
  }
  const database = await openDatabase();
  if (!database) {
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const id of ids) {
        store.delete(id);
      }
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () =>
        reject(transaction.error ?? new Error("移除 Bangumi 元数据缓存失败")),
      );
    });
  } finally {
    database.close();
  }
}

export async function clearBangumiMetadata(storageSource = "") {
  const database = await openDatabase();
  if (!database) {
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (!clean(storageSource)) {
        store.clear();
      } else {
        const request = store.openCursor();
        request.addEventListener("success", () => {
          const cursor = request.result;
          if (!cursor) {
            return;
          }
          const source = cursor.value?.storageSource ?? "browser";
          if (source === clean(storageSource)) {
            cursor.delete();
          }
          cursor.continue();
        });
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("清空 Bangumi 元数据缓存失败")),
        );
      }
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () =>
        reject(transaction.error ?? new Error("清空 Bangumi 元数据缓存失败")),
      );
    });
  } finally {
    database.close();
  }
}

function reportProgress(options, payload, startedAt, extra = {}) {
  const elapsedMs = Math.max(1, Date.now() - startedAt);
  const completed = Number(payload.completed) || 0;
  options.onProgress?.({
    ...payload,
    ...extra,
    elapsedMs,
    speed: completed ? completed / (elapsedMs / 1000) : 0,
  });
}

async function resolveMetadataCandidates(candidates, options = {}) {
  const startedAt = Date.now();
  const cached = await readBangumiMetadata([...candidates.keys()]);
  const cachedIds = new Set(cached.keys());
  const pending = [...candidates.keys()].filter(
    (subjectId) =>
      options.refresh ||
      !hasUsableBangumiMetadata(cached.get(subjectId)),
  );
  const updates = new Map();
  const sourceById = new Map(
    [...cachedIds].map((subjectId) => [
      subjectId,
      cached.get(subjectId)?.storageSource ?? "browser",
    ]),
  );
  let failed = 0;
  let snapshotError = "";
  let snapshotFetchedAt = "";
  let completed = 0;
  const report = (phase, currentTitle = "", currentId = "") =>
    reportProgress(
      options,
      { completed, total: pending.length, failed, phase, currentTitle, currentId },
      startedAt,
    );
  report("cache");
  if (pending.length) {
    try {
      const snapshot = await loadPublicSnapshot({
        refresh: Boolean(options.refresh),
      });
      snapshotFetchedAt =
        clean(snapshot.source?.archiveUpdatedAt) ||
        clean(snapshot.generatedAt);
      for (const subjectId of pending) {
        if (options.signal?.aborted) {
          break;
        }
        const metadata = normalizeBangumiSnapshotSubject(
          subjectId,
          snapshot.subjects[subjectId],
          snapshotFetchedAt,
        );
        if (metadata) {
          const storageSource =
            cached.get(subjectId)?.storageSource === "personal"
              ? "personal"
              : "browser";
          updates.set(subjectId, {
            ...metadata,
            storageSource,
            pendingSync: true,
          });
          sourceById.set(subjectId, storageSource);
        }
        completed += 1;
        report("snapshot", candidates.get(subjectId)?.displayTitle ?? "", subjectId);
      }
    } catch (error) {
      snapshotError = error.message || "公共快照不可用";
    }
  }
  const remaining = pending.filter((subjectId) => !updates.has(subjectId));
  completed = pending.length - remaining.length;
  let apiFetched = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < remaining.length) {
      if (options.signal?.aborted) {
        break;
      }
      const subjectId = remaining[cursor++];
        try {
          const payload = await fetchBangumiSubject(subjectId);
          const storageSource =
            cached.get(subjectId)?.storageSource === "personal"
              ? "personal"
              : "browser";
          updates.set(
            subjectId,
            {
              ...normalizeBangumiMetadata(payload, subjectId),
              storageSource,
              pendingSync: true,
            },
          );
          sourceById.set(subjectId, storageSource);
          apiFetched += 1;
        } catch {
          failed += 1;
        } finally {
          completed += 1;
          report("api", candidates.get(subjectId)?.displayTitle ?? "", subjectId);
        }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, remaining.length) }, worker),
  );
  if (options.signal?.aborted) {
    report("cancelled");
  }
  await writeBangumiMetadata(updates, {
    previous: cached,
    pendingSync: true,
  });
  return {
    metadata: new Map([...cached, ...updates]),
    requested: candidates.size,
    fetched: updates.size,
    cached: cachedIds.size,
    snapshot: updates.size - apiFetched,
    api: apiFetched,
    failed,
    pending: pending.length,
    sourceById,
    snapshotError,
    snapshotFetchedAt,
  };
}

export async function resolveBangumiMetadata(items, options = {}) {
  const candidates = new Map();
  for (const item of items ?? []) {
    const subjectId = bangumiSubjectId(item);
    if (subjectId && !candidates.has(subjectId)) {
      candidates.set(subjectId, item);
    }
  }
  return resolveMetadataCandidates(candidates, options);
}

export async function resolveAllBangumiMetadata(items, options = {}) {
  const candidates = new Map();
  for (const item of items ?? []) {
    const subjectId = bangumiSubjectId(item);
    if (subjectId && !candidates.has(subjectId)) {
      candidates.set(subjectId, item);
    }
  }
  return resolveMetadataCandidates(candidates, options);
}

export function applyBangumiMetadata(items, metadata, sourceById = null) {
  for (const item of items ?? []) {
    const subjectId = bangumiSubjectId(item);
    const metadataEntry = metadata.get(subjectId) ?? null;
    item.bangumiMetadata = metadataEntry;
    item.bangumiMetadataResolved = Boolean(metadataEntry);
    item.bangumiMetadataSource = metadataEntry
      ? sourceById?.get(subjectId) ?? item.bangumiMetadataSource ?? null
      : null;
    if (!item.coverUrl && metadataEntry?.coverUrl) {
      item.coverUrl = metadataEntry.coverUrl;
    }
  }
  return items;
}

export function hasUsableBangumiMetadata(metadata) {
  return Boolean(
    metadata &&
      (Number.isFinite(metadata.score) || metadata.tags?.length),
  );
}

export function isCachedBangumiMetadata(item) {
  return (
    ["personal", "browser", "cache"].includes(item?.bangumiMetadataSource) &&
    hasUsableBangumiMetadata(item?.bangumiMetadata)
  );
}

export function summarizeBangumiMetadata(items) {
  const summary = {
    total: Array.isArray(items) ? items.length : 0,
    indexed: 0,
    cached: 0,
    cachedAvailable: 0,
    personal: 0,
    personalAvailable: 0,
    browser: 0,
    browserAvailable: 0,
    pending: 0,
    scored: 0,
    tagged: 0,
    available: 0,
    missing: 0,
  };
  for (const item of items ?? []) {
    if (!bangumiSubjectId(item)) {
      continue;
    }
    summary.indexed += 1;
    const metadata = item.bangumiMetadata;
    const available = hasUsableBangumiMetadata(metadata);
    if (available) {
      summary.available += 1;
    }
    if (isCachedBangumiMetadata(item)) {
      summary.cached += 1;
      if (available) {
        summary.cachedAvailable += 1;
      }
    }
    if (metadata?.pendingSync) {
      summary.pending += 1;
    }
    if (item.bangumiMetadataSource === "personal") {
      summary.personal += 1;
      if (available) {
        summary.personalAvailable += 1;
      }
    } else if (
      ["browser", "cache"].includes(item.bangumiMetadataSource)
    ) {
      summary.browser += 1;
      if (available) {
        summary.browserAvailable += 1;
      }
    }
    if (Number.isFinite(metadata?.score)) {
      summary.scored += 1;
    }
    if (metadata?.tags?.length) {
      summary.tagged += 1;
    }
  }
  summary.missing = Math.max(0, summary.indexed - summary.available);
  return summary;
}

function normalizedTag(value) {
  return clean(value).normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function scoreBounds(options) {
  const minimum = Number(options.scoreMin);
  const maximum = Number(options.scoreMax);
  return {
    minimum:
      options.scoreMin === "" || options.scoreMin === null ||
      options.scoreMin === undefined || !Number.isFinite(minimum)
        ? null
        : Math.max(0, Math.min(10, minimum)),
    maximum:
      options.scoreMax === "" || options.scoreMax === null ||
      options.scoreMax === undefined || !Number.isFinite(maximum)
        ? null
        : Math.max(0, Math.min(10, maximum)),
  };
}

export function filterAndSortByBangumiMetadata(items, options = {}) {
  const bounds = scoreBounds(options);
  const selectedTags = new Set(
    (options.tags ?? []).map(normalizedTag).filter(Boolean),
  );
  const availability = clean(options.availability) || "all";
  const filtered = (items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const metadata = item.bangumiMetadata;
      const available = hasUsableBangumiMetadata(metadata);
      if (availability === "available" && !available) {
        return false;
      }
      if (availability === "unavailable" && available) {
        return false;
      }
      if (bounds.minimum !== null || bounds.maximum !== null) {
        if (!Number.isFinite(metadata?.score)) {
          return false;
        }
        if (bounds.minimum !== null && metadata.score < bounds.minimum) {
          return false;
        }
        if (bounds.maximum !== null && metadata.score > bounds.maximum) {
          return false;
        }
      }
      if (selectedTags.size) {
        const itemTags = new Set(
          (metadata?.tags ?? []).map((tag) => normalizedTag(tag.name)),
        );
        if (![...selectedTags].some((tag) => itemTags.has(tag))) {
          return false;
        }
      }
      return true;
    });

  const sort = clean(options.sort);
  if (sort === "bangumi-score-desc" || sort === "bangumi-score-asc") {
    const direction = sort === "bangumi-score-desc" ? -1 : 1;
    filtered.sort((left, right) => {
      const leftScore = Number.isFinite(left.item.bangumiMetadata?.score)
        ? left.item.bangumiMetadata.score
        : null;
      const rightScore = Number.isFinite(right.item.bangumiMetadata?.score)
        ? right.item.bangumiMetadata.score
        : null;
      if (leftScore === null && rightScore === null) {
        return left.index - right.index;
      }
      if (leftScore === null) {
        return 1;
      }
      if (rightScore === null) {
        return -1;
      }
      return (
        (leftScore - rightScore) * direction ||
        left.index - right.index
      );
    });
  }

  return {
    items: filtered.map(({ item }) => item),
    availableCount: (items ?? []).filter((item) =>
      hasUsableBangumiMetadata(item.bangumiMetadata),
    ).length,
    totalCount: items?.length ?? 0,
  };
}
