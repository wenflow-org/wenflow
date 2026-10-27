# 教学图评审包：给 LLM 的几种发法

**问题**：`outputs/v8-review.html` 832KB，实测约 **20.7 万 token**（其中 20 万来自 30 张图的 base64 内嵌）。直接贴给模型既超限也没必要——真正有价值的判词只有几十行。

**根因**：HTML 把 30 张 PNG 转 base64 内嵌（膨胀 1.33×），再套一层重复 CSS/结构。图的「字节」和「信息」被混在一起了。

---

## 一、单文件（复制即用）

```bash
node outputs/e2e/llm-brief.mjs v8 --table
```

产出 **`outputs/V8-review-brief-table.md`**（9KB，**约 3000 token**）。这是最推荐的形态：一个文件，直接复制粘贴或上传给模型，里面已经包含

- 总览（30 张、保留/要修/删、三档均分、三个红灯）
- 按图型汇总表（哪个图型最容易出问题）
- 逐图总表：`#序号 · 图型 · 课程 · 判词 · 有用/几何/可读 · 最该修`（每行一条具体病灶）

三档详略，按需要选：

| 命令 | 文件 | 体积 | token | 内容 |
|---|---|---|---|---|
| `--table` | `V8-review-brief-table.md` | 9KB | **约 3.0K** | 汇总 + 逐图表（最推荐） |
| `--compact` | `V8-review-brief-compact.md` | 24KB | 约 7.8K | 每图展开（spec/原话截短） |
| （默认） | `V8-review-brief.md` | 52KB | 约 16.6K | 每图展开（spec 300 字 + 老师原话 260 字） |
| `--table --inline` | `V8-review-brief-table-withfigs.md` | 304KB | 约 7.8 万 | 表格 + 拼版图 base64 内嵌（**只在必须单文件带图时用**） |

加 `--only=fix,drop` 只保留问题图（30 → 18 张）。

---

## 二、要模型「看图」时（多文件）

```bash
node outputs/e2e/llm-pack.mjs v8 outputs/pack --only=fix,drop
```

产出：

1. **`figures-sheet-N.png`** — 3×2 拼版，每格左上角烧 `#序号` 徽标（与清单对得上）。格宽 480px、pal8 调色板。30 张只需 5 张拼版，**约 3.2K token**。
2. **`manifest.md`** — 8KB 清单，一图一行。
3. **`figures.json`** — 逐图结构化数据（spec 截 600 字、对话截 400 字）。

把 `manifest.md` + 拼版 PNG 一起发（约 5.8K token），模型既能看到图，又能读到判词。

---

## 为什么这样省

- **图片走视觉 token，不走文本 token**：一张 1472×464 的拼版约 406 token；同样内容的 base64 字符串是它的 **100 倍**（4 万 token）。
- **拼版代替单张**：30 张单图逐张发，光图就 30 × 400 ≈ 12K token，还要 30 次往返；拼成 5 张只要 3.2K，而且一次看完——横向比较恰恰是判断「图好不好」最需要的。
- **文字与图分离**：判词、病灶走纯文本（CJK 约 1 字 1 token），不塞进图片。要读判词读清单，要看图看图。
- **pal8 + 480px**：教学图是白底纯色块 + 文字，256 色调色板几乎无损失，体积降 5~8 倍。

## 什么时候仍用 HTML

`v*-review.html` 保留给**人**看：可点击、可滚动、单图大图对照。它是给人读的交付物，不是喂模型的输入。

## 发之前先量一下

```bash
node outputs/e2e/token-estimate.mjs outputs/V8-review-brief-table.md
```

口径（保守，偏高估）：CJK/全角 1 字 ≈ 1 token，其余 4 字符 ≈ 1 token，base64 每 4 字符 ≈ 1 token，图片按 `ceil(w/1.5)*ceil(h/1.5)/750`。
