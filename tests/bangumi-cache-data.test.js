import test from "node:test";
import assert from "node:assert/strict";
import {
  bangumiCacheStatistics,
  mergeBangumiCacheEntries,
  normalizeBangumiCacheEntry,
  parseBangumiCacheJsonl,
  removeBangumiCacheEntries,
  serializeBangumiCache,
  supplementBangumiCacheEntries,
} from "../scripts/bangumi-cache-data.mjs";

test("normalizes a personal Bangumi cache entry", () => {
  const entry = normalizeBangumiCacheEntry({
    id: 400602,
    rating: { score: "8.67", total: "12345" },
    rank: "24",
    tags: [
      ["奇幻", "1200"],
      { name: "TV", count: 800 },
      ["奇幻", 1400],
      [" ", 9999],
    ],
    summary: "  测试简介  ",
    images: { large: "//lain.bgm.tv/test.jpg" },
    fetchedAt: "2026-10-27T08:00:00Z",
    source: "bangumi-api",
  });

  assert.deepEqual(entry, {
    schemaVersion: 1,
    subjectId: "400602",
    score: 8.7,
    ratingCount: 12345,
    rank: 24,
    tags: [
      { name: "奇幻", count: 1400 },
      { name: "TV", count: 800 },
    ],
    summary: "测试简介",
    coverUrl: "https://lain.bgm.tv/test.jpg",
    fetchedAt: "2026-10-27T08:00:00.000Z",
    source: "bangumi-api",
  });
});

test("parses JSONL once per subject and rejects duplicate subject ids", () => {
  const text = serializeBangumiCache([
    { subjectId: "2", score: 8, fetchedAt: "2026-10-27T08:00:00Z" },
    { subjectId: "10", score: 9, fetchedAt: "2026-10-27T09:00:00Z" },
  ]);
  const entries = parseBangumiCacheJsonl(text, "test-cache.jsonl");

  assert.deepEqual(
    entries.map((entry) => entry.subjectId),
    ["2", "10"],
  );
  assert.throws(
    () =>
      parseBangumiCacheJsonl(
        `${text}${JSON.stringify({ subjectId: "2", score: 7 })}\n`,
        "test-cache.jsonl",
      ),
    /重复的 subjectId/u,
  );
});

test("merges newer cache entries and preserves newer personal values", () => {
  const merged = mergeBangumiCacheEntries(
    [
      {
        subjectId: "2",
        score: 8.8,
        tags: [{ name: "旧标签", count: 10 }],
        fetchedAt: "2026-10-27T10:00:00Z",
      },
      {
        subjectId: "1",
        score: 7.2,
        fetchedAt: "2026-10-27T09:00:00Z",
      },
    ],
    [
      {
        subjectId: "2",
        score: 7.9,
        tags: [{ name: "过期标签", count: 20 }],
        fetchedAt: "2026-10-27T09:00:00Z",
      },
      {
        subjectId: "3",
        score: 9.1,
        fetchedAt: "2026-10-27T11:00:00Z",
      },
    ],
  );

  assert.deepEqual(
    merged.map((entry) => [entry.subjectId, entry.score]),
    [
      ["1", 7.2],
      ["2", 8.8],
      ["3", 9.1],
    ],
  );
});

test("supplements only missing subjects without replacing existing cache", () => {
  const supplemented = supplementBangumiCacheEntries(
    [
      {
        subjectId: "2",
        score: 8.8,
        fetchedAt: "2026-10-27T10:00:00Z",
      },
    ],
    [
      {
        subjectId: "2",
        score: 9.9,
        fetchedAt: "2026-10-27T12:00:00Z",
      },
      {
        subjectId: "3",
        score: 9.1,
        fetchedAt: "2026-10-27T11:00:00Z",
      },
    ],
  );

  assert.deepEqual(
    supplemented.map((entry) => [entry.subjectId, entry.score]),
    [
      ["2", 8.8],
      ["3", 9.1],
    ],
  );
});

test("removes selected cache entries and reports useful statistics", () => {
  const entries = [
    { subjectId: "1", score: 8, fetchedAt: "2026-10-27T08:00:00Z" },
    { subjectId: "2", score: 9, fetchedAt: "2026-10-27T11:00:00Z" },
    { subjectId: "3", tags: [{ name: "科幻", count: 1 }] },
  ];
  const remaining = removeBangumiCacheEntries(entries, ["1", "3"]);
  const text = serializeBangumiCache(remaining);
  const statistics = bangumiCacheStatistics(remaining, text);

  assert.deepEqual(
    remaining.map((entry) => entry.subjectId),
    ["2"],
  );
  assert.equal(statistics.count, 1);
  assert.equal(statistics.size, Buffer.byteLength(text));
  assert.equal(statistics.updatedAt, "2026-10-27T11:00:00.000Z");
});
