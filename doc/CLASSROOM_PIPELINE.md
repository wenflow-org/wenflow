# 课堂管线与评价管线（单文件）

> 口径：本文描述的是**当前分支代码的真实调用链**（文件/函数可直接对照），不是设计稿。
> 基线：`feat/teaching-figures` @ `5c9cb712`（2026-10-27）。
> 配套：`CLASSROOM_SKILLS.md`（课堂用到的提示词全文合集）。

---

## 0. 两条线在一张图上

```
                         ┌─────────────── 评价管线（离线，不进课堂） ───────────────┐
                         │                                                          │
   课前的课 ────────────▶│  ① 探针：真路由跑 N 个案例 × 3 轮                          │
                         │  ② 确定性审计：泄题 / 指空 / 复述（代码算，不看模型）        │
                         │  ③ 外部盲评：把图 + 那一轮对话交给视觉模型，按判据打分        │
                         │  ④ 人工评审台：勾判 + 一句话备注 → 导出 ~0.4KB 结论          │
                         │  ⑤ 判定：确定性为准，盲评只作参照（n<20 时百分比不稳）        │
                         └───────────────────────────▲──────────────────────────────┘
                                                     │ 改提示词 / 改闸门 / 改渲染
                                                     │
   学生一句话 ─▶ 路由 ─▶ 编排层 ─▶ 引擎 8 步 ─▶ skill ─▶ 归一化 ─▶ 闸门 ─▶ 落库 ─▶ 前端
                            │                              ▲
                            └──────────────────────────────┴── 板书层（2026-10-27 新增）：
                                                                先定板 → 老师看着真板说话
```

一次性讲清：**课堂管线决定「这一刻说什么、画什么、发不发得出去」；评价管线决定「上一版改得对不对」**。两条线共享同一份图型契约（15 种）和同一个渲染器（`render.ts`）。

---

## 1. 课堂管线

### 1.1 入口与返回

```
POST /api/ai-teaching/sessions/:sessionId/messages        routes/ai-teaching.routes.ts:867
  → AITeachingCoordinator.processStudentMessage()          AITeachingCoordinator.ts:246
  → teaching-turn-engine.processStudentMessage()           teaching-turn-engine.ts:245
```

路由层负责鉴权、参数校验、幂等键、`revision` 期望值；编排层负责虚拟学习者旁路与分发；引擎是主链路。

一回合的应答包含：`aiResponse`（reply / analysis / figure）、`checkpoint`、`figures`、`wrapup`、`revision`、`knowledgeState`。

### 1.2 一回合的八步

| # | 做什么 | 代码位置 | 失败时 |
|---|---|---|---|
| 1 | 会话租约（2 分钟操作租约 + 心跳续租） | `claimOperation`（engine:283） | 409 BUSY，客户端重试 |
| 2 | 重建上下文（每回合重建，不缓存） | `buildTeachingScenarioContext`（engine:309） | 抛错即中止 |
| 3 | **代码裁决**本轮控制信号（出题？出图？锚题？修复？） | `shouldEmitCheckpoint` / `resolveAnchorProbeTarget` / `buildVisualOpportunity`（engine:365-400） | 无信号则纯语言推进 |
| 4 | 调 skill（提示词 + 本轮输入） | `executeSkill(teachingTurnAgentDefinition, turnInput)`（engine:~420） | 300s 超时兜底 |
| 5 | 归一化出口（字段白名单 + 图型校验 + 图内算式复算） | `normalizeOutput()` / `normalizeTeachingFigure` | 不合规的字段/图直接丢弃 |
| 6 | 引擎闸门链（10 道，见 §1.7） | engine:900 起 | 逐道降级：不出图 / 脱敏 |
| 7 | 落库 `teaching_session_messages`（含 `payload.figures`、`figureSource`） | `TeachingSessionRepository` | 幂等键重放 |
| 8 | 返回前端 | `V2LearningPage.vue` → `TeachingFigure.vue` → `render.ts` | 渲染失败给空态，不影响文字 |

### 1.3 输入：`TeachingTurnInput`

定义在 `src/skills/teaching-turn/index.ts:62`。五组：

| 组 | 字段 | 谁填 |
|---|---|---|
| 对话 | `messages`（可带 `images`，只作模型可见历史） | 引擎（经 `fenceLearnerMessagesForModel` 围栏） |
| 学习者 | `learner`（画像投影） | `TeachingContextBuilder` |
| 场景 | `scenario.subject/topic/taskTitle/taskDescription/taskType/taskProfile` | 上下文重建 |
| 场景-教学法 | `scenario.currentTaskContext` / `cognitiveFrame` / `teachingStrategyGuidance` / `taskKcs` | 上游 stage-designer / kc-mapper / path-reviewer |
| 场景-材料 | `scenario.materials` / `activeTaskMaterialExcerpts` / `supplementaryMaterial` | 材料链 + 教师补充槽晋升 |
| 控制 | `controls`（五信号） | **代码**裁决，见 §1.5 |
| 图 | `visualOpportunity`（图型建议 + 触发原因） | `buildVisualOpportunity` |
| 板书 | `boardContext` / `boardAction` | 板书层（§1.6，接线中） |

### 1.4 输出：`TeachingTurnOutput`

定义在 `src/skills/teaching-turn/index.ts:338`：

| 字段 | 含义 | 下游 |
|---|---|---|
| `reply` | 老师这一轮说的话 | 直接给学生；同时过「复述率」「指空」审计 |
| `analysis` | 学情判读（掌握度信号） | 写回 `teaching_state`，影响下一轮节奏 |
| `knowledge` | 知识点状态更新 | 看板 |
| `pedagogy` | 本轮教学法意图 | 评审/日志 |
| `control` | `checkpoint` / `supplement` / …… | 代码决定是否真的出题 |
| `figure` | 图 spec（15 种白名单） | 归一化 → 闸门 → 渲染 |
| `diagram` / `visual` | 字符结构图 / 扩散生图（2026-09-27 默认停用） | 保留兼容 |

### 1.5 控制信号五件套（都由代码裁决，不由模型自选）

| 信号 | 含义 | 判据 |
|---|---|---|
| `emitCheckpoint` | 本轮出题 | `shouldEmitCheckpoint(session, previousTeachingState)`：节奏分档 + 理解度闸 |
| `checkpointVerdict` | 上一题判卷结果（送进本轮反馈口径） | 只有 `judgedBy === 'code'` 才注入 |
| `anchorProbe` | 独立锚题（防遗忘） | `resolveAnchorProbeTarget`：只在「本轮会出检查点」时投放 |
| `repairInstruction` | 修复指令 | 上轮误解/断链 |
| `mode` | **不是**课堂形态：类型是 `'tutor' \| 'peer' \| 'debate'`（主讲/同伴/辩论） | 编排层按场景给 |

> 更正（2026-10-27 复核）：课堂形态（工作台副驾 / 动作诊所 / 沙盘共建 / 复盘收束）**不是** `controls` 里的字段，
> 也不由代码计算——它写在 `skill.teaching-turn.md` 规则 56 里，是 `taskType` 七档的**静态文字映射**。
> 两者混为一谈会导致「代码算了但没分流」的误判。

**为什么要代码裁决**：实测埋在 2 万字提示词里的规则会被忽略；写进本轮输入（`controls`）才生效。

### 1.6 板书层（2026-10-27 新增，尚未接进主链路）

定位：**白板解决的是纯文字造成的认知压力，不是做题区**。所以默认不挖空。

```
① 代码裁决控制信号
② 板书层  board-designer（画完整板）→ normalizeTeachingFigure → 图闸 → deriveBoardFigure
          └─ 产出 verifiedBoard：已归一化、已按口径处理、100% 确定的真实板书
③ 教学层  teaching-turn 输入多了 boardContext = describeBoardForTeacher(verifiedBoard)
          └─ 老师看到的就是学生看到的 → 「指着不存在的行」这类病灶在结构上不可能发生
④ 下一轮  换例子/条件 → update（同一结构换新数据）；答错/误解 → focus
```

三种口径（`deriveBoardFigure(figure, { conceal })`）：

| 口径 | 板面 | 用途 |
|---|---|---|
| `none` | 材料/步骤/副标注/结论句全上板，0 个 `?` | 纯参考板 |
| `takeaway` | 材料与副标注全上板，只把结论句留给对话 | 折中 |
| `full` | 挖答案位 + 撤副标注 + 藏结论（旧默认） | 检索练习 |

动作（`decideBoardOp`）：`setup`（上板）→ `focus`（指板）→ `update`（换板，判据 `hasNewNumbers`：话里出现板上没有的数字）→ `none`。

接线位置：`TeachingSessionRepository` 的 payload 增 `boardState`；引擎第 3~6 步之间插板书层；`teaching-turn` 提示词去掉图型指南、输出 schema 去掉 `figure`；前端把 `TeachingFigure.vue` 提为常驻白板区。

### 1.7 图闸：10 道，顺序固定

全部在 `teaching-turn-engine.ts:900` 之后，只有走完才下发：

| # | 闸门 | 在问什么 | 命中后的动作 |
|---|---|---|---|
| 1 | `stripInLessonAnnotations` | 图里有没有「课中批注」 | 剥掉 caption/note 再判 |
| 2 | `maskFigureForQuestion` | 本轮是不是读图/复述题 | 挖掉被问的答案，结构照发 |
| 3 | 调色板盖章 | 学科色相是否合法 | 由服务端按 subject 覆盖 |
| 4 | `detectExerciseLeakInReply` | 回复是否布置了「你自己画」 | 不出图（画了等于替学生画） |
| 5 | `figureNumbersFightReply` | 图里的数字是否一个都没在正文出现 | 不出图（图文打架） |
| 6 | `checkpoint` 存在 | 本轮是不是发了题 | 不出图（学生该动手，不该看成品） |
| 7 | `figureRestatesReply` | 图是否只是把这段回复抄进框 | 不出图 |
| 8 | 会话上限 | 本节课图是否已到顶 | 不出图 |
| 9 | 图型配额（A4/B4/C3/D2） | 同一图型是否刷屏 | 不出图 |
| 10 | `shouldEmitFigureAmong` | 是否与已有图同骨架（只改措辞） | 不出图 |

白板模式下 8/9/10 自然失效：同骨架不再是「重复发图」，而是同一块板的 `focus` / `update`。

### 1.8 落库与前端

- 落库：`teaching_session_messages.payload` 存 `figures`（数组，含 `figureSource`：`trigger/reason/kindHint/ruleWhy/matched`，用于回答「这张图为什么出现」）。
- 前端：`V2LearningPage.vue` 拿 `figures` → `TeachingFigure.vue` → `render.ts` 出确定性 SVG（不允许模型给 SVG）。
- 15 种图型白名单：`position-line / matrix / quadrant / bipartite / board / balance / cycle / tree / venn / bullseye / range-bar / cartesian-plot / concept-map / split-compare / state-strip`；退役 4 种（`grid / compare / bins / ladder`，只是给句子加边框）。

---

## 2. 评价管线

评价分三层，**越往下越权威**：确定性审计 > 人工评审 > 外部盲评。原因写在 §2.3。

### 2.1 确定性审计（代码算，不看模型）

入口：`backend/scripts/board-probe.ts` 的 `auditTeacherReply()`；图版本用 `outputs/e2e/version-report.mjs` 汇总。

| 指标 | 算法 | 口径注意 |
|---|---|---|
| 泄题 | 把「揭晓后才补回的内容」逐条拿来，看老师这一轮的话里有没有原样出现 | **只统计提问轮**：揭晓/换板轮引用板上答案是合法教学行为 |
| 指着空气 | 回复里的「第 n 行/栏/帧/步/格」序号 vs 板上实际行数 | 序号超出即命中 |
| 复述率 | 回复与板面可见文字的**二元组**重合比例 | 越高越像「把图念一遍」；不是越低越好（引用标签是正常的） |

### 2.2 外部盲评（视觉模型，只看图和那一轮对话）

入口：`outputs/e2e/vision-review.mjs <items.json> <pngDir> <out.json> <label> [rubric]`。两套判据：

**`leak`（旧，2026-10-26）**：`usefulness` / `geometry` / `meta` / `leak` / `redundant` / `readability`。
问题：把「图里写全了」一律当泄题，会把白板逼成做题区。

**`load`（新，2026-10-27）**：

| 字段 | 0 | 3 |
|---|---|---|
| `relief` 减负度 | 没有分担，看文字更快 | 看了板就不必在脑子里同时压着这些量 |
| `selfExplain` 自明性 | 满屏问号，必须靠猜 | 扫一眼就明白在比什么 |
| `preAnswer` 结论前置 | 板面只给材料与结构 | 板面把老师要学生说的**那句话**写出来了 |
| `meta` | 学科实体 | 做题步骤指令/自查清单 |

判定要点：**把材料画全不算 preAnswer；替学生把结论说出来才算**。

### 2.3 怎么判定一个版本（踩过的坑）

1. **样本量**：n=6~9 时，同一批图两次评审的百分比能摆动 ±17~33 个百分点。要下「0%」这种结论至少 ≥20 条/版。
2. **判据会改结论**：同一批板在 `leak` 口径下「全删」，换 `load` 口径后「6 保留 / 3 要修 / 0 删掉」。所以**跨版本比较必须同判据**。
3. **确定性为准**：0 个问号、材料是否齐全、换题是否刷新，这些代码能数；盲评只作参照，遇到与确定性冲突时以确定性为准。
4. **样本要标**：任何数字后面都要写 n 与判据名（`0/2/4（load，n=9）`），否则下一次没人能复现。

### 2.4 产物与入口

| 产物 | 给谁 | 怎么看 |
|---|---|---|
| `outputs/board-compare/index.html` | 人 | 三列对照：旧做题区 / 新减负区 / 换题后 |
| `outputs/board-review/index.html` | 人 | 评审台：两态切换 + 逐条勾判 + 导出 ~0.4KB 结论 |
| `outputs/board-compare/brief.md` | 模型 | 1KB：数字 + 判非保留的条目 |
| `outputs/e2e/board-run-show.json` | 机器 | 逐轮板面（`turns[].boardSpec`），可回放 |
| `outputs/e2e/board-review-load.json` | 机器 | 盲评原始判词（含 worstIssue） |
| 主树根 `12-白板模式-图教分离.pdf` | 人 | 报告 + 三案例两态对照（PDF 面板可读） |

页面都不含 base64（图片走 `<img src>`）；`*.png` 被 `.gitignore` 挡住，换机器要重跑生成脚本。

---

## 3. 文件索引

| 环节 | 文件 |
|---|---|
| 路由 | `backend/src/routes/ai-teaching.routes.ts:867` |
| 编排 | `backend/src/services/ai-teaching/AITeachingCoordinator.ts:246` |
| 引擎 | `backend/src/services/ai-teaching/teaching-turn-engine.ts:245`（八步）/ `:900` 起（图闸） |
| 上下文 | `backend/src/services/ai-teaching/TeachingContextBuilder.ts`（`buildTeachingScenarioContext`） |
| skill 契约 | `backend/src/skills/teaching-turn/index.ts:62`（输入）/ `:338`（输出）/ 归一化与图型白名单 |
| 图能力 | `backend/src/services/ai-teaching/teaching-visual.service.ts`（图型规则 / 脱敏 / `FIGURE_KIND_GUIDE`） |
| 板书 | `board-state.ts`（三口径 + 老师可见描述）/ `board-controller.ts`（show/focus/update） |
| 渲染 | `frontend/src/components/teaching-figure/render.ts` |
| 探针 | `backend/scripts/board-probe.ts`（板书）/ `backend/scripts/versioned-probe.ts`（图版本） |
| 评价 | `outputs/e2e/vision-review.mjs`（两套判据）/ `board-review-app.mjs` / `board-compare.mjs` |

---

## 4. 复现

```bash
# 课堂侧：板书层原型（3 案例 × 3 轮，第 4 个参数是口径）
cd backend && npx ts-node --transpile-only scripts/board-probe.ts ../outputs/e2e/board-cases.json ../frontend/figure-out/board-show2.json 1 none

# 逐轮板面 → 渲染
npx ts-node --transpile-only scripts/board-turn-items.ts ../frontend/figure-out/board-show2.json ../frontend/figure-out/board-turn-items-all.json --all
cd ../frontend && node node_modules/vite-node/vite-node.mjs scripts/figure-pages.ts figure-out/board-turn-items-all.json figure-out/board-turn-all-pages
node ../outputs/e2e/render-pngs.mjs figure-out/board-turn-all-pages figure-out/board-turn-all-pngs

# 评价侧：盲评（新判据）
node ../outputs/e2e/board-review-items.mjs ../frontend/figure-out/board-show2.json ../frontend/figure-out/board-show-review-items.json --turns
node ../outputs/e2e/vision-review.mjs frontend/figure-out/board-show-review-items.json frontend/figure-out/board-turn-all-pngs outputs/e2e/board-review-load.json LOAD1 load

# 人工评审台 / 对照页
node ../outputs/e2e/board-review-app.mjs
node ../outputs/e2e/board-compare.mjs

# 提示词合集
node ../outputs/e2e/skill-pack.mjs
```
