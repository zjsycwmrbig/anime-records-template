const TRACKED_SITES = new Map([
  ["bangumi", "bangumi"],
  ["bilibili", "bilibiliMedia"],
  ["anilist", "anilist"],
  ["aniList", "anilist"],
  ["mal", "mal"],
]);

const DISPLAY_LANGUAGES = ["zh-Hans", "zh-Hant", "zh", "ja", "en"];
const SOURCE_LABELS = {
  bangumi: "Bangumi",
  bilibiliMedia: "Bilibili",
  anilist: "AniList",
  mal: "MyAnimeList",
};

function cleanString(value) {
  return String(value ?? "").trim();
}

export function normalizeCatalogQuery(value) {
  return cleanString(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\s]+/gu, "");
}

function querySegments(value) {
  return cleanString(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .split(/[\p{P}\s]+/gu)
    .map((segment) => normalizeCatalogQuery(segment))
    .filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const cleaned = cleanString(value);
    const key = normalizeCatalogQuery(cleaned);
    if (!cleaned || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function collectNames(item) {
  const translations = item?.titleTranslate ?? {};
  const values = [item?.title];
  const languageKeys = [
    ...DISPLAY_LANGUAGES,
    ...Object.keys(translations).filter(
      (language) => !DISPLAY_LANGUAGES.includes(language),
    ),
  ];
  for (const language of languageKeys) {
    const translated = translations[language];
    if (Array.isArray(translated)) {
      values.push(...translated);
    } else {
      values.push(translated);
    }
  }
  return uniqueStrings(values);
}

function collectDisplayTitle(item, names) {
  const translations = item?.titleTranslate ?? {};
  for (const language of ["zh-Hans", "zh-Hant", "zh"]) {
    const translated = translations[language];
    const candidates = Array.isArray(translated) ? translated : [translated];
    const chineseTitle = uniqueStrings(candidates)[0];
    if (chineseTitle) {
      return chineseTitle;
    }
  }
  return names[0] ?? "";
}

function normalizeCoverUrl(value) {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return null;
  }
  const resolved = cleaned.startsWith("//") ? `https:${cleaned}` : cleaned;
  return /^https?:\/\//iu.test(resolved) ? resolved : null;
}

function collectCoverUrl(item) {
  return [
    item?.coverUrl,
    item?.cover,
    item?.image,
    item?.images?.large,
    item?.images?.common,
    item?.images?.medium,
  ]
    .map(normalizeCoverUrl)
    .find(Boolean) ?? null;
}

function collectExternalIds(sites) {
  const result = {};
  if (!Array.isArray(sites)) {
    return result;
  }
  for (const site of sites) {
    const source = TRACKED_SITES.get(cleanString(site?.site));
    const id = cleanString(site?.id);
    if (source && id && !result[source]) {
      result[source] = id;
    }
  }
  return result;
}

function coerceYear(value) {
  const match = cleanString(value).match(/^(\d{4})/u);
  const year = match ? Number(match[1]) : null;
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}

function stableCatalogId(names, externalIds, year) {
  const preferred = [
    ["bangumi", "bangumi"],
    ["bilibiliMedia", "bilibili"],
    ["anilist", "anilist"],
    ["mal", "mal"],
  ].find(([source]) => externalIds[source]);
  if (preferred) {
    return `${preferred[1]}:${externalIds[preferred[0]]}`;
  }
  return `title:${normalizeCatalogQuery(names[0])}:${year ?? "unknown"}`;
}

function normalizeSeason(item, catalogId, year) {
  const number = Number(item?.season?.number);
  const seasonNumber =
    Number.isInteger(number) && number >= 1 && number <= 99 ? number : null;
  const explicitLabel = cleanString(item?.season?.label);
  return {
    key: catalogId,
    number: seasonNumber,
    label: seasonNumber ? explicitLabel || `第${seasonNumber}季` : null,
    year,
  };
}

export function buildCatalog(raw, metadata = {}) {
  if (!raw || !Array.isArray(raw.items)) {
    throw new Error("全量索引缺少 items 数组");
  }

  const items = raw.items
    .map((item) => {
      const names = collectNames(item);
      const title = cleanString(item?.title) || names[0];
      if (!title || !names.length) {
        return null;
      }
      const externalIds = collectExternalIds(item?.sites);
      const begin = cleanString(item?.begin) || null;
      const year = coerceYear(begin);
      const id = stableCatalogId(names, externalIds, year);
      const displayTitle = collectDisplayTitle(item, names) || title;
      const normalizedNames = uniqueStrings(
        names.map(normalizeCatalogQuery),
      );
      return {
        id,
        title,
        displayTitle,
        names,
        normalizedNames,
        searchText: uniqueStrings([
          displayTitle,
          title,
          ...names,
          ...Object.values(externalIds),
        ]).join(" "),
        type: cleanString(item?.type) || "unknown",
        begin,
        year,
        sites: externalIds,
        season: normalizeSeason(item, id, year),
        coverUrl: collectCoverUrl(item),
      };
    })
    .filter(Boolean);

  return {
    schemaVersion: 1,
    source: {
      id: "bangumi-data",
      name: "bangumi-data",
      version: cleanString(metadata.version) || "unknown",
      fetchedAt: metadata.fetchedAt ?? new Date().toISOString(),
      checkedAt: metadata.checkedAt ?? metadata.fetchedAt ?? new Date().toISOString(),
      license: "CC BY 4.0",
      sourceUrl: cleanString(metadata.sourceUrl) || null,
    },
    builtAt: new Date().toISOString(),
    itemCount: items.length,
    items,
  };
}

function compactCatalogItem(subjectId, value) {
  const id = cleanString(subjectId);
  if (!id || !Array.isArray(value)) {
    return null;
  }
  const [displayTitle, originalTitle, rawYear, type, begin, seasonNumber, seasonLabel, coverUrl] = value;
  const names = uniqueStrings([displayTitle, originalTitle]);
  if (!names.length) {
    return null;
  }
  const year = Number(rawYear);
  const normalizedYear = Number.isInteger(year) && year >= 1900 && year <= 2200
    ? year
    : null;
  const externalIds = { bangumi: id };
  const catalogId = `bangumi:${id}`;
  const normalizedNames = names.map(normalizeCatalogQuery);
  return {
    id: catalogId,
    title: names[1] || names[0],
    displayTitle: names[0],
    names,
    normalizedNames,
    searchText: uniqueStrings([...names, id]).join(" "),
    type: cleanString(type) || "unknown",
    begin: cleanString(begin) || null,
    year: normalizedYear,
    sites: externalIds,
    season: {
      key: catalogId,
      number:
        Number.isInteger(Number(seasonNumber)) && Number(seasonNumber) > 0
          ? Number(seasonNumber)
          : null,
      label: cleanString(seasonLabel) || null,
      year: normalizedYear,
    },
    coverUrl: normalizeCoverUrl(coverUrl),
  };
}

/**
 * Expands the compact public catalog bundled with the template into the same
 * search shape used by a freshly downloaded bangumi-data catalog.
 */
export function buildCatalogFromCompact(payload, metadata = {}) {
  if (!payload?.items || typeof payload.items !== "object" || Array.isArray(payload.items)) {
    throw new Error("紧凑全量索引缺少 items 对象");
  }
  const items = Object.entries(payload.items)
    .map(([subjectId, value]) => compactCatalogItem(subjectId, value))
    .filter(Boolean);
  const source = payload.source ?? {};
  const timestamp =
    metadata.checkedAt ??
    payload.generatedAt ??
    source.checkedAt ??
    new Date().toISOString();
  return {
    schemaVersion: 1,
    source: {
      id: cleanString(source.id) || "bangumi-data",
      name: cleanString(source.name) || "bangumi-data",
      version: cleanString(source.version) || "unknown",
      fetchedAt: metadata.fetchedAt ?? timestamp,
      checkedAt: timestamp,
      license: cleanString(source.license) || "CC BY 4.0",
      sourceUrl: cleanString(source.sourceUrl) || null,
      ...(source.seededFrom ? { seededFrom: source.seededFrom } : {}),
    },
    builtAt: payload.generatedAt ?? new Date().toISOString(),
    itemCount: items.length,
    items,
  };
}

export function isValidCatalog(catalog) {
  return (
    catalog?.schemaVersion === 1 &&
    Array.isArray(catalog.items) &&
    catalog.items.every(
      (item) =>
        cleanString(item?.id) &&
        cleanString(item?.displayTitle) &&
        Array.isArray(item?.names) &&
        item?.sites &&
        typeof item.sites === "object",
    )
  );
}

function scoreCandidate(candidate, normalizedQuery, segments) {
  const normalizedCandidate = normalizeCatalogQuery(candidate);
  if (!normalizedCandidate) {
    return Number.POSITIVE_INFINITY;
  }
  if (normalizedCandidate === normalizedQuery) {
    return 0;
  }
  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedCandidate.includes(normalizedQuery)) {
    return 2;
  }
  if (
    segments.length > 1 &&
    segments.every((segment) => normalizedCandidate.includes(segment))
  ) {
    return 3;
  }
  return Number.POSITIVE_INFINITY;
}

function scoreItem(item, normalizedQuery, segments) {
  if (!normalizedQuery) {
    return 0;
  }
  const titleCandidates = [
    item.displayTitle,
    item.title,
    ...(item.names ?? []),
    ...(item.normalizedNames ?? []),
  ];
  const idCandidates = Object.values(item.sites ?? {});
  return Math.min(
    ...titleCandidates.map((candidate) =>
      scoreCandidate(candidate, normalizedQuery, segments),
    ),
    ...idCandidates.map((candidate) =>
      scoreCandidate(candidate, normalizedQuery, segments),
    ),
  );
}

function catalogItemSourceKeys(item) {
  return Object.keys(item.sites ?? {}).filter(
    (source) => SOURCE_LABELS[source],
  );
}

function externalIdentityKeys(externalIds) {
  return Object.entries(externalIds ?? {})
    .map(([source, id]) => [cleanString(source), cleanString(id)])
    .filter(([source, id]) => source && id)
    .map(([source, id]) => `${source}:${id}`);
}

export function recordIdentityKeys(record) {
  const id = cleanString(record?.id);
  return [
    ...(id ? [`id:${id}`] : []),
    ...externalIdentityKeys(record?.externalIds),
  ];
}

export function ownedRecordLookup(index) {
  const lookup = new Map();
  for (const entry of index ?? []) {
    const recordId = cleanString(entry?.id);
    if (!recordId) {
      continue;
    }
    for (const key of recordIdentityKeys(entry)) {
      lookup.set(key, recordId);
    }
  }
  return lookup;
}

function catalogItemIdentityKeys(item) {
  const id = cleanString(item?.id);
  return [
    ...(id ? [`id:${id}`] : []),
    ...externalIdentityKeys(item?.sites),
  ];
}

export function ownedRecordIdForCatalogItem(item, ownedLookup) {
  for (const key of catalogItemIdentityKeys(item)) {
    const recordId = ownedLookup?.get(key);
    if (recordId) {
      return recordId;
    }
  }
  return null;
}

export function catalogFacets(items) {
  const years = new Map();
  const sources = new Map();
  for (const item of items) {
    if (Number.isInteger(item.year)) {
      years.set(item.year, (years.get(item.year) ?? 0) + 1);
    }
    for (const source of catalogItemSourceKeys(item)) {
      sources.set(source, (sources.get(source) ?? 0) + 1);
    }
  }
  return {
    years: [...years.entries()]
      .sort((left, right) => right[0] - left[0])
      .map(([value, count]) => ({ value, count })),
    sources: [...sources.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([value, count]) => ({
        value,
        label: SOURCE_LABELS[value],
        count,
      })),
  };
}

function normalizeYearFilter(value) {
  const values = Array.isArray(value) ? value : [value];
  const years = new Set();
  for (const candidate of values) {
    for (const part of cleanString(candidate).split(/[\s,，]+/u)) {
      const year = Number(part);
      if (Number.isInteger(year) && year >= 1900 && year <= 2200) {
        years.add(year);
      }
    }
  }
  return years;
}

function bangumiSubjectId(item) {
  return cleanString(item?.sites?.bangumi);
}

function hasUsableBangumiMetadata(metadata) {
  const score = metadata?.score;
  return Boolean(
    metadata &&
      ((score !== null &&
        score !== undefined &&
        score !== "" &&
        Number.isFinite(Number(score))) ||
        metadata.tags?.length),
  );
}

function normalizeBangumiMetadata(entries) {
  const metadataBySubject = new Map();
  for (const rawEntry of entries ?? []) {
    const subjectId = cleanString(rawEntry?.subjectId);
    if (!subjectId) {
      continue;
    }
    const rawScore = rawEntry?.score;
    const score =
      rawScore === null || rawScore === undefined || rawScore === ""
        ? null
        : Number(rawScore);
    metadataBySubject.set(subjectId, {
      ...rawEntry,
      subjectId,
      score:
        Number.isFinite(score) && score > 0 && score <= 10
          ? Math.round(score * 10) / 10
          : null,
      tags: Array.isArray(rawEntry.tags)
        ? rawEntry.tags
            .map((tag) => ({
              name: cleanString(tag?.name),
              count: Number(tag?.count) || 0,
            }))
            .filter((tag) => tag.name)
        : [],
    });
  }
  return metadataBySubject;
}

function withBangumiMetadata(item, metadataBySubject) {
  const metadata = metadataBySubject.get(bangumiSubjectId(item));
  if (!metadata) {
    return item;
  }
  return {
    ...item,
    bangumiMetadata: metadata,
    bangumiMetadataResolved: true,
    bangumiMetadataSource: cleanString(metadata.storageSource) || "browser",
  };
}

function normalizedTag(value) {
  return cleanString(value).normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function metadataScoreBounds(options) {
  const normalize = (value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.max(0, Math.min(10, number))
      : null;
  };
  let minimum = normalize(options.scoreMin);
  let maximum = normalize(options.scoreMax);
  if (minimum !== null && maximum !== null && minimum > maximum) {
    [minimum, maximum] = [maximum, minimum];
  }
  return { minimum, maximum };
}

function matchesBangumiMetadata(item, options, scoreBounds, selectedTags) {
  const metadata = item.bangumiMetadata;
  const available = hasUsableBangumiMetadata(metadata);
  if (options.availability === "available" && !available) {
    return false;
  }
  if (options.availability === "unavailable" && available) {
    return false;
  }
  if (scoreBounds.minimum !== null || scoreBounds.maximum !== null) {
    if (!Number.isFinite(metadata?.score)) {
      return false;
    }
    if (
      scoreBounds.minimum !== null &&
      metadata.score < scoreBounds.minimum
    ) {
      return false;
    }
    if (
      scoreBounds.maximum !== null &&
      metadata.score > scoreBounds.maximum
    ) {
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
}

export function searchCatalog(items, options = {}) {
  const query = cleanString(options.query);
  const normalizedQuery = normalizeCatalogQuery(query);
  const segments = querySegments(query);
  const years = normalizeYearFilter(options.year);
  const source = cleanString(options.source);
  const ownership = cleanString(options.owned);
  const ownedKeys = new Set(
    Array.isArray(options.ownedKeys)
      ? options.ownedKeys
      : options.ownedKeys instanceof Set
        ? options.ownedKeys
        : [],
  );
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const limit = Math.min(
    60,
    Math.max(1, Math.floor(Number(options.limit) || 30)),
  );
  const metadataBySubject = normalizeBangumiMetadata(options.metadataEntries);
  const scoreBounds = metadataScoreBounds(options);
  const selectedTags = new Set(
    (Array.isArray(options.tags)
      ? options.tags
      : cleanString(options.tags).split(/[,，]/u)
    )
      .map(normalizedTag)
      .filter(Boolean),
  );
  const metadataAvailability =
    cleanString(options.availability) || "all";
  const metadataSort = cleanString(options.sort);

  const matched = (items ?? [])
    .map((item, index) => ({
      item: withBangumiMetadata(item, metadataBySubject),
      index,
    }))
    .filter(({ item }) => {
      if (years.size && !years.has(item.year)) {
        return false;
      }
      if (source && !item.sites?.[source]) {
        return false;
      }
      const owned = catalogItemIdentityKeys(item).some((key) =>
        ownedKeys.has(key),
      );
      if (ownership === "owned" && !owned) {
        return false;
      }
      if (ownership === "unowned" && owned) {
        return false;
      }
      return (
        !normalizedQuery ||
        scoreItem(item, normalizedQuery, segments) <
          Number.POSITIVE_INFINITY
      );
    })
    .map((item) => ({
      ...item,
      score: scoreItem(item.item, normalizedQuery, segments),
    }))
    .filter(({ item }) =>
      matchesBangumiMetadata(
        item,
        { availability: metadataAvailability },
        scoreBounds,
        selectedTags,
      ),
    )
    .sort((left, right) => {
      return (
        left.score - right.score ||
        cleanString(right.item.begin).localeCompare(
          cleanString(left.item.begin),
          "zh-CN",
        ) ||
        left.item.displayTitle.localeCompare(
          right.item.displayTitle,
          "zh-CN",
        )
      );
    });

  if (
    metadataSort === "bangumi-score-desc" ||
    metadataSort === "bangumi-score-asc"
  ) {
    const direction = metadataSort === "bangumi-score-desc" ? -1 : 1;
    matched.sort((left, right) => {
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
    total: matched.length,
    offset,
    limit,
    items: matched
      .slice(offset, offset + limit)
      .map(({ item }) => item),
  };
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function recordIdForCatalog(item) {
  const preferred = [
    ["bangumi", "bgm"],
    ["bilibiliMedia", "bili"],
    ["anilist", "anilist"],
    ["mal", "mal"],
  ].find(([source]) => item.sites?.[source]);
  const raw = preferred
    ? `${preferred[1]}-${item.sites[preferred[0]]}`
    : `catalog-${normalizeCatalogQuery(item.displayTitle)}-${fnv1a(item.id)}`;
  const normalized = raw
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64);
  return normalized.length >= 3 ? normalized : `catalog-${fnv1a(item.id)}`;
}

function cleanText(value, maximumLength) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

function normalizeRating(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    throw new Error("评分必须是 0 到 10 之间的数字");
  }
  return Math.round(rating * 10) / 10;
}

export function createRecordFromCatalog(item, changes = {}, now = new Date().toISOString()) {
  const title = cleanText(changes.title, 200) || item.displayTitle || item.title;
  return {
    $schema: "../../schemas/anime.schema.json",
    schemaVersion: 1,
    id: recordIdForCatalog(item),
    title,
    rating: normalizeRating(changes.rating),
    review: cleanText(changes.review, 20000),
    coverUrl: normalizeCoverUrl(changes.coverUrl || item.coverUrl),
    note: cleanText(changes.note, 5000),
    externalIds: item.sites ?? {},
    season: normalizeSeason(item, item.id, item.year),
    match: {
      status: "matched",
      method: "import",
      source: "bangumi-data",
      confidence: 1,
      matchedTitle: cleanText(item.title, 200),
      matchedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function catalogItemView(item, ownedRecordId = null) {
  return {
    id: item.id,
    title: item.title,
    displayTitle: item.displayTitle,
    names: item.names.slice(0, 8),
    type: item.type,
    begin: item.begin,
    year: item.year,
    sites: item.sites,
    sources: catalogItemSourceKeys(item).map((source) => ({
      value: source,
      label: SOURCE_LABELS[source],
    })),
    season: item.season,
    coverUrl: item.coverUrl,
    ownedRecordId,
    bangumiMetadata: item.bangumiMetadata ?? null,
    bangumiMetadataResolved: Boolean(item.bangumiMetadataResolved),
    bangumiMetadataSource: item.bangumiMetadataSource ?? null,
  };
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] ?? source;
}
