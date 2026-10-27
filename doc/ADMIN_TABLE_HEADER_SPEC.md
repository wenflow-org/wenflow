# Admin 表头与工具条规格（ADMIN_TABLE_HEADER_SPEC，v1）

> 📌 类型：活规范｜最后核验：2026-10-27｜索引见 [doc/README.md](./README.md)。
> 范围：`frontend/src/views/admin-redesign/` 下所有「表头区」= 卡头工具条（`.mk-card__head`）
> + 列头（`<thead>`）。
> 分工：页面骨架节奏见 [ADMIN_VISUAL_LAYER_SPEC.md](./ADMIN_VISUAL_LAYER_SPEC.md) §2；
> 列宽机制见 [ADMIN_COLUMN_WIDTH_SPEC.md](./ADMIN_COLUMN_WIDTH_SPEC.md)；本文只回答一件事——
> 表头区在成熟设计体系里长什么样，本仓如何落地，以及哪些口径已被 `design:check` 钉死。

---

## 0. 结论

成熟产品的表格工具条最终都收敛成同一套语法：**一行工具条，左侧范围，右侧检索与次级工具；
列头吸顶、可排序；数字右对齐；批量操作以「替换工具条」出现，而不是在工具条里再塞一排按钮。**

本仓 2026-10-15 的拍板（搜索进右组首位）与这套语法一致。所以本轮不是重做，而是收口：
补齐列头语义（`scope` / `aria-sort`）、消除页面私有的对齐类、把能机器判的契约写进
`design:check`，避免下一次改表又回到各页一套。

---

## 1. 成熟设计体系怎么做

| 体系 | 工具条 | 列头 | 选择态 |
|---|---|---|---|
| IBM Carbon `DataTable` | 标题在左；右侧搜索 / 筛选 / 设置；筛选标签在工具条下 | 可排序、可吸顶、可调列宽 | 选中行后批量条**替换**工具条 |
| Shopify Polaris `IndexTable` | `IndexFilters`：搜索 + 筛选 + 排序 + 视图；范围 tabs 在左 | 排序表头、行内操作 | 批量操作条替换筛选区 |
| Ant Design `Table` / ProTable | 标题与主操作在左；右侧密度 / 列设置 / 全屏 / 刷新；搜索表单独立一行 | 排序、固定列、可调列宽 | 批量选择后出现批量工具条 |
| Material Design 3 | 不规定工具条；筛选 chips 置于表格上方 | 文本左对齐、数字右对齐 | 选中后上下文操作条 |
| Atlassian Design System | 工具条含搜索与筛选；范围切换在左 | 排序、粘性表头 | 批量操作条 |
| GitHub Primer | 表格上方单一筛选输入；排序在列头 | 粘性表头、排序 | 行选择 + 批量条 |
| Microsoft Fluent 2 `DataGrid` | 工具条 + 列设置 | 排序、列宽调整、粘性表头 | 批量操作条 |

收敛出的四条不变量：

1. **一行工具条**：左范围 / 右检索与次级工具；搜索不藏进弹层。
2. **列头是表格的一部分**，不是第二套工具栏：排序、对齐、粘性都在列头内解决。
3. **数字右对齐、文本左对齐**；操作列与数字列同侧右对齐。
4. **批量选择替换工具条内容**，不在工具条里并列批量按钮（本仓由 `.mk-batchbar` 承担）。

---

## 2. 本仓口径：卡头工具条

```
┌ .mk-card__head ─────────────────────────────────────────────────────────────┐
│ 左组 .mk-filter（吃剩余宽度）                右组 .mk-card__head-right（贴右缘）│
│ 范围 chips → 次级快筛 → 清除筛选/恢复默认序   搜索 → 页级动作 → 列 → 筛选 → meta │
└────────────────────────────────────────────────────────────────────────────┘
```

**硬约束**

1. **一行，不折两行**。1440 放不下时把放不进主栏的次级筛选收进右侧「筛选」弹层
   （`.mk-adv`），不要靠抬高行高或换行解决。
2. **左组 `.mk-filter`**：范围 chips（状态 / 生命周期）→ 次级快筛开关 → `清除筛选` /
   `恢复默认排序`（`.mk-link`）。chips 计数只留别处没有的；总数归分页器，构成计数归分布条。
3. **右组 `.mk-card__head-right`**：搜索 → 页级动作（如「全部重算」）→ 列（`MkCols`）→
   筛选弹层（仅当有次级筛选）→ 计数 meta（仅当说分页器没有的事实）。**搜索永远在右组首位**，
   一律行内，不藏弹层。
4. **控件高度**：搜索框 32px；`.mk-btn--sm` 与搜索同高（由
   `.mk-card__head-right .mk-btn { align-self: stretch }` 兜底）；chips 允许略矮，但同一行
   垂直居中。不要出现「搜索 32 / 按钮 28 / 链接 20」三种基线。
5. **没有的槽位不硬造**：没有次级筛选就不放「筛选」；没有可隐藏列就不放「列」。

---

## 3. 本仓口径：列头（`<thead>`）

**硬约束**

1. **每个 `<th>` 声明 `scope`**：列表头 `scope="col"`；行表头 `scope="row"`。
   没有它，读屏软件无法把单元格与列关联。
2. **可排序列**：`th.mk-th--sortable` + `aria-sort`（`none` / `ascending` / `descending`）
   + 内层 `button.mk-th__btn` + `span.mk-th__caret`。整格可点，按钮负责键盘与 AT。
3. **对齐**：文本左对齐；数字列 `td.mk-num`（表头同加 `.mk-num`，或 `th.mk-th--right`）；
   操作列 `th.mk-th--right`。**禁止页面私有 `.right` / `.left`**——它们不受列宽与暗色规则约束。
4. **粘性表头**：表格放进 `.mk-table-scroll`，并由 `.mk-page--fill` + `.mk-card--fill`
   提供纵向滚动区（`mk-primitives.css` 已把 `th` 设为 `sticky; top:0`）。不要在页面里另造吸顶。
5. **列宽**：列多或需要跨页对齐的表用 `.mk-table--fixed` + `<colgroup>` + `--mk-col-*`
   token（契约见 ADMIN_COLUMN_WIDTH_SPEC §1）；简单列表可自动布局（`.mk-table--nowrap`），
   但操作列仍须 `mk-th--right`。
6. **长文本**给 `title` 全值，截断走 `.mk-cell-main` / `.mk-cell-text`，不要用表头换行换高度。
7. **表头只靠底线分层**：`background: var(--mk-table-head-bg)` + `1px` 底线 + `faint` 灰 +
   `700`；不做大写眉标、不加图标墙、不加第二层底色。

---

## 4. 守卫（`npm run design:check`）

三条硬失败规则（无基线，新写一处即断）在 `frontend/scripts/check-design-system.mjs`：

| 规则 | 判据 |
|---|---|
| 20 | admin 页面每个 `<th>` 必须声明 `scope` |
| 21 | `th.mk-th--sortable` 必须带 `aria-sort` |
| 22 | `.mk-table--fixed` 必须配 `<colgroup>` |

规则 20/21 用引号感知的标签切分，属性表达式里出现 `>`（如 `:title="a > b"`）不会误判。
规则 22 按「表」而不是按文件检查。

---

## 5. 收口记录（2026-10-27）

- 列头 `scope`：349 个 `<th>` 中缺失 216 个 → **0**（含 `skill-design/` 子页签）。
- 可排序 `<th>` 缺 `aria-sort`：**0**。
- `.mk-table--fixed` 缺 `<colgroup>`：**0**。
- 页面私有对齐类：ExecLogs 耗时列 `.right` → `mk-th--right` / `mk-num`，并删除重复的
  `.exec-table th.right, .exec-table td.right` 规则。
- 工具条槽位：20 个列表页已按「左 chips / 右 search → actions → cols → 筛选 → meta」排布，
  与 2026-10-15 拍板一致。

---

## 6. 明确不做（本轮边界）

- **不给所有表强加列设置**。列设置是「列多且可隐藏」的页面能力，Polaris / Primer 也没有
  默认列设置；Feedback / Announcements / Notifications / OpsAchievements 等 6–8 列表
  可按需再接 `MkCols`，不属表头一致性缺陷。
- **不改排序箭头的可见性**。原型 `sortmark` 只让活跃列显示箭头，非活跃列 hover 给 0.35
  可发现性，属已拍板口径；改成常显会与原型偏离。
- **不抽 `MkThSort` 组件**。排序标记虽重复，但每页排序状态机不同；守卫先保证语义一致，
  抽组件应与 `useTableSort` 一起做，避免只抽一半。
- **不改工具条控件形态**。「列」用文字链接、「筛选」用带边框小按钮，是因为后者还要承载
  生效计数；两者都属次级工具，位置与槽位序才是本文约束的对象。
