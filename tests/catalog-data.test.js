import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalog,
  buildCatalogFromCompact,
  createRecordFromCatalog,
  recordIdentityKeys,
  searchCatalog,
} from "../scripts/catalog-data.mjs";

test("expands the bundled compact catalog for offline-first search", () => {
  const catalog = buildCatalogFromCompact({
    generatedAt: "2026-10-27T00:00:00.000Z",
    source: { version: "0.3.234", license: "CC BY 4.0" },
    items: {
      "265": [
        "进击的巨人",
        "進撃の巨人",
        2013,
        "tv",
        "2013-04-06T15:00:00.000Z",
        null,
        null,
        "//images.example.test/cover.jpg",
      ],
    },
  });

  assert.equal(catalog.itemCount, 1);
  assert.equal(catalog.items[0].id, "bangumi:265");
  assert.equal(catalog.items[0].displayTitle, "进击的巨人");
  assert.deepEqual(catalog.items[0].sites, { bangumi: "265" });
  assert.equal(catalog.items[0].coverUrl, "https://images.example.test/cover.jpg");
  assert.equal(searchCatalog(catalog.items, { query: "进击" }).total, 1);
});

const rawCatalog = {
  items: [
    {
      title: "進撃の巨人",
      titleTranslate: {
        "zh-Hans": ["进击的巨人"],
        en: ["Attack on Titan"],
      },
      type: "tv",
      begin: "2013-04-06T15:00:00.000Z",
      sites: [
        { site: "bangumi", id: "265" },
        { site: "bilibili", id: "3500" },
        { site: "aniList", id: "16498" },
      ],
    },
    {
      title: "葬送のフリーレン",
      titleTranslate: {
        "zh-Hans": ["葬送的芙莉莲"],
      },
      type: "tv",
      begin: "2023-09-29T15:00:00.000Z",
      sites: [
        { site: "bangumi", id: "400602" },
        { site: "bilibili", id: "292073015" },
      ],
    },
    {
      title: "Cowboy Bebop",
      titleTranslate: {},
      type: "tv",
      begin: "1998-04-03T15:00:00.000Z",
      sites: [{ site: "mal", id: "1" }],
    },
  ],
};

test("builds a Chinese-first normalized catalog", () => {
  const catalog = buildCatalog(rawCatalog, {
    version: "1.2.3",
    fetchedAt: "2026-10-25T00:00:00.000Z",
  });

  assert.equal(catalog.itemCount, 3);
  assert.equal(catalog.items[0].displayTitle, "进击的巨人");
  assert.equal(catalog.items[0].title, "進撃の巨人");
  assert.deepEqual(catalog.items[0].sites, {
    bangumi: "265",
    bilibiliMedia: "3500",
    anilist: "16498",
  });
  assert.equal(catalog.items[0].year, 2013);
  assert.equal(catalog.items[0].coverUrl, null);
  assert.equal(catalog.source.version, "1.2.3");
});

test("searches by Chinese title, spaced fuzzy words, and external site id", () => {
  const catalog = buildCatalog(rawCatalog);
  const items = catalog.items;

  assert.equal(
    searchCatalog(items, { query: "进击的巨人" }).items[0].displayTitle,
    "进击的巨人",
  );
  assert.equal(
    searchCatalog(items, { query: "进击 巨人" }).items[0].displayTitle,
    "进击的巨人",
  );
  assert.equal(
    searchCatalog(items, { query: "400602" }).items[0].displayTitle,
    "葬送的芙莉莲",
  );
  assert.equal(
    searchCatalog(items, { query: "attach" }).total,
    0,
  );
});

test("filters and paginates the catalog", () => {
  const items = buildCatalog(rawCatalog).items;

  assert.equal(searchCatalog(items, { year: "" }).total, 3);
  assert.equal(searchCatalog(items, { year: 2023 }).total, 1);
  assert.equal(searchCatalog(items, { year: "2013,2023" }).total, 2);
  assert.equal(searchCatalog(items, { year: [1998, 2023] }).total, 2);
  assert.equal(searchCatalog(items, { source: "anilist" }).total, 1);
  assert.deepEqual(
    searchCatalog(items, { limit: 1, offset: 1 }).items.map(
      (item) => item.displayTitle,
    ),
    ["进击的巨人"],
  );
});

test("filters the catalog by owned records using stable site identities", () => {
  const items = buildCatalog(rawCatalog).items;
  const ownedKeys = recordIdentityKeys({
    id: "bgm-265",
    externalIds: { bangumi: "265" },
  });

  const owned = searchCatalog(items, { owned: "owned", ownedKeys });
  assert.equal(owned.total, 1);
  assert.equal(owned.items[0].displayTitle, "进击的巨人");

  const unowned = searchCatalog(items, { owned: "unowned", ownedKeys });
  assert.equal(unowned.total, 2);
  assert.ok(
    unowned.items.every((item) => item.displayTitle !== "进击的巨人"),
  );
});

test("filters and sorts all cached Bangumi metadata before pagination", () => {
  const items = buildCatalog(rawCatalog).items;
  const metadataEntries = [
    {
      subjectId: "265",
      score: 9.2,
      tags: [{ name: "热血", count: 1200 }],
      storageSource: "personal",
    },
    {
      subjectId: "400602",
      score: 8.6,
      tags: [
        { name: "奇幻", count: 980 },
        { name: "旅行", count: 540 },
      ],
      storageSource: "browser",
    },
  ];

  const fantasy = searchCatalog(items, {
    metadataEntries,
    tags: ["奇幻"],
  });
  assert.equal(fantasy.total, 1);
  assert.equal(fantasy.items[0].displayTitle, "葬送的芙莉莲");
  assert.equal(
    fantasy.items[0].bangumiMetadataSource,
    "browser",
  );

  const firstPage = searchCatalog(items, {
    metadataEntries,
    scoreMin: "8",
    sort: "bangumi-score-desc",
    limit: 1,
  });
  assert.equal(firstPage.total, 2);
  assert.equal(firstPage.items[0].displayTitle, "进击的巨人");

  const secondPage = searchCatalog(items, {
    metadataEntries,
    scoreMin: "8",
    sort: "bangumi-score-desc",
    limit: 1,
    offset: 1,
  });
  assert.equal(secondPage.items[0].displayTitle, "葬送的芙莉莲");

  const withoutScore = searchCatalog(items, {
    metadataEntries: [
      {
        subjectId: "265",
        score: null,
        tags: [{ name: "热血", count: 1200 }],
      },
    ],
    scoreMin: "0",
    scoreMax: "10",
  });
  assert.equal(withoutScore.total, 0);
});

test("creates a stable record from a catalog candidate", () => {
  const item = buildCatalog(rawCatalog).items[0];
  const record = createRecordFromCatalog(
    item,
    {
      title: "进击的巨人 第一季",
      rating: "9.26",
      review: "中文评价",
      note: "备注",
    },
    "2026-10-25T12:00:00.000Z",
  );

  assert.equal(record.id, "bgm-265");
  assert.equal(record.title, "进击的巨人 第一季");
  assert.equal(record.rating, 9.3);
  assert.equal(record.season.key, "bangumi:265");
  assert.equal(record.season.year, 2013);
  assert.deepEqual(record.externalIds, item.sites);
});

test("keeps a cover resolved by the management page", () => {
  const item = buildCatalog(rawCatalog).items[0];
  const record = createRecordFromCatalog(
    item,
    { coverUrl: "https://images.example.test/cover.jpg" },
    "2026-10-25T12:00:00.000Z",
  );

  assert.equal(record.coverUrl, "https://images.example.test/cover.jpg");
});

test("inherits the catalog cover when changes omit a cover", () => {
  const item = {
    ...buildCatalog(rawCatalog).items[0],
    coverUrl: "https://images.example.test/catalog-cover.jpg",
  };
  const record = createRecordFromCatalog(
    item,
    { rating: 8.5 },
    "2026-10-25T12:00:00.000Z",
  );

  assert.equal(record.coverUrl, item.coverUrl);
});
