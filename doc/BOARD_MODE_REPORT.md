# 白板模式 MVP 报告（图教分离）

> 2026-10-27 ｜ 目标：验证「先定板书 → 老师看着真板说话 → 学生答对后同板揭晓」能否根治 V8 的三大死结
> 结论：**管线级死结已消（三盏红灯归零），剩余问题全部转为内容正确性**，与 V8 报告预判一致。

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
| `scripts/board-probe.ts` | 板先行探针：每轮两次调用（先定板、再说话），3 轮生命周期，确定性审计（泄题 / 指着空气 / 复述率） |
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
【白板｜提问态（有留白）】图型 split-compare，标题「配速换算」
- 左栏「常见错法」：1.400 m 跑 60 s 2.60 ÷ 400 = 0.15 3.0.15 分钟/千米 4.0.15 min/km
- 右栏「正确做法」：1.（空槽） 2.（空槽） 3.（空槽） 4.（空槽）
底部结论：未揭晓（学生答对后再补上）
共 4 个空槽待学生补。规则：只谈板上已有的内容与空槽，不要替学生补空槽，不要描述图的画法。
```

---

## 四、实测：三案例 × 三轮

案例：#1 配速（split-compare）／#16 浮力（concept-map）／#28 商鞅变法（state-strip）。

### 4.1 迭代过程（四轮，问题都是实测出来的）

| 版本 | 改动 | 发现 |
|---|---|---|
| v1 | 让绘图员直接画「提问态」 | **问反了**：fullSpec 里本来就是 `?`，揭晓时没东西可补 |
| v2 | 改为画**完整板**，引擎派生提问态 | 揭晓生效（槽位 4/1/12），但盲评 5 张全 fix、泄题 20% |
| v3 | 提示词补三条（板要覆盖学生问题的对象 / 否定关系画虚线 / 结论不重复） | **盲评泄题 75%**：模型把答案写进了 `sub` 副标注（「深度变，F浮 不变」「秒没换成分钟」） |
| v4 | **提问态撤掉所有副标注**（`stripSecondaryAnnotations`）+ 揭晓轮禁止追问板上已有答案 | 三盏红灯归零 |

### 4.2 最终指标（v4）

| 指标 | V8 图教合一 | 白板模式 | 口径 |
|---|---|---|---|
| 提问态泄题 | 17%（视觉盲评） | **0 处 / 0%** | 确定性：揭晓时才补回的 13/10/9 项内容，老师提问轮一次都没说；外部盲评同判 0% |
| 指着空气说话 | 多例（#15/#16/#27 图文不一致） | **0 处** | 确定性：回复里的「第 n 行/帧」序号与板上实际行数比对 |
| 伪视觉（装框文字） | 10% | **0%** | 外部盲评 |
| 元认知话术 | 10% | **0%** | 外部盲评 |
| 复述率（回复与板面文字的二阶重合） | 被批「把图念一遍 7~8 行」 | 最高 **17%**（0.17/0.09/0.09） | 确定性 |
| 保留 / 要修 / 删掉（盲评 6 张） | — | 0 / 4 / 0 | 三张揭晓态与一张提问态因内容错误被判要修 |

### 4.3 老师话术的实际变化

V8（指着不存在的行）：

> 「看图右边第 3 行…」（右边只有 1 行）

白板模式（引用板上真实标签）：

> 「看左栏从「60 ÷ 400 = 0.15」跳到「0.15 分钟/千米」这两步：60 和 400 各自带的是什么单位？」
> 「看板上「浸入深度 h」连到「浮力大小 F浮」的那条线，关系名还空着。」
> 「先看「前356 立木为信」这一帧。」

---

## 五、剩余问题（诚实记录）

1. **内容正确性**（盲评 4 张「要修」全在此）：浮力那张概念图把「ρ液 × g × V排」的汇聚框标成了「物体自重 G物」，按图读出来就是 `自重 = ρgV` —— 与事实相反的因果。这不是白板范式能解决的，需要**知识校验层**（用上游 `kcGraph` / 物理公式量纲交叉核验），与 V8 报告结论一致。
2. **左栏结论重复**：配速板把「0.15 分钟/千米」既写在行里又写成结论行（模型自身重复），提示词已要求「同一句结论不要写两遍」，仍需归一化侧的重复检测。
3. **反事实问题无板可依**：商鞅第三轮问「不立木会怎样」，板上只有真实发生的一条顺链，没有「有信/无信」的分叉——这类问题需要另一种图型（分支对比），属于图型能力上限。
4. **盲评接口不稳**：6 次评审调用里 2 次返回非 JSON（上游偶发），已计入未判。

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
cd backend && npx ts-node --transpile-only scripts/board-probe.ts ../outputs/e2e/board-cases.json ../frontend/figure-out/board-v4.json 1

# 2. 渲染两态（提问态 / 揭晓态）
cd frontend && node node_modules/vite-node/vite-node.mjs scripts/figure-pages.ts figure-out/board-items.json figure-out/board-pages
node ../outputs/e2e/render-pngs.mjs figure-out/board-pages figure-out/board-pngs

# 3. 白板容器 demo
node ../outputs/e2e/board-demo.mjs

# 4. 外部盲评
node ../outputs/e2e/vision-review.mjs frontend/figure-out/board-review-items.json frontend/figure-out/board-pngs outputs/e2e/board-review-v4.json BOARD4
```

测试：`board-state` 13 条 + `board-controller` 11 条 + 脱敏回归 95 条全绿。
