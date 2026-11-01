import {
  parseJsonl,
  serializeJsonl,
} from "./library-data.mjs";

export const BANGUMI_CACHE_JSONL_PATH = "data/bangumi-cache.jsonl";

const MAX_TAGS = 40;

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) && score > 0 && score <= 10
    ? Math.round(score * 10) / 10
    : null;
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function normalizeUrl(value) {
  const url = cleanString(value);
  if (!url) {
    return null;
  }
  const resolved = url.startsWith("//") ? `https:${url}` : url;
  return /^https?:\/\//iu.test(resolved) ? resolved : null;
}

function normalizeTimestamp(value) {
  const text = cleanString(value);
  return Number.isFinite(new Date(text).getTime())
    ? new Date(text).toISOString()
    : new Date().toISOString();
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTags(values) {
  const tags = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const rawName = Array.isArray(value) ? value[0] : value?.name;
    const rawCount = Array.isArray(value) ? value[1] : value?.count;
    const name = cleanString(rawName);
    const key = name.normalize("NFKC").toLocaleLowerCase("zh-CN");
    if (!name || !key) {
      continue;
    }
    const count = normalizeCount(rawCount);
    const previous = tags.get(key);
    if (!previous || count > previous.count) {
      tags.set(key, { name, count });
    }
  }
  return [...tags.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.name.localeCompare(right.name, "zh-CN"),
    )
    .slice(0, MAX_TAGS);
}

export function normalizeBangumiCacheEntry(value) {
  const subjectId = cleanString(value?.subjectId ?? value?.id);
  if (!subjectId) {
    throw new Error("Bangumi 缓存条目缺少 subjectId");
  }
  const rank = Number(value?.rank);
  return {
    schemaVersion: 1,
    subjectId,
    score: normalizeScore(value?.score ?? value?.rating?.score),
    ratingCount: normalizeCount(
      value?.ratingCount ??
        value?.rating?.total ??
        value?.rating?.count,
    ),
    rank:
      Number.isInteger(rank) && rank > 0
        ? rank
        : null,
    tags: normalizeTags(value?.tags),
    summary: cleanString(value?.summary).slice(0, 4000),
    coverUrl: normalizeUrl(
      value?.coverUrl ??
        value?.images?.large ??
        value?.images?.common ??
        value?.images?.medium,
    ),
    fetchedAt: normalizeTimestamp(value?.fetchedAt),
    source:
      cleanString(value?.source).slice(0, 80) || "bangumi-archive",
  };
}

export function parseBangumiCacheJsonl(
  text,
  label = BANGUMI_CACHE_JSONL_PATH,
) {
  const entries = parseJsonl(text, label).map((entry, index) => {
    try {
      return normalizeBangumiCacheEntry(entry);
    } catch (error) {
      throw new Error(`${label} 第 ${index + 1} 条无效：${error.message}`);
    }
  });
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.subjectId)) {
      throw new Error(`${label} 包含重复的 subjectId: ${entry.subjectId}`);
    }
    seen.add(entry.subjectId);
  }
  return sortBangumiCacheEntries(entries);
}

export function serializeBangumiCache(entries) {
  return serializeJsonl(
    entries.map((entry) => normalizeBangumiCacheEntry(entry)),
  );
}

export function sortBangumiCacheEntries(entries) {
  return [...(entries ?? [])].sort((left, right) =>
    cleanString(left?.subjectId).localeCompare(
      cleanString(right?.subjectId),
      "en",
      { numeric: true },
    ),
  );
}

export function mergeBangumiCacheEntries(current, incoming) {
  const byId = new Map(
    (current ?? []).map((entry) => [
      normalizeBangumiCacheEntry(entry).subjectId,
      normalizeBangumiCacheEntry(entry),
    ]),
  );
  for (const rawEntry of incoming ?? []) {
    const entry = normalizeBangumiCacheEntry(rawEntry);
    const previous = byId.get(entry.subjectId);
    if (
      !previous ||
      timestamp(entry.fetchedAt) >= timestamp(previous.fetchedAt)
    ) {
      byId.set(entry.subjectId, entry);
    }
  }
  return sortBangumiCacheEntries([...byId.values()]);
}

export function supplementBangumiCacheEntries(current, incoming) {
  const byId = new Map(
    (current ?? []).map((entry) => {
      const normalized = normalizeBangumiCacheEntry(entry);
      return [normalized.subjectId, normalized];
    }),
  );
  for (const rawEntry of incoming ?? []) {
    const entry = normalizeBangumiCacheEntry(rawEntry);
    if (!byId.has(entry.subjectId)) {
      byId.set(entry.subjectId, entry);
    }
  }
  return sortBangumiCacheEntries([...byId.values()]);
}

export function removeBangumiCacheEntries(current, subjectIds) {
  const removed = new Set(
    (subjectIds ?? []).map((value) => cleanString(value)).filter(Boolean),
  );
  return sortBangumiCacheEntries(
    (current ?? []).filter(
      (entry) => !removed.has(cleanString(entry?.subjectId)),
    ),
  );
}

export function bangumiCacheStatistics(entries, text = null) {
  const normalized = sortBangumiCacheEntries(entries ?? []);
  const serialized = text ?? serializeBangumiCache(normalized);
  const updatedAt =
    normalized
      .map((entry) => {
        const value = cleanString(entry?.fetchedAt);
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed)
          ? new Date(parsed).toISOString()
          : "";
      })
      .filter(Boolean)
      .sort((left, right) => timestamp(right) - timestamp(left))[0] ?? null;
  return {
    count: normalized.length,
    size: new TextEncoder().encode(serialized).length,
    updatedAt,
  };
}
