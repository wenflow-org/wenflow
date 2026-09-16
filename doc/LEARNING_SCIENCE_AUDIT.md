# 学习流程与闭环的科学性调查

> 调查日期：2026-09-16 ｜ 范围：WenFlow 学习者模型 + 学习流程闭环（后端为主）
> 方法：**代码即事实**（逐条读实现）＋**文献对照**；历史库数据仅用于定位可疑点，**不作为证据**（见 §1.1）
> 证据分级：**【A】**= 在**代码**里亲自复核（`file:line` 可查）；**【B】**= 子系统逐文件审计给出 `file:line`，未逐条复核；**【D】**= 仅来自历史数据库快照，**不可作为证据**

---

## 0. 一句话结论

| 判断 | 结论 |
|---|---|
| 教学**回合级**适应 | **是真闭环**：每回合把上一次 `analysis` 回灌进下一次调用（`file:line` 见 §3.1），与数据无关 |
| **记忆/间隔重复**级闭环 | **曾整体断电（3 处代码断点），现已修复并端到端验证**：① 计划被 `completeInitialization` **整体覆盖**（非合并）② 计划从未进入任何一次 LLM 调用 ③ 结果摘取被饿死；修复中还发现并修掉第 4 个缺陷（"已提问"被当成"作答结果"落成 `again`）。验证结果见 **§3.6** |
| **结果测量**层 | **曾完全缺失**；现已建**最小观测层**（保持率 × 间隔，§3.8）——但"掌握"仍是 LLM 自述、仍无随机实验 → **因果性结论依旧不可得** |
| 参数的科学依据 | 少数有（FSRS 选型、85% 目标、交错的"相似性"调节、SRL 命名、睡眠巩固）；**主体状态量（LSS/KTL/LF/LSB、衰减率、聚合窗口、档位阈值）是工程启发式**，仓库文档自己承认阈值来源"已清理不保留"、EWMA 系数"待拟合" |

**因此，此前"闭环 + 动态调整都做完了"的表述需要修正为：控制回路已接线，但传感器多为代理量、结果测量缺失，且记忆环路（复习/温故）尚未通电。**

---

## 1. 调查方法

1. **代码即事实**：读了学习者状态机、课内/复习温故、教学运行时、路径生成与重排、证据与度量四条链的全部关键实现（`file:line` 见各节）。
2. **历史库数据（仅旁证，不作证据）**：对 `prisma/dev.db` 的查询只用于**定位可疑点**，任何结论都回头用代码验证。
3. **文献对照**：间隔重复与提取练习（含数学学科最新 meta）、交错、合意困难 85% 规则、BKT、FSRS 基准、掌握学习、认知负荷。

复现命令见附录 A。

### 1.1 数据口径声明（重要）

- 库里的课程/证据/记忆条目**是旧数据**（历史批次 + 旧版本代码产生），**不能用来证明或否证任何机制**，也**不能当作基线**。
- 因此本文所有结论以**代码路径**为准；凡只能靠数据支持的判断，一律标注 **【D】仅历史快照**、**不计入结论**。
- 需证实/否证本文结论，必须**用当前代码开一节新课**观测，协议见 §3.5。

---

## 2. 现状：学习流程与闭环拓扑

### 2.1 一次学习的完整链路

```
目标对话 goal-conversation
  └─ 路径生成 path-planning ──► path-reviewer（CIDPP 五维，<阈值自动重规划一次）
        └─ 里程碑 / 任务 subtasks
              └─ 开课 startSession
                    ├─ 场景上下文（任务/路径/快照/上次回顾/预测/误解台账）
                    ├─ 复习课模式：注入到期点（status=review）
                    ├─ 日常课：构建**课内温故计划** + 预留当日配额   ← ★ 断点所在
                    └─ 回合循环 teaching-turn
                          ├─ 输入：上次 analysis、看板、控制状态、learnerProjection（含 taskDifficulty）、误解、温故
                          └─ 输出：analysis{understanding, loadIndex, ktEstimate, misconceptions, selfAssessmentSignal}
                    └─ 结算 SessionFinalization
                          ├─ session-wrapup（LLM 自评 sessionLss/Ktl/Lf）
                          ├─ 状态提交（LSS/KTL/LF/LSB）→ lesson:completed 事件
                          ├─ 难度效果锚点（仅模拟脚本有写入者）            ← ★ 断点所在
                          └─ 温故结果回收 → review:completed → FSRS + 预算回校准 ← ★ 断点所在
                                └─ 下节课 / 下条路径
```

### 2.2 七个反馈回路

| 环 | 内容 | 延迟 | 触发方式 | 代码可证状态 |
|---|---|---|---|---|
| **R1** | 回合内教学适应（analysis → 下一步/追问/支架） | 同回合~下一回合 | 自动 | ✅ **路径闭合**（每回合都回灌上次 analysis） |
| **R2** | **课内温故**（计划 → 检索 → 结果 → FSRS/预算） | 同课 | 自动 | ❌ **环断电**（三处断点，见 §3.2） |
| **R3** | 复习课（到期点 → 检索 → `review:completed` → FSRS） | 次日 | 自动 | ⚠️ 代码通，**实测 0 条**（未跑过） |
| **R4** | 跨课（wrapup/行为画像/ktMasteryEma → 下节课） | 下节课 | 自动 | ✅ 在跑 |
| **R5** | 难度档位（学习者状态 → `taskDifficulty.adjusted` → 提示词） | 同课/下节课 | 自动 | ✅ 已接线，**但无生产锚点 → 效果不可审计** |
| **R6** | 预测校准（predictor → 下节课 + 结果回填） | 下一条任务 | 自动 | ✅ 在跑 |
| **R7** | 路径重排（replanSignal/advisory → 预览 → **人工确认** → 重排） | 下条路径 | **人工确认制** | ✅ 设计如此（不是自动改路径） |

---

## 3. 闭环实测审计

### 3.1 反馈边总表

| 反馈边 | 传感器 | 执行器 | 延迟 | 自动/人工 | 真实数据 |
|---|---|---|---|---|---|
| analysis → 下一回合 | teaching-turn | 提示词/阶段机 | 回合 | 自动 | ✅ |
| `loadIndex` → 干预路由 | analysis | `determineNextStage` | 同回合 | 自动 | ✅ |
| `ktEstimate.conceptMastery` → 行为画像 → 下节课 | analysis | `ktMasteryEma` → prompt | 下节课 | 自动 | ✅ |
| 误解 → 台账 → 提示词 | analysis | `getActiveForConcepts` | 回合 | 自动 | ✅ |
| 自评偏差 → 校准 | `selfAssessmentSignal` | calibration | 下次画像 | 自动 | ✅ |
| wrapup → 下节课回顾 | 上节 wrapup | `fetchPriorLearningRecap` | 下节课 | 自动 | ✅ |
| 难度档位 → 提示词 | 快照 | `decideTaskDifficulty` → prompt | 同/下节课 | 自动 | ✅（未持久化，无法审计执行） |
| 预测 → 提示词；结果回填 → 可靠性 | predictor | prompt / `task:completed` | 下条任务 | 自动 | ✅ |
| **课内温故 → 模型** | `buildReviewPlan` | 提示词规则 | 同课 | 自动 | ❌ **计划被覆盖，模型从未看到** |
| **温故结果 → FSRS/预算** | 模型 `knowledge.points` | `applyWarmupExtraction` | 结算 | 自动 | ❌ **从未触发** |
| **`session_load` 指标** | 回合 `loadIndex` 聚合 | **无消费者** | 意图下节课 | 自动 | ❌ 写了 54 条没人读 |
| **`checkpointHistory`** | 检查点通过/理解 | **无消费者** | 同回合 | 自动 | ❌ 只进响应 |
| `helpSeekingType` / `rsmAttempts` | analysis | **无消费者**（且被裁剪出手模型上下文） | — | — | ❌ |
| 难度调整效果度量 | `task:difficulty:adjustment` | 台账对账 | 下一条任务 | 自动 | ❌ **锚点只有模拟脚本在写** |
| 路径重排 | advisory + 快照 | UI 确认 → `requestPathReplan` | 下条路径 | **人工** | ✅（确认制） |

### 3.2 断点一：课内温故闭环（三处，环完全断电）

这是本次调查**最重要**的发现，也解释了此前"成功率恒为 `-`、预算恒停 2.0"的现象。

**断点 1 — 计划在开课初始化时被覆盖【A】**
`AITeachingCoordinator.ts:1439` 在 `reserve()` 时写入 `teachingState: { sessionArtifacts: { memoryWarmup } }`；
随后 `generateOpening` 之后的 `completeInitialization`（`:1599-1603`）把 `sessionArtifacts` **整个重写**为：

```ts
sessionArtifacts: {
  initialKnowledgeState: seededKnowledgeState,
  pathBackgroundContext: buildPathBackgroundContext(context),
  endReason: null,
},                                   // ← 没有 memoryWarmup
```

计划在第一节回合开始前就被抹掉（已复核：`TeachingSessionRepository.completeInitialization` 在 `TeachingSessionRepository.ts:343` 是**整体覆盖** `teachingState`，不是合并）。

**断点 2 — 计划从未进入任何一次 LLM 调用【A】**
- 开场调用 `generateOpening`（`:1656-1679`）的入参里**根本没有** `memoryWarmup`；
- 回合调用 `buildTeachingTurnInput` 虽然映射了 `memoryWarmup: context.memoryWarmup ?? null`（`:1162`），但 `processStudentMessage` 每回合用 `buildTeachingScenarioContext` **重建** context，而该函数从不设置 `memoryWarmup`（只有 `startSession:1416` 设过）→ **每回合都是 `null`**。

于是提示词里那段精心写的规则（`prompts/core/teaching-turn.yaml:96` / `skill.teaching-turn.md:83`「当 `scenario.memoryWarmup` 提供时…无提示检索→最小提示→对照」）是**死代码**；而前端却在开课时告诉学习者「老师会先带你回捞」（`V2LearningPage.vue:96-110`）——**界面承诺了，老师做不到**。

**断点 3 — 结果摘取被饿死【A】**
`extractWarmupOutcomes(context.memoryWarmup, rawPoints)`（`:1833`）与 `stripWarmupPoints`（`:1837`）依赖同一个 null 计划 → 永远返回 `[]`；
`mergeWarmupOutcomes`（`:2141`）因此从不写入 `item.outcome`；
`SessionFinalizationService.applyWarmupExtraction`（`:407-412`）要求 `item.outcome.status` 才继续 → 永远早退 → **不产生 `review:completed` / `review:warmup` 证据** → `successRate` 恒为 `null` → `computeLoadBudget` 恒返回基准 2.0。

**历史库快照【D】（仅存档，不作证据——见 §1.1）**

| 观测 | 值 |
|---|---|
| `teaching_sessions` 总数 / 含 `memoryWarmup` 计划 | 182 / **0** |
| 含温故 `outcome` 的会话 | **0** |
| `learner_evidence` 中 `review:completed` / `review:warmup` | **0 / 0** |
| `memory_traces` | 560 条，其中 **`fsrsStability` 非空 = 0**，`dueAt` 已排 = 435 |
| `learning_metrics` | `learning_state` 130、`session_load` 54 |
| 功能提交（`360c861`）之后开的课 | 5 节，全部 0 计划 |

该快照与上述代码路径**方向一致**，但**旧数据不能替代验证**（它既可能因为代码断点而全为 0，也可能因为"当时压根没到期点"而全为 0，无法区分）。决定性验证见 §3.5。

### 3.3 断点二：预算结构决定"每课 1–2 条"，且无逾期治理【A】

**先看代码（不依赖数据）**：
- 每节课预算 = `min(sessionBudget, 当日剩余)`，基准 2.0（`review-plan.service.ts:26`）；
- 单条负担 `estimateConceptLoad`：复合/流程 ×1.5、掌握度<0.5 ×1.3，**上限 3.0**（`:64-96`）；
- 按负担装箱选点，且「最急的一条即使超预算也必接」；`MAX_WARMUP_ITEMS=3` 只是上限（`:408-424`）；
- 到期项只按 `dueAt <= now` 取，**无逾期加权、无积压上限、无 cram 模式**（`memory-trace.service.ts:276-352`）。

⇒ 结构上**每节课实际只能接 1~2 条**（单条 1.3–3.0 对 2.0 预算）；到期量一旦超过阈值，就会单调积压——这正是代码注释声称要避免的 "Anki backlog death spiral"，而当前参数组合下没有闸门。

**历史库快照【D】（仅存档）**：18 个虚拟学习者复算 `buildReviewPlan`：

```
汽修店店长-老周   traces=106 dueNow= 90   plan.items=1  used=1.95  successRate=-
高三理科生 周毅    traces= 59 dueNow= 46   plan.items=1  used=1.30  successRate=-
小陈（奶茶店）     traces=135 dueNow=104   plan.items=1  used=1.30  successRate=-
夜班急诊护士       traces= 96 dueNow= 79   plan.items=1  used=1.95  successRate=-
…（其余有到期点的学习者同为 1 条；无 traces 者为 0）
```

⇒ 旧数据里"到期 46–104 条 vs 每课 1 条"与上面的结构推断一致，但**到期量取决于真实使用节奏**，须用新数据复核（§3.5）。

### 3.4 断点三：难度调整的效果度量只有模拟数据【A】

`recordTaskDifficultyAdjustment`（`TaskDifficultyAdjustmentLedger.ts:86`）的**唯一调用者**是 `src/scripts/simulate-learner-days.ts:247`——生产课堂只**计算**档位（`TeachingContextBuilder.ts:757`），不写锚点。
⇒ 效果度量（`relieved` / `still_triggered` / A-B 对照）**在生产路径上不可能运行**；`applied` 也无法审计。（这是**代码事实**；历史库中该类证据为 0 条，方向一致，但该数字仅作旁证【D】。）

---

### 3.5 决定性验证协议（不用历史数据）

**前置**：不改任何代码；选一个虚拟学习者 + 一条真实任务，用当前代码开课。
入口：`AITeachingCoordinator.startSession({ userId, taskId })`（虚拟实验室侧走 `virtual-lab/quick-learn/quick-learn.service.ts:356`）。

| # | 观测点 | 怎么取 | 若"环断电"成立 | 若"环正常" |
|---|---|---|---|---|
| 1 | 计划是否落库 | 开课后读 `teaching_sessions.teachingState.sessionArtifacts.memoryWarmup` | **不存在**（被 `completeInitialization` 覆盖） | 存在且 `items.length ≥ 1` |
| 2 | 计划是否到达模型 | 开课/首回合的 LLM 入参（`agent_call_logs`／提示词调试字段）是否含 `memoryWarmup` | **不含** | 含 |
| 3 | 结果是否摘取 | 首回合后 `sessionArtifacts.memoryWarmup.items[].outcome` | **恒 undefined** | 命中点写回 `outcome` |
| 4 | 是否产生证据 | 结算后 `learner_evidence` 是否有 `review:completed` | **无** | 有，且 `payload.rating` 有值 |
| 5 | 预算是否分档 | 连续 2–3 节后 `buildReviewPlan()` 的 `successRate` / `budget` | 恒 `null` / 恒 2.0 | 出现 1.0 或 3.0 |

**判据**：第 1、2 条**任一为"不存在／不含"**即证明环断电——这两条是必要条件，与后续回合无关。
**反证条件（预先承诺）**：若第 1、2 条实测通过、只有第 3–5 条失败，则本文"断点 1、断点 2"的结论**撤回**，问题仅存在于断点 3。

## 3.6 修复记录 + 端到端验证结果（2026-09-16）

### 修的四处

| # | 修复 | 位置 |
|---|---|---|
| 1 | 开课初始化**保留**计划（原为整段重写 `sessionArtifacts`） | `AITeachingCoordinator.ts` 初始化处（原 `:1599-1603`） |
| 2 | 回合侧**回填**计划（原只有 `startSession` 赋过值） | `resolveTurnMemoryWarmup` + `processStudentMessage` |
| 3 | 只把**尚未回捞**的点交给模型（`usedLoad` 同步收缩）；看板剥离/结果摘取仍用完整计划 | `pendingWarmupForModel` |
| 4 | **第 4 个缺陷（修复中发现）**：模型把温故点标成 `'review'`（已提问、未作答）时，旧代码把它当"结果"收录，收束时按"没答出"落成 `again`（rating=1）→ 污染 FSRS 与动态预算。现只有 `mastered`/`learning` 才算结果 | `WARMUP_RESULT_STATUSES` |

第 4 个缺陷在验证中**真实发生过**：库中出现过一条 `{"rating":"again","status":"review"}` 的假证据（已清理）。这条也说明"环通电"之后，**传感器语义**才是真正的风险面。

### 端到端验证（用当前代码开新虚拟课，**不用历史数据**）

复现：`npx ts-node --transpile-only src/scripts/verify-warmup-loop.ts --turns=2`

| 观测 | 结果 |
|---|---|
| 1 计划落库 | **PASS**（`sessionArtifacts.memoryWarmup.items=1`；修复前为缺失） |
| 2 计划到达模型 | **PASS**（老师主动开口回捞该点，并用**原名字**把结果写回 `knowledge.points`） |
| 3 结果摘取 | **PASS**（`items[0].outcome = {status:'mastered', progress:90}`） |
| 4 产生证据 | **PASS**（`review:result:电机看扭矩、电池看电压的验证数据口径配对`，`rating=good`、`masteryScore=0.85`、confidence 0.9） |
| 5 预算回校准 | **PASS**（`successRate` 由 `null` → 有样本；清理假样本后 `successRate=1` → `computeLoadBudget=3.0` **高档**） |

⇒ **环已通电**："successRate 恒 null、预算恒 2.0"的根因确认为上述断点，而不是"暂无数据"。

### 验证中暴露、尚未处理的三个问题（与 §7 呼应）

1. **未作答的点不会被"收紧"**：只有 `mastered`/`learning` 算结果 → 学生答不出时不产生任何记忆更新，也就没有 lapse 语义（与 §4.2(1) 的 `lapses≈0` 同一根源）。
2. **随堂温故会吃掉当日额度**：验证中见到 `当日剩余额度=0`（上限 6.0）→ 当天再开课就温故不了；额度与"每课 1–2 条"叠加后，实际能覆盖的到期量很小（§3.3）。
3. **分档是跳变的**：只有 `<0.7` / `>0.9` 两个阈值，中间带（0.7–0.9）恒为基准 2.0；样本少时档位会因单次结果剧烈跳动（1/1 成功即跳到高档）。
4. **结果摘取依赖"模型用原名字回写"**：两次全流程验证里，一次正常摘到（`…口径配对 → mastered`），一次没摘到——模型把温故点用**近义说法**问出来、没按计划原名字写进 `knowledge.points`，`normalizeConceptKey` 就匹配不上。⇒ 摘取对"换名"不稳，是下一步该收紧的点（提示词要求 + 匹配放宽，二选一或并用）。

## 3.7 P0-2 修复记录：难度锚点接进生产（2026-09-16）

**问题**：`recordTaskDifficultyAdjustment` 的唯一调用者是模拟脚本 → "难度调整有没有用"在真实课上从未被审计过。

**修复**：开课路径新增 `AITeachingOrchestrator.recordTaskDifficultyAnchor`（在 `startSession` 内、`completeInitialization` 之后调用）：

- 只留"有降档/升档理由"的锚点（无理由 = 无调整，无从度量）；
- 幂等键 = `taskId`（重复开课/会话恢复只更新同一条）；
- `occurredAt` 用**模拟时钟**（虚拟实验室回放历史日期时，必须与状态写入同一时钟，否则对账取不到"下一条状态"）；
- `applied = adjusted !== baseline`（档位**真的变了**）。生产没有随机对照组，`applied=false` 的自然对照只来自"理由触发但被地板/上限吃掉、档位没动"这类情形——该语义与"无随机对照"一并写进 evidence（`deliveryMode` / `hasRandomizedControl`）。

**回看工具**：`src/scripts/audit-difficulty-ledger.ts`（只读；按 `reason|applied` 出缓解率，并给 Δlsb/Δlf 均值）。

**真实数据首次出结果**（小陈，n=1，仅证明机制跑通，不构成任何结论）：

```
st_17887  5→3  applied=true
reasons=[path_load_unbalanced, fragile_concepts, struggling_concepts, prerequisite_gaps]
outcome=still_triggered  still=[path_load_unbalanced] ｜ Δlsb=-0.224  Δlf=+0.334
汇总：path_load_unbalanced|applied=true → n=1, relieved=0, rate=0%
```

值得注意：这次判据**没有**自证有效（`relieved=0`）——说明"降档必然被判有效"的风险至少在单例上没有被自动化乐观化。

## 3.8 P0-3 修复记录：最小结果测量层（保持率 × 间隔，2026-09-16）

**问题**：系统**没有任何结果测量**——全是过程代理（"状态理由是否复发"），于是"隔多久还记不记得"无从回答，调度参数（FSRS）也无法本地校准。

**做法（不新增表、不新增测验、不额外打扰学习者）**：
1. `ReviewCompletedConsumer` 写证据时补 `elapsedDays`：距**上次接触**的间隔（事件时间 − `memory_traces.lastSeenAt`；首次接触为 `null`）。课内温故与复习课同源，天然覆盖两条路径。
2. 新增纯函数模块 `services/memory/retention-curve.ts`：按间隔分桶（`0-0.5 / 0.5-1 / 1-3 / 3-7 / 7-14 / 14-30 / >30 / unknown` 天）统计**检索成功率**（`good`/`easy` 为成功，与动态预算同口径）与平均掌握度。
3. 新增只读脚本 `scripts/audit-retention-curve.ts` 输出曲线。

**实测**（新开一节课产出的真实结果）：

```
{"conceptKey":"逐节点倒推依据的文字化表达","rating":"hard","status":"learning",
 "progress":30,"masteryScore":0.5,"elapsedDays":6}

曲线：3-7d → n=1，成功率 0%；unknown → n=1（改动前的旧行，无该字段，按 unknown 妥善降级）
```

n=2 不能下任何结论；但**测量层已通电**，从今往后每次复习/温故都会给曲线贡献一个点。

**口径边界（必须随结论一起给出）**：这是**观测性**曲线，不是随机实验——"哪个点在哪个间隔被回顾"由调度器（稳定性/到期）与当日配额共同决定，与概念难度、掌握度相关，所以**不能**把"间隔越长成功率越低"直接读成因果。它的用途是：① 描述现状；② 给 FSRS 参数本地化提供拟合数据；③ 充当随机实验（§8 E1–E3）的基线。因果结论仍需**随机分配间隔**。

## 3.9 修复记录：两条"污染测量"的问题（2026-09-16）

上面几轮验证暴露了两处会**随机/系统性污染测量输入**的问题——刚通电的两条环，其数据质量取决于它们。

### (1) 结果摘取依赖"模型原名字" → **随机丢样本**

- **现象**：同一份代码两次全流程验证，一次摘到（`…口径配对 → mastered`），一次没摘到——模型用近义/截断说法回写点位，`normalizeConceptKey` 匹配不上。
- **修法**（`matchWarmupItem`）：先精确（归一化相等）；再退一步做**包含匹配**，但要求**双方归一化长度 ≥ 8** 且**唯一命中**，否则放弃（宁缺勿错）。摘取出的 `conceptKey` 归到**计划项的规范键**（原来直接用模型当时的写法——模糊匹配后那会是错的键，记忆引擎会定位到错误的 trace）。
- **为什么必须保守**：温故点会被**从本节看板摘除**（回归 2e3ca16），一旦误判，本节知识点会被当成温故点摘掉。所以宁可漏摘，不可错摘。

### (2) 成功率口径把"有进展的复习"算成失败

- **现象**：`learning`（提示词定义为"回捞成功、尚未掌握"）→ FSRS `hard` → 旧口径（仅 `good/easy` 算成功）**记成失败**。实测：一节有进展的课把 `successRate` 打到 `0`，预算从 2 掉到 1。
- **处理**：**不改产品行为**（严口径仍驱动预算），而是把它显式化，并**同时给出宽口径**（仅 `again` 是失败，FSRS 语义）。曲线脚本同时输出两列。
- **真实数据上的差别**（本次曲线，n=2）：

```
间隔桶      样本  严口径成功  严成功率  宽口径成功  宽成功率
3-7d          1          0       0%          1     100%      ← learning→hard 的那一条
unknown       1          1     100%          1     100%
```

同一个样本，严口径读作"完全没答出"，宽口径读作"回忆出来了"——**这正是需要人来看而不是让代码替我们选的地方**。

### 仍未解决（下一步）

**失败（未答出）不产生任何证据** → 成功率与保持曲线都是**上界**，不是真值。要修必须让"未答出"也留痕（提示词契约或模型显式标记一个 `recallFailed`），否则动态预算会长期偏向宽松档。

## 3.10 修复记录（P1-1）：给难度控制律装"油门"（2026-09-16）

**政策决定（已确认）**：知识类理由（`fragile_concepts` / `struggling_concepts` / `prerequisite_gaps`）**只挡升档、不再降档**；负荷类理由（`lesson_stress_high` / `path_load_unbalanced` / `fatigue_high` / `global_imbalance`）照旧降档。

**为什么必须改**：知识类信号在学新内容途中几乎恒大于 0 ⇒ 旧逻辑下**每节课都被系统性降一档**，且"升档前提 = 无任何理由"永远不成立 → 纯阻尼、没有油门（§4.2(2)）。

**同时去掉升档门槛里的"重复消费同一份证据"**：旧门槛要求 `cap==='high' && paceMode==='push' && ktl≥5 && lf≤3 && lss≤4`，而 `paceMode==='push'` 本身就是由 `ktl≥5 && lf≤3` 推出来的 → 同一份证据被算两次。现改为：`cap==='high'`（已蕴含"有余力、节奏可推"）`&& lss≤4`。

**三重闸门仍在**：① 存在任何理由（含知识类）→ 不升档；② 上节课紧绷（`lss>4`）→ 不升档；③ 难度仍受 `challengeLevelCap` 封顶。

**真实锚点前后对比**（同一条 `taskId`，幂等更新，同一份状态证据）：

```
修复前：5→3  reasons=[path_load_unbalanced, fragile_concepts, struggling_concepts, prerequisite_gaps]   （-2）
修复后：5→4  同一条 reasons 列表                                                                     （-1，仅负荷类降档）
```

**风险与回退**：这是**难度政策**变更（原行为有测试断言）。回退只需把 `decideTaskDifficulty` 里
`delta = -Math.min(loadReasons.length, 2)` 换回 `-Math.min(reasons.length, 2)`。
两个方向都会经 §3.7 的锚点留痕，因此"油门有没有被踩、踩了有没有用"都可度量。

**仍未做**：真正的"目标成功率带"双向闭环（把成功率稳定在 ~85%）需要一个**独立于 LLM 自评**的成功信号，属下一步（§8 E3）。

## 3.11 积压诊断（**未修**：属产品取舍）：到期 46–101 条 vs 每课 1–2 条

**实测（含本次修复产出的数据）**：

- `memory_traces` 573 条，其中 `fsrsStability` 非空 **仅 3 条**——正是本次验证跑出来的那几条。
  ⇒ **FSRS 只在温故环真正跑通之后才开始接管**；此前 449 条到期项都是**非 FSRS 路径**排定的（无 FSRS 状态）。
- 到期堆：小陈 101、老周 86、护士 79、周毅 46、谭小雨 21 …
- 吞吐：每课 1–2 条（预算 2.0 ÷ 单条负担 1.3–3.0），日上限 6.0 负荷。
- 入库：**每个被抽取的概念都会成为可调度记忆项**（无筛选）；`dialogue-concepts-extracted` 累计 64 次。
- 自净：`relearnSuggestions`（连续 3 次 `again`）依赖失败留痕，而失败目前**不留痕**（§3.9 遗留）→ **队列无法自净**。

**结论**：积压不是"吞吐不够"，而是**入库无筛选 + 队列无自净**（再叠上遗留调度项）——100 条排队、每天只发 1–2 张。

**三个选项（需产品取舍）**：

| 选项 | 做法 | 代价 |
|---|---|---|
| **A 收窄入库**（推荐） | 只把"够格"的概念纳入间隔复习（学习者确认过／掌握度达阈值／属路径核心概念），其余只留画像 | 需定义"够格"门槛；可能漏掉该复习的点 |
| **B 提高吞吐** | 积压超阈值时允许每课多接 1–2 条（或开"清账"模式） | 违背"温故只花 1–2 分钟"的承诺与负担预算纪律 |
| **C 允许自净** | 让"答不出"也留痕（= §3.9 遗留），使 leech/relearn 与逾期淘汰真正生效 | 需改提示词契约（模型显式标记未答出） |

**建议顺序**：先 **C**（它同时修掉 §3.9 的测量偏差），再 **A**（口径稳定后再收窄入库）。

## 4. 科学性评估（逐机制对照文献）

### 4.1 有依据且实现得当的部分

| 机制 | 文献 | 本系统 | 评级 |
|---|---|---|---|
| **间隔重复调度** | FSRS 基准：log loss **0.33** vs SM-2 **0.59**（约 2 万用户 / 15 亿条复习） | 用 `ts-fsrs`（DSR 三变量模型），而非 SM-2 | ✅ **选型正确** |
| **提取练习形式** | 主动自由回忆 > 重读（课堂 meta g≈0.70；但**数学** g=0.18，CI 跨 0，不稳健） | 提示词要求「无提示检索 → 一条最小提示 → 一句话对照」 | ✅ 形式正确（**但从未执行**，见 §3.2） |
| **交错（相似性调节）** | Brunmair & Richter 2019：总体 g=0.42，**数学 g=0.34**；**类别间越相似、类别内越不相似，收益越大** | 复习课路径按 `conceptKey` 轮转 + 用误解台账的 `canonicalLabel` 做**易混对分离** | ✅ **恰好命中文献的调节变量**（可惜仅复习课路径有，课内温故没有） |
| **合意困难目标** | Wilson et al. 2019 (Nature Comm)：SGD 类学习的最优错误率 15.87% ≈ **85% 成功率** | 明确以「~85%」为目标做预算回校准（0.7 / 0.9 两阈值） | ✅ 目标有据（**但回路断电**；且见 §4.2 的"只有刹车"问题） |
| **睡眠/活跃窗口** | Rasch & Born 2013（睡眠与记忆巩固） | `snapToActiveWindow`：睡前 23:00–07:00 不排、首次提取推到次日 09:00 后 | ✅ 少见的好细节 |
| **元认知校准** | JOL 偏差研究 | `selfAssessmentSignal` → `computeCalibrationBias` | ✅ 设计正确 |
| **自我调节学习框架** | Zimmerman 2000 | `deriveSRLPhase` 三阶段 | ✅ 命名与结构对齐 |
| **掌握/间隔的干扰控制** | 前摄干扰 | 活跃误解 → `stability × 0.85`、缩短间隔 | ⚠️ 合理启发式，未验证 |

### 4.2 有依据但实现有实质偏差的部分

**(1) 间隔调度：选型对，工程细节把优势吃掉了**

| 问题 | 影响 |
|---|---|
| **`lapses` 恒为 0**（`ReviewCompletedConsumer.ts:119` 等 5 处硬编码，schema 无该列） | FSRS 的 `Relearning` 状态**不可达**；卡壳与"第一次学"无法区分 |
| `enable_short_term: false` | 短期学习步进关闭，首日节奏退化为近似固定 1 天 |
| **直接用默认参数、无按用户优化** | FSRS 默认 17 参数在基准里 log loss 0.36–0.38（优化后 0.33）→ **兑现不了选型收益** |
| **无逾期补偿 / 无积压上限 / 无 cram 模式** | 435 条到期 + 每课 1 条 → 积压单调增长（§3.3） |
| `mode=review` 走**两条写路径**（`applyReviewExtraction` 直接写 + `review:completed` 消费者再写一次 FSRS） | 可能重复调度 / `extractionCount` 重复自增【B】 |

**(2) 难度自适应：一个**「只有刹车、没有油门」**的控制律 —— 这是最深的科学性风险**

- 降档理由有 7 条，每条 −1（上限 −2）：`lesson_stress_high`、`path_load_unbalanced`、`fatigue_high`、`global_imbalance`、`fragile/struggling/prerequisite_gaps`；
- 升档只有**一条且要同时满足**：无任何降档理由 **且** `cap==='high'` **且** `paceMode==='push'` **且** `ktl≥5 && lf≤3 && lss≤4`（`TaskDifficultyAdjustmentService.ts:152-158`）；而 `paceMode='push'` 本身又要求 `ktl≥5 && lf≤3`。
- **后果**：系统是一个纯阻尼控制器，其稳态就是**最低难度档**。更糟的是，它的"成功"判据是"下一条同路径状态不再触发同类降档理由"（`TaskDifficultyAdjustmentLedger.ts:238-255`）——而降档本身就会让状态回落，所以**它几乎必然报告自己有效**（自我印证的度量）。
- 与 85% 目标的关系：难度降 → 成功率升到 `>0.9` → 预算升（3.0），但**难度档位不会跟着升**。于是系统会稳定在"高成功率 + 低难度"，这与"把错误率维持在 15%"的文献目标**方向相反**。
  → **已修（结构部分）**：见 §3.10（知识类理由不再降档 + 升档门槛去掉重复消费）；"目标成功率带"的双向闭环仍待定信号。

**(3) 知识追踪（BKT）：公式对，但既没拟合、也没消费**

- 更新式与 Corbett & Anderson 一致，参数为手填先验（注释明说"不是拟合结果"）；
- 经典参数约束（如 `p(G)+p(S)<1`、Baker 等建议 `p(G)<0.5,p(S)<0.5`、1995 原文更严 `p(G)<0.3,p(S)<0.1`）**未见校验**：`hard` 档 `pG=0.35 / pS=0.15` 已超出 1995 建议；【B】
- 观测来自 LLM 的 `conceptAssessments.observed`（语义判断），而 BKT 假设是**单技能二值作答**；
- **`pKnowL` 目前零下游消费者**（不驱动间隔、不驱动难度、不驱动衰减）——现状是"看起来科学"的装饰；
- 文献趋势：25 年系统综述显示增强方向是引入学生特征/干预；对 LLM 场景，研究更倾向 **LLM 原生 KT**（LLMKT）而非套经典 BKT。

### 4.3 无依据（工程启发式）的部分

| 家族 | 具体 | 说明 |
|---|---|---|
| **LSS 公式** | 难度 0.3 + 认知负荷 0.3 + (1−效率)×4；时间因子 1.3/1.1/0.9；完成率 0.7+0.3r；类型 0.9/1.0/1.2/1.1 | 权重无来源；且**存在两套同名 LSS**（0–10 与 0–100，`learning-state.service.ts:694` vs `LearningMetricService.ts:58`），因子集不同 |
| **衰减率** | LSS 0.82/天、KTL 0.99/天、LF 0.74/天（回归基线 1.2） | 无来源；**LF 有三套法则**：EWMA `0.70/0.30`、任务完成 `0.70/0.15`（**系数和 0.85，未归一**）、自然衰减 `0.74/天` |
| **半衰期注释** | 注释称 KTL 42 天、LF 7 天；实际 λ=0.95→**13.5 天**、λ=0.70→**1.94 天** | 注释与实现不符（误导后续调参） |
| **聚合** | 活跃窗口 14 天；按路径 max；当日课量：每多一节 +0.5（上限 2.0）、超 90 分钟后每 30 分钟 +0.25（上限 1.5） | 无来源（"90 分钟"尤其像拍脑袋） |
| **控制状态阈值** | `lf≥6/3`、`ktl≥5/6`、`lss≥6/4`、`lsb<0`、`struggling>1` … | 无来源；仓库 `EDUCATIONAL_THEORY_MAP.md:67-69` **自己承认**：阈值来源"2026-05 历史分析（**已清理不保留**）"、EWMA 系数"**待真实数据拟合**"，并立下纪律"任何学习状态阈值须注明理论来源"——该纪律目前**大面积未被满足** |
| **档位刻度** | low 4 / medium 7 / high 10；基线 low3/med5/high7；Bloom 3–8 | 无来源 |
| **负荷预算** | 基准 2.0 / 低 1.0 / 高 3.0；单条负担 1.5/1.5/1.3，上限 3.0 | 部分有据（85% 目标），数值本身是工程估算 |

### 4.4 声称了但没有的部分

| 声称 | 实际 |
|---|---|
| **掌握学习**（mastery learning） | **无标准参照**：`mastered` 是 LLM 输出的字符串；`acceptanceCriteria` **明确不作门禁**（`teaching-turn/index.ts:457-469`）；检查点选项**没有正确答案**（`:290-292`），`passed` 由 `completionReady || status==='mastered'` 反推。→ 目前**不能声称掌握学习** |
| **认知负荷理论（CLT）** | 名义引用（配额给内在负荷留预算）；`LSS` 是加权和，**无测量学验证**（无信度/效度、无与 Paas/NASA-TLX 的聚合效度检验） |
| **心流 / Yerkes–Dodson** | 映射写在控制状态里，但仓库自己标注为"已实现但未命名（需补注释）" |
| **"效果度量"** | 只有**过程代理**（同类降档理由是否复发），知识类理由诚实标注 `not_measurable`；且生产无锚点（§3.4） |

### 4.5 缺失的维度

- **动机/情感**：`emotionalState`、`engagement`、`frustratedStreak` 有观测，但**不参与难度/节奏调整**（未闭环）；毅力、自我效能、目标定向均未建模。
- **社会/同伴**：有 `peer-reinforcement`，但不进入学习者状态回路。
- **结果测量**：无延迟后测/迁移测（见 §6）。

---

## 5. 工程评估

### 5.1 做得好的（应保留）

1. **三层状态语义**清晰：会话级 LSS 归课内、路径级负荷归本路径、学习者级总负担由"按路径保守聚合 + 当日课量"给出——避免了"一节课拖垮全部路径"的语义混淆。
2. **UTC 日界统一**（衰减/配额/当日课量/日期模拟口径一致），并把踩坑（本地日 vs UTC 日）写进注释与断言。
3. **量纲防线**：品牌类型（`InternalTen`/`DisplayHundred`）+ 单点归一 + 落库/读取双向自检，把"刻度"从注释变成编译期与运行期约束（有真实事故背景）。
4. **事件基建**：outbox/inbox + 幂等（`review:completed` 等消费者可安全重放）。
5. **可回滚**：归并凭据按次留档（`learner_evidence`），审计滚动窗口被清空后仍能回滚，且"凭据写不进去就当次撤销"。
6. **路径重排是确认制**：`replanSignal` 只作建议 + 预览，`requireConfirmation` 后才落——对高风险动作保持人在环，方向正确。
7. **best-effort 不阻断**：评审/温故/预测失败均降级不阻断开课（工程稳健性）。
8. **可封闭重放的验证脚手架**：日期模拟（过去日期 + `asOf`）让跨天行为可离线验证。

### 5.2 缺陷（按优先级）

| 级别 | 缺陷 | 证据 |
|---|---|---|
| **P0** | **课内温故环三处断点**（计划被初始化覆盖 / 从未进入 LLM / 结果摘取饿死）→ **已修复并端到端验证（§3.6）** | §3.2【A】 |
| **P0** | **无结果测量**，且"有效"判据自我印证 → 不可证伪 | §3.4、§4.2(2)【A/B】 |
| **P1** | 难度升档几乎不可能触发（纯阻尼控制律，稳态=最低档） | §4.2(2)【A】 |
| **P1** | 难度调整**生产无锚点** → 效果度量只跑过模拟 | §3.4【A】 |
| **P1** | **两套 LSS** 公式并存；**LF 三套法则**（含系数和 0.85 未归一）；KTL/LF 半衰期注释与实现不符 | §4.3【B】 |
| **P1** | **BKT 零消费**（写了不用） | §4.2(3)【B】 |
| **P1** | 到期积压无治理（435 到期 / 每课 1 条） | §3.3【A】 |
| **P2** | `session_load`（54 条）、`checkpointHistory`、`helpSeekingType`、`rsmAttempts` 生成但无消费者 | 【B】 |
| **P2** | `mode=review` 双写调度（可能重复排期/重复计数）；`lapses` 恒 0；`reps` 与 `extractionCount` 可能发散 | 【B】 |
| **P2** | 无法按会话核算 token/成本（日志表无 `sessionId` 外键） | 【B】 |

### 5.3 循环性风险（工程上最需要注意的一点）

状态机的**会话输入**是 `session-wrapup` 的 **LLM 自评**（`sessionLss/Ktl/Lf`），而难度档位**由这些状态决定**。于是存在一条最短自证回路：

> 模型自评"这节课很费力" → 下次降档 → 课变简单 → 模型自评"很轻松" → 状态变好 → 判"调整有效"。

任何基于此的"效果度量"（含 §3.4 的 `relieved`）都可能**测的是自己的输入**。要打破它，至少需要一个**独立于 LLM 自评**的传感器（作答正确性 / 标准参照后测）。

---

## 6. 关键判断：可证伪性

| 今天能回答 | 今天不能回答 |
|---|---|
| 流程有没有走通、状态量怎么演变 | **有没有学会**（无标准参照、无延迟测） |
| 难度档位算出了什么、为什么 | **难度调整有没有用**（只有过程代理 + 无生产锚点） |
| 复习计划长什么样、不变量是否成立 | **保持率是多少、间隔该多长**（无学习者真实作答） |
| 学习者模型的分层与隔离是否成立 | **哪种教学设计更好**（无随机分组/对照） |

一句话：**当前系统是"控制回路已接线、传感器多为代理量、记忆环路未通电、结果测量缺失"的状态**——工程上可运行，科学上尚不可证伪。

---

## 7. 最小可验证改动（按 ROI 排序，含验收标准）

### P0-1 修通课内温故环（三处，约 10 行）—— **已完成并端到端验证（§3.6）**

1. `completeInitialization`（`AITeachingCoordinator.ts:1599-1603`）：保留/合并 `sessionArtifacts.memoryWarmup`，不要整段覆盖；
2. `processStudentMessage`：重建 context 后用 `parseSessionArtifacts(session.teachingState).memoryWarmup` **回填** `context.memoryWarmup`（与 `:2142` 的取值口径统一）；
3. `generateOpening` 入参补 `memoryWarmup`（或明确：温故只在首个教学回合发生，则改由回合提示词承载，并同步前端文案）。

**验收**：跑一节虚拟课（走真实结算）后
- `teaching_sessions.teachingState` 出现 `sessionArtifacts.memoryWarmup`，且 `items[].outcome` 非空；
- `learner_evidence` 出现 `review:completed`（含 `rating`）；
- `buildReviewPlan` 的 `successRate` 从 `-` 变为数值；
- 连续课累计后，预算从基准 2.0 **分档**到 1.0 / 3.0 至少各一次。

### P0-2 难度调整落生产锚点（一行）—— **已完成并验证（§3.7）**

在 `TeachingContextBuilder` 计算档位处调用 `recordTaskDifficultyAdjustment`（与模拟脚本同一入口）。
**验收**：真实课产生 `task:difficulty:adjustment` 证据；回看脚本能对真实数据出 `relievedRate`，且 `applied` 不再恒等于模拟值。

### P0-3 最小结果测量层（关键，其它实验的前置）—— **已完成（观测层），因果实验仍待做（§3.8）**

- 在课内温故/复习课里增加**延迟回捞**：对同一概念记录 `elapsedDays`（1/3/7/14）与结果，按间隔分桶；
- 用现有 `review:completed` 证据即可实现，**不需要新表**（`payload` 里补 `elapsedDays`）。

**验收**：能画出一条"**保持率 ~ 间隔**"曲线（哪怕是模拟数据）。这条曲线是：① 间隔调度参数（FSRS 本地化）的唯一依据；② 后续一切"有效性"主张的证据底座。

### P1-1 难度控制律加"油门"（把 85% 目标真正闭环）—— **结构部分已完成（§3.10）；"目标成功率带"仍待定信号**

- 目标带（如成功率 0.80–0.90）**双向**调节档位：低于带下沿降档、高于带上沿升档（升档条件从"四条件同时满足"放宽为单一主指标）；
- 把"有效"判据从"状态理由消失"改为**独立传感器**（下一条同路径任务的作答正确性/理解度），并保留 `applied` 对照。

### P1-2 状态量口径收口（低成本、防误判）

- 合并两套 LSS（保留 0–10 一套，0–100 只作显示层）；
- 统一 LF 的三套法则（至少把 `0.70/0.15` 改成归一化 `0.70/0.30`）；
- 修 KTL/LF 半衰期注释（13.5 天 / 1.9 天）；
- 给每个常量补"来源"字段：`文献` 或 `工程启发式`（仓库已有此纪律，只需显式化并进 CI 检查）。

### P1-3 BKT 决策

**消费或删除**：要么让 `pKnowL` 驱动间隔/档位（并补参数约束校验与拟合），要么移除该投影避免"科学装饰"。二选一，不要停在现状。

### P2 积压与重复治理

- 到期 > N（如 30）时开启清账模式或提高每课配额上限；复核 `mode=review` 的双写；补 `lapses` 记录。

---

## 8. 建议的研究议程（可发表、可证伪）

| 实验 | 设计 | 主指标 | 提示 |
|---|---|---|---|
| **E1 课内温故 vs 无温故** | 学习者内交叉（crossover），随机分配课次 | D+7 标准参照后测（保持） | 数学域效应量预期 g≈0.2–0.3（试次内，需 ~90 对课次才有 80% 把握） |
| **E2 交错 vs 组块**（温故项顺序） | 同上，比较"易混对相邻" vs "同族相邻" | D+7 迁移题（新情境） | 参照 g≈0.34（数学）、相似性越高的类别收益越大 |
| **E3 难度控制律**：固定档 vs 目标成功率带 | 同上 | 迁移测 + 成功率 + Paas 负荷自评 | 直接检验"85% 带"假设；也是反驳"纯阻尼"风险的证据 |
| **E4 参数本地化** | 用积累的复习日志拟合 FSRS 参数 | log loss / 相同保持率下的复习量 | **前置**：先补 `lapses` 记录 |
| **E5 状态量效度** | `LSS` vs Paas/NASA-TLX 自评 + 行为指标 | 聚合/区分效度、重测信度 | 让"启发式"变成"可辩护的量表" |

**前置依赖**：**P0-3 之前，E1–E4 都无法开展**（没有结果测量就没有因变量）。
**伦理**：延迟后测应为低风险、不公示、不影响进度判定；仅用于系统改进。

---

## 9. 参考文献

**间隔重复 / 调度**
- FSRS 基准（约 2 万用户、15 亿条）：https://github.com/open-spaced-repetition/srs-benchmark
- Anki FSRS/SM-2 说明：https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html
- FSRS 与 SM-2 对照：https://github.com/open-spaced-repetition/fsrs4anki/wiki/Compare-Anki's-built-in-scheduler-and-FSRS

**合意困难 / 最优成功率**
- Wilson, Shenhav, Straccia & Cohen (2019) *The Eighty Five Percent Rule for optimal learning*, Nature Communications 10:4646. https://www.nature.com/articles/s41467-019-12552-4
- Nelson & Eliasz (2023) *Desirable Difficulty: Theory and application*, Med Educ 57(2):123-130. https://pubmed.ncbi.nlm.nih.gov/35950522/

**提取练习 / 间隔（含学科差异）**
- Carpenter, Pan & Butler (2022) *The science of effective learning with spacing and retrieval practice*, Nature Reviews Psychology. https://www.nature.com/articles/s44159-022-00089-1
- Murray, Horner & Göbel (2025) *A Meta-analytic Review of the Effectiveness of Spacing and Retrieval Practice for Mathematics Learning*, Educ Psychol Rev 37:75. https://link.springer.com/article/10.1007/s10648-025-10035-1
- 分散练习课堂 meta（d=0.54）：https://pmc.ncbi.nlm.nih.gov/articles/PMC12189222
- STEM 课程间隔练习单篇 meta（效应不稳定）：https://link.springer.com/article/10.1186/s40594-024-00468-5

**交错**
- Brunmair & Richter (2019) *Similarity matters: A meta-analysis of interleaved learning and its moderators*, Psychol Bull. https://pubmed.ncbi.nlm.nih.gov/31556629

**知识追踪**
- Šarić-Grgić, Grubišić & Gašpar (2024) *Twenty-five years of Bayesian knowledge tracing: a systematic review*, UMUAI 34:1127-1173. https://link.springer.com/article/10.1007/s11257-023-09389-4
- BKT 参数约束（从第一性原理推导）：https://arxiv.org/html/2401.09456
- KT × LLM 系统综述：https://arxiv.org/pdf/2412.09248

---

## 附录 A：复现命令（**在旧库上运行 → 输出属【D】，仅用于定位，不作证据**）

```bash
cd backend

# 1) 课内温故闭环实测（到期点 / 计划条数 / 预算 / 近期课是否带计划与结果）
npx ts-node --transpile-only src/scripts/audit-warmup-loop.ts

# 2) 复习闭环参数回看（预算/排队/明日预告/成功率 + 不变量）
npx ts-node --transpile-only src/scripts/audit-review-loop.ts

# 3) 路径重排单点测试（只读，不覆写）
npx ts-node --transpile-only src/scripts/eval-path-review.ts --user=<虚拟学习者ID> [--replan]
```

真实数据核查（SQLite）：

```sql
-- 温故/复习结果是否产生过
SELECT evidenceType, count(*) FROM learner_evidence GROUP BY 1 ORDER BY 2 DESC;
-- 计划是否落进过会话
SELECT count(*) FROM teaching_sessions WHERE teachingState LIKE '%memoryWarmup%';
-- FSRS 是否写过
SELECT count(*) total, sum(CASE WHEN fsrsStability IS NOT NULL THEN 1 ELSE 0 END) fsrs FROM memory_traces;
```

## 附录 B：历史库快照【D】（**不可作为证据**，仅存档）

> 该库为旧数据（历史批次 + 旧版本代码）。列此仅为留痕与后续对照，**任何结论都不据此得出**。新数据须按 §3.5 协议采集。

| 项 | 值 |
|---|---|
| 虚拟学习者 | 18 |
| 教学会话 | 182（全部 `mode='tutor'`） |
| `learner_evidence` 总量 | 1083（`goal:understanding:updated` 499、`path:created` 192、`path:generated` 188、`task:completed` 67、`session-knowledge-distilled`/`lesson:completed`/`dialogue-concepts-extracted` 各 62、`path:adjusted` 8、`path:completed` 3） |
| 其中 `review:*` | **0** |
| `memory_traces` | 560（`fsrsStability` 非空 **0**；`dueAt` 已排 435） |
| `learning_metrics` | `learning_state` 130、`session_load` 54（后者无消费者） |
| 有到期点但每课只能温故 | 1 条（到期 46–104 条） |
