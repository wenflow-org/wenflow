# 白板模式 MVP 报告（图教分离）

> 2026-10-27 ｜ 目标：验证「先定板书 → 老师看着真板说话 → 学生答对后同板揭晓」能否消除 V8 的三大死结
> 结论：**管线级的三个死结已消**（老师不再指着不存在的行、不再复述、提问态不再泄题）；
> **但内容与几何承载没有随范式自动变好**——外部盲评仍在 1 分档，且同一批图两次评审结论不稳定。
> 本报告对 4.2/4.3 的数字做了更正，上一版「三盏红灯归零」的说法只对**确定性审计**成立。

---

## 一、要解决的问题（来自 V8 报告）

| 死结 | 表现 | 根因 |
|---|---|---|
| 图文不一致 | 老师说「右列有两个对象，b 和 c 由你补」，图上只有一个对象（#27）；说「两条虚线」图上全是实线 | 同一模型调用里既写话术又凑 spec，话里的图 ≠ 实际 JSON，且 spec 还会被归一化静默裁剪 |
| 泄题 / 残缺二选一 | 提问时画上答案=泄题（17%）；挖成 `?` 又永远残缺，学生答对后也看不到完整图 | 图是一次性静态附件，没有「揭晓」这个动作 |
| 话术啰嗦 | 老师先把整张图用文字复述一遍（7~8 行），最后才挤出一句追问 | 每轮新发一张图，只能靠文字把图「说一遍」 |

---

## 二、架构：板先行（Board-First → Teach-Second）

```
① 代码裁决本轮控制信号（出题 / 出图 / 锚题 / 修复）
        │
② 板书层
   ├─ board-designer：产出**完整板**（骨架 + 正确答案 + 结论）
   ├─ normalizeFigure + 图闸：与线上同一条归一化路径
   └─ deriveBoardFigure：派生**提问态**（答案位 → ?、副标注撤掉、结论藏起）
        │  产出 verifiedBoard = 归一化、已脱敏、100% 确定的真实板书
③ 教学层（teaching-turn）
   ├─ 输入：对话历史 + describeBoardForTeacher(verifiedBoard)   ← 老师看到的就是学生看到的
   └─ 输出：reply + analysis + control（**不再负责画图**）
④ 学生答对（checkpointVerdict.passed 或 filledSlot）
        │
⑤ reveal：同一块板切完整态，空槽补上、结论上板（不新建图）
```

两种拆法的取舍：**先说话后配图（A）** 会重现「老师说看图、图却被闸门拦了」；**先定板后说话（B）** 才能保证老师说的每句话都对应板上真实存在的东西。本原型采用 B。

---

## 三、代码结构（可直接对照）

| 文件 | 职责 |
|---|---|
| `services/ai-teaching/teaching-visual.service.ts` | 新增 `maskFigureAnswers()`：按图型**无条件**挖空（与 `maskFigureForQuestion` 共用同一套 per-kind 规则，后者只负责「这一轮该不该挖」的触发判断） |
| `services/ai-teaching/board-state.ts` | 两态构造 `deriveBoardFigure`、开板 `openBoard`、揭晓 `revealBoard`、指板 `focusBoard`、**老师可见描述** `describeBoardForTeacher`、两态差异 `diffBoardStages` |
| `services/ai-teaching/board-controller.ts` | 状态机 `decideBoardOp`：`setup`（建板）/ `reveal`（揭晓）/ `focus`（指板）/ `none`（不动），判据全部来自代码事实 |
| `skills/teaching-turn/index.ts` | `split-compare` 两条内容侧修复：delta 结论上限放宽到 44 字（22 字会切在半句上）；标签点名「第 n 步」时覆盖模型给的 `at`（v5 实拍文字说第二步、高亮落在第一步） |
| `scripts/board-probe.ts` | 板先行探针：每轮两次调用（先定板、再说话），3 轮生命周期，确定性审计（泄题 / 指着空气 / 复述率） |
| `scripts/board-items.ts` | 两态 → 渲染项目；`--renormalize` 用当前归一化重放旧运行的完整板（纯函数，不调模型） |
| `outputs/e2e/board-demo.mjs` | 白板容器 demo：左板（提问态/揭晓态切换）+ 右聊，本轮板书动作标注 |

### 关键字段

```ts
BoardFigureState {
  kind, fullSpec, maskedSpec,      // 两态：揭晓态 / 提问态
  hiddenTakeaway,                  // 被藏到揭晓态的结论（takeaway / delta / note）
  slots,                           // 待填空槽数
  stage: 'setup' | 'awaiting' | 'revealed',
  focusId,                         // 老师指向的锚点
}
BoardState { taskId, figure, revision, lastReveal }
```

`describeBoardForTeacher(board)` 输出的是**学生在白板上此刻看到的东西**，例如：

```
【白板｜提问态（有留白）】图型 split-compare，标题「配速换算：60 s 跑完 400 m 该得多少」
- 左栏「常见错法」：1.400 m 用时 60 s 2.60 ÷ 400 = 0.15 3.读成 0.15 分钟/千米
- 右栏「正确做法」：1.（空槽） 2.（空槽） 3.（空槽）
底部结论：未揭晓（学生答对后再补上）
共 3 个空槽待学生补。规则：只谈板上已有的内容与空槽，不要替学生补空槽，不要描述图的画法。
```

---

## 四、实测：三案例 × 三轮

案例：#1 配速（split-compare）／#16 浮力（concept-map）／#28 商鞅变法（state-strip）。

### 4.1 迭代过程（六轮，问题都是实测出来的）

| 版本 | 改动 | 发现 |
|---|---|---|
| v1 | 让绘图员直接画「提问态」 | **问反了**：fullSpec 里本来就是 `?`，揭晓时没东西可补 |
| v2 | 改为画**完整板**，引擎派生提问态 | 揭晓生效，但盲评 5 张全 fix、泄题 20% |
| v3 | 提示词补三条（板要覆盖学生问题的对象 / 否定关系画虚线 / 结论不重复） | **盲评泄题 75%**：模型把答案写进了 `sub` 副标注（「深度变，F浮 不变」「秒没换成分钟」） |
| v4 | **提问态撤掉所有副标注**（`stripSecondaryAnnotations`）+ 揭晓轮禁止追问板上已有答案 | 确定性三灯归零；盲评 4 条已判全 fix |
| v5 | 重跑（写这段时上游恢复）+ 修两处内容侧：delta 结论 22→44 字、浮力汇聚框不再错标 | 结论句完整；浮力图因果正确（四因素直连浮力，无关项中性色） |
| v6 | 「第 n 步」标签覆盖模型给的 `at`（v5 实拍：文字说第二步、高亮在第一步） | 高亮行与句子一致；渲染重放只改 `delta.at` 一处 |

### 4.2 确定性审计（管线层，v5 运行）

| 指标 | V8 图教合一 | 白板模式 v5 | 口径 |
|---|---|---|---|
| 提问态泄题 | 17%（盲评） | **0 处** | 揭晓时才补回的内容（本运行 8 项），老师在提问轮一次都没说 |
| 指着空气说话 | 多例（#15/#16/#27 图文不一致） | **0 处** | 回复里的「第 n 行/帧」序号与板上实际行数比对 |
| 复述率（回复与板面文字的二元组重合） | 被批「把图念一遍 7~8 行」 | 最高 **0.19**（0.19/0.07/0.11） | 确定性 |
| 板书动作 | — | 建板→揭晓→不动（3/3 案例） | 状态机输出的 op 序列 |

**这一层是白板范式真正解决的部分**：老师的输入就是 `describeBoardForTeacher()` 的文本，没有第二次「生成图」的机会，因此不可能出现「话里的图 ≠ 实际图」。

### 4.3 外部盲评（内容层，**与上一版报告结论不同**）

同一套判据、同一个模型、同一批图，**两次评审结论不稳定**：

| 轮次 | 已判 | 保留/要修/删掉 | 有用/几何/可读 | 泄题 | 伪视觉 | 元话 |
|---|---|---|---|---|---|---|
| v4（6 条，2 条上游非 JSON 未判） | 4 | 0/4/0 | 1.50 / 1.00 / 2.50 | 0% | 0% | 0% |
| v6-a | 6 | 0/0/6 | 1.00 / 1.17 / 3.00 | 33% | 67% | 0% |
| v6-b（同输入重跑） | 6 | 0/2/4 | 0.83 / 0.83 / 2.67 | 17% | 50% | 0% |

逐条一致性：**verdict 4/6 相同，leak 5/6 相同，redundant 5/6 相同**。也就是说单条判词大致稳定，但 n=6 时百分比会摆动 ±17~33 个百分点——**「某版 0%」这种结论在 n=6 下不成立**。

上一版报告写的「盲评泄题 0%」是这么来的：v4 那一轮 6 次调用里 2 次返回非 JSON 被排除，被排除的恰好是商鞅板的两态；这两条在 v6 两次复测里**都判 leak=true**。因此正确的说法是：v4 已判的 4 条泄题为 0，未判的 2 条一直判有。

两次 v6 都指出、且属于内容层而非管线层的问题：

1. **商鞅板的标题与帧名就是答案**（两次都判 leak）：「先取信，再分两步推开」+ 首帧名「立木为信 · 取信」，正是老师这一轮要学生自己说出的「他真正想先拿到的是什么」。**提问态只挖了 `items`，没管 `title` / 帧名 / 节点名**。
2. **换题后板没跟着换**（b1 揭晓态两次都提）：老师第二轮拿 800 m / 4 min 的新题，板上仍是上一题 400 m 的完整解答。不是泄题，是「板与当前问题不同步」。
3. **几何承载仍然不足**（伪视觉 50~67%）：「商鞅三帧」换成分号句信息不损失；浮力四因素等权并列，没有画出「深度变、排开体积不变」这层对照。

### 4.4 老师话术的实际变化（v5 实拍）

V8（指着不存在的行）：

> 「看图右边第 3 行…」（右边只有 1 行）

白板模式（引用板上真实标签）：

> 「先盯住左栏最后那行「读成 0.15 分钟/千米」——整道题的岔口就在这儿。」
> 「我们先钉住板上那条 **浸入深度 h → 浮力**。」
> 「先看「立木为信 · 取信」这一格……这恰恰是这一格留空、等你填的地方。」

---

## 五、剩余问题（诚实记录）

1. **板面文字泄题（标题/帧名/节点名）**：提问态只处理了答案位与副标注，标题和标签照发。商鞅板是最直接的反例。修法两条——board-designer 提示词改成「标题只点题、帧名用中性指代（里正/乡邻/官府）而不是结论词」；归一化侧需要一张结论词表来做确定性拦截，属于**知识校验层**。
2. **板与问题不同步**：揭晓后老师换新题，板仍是旧题的画面。需要 `board-controller` 在「换题」信号上走 `setup` 新建板，而不是保持 `revealed`。
3. **几何承载不足**：部分板仍是「把句子装进框」（伪视觉 50~67%）。这是图型能力上限，不是白板范式能解决的。
4. **「无关」的边仍连到浮力节点**：v5 改成了中性灰，但几何上仍然是「四个因素都连向浮力」，与「深度、重量不参与」这句结论打架。
5. **盲评样本量与稳定性**：n=6 时百分比不可作结论，需要 ≥20 条/版；上游偶发非 JSON（v4 6 次里 2 次）。

---

## 六、落地到引擎的步骤（本原型未做，避免影响主树运行中的课堂）

1. `TeachingSessionRepository` 的 payload 增加 `boardState`（`BoardState`），与 `figures` 并存、按 `taskId` 存续。
2. `teaching-turn-engine.processStudentMessage()` 第 3~6 步之间插入板书层：**调用 board-designer → normalizeFigure → 图闸 → deriveBoardFigure**，把 `describeBoardForTeacher()` 注入 `TeachingTurnInput.boardContext`。
3. `teaching-turn` 提示词做减法：移除 visualOpportunity 的图型指南全文，改为「只谈板上内容」的播放规则；输出 schema 去掉 `figure`（保留兼容字段用于 board-designer 失败时的降级）。
4. 前端 `V2LearningPage.vue`：把 `TeachingFigure.vue` 提升为常驻白板区，消息气泡只留「白板已更新 / 老师指向了…」标签。
5. 闸门 5/6/7（会话上限、图型配额、同骨架去重）在白板模式下自然失效——同骨架不再是重复发图，而是同一块板的 focus/reveal。

---

## 七、复现

```bash
# 1. 板先行探针（3 案例 × 3 轮；每轮 2 次调用）
cd backend && npx ts-node --transpile-only scripts/board-probe.ts ../outputs/e2e/board-cases.json ../frontend/figure-out/board-v5.json 1

# 2. 两态 → 渲染项目（规范化重放：只重放完整板，提问态由派生规则重出）
cd backend && npx ts-node --transpile-only scripts/board-items.ts ../frontend/figure-out/board-v5.json ../frontend/figure-out/board-items.json --renormalize

# 3. 渲染两态（提问态 / 揭晓态）
cd frontend && node node_modules/vite-node/vite-node.mjs scripts/figure-pages.ts figure-out/board-items.json figure-out/board-pages-v6
node ../outputs/e2e/render-pngs.mjs figure-out/board-pages-v6 figure-out/board-pngs-v6

# 4. 白板容器 demo
node ../outputs/e2e/board-demo.mjs

# 5. 外部盲评（同一批图建议跑两遍看摆动）
node ../outputs/e2e/board-review-items.mjs ../frontend/figure-out/board-v5.json
node ../outputs/e2e/vision-review.mjs frontend/figure-out/board-review-items.json frontend/figure-out/board-pngs-v6 outputs/e2e/board-review-v6.json BOARD6
```

测试：`board-state` 13 条 + `board-controller` 11 条 + 脱敏回归 95 条 + 归一化 45 条全绿。

---

## 八、评审通道：为什么不再走 PDF

PDF 的问题不在排版，在**通道混用**：人要看，模型也要看，于是双方都被同一个文件拖累。

- 人看 PDF：12 页、逐页翻，改一条判词要重排版再重出；
- 模型看 PDF：必须先渲染成页图，12 页 ≈ 7.7k token（且判词写在图上，模型还得 OCR）；
- 退而求其次把整页 HTML 贴给模型：base64 图片直接把一份报告推到 **55.8 万 token**——这才是「网页 token 太大」的真正原因。

改成两条通道后，各自只承担自己该承担的：

| 产物 | 给谁 | 体积 | 估算 token |
|---|---|---|---|
| `outputs/board-review/index.html` | 人（浏览器打开，本地起静态服务） | 33KB，**无 base64** | 不消耗（不进模型） |
| `outputs/board-review/brief.md` | 模型 | 2KB | ~800 |
| 浏览器里勾完「导出结论」 | 模型（贴回来） | ~0.4KB | ~200 |
| 六张两态图（可选，逐张喂） | 模型 | 140KB | ~520 |

关键约束：**HTML 里不出现 `data:image`**，图片一律走 `<img src="images/…">`。这样页面可以随手复制/粘贴/存档，而体积只跟文字有关；需要给模型看图时，单独给那几张 PNG，而不是把图塞进文档。

评审台做了三件 PDF 做不到的事：

1. **两态切换**（并排 / 只看提问态 / 只看揭晓态）——单态时图放大到整栏宽，专看留白画得对不对；
2. **逐条勾判 + 一句话备注**，存在 `localStorage`，刷新不丢；
3. **导出即结论**：点一下得到 `board-review-result.md`（约 400B），贴回来就能接着改；旁边还附「机器简报」（盲评两次的判词），所以下一轮不需要重新跑一遍评审。

生成：`node outputs/e2e/board-review-app.mjs`（读 `board-run-v5.json` + `board-pngs-v6-2x`，输出 `index.html` / `brief.md` / `images/`）。
图片目录被 `.gitignore` 的 `*.png` 挡住，**换机器要重跑这条命令**才能看到图。
