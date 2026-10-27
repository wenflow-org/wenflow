# 教学图评审包：给 LLM 的三种发法

**问题**：`outputs/v8-review.html` 832KB，实测约 **20.7 万 token**（其中 20 万来自 base64 内嵌图）。直接贴给模型既超限也没必要——真正有价值的判词只有几十行。

**根因**：HTML 把 30 张 PNG 转 base64 内嵌（膨胀 1.33×），再套一层重复 CSS/结构。图的「字节」和「信息」被混在一起了。

**解法**：把图和文字拆开，各自用最省的形态。

| 用法 | 命令 | 体积 | token（实测估算） | 适用 |
|---|---|---|---|---|
| 全量评审 | `node outputs/e2e/llm-pack.mjs v8` | 229KB | **约 5.8K** | 一次性看完全部 30 张 |
| 只看问题图 | `node outputs/e2e/llm-pack.mjs v8 outputs/pack-fix --only=fix,drop` | 147KB | **约 3.8K** | 讨论「哪几张要改」 |
| 指定几张 | `node outputs/e2e/llm-pack.mjs v8 outputs/pack-one --n=3,20` | 19KB | **约 1.8K** | 深挖单张（含 spec 与对话） |

对比原 HTML：**20.7 万 → 5.8K token，压 36 倍**。

## 产物是什么

1. **`figures-sheet-N.png`** — 3×2 缩略拼版，每格左上角烧了 `#序号` 徽标。格宽 480px、pal8 调色板（白底纯色图几乎无损失），6 张图拼一张，30 张只需 5 张拼版、约 3.2K token。
2. **`manifest.md`** — 8KB 紧凑清单，一图一行：`#序号 · 图型 · 课程 · 判词 · 有用/几何/可读 · 最该修`。模型读这一份就能做整体判断。
3. **`figures.json`** — 逐图结构化数据（spec 截前 600 字、该轮对话截 400 字），需要精确引用某张图的细节时才发。

## 为什么这样省

- **图片走视觉 token，不走文本 token**：一张 1472×464 的拼版按 Anthropic 分块公式约 406 token；同样内容的 base64 字符串是它的 100 倍。
- **拼版代替单张**：30 张单图逐张发，光是图就 30 × 400 ≈ 12K token，还有 30 次往返；拼成 5 张只要 3.2K 且一次看完，天然支持横向比较（这恰恰是「图好不好」判断最需要的）。
- **文字与图分离**：判词、病灶用纯文本（CJK 约 1 字 1 token），不塞进图片；需要看图时看图，需要读判词时读清单。
- **pal8 + 480px**：教学图是白底纯色块 + 文字，256 色调色板几乎无损失，体积降 5~8 倍。

## 什么时候仍要用 HTML

`v*-review.html` 保留给**人**看：可点击、可滚动、单图大图对照。它是给人读的交付物，不是喂模型的输入。

## 附带工具

`outputs/e2e/token-estimate.mjs` 可估算任意文件/图片的 token（保守口径，偏高估），用来在发之前先量一下：

```bash
node outputs/e2e/token-estimate.mjs outputs/llm-pack/manifest.md outputs/llm-pack/*.png
```
