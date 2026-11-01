import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const readAdminFile = (path) =>
  fs.readFile(new URL(`../admin/${path}`, import.meta.url), "utf8");

test("catalog batch submission uses its own pending draft refresh", async () => {
  const source = await readAdminFile("catalog.js");

  assert.match(source, /function refreshPendingCatalogDrafts\(\)/u);
  assert.match(source, /refreshPendingCatalogDrafts\(\);/u);
  assert.doesNotMatch(source, /\brefreshPendingDrafts\b/u);
});

test("catalog clear events cannot restore submitted selections", async () => {
  const source = await readAdminFile("catalog.js");
  const clearGuard = source.match(
    /if \(source === "clear" && pendingCount\(drafts\) === 0\) \{([\s\S]*?)\n  \}/u,
  );

  assert.ok(clearGuard);
  assert.match(clearGuard[1], /state\.selectedItems\.clear\(\)/u);
  assert.match(clearGuard[1], /state\.drafts\.clear\(\)/u);
  assert.match(clearGuard[1], /state\.dirty = false/u);
  assert.match(clearGuard[1], /renderBatchEditor\(\)/u);
});

test("catalog operation log panel is wired into the batch workflow", async () => {
  const [source, html, styles] = await Promise.all([
    readAdminFile("catalog.js"),
    readAdminFile("index.html"),
    readAdminFile("styles.css"),
  ]);

  assert.match(source, /function appendOperationLog\(/u);
  assert.match(source, /clearOperationLogs\(/u);
  assert.match(source, /提交失败：\$\{error\.message\}/u);
  assert.match(html, /id="catalogOperationLogPanel"/u);
  assert.match(html, /id="catalogOperationLogList"/u);
  assert.match(styles, /\.catalog-operation-log/u);
});

test("settings page uses a scroll-spy outline for one continuous form", async () => {
  const [html, styles, source] = await Promise.all([
    readAdminFile("index.html"),
    readAdminFile("styles.css"),
    readAdminFile("catalog.js"),
  ]);

  assert.match(html, />站点设置</u);
  assert.doesNotMatch(html, />站点样式</u);
  assert.match(html, /class="settings-nav"[\s\S]*?aria-label="设置大纲"/u);
  assert.doesNotMatch(html, /role="tablist"/u);
  assert.doesNotMatch(html, /role="tab"/u);
  assert.doesNotMatch(html, /role="tabpanel"/u);
  assert.match(html, /id="settingsTabTags"/u);
  for (const section of ["site", "display", "share", "tags", "local-cache"]) {
    assert.match(html, new RegExp(`data-settings-nav="${section}"`, "u"));
    assert.match(html, new RegExp(`data-settings-section="${section}"`, "u"));
    const sectionTag = html.match(
      new RegExp(`<section[^>]*data-settings-section="${section}"[^>]*>`, "u"),
    )?.[0];
    assert.ok(sectionTag);
    assert.doesNotMatch(sectionTag, /\bhidden\b/u);
  }
  assert.match(styles, /\.settings-nav \{[\s\S]*?position: sticky;/u);
  assert.match(styles, /\.settings-nav::before/u);
  assert.match(styles, /\.settings-nav a\.is-active::before/u);
  assert.match(styles, /\.site-settings-form \{[\s\S]*?border: 1px solid/u);
  assert.doesNotMatch(styles, /\.settings-section\[hidden\]/u);
  assert.match(source, /function activateSettingsSection\(/u);
  assert.match(source, /function scrollToSettingsSection\(/u);
  assert.match(source, /function updateSettingsNavigation\(/u);
  assert.match(source, /scheduleSettingsNavigationUpdate/u);
  assert.match(source, /aria-current", "location"/u);
});

test("tag preference editor separates selected tags from a heat-ranked pool", async () => {
  const [html, styles, source] = await Promise.all([
    readAdminFile("index.html"),
    readAdminFile("styles.css"),
    readAdminFile("catalog.js"),
  ]);

  assert.match(html, /id="tagManualEditor"/u);
  assert.match(html, /id="tagSelectedAxes"/u);
  assert.match(html, /class="tag-picker-group tag-picker-selected"/u);
  assert.match(html, /class="tag-picker-group tag-pool"/u);
  assert.match(html, /id="tagKnownSearch"/u);
  assert.match(html, /id="tagKnownCatalog"/u);
  assert.match(html, /id="tagPoolSummary"/u);
  assert.match(html, /id="tagCustomInput"/u);
  assert.match(html, /按公共番剧索引中的总热度排序/u);
  assert.match(source, /readKnownBangumiTags/u);
  assert.match(source, /function renderKnownTagCatalog\(/u);
  assert.match(source, /function resolveManualTagName\(/u);
  assert.match(source, /const existingIndex = axes\.findIndex/u);
  assert.match(source, /axes\[existingIndex\] = resolved\.name/u);
  assert.match(source, /import \{ calculateTagRadar \}/u);
  assert.match(source, /function prefillManualTagAxesFromAutomatic\(/u);
  assert.match(source, /api\("\/api\/bangumi-cache"\)/u);
  assert.match(source, /elements\.tagRadarMode\.value === "manual"/u);
  assert.match(source, /data-tag-axis-action/u);
  assert.match(styles, /\.tag-picker-group/u);
  assert.match(styles, /\.tag-pool-meta/u);
  assert.match(styles, /\.known-tag-chip/u);
  assert.match(styles, /\.tag-selected-list/u);
});

test("recommendation covers keep a loading state and no-referrer policy", async () => {
  const source = await readAdminFile("../scripts/similar.js");

  assert.match(source, /function appendCoverImage\(cover, coverUrl, title\)/u);
  assert.match(source, /image\.referrerPolicy = "no-referrer"/u);
  assert.match(source, /const coverUrl = safeCoverUrl\(item\.coverUrl\)/u);
  assert.match(source, /hydrateCover\(item, cover\)/u);
});

test("Bangumi cache controls use page refresh, repository supplement, and collapsed full fetch modes", async () => {
  const [source, html, styles] = await Promise.all([
    readAdminFile("catalog.js"),
    readAdminFile("index.html"),
    readAdminFile("styles.css"),
  ]);

  assert.match(html, /id="catalogMetadataRefresh"[^>]*>\s*本页重新获取/u);
  assert.match(html, /id="catalogMetadataUpdateRepository"/u);
  assert.match(html, /<details id="catalogMetadataFetchOptions"/u);
  assert.match(html, /id="catalogMetadataFetchIncremental"/u);
  assert.match(html, /id="catalogMetadataFetchFull"/u);
  for (const removedId of [
    "catalogMetadataReload",
    "catalogMetadataSavePage",
    "catalogMetadataSyncAll",
    "catalogMetadataSaveAll",
    "catalogMetadataRemovePage",
    "catalogMetadataClearLocal",
    "catalogMetadataClearPersonal",
  ]) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`, "u"));
  }
  assert.match(source, /function updateRepositoryBangumiCache\(/u);
  assert.match(source, /mode: "supplement"/u);
  assert.match(source, /resolveAllBangumiMetadata\(items, \{\s*refresh,/u);
  assert.match(styles, /\.catalog-metadata-fetch-options/u);
});
