const repository =
  process.env.TEMPLATE_REPOSITORY || "zjsycwmrbig/MyAnimeLife";
const token = String(process.env.GITHUB_TOKEN ?? "").trim();
const apiRoot = `https://api.github.com/repos/${repository}`;

function headers() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "myanimelife-template-check",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, { allowNotFound = false } = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
    headers: headers(),
  });
  if (response.status === 404 && allowNotFound) {
    return null;
  }
  if (!response.ok) {
    const body = (await response.text()).replace(/\s+/gu, " ").trim();
    throw new Error(
      `GitHub API ${response.status}: ${body.slice(0, 240)}`,
    );
  }
  return response.json();
}

const metadata = await request("");
const [animeFile, indexFile, bangumiCacheFile, publicCatalogFile, publicSnapshotFile, backups] = await Promise.all([
  request("/contents/data/anime.jsonl", { allowNotFound: true }),
  request("/contents/data/anime-index.jsonl", { allowNotFound: true }),
  request("/contents/data/bangumi-cache.jsonl", { allowNotFound: true }),
  request("/contents/admin/bangumi-public-catalog.json", { allowNotFound: true }),
  request("/contents/admin/bangumi-public.json", { allowNotFound: true }),
  request("/contents/data/backups", { allowNotFound: true }),
]);

const issues = [];
if (metadata.private !== false) {
  issues.push("仓库必须是公开状态");
}
if (metadata.is_template !== true) {
  issues.push("Settings > General > Template repository 尚未启用");
}
if (metadata.default_branch !== "main") {
  issues.push(`默认分支应为 main，当前为 ${metadata.default_branch}`);
}
if (!animeFile) {
  issues.push("data/anime.jsonl 尚未创建");
} else if (Number(animeFile.size) !== 0) {
  issues.push(`data/anime.jsonl 应为空，当前 ${animeFile.size} 字节`);
}
if (!indexFile) {
  issues.push("data/anime-index.jsonl 尚未创建");
} else if (Number(indexFile.size) !== 0) {
  issues.push(`data/anime-index.jsonl 应为空，当前 ${indexFile.size} 字节`);
}
if (!bangumiCacheFile) {
  issues.push("data/bangumi-cache.jsonl 尚未创建");
} else if (Number(bangumiCacheFile.size) !== 0) {
  issues.push(
    `data/bangumi-cache.jsonl 应为空，当前 ${bangumiCacheFile.size} 字节`,
  );
}
if (!publicCatalogFile || Number(publicCatalogFile.size) === 0) {
  issues.push("admin/bangumi-public-catalog.json 尚未创建，模板缺少初始公共索引");
}
if (!publicSnapshotFile || Number(publicSnapshotFile.size) === 0) {
  issues.push("admin/bangumi-public.json 尚未创建，模板缺少初始 Bangumi 缓存");
}
if (
  !Array.isArray(backups) ||
  backups.some((entry) => entry.type === "file" && entry.name.endsWith(".json"))
) {
  issues.push("data/backups 中不应包含 JSON 备份");
}

if (issues.length > 0) {
  console.error(`公开模板仓库尚未就绪：${repository}`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exitCode = 1;
} else {
  console.log(`公开模板仓库检查通过：${repository}`);
  console.log("- 仓库公开");
  console.log("- Template repository 已启用");
  console.log("- 默认分支为 main");
  console.log("- 个人 JSONL 与备份目录为空");
  console.log("- 模板内置公共索引与 Bangumi 元数据缓存");
  console.log("- 新仓库创建时仍应保持 Include all branches 未勾选");
}
