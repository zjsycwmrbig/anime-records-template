import { normalizeTagRadarConfig } from "./site-settings.mjs";

const SOURCE_LABELS = {
  bangumi: "Bangumi",
  bilibiliMedia: "Bilibili",
  bilibiliSeason: "Bilibili 剧集",
  anilist: "AniList",
  mal: "MyAnimeList",
};

const IGNORED_TAG_RADAR_TAGS = new Set([
  "tv",
  "ova",
  "oad",
  "web",
  "剧场版",
  "电影",
  "动画",
  "日本",
  "日本动画",
  "电视动画",
  "国产动画",
]);

function round(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length
    ? round(numbers.reduce((total, value) => total + value, 0) / numbers.length)
    : null;
}

function median(values) {
  const numbers = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numbers.length) {
    return null;
  }
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2
    ? round(numbers[middle])
    : round((numbers[middle - 1] + numbers[middle]) / 2);
}

function percent(value, total) {
  return total > 0 ? round((value / total) * 100) : 0;
}

function tagKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

function createTagNormalizer(aliasGroups, excludedTags) {
  const aliases = new Map();
  const excluded = new Set(
    excludedTags.map(tagKey).filter(Boolean),
  );
  for (const group of aliasGroups) {
    const names = group.map((name) => String(name).trim()).filter(Boolean);
    if (names.length < 2) {
      continue;
    }
    const canonical = names.at(-1);
    const canonicalKey = tagKey(canonical);
    for (const name of names) {
      aliases.set(tagKey(name), {
        key: canonicalKey,
        label: canonical,
      });
    }
  }
  return (value) => {
    const label = String(value ?? "").normalize("NFKC").trim();
    const sourceKey = tagKey(label);
    const aliased = aliases.get(sourceKey);
    const resolvedKey = aliased?.key ?? sourceKey;
    if (
      !sourceKey ||
      /^\d{4}$/u.test(sourceKey) ||
      IGNORED_TAG_RADAR_TAGS.has(sourceKey) ||
      IGNORED_TAG_RADAR_TAGS.has(resolvedKey) ||
      excluded.has(sourceKey) ||
      excluded.has(resolvedKey)
    ) {
      return null;
    }
    return aliased ?? {
      key: resolvedKey,
      label: label.replace(/\s+/gu, " "),
    };
  };
}

function normalizedRecordTags(record, normalizeTag) {
  const tags = new Map();
  for (const value of Array.isArray(record.publicTags) ? record.publicTags : []) {
    const normalized = normalizeTag(
      value && typeof value === "object" ? value.name : value,
    );
    if (normalized && !tags.has(normalized.key)) {
      tags.set(normalized.key, normalized);
    }
  }
  return [...tags.values()];
}

export function calculateTagRadar(records, siteConfig) {
  const config = normalizeTagRadarConfig(siteConfig?.insights?.tagRadar);
  const normalizeTag = createTagNormalizer(
    config.aliasGroups,
    config.excludedTags,
  );
  const counts = new Map();
  let tagged = 0;

  for (const record of records) {
    const recordTags = normalizedRecordTags(record, normalizeTag);
    for (const normalized of recordTags) {
      const entry = counts.get(normalized.key) ?? {
        key: normalized.key,
        label: normalized.label,
        count: 0,
      };
      entry.count += 1;
      counts.set(normalized.key, entry);
    }
    if (recordTags.length) {
      tagged += 1;
    }
  }

  const ranked = [...counts.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.label.localeCompare(right.label, "zh-CN"),
  );
  const configured = config.axes
    .map((name) => normalizeTag(name))
    .filter(Boolean);
  const selected =
    config.mode === "manual" && configured.length
      ? configured
          .map((tag) => counts.get(tag.key) ?? {
            key: tag.key,
            label: tag.label,
            count: 0,
          })
          .slice(0, config.maxAxes)
      : ranked.slice(0, config.maxAxes);
  const maximum = Math.max(1, ...selected.map((tag) => tag.count));
  const axes = selected.map((tag, index) => ({
    index,
    ...tag,
    value: tag.count,
    percent: percent(tag.count, maximum),
  }));
  const ranking = [...axes]
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.label.localeCompare(right.label, "zh-CN"),
    )
    .map((axis, index) => ({
      ...axis,
      rank: index + 1,
    }));
  const total = records.length;
  const coverage = {
    tagged,
    total,
    percent: percent(tagged, total),
  };

  return {
    enabled: config.enabled,
    available: config.enabled && axes.length >= 3 && tagged > 0,
    mode: config.mode,
    maxAxes: config.maxAxes,
    axes,
    ranking,
    coverage,
    topTag: ranked[0] ?? null,
    excludedTags: config.excludedTags,
    aliasGroups: config.aliasGroups,
  };
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dayKey(date) {
  return `${monthKey(date)}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function monthLabel(date) {
  return `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function withBarPercent(items) {
  const maximum = Math.max(1, ...items.map((item) => item.count));
  return items.map((item) => ({
    ...item,
    percent: percent(item.count, maximum),
  }));
}

function monthSeries(records, now) {
  const months = [];
  const counts = new Map();
  for (const record of records) {
    const created = new Date(record.createdAt);
    if (!Number.isNaN(created.getTime())) {
      const key = monthKey(created);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
    );
    months.push({
      key: monthKey(date),
      label: monthLabel(date),
      shortLabel: `${date.getUTCMonth() + 1}月`,
      count: counts.get(monthKey(date)) ?? 0,
    });
  }
  return withBarPercent(months);
}

function currentMonthSeries(records, now) {
  const counts = new Map();
  for (const record of records) {
    const created = new Date(record.createdAt);
    if (!Number.isNaN(created.getTime())) {
      counts.set(dayKey(created), (counts.get(dayKey(created)) ?? 0) + 1);
    }
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month, day));
    days.push({
      key: dayKey(date),
      label: `${month + 1}.${day}`,
      shortLabel: String(day),
      count: counts.get(dayKey(date)) ?? 0,
    });
  }
  return withBarPercent(days);
}

function weekSeries(records, now) {
  const day = 24 * 60 * 60 * 1000;
  const endOfCurrentWeek = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  const createdTimes = records
    .map((record) => new Date(record.createdAt).getTime())
    .filter((value) => Number.isFinite(value));
  const weeks = [];
  for (let offset = 7; offset >= 0; offset -= 1) {
    const end = endOfCurrentWeek - offset * 7 * day;
    const start = end - 7 * day;
    const startDate = new Date(start);
    const endDate = new Date(end - 1);
    weeks.push({
      key: dayKey(startDate),
      label: `${startDate.getUTCMonth() + 1}.${startDate.getUTCDate()} - ${endDate.getUTCMonth() + 1}.${endDate.getUTCDate()}`,
      shortLabel: `${startDate.getUTCMonth() + 1}.${startDate.getUTCDate()}`,
      count: createdTimes.filter((value) => value >= start && value < end).length,
    });
  }
  return withBarPercent(weeks);
}

function activityCalendar(records, now) {
  const day = 24 * 60 * 60 * 1000;
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const weekEnd = today + (6 - new Date(today).getUTCDay()) * day;
  const weekCount = 53;
  const start = weekEnd - (weekCount * 7 - 1) * day;
  const counts = new Map();
  for (const record of records) {
    const created = new Date(record.createdAt);
    if (!Number.isNaN(created.getTime())) {
      const key = dayKey(created);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const startKey = dayKey(new Date(start));
  const todayKey = dayKey(new Date(today));
  const visibleCounts = [...counts.entries()]
    .filter(([key]) => key >= startKey && key <= todayKey)
    .map(([, count]) => count);
  const maximum = Math.max(0, ...visibleCounts);
  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
  const weeks = [];
  const monthLabels = [];
  let lastMonth = null;

  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const days = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const timestamp = start + (weekIndex * 7 + weekday) * day;
      const date = new Date(timestamp);
      const key = dayKey(date);
      const future = timestamp > today;
      const count = future ? 0 : counts.get(key) ?? 0;
      const level =
        count === 0
          ? 0
          : maximum <= 1
            ? 4
            : Math.max(1, Math.ceil((count / maximum) * 4));
      days.push({
        key,
        label: `${date.getUTCFullYear()}.${date.getUTCMonth() + 1}.${date.getUTCDate()} 周${weekdayLabels[weekday]} · ${count} 部`,
        count,
        level,
        future,
      });
    }
    weeks.push({
      key: days[0].key,
      days,
    });
    const month = new Date(start + weekIndex * 7 * day).getUTCMonth();
    if (month !== lastMonth) {
      monthLabels.push({
        weekIndex,
        label: `${month + 1}月`,
      });
      lastMonth = month;
    }
  }

  return {
    weeks,
    monthLabels,
    maximum,
    total: visibleCounts.reduce((sum, count) => sum + count, 0),
    lastWeekCount: windowCount(records, now, 7),
    startLabel: `${new Date(start).getUTCFullYear()}.${new Date(start).getUTCMonth() + 1}.${new Date(start).getUTCDate()}`,
    endLabel: `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`,
  };
}

function windowCount(records, now, days) {
  const end = now.getTime();
  const start = end - days * 24 * 60 * 60 * 1000;
  return records.filter((record) => {
    const created = new Date(record.createdAt).getTime();
    return created >= start && created <= end;
  }).length;
}

function decadeFor(record) {
  const year = Number(record.season?.year);
  return Number.isInteger(year) && year >= 1900 ? Math.floor(year / 10) * 10 : null;
}

function yearFor(record) {
  const year = Number(record.season?.year);
  return Number.isInteger(year) && year >= 1900 ? year : null;
}

function buildDistribution(records, keyFor, total) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFor(record);
    const group = groups.get(key) ?? { key, count: 0, ratings: [] };
    group.count += 1;
    if (record.rating !== null) {
      group.ratings.push(Number(record.rating));
    }
    groups.set(key, group);
  }
  return groups;
}

const PIE_COLORS = [
  "#c84a32",
  "#168c83",
  "#d39a35",
  "#4f6f8f",
  "#8f5f83",
  "#6d8060",
  "#c06d4a",
  "#7d8792",
];

const RATING_BUCKET_DEFINITIONS = [
  {
    key: "0-5.9",
    label: "0 - 5.9",
    shortLabel: "0-5.9",
    className: "low",
    test: (rating) => rating < 6,
  },
  {
    key: "6-6.9",
    label: "6 - 6.9",
    shortLabel: "6-6.9",
    className: "lower-mid",
    test: (rating) => rating >= 6 && rating < 7,
  },
  {
    key: "7-7.9",
    label: "7 - 7.9",
    shortLabel: "7-7.9",
    className: "mid",
    test: (rating) => rating >= 7 && rating < 8,
  },
  {
    key: "8-8.9",
    label: "8 - 8.9",
    shortLabel: "8-8.9",
    className: "high",
    test: (rating) => rating >= 8 && rating < 9,
  },
  {
    key: "9-10",
    label: "9 - 10",
    shortLabel: "9-10",
    className: "top",
    test: (rating) => rating >= 9,
  },
];

function withPieSegments(items) {
  let offset = 0;
  return items
    .filter((entry) => entry.count > 0)
    .map((entry, index) => {
      const start = offset;
      offset += entry.percent;
      return {
        ...entry,
        start: round(start, 2),
        end: round(offset, 2),
        color:
          entry.key === "unrated"
            ? "#aeb6b0"
            : PIE_COLORS[index % PIE_COLORS.length],
      };
  });
}

function summarizeRatingBreakdown(groups) {
  return groups.map((group) => {
    const rated = group.ratings.length;
    return {
      key: group.key,
      label: group.label,
      count: group.count,
      rated,
      unrated: group.count - rated,
      ratedPercent: percent(rated, group.count),
      averageRating: average(group.ratings) ?? "—",
      buckets: RATING_BUCKET_DEFINITIONS.map((bucket) => {
        const count = group.ratings.filter(bucket.test).length;
        return {
          key: bucket.key,
          label: bucket.label,
          shortLabel: bucket.shortLabel,
          className: bucket.className,
          count,
          percent: percent(count, rated),
        };
      }),
    };
  });
}

function ratingBreakdownByTags(records, siteConfig) {
  const config = normalizeTagRadarConfig(siteConfig?.insights?.tagRadar);
  const normalizeTag = createTagNormalizer(
    config.aliasGroups,
    config.excludedTags,
  );
  const groups = new Map();
  for (const record of records) {
    const rating = Number(record.rating);
    const tags = normalizedRecordTags(record, normalizeTag);
    for (const tag of tags) {
      const group = groups.get(tag.key) ?? {
        key: tag.key,
        label: tag.label,
        count: 0,
        ratings: [],
      };
      group.count += 1;
      if (record.rating !== null && Number.isFinite(rating)) {
        group.ratings.push(rating);
      }
      groups.set(tag.key, group);
    }
  }
  return summarizeRatingBreakdown(
    [...groups.values()]
      .filter((group) => group.ratings.length > 0)
      .sort(
        (left, right) =>
          right.ratings.length - left.ratings.length ||
          right.count - left.count ||
          left.label.localeCompare(right.label, "zh-CN"),
      )
      .slice(0, 12),
  );
}

function normalizedCacheSubjectId(record) {
  return String(record?.externalIds?.bangumi ?? "").trim();
}

function finiteRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 0 && rating <= 10
    ? rating
    : null;
}

function ratingDeviationByTags(records, siteConfig, entries = []) {
  const config = normalizeTagRadarConfig(siteConfig?.insights?.tagRadar);
  const normalizeTag = createTagNormalizer(
    config.aliasGroups,
    config.excludedTags,
  );
  const cacheBySubject = new Map(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => [String(entry?.subjectId ?? "").trim(), entry])
      .filter(([subjectId]) => subjectId),
  );
  const groups = new Map();

  for (const record of records) {
    const cacheEntry = cacheBySubject.get(normalizedCacheSubjectId(record));
    const sourceTags = normalizedRecordTags(record, normalizeTag);
    const tags = sourceTags.length
      ? sourceTags
      : normalizedRecordTags(
          { publicTags: cacheEntry?.tags ?? [] },
          normalizeTag,
        );
    const personalRating = finiteRating(record.rating);
    const publicRating = finiteRating(
      record.publicRating ?? cacheEntry?.score,
    );

    for (const tag of tags) {
      const group = groups.get(tag.key) ?? {
        key: tag.key,
        label: tag.label,
        count: 0,
        personalRatings: [],
        publicRatings: [],
      };
      group.count += 1;
      if (personalRating !== null) {
        group.personalRatings.push(personalRating);
      }
      if (publicRating !== null) {
        group.publicRatings.push(publicRating);
      }
      groups.set(tag.key, group);
    }
  }

  return [...groups.values()]
    .map((group) => {
      const personalAverage = average(group.personalRatings);
      const publicAverage = average(group.publicRatings);
      const deviation =
        personalAverage === null || publicAverage === null
          ? null
          : round(personalAverage - publicAverage);
      return {
        key: group.key,
        label: group.label,
        count: group.count,
        personalRated: group.personalRatings.length,
        publicRated: group.publicRatings.length,
        personalAverage,
        publicAverage,
        personalAverageDisplay:
          personalAverage === null ? "—" : personalAverage.toFixed(1),
        publicAverageDisplay:
          publicAverage === null ? "—" : publicAverage.toFixed(1),
        personalPercent:
          personalAverage === null ? 0 : round(personalAverage * 10),
        publicPercent:
          publicAverage === null ? 0 : round(publicAverage * 10),
        deviation,
        deviationDisplay: deviation === null
          ? "—"
          : `${deviation > 0 ? "+" : ""}${deviation.toFixed(1)}`,
        deviationTone:
          deviation === null
            ? "neutral"
            : deviation > 0
              ? "positive"
              : deviation < 0
                ? "negative"
                : "even",
      };
    })
    .sort((left, right) => {
      const leftDeviation = left.deviation === null
        ? -1
        : Math.abs(left.deviation);
      const rightDeviation = right.deviation === null
        ? -1
        : Math.abs(right.deviation);
      return (
        rightDeviation - leftDeviation ||
        right.count - left.count ||
        left.label.localeCompare(right.label, "zh-CN")
      );
    });
}

function calculatePublicCacheCoverage(records, entries = []) {
  const cacheBySubject = new Map(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => [String(entry?.subjectId ?? "").trim(), entry])
      .filter(([subjectId]) => subjectId),
  );
  let cached = 0;
  let scored = 0;
  let tagged = 0;
  let summarized = 0;
  let covered = 0;

  for (const record of records) {
    const subjectId = String(record.externalIds?.bangumi ?? "").trim();
    const entry = subjectId ? cacheBySubject.get(subjectId) : null;
    if (!entry) {
      continue;
    }
    cached += 1;
    if (
      Number.isFinite(Number(entry.score)) &&
      Number(entry.score) > 0
    ) {
      scored += 1;
    }
    if (Array.isArray(entry.tags) && entry.tags.length) {
      tagged += 1;
    }
    if (String(entry.summary ?? "").trim()) {
      summarized += 1;
    }
    if (
      (Number.isFinite(Number(entry.score)) && Number(entry.score) > 0) ||
      Number(entry.ratingCount) > 0 ||
      (Array.isArray(entry.tags) && entry.tags.length > 0) ||
      String(entry.summary ?? "").trim() ||
      String(entry.coverUrl ?? "").trim()
    ) {
      covered += 1;
    }
  }

  const total = records.length;
  const fileEntries = cacheBySubject.size;
  return {
    fileEntries,
    cached,
    covered,
    scored,
    tagged,
    summarized,
    missing: Math.max(0, total - cached),
    coveragePercent: percent(cached, total),
    dataPercent: percent(covered, total),
    scorePercent: percent(scored, total),
    tagPercent: percent(tagged, total),
    summaryPercent: percent(summarized, total),
  };
}

export function calculateInsights(
  records,
  now = new Date(),
  siteConfig = {},
  options = {},
) {
  const ratings = records
    .map((record) => record.rating)
    .filter((rating) => rating !== null)
    .map(Number);
  const averageRating = average(ratings);
  const total = records.length;

  const decadesMap = buildDistribution(records, decadeFor, total);
  const decades = [...decadesMap.values()]
    .sort((left, right) => {
      if (left.key === null) return 1;
      if (right.key === null) return -1;
      return left.key - right.key;
    })
    .map((group) => ({
      key: group.key,
      label: group.key === null ? "年份未知" : `${group.key} 年代`,
      count: group.count,
      percent: percent(group.count, total),
      averageRating: average(group.ratings) ?? "—",
    }));

  const years = [...buildDistribution(records, yearFor, total).values()]
    .sort((left, right) => {
      if (left.key === null) return 1;
      if (right.key === null) return -1;
      return right.key - left.key;
    })
    .map((group) => ({
      key: group.key,
      label: group.key === null ? "年份未知" : `${group.key}`,
      count: group.count,
      rated: group.ratings.length,
      percent: percent(group.count, total),
      ratedPercent: percent(group.ratings.length, group.count),
      averageRating: average(group.ratings) ?? "—",
    }));

  const ratingBuckets = RATING_BUCKET_DEFINITIONS.map((bucket) => {
    const count = ratings.filter(bucket.test).length;
    return {
      key: bucket.key,
      label: bucket.label,
      shortLabel: bucket.shortLabel,
      className: bucket.className,
      count,
      percent: percent(count, total),
    };
  });
  ratingBuckets.push({
    key: "unrated",
    label: "未评分",
    count: total - ratings.length,
    percent: percent(total - ratings.length, total),
  });

  const ratingFineMap = new Map();
  for (const rating of ratings) {
    const value = round(rating, 1).toFixed(1);
    ratingFineMap.set(value, (ratingFineMap.get(value) ?? 0) + 1);
  }
  const ratingFine = [...ratingFineMap.entries()]
    .sort(([left], [right]) => Number(right) - Number(left))
    .map(([value, count]) => ({
      key: value,
      label: `${value} 分`,
      count,
      percent: percent(count, total),
    }));

  const sourceCounts = new Map();
  let sourcedCount = 0;
  let seasonCount = 0;
  let reviewedCount = 0;
  let notedCount = 0;
  for (const record of records) {
    const sources = Object.keys(record.externalIds ?? {});
    if (sources.length) {
      sourcedCount += 1;
    }
    if (Number.isInteger(record.season?.year)) {
      seasonCount += 1;
    }
    if (String(record.review ?? "").trim()) {
      reviewedCount += 1;
    }
    if (String(record.note ?? "").trim()) {
      notedCount += 1;
    }
    for (const source of sources) {
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }
  const sources = [...sourceCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({
      key,
      label: SOURCE_LABELS[key] ?? key,
      count,
      percent: percent(count, total),
    }));

  const ratedDecades = decades
    .filter((entry) => entry.key !== null && entry.averageRating !== "—")
    .sort((left, right) => right.averageRating - left.averageRating);

  const pieSegments = withPieSegments(years);
  const decadePieSegments = withPieSegments(decades);
  const ratingPieSegments = withPieSegments(ratingBuckets);
  const months = monthSeries(records, now);
  const days = currentMonthSeries(records, now);
  const weeks = weekSeries(records, now);
  const activity = activityCalendar(records, now);
  const tagRadar = calculateTagRadar(records, siteConfig);
  const publicCache = calculatePublicCacheCoverage(
    records,
    options.bangumiCacheEntries,
  );
  const tagRatingDeviation = ratingDeviationByTags(
    records,
    siteConfig,
    options.bangumiCacheEntries,
  );
  const ratingByDecade = summarizeRatingBreakdown(
    [...decadesMap.values()]
      .filter((group) => group.ratings.length > 0)
      .sort((left, right) => {
        if (left.key === null) return 1;
        if (right.key === null) return -1;
        return left.key - right.key;
      })
      .map((group) => ({
        ...group,
        label: group.key === null ? "年份未知" : `${group.key} 年代`,
      })),
  );

  return {
    summary: {
      total,
      rated: ratings.length,
      reviewed: reviewedCount,
      noted: notedCount,
      unrated: total - ratings.length,
      averageRating: averageRating === null ? "—" : averageRating.toFixed(1),
      medianRating: median(ratings) === null ? "—" : median(ratings).toFixed(1),
      highestRating: ratings.length ? Math.max(...ratings).toFixed(1) : "—",
      lowestRating: ratings.length ? Math.min(...ratings).toFixed(1) : "—",
      ratedPercent: percent(ratings.length, total),
      reviewedPercent: percent(reviewedCount, total),
      notedPercent: percent(notedCount, total),
      seasonPercent: percent(seasonCount, total),
      sourcePercent: percent(sourcedCount, total),
      publicCache,
      latestMonth: months.at(-1).count,
      latestWeek: activity.lastWeekCount,
    },
    windows: [
      { days: 7, label: "近 7 天", count: windowCount(records, now, 7) },
      { days: 30, label: "近 30 天", count: windowCount(records, now, 30) },
      { days: 365, label: "近一年", count: windowCount(records, now, 365) },
    ],
    days,
    weeks,
    activity,
    months,
    decades,
    years,
    ratings: ratingBuckets,
    ratingFine,
    ratingByDecade,
    ratingByTag: ratingBreakdownByTags(records, siteConfig),
    tagRatingDeviation,
    pieSegments,
    decadePieSegments,
    ratingPieSegments,
    items: records.map((record) => ({
      id: record.id,
      title: record.title,
      rating: record.rating ?? null,
      year: yearFor(record),
      createdAt: record.createdAt,
    })),
    sources,
    bestDecade: ratedDecades[0] ?? null,
    tagRadar,
  };
}

function itemKeys(item) {
  const keys = new Set();
  if (item?.id) {
    keys.add(`id:${item.id}`);
  }
  for (const [source, id] of Object.entries(item?.externalIds ?? {})) {
    if (id) {
      keys.add(`${source}:${id}`);
    }
  }
  return [...keys];
}

function compactItem(item) {
  return {
    id: item.id,
    title: item.title,
    rating: item.rating ?? null,
    coverUrl: item.coverUrl ?? null,
    season: item.season ?? null,
    externalIds: item.externalIds ?? {},
  };
}

function averageRating(items) {
  const values = items
    .map((item) => item.rating)
    .filter((rating) => rating !== null)
    .map(Number);
  return average(values);
}

function comparisonDistribution(items, keyFor, labels) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftRatingOrder = COMPARISON_RATING_ORDER.indexOf(left);
      const rightRatingOrder = COMPARISON_RATING_ORDER.indexOf(right);
      if (leftRatingOrder !== -1 || rightRatingOrder !== -1) {
        return (leftRatingOrder === -1 ? COMPARISON_RATING_ORDER.length : leftRatingOrder) -
          (rightRatingOrder === -1 ? COMPARISON_RATING_ORDER.length : rightRatingOrder);
      }
      if (left === null) return 1;
      if (right === null) return -1;
      return Number(right) - Number(left);
    })
    .map(([key, count]) => ({
      key,
      label: labels(key),
      count,
      percent: percent(count, items.length),
    }));
}

function itemYear(item) {
  const year = Number(item?.season?.year);
  return Number.isInteger(year) && year >= 1900 ? year : null;
}

function itemRatingBucket(item) {
  if (item?.rating === null || item?.rating === undefined) return "unrated";
  const rating = Number(item?.rating);
  if (!Number.isFinite(rating)) return "unrated";
  if (rating < 6) return "0-5.9";
  if (rating < 7) return "6-6.9";
  if (rating < 8) return "7-7.9";
  if (rating < 9) return "8-8.9";
  return "9-10";
}

const COMPARISON_RATING_LABELS = {
  "0-5.9": "0 - 5.9",
  "6-6.9": "6 - 6.9",
  "7-7.9": "7 - 7.9",
  "8-8.9": "8 - 8.9",
  "9-10": "9 - 10",
  unrated: "未评分",
};
const COMPARISON_RATING_ORDER = ["9-10", "8-8.9", "7-7.9", "6-6.9", "0-5.9", "unrated"];

function comparisonProfile(items) {
  const rated = items.filter((item) => item.rating !== null).length;
  return {
    total: items.length,
    rated,
    unrated: items.length - rated,
    ratedPercent: percent(rated, items.length),
    averageRating: averageRating(items),
    years: comparisonDistribution(
      items,
      itemYear,
      (key) => (key === null ? "年份未知" : String(key)),
    ),
    ratings: comparisonDistribution(
      items,
      itemRatingBucket,
      (key) => COMPARISON_RATING_LABELS[key] ?? key,
    ),
  };
}

export function compareLibraries(currentItems, peerItems) {
  const current = (currentItems ?? []).map(compactItem);
  const peer = (peerItems ?? []).map(compactItem);
  const peerByKey = new Map();
  for (const item of peer) {
    for (const key of itemKeys(item)) {
      if (!peerByKey.has(key)) {
        peerByKey.set(key, item);
      }
    }
  }

  const matchedPeerIds = new Set();
  const shared = [];
  const currentOnly = [];
  for (const item of current) {
    const match = itemKeys(item)
      .map((key) => peerByKey.get(key))
      .find((candidate) => candidate && !matchedPeerIds.has(candidate.id));
    if (!match) {
      currentOnly.push(item);
      continue;
    }
    matchedPeerIds.add(match.id);
    const ratingDifference =
      item.rating !== null && match.rating !== null
        ? round(Number(item.rating) - Number(match.rating))
        : null;
    shared.push({
      id: item.id,
      peerId: match.id,
      title: item.title,
      season: item.season,
      currentRating: item.rating,
      peerRating: match.rating,
      ratingDifference,
    });
  }
  const peerOnly = peer.filter((item) => !matchedPeerIds.has(item.id));
  const unionSize = current.length + peerOnly.length;
  const ratingDifferences = shared
    .filter((item) => item.ratingDifference !== null)
    .sort(
      (left, right) =>
        Math.abs(right.ratingDifference) - Math.abs(left.ratingDifference),
    );

  return {
    current: comparisonProfile(current),
    peer: comparisonProfile(peer),
    overlap: {
      count: shared.length,
      percent: percent(shared.length, unionSize),
      currentPercent: percent(shared.length, current.length),
      peerPercent: percent(shared.length, peer.length),
    },
    shared,
    currentOnly: currentOnly.slice(0, 24),
    peerOnly: peerOnly.slice(0, 24),
    ratingDifferences: ratingDifferences.slice(0, 16),
  };
}
