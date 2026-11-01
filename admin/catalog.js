import {
  api,
  getRuntime,
  replaceCatalog,
  refreshRuntimeLibrary,
} from "./runtime.js";
import { TEMPLATE_REPOSITORY } from "./template-updater.js";
import {
  getPaginationState,
  renderPagination,
} from "./pagination.js";
import { createRatingControl } from "./rating-control.js";
import { resolveCatalogCovers } from "./cover-cache.js";
import {
  applyBangumiMetadata,
  collectBangumiTagHeatFromEntries,
  clearBangumiMetadata,
  hasUsableBangumiMetadata,
  importBangumiMetadata,
  isCachedBangumiMetadata,
  markBangumiMetadataPersonal,
  readBangumiMetadata,
  readAllBangumiMetadata,
  readKnownBangumiTags,
  removeBangumiMetadata,
  replaceBangumiMetadataBySource,
  resolveBangumiMetadata,
  resolveAllBangumiMetadata,
  toBangumiCacheEntry,
} from "./bangumi-metadata-cache.js";
import {
  commitPendingDrafts,
  compactCatalogItem,
  pendingCount,
  readPendingDrafts,
  writePendingDrafts,
} from "./draft-store.js";
import { applyAdminAppearance } from "./appearance.js";
import { replaceChildrenSafe } from "./dom.js";
import { normalizeTagRadarConfig } from "../scripts/site-settings.mjs";
import { calculateTagRadar } from "../scripts/insights-data.mjs";

const MAX_BATCH_SIZE = 100;
const MAX_TEMPLATE_LOGS = 40;
const MAX_OPERATION_LOGS = 60;
const LOCAL_APPEARANCE_KEY = "myanimelife.appearance.preferences";

const state = {
  view: "library",
  catalogLoaded: false,
  settingsLoaded: false,
  settingsSection: "site",
  settingsNavigationFrame: null,
  settingsNavigationLockUntil: 0,
  tagAxesPrefilling: false,
  knownTagsLoaded: false,
  knownTagsLoading: false,
  knownTagsPromise: null,
  knownTags: [],
  knownTagQuery: "",
  knownTagsError: "",
  loading: false,
  busy: false,
  settingsBusy: false,
  templateLogs: [],
  operationLogs: [],
  remoteSettings: null,
  templateStatus: null,
  items: [],
  pageItems: [],
  total: 0,
  page: 1,
  pageSize: 30,
  layout: "list",
  query: "",
  years: new Set(),
  ownership: "",
  source: "",
  metadataLoading: false,
  metadataTags: new Set(),
  metadataScoreMin: "",
  metadataScoreMax: "",
  metadataAvailability: "all",
  metadataSort: "default",
  metadataAvailableCount: 0,
  metadataPersonalLoaded: false,
  metadataPersonalLoading: false,
  metadataPersonalCount: 0,
  metadataPersonalSize: 0,
  metadataPersonalUpdatedAt: null,
  metadataPersonalFile: "data/bangumi-cache.jsonl",
  metadataEntries: new Map(),
  metadataIndexedCount: 0,
  metadataBrowserCount: 0,
  metadataLocalCount: 0,
  metadataLocalSize: 0,
  metadataCacheBusy: false,
  metadataCacheAction: "",
  metadataAllLoading: false,
  metadataAllAbortController: null,
  metadataAllProgress: null,
  catalogReplaceLoading: false,
  catalogReplaceProgress: null,
  catalogReplaceStartedAt: 0,
  catalogReplaceLoadedAt: 0,
  metadataStats: {
    total: 0,
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
  },
  facetsLoaded: false,
  selectedItems: new Map(),
  drafts: new Map(),
  dirty: false,
};

const elements = {
  switchButtons: [...document.querySelectorAll("[data-view]")],
  libraryWorkspace: document.querySelector("#libraryWorkspace"),
  catalogWorkspace: document.querySelector("#catalogWorkspace"),
  duplicateWorkspace: document.querySelector("#duplicateWorkspace"),
  settingsWorkspace: document.querySelector("#settingsWorkspace"),
  aboutWorkspace: document.querySelector("#aboutWorkspace"),
  catalogSearch: document.querySelector("#catalogSearch"),
  catalogYearFilter: document.querySelector("#catalogYearFilter"),
  catalogYearPanel: document.querySelector("#catalogYearPanel"),
  catalogYearSummary: document.querySelector("#catalogYearSummary"),
  catalogYearOptions: document.querySelector("#catalogYearOptions"),
  catalogYearClear: document.querySelector("#catalogYearClear"),
  catalogYearClose: document.querySelector("#catalogYearClose"),
  catalogOwnership: document.querySelector("#catalogOwnership"),
  catalogSource: document.querySelector("#catalogSource"),
  catalogRefresh: document.querySelector("#catalogRefresh"),
  catalogIndexProgress: document.querySelector("#catalogIndexProgress"),
  catalogIndexProgressLabel: document.querySelector(
    "#catalogIndexProgressLabel",
  ),
  catalogMetadataScoreMin: document.querySelector("#catalogMetadataScoreMin"),
  catalogMetadataScoreMax: document.querySelector("#catalogMetadataScoreMax"),
  catalogMetadataAvailability: document.querySelector(
    "#catalogMetadataAvailability",
  ),
  catalogMetadataSort: document.querySelector("#catalogMetadataSort"),
  catalogMetadataRefresh: document.querySelector("#catalogMetadataRefresh"),
  catalogMetadataStatus: document.querySelector("#catalogMetadataStatus"),
  catalogMetadataPersonalBadge: document.querySelector(
    "#catalogMetadataPersonalBadge",
  ),
  catalogMetadataCacheBadge: document.querySelector(
    "#catalogMetadataCacheBadge",
  ),
  catalogMetadataTotalCount: document.querySelector(
    "#catalogMetadataTotalCount",
  ),
  catalogMetadataCacheCount: document.querySelector(
    "#catalogMetadataCacheCount",
  ),
  catalogMetadataLocalCount: document.querySelector(
    "#catalogMetadataLocalCount",
  ),
  catalogMetadataScoreCount: document.querySelector(
    "#catalogMetadataScoreCount",
  ),
  catalogMetadataTagCount: document.querySelector(
    "#catalogMetadataTagCount",
  ),
  catalogMetadataMissingCount: document.querySelector(
    "#catalogMetadataMissingCount",
  ),
  catalogMetadataPersonalCount: document.querySelector(
    "#catalogMetadataPersonalCount",
  ),
  catalogMetadataLocalSize: document.querySelector(
    "#catalogMetadataLocalSize",
  ),
  catalogMetadataPersonalUpdatedAt: document.querySelector(
    "#catalogMetadataPersonalUpdatedAt",
  ),
  catalogMetadataPersonalFile: document.querySelector(
    "#catalogMetadataPersonalFile",
  ),
  catalogMetadataReload: document.querySelector("#catalogMetadataReload"),
  catalogMetadataSavePage: document.querySelector(
    "#catalogMetadataSavePage",
  ),
  catalogMetadataSyncAll: document.querySelector(
    "#catalogMetadataSyncAll",
  ),
  catalogMetadataFetchAll: document.querySelector("#catalogMetadataFetchAll"),
  catalogMetadataCancelAll: document.querySelector("#catalogMetadataCancelAll"),
  catalogMetadataSaveAll: document.querySelector("#catalogMetadataSaveAll"),
  catalogMetadataProgress: document.querySelector("#catalogMetadataProgress"),
  catalogMetadataProgressLabel: document.querySelector(
    "#catalogMetadataProgressLabel",
  ),
  catalogMetadataRemovePage: document.querySelector(
    "#catalogMetadataRemovePage",
  ),
  catalogMetadataClearLocal: document.querySelector(
    "#catalogMetadataClearLocal",
  ),
  catalogMetadataClearPersonal: document.querySelector(
    "#catalogMetadataClearPersonal",
  ),
  catalogCacheManager: document.querySelector(
    ".catalog-cache-manager",
  ),
  catalogMetadataManagerStatus: document.querySelector(
    "#catalogMetadataManagerStatus",
  ),
  catalogTagFilter: document.querySelector("#catalogTagFilter"),
  catalogTagPanel: document.querySelector("#catalogTagPanel"),
  catalogTagSummary: document.querySelector("#catalogTagSummary"),
  catalogTagOptions: document.querySelector("#catalogTagOptions"),
  catalogTagClear: document.querySelector("#catalogTagClear"),
  catalogTagClose: document.querySelector("#catalogTagClose"),
  catalogRows: document.querySelector("#catalogRows"),
  catalogTable: document.querySelector("#catalogTable"),
  catalogCards: document.querySelector("#catalogCards"),
  catalogCount: document.querySelector("#catalogCount"),
  catalogStatus: document.querySelector("#catalogStatus"),
  catalogSourceSummary: document.querySelector("#catalogSourceSummary"),
  catalogSourceVersion: document.querySelector("#catalogSourceVersion"),
  catalogSourceCheckedAt: document.querySelector("#catalogSourceCheckedAt"),
  catalogSourceLicense: document.querySelector("#catalogSourceLicense"),
  catalogResultLabel: document.querySelector("#catalogResultLabel"),
  catalogSelectionLabel: document.querySelector("#catalogSelectionLabel"),
  catalogClearSelection: document.querySelector("#catalogClearSelection"),
  catalogSelectAll: document.querySelector("#catalogSelectAll"),
  catalogEmpty: document.querySelector("#catalogEmpty"),
  catalogEmptyTitle: document.querySelector("#catalogEmptyTitle"),
  catalogEmptyText: document.querySelector("#catalogEmptyText"),
  catalogPagination: document.querySelector("#catalogPagination"),
  catalogPageSummary: document.querySelector("#catalogPageSummary"),
  catalogPageButtons: document.querySelector("#catalogPageButtons"),
  catalogPageSize: document.querySelector("#catalogPageSize"),
  catalogPageSizeCustom: document.querySelector("#catalogPageSizeCustom"),
  catalogPreviousPage: document.querySelector("#catalogPreviousPage"),
  catalogNextPage: document.querySelector("#catalogNextPage"),
  catalogEditorEmpty: document.querySelector("#catalogEditorEmpty"),
  catalogBatchForm: document.querySelector("#catalogBatchForm"),
  catalogSelectionBadge: document.querySelector("#catalogSelectionBadge"),
  catalogSelectionList: document.querySelector("#catalogSelectionList"),
  catalogSaveButton: document.querySelector("#catalogSaveButton"),
  catalogSyncButton: document.querySelector("#catalogSyncButton"),
  catalogOperationLogPanel: document.querySelector(
    "#catalogOperationLogPanel",
  ),
  catalogOperationLogSummary: document.querySelector(
    "#catalogOperationLogSummary",
  ),
  catalogOperationLogClear: document.querySelector(
    "#catalogOperationLogClear",
  ),
  catalogOperationLogList: document.querySelector(
    "#catalogOperationLogList",
  ),
  toast: document.querySelector("#toast"),
  templateUpdateBadge: document.querySelector("#templateUpdateBadge"),
  templateRepositoryLink: document.querySelector("#templateRepositoryLink"),
  aboutTargetRepository: document.querySelector("#aboutTargetRepository"),
  aboutTargetCommit: document.querySelector("#aboutTargetCommit"),
  templateCommitLabel: document.querySelector("#templateCommitLabel"),
  templateCommitMessage: document.querySelector("#templateCommitMessage"),
  templateCommitMeta: document.querySelector("#templateCommitMeta"),
  templateCommitLink: document.querySelector("#templateCommitLink"),
  templateLastUpdate: document.querySelector("#templateLastUpdate"),
  templateUpdateAvailable: document.querySelector("#templateUpdateAvailable"),
  templateUpdateAvailableText: document.querySelector("#templateUpdateAvailableText"),
  templateUpdateStatus: document.querySelector("#templateUpdateStatus"),
  templateUpdateLogPanel: document.querySelector("#templateUpdateLogPanel"),
  templateUpdateLogList: document.querySelector("#templateUpdateLogList"),
  templateUpdateLogSummary: document.querySelector("#templateUpdateLogSummary"),
  templateUpdateLogClear: document.querySelector("#templateUpdateLogClear"),
  templateCheckButton: document.querySelector("#templateCheckButton"),
  templateUpdateButton: document.querySelector("#templateUpdateButton"),
  siteSettingsForm: document.querySelector("#siteSettingsForm"),
  settingsWriteBadge: document.querySelector("#settingsWriteBadge"),
  settingsStatus: document.querySelector("#settingsStatus"),
  siteSettingsSave: document.querySelector("#siteSettingsSave"),
  siteTitleInput: document.querySelector("#siteTitleInput"),
  siteBrandInput: document.querySelector("#siteBrandInput"),
  siteDescriptionInput: document.querySelector("#siteDescriptionInput"),
  siteFooterInput: document.querySelector("#siteFooterInput"),
  displayTemplateInputs: [
    ...document.querySelectorAll('input[name="displayTemplate"]'),
  ],
  shareTemplateInputs: [
    ...document.querySelectorAll('input[name="shareTemplate"]'),
  ],
  shareAccentInputs: [
    ...document.querySelectorAll('input[name="shareAccent"]'),
  ],
  tagRadarEnabled: document.querySelector("#tagRadarEnabled"),
  tagRadarMode: document.querySelector("#tagRadarMode"),
  tagRadarMaxAxes: document.querySelector("#tagRadarMaxAxes"),
  tagRadarAxes: document.querySelector("#tagRadarAxes"),
  tagManualEditor: document.querySelector("#tagManualEditor"),
  tagSelectedAxes: document.querySelector("#tagSelectedAxes"),
  tagSelectionSummary: document.querySelector("#tagSelectionSummary"),
  tagSelectionEmpty: document.querySelector("#tagSelectionEmpty"),
  tagKnownSearch: document.querySelector("#tagKnownSearch"),
  tagKnownCatalog: document.querySelector("#tagKnownCatalog"),
  tagKnownStatus: document.querySelector("#tagKnownStatus"),
  tagPoolSummary: document.querySelector("#tagPoolSummary"),
  tagCustomInput: document.querySelector("#tagCustomInput"),
  tagCustomAdd: document.querySelector("#tagCustomAdd"),
  tagRadarExcludedTags: document.querySelector("#tagRadarExcludedTags"),
  tagRadarAliasGroups: document.querySelector("#tagRadarAliasGroups"),
  settingsNav: [...document.querySelectorAll("[data-settings-nav]")],
  settingsSections: [
    ...document.querySelectorAll("[data-settings-section]"),
  ],
  settingsActions: document.querySelector("#settingsActions"),
  localAppearanceBadge: document.querySelector("#localAppearanceBadge"),
  localAppearanceStatus: document.querySelector("#localAppearanceStatus"),
  siteSettingsLocalSave: document.querySelector("#siteSettingsLocalSave"),
  siteSettingsLocalClear: document.querySelector("#siteSettingsLocalClear"),
};

let searchTimer = null;
let toastTimer = null;
let requestSequence = 0;
let templateBusy = false;
let personalCachePromise = null;
let personalCacheSequence = 0;

function catalogFilterPanel(filter) {
  if (filter === elements.catalogYearFilter) {
    return elements.catalogYearPanel;
  }
  if (filter === elements.catalogTagFilter) {
    return elements.catalogTagPanel;
  }
  return null;
}

function openCatalogFilter(filter) {
  const panel = catalogFilterPanel(filter);
  if (!filter || !panel) {
    return;
  }
  const otherFilter =
    filter === elements.catalogYearFilter
      ? elements.catalogTagFilter
      : elements.catalogYearFilter;
  const otherPanel = catalogFilterPanel(otherFilter);
  if (otherFilter && otherPanel) {
    otherFilter.setAttribute("aria-expanded", "false");
    otherPanel.hidden = true;
  }
  filter.setAttribute("aria-expanded", "true");
  panel.hidden = false;
}

function closeCatalogFilter(filter) {
  const panel = catalogFilterPanel(filter);
  if (!filter || !panel || panel.hidden) {
    return;
  }
  filter.setAttribute("aria-expanded", "false");
  panel.hidden = true;
  filter.focus();
}

function toggleCatalogFilter(filter) {
  const panel = catalogFilterPanel(filter);
  if (!filter || !panel) {
    return;
  }
  if (panel.hidden) {
    openCatalogFilter(filter);
  } else {
    closeCatalogFilter(filter);
  }
}

function showToast(message, options = {}) {
  if (!elements.toast) {
    return;
  }
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", Boolean(options.error));
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(
    () => elements.toast.classList.remove("is-visible"),
    options.duration ?? 3600,
  );
}

function formatTemplateLogTime(value = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function renderTemplateLogs() {
  if (!elements.templateUpdateLogPanel) {
    return;
  }
  elements.templateUpdateLogPanel.hidden = state.templateLogs.length === 0;
  const rows = state.templateLogs.map((entry) => {
    const item = document.createElement("li");
    item.classList.toggle("is-success", entry.tone === "success");
    item.classList.toggle("is-warning", entry.tone === "warning");
    item.classList.toggle("is-error", entry.tone === "error");
    const time = document.createElement("time");
    time.dateTime = entry.at;
    time.textContent = entry.time;
    const message = document.createElement("span");
    message.textContent = entry.message;
    item.append(time, message);
    return item;
  });
  replaceChildrenSafe(
    "更新日志",
    elements.templateUpdateLogList,
    ...rows,
  );
  if (elements.templateUpdateLogList) {
    elements.templateUpdateLogList.scrollTop =
      elements.templateUpdateLogList.scrollHeight;
  }
}

function appendTemplateLog(message, tone = "info") {
  const text = String(message ?? "").replace(/\s+/gu, " ").trim();
  if (!text) {
    return;
  }
  const now = new Date();
  state.templateLogs.push({
    at: now.toISOString(),
    time: formatTemplateLogTime(now),
    message: text,
    tone,
  });
  state.templateLogs = state.templateLogs.slice(-MAX_TEMPLATE_LOGS);
  if (elements.templateUpdateLogSummary) {
    elements.templateUpdateLogSummary.textContent = text;
  }
  renderTemplateLogs();
}

function clearTemplateLogs(summary = "等待操作") {
  state.templateLogs = [];
  if (elements.templateUpdateLogSummary) {
    elements.templateUpdateLogSummary.textContent = summary;
  }
  renderTemplateLogs();
}

function renderOperationLogs() {
  if (!elements.catalogOperationLogPanel) {
    return;
  }
  elements.catalogOperationLogPanel.hidden = state.operationLogs.length === 0;
  const rows = state.operationLogs.map((entry) => {
    const item = document.createElement("li");
    item.classList.toggle("is-success", entry.tone === "success");
    item.classList.toggle("is-warning", entry.tone === "warning");
    item.classList.toggle("is-error", entry.tone === "error");
    const time = document.createElement("time");
    time.dateTime = entry.at;
    time.textContent = entry.time;
    const message = document.createElement("span");
    message.textContent = entry.message;
    item.append(time, message);
    return item;
  });
  replaceChildrenSafe(
    "记录操作日志",
    elements.catalogOperationLogList,
    ...rows,
  );
  if (elements.catalogOperationLogList) {
    elements.catalogOperationLogList.scrollTop =
      elements.catalogOperationLogList.scrollHeight;
  }
}

function appendOperationLog(message, tone = "info") {
  const text = String(message ?? "").replace(/\s+/gu, " ").trim();
  if (!text) {
    return;
  }
  const now = new Date();
  state.operationLogs.push({
    at: now.toISOString(),
    time: formatTemplateLogTime(now),
    message: text,
    tone,
  });
  state.operationLogs = state.operationLogs.slice(-MAX_OPERATION_LOGS);
  if (elements.catalogOperationLogSummary) {
    elements.catalogOperationLogSummary.textContent = text;
  }
  renderOperationLogs();
}

function clearOperationLogs(summary = "等待操作") {
  state.operationLogs = [];
  if (elements.catalogOperationLogSummary) {
    elements.catalogOperationLogSummary.textContent = summary;
  }
  renderOperationLogs();
}

function setTemplateStatus(message, tone = "") {
  elements.templateUpdateStatus?.classList.toggle("is-error", tone === "error");
  elements.templateUpdateStatus?.classList.toggle(
    "is-success",
    tone === "success",
  );
  if (elements.templateUpdateStatus) {
    elements.templateUpdateStatus.textContent = message;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function setSettingsStatus(message, tone = "") {
  elements.settingsStatus.textContent = message;
  elements.settingsStatus.classList.toggle("is-error", tone === "error");
  elements.settingsStatus.classList.toggle("is-success", tone === "success");
}

function readLocalAppearance() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_APPEARANCE_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function setLocalAppearanceStatus(message, tone = "") {
  elements.localAppearanceStatus.textContent = message;
  elements.localAppearanceStatus.classList.toggle("is-error", tone === "error");
  elements.localAppearanceStatus.classList.toggle("is-success", tone === "success");
}

function tagListText(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function aliasGroupsText(value) {
  return Array.isArray(value)
    ? value.map((group) => (Array.isArray(group) ? group.join("=") : "")).join("\n")
    : "";
}

function readTagList(value) {
  return [...new Set(
    String(value ?? "")
      .split(/[\n,，、]+/u)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function readAliasGroups(value) {
  return String(value ?? "")
    .split(/\n+/u)
    .map((line) =>
      [...new Set(
        line
          .split(/[=＝/]+/u)
          .map((item) => item.trim())
          .filter(Boolean),
      )],
    )
    .filter((group) => group.length >= 2);
}

function readTagRadarForm() {
  return normalizeTagRadarConfig({
    enabled: elements.tagRadarEnabled.checked,
    mode: elements.tagRadarMode.value,
    maxAxes: elements.tagRadarMaxAxes.value,
    axes: readTagList(elements.tagRadarAxes.value),
    excludedTags: readTagList(elements.tagRadarExcludedTags.value),
    aliasGroups: readAliasGroups(elements.tagRadarAliasGroups.value),
  });
}

function renderTagRadarSettings(value) {
  const radar = normalizeTagRadarConfig(value);
  elements.tagRadarEnabled.checked = radar.enabled;
  elements.tagRadarMode.value = radar.mode;
  elements.tagRadarMaxAxes.value = String(radar.maxAxes);
  setTagAxes(radar.axes);
  elements.tagRadarExcludedTags.value = tagListText(radar.excludedTags);
  elements.tagRadarAliasGroups.value = aliasGroupsText(radar.aliasGroups);
  syncTagRadarControls();
}

function tagKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

function readTagAxes() {
  return readTagList(elements.tagRadarAxes.value);
}

function tagAxesLimit() {
  const value = Number(elements.tagRadarMaxAxes.value);
  return Number.isInteger(value) && value >= 3 && value <= 12 ? value : 8;
}

function setTagAxes(values) {
  const seen = new Set();
  const axes = [];
  for (const value of values ?? []) {
    const name = String(value ?? "").trim().slice(0, 40);
    const key = tagKey(name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    axes.push(name);
    if (axes.length >= tagAxesLimit()) {
      break;
    }
  }
  elements.tagRadarAxes.value = tagListText(axes);
  renderSelectedTagAxes();
  renderKnownTagCatalog();
}

function knownTagByName(value) {
  const key = tagKey(value);
  return state.knownTags.find((tag) => tagKey(tag.name) === key) ?? null;
}

function resolveManualTagName(value) {
  const sourceName = String(value ?? "").trim().slice(0, 40);
  if (!sourceName) {
    return null;
  }
  const sourceKey = tagKey(sourceName);
  let aliasName = "";
  for (const group of readAliasGroups(elements.tagRadarAliasGroups.value)) {
    if (!group.some((name) => tagKey(name) === sourceKey)) {
      continue;
    }
    aliasName = group.at(-1);
    break;
  }
  const resolvedKnown = knownTagByName(aliasName || sourceName);
  const name = resolvedKnown?.name || aliasName || sourceName;
  return {
    key: tagKey(name),
    name,
    known: resolvedKnown,
  };
}

function renderSelectedTagAxes() {
  const axes = readTagAxes();
  const limit = tagAxesLimit();
  elements.tagSelectionSummary.textContent = `${axes.length} / ${limit}`;
  elements.tagSelectionEmpty.hidden = axes.length > 0;
  const rows = axes.map((name, index) => {
    const row = document.createElement("div");
    row.className = "tag-axis-chip";

    const order = document.createElement("span");
    order.className = "tag-axis-order";
    order.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("span");
    copy.className = "tag-axis-copy";
    const label = document.createElement("strong");
    label.textContent = name;
    const detail = document.createElement("small");
    const known = knownTagByName(name);
    detail.textContent = known
      ? `${formatTagHeat(known.heat)} 热度`
      : "自定义标签";
    copy.append(label, detail);

    const actions = document.createElement("span");
    actions.className = "tag-axis-actions";
    for (const [action, symbol, title] of [
      ["up", "↑", "前移"],
      ["down", "↓", "后移"],
      ["remove", "×", "移除"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.tagAxisAction = action;
      button.dataset.tagIndex = String(index);
      button.textContent = symbol;
      button.title = `${title} ${name}`;
      button.setAttribute("aria-label", `${title} ${name}`);
      button.disabled =
        state.settingsBusy ||
        !getRuntime().writable ||
        (action === "up" && index === 0) ||
        (action === "down" && index === axes.length - 1);
      actions.append(button);
    }
    row.append(order, copy, actions);
    return row;
  });
  elements.tagSelectedAxes.replaceChildren(...rows);
}

function formatTagHeat(value) {
  const count = Math.max(0, Math.trunc(Number(value) || 0));
  if (count >= 10000) {
    return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)} 万`;
  }
  return count.toLocaleString("zh-CN");
}

function renderKnownTagCatalog() {
  if (!elements.tagKnownCatalog) {
    return;
  }
  const locked = state.settingsBusy || !getRuntime().writable;
  const axes = readTagAxes();
  const selected = new Set(axes.map(tagKey));
  const query = tagKey(state.knownTagQuery);
  const available = state.knownTags.filter(
    (tag) => !selected.has(tagKey(tag.name)),
  );
  const matches = available.filter(
    (tag) => !query || tagKey(tag.name).includes(query),
  );
  const visible = matches.slice(0, 80);
  const buttons = visible.map((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "known-tag-chip";
    button.dataset.knownTag = tag.name;
    button.title = `添加 ${tag.name}`;
    button.disabled = locked || axes.length >= tagAxesLimit();

    const copy = document.createElement("span");
    copy.className = "known-tag-copy";
    const name = document.createElement("strong");
    name.textContent = tag.name;
    const heat = document.createElement("small");
    heat.textContent = `${formatTagHeat(tag.heat)} 热度 · ${tag.subjectCount} 部`;
    copy.append(name, heat);

    const add = document.createElement("span");
    add.className = "known-tag-add";
    add.textContent = "+";
    add.setAttribute("aria-hidden", "true");
    button.append(copy, add);
    return button;
  });
  elements.tagKnownCatalog.replaceChildren(...buttons);
  elements.tagPoolSummary.textContent =
    `${available.length} 个未选标签 · 已选 ${axes.length} / ${tagAxesLimit()}`;

  if (state.knownTagsLoading) {
    elements.tagKnownStatus.textContent = "正在读取公共标签热度...";
  } else if (state.knownTagsError) {
    elements.tagKnownStatus.textContent =
      `标签索引读取失败：${state.knownTagsError}`;
  } else if (!state.knownTagsLoaded) {
    elements.tagKnownStatus.textContent =
      "标签池依赖本机公共 Bangumi 缓存；请先在全量索引中获取公共数据。";
  } else if (!state.knownTags.length) {
    elements.tagKnownStatus.textContent =
      "本机公共缓存中暂时没有可用标签；请先获取全量公共数据。";
  } else if (!available.length) {
    elements.tagKnownStatus.textContent =
      "已选完当前公共索引中的全部标签；仍可在下方添加自定义标签。";
  } else if (!matches.length) {
    elements.tagKnownStatus.textContent =
      "未选标签池中没有匹配项，可将输入内容作为自定义标签加入。";
  } else {
    elements.tagKnownStatus.textContent =
      matches.length > visible.length
        ? `显示热度最高的 ${visible.length} 个，共 ${matches.length} 个匹配项；继续输入可缩小范围。`
        : `共 ${matches.length} 个未选标签，按公共标签热度排序。`;
  }
}

async function loadKnownTagCatalog() {
  if (state.knownTagsLoaded || state.knownTagsPromise) {
    return state.knownTagsPromise;
  }
  state.knownTagsLoading = true;
  state.knownTagsError = "";
  renderKnownTagCatalog();
  const request = readKnownBangumiTags({ allowSnapshot: false })
    .then((tags) => {
      state.knownTags = Array.isArray(tags) ? tags : [];
      state.knownTagsLoaded = true;
      state.knownTagsError = "";
      return state.knownTags;
    })
    .catch((error) => {
      state.knownTags = [];
      state.knownTagsError = error.message || "未知错误";
      return [];
    })
    .finally(() => {
      state.knownTagsLoading = false;
      state.knownTagsPromise = null;
      renderKnownTagCatalog();
    });
  state.knownTagsPromise = request;
  return request;
}

function syncTagRadarControls() {
  const locked = state.settingsBusy || !getRuntime().writable;
  const enabled = elements.tagRadarEnabled.checked && !locked;
  const manual = elements.tagRadarEnabled.checked &&
    elements.tagRadarMode.value === "manual";
  elements.tagRadarMode.disabled = !enabled;
  elements.tagRadarMaxAxes.disabled = !enabled;
  elements.tagRadarExcludedTags.disabled = !enabled;
  elements.tagRadarAliasGroups.disabled = !enabled;
  elements.tagRadarAxes.disabled = !enabled || !manual;
  elements.tagManualEditor.hidden = !manual;
  elements.tagKnownSearch.disabled = locked || !manual;
  elements.tagCustomInput.disabled = locked || !manual;
  elements.tagCustomAdd.disabled = locked || !manual;
  renderSelectedTagAxes();
  renderKnownTagCatalog();
  if (manual) {
    void loadKnownTagCatalog();
  }
}

function settingsSectionByName(sectionName) {
  return elements.settingsSections.find(
    (candidate) => candidate.dataset.settingsSection === sectionName,
  ) ?? null;
}

function setActiveSettingsSection(sectionName) {
  state.settingsSection = sectionName;
  for (const link of elements.settingsNav) {
    const active = link.dataset.settingsNav === sectionName;
    link.classList.toggle("is-active", active);
    if (active) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

function settingsScrollOffset() {
  const topbarHeight =
    document.querySelector(".topbar")?.getBoundingClientRect().height ?? 72;
  const mobile = window.matchMedia("(max-width: 900px)").matches;
  const navigationOffset = mobile
    ? elements.settingsNav.getBoundingClientRect().height + 12
    : 26;
  return topbarHeight + navigationOffset;
}

function updateSettingsNavigation() {
  if (state.view !== "settings" || !elements.settingsSections.length) {
    return;
  }
  if (Date.now() < state.settingsNavigationLockUntil) {
    return;
  }
  const threshold = settingsScrollOffset() + 4;
  let active = elements.settingsSections[0];
  for (const section of elements.settingsSections) {
    if (section.getBoundingClientRect().top <= threshold) {
      active = section;
    } else {
      break;
    }
  }
  if (
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 2
  ) {
    active = elements.settingsSections.at(-1);
  }
  setActiveSettingsSection(active.dataset.settingsSection);
}

function scheduleSettingsNavigationUpdate() {
  if (state.settingsNavigationFrame) {
    return;
  }
  state.settingsNavigationFrame = window.requestAnimationFrame(() => {
    state.settingsNavigationFrame = null;
    updateSettingsNavigation();
  });
}

function scrollToSettingsSection(sectionName, options = {}) {
  const section = settingsSectionByName(sectionName);
  if (!section) {
    return;
  }
  const top =
    section.getBoundingClientRect().top +
    window.scrollY -
    settingsScrollOffset();
  window.scrollTo({
    top: Math.max(0, top),
    behavior: options.instant ? "auto" : "smooth",
  });
  state.settingsNavigationLockUntil =
    Date.now() + (options.instant ? 300 : 1200);
  setActiveSettingsSection(sectionName);
  if (sectionName === "tags") {
    void loadKnownTagCatalog();
  }
}

function metaEntriesById(entries) {
  return new Map(
    (entries ?? [])
      .map((entry) => [String(entry?.subjectId ?? ""), entry])
      .filter(([subjectId]) => subjectId),
  );
}

function recordSubjectId(record) {
  return String(
    record?.externalIds?.bangumi ??
      record?.sites?.bangumi ??
      "",
  ).trim();
}

async function automaticTagAxisNames() {
  const [libraryResult, cacheResult, localResult] = await Promise.allSettled([
    api("/api/library"),
    api("/api/bangumi-cache"),
    readAllBangumiMetadata(),
  ]);
  if (libraryResult.status === "rejected") {
    throw libraryResult.reason;
  }

  const metadataById = metaEntriesById(
    localResult.status === "fulfilled" ? localResult.value : [],
  );
  if (cacheResult.status === "fulfilled") {
    for (const [subjectId, entry] of metaEntriesById(
      cacheResult.value?.entries,
    )) {
      metadataById.set(subjectId, entry);
    }
  }
  for (const [subjectId, entry] of state.metadataEntries) {
    metadataById.set(subjectId, entry);
  }

  const records = (libraryResult.value?.records ?? []).map((record) => {
    const subjectId = recordSubjectId(record);
    return {
      ...record,
      publicTags: metadataById.get(subjectId)?.tags ?? [],
    };
  });
  const config = readTagRadarForm();
  const radar = calculateTagRadar(records, {
    insights: {
      tagRadar: {
        ...config,
        mode: "auto",
        axes: [],
      },
    },
  });
  return radar.axes.map((axis) => axis.label);
}

async function prefillManualTagAxesFromAutomatic() {
  if (
    state.tagAxesPrefilling ||
    elements.tagRadarMode.value !== "manual" ||
    readTagAxes().length
  ) {
    return;
  }
  state.tagAxesPrefilling = true;
  elements.tagKnownStatus.textContent =
    "正在根据当前番剧与 Bangumi 标签缓存生成手动轴...";
  elements.tagKnownStatus.setAttribute("aria-busy", "true");
  try {
    const axes = await automaticTagAxisNames();
    if (
      elements.tagRadarMode.value !== "manual" ||
      readTagAxes().length
    ) {
      return;
    }
    if (!axes.length) {
      elements.tagKnownStatus.textContent =
        "当前番剧还没有可用于自动填充的 Bangumi 标签缓存。";
      return;
    }
    setTagAxes(axes);
    applyAppearanceFromForm();
    showToast(`已从自动模式填入 ${axes.length} 个标签轴`);
  } catch (error) {
    elements.tagKnownStatus.textContent =
      `自动标签填充失败：${error.message}`;
  } finally {
    state.tagAxesPrefilling = false;
    elements.tagKnownStatus.removeAttribute("aria-busy");
  }
}

function activateSettingsSection(sectionName, options = {}) {
  const section = settingsSectionByName(sectionName);
  if (!section) {
    return;
  }

  setActiveSettingsSection(sectionName);
  if (sectionName === "tags") {
    void loadKnownTagCatalog();
  }
  if (options.scroll) {
    scrollToSettingsSection(sectionName, options);
  } else {
    scheduleSettingsNavigationUpdate();
  }
}

function renderLocalAppearance() {
  const local = readLocalAppearance();
  const active = Boolean(local?.share || local?.insights?.tagRadar);
  elements.localAppearanceBadge.textContent = active ? "已启用" : "未启用";
  elements.localAppearanceBadge.classList.toggle("is-success", active);
  setLocalAppearanceStatus(
    active
      ? `当前分享样式与标签雷达来自本机缓存${local.savedAt ? ` · ${formatDate(local.savedAt)}` : ""}`
      : "当前使用仓库配置。",
    active ? "success" : "",
  );
}

function renderSettingsAccess() {
  const writable = getRuntime().writable;
  const disabled = state.settingsBusy || !writable;
  for (const control of elements.siteSettingsForm.elements) {
    control.disabled = control.dataset.localAppearanceControl === "true"
      ? state.settingsBusy
      : disabled;
  }
  elements.siteSettingsSave.classList.toggle("is-loading", state.settingsBusy);
  elements.siteSettingsSave.textContent =
    getRuntime().mode === "local" ? "保存设置" : "保存并发布";
  elements.settingsWriteBadge.textContent = state.settingsBusy
    ? "正在保存"
    : writable
      ? "可修改"
      : "只读";
  syncTagRadarControls();
}

function selectRadio(inputs, value) {
  for (const input of inputs) {
    input.checked = input.value === value;
  }
}

function shareTemplateOrDefault(value) {
  return ["default", "compact", "spotlight"].includes(value)
    ? value
    : "default";
}

function renderSiteSettings(settings) {
  state.remoteSettings = settings;
  elements.siteTitleInput.value = settings.site?.title ?? "";
  elements.siteBrandInput.value = settings.site?.brand ?? "";
  elements.siteDescriptionInput.value = settings.site?.description ?? "";
  elements.siteFooterInput.value = settings.site?.footer ?? "";
  selectRadio(elements.displayTemplateInputs, settings.template);
  selectRadio(
    elements.shareTemplateInputs,
    shareTemplateOrDefault(settings.share?.template),
  );
  selectRadio(elements.shareAccentInputs, settings.share?.accent ?? "coral");
  renderTagRadarSettings(settings.insights?.tagRadar);
  const local = readLocalAppearance();
  if (local?.share) {
    selectRadio(
      elements.shareTemplateInputs,
      shareTemplateOrDefault(local.share.template ?? settings.share?.template),
    );
    selectRadio(
      elements.shareAccentInputs,
      local.share.accent ?? settings.share?.accent ?? "coral",
    );
  }
  if (local?.insights?.tagRadar) {
    renderTagRadarSettings(local.insights.tagRadar);
  }
  applyAdminAppearance(settings, local);
  state.settingsLoaded = true;
  renderLocalAppearance();
  renderSettingsAccess();
}

function applyAppearanceFromForm() {
  if (!state.remoteSettings) {
    return;
  }
  const settings = {
    ...state.remoteSettings,
    site: {
      ...state.remoteSettings.site,
      title: elements.siteTitleInput.value,
      brand: elements.siteBrandInput.value,
    },
    template:
      elements.displayTemplateInputs.find((input) => input.checked)?.value ??
      state.remoteSettings.template,
    share: {
      ...state.remoteSettings.share,
      template:
        elements.shareTemplateInputs.find((input) => input.checked)?.value ??
        state.remoteSettings.share?.template ??
        "default",
      accent:
        elements.shareAccentInputs.find((input) => input.checked)?.value ??
        state.remoteSettings.share?.accent ??
        "coral",
    },
    insights: {
      ...(state.remoteSettings.insights ?? {}),
      tagRadar: readTagRadarForm(),
    },
  };
  applyAdminAppearance(settings, null);
}

async function loadSiteSettings(options = {}) {
  if (state.settingsBusy || (state.settingsLoaded && !options.force)) {
    return;
  }
  state.settingsBusy = true;
  renderSettingsAccess();
  if (!options.silent) {
    setSettingsStatus("正在读取站点设置...");
  }
  try {
    const settings = await api("/api/settings");
    renderSiteSettings(settings);
    if (!options.silent) {
      setSettingsStatus(writableMessage());
    }
  } catch (error) {
    if (!options.silent) {
      setSettingsStatus(error.message, "error");
    }
  } finally {
    state.settingsBusy = false;
    renderSettingsAccess();
  }
}

function writableMessage() {
  if (!getRuntime().writable) {
    return "填写具有 Contents 读写权限的 Token 后才能保存。";
  }
  return getRuntime().mode === "local"
    ? "保存后写入 config/site.json，可在同步远端时一并提交。"
    : "保存后会提交配置并触发 Pages 重新构建。";
}

function readAppearanceForm() {
  return {
    share: {
      template:
        elements.shareTemplateInputs.find((input) => input.checked)?.value ??
        "default",
      accent:
        elements.shareAccentInputs.find((input) => input.checked)?.value ??
        "coral",
    },
    insights: {
      tagRadar: readTagRadarForm(),
    },
    savedAt: new Date().toISOString(),
  };
}

function saveLocalAppearance() {
  try {
    const appearance = readAppearanceForm();
    localStorage.setItem(LOCAL_APPEARANCE_KEY, JSON.stringify(appearance));
    window.dispatchEvent(
      new CustomEvent("anime-appearance:changed", { detail: appearance }),
    );
    if (state.remoteSettings) {
      applyAdminAppearance(state.remoteSettings, appearance);
    }
    renderLocalAppearance();
    showToast("分享样式已保存到本机");
  } catch {
    setLocalAppearanceStatus("浏览器不允许保存本机缓存。", "error");
    showToast("无法保存本机样式缓存", { error: true });
  }
}

function clearLocalAppearance() {
  try {
    localStorage.removeItem(LOCAL_APPEARANCE_KEY);
    window.dispatchEvent(
      new CustomEvent("anime-appearance:changed", { detail: null }),
    );
    if (state.remoteSettings) {
      selectRadio(
        elements.shareTemplateInputs,
        shareTemplateOrDefault(state.remoteSettings.share?.template),
      );
      selectRadio(
        elements.shareAccentInputs,
        state.remoteSettings.share?.accent ?? "coral",
      );
      renderTagRadarSettings(state.remoteSettings.insights?.tagRadar);
      applyAdminAppearance(state.remoteSettings, null);
    }
    renderLocalAppearance();
    showToast("已清除本机样式缓存");
  } catch {
    setLocalAppearanceStatus("无法清除本机缓存。", "error");
  }
}

async function saveSiteSettings(event) {
  event.preventDefault();
  if (state.settingsBusy || !getRuntime().writable) {
    setSettingsStatus(writableMessage(), getRuntime().writable ? "" : "error");
    return;
  }
  const payload = {
    site: {
      title: elements.siteTitleInput.value,
      brand: elements.siteBrandInput.value,
      description: elements.siteDescriptionInput.value,
      footer: elements.siteFooterInput.value,
    },
    template:
      elements.displayTemplateInputs.find((input) => input.checked)?.value ??
      "default",
    share: {
      template:
        elements.shareTemplateInputs.find((input) => input.checked)?.value ??
        "default",
      accent:
        elements.shareAccentInputs.find((input) => input.checked)?.value ??
        "coral",
    },
    insights: {
      tagRadar: readTagRadarForm(),
    },
  };
  state.settingsBusy = true;
  renderSettingsAccess();
  setSettingsStatus("正在保存站点设置...");
  try {
    const result = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    renderSiteSettings(result.settings);
    setSettingsStatus(
      result.commitShort
        ? `已提交 ${result.commitShort}，Pages 构建完成后生效。`
        : "站点设置已保存。",
      "success",
    );
    showToast(result.commitShort ? `站点设置已提交 ${result.commitShort}` : "站点设置已保存");
  } catch (error) {
    setSettingsStatus(error.message, "error");
    showToast(error.message, { error: true, duration: 7000 });
  } finally {
    state.settingsBusy = false;
    renderSettingsAccess();
  }
}

function seasonText(season) {
  if (season?.label) {
    return season.label;
  }
  if (season?.number) {
    return `第${season.number}季`;
  }
  return "季度未标注";
}

function itemMeta(item) {
  return [
    item.year || "年份未知",
    seasonText(item.season),
    item.sources.map((source) => source.label).join(" / "),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatMetadataCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) {
    return "";
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)} 万`;
  }
  return count.toLocaleString("zh-CN");
}

function formatByteSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bangumiEntryIsStorable(entry) {
  return Boolean(
    Number.isFinite(entry?.score) ||
      entry?.tags?.length ||
      entry?.rank ||
      entry?.summary ||
      entry?.coverUrl,
  );
}

function bangumiEntriesForItems(items = state.pageItems) {
  const entries = new Map();
  for (const item of items) {
    if (!item.bangumiMetadata) {
      continue;
    }
    try {
      const entry = toBangumiCacheEntry(item.bangumiMetadata);
      if (bangumiEntryIsStorable(entry)) {
        entries.set(entry.subjectId, entry);
      }
    } catch {
      // Ignore malformed local records while collecting a cache snapshot.
    }
  }
  return [...entries.values()];
}

function currentPagePersonalBangumiIds(items = state.pageItems) {
  return [
    ...new Set(
      items
        .filter((item) => item.bangumiMetadataSource === "personal")
        .map((item) => String(item.sites?.bangumi ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

function setCacheManagerStatus(message, tone = "") {
  if (!elements.catalogMetadataManagerStatus) {
    return;
  }
  elements.catalogMetadataManagerStatus.textContent = message;
  elements.catalogMetadataManagerStatus.classList.toggle(
    "is-success",
    tone === "success",
  );
  elements.catalogMetadataManagerStatus.classList.toggle(
    "is-error",
    tone === "error",
  );
}

function renderCacheManager() {
  const writable = getRuntime().writable;
  const busy = state.metadataCacheBusy;
  const pageEntries = bangumiEntriesForItems();
  const personalPageIds = currentPagePersonalBangumiIds();
  const baseDisabled =
    busy ||
    state.loading ||
    state.metadataLoading;
  const cacheActionsDisabled =
    baseDisabled || state.metadataPersonalLoading;
  if (elements.catalogMetadataPersonalCount) {
    elements.catalogMetadataPersonalCount.textContent =
      `${state.metadataPersonalCount.toLocaleString("zh-CN")} 条`;
  }
  if (elements.catalogMetadataLocalSize) {
    elements.catalogMetadataLocalSize.textContent =
      `${state.metadataLocalCount.toLocaleString("zh-CN")} 条待同步 · ` +
      formatByteSize(state.metadataLocalSize);
  }
  if (elements.catalogMetadataPersonalUpdatedAt) {
    elements.catalogMetadataPersonalUpdatedAt.textContent =
      state.metadataPersonalUpdatedAt
        ? formatDate(state.metadataPersonalUpdatedAt)
        : "尚未保存";
  }
  if (elements.catalogMetadataPersonalFile) {
    elements.catalogMetadataPersonalFile.textContent =
      state.metadataPersonalFile;
    elements.catalogMetadataPersonalFile.title = state.metadataPersonalFile;
  }
  if (elements.catalogMetadataReload) {
    elements.catalogMetadataReload.disabled = baseDisabled;
    elements.catalogMetadataReload.textContent =
      state.metadataCacheAction === "reload-personal"
        ? "正在装填"
        : "从仓库装填";
    elements.catalogMetadataReload.classList.toggle(
      "is-loading",
      state.metadataCacheAction === "reload-personal",
    );
  }
  if (elements.catalogMetadataSavePage) {
    elements.catalogMetadataSavePage.disabled =
      cacheActionsDisabled || !writable || pageEntries.length === 0;
    elements.catalogMetadataSavePage.textContent =
      state.metadataCacheAction === "save-page"
        ? "正在保存"
        : `保存本页 (${pageEntries.length})`;
    elements.catalogMetadataSavePage.classList.toggle(
      "is-loading",
      state.metadataCacheAction === "save-page",
    );
  }
  if (elements.catalogMetadataSyncAll) {
    elements.catalogMetadataSyncAll.disabled =
      cacheActionsDisabled || !writable || state.metadataLocalCount === 0;
    elements.catalogMetadataSyncAll.textContent =
      state.metadataCacheAction === "sync-all"
        ? "正在合并"
        : `合并本机 (${state.metadataLocalCount})`;
    elements.catalogMetadataSyncAll.classList.toggle(
      "is-loading",
      state.metadataCacheAction === "sync-all",
    );
  }
  if (elements.catalogMetadataFetchAll) {
    elements.catalogMetadataFetchAll.disabled =
      busy || state.metadataAllLoading || state.loading || !state.catalogLoaded;
    elements.catalogMetadataFetchAll.textContent = state.metadataAllLoading
      ? "全量获取中"
      : "获取全量公共数据";
    elements.catalogMetadataFetchAll.classList.toggle(
      "is-loading",
      state.metadataAllLoading,
    );
  }
  if (elements.catalogMetadataCancelAll) {
    elements.catalogMetadataCancelAll.hidden = !state.metadataAllLoading;
    elements.catalogMetadataCancelAll.disabled = !state.metadataAllLoading;
  }
  if (elements.catalogMetadataSaveAll) {
    elements.catalogMetadataSaveAll.disabled =
      cacheActionsDisabled || !writable || state.metadataLocalCount === 0;
    elements.catalogMetadataSaveAll.textContent = state.metadataCacheAction === "sync-all"
      ? "正在保存全量缓存"
      : `保存本机缓存 (${state.metadataLocalCount})`;
  }
  if (elements.catalogMetadataProgress) {
    const progress = state.metadataAllProgress;
    elements.catalogMetadataProgress.hidden = !progress;
    elements.catalogMetadataProgress.max = Math.max(1, progress?.total ?? 1);
    elements.catalogMetadataProgress.value = Math.min(
      progress?.completed ?? 0,
      progress?.total ?? 1,
    );
  }
  if (elements.catalogMetadataProgressLabel) {
    const progress = state.metadataAllProgress;
    elements.catalogMetadataProgressLabel.textContent = progress
      ? `${progress.phaseLabel ?? "准备中"} · ${progress.completed ?? 0}/${progress.total ?? 0}` +
        (progress.speed ? ` · ${progress.speed.toFixed(1)} 条/秒` : "") +
        (progress.failed ? ` · 失败 ${progress.failed}` : "")
      : "全量获取只写入本机缓存，不会自动提交 GitHub。";
  }
  if (elements.catalogMetadataRemovePage) {
    elements.catalogMetadataRemovePage.disabled =
      cacheActionsDisabled || !writable || personalPageIds.length === 0;
    elements.catalogMetadataRemovePage.textContent =
      state.metadataCacheAction === "remove-page"
        ? "正在移除"
        : `移除本页 (${personalPageIds.length})`;
    elements.catalogMetadataRemovePage.classList.toggle(
      "is-loading",
      state.metadataCacheAction === "remove-page",
    );
  }
  if (elements.catalogMetadataClearLocal) {
    elements.catalogMetadataClearLocal.disabled =
      busy || (state.metadataLocalCount === 0 && state.metadataBrowserCount === 0);
  }
  if (elements.catalogMetadataClearPersonal) {
    elements.catalogMetadataClearPersonal.disabled =
      busy || !writable || state.metadataPersonalCount === 0;
  }
  elements.catalogCacheManager?.classList.toggle("is-busy", busy);
  elements.catalogCacheManager?.setAttribute("aria-busy", String(busy));
}

async function fetchAllBangumiMetadata() {
  if (state.metadataAllLoading) return;
  state.metadataAllLoading = true;
  state.metadataAllProgress = {
    phaseLabel: "正在读取全量索引",
    completed: 0,
    total: 0,
    failed: 0,
  };
  state.metadataAllAbortController = new AbortController();
  renderCacheManager();
  try {
    const payload = await api("/api/catalog/bangumi-items");
    const items = payload.items ?? [];
    state.metadataIndexedCount = items.length;
    state.metadataAllProgress = {
      phaseLabel: "正在读取本机缓存",
      completed: 0,
      total: items.length,
      failed: 0,
    };
    renderCacheManager();
    const result = await resolveAllBangumiMetadata(items, {
      signal: state.metadataAllAbortController.signal,
      onProgress(progress) {
        state.metadataAllProgress = {
          ...progress,
          phaseLabel:
            progress.phase === "snapshot"
              ? "正在装填公共快照"
              : progress.phase === "api"
                ? "正在在线补充"
                : progress.phase === "cancelled"
                  ? "已请求停止"
                  : "正在检查本机缓存",
        };
        renderCacheManager();
      },
    });
    await refreshLocalBangumiCacheFacts();
    state.knownTagsLoaded = false;
    state.knownTagsPromise = null;
    void loadKnownTagCatalog();
    if (state.pageItems.length) {
      await applyCachedBangumiMetadata(state.pageItems);
      applyCatalogView({ render: true });
    }
    const message = `全量公共数据完成：缓存 ${result.fetched} 条，失败 ${result.failed} 条；结果已保存在本机。`;
    setCacheManagerStatus(message, result.failed ? "error" : "success");
    showToast(message, { error: Boolean(result.failed), duration: 7000 });
  } catch (error) {
    setCacheManagerStatus(`全量公共数据获取失败：${error.message}`, "error");
    showToast(error.message, { error: true });
  } finally {
    state.metadataAllLoading = false;
    state.metadataAllAbortController = null;
    renderCacheManager();
  }
}

function cancelAllBangumiMetadata() {
  state.metadataAllAbortController?.abort();
  setCacheManagerStatus("正在停止全量公共数据获取；已完成的本机缓存会保留。", "success");
}

async function refreshLocalBangumiCacheFacts() {
  const entries = await readAllBangumiMetadata().catch(() => []);
  const browserEntries = entries.filter((entry) =>
    ["browser", "cache"].includes(entry.storageSource ?? "browser"),
  );
  const pendingEntries = entries.filter((entry) => entry.pendingSync);
  state.metadataEntries = new Map(
    entries.map((entry) => [String(entry.subjectId), entry]),
  );
  state.metadataBrowserCount = browserEntries.length;
  state.metadataLocalCount = pendingEntries.length;
  state.metadataLocalSize = new TextEncoder().encode(
    pendingEntries.map((entry) => JSON.stringify(entry)).join("\n"),
  ).length;
  renderCacheManager();
  return { entries, browserEntries, pendingEntries };
}

function applyPersonalCacheEntries(entries) {
  const metadata = new Map(
    (entries ?? []).map((entry) => [String(entry.subjectId), entry]),
  );
  const matchingItems = state.pageItems.filter((item) =>
    metadata.has(String(item.sites?.bangumi ?? "")),
  );
  applyBangumiMetadata(
    matchingItems,
    metadata,
    new Map([...metadata.keys()].map((subjectId) => [subjectId, "personal"])),
  );
}

function clearItemsFromBangumiCache(subjectIds) {
  const removed = new Set((subjectIds ?? []).map(String));
  for (const item of state.pageItems) {
    const subjectId = String(item.sites?.bangumi ?? "");
    if (!removed.has(subjectId)) {
      continue;
    }
    item.bangumiMetadata = null;
    item.bangumiMetadataResolved = true;
    item.bangumiMetadataSource = null;
  }
}

function applyPersonalCacheResult(result) {
  state.metadataPersonalCount = Number(result.count) || 0;
  state.metadataPersonalSize = Number(result.size) || 0;
  state.metadataPersonalUpdatedAt = result.updatedAt || null;
  state.metadataPersonalFile =
    result.file || state.metadataPersonalFile || "data/bangumi-cache.jsonl";
  applyPersonalCacheEntries(result.entries ?? []);
  renderCacheManager();
}

async function loadPersonalBangumiCache(options = {}) {
  if (state.metadataPersonalLoaded && !options.force) {
    return;
  }
  if (personalCachePromise && !options.force) {
    return personalCachePromise;
  }
  const sequence = ++personalCacheSequence;
  state.metadataPersonalLoading = true;
  renderCacheManager();
  const promise = (async () => {
    setCacheManagerStatus("正在读取个人仓库中的 Bangumi 缓存...");
    try {
      const result = await api(
        `/api/bangumi-cache?fresh=1&request=${sequence}-${Date.now()}`,
      );
      if (sequence !== personalCacheSequence) {
        return null;
      }
      applyPersonalCacheResult(result);
      setCacheManagerStatus(
        `已从个人仓库读取 ${state.metadataPersonalCount.toLocaleString("zh-CN")} 条缓存，` +
          "正在同步本机索引...",
      );
      await replaceBangumiMetadataBySource(result.entries ?? [], "personal");
      if (sequence !== personalCacheSequence) {
        return null;
      }
      state.metadataPersonalLoaded = true;
      await refreshLocalBangumiCacheFacts();
      if (sequence !== personalCacheSequence) {
        return null;
      }
      setCacheManagerStatus(
        `已载入 ${state.metadataPersonalCount.toLocaleString("zh-CN")} 条个人缓存；` +
          "新读取的信息会先保存在本机，确认后才写入个人仓库。",
        "success",
      );
    } catch (error) {
      if (sequence !== personalCacheSequence) {
        return null;
      }
      // Avoid retrying the full cache download on every filter change. The
      // explicit reload button still forces a fresh attempt.
      state.metadataPersonalLoaded = true;
      await refreshLocalBangumiCacheFacts();
      setCacheManagerStatus(
        `个人缓存读取失败：${error.message}。本机临时缓存仍可使用。`,
        "error",
      );
      if (options.throwOnError) {
        throw error;
      }
    }
    renderCacheManager();
    return null;
  })();
  personalCachePromise = promise;
  try {
    return await promise;
  } finally {
    if (personalCachePromise === promise) {
      personalCachePromise = null;
    }
    if (sequence === personalCacheSequence) {
      state.metadataPersonalLoading = false;
      renderCacheManager();
    }
  }
}

async function reloadPersonalBangumiCache() {
  await runBangumiCacheAction("reload-personal", async () => {
    setCacheManagerStatus("正在从个人仓库重新装填 Bangumi 缓存...");
    state.metadataPersonalLoaded = false;
    await loadPersonalBangumiCache({
      force: true,
      throwOnError: true,
    });
    await refreshLocalBangumiCacheFacts();
    await loadCatalog();
    const message =
      `已从个人仓库装填 ${state.metadataPersonalCount.toLocaleString("zh-CN")} 条 Bangumi 缓存，` +
      `本机临时缓存 ${state.metadataLocalCount.toLocaleString("zh-CN")} 条待同步。`;
    setCacheManagerStatus(message, "success");
    showToast(message, { duration: 5000 });
  });
}

function bangumiCacheCommitMessage(action, entries) {
  const entryIds = new Set(
    (entries ?? []).map((entry) => String(entry.subjectId ?? "")),
  );
  const titles = state.pageItems
    .filter((item) => entryIds.has(String(item.sites?.bangumi ?? "")))
    .map((item) => item.displayTitle)
    .filter(Boolean)
    .slice(0, 4);
  return [
    `chore(data): ${action} Bangumi personal cache`,
    `(${entries.length} subjects${titles.length ? `: ${titles.join("、")}` : ""})`,
  ].join(" ");
}

async function runBangumiCacheAction(action, task) {
  if (state.metadataCacheBusy) {
    return null;
  }
  state.metadataCacheBusy = true;
  state.metadataCacheAction = action;
  renderCacheManager();
  try {
    return await task();
  } catch (error) {
    setCacheManagerStatus(error.message, "error");
    showToast(error.message, { error: true, duration: 7000 });
    return null;
  } finally {
    state.metadataCacheBusy = false;
    state.metadataCacheAction = "";
    renderCacheManager();
  }
}

async function savePageBangumiCache() {
  const entries = bangumiEntriesForItems();
  if (!entries.length) {
    showToast("本页没有可保存的 Bangumi 评分或标签", { error: true });
    return;
  }
  await runBangumiCacheAction("save-page", async () => {
    setCacheManagerStatus(
      `正在把本页 ${entries.length.toLocaleString("zh-CN")} 条 Bangumi 信息写入个人仓库...`,
    );
    const result = await api("/api/bangumi-cache", {
      method: "PUT",
      body: JSON.stringify({
        mode: "merge",
        entries,
        message: bangumiCacheCommitMessage("save", entries),
      }),
    });
    await markBangumiMetadataPersonal(result.entries ?? []);
    applyPersonalCacheResult(result);
    await refreshLocalBangumiCacheFacts();
    applyCatalogView({ render: true });
    const message = result.changed
      ? `已保存到个人仓库 ${result.file}` +
        (result.commitShort ? `，提交 ${result.commitShort}` : "")
      : "本页 Bangumi 信息已经是最新，无需重复写入";
    setCacheManagerStatus(message, "success");
    showToast(message, { duration: 5000 });
  });
}

async function mergeLocalBangumiCache() {
  const { pendingEntries } = await refreshLocalBangumiCacheFacts();
  const entries = pendingEntries
    .map((entry) => {
      try {
        return toBangumiCacheEntry(entry);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (!entries.length) {
    setCacheManagerStatus("本机没有待保存的 Bangumi 信息", "success");
    showToast("本机没有待保存的 Bangumi 信息");
    return;
  }
  await runBangumiCacheAction("sync-all", async () => {
    setCacheManagerStatus(
      `正在合并本机 ${entries.length.toLocaleString("zh-CN")} 条 Bangumi 信息...`,
    );
    const result = await api("/api/bangumi-cache", {
      method: "PUT",
      body: JSON.stringify({
        mode: "merge",
        entries,
        message: bangumiCacheCommitMessage("merge local", entries),
      }),
    });
    await markBangumiMetadataPersonal(result.entries ?? []);
    applyPersonalCacheResult(result);
    await refreshLocalBangumiCacheFacts();
    applyCatalogView({ render: true });
    const message = result.changed
      ? `已向个人仓库合并 ${entries.length.toLocaleString("zh-CN")} 条缓存` +
        (result.commitShort ? `，提交 ${result.commitShort}` : "")
      : "个人仓库中已包含这些 Bangumi 信息";
    setCacheManagerStatus(message, "success");
    showToast(message, { duration: 5000 });
  });
}

async function removePageBangumiCache() {
  const subjectIds = currentPagePersonalBangumiIds();
  if (!subjectIds.length) {
    return;
  }
  if (
    !window.confirm(
      `从个人仓库缓存中移除本页 ${subjectIds.length} 个 Bangumi 条目？` +
        "这不会删除你的番剧记录或评价。",
    )
  ) {
    return;
  }
  await runBangumiCacheAction("remove-page", async () => {
    setCacheManagerStatus(
      `正在从个人仓库移除 ${subjectIds.length} 条 Bangumi 缓存...`,
    );
    const result = await api("/api/bangumi-cache", {
      method: "DELETE",
      body: JSON.stringify({ subjectIds }),
    });
    await removeBangumiMetadata(subjectIds);
    clearItemsFromBangumiCache(subjectIds);
    applyPersonalCacheResult(result);
    await refreshLocalBangumiCacheFacts();
    applyCatalogView({ render: true });
    const message = result.changed
      ? `已移除本页 Bangumi 缓存` +
        (result.commitShort ? `，提交 ${result.commitShort}` : "")
      : "个人仓库中原本没有这些 Bangumi 缓存";
    setCacheManagerStatus(message, "success");
    showToast(message);
  });
}

async function clearLocalBangumiCache() {
  if (
    !window.confirm(
      "清空本机临时 Bangumi 信息？尚未保存到个人仓库的读取结果也会一起清除。",
    )
  ) {
    return;
  }
  await runBangumiCacheAction("clear-local", async () => {
    setCacheManagerStatus("正在清理本机 Bangumi 缓存...");
    await clearBangumiMetadata();
    for (const item of state.pageItems) {
      item.bangumiMetadata = null;
      item.bangumiMetadataSource = null;
      item.bangumiMetadataResolved = false;
    }
    state.metadataPersonalLoaded = false;
    await loadPersonalBangumiCache({ force: true });
    await refreshLocalBangumiCacheFacts();
    applyCatalogView({ render: true });
    setCacheManagerStatus(
      "已清空本机临时缓存，并重新载入个人仓库缓存。",
      "success",
    );
    showToast("已清空本机临时缓存");
  });
}

async function clearPersonalBangumiCache() {
  if (
    !window.confirm(
      "清空个人仓库中的全部 Bangumi 评分与标签缓存？" +
        "这不会删除番剧记录与评价，但会创建一次仓库提交。",
    )
  ) {
    return;
  }
  await runBangumiCacheAction("clear-personal", async () => {
    setCacheManagerStatus("正在清空个人仓库 Bangumi 缓存...");
    const result = await api("/api/bangumi-cache", {
      method: "DELETE",
      body: JSON.stringify({ all: true }),
    });
    await clearBangumiMetadata();
    for (const item of state.pageItems) {
      item.bangumiMetadata = null;
      item.bangumiMetadataSource = null;
      item.bangumiMetadataResolved = false;
    }
    state.metadataPersonalLoaded = true;
    applyPersonalCacheResult(result);
    await refreshLocalBangumiCacheFacts();
    applyCatalogView({ render: true });
    setCacheManagerStatus(
      result.changed
        ? `个人仓库 Bangumi 缓存已清空` +
            (result.commitShort ? `，提交 ${result.commitShort}` : "")
        : "个人仓库 Bangumi 缓存原本就是空的",
      "success",
    );
    showToast("个人仓库 Bangumi 缓存已清空");
  });
}

function createBangumiMetadata(item, maximumTags = 2) {
  const metadata = item.bangumiMetadata;
  if (!hasUsableBangumiMetadata(metadata)) {
    return null;
  }
  const wrapper = document.createElement("span");
  wrapper.className = "catalog-bangumi-meta";
  if (Number.isFinite(metadata.score)) {
    const score = document.createElement("span");
    score.className = "catalog-bangumi-score";
    score.textContent = `Bangumi ${metadata.score.toFixed(1)}`;
    const count = formatMetadataCount(metadata.ratingCount);
    score.title = [
      `Bangumi 评分 ${metadata.score.toFixed(1)}`,
      count ? `${count} 人评分` : "",
      metadata.rank ? `排名 ${metadata.rank}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    wrapper.append(score);
  }
  if (isCachedBangumiMetadata(item)) {
    const cached = document.createElement("span");
    cached.className = "catalog-bangumi-cache";
    const personal = item.bangumiMetadataSource === "personal";
    cached.classList.toggle("is-personal", personal);
    cached.classList.toggle(
      "is-pending",
      Boolean(item.bangumiMetadata?.pendingSync),
    );
    cached.textContent = item.bangumiMetadata?.pendingSync
      ? personal
        ? "个人缓存待保存"
        : "本机待保存"
      : personal
        ? "个人缓存"
        : "本机缓存";
    cached.title = item.bangumiMetadata?.pendingSync
      ? "评分和标签只保存在当前浏览器，尚未写入个人数据仓库"
      : personal
        ? "评分和标签已从个人数据仓库加载"
        : "评分和标签来自当前浏览器";
    wrapper.append(cached);
  }
  for (const tag of (metadata.tags ?? []).slice(0, maximumTags)) {
    const chip = document.createElement("span");
    chip.className = "catalog-bangumi-tag";
    chip.textContent = tag.name;
    chip.title = tag.count
      ? `${tag.name} · Bangumi ${tag.count} 人标记`
      : tag.name;
    wrapper.append(chip);
  }
  return wrapper;
}

function renderCatalogTagOptions() {
  if (!elements.catalogTagOptions) {
    return;
  }
  const counts = new Map();
  for (const metadata of state.metadataEntries.values()) {
    if (!hasUsableBangumiMetadata(metadata)) {
      continue;
    }
    for (const tag of metadata.tags ?? []) {
      const name = String(tag.name ?? "").trim();
      if (name) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  for (const selected of state.metadataTags) {
    if (!counts.has(selected)) {
      counts.set(selected, 0);
    }
  }
  const tags = [...counts.entries()].sort(
    (left, right) =>
      right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"),
  );
  const options = tags.map(([name, count]) => {
    const label = document.createElement("label");
    label.className = "catalog-year-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = name;
    input.dataset.catalogTag = "true";
    input.checked = state.metadataTags.has(name);
    const value = document.createElement("span");
    value.textContent = name;
    const total = document.createElement("small");
    total.textContent = `${count} 部`;
    label.append(input, value, total);
    return label;
  });
  if (!options.length) {
    const empty = document.createElement("span");
    empty.className = "catalog-filter-empty";
    empty.textContent = "个人或本机缓存中暂无 Bangumi 标签";
    options.push(empty);
  }
  replaceChildrenSafe("Bangumi 标签选项", elements.catalogTagOptions, ...options);
  const selected = [...state.metadataTags];
  elements.catalogTagSummary.textContent = !selected.length
    ? "全部标签"
    : selected.length <= 2
      ? selected.join("、")
      : `已选 ${selected.length} 个标签`;
  elements.catalogTagClear.disabled = selected.length === 0;
}

function metadataStatusText() {
  if (state.metadataLoading) {
    return "正在读取 Bangumi 信息";
  }
  if (!state.metadataEntries.size) {
    return "等待缓存索引";
  }
  const stats = state.metadataStats;
  if (!stats.indexed) {
    return "缓存中没有 Bangumi 条目";
  }
  if (!stats.available) {
    return stats.cached
      ? "缓存中暂无评分或标签"
      : "尚未读取 Bangumi 信息";
  }
  return [
    stats.scored ? `评分 ${stats.scored}` : "",
    stats.tagged ? `标签 ${stats.tagged}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function summarizeCachedBangumiMetadata(entries) {
  const summary = {
    total: entries.size,
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
  for (const metadata of entries.values()) {
    summary.indexed += 1;
    const available = hasUsableBangumiMetadata(metadata);
    if (available) {
      summary.available += 1;
    }
    const source = metadata.storageSource ?? "browser";
    if (source === "personal") {
      summary.personal += 1;
      if (available) {
        summary.personalAvailable += 1;
      }
    } else {
      summary.browser += 1;
      if (available) {
        summary.browserAvailable += 1;
      }
    }
    if (source === "personal" || ["browser", "cache"].includes(source)) {
      summary.cached += 1;
      if (available) {
        summary.cachedAvailable += 1;
      }
    }
    if (metadata.pendingSync) {
      summary.pending += 1;
    }
    if (Number.isFinite(metadata.score)) {
      summary.scored += 1;
    }
    if (metadata.tags?.length) {
      summary.tagged += 1;
    }
  }
  summary.missing = Math.max(0, summary.indexed - summary.available);
  return summary;
}

function renderCatalogMetadataStatus(message = "") {
  state.metadataStats = summarizeCachedBangumiMetadata(state.metadataEntries);
  const stats = state.metadataStats;
  if (elements.catalogMetadataStatus) {
    elements.catalogMetadataStatus.textContent =
      message || metadataStatusText();
  }
  if (elements.catalogMetadataTotalCount) {
    elements.catalogMetadataTotalCount.textContent =
      (state.metadataIndexedCount || stats.indexed).toLocaleString("zh-CN");
  }
  if (elements.catalogMetadataCacheCount) {
    elements.catalogMetadataCacheCount.textContent =
      stats.cached.toLocaleString("zh-CN");
  }
  if (elements.catalogMetadataLocalCount) {
    elements.catalogMetadataLocalCount.textContent =
      stats.browser.toLocaleString("zh-CN");
  }
  if (elements.catalogMetadataScoreCount) {
    elements.catalogMetadataScoreCount.textContent =
      stats.scored.toLocaleString("zh-CN");
  }
  if (elements.catalogMetadataTagCount) {
    elements.catalogMetadataTagCount.textContent =
      stats.tagged.toLocaleString("zh-CN");
  }
  if (elements.catalogMetadataMissingCount) {
    elements.catalogMetadataMissingCount.textContent =
      Math.max(
        0,
        (state.metadataIndexedCount || stats.indexed) - stats.available,
      ).toLocaleString("zh-CN");
  }
  if (elements.catalogMetadataCacheBadge) {
    elements.catalogMetadataCacheBadge.hidden = stats.browserAvailable === 0;
    elements.catalogMetadataCacheBadge.textContent =
      `本机 ${stats.browserAvailable}`;
    elements.catalogMetadataCacheBadge.title =
      `已有 ${stats.browserAvailable} 条评分或标签来自本机临时缓存`;
  }
  if (elements.catalogMetadataPersonalBadge) {
    elements.catalogMetadataPersonalBadge.hidden =
      stats.personalAvailable === 0;
    elements.catalogMetadataPersonalBadge.textContent =
      `个人 ${stats.personalAvailable}`;
    elements.catalogMetadataPersonalBadge.title =
      `已有 ${stats.personalAvailable} 条评分或标签来自个人数据仓库`;
  }
  elements.catalogMetadataRefresh.disabled =
    state.loading || state.metadataLoading || state.pageItems.length === 0;
  elements.catalogMetadataRefresh.classList.toggle(
    "is-loading",
    state.metadataLoading,
  );
  elements.catalogMetadataRefresh.textContent = state.metadataLoading
    ? "更新中"
    : "更新本页";
  renderCacheManager();
}

function applyCatalogView(options = {}) {
  state.items = state.pageItems;
  state.metadataAvailableCount = state.pageItems.filter((item) =>
    hasUsableBangumiMetadata(item.bangumiMetadata),
  ).length;
  renderCatalogTagOptions();
  renderCatalogMetadataStatus();
  if (options.render !== false) {
    renderCatalogRows();
  }
}

function hasActiveCatalogMetadataFilters() {
  return Boolean(
    state.metadataTags.size ||
      state.metadataScoreMin !== "" ||
      state.metadataScoreMax !== "" ||
      state.metadataAvailability !== "all" ||
      state.metadataSort !== "default",
  );
}

function createDraft(item) {
  return {
    title: item.displayTitle,
    rating: null,
    review: "",
    note: "",
  };
}

function restorePendingAdditions() {
  const pending = readPendingDrafts();
  state.selectedItems.clear();
  state.drafts.clear();
  for (const entry of pending.additions) {
    state.selectedItems.set(entry.item.id, entry.item);
    state.drafts.set(entry.item.id, {
      title: entry.changes.title || entry.item.displayTitle,
      rating: entry.changes.rating,
      review: entry.changes.review,
      note: entry.changes.note,
    });
  }
  return pending;
}

function refreshPendingCatalogDrafts() {
  state.pendingDrafts = readPendingDrafts();
  state.dirty = pendingCount(state.pendingDrafts) > 0;
  return state.pendingDrafts;
}

function persistCatalogDrafts(options = {}) {
  const pending = readPendingDrafts();
  pending.additions = [...state.selectedItems.values()].map((item) => {
    const draft = state.drafts.get(item.id) ?? createDraft(item);
    return {
      item: compactCatalogItem(item),
      changes: {
        title: draft.title,
        rating: draft.rating,
        review: draft.review,
        note: draft.note,
      },
      savedAt: new Date().toISOString(),
    };
  });
  state.pendingDrafts = writePendingDrafts(pending, {
    source: "catalog",
    ...options,
  });
}

function saveCatalogDraft(item) {
  if (!state.selectedItems.has(item.id)) {
    return;
  }
  persistCatalogDrafts({ silent: true });
  renderBatchActions();
}

function renderBatchActions() {
  const writable = getRuntime().writable;
  const totalPending = pendingCount();
  const disabled = state.busy || totalPending === 0 || !writable;
  elements.catalogSaveButton.disabled = disabled;
  elements.catalogSyncButton.disabled = disabled;
  elements.catalogSaveButton.textContent = state.busy
    ? "正在写入"
    : !writable
      ? "填写 Token 后可编辑"
      : `保存并提交 (${totalPending})`;
  elements.catalogSyncButton.textContent = state.busy
    ? "正在同步"
    : `保存并推送 (${totalPending})`;
  elements.catalogSyncButton.hidden = getRuntime().mode === "github";
  elements.catalogSaveButton.classList.toggle("is-loading", state.busy);
  elements.catalogSyncButton.classList.toggle("is-loading", state.busy);
}

function setDirty(dirty) {
  state.dirty = dirty;
  persistCatalogDrafts();
  renderBatchActions();
}

function confirmCatalogDiscard() {
  return true;
}

function requestLibraryDiscard() {
  const detail = { allowed: false };
  window.dispatchEvent(
    new CustomEvent("anime-editor:request-close", { detail }),
  );
  return detail.allowed;
}

function resetSelectionState() {
  state.selectedItems.clear();
  state.drafts.clear();
  state.dirty = false;
  persistCatalogDrafts();
  renderCatalogRows();
  renderBatchEditor();
}

function activateView(view, options = {}) {
  if (view === state.view) {
    return;
  }
  if (!options.force) {
    if (
      state.view === "library" &&
      view !== "library" &&
      !requestLibraryDiscard()
    ) {
      return;
    }
    if (
      state.view === "catalog" &&
      view !== "catalog" &&
      !confirmCatalogDiscard()
    ) {
      return;
    }
  }
  if (state.view === "library" && view !== "library") {
    window.dispatchEvent(new CustomEvent("anime-editor:discard"));
  }
  if (state.view === "catalog" && view !== "catalog" && state.dirty) {
    state.dirty = pendingCount() > 0;
  }
  state.view = view;
  for (const button of elements.switchButtons) {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  elements.libraryWorkspace.hidden = view !== "library";
  elements.catalogWorkspace.hidden = view !== "catalog";
  elements.duplicateWorkspace.hidden = view !== "duplicates";
  elements.settingsWorkspace.hidden = view !== "settings";
  elements.aboutWorkspace.hidden = view !== "about";
  if (view === "catalog") {
    renderBatchEditor();
    if (!state.catalogLoaded) {
      void loadCatalog();
    }
  }
  if (view === "duplicates") {
    window.dispatchEvent(new CustomEvent("anime-duplicates:activate"));
  }
  if (view === "settings") {
    const targetSection = state.settingsSection || "site";
    void loadSiteSettings();
    activateSettingsSection(targetSection);
    window.requestAnimationFrame(() => {
      if (state.view === "settings") {
        scrollToSettingsSection(targetSection, {
          instant: true,
        });
      }
    });
  }
  if (view === "about") {
    renderAbout();
    checkTemplate(false);
  }
}

function renderAbout() {
  const runtime = getRuntime();
  elements.templateRepositoryLink.href = `https://github.com/${TEMPLATE_REPOSITORY}`;
  elements.templateRepositoryLink.textContent = TEMPLATE_REPOSITORY;
  elements.aboutTargetRepository.textContent = runtime.repository || "尚未连接";
  const writable = runtime.mode === "github" && runtime.writable;
  const status = state.templateStatus;
  const updateAvailable = Boolean(status?.updateAvailable);
  elements.templateCheckButton.disabled = templateBusy || runtime.mode === "local";
  elements.templateUpdateButton.disabled = templateBusy || !writable;
  elements.templateCheckButton.classList.toggle("is-loading", templateBusy);
  elements.templateUpdateButton.classList.toggle("is-loading", templateBusy);
  elements.templateUpdateButton.hidden = !updateAvailable || !writable;
  elements.templateUpdateAvailable.hidden = !updateAvailable;
  if (status?.updateAvailable) {
    elements.templateUpdateAvailableText.textContent =
      `当前仓库与模板有 ${status.changedFileCount} 个非数据文件不同。` +
      (writable ? "确认后可以拉取最新管理页。" : "填写写入 Token 后可以执行更新。");
  }
  elements.aboutTargetCommit.textContent =
    status?.targetCommitShort
      ? `${status.targetCommitShort} · ${status.targetCommitMessage}`
      : "尚未检查";
  elements.templateLastUpdate.textContent = status?.lastTemplateUpdate
    ? `${status.lastTemplateUpdate.commitShort} · ${status.lastTemplateUpdate.commitMessage}`
    : "未找到历史模板更新提交";
  if (runtime.mode === "local") {
    setTemplateStatus(
      "当前是本地管理模式，无法在这里拉取模板；本地开发请使用 Git 更新。",
    );
    elements.templateUpdateBadge.textContent = "本地模式";
  } else if (!runtime.writable) {
    if (!status) {
      setTemplateStatus(
        "当前为只读模式。填写有 Contents: Read and write 权限的 Token 后才可以更新。",
      );
      elements.templateUpdateBadge.textContent = "需要 Token";
    }
  }
}

async function checkTemplate(showMessage = true) {
  if (templateBusy || getRuntime().mode === "local") {
    renderAbout();
    return;
  }
  templateBusy = true;
  renderAbout();
  if (showMessage || state.templateLogs.length === 0) {
    clearTemplateLogs("正在检查模板更新");
  } else {
    appendTemplateLog("重新检查模板仓库版本");
  }
  setTemplateStatus("正在读取模板仓库版本...");
  try {
    const status = await api("/api/template/status", {
      onProgress(progress) {
        appendTemplateLog(progress.message);
      },
    });
    state.templateStatus = status;
    elements.templateCommitLabel.textContent = status.commitShort;
    elements.templateCommitMessage.textContent = status.commitMessage || "无提交说明";
    elements.templateCommitMeta.textContent = [
      status.commitAuthor,
      status.commitDate ? formatDate(status.commitDate) : "时间未知",
    ].filter(Boolean).join(" · ");
    elements.templateCommitLink.href = status.commitUrl;
    elements.templateUpdateBadge.textContent = status.updateAvailable
      ? `有更新 · ${status.changedFileCount} 个文件`
      : "已是最新";
    if (status.updateAvailable) {
      setTemplateStatus(
        `模板最新提交为 ${status.commitShort}，当前仓库有 ${status.changedFileCount} 个文件待更新。`,
      );
      appendTemplateLog(
        `发现更新：${status.changedFileCount} 个非数据文件与模板不同`,
        "warning",
      );
    } else {
      setTemplateStatus(
        `当前仓库的模板文件已与 ${status.commitShort} 同步，无需更新。`,
        "success",
      );
      appendTemplateLog("检查完成：页面代码已经是模板最新版本", "success");
    }
    if (status.retryCount > 0) {
      appendTemplateLog(
        `网络波动后已自动重试 ${status.retryCount} 次并成功`,
        "warning",
      );
    }
    if (showMessage) {
      showToast(
        status.updateAvailable
          ? `发现模板更新：${status.changedFileCount} 个文件`
          : "当前模板已是最新",
      );
    }
  } catch (error) {
    state.templateStatus = null;
    elements.templateUpdateBadge.textContent = "检查失败";
    setTemplateStatus(`检查失败：${error.message}`, "error");
    appendTemplateLog(`检查失败：${error.message}`, "error");
    appendTemplateLog("请检查网络、Token 权限和仓库地址后重试", "warning");
    if (showMessage) {
      showToast(error.message, { error: true });
    }
  } finally {
    templateBusy = false;
    renderAbout();
  }
}

async function updateTemplate() {
  if (templateBusy || getRuntime().mode === "local" || !getRuntime().writable) {
    return;
  }
  const confirmed = window.confirm(
    "确定从 MyAnimeLife 模板更新吗？整个 data/ 目录会保留，但其他所有文件会被模板覆盖；你自行修改的页面、配置、工作流和脚本可能丢失。请确认已经备份或推送这些修改。",
  );
  if (!confirmed) {
    return;
  }
  templateBusy = true;
  renderAbout();
  clearTemplateLogs("正在更新管理页");
  appendTemplateLog("已确认更新范围：保留 data/ 与 config/site.json", "warning");
  setTemplateStatus("正在拉取模板文件并创建提交，请不要关闭页面...");
  try {
    const result = await api("/api/template/update", {
      method: "POST",
      body: JSON.stringify({}),
      onProgress(progress) {
        appendTemplateLog(
          progress.message,
          progress.stage === "update:complete" ? "success" : "info",
        );
      },
    });
    elements.templateCommitLabel.textContent = result.templateCommit.slice(0, 7);
    elements.templateCommitMessage.textContent = result.templateCommitMessage || "无提交说明";
    elements.templateCommitMeta.textContent = [
      result.templateCommitAuthor,
      result.templateCommitDate ? formatDate(result.templateCommitDate) : "时间未知",
    ].filter(Boolean).join(" · ");
    elements.templateCommitLink.href = result.templateCommitUrl || elements.templateCommitLink.href;
    elements.templateUpdateBadge.textContent = `已更新 ${result.commitShort}`;
    const retryNote =
      result.retryCount > 0
        ? `期间网络波动已自动重试 ${result.retryCount} 次。`
        : "";
    setTemplateStatus(
      `更新完成：保留 ${result.preservedDataFiles} 个数据文件和站点设置，更新 ${result.updatedFiles} 个文件，移除 ${result.removedFiles} 个旧文件。${retryNote}刷新页面后加载最新管理页。`,
      "success",
    );
    appendTemplateLog(
      `数据保护完成：保留 ${result.preservedDataFiles} 个数据文件、${result.preservedConfigFiles} 个站点配置文件`,
      "success",
    );
    appendTemplateLog(
      `更新统计：写入 ${result.updatedFiles} 个文件，移除 ${result.removedFiles} 个旧文件`,
      "success",
    );
    appendTemplateLog(
      `Git 提交 ${result.commitShort} 已发布，刷新页面即可加载新代码`,
      "success",
    );
    if (result.retryCount > 0) {
      appendTemplateLog(
        `网络波动后已自动重试 ${result.retryCount} 次并成功`,
        "warning",
      );
    }
    state.templateStatus = {
      ...state.templateStatus,
      updateAvailable: false,
      changedFileCount: 0,
      targetCommitShort: result.commitShort,
      targetCommitMessage: "已更新到最新模板",
      lastTemplateUpdate: {
        commitShort: result.commitShort,
        commitMessage: "chore(admin): update from MyAnimeLife template",
      },
    };
    elements.templateUpdateAvailable.hidden = true;
    elements.templateUpdateButton.hidden = true;
    showToast(
      `管理页已更新，提交 ${result.commitShort}${result.retryCount > 0 ? `，自动重试 ${result.retryCount} 次` : ""}`,
      { duration: 7000 },
    );
  } catch (error) {
    setTemplateStatus(`更新失败：${error.message}`, "error");
    appendTemplateLog(`更新失败：${error.message}`, "error");
    appendTemplateLog(
      "本次操作未主动覆盖 data/ 或 config/site.json，可检查日志后重试",
      "warning",
    );
    showToast(error.message, { error: true, duration: 8000 });
  } finally {
    templateBusy = false;
    renderAbout();
  }
}

function selectedYearValues() {
  return [...state.years].sort((left, right) => Number(right) - Number(left));
}

function renderYearFilterSummary() {
  const years = selectedYearValues();
  if (!years.length) {
    elements.catalogYearSummary.textContent = "全部年份";
  } else if (years.length <= 2) {
    elements.catalogYearSummary.textContent = years.join("、");
  } else {
    elements.catalogYearSummary.textContent = `已选 ${years.length} 个年份`;
  }
  elements.catalogYearClear.disabled = years.length === 0;
}

function populateFacets(facets) {
  if (!facets) {
    return;
  }
  if (!state.facetsLoaded) {
    replaceChildrenSafe("年代筛选选项", elements.catalogYearOptions);
    for (const year of facets.years ?? []) {
      const label = document.createElement("label");
      label.className = "catalog-year-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = String(year.value);
      input.dataset.catalogYear = "true";
      input.checked = state.years.has(input.value);
      const value = document.createElement("span");
      value.textContent = String(year.value);
      const count = document.createElement("small");
      count.textContent = `${year.count} 部`;
      label.append(input, value, count);
      elements.catalogYearOptions?.append(label);
    }
    for (const source of facets.sources ?? []) {
      const option = document.createElement("option");
      option.value = source.value;
      option.textContent = `${source.label} · ${source.count}`;
      elements.catalogSource.append(option);
    }
    state.facetsLoaded = true;
  }
  renderYearFilterSummary();
}

function createLoadingSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("catalog-cover-loader");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "16");
  circle.setAttribute("cy", "16");
  circle.setAttribute("r", "10");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "3");
  circle.setAttribute("stroke-linecap", "round");
  circle.setAttribute("stroke-dasharray", "42 21");
  svg.append(circle);
  return svg;
}

function createCover(item, options = {}) {
  const cover = document.createElement("span");
  cover.className = "catalog-row-cover";
  const fallback = document.createElement("span");
  fallback.className = "catalog-row-fallback";
  fallback.textContent = [...item.displayTitle][0] ?? "A";
  cover.append(fallback);
  if (options.loading) {
    cover.append(createLoadingSvg());
  }
  if (item.coverUrl) {
    const image = document.createElement("img");
    image.src = item.coverUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove(), { once: true });
    cover.append(image);
  }
  return cover;
}

function toggleSelection(item) {
  if (!getRuntime().writable) {
    showToast("当前为只读模式，请先连接 GitHub Token", { error: true });
    return;
  }
  if (item.ownedRecordId) {
    showToast(`《${item.displayTitle}》已经在本地档案中`);
    return;
  }
  if (state.selectedItems.has(item.id)) {
    state.selectedItems.delete(item.id);
    state.drafts.delete(item.id);
  } else {
    if (state.selectedItems.size >= MAX_BATCH_SIZE) {
      showToast(`单次最多选择 ${MAX_BATCH_SIZE} 部番剧`, { error: true });
      return;
    }
    state.selectedItems.set(item.id, item);
    state.drafts.set(item.id, createDraft(item));
    void hydrateSelectedCover(item);
  }
  persistCatalogDrafts();
  state.dirty = pendingCount() > 0;
  renderCatalogRows();
  renderBatchEditor();
}

function createCatalogCard(item) {
  const card = document.createElement("article");
  card.className = "catalog-card";
  card.tabIndex = 0;
  card.classList.toggle("is-selected", state.selectedItems.has(item.id));
  card.classList.toggle("is-owned", Boolean(item.ownedRecordId));

  card.append(createCover(item, {
    loading: Boolean(item.sites?.bangumi && !item.coverUrl && !item.coverResolved),
  }));

  const body = document.createElement("div");
  body.className = "catalog-card-body";
  const top = document.createElement("div");
  top.className = "catalog-card-top";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedItems.has(item.id);
  checkbox.disabled = Boolean(item.ownedRecordId) || !getRuntime().writable;
  checkbox.setAttribute(
    "aria-label",
    item.ownedRecordId ? `${item.displayTitle} 已收录` : `选择 ${item.displayTitle}`,
  );
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => toggleSelection(item));
  top.append(checkbox);
  if (item.ownedRecordId) {
    const owned = document.createElement("span");
    owned.className = "owned-badge";
    owned.textContent = "已收录";
    top.append(owned);
  }
  body.append(top);

  const title = document.createElement("h3");
  title.textContent = item.displayTitle;
  body.append(title);
  const alternate = item.title !== item.displayTitle
    ? item.title
    : item.names.find((name) => name !== item.displayTitle) ?? "";
  const subtitle = document.createElement("span");
  subtitle.className = "catalog-card-subtitle";
  subtitle.textContent = alternate;
  body.append(subtitle);
  const bangumiMetadata = createBangumiMetadata(item, 3);
  if (bangumiMetadata) {
    body.append(bangumiMetadata);
  }
  const meta = document.createElement("span");
  meta.className = "catalog-card-meta";
  meta.textContent = itemMeta(item);
  body.append(meta);
  card.append(body);

  const select = () => toggleSelection(item);
  card.addEventListener("click", select);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  return card;
}

function createCatalogRow(item) {
  const row = document.createElement("tr");
  row.className = "record-row catalog-row";
  row.tabIndex = 0;
  const picked = state.selectedItems.has(item.id);
  row.classList.toggle("is-selected", picked);
  row.classList.toggle("is-owned", Boolean(item.ownedRecordId));

  const checkCell = document.createElement("td");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = picked;
  checkbox.disabled = Boolean(item.ownedRecordId) || !getRuntime().writable;
  checkbox.setAttribute(
    "aria-label",
    item.ownedRecordId
      ? `${item.displayTitle} 已收录`
      : `选择 ${item.displayTitle}`,
  );
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => toggleSelection(item));
  checkCell.append(checkbox);
  row.append(checkCell);

  const titleCell = document.createElement("td");
  titleCell.className = "catalog-title-cell";
  const work = document.createElement("div");
  work.className = "catalog-work";
  work.append(createCover(item, {
    loading: Boolean(item.sites?.bangumi && !item.coverUrl && !item.coverResolved),
  }));
  const copy = document.createElement("div");
  copy.className = "catalog-work-copy";
  const titleLine = document.createElement("div");
  titleLine.className = "catalog-title-line";
  const title = document.createElement("span");
  title.className = "record-title";
  title.textContent = item.displayTitle;
  titleLine.append(title);
  if (item.ownedRecordId) {
    const owned = document.createElement("span");
    owned.className = "owned-badge";
    owned.textContent = "已收录";
    titleLine.append(owned);
  }
  const alternate =
    item.title !== item.displayTitle
      ? item.title
      : item.names.find((name) => name !== item.displayTitle) ?? "";
  const subtitle = document.createElement("span");
  subtitle.className = "record-subtitle";
  subtitle.textContent = alternate;
  copy.append(titleLine, subtitle);
  const bangumiMetadata = createBangumiMetadata(item, 2);
  if (bangumiMetadata) {
    copy.append(bangumiMetadata);
  }
  work.append(copy);
  titleCell.append(work);
  row.append(titleCell);

  const yearCell = document.createElement("td");
  yearCell.className = "catalog-year";
  yearCell.textContent = item.year ? String(item.year) : "未知";
  row.append(yearCell);

  const sourcesCell = document.createElement("td");
  sourcesCell.className = "catalog-sources";
  for (const source of item.sources) {
    const badge = document.createElement("span");
    badge.textContent = source.label;
    sourcesCell.append(badge);
  }
  if (!item.sources.length) {
    sourcesCell.textContent = "标题索引";
  }
  row.append(sourcesCell);

  const select = () => toggleSelection(item);
  row.addEventListener("click", select);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  return row;
}

function renderSelectionSummary() {
  const count = state.selectedItems.size;
  const selectable = state.items.filter((item) => !item.ownedRecordId);
  const selectedVisible = selectable.filter((item) =>
    state.selectedItems.has(item.id),
  ).length;
  elements.catalogSelectionLabel.textContent = `已选择 ${count} 部`;
  elements.catalogSelectionBadge.textContent = `已选择 ${count} 部`;
  elements.catalogClearSelection.disabled = state.busy || count === 0;
  elements.catalogSelectAll.checked =
    selectable.length > 0 && selectedVisible === selectable.length;
  elements.catalogSelectAll.indeterminate =
    selectedVisible > 0 && selectedVisible < selectable.length;
  elements.catalogSelectAll.disabled =
    state.busy || !getRuntime().writable || selectable.length === 0;
  renderBatchActions();
}

function renderCatalogRows() {
  const pageInfo = getPaginationState(
    state.total,
    state.pageSize,
    state.page,
  );
  if (elements.catalogTable) {
    elements.catalogTable.hidden = state.layout !== "list";
  }
  if (elements.catalogCards) {
    elements.catalogCards.hidden = state.layout !== "cards";
  }
  state.page = pageInfo.page;
  replaceChildrenSafe(
    "索引表格",
    elements.catalogRows,
    ...(state.layout === "list" ? state.items.map(createCatalogRow) : []),
  );
  replaceChildrenSafe("索引卡片", elements.catalogCards);
  if (state.layout === "cards") {
    elements.catalogCards?.append(...state.items.map(createCatalogCard));
  }
  elements.catalogCount.textContent = state.total
    ? state.total.toLocaleString("zh-CN")
    : "0";
  elements.catalogResultLabel.textContent = state.loading
    ? "正在读取索引"
    : state.total
      ? [
          `匹配 ${state.total.toLocaleString("zh-CN")} 条`,
          `第 ${state.page} / ${pageInfo.pageCount} 页`,
          `本页显示 ${state.items.length} / ${state.pageItems.length} 条`,
          hasActiveCatalogMetadataFilters()
            ? `Bangumi 筛选覆盖全部 ${state.metadataEntries.size.toLocaleString("zh-CN")} 条已有缓存`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "匹配 0 条";
  elements.catalogEmpty.hidden =
    state.loading || state.metadataLoading || state.items.length > 0;
  if (
    !state.items.length &&
    hasActiveCatalogMetadataFilters()
  ) {
    elements.catalogEmptyTitle.textContent = "没有符合条件的 Bangumi 信息";
    elements.catalogEmptyText.textContent =
      "当前评分与标签筛选会检查全部个人及本机缓存，请调整条件或继续补充 Bangumi 缓存。";
  } else if (!state.items.length && !state.loading && !state.metadataLoading) {
    elements.catalogEmptyTitle.textContent = "没有匹配的索引";
    elements.catalogEmptyText.textContent = "换一个标题或调整筛选条件。";
  }
  renderPagination(
    {
      nav: elements.catalogPagination,
      summary: elements.catalogPageSummary,
      pages: elements.catalogPageButtons,
      previous: elements.catalogPreviousPage,
      next: elements.catalogNextPage,
    },
    {
      totalItems: state.total,
      pageSize: state.pageSize,
      page: state.page,
      loading: state.loading,
      onSelect: (page) => {
        state.page = page;
        loadCatalog();
      },
    },
  );
  renderSelectionSummary();
}

async function hydrateVisibleCovers(sequence) {
  const items = state.pageItems;
  try {
    await hydrateCatalogCovers(items);
    if (sequence !== requestSequence) {
      return;
    }
    renderCatalogRows();
    if (state.selectedItems.size) {
      persistCatalogDrafts({ silent: true });
      renderBatchEditor();
    }
  } catch {
    // A cover service failure leaves the title fallback in place.
  }
}

async function applyCachedBangumiMetadata(items) {
  if (!items.length) {
    return;
  }
  try {
    const metadata = await readBangumiMetadata(
      items.map((item) => item.sites?.bangumi).filter(Boolean),
    );
    applyBangumiMetadata(
      items,
      metadata,
      new Map(
        [...metadata.entries()].map(([subjectId, entry]) => [
          subjectId,
          entry.storageSource ?? "browser",
        ]),
      ),
    );
    await refreshLocalBangumiCacheFacts();
  } catch {
    // The catalog remains usable when IndexedDB is unavailable.
  }
}

async function hydrateVisibleMetadata(sequence, options = {}) {
  const items = state.pageItems;
  let reloadForMetadataScope = false;
  if (!items.length) {
    renderCatalogMetadataStatus();
    return;
  }
  state.metadataLoading = true;
  renderCatalogMetadataStatus(
    options.refresh
      ? "正在更新本页 Bangumi 信息..."
      : "正在读取本页 Bangumi 信息...",
  );
  applyCatalogView({ render: true });
  try {
    const result = await resolveBangumiMetadata(items, {
      refresh: options.refresh,
      onProgress(progress) {
        if (sequence !== requestSequence || !progress.total) {
          return;
        }
        const phaseText =
          progress.phase === "network"
            ? "已载入 Bangumi Archive 快照"
            : "正在读取 Bangumi";
        renderCatalogMetadataStatus(
          `${phaseText}：${progress.completed} / ${progress.total}` +
            (progress.failed ? ` · 失败 ${progress.failed}` : ""),
        );
      },
    });
    if (sequence !== requestSequence) {
      return result;
    }
    applyBangumiMetadata(items, result.metadata, result.sourceById);
    applyCatalogView({ render: false });
    await refreshLocalBangumiCacheFacts();
    reloadForMetadataScope =
      result.fetched > 0 && hasActiveCatalogMetadataFilters();
    if (options.refresh || result.fetched || result.failed || result.snapshotError) {
      const message = [
        result.snapshot ? `公共快照 ${result.snapshot} 条` : "",
        result.api ? `在线补充 ${result.api} 条` : "",
        result.snapshotError ? "公共快照不可用" : "",
        result.failed ? `失败 ${result.failed} 条` : "",
        result.failed ? "原有缓存已保留" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      showToast(
        message || `本页 ${result.requested} 条 Bangumi 信息均来自个人或本机缓存`,
        { error: Boolean(result.failed) },
      );
    }
    return result;
  } catch (error) {
    if (sequence === requestSequence) {
      renderCatalogMetadataStatus(`Bangumi 信息读取失败：${error.message}`);
      showToast(`Bangumi 信息读取失败：${error.message}`, { error: true });
    }
    return null;
  } finally {
    if (sequence === requestSequence) {
      state.metadataLoading = false;
      renderCatalogMetadataStatus();
      applyCatalogView({ render: true });
      if (reloadForMetadataScope) {
        state.page = 1;
        void loadCatalog();
      }
    }
  }
}

async function hydrateCatalogCovers(items) {
  try {
    const covers = await resolveCatalogCovers(items);
    for (const item of items) {
      const coverUrl = covers.get(item.id);
      if (coverUrl) {
        item.coverUrl = coverUrl;
      }
      if (item.sites?.bangumi && !item.coverUrl) {
        item.coverResolved = true;
      }
    }
  } catch {
    // Cover lookup is optional; records can still be saved with a title fallback.
  }
}

async function hydrateSelectedCover(item) {
  if (item.coverUrl || !item.sites?.bangumi) {
    return;
  }
  await hydrateCatalogCovers([item]);
  if (state.selectedItems.has(item.id)) {
    persistCatalogDrafts({ silent: true });
    renderCatalogRows();
    renderBatchEditor();
  }
}

function renderCatalogSource(meta = {}) {
  const version = meta.version || "未知版本";
  elements.catalogSourceSummary.textContent = meta.seededFrom
    ? `bangumi-data ${version} · 模板内置初始索引`
    : `bangumi-data ${version} · 当前默认`;
  elements.catalogSourceVersion.textContent = version;
  elements.catalogSourceCheckedAt.textContent = meta.checkedAt
    ? formatDate(meta.checkedAt)
    : "尚未检查";
  elements.catalogSourceLicense.textContent = meta.license || "CC BY 4.0";
}

function formatTransferSpeed(bytesPerSecond) {
  const bytes = Math.max(0, Number(bytesPerSecond) || 0);
  if (!bytes) {
    return "";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB/s`;
}

function renderCatalogIndexProgress() {
  const progress = state.catalogReplaceProgress;
  if (elements.catalogIndexProgress) {
    elements.catalogIndexProgress.hidden = !progress;
    elements.catalogIndexProgress.max = Math.max(1, progress?.total ?? 1);
    elements.catalogIndexProgress.value = Math.min(
      progress?.loaded ?? 0,
      progress?.total ?? 1,
    );
  }
  if (elements.catalogIndexProgressLabel) {
    if (!progress) {
      elements.catalogIndexProgressLabel.textContent =
        "新索引完整下载并建立成功后，才会替换当前本机索引。";
    } else if (progress.phase === "download") {
      const loaded = formatByteSize(progress.loaded);
      const total = progress.total
        ? ` / ${formatByteSize(progress.total)}`
        : "";
      const speed = formatTransferSpeed(progress.speed);
      elements.catalogIndexProgressLabel.textContent = [
        "正在下载 bangumi-data",
        `${loaded}${total}`,
        speed,
      ]
        .filter(Boolean)
        .join(" · ");
    } else if (progress.phase === "parse") {
      elements.catalogIndexProgressLabel.textContent =
        "下载完成，正在建立本机搜索索引...";
    } else if (progress.phase === "version") {
      elements.catalogIndexProgressLabel.textContent =
        progress.message || "正在检查 bangumi-data 最新版本...";
    } else if (progress.phase === "done") {
      elements.catalogIndexProgressLabel.textContent = progress.reused
        ? `当前已经是 bangumi-data ${progress.version}，已刷新检查时间。`
        : `索引已替换为 bangumi-data ${progress.version}，共 ${progress.itemCount?.toLocaleString("zh-CN") ?? 0} 条。`;
    } else {
      elements.catalogIndexProgressLabel.textContent =
        progress.message || "正在处理全量索引...";
    }
  }
  if (elements.catalogRefresh) {
    elements.catalogRefresh.disabled =
      state.catalogReplaceLoading || state.loading;
    elements.catalogRefresh.textContent = state.catalogReplaceLoading
      ? "索引处理中"
      : "下载并替换索引";
    elements.catalogRefresh.classList.toggle(
      "is-loading",
      state.catalogReplaceLoading,
    );
  }
}

async function replaceCatalogIndex() {
  if (state.catalogReplaceLoading || state.loading) {
    return;
  }
  state.catalogReplaceLoading = true;
  state.catalogReplaceStartedAt = Date.now();
  state.catalogReplaceLoadedAt = 0;
  state.catalogReplaceProgress = {
    phase: "version",
    message: "正在检查 bangumi-data 最新版本...",
    loaded: 0,
    total: 0,
  };
  renderCatalogIndexProgress();
  try {
    const result = await replaceCatalog({
      onProgress(progress) {
        const now = Date.now();
        const loaded = Number(progress.loaded) || 0;
        const elapsed = Math.max(1, now - state.catalogReplaceStartedAt);
        const previousLoaded = state.catalogReplaceLoadedAt;
        state.catalogReplaceLoadedAt = loaded;
        state.catalogReplaceProgress = {
          ...progress,
          speed:
            progress.phase === "download" && loaded > previousLoaded
              ? loaded / (elapsed / 1000)
              : 0,
        };
        renderCatalogIndexProgress();
      },
    });
    state.catalogReplaceProgress = {
      phase: "done",
      version: result.version,
      itemCount: result.itemCount,
      reused: Boolean(result.reused),
    };
    state.catalogLoaded = false;
    state.metadataIndexedCount = 0;
    state.knownTagsLoaded = false;
    state.knownTagsPromise = null;
    renderCatalogIndexProgress();
    await loadCatalog();
    showToast(
      result.reused
        ? `bangumi-data ${result.version} 已是当前索引`
        : `索引已更新到 bangumi-data ${result.version}`,
      { duration: 6000 },
    );
  } catch (error) {
    state.catalogReplaceProgress = null;
    renderCatalogIndexProgress();
    showToast(`索引替换失败：${error.message}`, { error: true, duration: 7000 });
  } finally {
    state.catalogReplaceLoading = false;
    renderCatalogIndexProgress();
  }
}

async function loadCatalog(options = {}) {
  if (!state.metadataPersonalLoaded) {
    await loadPersonalBangumiCache();
  }
  state.loading = true;
  const sequence = ++requestSequence;
  const requestedPage = state.page;
  elements.catalogRefresh.classList.add("is-loading");
  elements.catalogRefresh.disabled = true;
  elements.catalogStatus.textContent =
    "正在读取索引；首次使用优先使用模板内置数据，并在后台检查更新";
  state.metadataLoading = false;
  renderCatalogRows();

  const offset = (state.page - 1) * state.pageSize;
  const params = new URLSearchParams({
    limit: String(state.pageSize),
    offset: String(offset),
  });
  if (state.query) {
    params.set("q", state.query);
  }
  if (state.years.size) {
    params.set("year", selectedYearValues().join(","));
  }
  if (state.ownership) {
    params.set("owned", state.ownership);
  }
  if (state.source) {
    params.set("source", state.source);
  }
  for (const tag of state.metadataTags) {
    params.append("tag", tag);
  }
  if (state.metadataScoreMin !== "") {
    params.set("scoreMin", state.metadataScoreMin);
  }
  if (state.metadataScoreMax !== "") {
    params.set("scoreMax", state.metadataScoreMax);
  }
  params.set("availability", state.metadataAvailability);
  params.set("sort", state.metadataSort);
  if (options.refresh) {
    params.set("refresh", "1");
  }

  try {
    const payload = await api(`/api/catalog?${params}`);
    if (sequence !== requestSequence) {
      return;
    }
    const pageInfo = getPaginationState(
      payload.total ?? 0,
      state.pageSize,
      requestedPage,
    );
    if (requestedPage > pageInfo.pageCount) {
      state.page = pageInfo.page;
      state.loading = false;
      elements.catalogRefresh.classList.remove("is-loading");
      renderCatalogIndexProgress();
      loadCatalog(options);
      return;
    }
    state.catalogLoaded = true;
    state.total = payload.total ?? 0;
    state.page = pageInfo.page;
    state.pageItems = payload.items ?? [];
    await applyCachedBangumiMetadata(state.pageItems);
    applyCatalogView({ render: false });
    populateFacets(payload.facets);
    renderCatalogSource(payload.meta);
    elements.catalogStatus.textContent = [
      `已加载第 ${state.page} 页`,
      `本页 ${state.pageItems.length} 条`,
      "浏览器本地缓存 24 小时内复用",
    ]
      .filter(Boolean)
      .join(" · ");
    if (options.refresh) {
      showToast("全量索引已检查");
    }
    void hydrateVisibleCovers(sequence);
    void hydrateVisibleMetadata(sequence, {
      refresh: Boolean(options.refreshMetadata),
    });
  } catch (error) {
    if (sequence !== requestSequence) {
      return;
    }
    elements.catalogStatus.textContent = error.message;
    state.pageItems = [];
    state.items = [];
    state.total = 0;
    state.metadataAvailableCount = 0;
    elements.catalogEmptyTitle.textContent = "索引加载失败";
    elements.catalogEmptyText.textContent =
      "请检查网络后重新点击“检查索引更新”。";
    showToast(error.message, { error: true, duration: 7000 });
  } finally {
    if (sequence === requestSequence) {
      state.loading = false;
      elements.catalogRefresh.classList.remove("is-loading");
      renderCatalogIndexProgress();
      renderCatalogRows();
    }
  }
}

function createDraftRow(item) {
  const draft = state.drafts.get(item.id) ?? createDraft(item);
  const section = document.createElement("section");
  section.className = "catalog-draft";
  section.dataset.catalogId = item.id;

  const heading = document.createElement("div");
  heading.className = "catalog-draft-heading";
  heading.append(createCover(item, {
    loading: Boolean(item.sites?.bangumi && !item.coverUrl && !item.coverResolved),
  }));
  const copy = document.createElement("div");
  copy.className = "catalog-draft-copy";
  const title = document.createElement("strong");
  title.textContent = item.displayTitle;
  const meta = document.createElement("span");
  meta.textContent = itemMeta(item);
  copy.append(title, meta);
  heading.append(copy);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "text-button catalog-draft-remove";
  removeButton.textContent = "移除";
  removeButton.addEventListener("click", () => toggleSelection(item));
  heading.append(removeButton);
  section.append(heading);

  const fields = document.createElement("div");
  fields.className = "catalog-draft-fields";
  const ratingField = document.createElement("div");
  ratingField.className = "field catalog-draft-rating";
  const ratingControl = createRatingControl({
    value: draft.rating,
    disabled: !getRuntime().writable,
    onChange: (rating) => {
      draft.rating = rating;
      saveCatalogDraft(item);
    },
  });
  ratingField.append(ratingControl.element);

  const reviewLabel = document.createElement("label");
  reviewLabel.className = "field catalog-draft-review";
  const reviewText = document.createElement("span");
  reviewText.textContent = "短评 / 评价";
  const review = document.createElement("textarea");
  review.maxLength = 20000;
  review.rows = 3;
  review.placeholder = "写下简短的观看感受或完整评价";
  review.value = draft.review;
  review.disabled = !getRuntime().writable;
  review.addEventListener("input", () => {
    draft.review = review.value;
    saveCatalogDraft(item);
  });
  reviewLabel.append(reviewText, review);

  const noteLabel = document.createElement("label");
  noteLabel.className = "field catalog-draft-note";
  const noteText = document.createElement("span");
  noteText.textContent = "备注";
  const note = document.createElement("textarea");
  note.maxLength = 5000;
  note.rows = 2;
  note.placeholder = "内部备注";
  note.value = draft.note;
  note.disabled = !getRuntime().writable;
  note.addEventListener("input", () => {
    draft.note = note.value;
    saveCatalogDraft(item);
  });
  noteLabel.append(noteText, note);

  fields.append(ratingField, reviewLabel, noteLabel);
  section.append(fields);

  const details = document.createElement("details");
  details.className = "catalog-draft-extra";
  const summary = document.createElement("summary");
  summary.textContent = "自定义展示标题";
  details.append(summary);

  const titleLabel = document.createElement("label");
  titleLabel.className = "field";
  const titleText = document.createElement("span");
  titleText.textContent = "展示标题";
  const titleInput = document.createElement("input");
  titleInput.maxLength = 200;
  titleInput.value = draft.title;
  titleInput.disabled = !getRuntime().writable;
  titleInput.addEventListener("input", () => {
    draft.title = titleInput.value;
    saveCatalogDraft(item);
  });
  titleLabel.append(titleText, titleInput);
  details.append(titleLabel);
  section.append(details);

  const source = document.createElement("span");
  source.className = "catalog-draft-id";
  source.textContent = item.id;
  section.append(source);

  const sync = document.createElement("div");
  sync.className = "catalog-draft-sync";
  sync.textContent = pendingCount()
    ? `浏览器已缓存 · 共 ${pendingCount()} 条待提交`
    : "正在加入待提交队列";
  section.append(sync);
  return section;
}

function renderBatchEditor() {
  const items = [...state.selectedItems.values()].reverse();
  elements.catalogEditorEmpty.hidden = items.length > 0;
  elements.catalogBatchForm.hidden = items.length === 0;
  if (!items.length) {
    replaceChildrenSafe("索引选择列表", elements.catalogSelectionList);
    renderSelectionSummary();
    return;
  }
  replaceChildrenSafe(
    "索引选择列表",
    elements.catalogSelectionList,
    ...items.map(createDraftRow),
  );
  renderSelectionSummary();
}

function clearSelection() {
  if (!confirmCatalogDiscard()) {
    return;
  }
  resetSelectionState();
}

function skippedSummary(skipped) {
  if (!skipped.length) {
    return "";
  }
  const reasons = new Map();
  for (const item of skipped) {
    reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  }
  const labels = {
    "catalog-not-found": "索引失效",
    "batch-duplicate": "批次重复",
    "existing-record-id": "已存在",
    "existing-external-id": "站点 ID 已存在",
    "batch-external-id": "批次站点重复",
    "invalid-item": "候选无效",
  };
  return [...reasons.entries()]
    .map(([reason, count]) => `${labels[reason] ?? reason} ${count}`)
    .join("，");
}

async function submitBatch(sync) {
  if (state.busy) {
    return;
  }
  if (!getRuntime().writable) {
    showToast("当前为只读模式，请先连接 GitHub Token", { error: true });
    return;
  }
  persistCatalogDrafts();
  const selectedItems = [...state.selectedItems.values()];
  const pendingBeforeSubmit = readPendingDrafts();
  const editCount = pendingBeforeSubmit.edits.length;
  const additionCount = pendingBeforeSubmit.additions.length;
  state.busy = true;
  clearOperationLogs(
    `准备${sync ? "保存并推送" : "保存"} ${editCount + additionCount} 条记录`,
  );
  appendOperationLog(
    `开始处理：修改 ${editCount} 条，新增 ${additionCount} 条`,
  );
  renderSelectionSummary();
  try {
    // Wait for lazy Bangumi covers so a successful lookup is persisted with the record.
    if (selectedItems.some((item) => !item.coverUrl)) {
      appendOperationLog(`正在检查 ${selectedItems.length} 部番剧的封面信息`);
    }
    await hydrateCatalogCovers(selectedItems);
    persistCatalogDrafts();
    appendOperationLog("封面检查完成，正在提交到数据仓库");
    const payload = await commitPendingDrafts({ sync });
    if (!payload.changed) {
      refreshPendingCatalogDrafts();
      renderBatchEditor();
      appendOperationLog(
        "服务端未检测到有效变更，草稿仍保留在浏览器中",
        "warning",
      );
      showToast("没有可写入的修改或新增记录，草稿仍保留在浏览器中", {
        duration: 6000,
      });
      return;
    }
    const addedCount = payload.addedRecords?.length ?? 0;
    const skippedText = skippedSummary(payload.skipped ?? []);
    const resultText = [
      `已提交 ${payload.updatedRecords?.length ?? 0} 条修改`,
      `新增 ${addedCount} 部`,
      skippedText ? `跳过 ${payload.skipped.length} 部（${skippedText}）` : "",
      payload.sync?.commit ? `已同步 ${payload.sync.commit}` : "",
      payload.syncError ? `同步失败：${payload.syncError}` : "",
    ]
      .filter(Boolean)
      .join("；");
    state.selectedItems.clear();
    state.drafts.clear();
    state.dirty = false;
    refreshPendingCatalogDrafts();
    appendOperationLog(
      `写入完成：修改 ${payload.updatedRecords?.length ?? 0} 条，新增 ${addedCount} 条`,
      "success",
    );
    if (skippedText) {
      appendOperationLog(`已跳过：${skippedText}`, "warning");
    }
    if (payload.sync?.commit) {
      appendOperationLog(`远端同步完成：${payload.sync.commit}`, "success");
    }
    if (payload.syncError) {
      appendOperationLog(`远端同步失败：${payload.syncError}`, "error");
    }
    window.dispatchEvent(
      new CustomEvent("anime-library:changed", {
        detail: {
          selectId: payload.addedRecords?.[0]?.id ?? null,
        },
      }),
    );
    if (addedCount) {
      activateView("library", { force: true });
    }
    showToast(resultText, {
      error: Boolean(payload.syncError),
      duration: payload.syncError ? 8000 : 5000,
    });
  } catch (error) {
    appendOperationLog(`提交失败：${error.message}`, "error");
    appendOperationLog(
      "待提交草稿仍保留在浏览器中，可检查 Token 权限和网络后重试",
      "warning",
    );
    showToast(error.message, { error: true, duration: 7000 });
  } finally {
    state.busy = false;
    renderSelectionSummary();
    renderBatchEditor();
  }
}

for (const button of elements.switchButtons) {
  button.addEventListener("click", () => {
    activateView(button.dataset.view);
  });
}

elements.templateCheckButton?.addEventListener("click", () => checkTemplate(true));
elements.templateUpdateButton?.addEventListener("click", updateTemplate);
elements.templateUpdateLogClear?.addEventListener("click", () =>
  clearTemplateLogs(),
);
elements.catalogOperationLogClear?.addEventListener("click", () =>
  clearOperationLogs(),
);
elements.siteSettingsForm.addEventListener("submit", saveSiteSettings);
elements.siteSettingsForm.addEventListener("change", (event) => {
  if (!event.target.closest("[data-local-appearance-control]")) {
    if (
      event.target === elements.tagRadarEnabled ||
      event.target === elements.tagRadarMode
    ) {
      syncTagRadarControls();
      if (
        event.target === elements.tagRadarMode &&
        elements.tagRadarMode.value === "manual"
      ) {
        void prefillManualTagAxesFromAutomatic();
      }
    }
    applyAppearanceFromForm();
  }
});
for (const link of elements.settingsNav) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    scrollToSettingsSection(link.dataset.settingsNav);
  });
}
window.addEventListener("scroll", scheduleSettingsNavigationUpdate, {
  passive: true,
});
window.addEventListener("resize", scheduleSettingsNavigationUpdate, {
  passive: true,
});
elements.tagRadarMaxAxes.addEventListener("input", () => {
  setTagAxes(readTagAxes());
  applyAppearanceFromForm();
});
elements.tagKnownSearch.addEventListener("input", () => {
  state.knownTagQuery = elements.tagKnownSearch.value;
  renderKnownTagCatalog();
});
elements.tagKnownCatalog.addEventListener("click", (event) => {
  const button = event.target.closest("[data-known-tag]");
  if (!button || button.disabled) {
    return;
  }
  const resolved = resolveManualTagName(button.dataset.knownTag);
  if (!resolved) {
    return;
  }
  const axes = readTagAxes();
  if (axes.length >= tagAxesLimit()) {
    showToast(`最多选择 ${tagAxesLimit()} 个标签`, { error: true });
    return;
  }
  setTagAxes([...axes, resolved.name]);
  applyAppearanceFromForm();
});
elements.tagSelectedAxes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tag-axis-action]");
  if (!button || button.disabled) {
    return;
  }
  const index = Number(button.dataset.tagIndex);
  const axes = readTagAxes();
  if (!Number.isInteger(index) || !axes[index]) {
    return;
  }
  const action = button.dataset.tagAxisAction;
  if (action === "remove") {
    axes.splice(index, 1);
  } else if (action === "up" && index > 0) {
    [axes[index - 1], axes[index]] = [axes[index], axes[index - 1]];
  } else if (action === "down" && index < axes.length - 1) {
    [axes[index + 1], axes[index]] = [axes[index], axes[index + 1]];
  }
  setTagAxes(axes);
  applyAppearanceFromForm();
});

function addCustomTag() {
  const resolved = resolveManualTagName(elements.tagCustomInput.value);
  if (!resolved) {
    return;
  }
  const axes = readTagAxes();
  const existingIndex = axes.findIndex(
    (axis) => tagKey(axis) === resolved.key,
  );
  if (existingIndex >= 0) {
    axes[existingIndex] = resolved.name;
  } else if (axes.length >= tagAxesLimit()) {
    showToast(`最多选择 ${tagAxesLimit()} 个标签`, { error: true });
    return;
  } else {
    axes.push(resolved.name);
  }
  setTagAxes(axes);
  elements.tagCustomInput.value = "";
  applyAppearanceFromForm();
}

elements.tagCustomAdd.addEventListener("click", addCustomTag);
elements.tagCustomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCustomTag();
  }
});
for (const input of [elements.siteTitleInput, elements.siteBrandInput]) {
  input.addEventListener("input", applyAppearanceFromForm);
}
elements.siteSettingsLocalSave.addEventListener("click", saveLocalAppearance);
elements.siteSettingsLocalClear.addEventListener("click", clearLocalAppearance);

elements.catalogSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = elements.catalogSearch.value.trim();
    state.page = 1;
    loadCatalog();
  }, 260);
});

for (const select of [elements.catalogOwnership, elements.catalogSource]) {
  select.addEventListener("change", () => {
    state.ownership = elements.catalogOwnership.value;
    state.source = elements.catalogSource.value;
    state.page = 1;
    loadCatalog();
  });
}

elements.catalogYearOptions.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-catalog-year]");
  if (!input) {
    return;
  }
  if (input.checked) {
    state.years.add(input.value);
  } else {
    state.years.delete(input.value);
  }
  renderYearFilterSummary();
  state.page = 1;
  loadCatalog();
});

elements.catalogYearClear.addEventListener("click", () => {
  if (!state.years.size) {
    return;
  }
  state.years.clear();
  for (const input of elements.catalogYearOptions.querySelectorAll(
    "input[data-catalog-year]",
  )) {
    input.checked = false;
  }
  renderYearFilterSummary();
  state.page = 1;
  loadCatalog();
});

elements.catalogYearClose?.addEventListener("click", () =>
  closeCatalogFilter(elements.catalogYearFilter),
);

elements.catalogTagOptions.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-catalog-tag]");
  if (!input) {
    return;
  }
  if (input.checked) {
    state.metadataTags.add(input.value);
  } else {
    state.metadataTags.delete(input.value);
  }
  state.page = 1;
  loadCatalog();
});

elements.catalogTagClose?.addEventListener("click", () =>
  closeCatalogFilter(elements.catalogTagFilter),
);

elements.catalogTagClear.addEventListener("click", () => {
  if (!state.metadataTags.size) {
    return;
  }
  state.metadataTags.clear();
  state.page = 1;
  loadCatalog();
});

function syncMetadataScoreInput(input) {
  const value = input.value.trim();
  if (!value) {
    return "";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    input.value = "";
    return "";
  }
  const normalized = Math.max(0, Math.min(10, number));
  input.value = String(Math.round(normalized * 10) / 10);
  return input.value;
}

for (const input of [
  elements.catalogMetadataScoreMin,
  elements.catalogMetadataScoreMax,
]) {
  input.addEventListener("change", () => {
    state.metadataScoreMin = syncMetadataScoreInput(
      elements.catalogMetadataScoreMin,
    );
    state.metadataScoreMax = syncMetadataScoreInput(
      elements.catalogMetadataScoreMax,
    );
    if (
      state.metadataScoreMin !== "" &&
      state.metadataScoreMax !== "" &&
      Number(state.metadataScoreMin) > Number(state.metadataScoreMax)
    ) {
      showToast("Bangumi 评分最低值不能高于最高值", { error: true });
      [state.metadataScoreMin, state.metadataScoreMax] = [
        state.metadataScoreMax,
        state.metadataScoreMin,
      ];
      elements.catalogMetadataScoreMin.value = state.metadataScoreMin;
      elements.catalogMetadataScoreMax.value = state.metadataScoreMax;
    }
    state.page = 1;
    loadCatalog();
  });
}

elements.catalogMetadataAvailability.addEventListener("change", () => {
  state.metadataAvailability = elements.catalogMetadataAvailability.value;
  state.page = 1;
  loadCatalog();
});

elements.catalogMetadataSort.addEventListener("change", () => {
  state.metadataSort = elements.catalogMetadataSort.value;
  state.page = 1;
  loadCatalog();
});

elements.catalogMetadataRefresh.addEventListener("click", () => {
  if (state.metadataLoading || !state.pageItems.length) {
    return;
  }
  hydrateVisibleMetadata(requestSequence, { refresh: true });
});

elements.catalogMetadataReload?.addEventListener(
  "click",
  reloadPersonalBangumiCache,
);
elements.catalogMetadataSavePage?.addEventListener(
  "click",
  savePageBangumiCache,
);
elements.catalogMetadataSyncAll?.addEventListener(
  "click",
  mergeLocalBangumiCache,
);
elements.catalogMetadataFetchAll?.addEventListener(
  "click",
  fetchAllBangumiMetadata,
);
elements.catalogMetadataCancelAll?.addEventListener(
  "click",
  cancelAllBangumiMetadata,
);
elements.catalogMetadataSaveAll?.addEventListener(
  "click",
  mergeLocalBangumiCache,
);
elements.catalogMetadataRemovePage?.addEventListener(
  "click",
  removePageBangumiCache,
);
elements.catalogMetadataClearLocal?.addEventListener(
  "click",
  clearLocalBangumiCache,
);
elements.catalogMetadataClearPersonal?.addEventListener(
  "click",
  clearPersonalBangumiCache,
);

elements.catalogYearFilter?.addEventListener("click", () =>
  toggleCatalogFilter(elements.catalogYearFilter),
);
elements.catalogTagFilter?.addEventListener("click", () =>
  toggleCatalogFilter(elements.catalogTagFilter),
);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  for (const filter of [
    elements.catalogYearFilter,
    elements.catalogTagFilter,
  ]) {
    if (filter?.getAttribute("aria-expanded") === "true") {
      closeCatalogFilter(filter);
    }
  }
});

elements.catalogRefresh.addEventListener("click", () => {
  replaceCatalogIndex();
});

elements.catalogPageSize.addEventListener("change", () => {
  if (elements.catalogPageSize.value === "custom") {
    elements.catalogPageSizeCustom.hidden = false;
    elements.catalogPageSizeCustom.value = String(state.pageSize);
    elements.catalogPageSizeCustom.focus();
  } else {
    elements.catalogPageSizeCustom.hidden = true;
    state.pageSize = Number(elements.catalogPageSize.value);
  }
  state.page = 1;
  loadCatalog();
});

elements.catalogPageSizeCustom.addEventListener("change", () => {
  const pageSize = Number(elements.catalogPageSizeCustom.value);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    showToast("自定义每页数量必须是 1 到 200 的整数", { error: true });
    elements.catalogPageSizeCustom.value = String(state.pageSize);
    return;
  }
  state.pageSize = pageSize;
  state.page = 1;
  loadCatalog();
});

for (const button of document.querySelectorAll('[data-layout-target="catalog"]')) {
  button.addEventListener("click", () => {
    state.layout = button.dataset.layout;
    for (const candidate of document.querySelectorAll('[data-layout-target="catalog"]')) {
      candidate.classList.toggle("is-active", candidate === button);
      candidate.setAttribute("aria-pressed", String(candidate === button));
    }
    renderCatalogRows();
  });
}

elements.catalogPreviousPage.addEventListener("click", () => {
  state.page = Math.max(1, state.page - 1);
  loadCatalog();
});

elements.catalogNextPage.addEventListener("click", () => {
  state.page += 1;
  loadCatalog();
});

elements.catalogClearSelection.addEventListener("click", clearSelection);

elements.catalogSelectAll.addEventListener("change", () => {
  const selectable = state.items.filter((item) => !item.ownedRecordId);
  if (elements.catalogSelectAll.checked) {
    for (const item of selectable) {
      if (state.selectedItems.size >= MAX_BATCH_SIZE) {
        showToast(`单次最多选择 ${MAX_BATCH_SIZE} 部番剧`, { error: true });
        break;
      }
      if (!state.selectedItems.has(item.id)) {
        state.selectedItems.set(item.id, item);
        state.drafts.set(item.id, createDraft(item));
        void hydrateSelectedCover(item);
      }
    }
  } else {
    for (const item of selectable) {
      state.selectedItems.delete(item.id);
      state.drafts.delete(item.id);
    }
  }
  persistCatalogDrafts();
  state.dirty = pendingCount() > 0;
  renderCatalogRows();
  renderBatchEditor();
});

elements.catalogBatchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitBatch(false);
});

elements.catalogSyncButton.addEventListener("click", () => {
  submitBatch(true);
});

window.addEventListener("beforeunload", (event) => {
  persistCatalogDrafts();
});

window.addEventListener("anime-runtime:changed", () => {
  refreshRuntimeLibrary();
  persistCatalogDrafts({ silent: true });
  restorePendingAdditions();
  state.dirty = pendingCount() > 0;
  state.catalogLoaded = false;
  state.settingsLoaded = false;
  state.items = [];
  state.pageItems = [];
  state.total = 0;
  state.page = 1;
  state.metadataLoading = false;
  state.metadataTags.clear();
  state.metadataScoreMin = "";
  state.metadataScoreMax = "";
  state.metadataAvailability = "all";
  state.metadataSort = "default";
  state.metadataAvailableCount = 0;
  state.metadataPersonalCount = 0;
  state.metadataPersonalSize = 0;
  state.metadataPersonalUpdatedAt = null;
  state.metadataPersonalLoaded = false;
  state.metadataIndexedCount = 0;
  state.metadataPersonalLoading = false;
  personalCacheSequence += 1;
  personalCachePromise = null;
  state.metadataEntries.clear();
  state.metadataBrowserCount = 0;
  state.metadataLocalCount = 0;
  state.metadataLocalSize = 0;
  state.facetsLoaded = false;
  state.years.clear();
  state.ownership = "";
  state.source = "";
  elements.catalogOwnership.value = "";
  elements.catalogMetadataScoreMin.value = "";
  elements.catalogMetadataScoreMax.value = "";
  elements.catalogMetadataAvailability.value = "all";
  elements.catalogMetadataSort.value = "default";
  replaceChildrenSafe("年代筛选选项", elements.catalogYearOptions);
  replaceChildrenSafe("Bangumi 标签选项", elements.catalogTagOptions);
  renderYearFilterSummary();
  renderCatalogTagOptions();
  renderCatalogMetadataStatus();
  for (const select of [elements.catalogSource]) {
    while (select.options.length > 1) {
      select.options.remove(1);
    }
    select.value = "";
  }
  if (state.view === "catalog") {
    loadCatalog();
  }
  loadSiteSettings({ force: true, silent: state.view !== "settings" });
  renderBatchEditor();
});

window.addEventListener("anime-pending:changed", (event) => {
  const source = event.detail?.source;
  const drafts = event.detail?.drafts;
  if (source === "clear" && pendingCount(drafts) === 0) {
    state.pendingDrafts = drafts ?? { edits: [], additions: [] };
    state.selectedItems.clear();
    state.drafts.clear();
    state.dirty = false;
    renderCatalogRows();
    renderBatchEditor();
    return;
  }
  if (["catalog", "editor"].includes(source)) {
    return;
  }
  persistCatalogDrafts({ silent: true });
  restorePendingAdditions();
  state.dirty = pendingCount() > 0;
  renderCatalogRows();
  renderBatchEditor();
});

window.addEventListener("anime-catalog:changed", () => {
  if (state.view === "catalog") {
    loadCatalog();
  }
});

window.addEventListener("anime-admin:dom-warning", (event) => {
  appendTemplateLog(event.detail?.message ?? "页面节点缺失，已跳过一次更新", "warning");
});

restorePendingAdditions();
state.dirty = pendingCount() > 0;
renderBatchEditor();
void loadSiteSettings({ force: true, silent: true });
