# 课堂管线与评价管线（单文件）

> 口径：本文描述的是**当前分支代码的真实调用链**（文件/函数可直接对照），不是设计稿。
> 基线：`feat/teaching-figures` @ `62108427`（2026-10-27）。
> 配套：`CLASSROOM_SKILLS.md`（课堂用到的提示词全文合集）、`OVERHAUL_LOG.md`（本轮改造条目与读数）。

---

## 0. 两条线在一张图上

```
                         ┌─────────────── 评价管线（离线，不进课堂） ───────────────┐
                         │                                                          │
   课前的课 ────────────▶│  ① 探针：真路由跑 N 个案例 × 3 轮                          │
                         │  ② 确定性读数：泄题/指空/复述/结论上板/板滞后/同轮脱节      │
                         │  ③ 外部盲评：把图 + 那一轮对话交给视觉模型，按判据打分        │
                         │  ④ 人工评审台：勾判 + 一句话备注 → 导出 ~0.4KB 结论          │
                         │  ⑤ 回归门禁：规则一致性 / 契约 / 提示词 lint / 全量测试      │
                         └───────────────────────────▲──────────────────────────────┘
                                                     │ 改提示词 / 改闸门 / 改渲染
                                                     │
   学生一句话 ─▶ 路由 ─▶ 编排层 ─▶ 引擎 8 步 ─▶ skill ─▶ 归一化 ─▶ 闸门 ─▶ 落库 ─▶ 前端
                            │                              ▲
                            └──────────────────────────────┴── 板书层（2026-10-27，探针内）：
                                                                先定「本轮问什么」→ 画板 → 老师看着真板说话
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
| 板书 | `boardContext` / `boardAction` | 板书层（§1.6，探针内接线） |

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

### 1.6 板书层（2026-10-27，探针内验证，尚未接进主链路）

定位：**白板解决的是纯文字造成的认知压力，不是做题区**。所以默认不挖空。

**执行顺序（2026-10-28 方案 A：首轮板先行，变式轮同轮刷新）**：

```
第 1 轮（建板）
  学生这一句 → decideBoardIntent → board-designer → 归一化/图闸 → deriveBoardFigure
  → describeBoardForTeacher → teaching-turn（老师看着真板提问）

第 2 轮起（同轮刷新）
  teaching-turn 先说（看着上一轮留下的板；被要求不要引用旧板的具体行号/数字）
  → decideBoardIntent 读**老师这一轮刚说的话**（不是上一轮）
  → 命中换例/换场景 → board-designer 按老师这句话刷新板
  → 学生同时看到「老师这一轮的话 + 刷新后的板」
```

为什么不是「先画板、后说话」：板先画就只能读上一轮老师的话，而这一轮老师常会引入新现场；
after6 的 b2 实拍是 t3 板画成酒精、老师问水银，板永远在画学生刚做完的上一道题。

**意图层 `board-intent.ts`**：

| 字段 | 取值 | 说明 |
|---|---|---|
| `askAbout` | `fork / condition / order / mapping / none` | 按图型与 taskType 映射：split-compare→fork、state-strip→order、consolidate→mapping、concept-map→condition |
| `exampleChange` | `none / variant / scene` | `variant`=同结构换数；`scene`=换对象/介质/条件 |
| `newNumbers` | string[] | 本轮新出现的数据，供绘图员直接摆上新现场 |
| `instruction` | string | 给绘图员的一句话边界：这一轮板面画到哪里为止 |
| `reason` | string | 判定理由（进日志/描述） |

判定细则：
- **数字只认老师上一句**：学生话里的数多半是他自己算出的得数，拿它当换题信号会让板跟着得数乱跳；
- **现场词看师生双方**：学生先说「挪到水银里」、老师这句只是复述旧现场时，只看老师会让板落后一轮；
- **换场景不要求新数字**：老师说「整块挪到酒精里，浸入体积不变」——现场换了但一个数都没给；
- **换场景时旧前提不得沿用**：浸没状态、体积关系、温度、溶解度必须按新现场重写或留空（水里「全浸 → V排=V石」抄到水银里会变成错误前提）；
- **「同一块铁、同一杯水」是描述现状**，不触发换板。

**收口 `applyBoardIntent`**：`fork/condition/order` 时撤掉结构化结论键（`takeaway/delta/note`），不动材料/步骤/单位；`mapping/none` 保留结论（迁移需要参照物、无问不需要藏）。

**三种口径**（`deriveBoardFigure(figure, { conceal, intent })`）：

| 口径 | 板面 | 用途 |
|---|---|---|
| `none` | 材料/步骤/副标注全上板，0 个 `?`；结论再按意图收口 | 减负区（默认） |
| `takeaway` | 材料与副标注全上板，只把结论句留给对话 | 折中 |
| `full` | 挖答案位 + 撤副标注 + 藏结论（旧默认） | 检索练习 |

`visibleSpec()` 统一两个出口：`full` 只有揭晓后才给完整板，其余一律给提问态（渲染与老师描述不再各算一份）。

**动作**（`decideBoardOp`）：`setup`（上板）→ `focus`（指板）→ `update`（换板；判据为本轮 `intent.exampleChange !== 'none'`）→ `none`。旧判据 `hasNewNumbers` 只认数字，会漏掉换介质。

**接线计划（尚未做）**：`TeachingSessionRepository` 的 payload 增 `boardState`；引擎第 3~6 步之间插板书层（先算意图再画板）；`teaching-turn` 提示词去掉图型指南、输出 schema 去掉 `figure`；前端把 `TeachingFigure.vue` 提为常驻白板区。

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

### 1.8 提示词的真相源与生效路径（本轮踩过的坑）

```
prompts/core/teaching-turn.yaml   ← 唯一真相源（83 条 rules，单行 `  - ...`）
  └─ npm run prompts:compile-all  → prompts/skill.teaching-turn.md（31 个编译产物，frontmatter 带 coreHash）
      └─ npm run prompts:sync-core → prisma/system.db 的 agent_prompts ACTIVE 版本
          └─ prompt-composer.ts:317：systemPromptOverride || promptConfig.systemPrompt || spec.defaultSystemPrompt
```

**三条硬事实**：
1. **只改 `.md` 不生效**：运行时优先读 DB 的 ACTIVE 版本；本工作树已同步到 `skill:teaching-turn` v18（30,860 字符）。
2. **只改 `.yaml` 不生效**：编译产物与 DB 不会自动更新，健康中心 `w4-corehash` 会报 baseline-drift。
3. **规则 15/38 有逐字一致性测试**：`text-observable-rules.test.ts` 强制 yaml 与 md 中这两条逐字相同。

对应的门禁：`text-observable-rules`（8 条）、`check-core-hash-parity`（31 declared / 31 in-sync）、`prompts:lint`（32/32）、`skill-prompt-contract`（6 条）。

### 1.9 落库与前端

- 落库：`teaching_session_messages.payload` 存 `figures`（数组，含 `figureSource`：`trigger/reason/kindHint/ruleWhy/matched`，用于回答「这张图为什么出现」）。
- 前端：`V2LearningPage.vue` 拿 `figures` → `TeachingFigure.vue` → `render.ts` 出确定性 SVG（不允许模型给 SVG）。
- 15 种图型白名单：`position-line / matrix / quadrant / bipartite / board / balance / cycle / tree / venn / bullseye / range-bar / cartesian-plot / concept-map / split-compare / state-strip`；退役 4 种（`grid / compare / bins / ladder`，只是给句子加边框）。
- 时间线（`state-strip`）帧名按帧宽折行、帧头随行数长高（4 帧长年号不再压字/越界）。

---

## 2. 评价管线

评价分三层，**越往下越权威**：确定性审计 > 人工评审 > 外部盲评。原因写在 §2.4。

### 2.1 确定性审计（代码算，不看模型）

**逐轮审计**（`board-probe.ts` 的 `auditTeacherReply()`）：

| 指标 | 算法 | 口径注意 |
|---|---|---|
| 泄题 | 把「揭晓后才补回的内容」逐条拿来，看老师这一轮的话里有没有原样出现 | **只统计提问轮**：揭晓/换板轮引用板上答案是合法教学行为 |
| 指着空气 | 回复里的「第 n 行/栏/帧/步/格」序号 vs 板上实际行数 | 序号超出即命中 |
| 复述率 | 回复与板面可见文字的**二元组**重合比例 | 越高越像「把图念一遍」；不是越低越好（引用标签是正常的） |

**跨轮汇总**（`outputs/e2e/board-metrics.mjs`，一次运行压成 9 个读数）：

| 指标 | 在问什么 |
|---|---|
| 泄题 / 指空 / 复述 max | 同逐轮审计 |
| 结论上板 | 提问轮板面仍含 `delta/takeaway/note`（意图收口是否生效） |
| 板滞后 | 老师**上一轮**宣布的数字，这一轮板上还没有 |
| 现场滞后 | 老师**上一轮**换的液体，这一轮板上还没换 |
| 同轮脱节·数字 | 老师**这一轮**说的新数字板上没有（同轮刷新后应恒为 0；非 0 = 刷新漏了） |
| 同轮脱节·现场 | 老师**这一轮**换的现场板上没有（同上） |
| 空槽 | 提问态空槽总数（减负板应为 0） |

口径注意：
- 「现场滞后」按上一轮老师话比对，会在**学生主动换话题**时误报（板正确地跟了学生，指标却记成滞后）；看到 1 先读这一轮的学生话。
- 同轮刷新（pipeline=`post-teacher-refresh`）之后，**同轮脱节是主指标**；`板滞后/现场滞后` 只用来发现「老师上一轮宣布的内容连刷新都没落到板上」，要求上一块板和当前板都没有才算。
- 同轮脱节的数字会排掉**学生这一轮刚说过的数**（2026-10-28）：老师常复述学生的得数（「150 秒每千米，两步都对」），那不是新例子；不排掉会把「板已正确换到新数据」误判成脱节。
- 「板滞后」仍可能把老师**回指旧数据**读成滞后（这一轮老师提的是前一组数，板当然没有）。非 0 时先看这一轮老师说的是新数据还是旧数据。

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

工程约束：
- 输出只许一个 JSON 对象；模型偶尔会写推理散文，脚本会拿着上一段话再要一次（最多 3 轮），避免把样本丢掉；
- `max_tokens` 2400；`temperature` 0；判据本身不随重试改变。

### 2.3 2026-10-27 的实测结论（n=9，3 案例 × 3 轮）

| | keep | fix | drop | relief | selfExplain | preAnswer |
|---|---|---|---|---|---|---|
| 改前 | 4 | 5 | 0 | 2.78 | 2.33 | 33% |
| 最终（after6） | 4 | 5 | 0 | 2.44 | 2.22 | **11%** |

- **判定分布没变**：白板质量的主要矛盾不在「结论上不上板」，而在设计师的副标注与内容一致性；
- **确定性效果稳定**：结构化结论上板 3→0、板滞后 1→0（四次改后运行一致）；
- **preAnswer 未清零**：结论会藏进 `sub` 副标注，`applyBoardIntent` 只撤三个结构化键；
- **同轮现场脱节**结构性存在：板先于老师生成，老师本轮临时换现场只能下一轮补（探针每轮强制换条件，会放大这项）；
- **复述率单次不可比**：老师每次生成不同，0.17/0.19/0.31 都是同一条管线。

### 2.4 怎么判定一个版本（踩过的坑）

1. **样本量**：n=6~9 时，同一批图两次评审的百分比能摆动 ±17~33 个百分点。要下「0%」这种结论至少 ≥20 条/版。
2. **判据会改结论**：同一批板在 `leak` 口径下「全删」，换 `load` 口径后「6 保留 / 3 要修 / 0 删掉」。所以**跨版本比较必须同判据**。
3. **确定性为准**：结论是否上板、板是否跟上、空槽是否为 0，这些代码能数；盲评只作参照，遇到与确定性冲突时以确定性为准。
4. **样本要标**：任何数字后面都要写 n 与判据名（`4/5/0（load，n=9）`），否则下一次没人能复现。
5. **判定分布比均值稳**：relief/selfExplain 受单张图影响大；keep/fix/drop 更能回答「这版还能不能留」。
6. **结构性问题不要当回归**：同轮现场脱节、副标注泄题都是设计层问题，先定位到具体字段再改，不要靠调均值掩盖。

### 2.5 产物与入口

| 产物 | 给谁 | 怎么看 |
|---|---|---|
| `doc/CLASSROOM_SKILLS.md` | 人 | 课堂 8 个 skill 全文（由 `skill-pack.mjs` 生成，不手改） |
| `doc/CLASSROOM_PIPELINE.md` | 人 | 本文：课堂 + 评价两条线 |
| `doc/OVERHAUL_LOG.md` | 人 | 本轮每条改造、改法、读数、反例 |
| `outputs/board-compare/index.html` | 人 | 三列对照：旧做题区 / 新减负区 / 换题后 |
| `outputs/board-review/index.html` | 人 | 评审台：两态切换 + 逐条勾判 + 导出 ~0.4KB 结论 |
| `outputs/board-compare/brief.md` | 模型 | 1KB：数字 + 判非保留的条目 |
| `outputs/e2e/board-run-show.json` | 机器 | 逐轮板面（`turns[].boardSpec`），可回放 |
| `outputs/e2e/board-review-*-load.json` | 机器 | 盲评原始判词（含 worstIssue） |
| `frontend/figure-out/board-after6.json` | 机器 | 板先行（旧时序）3 案例 × 3 轮 |
| `frontend/figure-out/board-after8-merged.json` | 机器 | 方案 A 后 6 案例 × 3 轮（局部产物，不进仓库） |
| `outputs/e2e/board-review-after8b-load.json` | 机器 | 方案 A 后盲评（17/18 可判） |

页面都不含 base64（图片走 `<img src>`）；`*.png` 被 `.gitignore` 挡住，换机器要重跑生成脚本。

### 2.6 真实课堂跑数：10 个虚拟学习者（2026-10-28）

目的：不只看探针里「被要求画板」时的质量，也看**生产引擎自己会不会出板**。

- 每个案例新建一个虚拟学习者，给身份、故事、目标，只跑 1 个模拟日（`simulate-learner-e2e.ts --days=1 --keep`）。
- 案例与人设：`outputs/e2e/learner-cases-10.json`。`internal`（taskType/kindHint/coreTestPoint）只留在本地，**不进平台请求**。
- 驱动：`outputs/e2e/run-learners-10.mjs`；导出：`outputs/e2e/export-classroom.mjs`；报告：`outputs/e2e/learner-report.mjs`。
- 产物：`doc/learners/README.md`、`doc/learners/f1..f10.md`、`doc/learners/index.html`；原始 JSON 在 `outputs/e2e/classroom/`。

结果（10 案例 × 2 节 = 20 节课）：**实际下发课堂图 0 张**。

- 不是导出遗漏：`teaching_session_messages.payload` 与 `virtual_session_logs.details.output` 里都没有 `figures`/`figure` 键；后端也没有任何图闸拒绝日志。也就是说**模型根本没有提出过图**，不是被 10 道闸挡掉。
- `buildVisualOpportunity` 只在特定线索（ASCII 结构、位置描述、时序描述等）出现时给 hint；这批对话大多没有命中。命中也不是强制出图，最终仍要模型自己输出 `figure`。
- 因此：探针里的白板裁剪/换板修复**没有进入真实课堂**——`board-intent/board-state/board-controller` 仍未接 `teaching-turn-engine`。这 10 份记录是生产现状基线，不是本轮修复的验收。
- 第二个结构性观察：`--days=1` 时每案例都完成 1 节、第 2 节停在 active。课节确实在推进，但「一节课上完」与「一天结束」不是同一件事，报告里两种情况都保留。

---

## 3. 文件索引

| 环节 | 文件 |
|---|---|
| 路由 | `backend/src/routes/ai-teaching.routes.ts:867` |
| 编排 | `backend/src/services/ai-teaching/AITeachingCoordinator.ts:246` |
| 引擎 | `backend/src/services/ai-teaching/teaching-turn-engine.ts:245`（八步）/ `:900` 起（图闸） |
| 上下文 | `backend/src/services/ai-teaching/TeachingContextBuilder.ts`（`buildTeachingScenarioContext`） |
| skill 契约 | `backend/src/skills/teaching-turn/index.ts:62`（输入）/ `:338`（输出）/ 归一化与图型白名单 |
| 提示词真相源 | `prompts/core/teaching-turn.yaml` → `prompts/skill.teaching-turn.md` → `prisma/system.db` ACTIVE |
| 图能力 | `backend/src/services/ai-teaching/teaching-visual.service.ts`（图型规则 / 脱敏 / `FIGURE_KIND_GUIDE`） |
| 板书意图 | `board-intent.ts`（askAbout / exampleChange / 收口 / 老师可见描述） |
| 板书状态 | `board-state.ts`（三口径 + 意图 + `visibleSpec`） |
| 板书动作 | `board-controller.ts`（setup/focus/update/none） |
| 渲染 | `frontend/src/components/teaching-figure/render.ts` |
| 探针 | `backend/scripts/board-probe.ts`（板书）/ `backend/scripts/versioned-probe.ts`（图版本） |
| 评价 | `outputs/e2e/vision-review.mjs`（两套判据）/ `board-metrics.mjs`（确定性读数）/ `board-pages.mjs`（出评审页）/ `board-review-app.mjs` / `board-compare.mjs` |

---

## 4. 复现

```bash
# ---------- 课堂侧：提示词改完先同步（yaml → md → DB） ----------
cd backend
npm run prompts:compile-all
npm run prompts:sync-core
npm run prompts:lint
npx ts-node src/scripts/check-core-hash-parity.ts

# ---------- 课堂侧：板书层原型（3 案例 × 3 轮，第 4 个参数是口径） ----------
npx ts-node --transpile-only scripts/board-probe.ts ../outputs/e2e/board-cases.json ../frontend/figure-out/board-after6.json 1 none

# ---------- 评价侧：确定性读数 ----------
cd ..
node outputs/e2e/board-metrics.mjs outputs/e2e/board-run-show.json frontend/figure-out/board-after6.json

# ---------- 评价侧：盲评物料（渲染器打包一次即可） ----------
node outputs/e2e/board-review-items.mjs frontend/figure-out/board-after6.json frontend/figure-out/board-after6-items.json --turns
cd frontend && npx esbuild src/components/teaching-figure/render.ts --bundle --format=esm --platform=node --outfile=figure-out/render.bundle.mjs && cd ..
node outputs/e2e/board-pages.mjs frontend/figure-out/board-after6-items.json frontend/figure-out/board-after6-pages
node outputs/e2e/render-pngs.mjs frontend/figure-out/board-after6-pages frontend/figure-out/board-after6-pngs

# ---------- 评价侧：盲评（需要临时目录里的 wf-vis-key，不进仓库） ----------
node outputs/e2e/vision-review.mjs frontend/figure-out/board-after6-items.json frontend/figure-out/board-after6-pngs outputs/e2e/board-review-after6-load.json AFTER6 load

# ---------- 提示词合集 ----------
node outputs/e2e/skill-pack.mjs
```
