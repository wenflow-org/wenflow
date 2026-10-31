# 教学课堂管线报告

> 口径：本报告描述的是**当前分支代码的真实调用链**（文件路径与函数名可直接对照），不是设计稿。
> 版本：V8 迭代后（2026-10-27）。

---

## 一、总览：一条学生消息走完的链路

```
HTTP  POST /api/ai-teaching/sessions/:id/messages
  │
  ├─ routes/ai-teaching.routes.ts:867        ← 鉴权、参数校验、幂等键、revision 期望
  │
  ├─ AITeachingCoordinator.processStudentMessage()      （编排层）
  │     ├─ 虚拟学习者旁路（simulation.coordinator.ts 也直接调这里）
  │     └─ 交给引擎
  │
  ├─ teaching-turn-engine.processStudentMessage()       （引擎层，核心）
  │     ├─ 1. 会话租约 claimOperation（2 分钟租约 + 心跳续租）
  │     ├─ 2. 重建上下文 TeachingContextBuilder.build()（每回合重建，不缓存）
  │     ├─ 3. 代码裁决本轮的「控制信号」：出题？出图？锚题探针？修复指令？
  │     ├─ 4. 调 skill：teaching-turn（prompts/skill.teaching-turn.md）
  │     ├─ 5. skill 出口归一化 normalizeOutput()（字段白名单 + 图型校验 + 内容核验）
  │     ├─ 6. 引擎闸门链（算式复算 / 肯定语护栏 / 图 7 道闸）
  │     ├─ 7. 落库 teaching_session_messages（payload.figures 等）
  │     └─ 8. 返回 { aiResponse, figures, checkpoint, wrapup, ... }
  │
  └─ 前端  V2LearningPage.vue → TeachingFigure.vue → render.ts（确定性 SVG）
```

**一句话**：编排层决定「这一刻该发生什么」（出题/出图/探针），skill 决定「说什么、画什么」，引擎决定「能不能发出去」，落库后前端确定性渲染。

---

## 二、上游：课程是怎么被造出来的

学习路径不是运行时即兴生成的，而是一条 skill 流水线提前产出的（都在 `backend/src/services/learning/generation/`）：

| 顺序 | Skill | 文件 | 产出 | 下游怎么用 |
|---|---|---|---|---|
| 1 | `goal-conversation` | `skills/goal-conversation` | 学习目标、学习者画像、约束 | 喂给 path-planning 作为输入 |
| 2 | `path-planning` | `path-generation.core.ts:15` | 学习路径：milestone → stage → **task** | 落 `learning_paths` / `tasks` |
| 3 | `stage-designer` | `stage-enrichment.ts:15` | 每个 subtask 的 `acceptanceCriteria`、**`anticipatedMisconceptions`**、材料引用 | 写进 `aiPromptTemplate.misconceptionHints.byTask` |
| 4 | `kc-mapper` | `kc-annotation.ts:21` | 知识点组件（`kcId`/`name`/`taxonomy`） | 教学回合的 `scenario.taskKcs` |
| 5 | `path-reviewer` / `teaching-strategy-selector` | 同名目录 | 路径复核、教学策略建议 | `scenario.teachingStrategyGuidance` |

**关键点**：`taskType` 七档（`acquire / deconstruct / model / execute / diagnose / refine / consolidate`）在这里定下，教学回合只是**消费**它——它决定课堂节奏（工作台副驾 / 动作诊所 / 沙盘共建 / 复盘收束），但**不决定**具体说什么。

**图的原料也在上游**：`anticipatedMisconceptions`（任务级迷思预判）经 `TeachingContextBuilder` 读侧注入，是「正误对比图」的首选素材；`taskKcs` 决定概念图节点该对齐到哪个 KC。

---

## 三、中游：一个教学回合的输入字段

`TeachingTurnInput`（`skills/teaching-turn/index.ts`）：

| 字段 | 内容 | 谁填的 |
|---|---|---|
| `messages` | 对话历史（可带 `images`，仅模型可见；确定性判据只读文本） | 引擎从库读 |
| `learner` | 学习者投影（掌握度、情绪、求助史、`priorMisconceptions` 台账） | `TeachingContextBuilder` |
| `scenario` | **核心**：`subject/topic/taskTitle/taskDescription/taskType`、`taskProfile`（knowledgeType/cognitiveLevel/coreConcept）、`currentTaskContext`（acceptanceCriteria）、`cognitiveFrame`、`teachingStrategyGuidance`、`taskKcs`、`materials`、`activeTaskMaterialExcerpts` | 上游产物 + 上下文构建器 |
| `knowledge` | 本节知识点看板 + `currentPoint` | 上下文构建器 |
| `controls` | **代码裁决的控制信号**（见下表） | 引擎 |
| `visualOpportunity` | 本轮出图时机 + 图型建议（`kindHint`）+ 图型指南全文 | `teaching-visual.service.ts#buildVisualOpportunity` |
| `classroomContext` / `classroomEventContext` | 课堂事件（恢复续讲、补充材料晋升） | 引擎 |

### `controls`：谁在控制这一轮

| 字段 | 语义 | 为什么必须是代码给 |
|---|---|---|
| `emitCheckpoint` | true 时**必须**产出 `control.checkpoint`（含答案键），false/缺失时**不得**产出 | 完全由模型自决时实测 60 个会话零检查点 |
| `checkpointVerdict` | 学生作答的**权威对错** `{ passed, detail }` | 此前裁决只落库不进提示词，模型答对/答错口径与记录相反（15/15） |
| `anchorProbe` | 独立锚题探针（指定 conceptKey + 内部预期） | 编排层安排的复测，模型不得知情 |
| `repairInstruction` | 上轮算式被复算判定有误时的修复指令 | 内容正确性第一刀 |
| `mode` | tutor / peer / debate | 课堂形态 |

---

## 四、中游：skill 的输出字段

`TeachingTurnOutput`：

| 字段 | 内容 | 备注 |
|---|---|---|
| `reply` | 老师本轮真正说的话（Markdown） | 形态预算：≤3 块、每块 ≤4 行、结尾最多 1 问 |
| `analysis` | 认知层级、理解度、困惑点、**misconceptions**（结构化台账）、负荷、情绪 | 喂学习状态与迷思台账 |
| `knowledge` | `currentPoint` + `points[]`（掌握度） | 对齐 KC 粒度 |
| `pedagogy` | 策略、检查点 | — |
| `control` | `isCompletionCandidate`、`shouldTriggerPeer`、`checkpoint`、`supplement` | 与 `controls.emitCheckpoint` 硬对齐 |
| `figure` | **教学图**：`kind` + `spec` + `caption` + `palette` | 走确定性 SVG 渲染 |
| `diagram` | 结构图（mermaid 源码） | 纯流程/层级/时序 |
| `visual` | 扩散生图请求 | **2026-09-27 起默认停用**（owner 终审），块保留不再生成 |

---

## 五、图（figure）的专用链路

### 5.1 出口归一化（skill 内，`normalizeFigure`）

1. **图型白名单**：`position-line / matrix / quadrant / bipartite / board / balance / cycle / tree / venn / bullseye / range-bar / cartesian-plot / concept-map / split-compare / state-strip`（15 种）
2. **退役图型拒绝**：`grid / compare / bins / ladder`——「带边框的排版文字不是图」（2026-10-23 用户判定）
3. **字段级归一**：每种图型有独立 normalizer（节点数、边数、数值域、标签长度上限、tone 白名单、`?` 留白槽）
4. **内容核验**（V8）：图内算式复算（相对误差 >1% 整图拒绝）、概念图同端点并列边合并、两栏行数差 >3 拒绝
5. **口径**：超上限是「丢弃该条」而不是截断——多出来的一定是模型把段落塞进格子

### 5.2 引擎闸门（`teaching-turn-engine.ts:902` 起，按顺序）

| # | 闸门 | 判据 | 命中后 |
|---|---|---|---|
| 0 | `stripInLessonAnnotations` | 课中图一律撤 `caption` / `note` | 剥掉注 |
| 0 | 调色板盖章 | `paletteOfSubject(session.subject)` | 换观感，不改几何 |
| 1 | `detectExerciseLeakInReply` | 本轮布置了「学生自己画/排」的练习 | 不出图 |
| 2 | `figureNumbersFightReply` | 图内数字与正文完全对不上 | 不出图 |
| 3 | `control.checkpoint` 存在 | 出题回合 = 学生该动手 | 不出图 |
| 4 | `figureRestatesReply` | 图只是把本轮正文抄进框 | 不出图 |
| 5 | 会话图数上限 | `resolveFigureMaxPerSession()` | 不出图 |
| 6 | 图型配额 | 按证据等级 A4 / B4 / C3 / D2 | 不出图 |
| 7 | `shouldEmitFigureAmong` | 与已有图同骨架（只改措辞） | 不出图 |
| 8 | `maskFigureForQuestion` | 读图/复述/纠错轮 | **脱敏后下发**（点标签、辅助线数值、关系名、正确栏 → `?`） |
| 9 | 下发 | — | `assistantMessage.figures = [wanted]` |

**顺序的用意**：越靠前越是「确定性事实」（这一轮学生是否要自己产出），越靠后越是「与历史比对的软判断」。

### 5.3 落库与消费

- 图落在 `teaching_session_messages.payload.figures`（**侧表**，与正文同一条消息记录）
- 读回：`TeachingSessionRepository` 汇总 `figures` 供「本会话已出图」快照（闸门 5/6/7 共用一次查询）
- 前端：`V2LearningPage.vue` → `TeachingFigure.vue` → `render.ts#renderSpecFigure`（纯函数，同一 spec 永远同一张图）→ SVG，可点击放大
- 图片**不走扩散模型**：结构类图全部代码渲染，保证可复现、可断言、可脱敏

---

## 六、下游：落库之后发生什么

| 消费方 | 读什么 | 用来干什么 |
|---|---|---|
| 检查点判定 | `control.checkpoint` 的答案键 | 代码裁决学生作答，回填 `checkpointVerdict` |
| 学习状态 | `analysis.understanding / misconceptions` | 更新掌握度、迷思台账（`misconception_ledger`） |
| 会话收束 | `control.isCompletionCandidate` + 代码判据 | 决定是否可结束、生成 wrapup |
| 路径复核 | 会话摘要、证据 | `path-reviewer` 决定是否重规划 |
| 前端 | `payload.figures` | 渲染 + 放大 + 图文对照 |
| 管理端 | 图型统计、评审留痕 | 运维与质量复盘 |

---

## 七、本套图质量迭代链路（报告数据怎么来的）

```
课程上下文（30 例，7 档 taskType × 12 学科）
  → versioned-probe.ts            真实 teaching-turn 提示词 + KIND_RULES 真路由 + 编排层出图信号
                                  直连通道、并发 3、402/429 退避
  → normalizeTeachingFigureForProbe   与线上同一条归一化路径（白名单/字段/内容核验）
  → figure-pages.ts → Chrome headless   确定性 SVG → PNG
  → vision-review.mjs             外部视觉盲评（并发 3，图 + 该轮对话，0-3 分 + 三红灯）
  → 病灶统计 → 改造 → 下一版
```

V8 实测：30 例中模型出图 28、归一化拒绝 1、未出图 2（重跑补齐到 30 张入报告）；图型线索路由命中 16/30（其余按通用出图指南选型）。

---

## 八、一句话总结每层职责

- **上游（goal → path → stage → kc）**：决定「学什么、按什么节奏学」，产出 `taskType`、`acceptanceCriteria`、`anticipatedMisconceptions`、`taskKcs`。
- **编排层（coordinator）**：决定「这一刻该发生什么」——出题、出图、探针、修复。
- **Skill（teaching-turn）**：决定「说什么、画什么」——话术、图型、spec。
- **引擎（engine）**：决定「能不能发出去」——归一化、7 道图闸、脱敏、落库。
- **前端（render.ts）**：决定「长什么样」——纯函数确定性渲染。
- **迭代链路（probe → 盲评）**：决定「下一版改什么」——外部视觉评审驱动的闭环。
