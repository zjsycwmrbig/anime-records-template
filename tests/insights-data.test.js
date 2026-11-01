import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateInsights,
  compareLibraries,
} from "../scripts/insights-data.mjs";

function record({
  id,
  createdAt,
  rating = null,
  year = null,
  externalIds = {},
  title = id,
  review = "",
  note = "",
  publicTags = [],
}) {
  return {
    id,
    title,
    rating,
    review,
    coverUrl: null,
    note,
    publicTags,
    externalIds,
    season: year
      ? { key: id, number: 1, label: "第1季", year }
      : null,
    match: {
      status: "matched",
      method: "site-id",
      source: "test",
      confidence: 1,
      matchedTitle: title,
      matchedAt: createdAt,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

test("calculates collection windows, decades, and rating distributions", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  const insights = calculateInsights(
    [
      record({
        id: "a",
        createdAt: "2026-10-24T12:00:00.000Z",
        rating: 8,
        year: 2024,
        externalIds: { bangumi: "1" },
        review: "很喜欢这部作品",
      }),
      record({
        id: "b",
        createdAt: "2026-10-10T12:00:00.000Z",
        rating: 9,
        year: 2023,
        externalIds: { bilibiliMedia: "2" },
        note: "适合重看",
      }),
      record({
        id: "c",
        createdAt: "2026-06-01T12:00:00.000Z",
        rating: 6,
        year: 2015,
      }),
      record({
        id: "d",
        createdAt: "2025-01-01T12:00:00.000Z",
      }),
    ],
    now,
  );

  assert.equal(insights.summary.total, 4);
  assert.equal(insights.summary.rated, 3);
  assert.equal(insights.summary.reviewed, 1);
  assert.equal(insights.summary.noted, 1);
  assert.equal(insights.summary.unrated, 1);
  assert.equal(insights.summary.reviewedPercent, 25);
  assert.equal(insights.summary.averageRating, "7.7");
  assert.equal(insights.summary.medianRating, "8.0");
  assert.equal(insights.summary.highestRating, "9.0");
  assert.equal(insights.summary.lowestRating, "6.0");
  assert.deepEqual(
    insights.windows.map((window) => window.count),
    [1, 2, 3],
  );
  assert.equal(insights.months.length, 12);
  assert.equal(insights.months.at(-1).count, 2);
  assert.equal(insights.days.length, 31);
  assert.equal(insights.days.find((day) => day.shortLabel === "24").count, 1);
  assert.equal(insights.days.find((day) => day.shortLabel === "10").count, 1);
  assert.equal(insights.weeks.length, 8);
  assert.equal(
    insights.weeks.reduce((total, week) => total + week.count, 0),
    2,
  );
  assert.equal(insights.activity.weeks.length, 53);
  assert.equal(insights.activity.weeks[0].days.length, 7);
  assert.equal(insights.activity.lastWeekCount, 1);
  assert.equal(insights.summary.latestWeek, 1);
  assert.equal(insights.activity.total, 3);
  assert.deepEqual(
    insights.decades.map((decade) => [decade.key, decade.count]),
    [
      [2010, 1],
      [2020, 2],
      [null, 1],
    ],
  );
  assert.deepEqual(
    insights.years.map((year) => [year.key, year.count, year.ratedPercent]),
    [
      [2024, 1, 100],
      [2023, 1, 100],
      [2015, 1, 100],
      [null, 1, 0],
    ],
  );
  assert.deepEqual(
    insights.ratingFine.map((rating) => [rating.key, rating.count]),
    [
      ["9.0", 1],
      ["8.0", 1],
      ["6.0", 1],
    ],
  );
  assert.equal(
    insights.ratings.find((rating) => rating.key === "8-8.9").count,
    1,
  );
  assert.equal(
    insights.ratings.find((rating) => rating.key === "unrated").count,
    1,
  );
  assert.equal(insights.sources.length, 2);
  assert.deepEqual(
    insights.decadePieSegments.map((segment) => [
      segment.label,
      segment.count,
    ]),
    [
      ["2010 年代", 1],
      ["2020 年代", 2],
      ["年份未知", 1],
    ],
  );
  assert.equal(
    insights.ratingPieSegments.reduce(
      (total, segment) => total + segment.count,
      0,
    ),
    4,
  );
  assert.deepEqual(
    insights.ratingByDecade.map((group) => [
      group.label,
      group.count,
      group.rated,
      group.averageRating,
    ]),
    [
      ["2010 年代", 1, 1, 6],
      ["2020 年代", 2, 2, 8.5],
    ],
  );
});

test("reports public Bangumi cache coverage separately from site indexes", () => {
  const insights = calculateInsights(
    [
      record({
        id: "cached-score",
        externalIds: { bangumi: "100" },
      }),
      record({
        id: "cached-tags",
        externalIds: { bangumi: "200" },
      }),
      record({
        id: "uncached",
        externalIds: { bangumi: "300" },
      }),
    ],
    new Date("2026-10-25T12:00:00.000Z"),
    {},
    {
      bangumiCacheEntries: [
        {
          subjectId: "100",
          score: 8.8,
          ratingCount: 120,
          summary: "公共简介",
          coverUrl: "https://example.com/cover.jpg",
          tags: [{ name: "科幻", count: 20 }],
        },
        {
          subjectId: "200",
          tags: [{ name: "日常", count: 10 }],
        },
        {
          subjectId: "999",
        },
      ],
    },
  );

  assert.deepEqual(insights.summary.publicCache, {
    fileEntries: 3,
    cached: 2,
    covered: 2,
    scored: 1,
    tagged: 2,
    summarized: 1,
    missing: 1,
    coveragePercent: 66.7,
    dataPercent: 66.7,
    scorePercent: 33.3,
    tagPercent: 66.7,
    summaryPercent: 33.3,
  });
});

test("builds automatic tag radar axes from normalized cached tags", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  const insights = calculateInsights(
    [
      record({
        id: "a",
        createdAt: "2026-10-24T12:00:00.000Z",
        publicTags: ["科幻", "漫改", { name: "科幻", count: 300 }, "TV"],
      }),
      record({
        id: "b",
        createdAt: "2026-10-23T12:00:00.000Z",
        publicTags: ["漫画改", "科幻", "2024"],
      }),
      record({
        id: "c",
        createdAt: "2026-10-22T12:00:00.000Z",
        publicTags: ["奇幻", "科幻"],
      }),
      record({
        id: "d",
        createdAt: "2026-10-21T12:00:00.000Z",
        publicTags: ["奇幻", "科幻"],
      }),
      record({
        id: "e",
        createdAt: "2026-10-20T12:00:00.000Z",
        publicTags: ["日常", "短片"],
      }),
      record({
        id: "f",
        createdAt: "2026-10-19T12:00:00.000Z",
      }),
    ],
    now,
    {
      insights: {
        tagRadar: {
          enabled: true,
          mode: "auto",
          maxAxes: 3,
          excludedTags: ["短片"],
          aliasGroups: [["漫改", "漫画改"]],
        },
      },
    },
  );

  assert.equal(insights.tagRadar.available, true);
  assert.equal(insights.tagRadar.mode, "auto");
  assert.equal(insights.tagRadar.axes.length, 3);
  assert.equal(insights.tagRadar.axes[0].label, "科幻");
  assert.equal(insights.tagRadar.axes[0].count, 4);
  assert.deepEqual(
    insights.tagRadar.axes
      .slice(1)
      .map((axis) => [axis.label, axis.count])
      .sort(),
    [
      ["奇幻", 2],
      ["漫画改", 2],
    ].sort(),
  );
  assert.deepEqual(insights.tagRadar.coverage, {
    tagged: 5,
    total: 6,
    percent: 83.3,
  });
  assert.equal(insights.tagRadar.axes[0].percent, 100);
  assert.deepEqual(
    insights.tagRadar.ranking.map((axis) => axis.count),
    [4, 2, 2],
  );
  assert.equal(insights.tagRadar.ranking[0].label, "科幻");
  assert.equal(
    insights.tagRadar.axes.some((axis) => axis.label === "短片"),
    false,
  );
});

test("splits rated works by normalized tags", () => {
  const insights = calculateInsights(
    [
      record({
        id: "tag-a",
        rating: 9,
        publicTags: ["科幻", "漫改"],
      }),
      record({
        id: "tag-b",
        rating: 7,
        publicTags: ["科幻", "漫画改"],
      }),
      record({
        id: "tag-c",
        rating: 6,
        publicTags: ["奇幻"],
      }),
      record({
        id: "tag-d",
        publicTags: ["科幻"],
      }),
    ],
    new Date("2026-10-25T12:00:00.000Z"),
    {
      insights: {
        tagRadar: {
          enabled: true,
          mode: "auto",
          aliasGroups: [["漫改", "漫画改"]],
        },
      },
    },
  );

  assert.deepEqual(
    insights.ratingByTag.map((group) => [
      group.label,
      group.count,
      group.rated,
      group.averageRating,
    ]),
    [
      ["科幻", 3, 2, 8],
      ["漫画改", 2, 2, 8],
      ["奇幻", 1, 1, 6],
    ],
  );
  assert.deepEqual(
    insights.ratingByTag[0].buckets
      .filter((bucket) => bucket.count)
      .map((bucket) => [bucket.key, bucket.count]),
    [
      ["7-7.9", 1],
      ["9-10", 1],
    ],
  );
});

test("orders tag rating deviation by tagged anime count", () => {
  const insights = calculateInsights(
    [
      record({
        id: "deviation-a",
        rating: 9,
        externalIds: { bangumi: "1" },
        publicTags: ["科幻"],
      }),
      record({
        id: "deviation-b",
        rating: 7,
        externalIds: { bangumi: "2" },
        publicTags: ["科幻"],
      }),
      record({
        id: "deviation-c",
        externalIds: { bangumi: "3" },
        publicTags: ["科幻"],
      }),
      record({
        id: "deviation-d",
        rating: 8,
        externalIds: { bangumi: "4" },
        publicTags: ["奇幻"],
      }),
    ],
    new Date("2026-10-25T12:00:00.000Z"),
    {},
    {
      bangumiCacheEntries: [
        { subjectId: "1", score: 7 },
        { subjectId: "2", score: 8 },
        { subjectId: "3", score: 6 },
        { subjectId: "4", score: 9 },
      ],
    },
  );

  assert.deepEqual(
    insights.tagRatingDeviation.map((group) => [group.label, group.count]),
    [
      ["科幻", 3],
      ["奇幻", 1],
    ],
  );
  assert.equal(insights.tagRatingDeviation[0].personalAverage, 8);
  assert.equal(insights.tagRatingDeviation[0].publicAverage, 7);
  assert.equal(insights.tagRatingDeviation[0].deviation, 1);
  assert.equal(insights.tagRatingDeviation[0].personalRated, 2);
  assert.equal(insights.tagRatingDeviation[0].publicRated, 3);
});

test("keeps manual tag radar order and exposes zero-count axes", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  const insights = calculateInsights(
    [
      record({
        id: "a",
        createdAt: "2026-10-24T12:00:00.000Z",
        publicTags: ["科幻", "奇幻"],
      }),
      record({
        id: "b",
        createdAt: "2026-10-23T12:00:00.000Z",
        publicTags: ["科幻", "悬疑"],
      }),
    ],
    now,
    {
      insights: {
        tagRadar: {
          enabled: true,
          mode: "manual",
          maxAxes: 3,
          axes: ["奇幻", "未知标签", "科幻", "悬疑"],
        },
      },
    },
  );

  assert.equal(insights.tagRadar.available, true);
  assert.deepEqual(
    insights.tagRadar.axes.map((axis) => [axis.label, axis.count, axis.percent]),
    [
      ["奇幻", 1, 50],
      ["未知标签", 0, 0],
      ["科幻", 2, 100],
    ],
  );
  assert.equal(insights.tagRadar.topTag.label, "科幻");
});

test("applies excluded tags after alias normalization", () => {
  const insights = calculateInsights(
    [
      record({
        id: "a",
        createdAt: "2026-10-24T12:00:00.000Z",
        publicTags: ["漫改", "科幻", "奇幻", "悬疑"],
      }),
      record({
        id: "b",
        createdAt: "2026-10-23T12:00:00.000Z",
        publicTags: ["漫画改", "科幻", "奇幻"],
      }),
    ],
    new Date("2026-10-25T12:00:00.000Z"),
    {
      insights: {
        tagRadar: {
          enabled: true,
          mode: "auto",
          maxAxes: 4,
          excludedTags: ["漫画改"],
          aliasGroups: [["漫改", "漫画改"]],
        },
      },
    },
  );

  assert.equal(
    insights.tagRadar.axes.some((axis) => axis.label === "漫画改"),
    false,
  );
  assert.equal(insights.tagRadar.axes.length, 3);
});

test("compares repositories by stable ids without merging different seasons", () => {
  const current = [
    record({
      id: "bgm-100",
      title: "同一部作品",
      createdAt: "2026-10-25T12:00:00.000Z",
      rating: 9,
      year: 2024,
      externalIds: { bangumi: "100" },
    }),
    record({
      id: "bgm-101",
      title: "第二季",
      createdAt: "2026-10-25T12:00:00.000Z",
      rating: 8,
      year: 2025,
      externalIds: { bangumi: "101" },
    }),
  ];
  const peer = [
    record({
      id: "other-id",
      title: "同一部作品",
      createdAt: "2026-10-25T12:00:00.000Z",
      rating: 7,
      year: 2024,
      externalIds: { bangumi: "100" },
    }),
    record({
      id: "another-id",
      title: "第二季",
      createdAt: "2026-10-25T12:00:00.000Z",
      rating: 9,
      year: 2025,
      externalIds: { bangumi: "999" },
    }),
  ];

  const comparison = compareLibraries(current, peer);

  assert.equal(comparison.shared.length, 1);
  assert.equal(comparison.shared[0].id, "bgm-100");
  assert.equal(comparison.shared[0].ratingDifference, 2);
  assert.equal(comparison.currentOnly.length, 1);
  assert.equal(comparison.peerOnly.length, 1);
  assert.equal(comparison.overlap.count, 1);
  assert.equal(comparison.overlap.percent, 33.3);
  assert.equal(comparison.current.ratedPercent, 100);
  assert.equal(comparison.peer.ratedPercent, 100);
  assert.deepEqual(
    comparison.current.years.map((entry) => [entry.key, entry.count]),
    [[2025, 1], [2024, 1]],
  );
  assert.deepEqual(
    comparison.peer.ratings.map((entry) => [entry.key, entry.count]),
    [["9-10", 1], ["7-7.9", 1]],
  );
});
