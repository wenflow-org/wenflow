# Admin 列宽规范（ADMIN_COLUMN_WIDTH_SPEC，v1 · 2026-09-25 追认成文）

> 📌 类型：活规范｜最后核验：2026-09-28（审计 48/48 全中，原地保留）。索引见 [doc/README.md](./README.md)。

> 状态：**先有实现、后补本文**。mk-primitives.css / main.css 的注释自 09 月起引用
> 「ADMIN_COLUMN_WIDTH_SPEC §2/§3」，但该文件一直未创建（09-25 对账发现）。
> 本文把已落地的实现口径集中成文；§号沿用代码注释里的既有引用（§2 token、§3 工具类与契约）。

## 1. 机制契约（改表格前必读，违反即出列宽事故）

`.mk-table--fixed`（`table-layout: fixed` + `width: 100%`）下：

1. **列宽是比例，不是绝对值**：容器余量按各列声明的基准宽**等比摊分**。
   基准合计 < 容器 → 全表等比放大；合计 > 容器 → 全表等比缩小且可能出现横向溢出。
2. **每列都必须给宽度**：漏写 colgroup = 全部列等分容器
   （MemoryReview 曾因此 10 列各 118px，2 位数数字列白占 118px、行高 108px）。
3. **各列基准合计必须 ≤ 容器宽**（1440 下 1182px；口径见 VISUAL_LAYER_SPEC §7 的 1184 卡宽）
   ——PromptEval 曾合计 1310px，整表横向溢出 128px。
4. 想让某列多拿宽度，只能提高它的基准占比；长文本列（主标识列）是唯一该吸收余量的列，
   长度不可预测的成对文本列用 `.mk-col--flex`（min/max 档）。

## 2. 列宽 token（单一来源，三档同步改）

定义处：`main.css :root`（基准）+ `mk-primitives.css` 的 2000px / 3600px 两个媒体块（×≈1.16 / ×1.4）。
**改档位必须三处同步。**

| token | 基准 | 2000 | 3600 | 用途 |
|---|---|---|---|---|
| `--mk-col-xs`→`--mk-col-id` | 128 | 148 | 180 | ID/短码（8-12 字符 + …，长 ID 先 shortId()） |
| `--mk-col-time` | 72 | 84 | 100 | 纯时刻 HH:mm:ss |
| `--mk-col-time-full` | 110 | 128 | 154 | 相对时间 / 含日期短戳 |
| `--mk-col-datetime` | 176 | 205 | 246 | 完整日期时间（mono） |
| `--mk-col-text-sm` | 168 | 195 | 235 | 短文本：阶段/类别/目标类型/「observe · 11 小时前」 |
| `--mk-col-text` | 320 | 372 | 448 | 长文本列基准 |
| `--mk-col-badge` | 64 | 76 | 90 | 状态徽章（≤3 字） |
| `--mk-col-num` | 56 | 64 | 78 | 纯数字（右对齐） |
| `--mk-col-num-wide` | 108 | 130 | 156 | 组合数字（12,345 · 6,789） |
| `--mk-col-model` | 116 | 140 | 168 | 模型名/技能名 |
| `--mk-col-model-wide` | 140 | 165 | 195 | 长模型名（含别名标注） |
| `--mk-col-actions` | 72 | 84 | 100 | 操作列：1 按钮 |
| `--mk-col-actions-wide` | 120 | 140 | 168 | 操作列：2-3 按钮 / 含 ⋯ 菜单 |
| `--mk-col-flex-min/max` | 180/720 | 220/840 | 240/1000 | 弹性列上下限 |
| `--mk-cell-main-max` | 260 | 300 | 360 | `mk-cell-main` 主行截断上限 |

（09-25 注：badge/num 的名义预算未计单元格左右 padding 24px，3 字徽章/带排序箭头的 3 字表头
会差 10-20px，靠等比放大兜底；若某列渲染后贴边，优先升档而不是加像素。）

## 3. 工具类与对齐契约

- 工具类 `.mk-col--id/-time/-time-full/-datetime/-text-sm/-text/-badge/-num/-num-wide/
  -model/-model-wide/-actions/-actions-wide/-flex`（mk-primitives.css）：只管宽度；
  字体/对齐归 `.mono` / `.mk-num` / `.mk-badge`，职责不重叠。
- **数字列**：th + td 都加 `.mk-num`（右对齐 + mono + tabular-nums；`.mk-table` 的 td/th
  现已默认 tabular-nums，`.mk-num` 额外给右对齐与 nowrap）。
- **fixed 表内 `.mk-num`/`.mk-actions` 的 min-width 被归零**（`.mk-table--fixed .mk-num`）：
  列宽即契约，min-width 会把 56px 数字列撑溢出 16px、右对齐数字越过列缘挤进邻列 padding。
- 排序表头：`.mk-th--sortable` + `aria-sort`，箭头由 CSS 画（`.mk-th__caret`），表头 nowrap
  是列宽的事实下限——3 字表头 + 箭头 ≈ 62px，`--mk-col-num`(56) 列会贴边。
- 截断三件套：`.mk-ellipsis` / `.mk-cell-text(-lg)` / `.mk-cell-main strong`（上限
  `--mk-cell-main-max`），长路径类单元格一律给 `title` 全值。
