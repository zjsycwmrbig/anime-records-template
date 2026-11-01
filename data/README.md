# 数据编辑规范

`data/anime.jsonl` 是唯一的个人番剧记录数据源。每行是一条完整 JSON 记录，构建时从中生成网页和 `dist/data/library.json`。`data/anime-index.jsonl` 是派生索引，用于网页列表和油猴端重复检测，不要手工编辑。`data/bangumi-cache.jsonl` 保存 Bangumi 评分、评分人数、排名和标签的个人缓存，不属于番剧记录。

模板默认不包含任何个人番剧，`data/anime.jsonl`、`data/anime-index.jsonl` 和个人 `data/bangumi-cache.jsonl` 都是空的。模板会预置两份不属于个人记录的公共资产：`admin/bangumi-public-catalog.json` 是可离线启动的 Bangumi 全量索引，`admin/bangumi-public.json` 是 Bangumi 评分、排名和标签快照。它们来自维护者最新个人数据仓库中的公共索引/缓存，在新仓库创建后可以直接使用；需要时再从管理页主动更新。

推荐用本地管理页维护：

```bash
npm run admin
```

打开 `http://127.0.0.1:4174/admin/` 后，可以直接搜索、编辑评分和评价、批量删除，并一键提交到本地 Git 再推送到 origin。

个人记录只应写入通过 `Use this template` 生成的个人仓库。上游模板必须始终保持三个 JSONL 和备份目录为空；GitHub 没有对 Fork 隐藏指定已跟踪数据的功能，Fork 还会复制完整提交历史。

## 用全量索引发现作品

管理页顶部的“全量索引”视图会惰性加载公共 `bangumi-data` 目录。第一次进入时从 jsDelivr 下载，失败会回退到 unpkg；合并后的规范化缓存保存在 `.cache/bangumi-data.catalog.json`，该文件不会进入 Git。

缓存默认在 24 小时内直接复用。需要检查新版本时，可以重新进入视图或点击“检查索引更新”。公共目录只用于搜索和选择，不会批量写入个人记录。

可使用中文标题、日文原名、其他译名、年份、来源站点或 Bangumi/Bilibili/AniList/MAL ID 搜索。选中候选后：

1. 确认默认的中文展示标题，也可以改成自己的标题。
2. 按需填写 `0` 到 `10` 的评分、评价和备注。
3. 点击“添加到我的档案”，页面会写入完整 JSONL、重建轻量索引，并在内容变化时创建备份。

添加前会同时检查记录 `id` 和所有外部站点 ID。任一索引已经存在时不会创建重复记录。不同季度应选择不同的候选记录；季度信息会作为记录身份的一部分保留。

`bangumi-data` 当前通常没有封面地址，因此候选封面为空是正常情况。管理页会先读取索引自带的封面字段，再对当前分页缺少封面的 Bangumi 条目惰性请求并缓存到浏览器；这类临时封面补全不会写入 JSONL 索引。

## Bangumi 评分与标签个人缓存

发现页的 Bangumi 信息先读取模板内置的 Bangumi Archive 静态快照，必要时再请求 Bangumi API。结果默认写入浏览器 IndexedDB，并标记为本机待保存；这不等于已经进入个人仓库。全量索引首次打开时也会先读取模板内置索引，再在后台检查 `bangumi-data` 是否有新版本。

展开“Bangumi 评分与标签”后可以管理两层缓存：

- `保存本页`：把当前页已有信息合并到 `data/bangumi-cache.jsonl`。
- `合并本机`：把浏览器内所有待保存条目合并到个人仓库。
- `移除本页`：只从个人缓存删除当前页的 Bangumi 条目，不删除番剧、评分或评价。
- `清空本机`：清除 IndexedDB 临时层，然后重新载入个人仓库缓存。
- `清空个人`：清空个人仓库的 Bangumi 缓存并创建一次提交，不影响番剧记录。

缓存以 Bangumi `subjectId` 为唯一键。合并时同一键只保留一条，`fetchedAt` 较新的值胜出。文件不是追加日志，每次保存都会写回规范化后的完整 JSONL；实际操作 `data/` 时应先提交或备份已有修改。

模板更新会保留整个 `data/` 目录，因此 `data/bangumi-cache.jsonl` 会随个人记录和备份一起保留。上游模板仓库必须始终让个人数据 JSONL 保持为空；公共初始索引和快照放在 `admin/` 下，不会成为新用户的个人记录。

## 新增记录

1. 启动管理页并确认当前仓库地址和分支。
2. 在“全量索引”中选择作品并添加，或从“我的记录”编辑已有条目。
3. 如果油猴脚本已配置个人仓库，也可以在网页中完成识别并保存评分或评价。
4. 需要完全自定义记录时，手动向 `data/anime.jsonl` 末尾追加一行完整 JSON 对象。
5. 运行 `npm run validate`，确认完整数据与索引一致。
6. 需要发布时运行 `npm run build`、提交并推送。

不要只修改索引。完整数据是源，索引必须由完整数据重建。构建器会逐字段比较当前索引和完整数据的确定性重建结果，不一致时直接失败。

## ID 与季度

`id` 创建后不要修改。推荐使用稳定的站点索引：

```text
bili-ss129142
bili-292073015
bgm-525565
manual-01jabcdef
```

不同季度必须使用不同 `id`。`season.number` 和 `season.label` 必须同时填写或同时为 `null`，并保留稳定的 `season.key`：

```json
{
  "season": {
    "key": "bili-ss129142",
    "number": 2,
    "label": "第2季",
    "year": 2026
  }
}
```

旧记录可以不包含 `season`，构建器会按“季度未知”处理。油猴脚本在确认匹配后可以补充季度字段；季度不同不应触发重复提醒。

## 需要人工维护的字段

- `title`：希望公开展示的名称
- `rating`：个人评分；无评分时必须是 `null`
- `review`：个人评价，可使用 Markdown
- `note`：个人备注，可使用 Markdown
- `coverUrl`：可选封面链接
- `season`：可选季度身份，包含稳定的 `key`、季度编号、显示标签和年份

## 由识别流程维护的字段

- `externalIds.bangumi`
- `externalIds.bilibiliMedia`
- `externalIds.bilibiliSeason`
- `externalIds.anilist`
- `externalIds.mal`
- `season.key`
- `season.number`
- `season.label`
- `season.year`
- `match.status`
- `match.method`
- `match.source`
- `match.confidence`
- `match.matchedTitle`
- `match.matchedAt`

`match` 和 `externalIds` 保持结构化，不要写进 `note`。这样油猴脚本可以直接根据站点 ID 查找记录，不需要重新解析文本。

## 匹配状态

| 值 | 含义 |
|---|---|
| `matched` | 已通过站点 ID、标题或 AI 完成匹配 |
| `manual` | 用户手动建立或手动选择 |
| `unmatched` | 尚无可靠索引 |

## 匹配方式

| 值 | 含义 |
|---|---|
| `site-id` | Bilibili、Bangumi 等站点 ID 精确命中 |
| `title-exact` | 标题或别名精确命中 |
| `title-fuzzy` | 模糊搜索后确认 |
| `ai` | AI 结合页面上下文推断后确认 |
| `manual` | 手动搜索或输入 |
| `import` | 从其他数据源批量导入 |

## 覆盖、索引与备份

管理页和油猴保存都使用覆盖式写入：

- 同一 `id` 只保留一条记录；油猴同步时较新的 `updatedAt` 胜出。
- 每次实际修改前生成一个备份快照。
- 快照同时保存 `animeText` 和 `indexText`，恢复时可以作为一个一致版本处理。
- 默认最多保留 5 个 `data/backups/library-*.json`。
- 完整文件和索引文件不使用追加写入，避免重复行越积越多。

## 软删除

暂时不想展示记录时，添加：

```json
{
  "deletedAt": "2026-10-25T12:00:00Z"
}
```

构建器会跳过该番剧的页面和公开接口条目。删除这个字段或改为 `null` 即可恢复。

本地管理页的“删除所选”会直接从完整 JSONL 中移除记录，并在覆盖前创建备份。需要可恢复的隐藏状态时，应手动使用 `deletedAt`。

## 统计与仓库公开索引

公开站点的 `/insights/` 页面会根据完整记录生成收录窗口、最近 12 个月、年代、评分和索引覆盖统计。统计使用 `createdAt` 判断收录时间，使用 `season.year` 判断作品年代；季度未知的记录会归入“年份未知”。

仓库 PK 只读取对方公开仓库中的 `data/anime-index.jsonl`，不会下载对方的完整评价文件。匹配时优先使用记录 `id`，其次使用双方共有的外部站点 ID。不同季度必须使用不同的稳定 ID；同一个外部 ID 不应被多个季度复用。

分享链接格式为 `insights/?peer=owner/repository&branch=main`。访客打开后会自动填入分享者仓库并开始比较。分享者的 `repository.slug` 为空时分享按钮不可用；GitHub Pages 构建会自动填充它，本地构建则需要在 `config/site.json` 中配置。

## Markdown

`review` 和 `note` 支持常用 Markdown。构建时禁用原始 HTML，并自动为外部链接添加 `rel="noreferrer noopener"`。

如果需要展示代码，可以正常使用行内代码和代码块，但不要依赖内联 HTML 排版。
