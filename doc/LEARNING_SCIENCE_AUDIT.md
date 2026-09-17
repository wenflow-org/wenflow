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
2. **随堂温故会吃掉当日额度**：验证中见到 `当日剩余额度=0`（上限 6.0）→ 当天再开课就温故不了；额度与"每课 1–2 条"叠加后，实际能覆盖的到期量很小（§3.3）。→ **已修（2026-09-17）**：给单节课加**当日剩余份额上限**（`SESSION_DAILY_SHARE_CAP=0.6`，下限 `1.0`），当天第一节课不再把额度一次吃光；额度读不到时不启用该上限（保持"按会话预算走"的兜底语义）。
3. **分档是跳变的**：只有 `<0.7` / `>0.9` 两个阈值，中间带（0.7–0.9）恒为基准 2.0；样本少时档位会因单次结果剧烈跳动（1/1 成功即跳到高档）。→ **已修（2026-09-17）**：加**样本下限** `MIN_BUDGET_SAMPLE=5`，样本不足一律取基准（`computeLoadBudget(rate, sampleSize)`）。
4. **结果摘取依赖"模型用原名字回写"**：两次全流程验证里，一次正常摘到（`…口径配对 → mastered`），一次没摘到——模型把温故点用**近义说法**问出来、没按计划原名字写进 `knowledge.points`，`normalizeConceptKey` 就匹配不上。⇒ 摘取对"换名"不稳，是下一步该收紧的点（提示词要求 + 匹配放宽，二选一或并用）。
   → **已彻底修（2026-09-17）**：见 §7 P0-1 补记——结果改由**结构化字段** `control.warmupOutcomes` 承载（代码不做名字匹配），并加采样率留痕；
   同时匹配侧放宽（调序/截断）作为兼容通道保留。

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

## 3.12 修复记录（C 前半）：给"答不出"开一条入库通道（2026-09-16/17）

**机制（不改提示词）**：

- 模型把温故点写回 `knowledge.points` 时（哪怕只是 `status='review'/'pending'`）→ 记 `askedAt`（首次）。
  它只证明"这次回捞真的发生了"，**不等于有结果**（`markWarmupAsked`）。
- 结算时（`collectWarmupReviewItems`）：有 `outcome` 的点按结果映射；**有 `askedAt`、仍无 `outcome`、
  且学习者在该点之后还有发言** → 判为"没答出"（`again`）。其后没有学习者发言的点不计——
  那是"没来得及答"，不是"答不出"。
- 匹配同时放宽到能认**调序 + 截断**（字符重合率 ≥ 0.8、双方 ≥ 8 字、唯一命中）。
  实测生效：计划项 `三维质地安全边界（硬度、易碎度、适口性）` 被正确摘取并回写（此前会漏）。

**验证**：单元测试 7 例（成功 / 失败 / 没来得及答 / 压根没问 / 脏数据 / 混合 / 时间戳判定）；
端到端跑了两轮，都走了"成功"分支。

**为什么 E2E 还没见到 `again`（关键发现）**：现行提示词契约要求
"答不出 → 给一条最小提示 → 一句话对照 → **推进为 learning 或 mastered**"，
模型因此**总会把点推进**——在它的表达里根本不存在"给了提示仍然答不出"这个结果。
⇒ **C 的后半（改提示词契约）才是让它真正生效的一步**（已于 §3.13 完成并实测）。

**另一个观察**：模型有时**整节课跳过温故**（同一份计划、相同输入，一次做一次不做）——
遵守率有波动，宜在同一处提示词改动里一起收紧。

**顺带**：新增 `src/scripts/wake-hanging-sessions.ts`——走后端自己的收束路径唤醒 `active/paused`
悬挂会话（后端重启或本地验证中断常留下悬挂行，会占住 `openKey`，让后续开课撞冲突）。

## 3.13 C 后半：温故契约发布（教学回合 v15）+ 失败分支端到端实测（2026-09-17）

**改动**（只改 `prompts/core/teaching-turn.yaml` 的那一条，**不加新状态**——`review` 本就是合法状态）：

1. 开场从"不要跳过"收紧为"**只要 items 非空，就必须在进入本节新内容之前**先用 1–2 分钟回捞，不得跳过、也不得推迟到课中"；
2. 结果契约补上缺失的那一档："学生自己说出来（最多给过一条最小提示）→ 推进为 `learning`/`mastered`；**给了最小提示后仍然说不出来 → status 保持 `review`、progress 记实际（通常 0）**，不要为了'看起来有推进'而虚报——系统按这个状态判定'这次没答出'并据此调整后续温故量与间隔"。

**发布**：`compile-core-file --skill=teaching-turn --write`（产物 diff 仅 2 行：规则 + `coreHash`）→ `prompts:sync`（`updated: skill:teaching-turn`）→ 运行时 **ACTIVE v15**（v14 归档，已核对新文本入库）。
**门禁**：`prompts:core:check` 29/29 in-sync、`prompts:lint` 29/29、`prompts:snapshots:check` 一致。

**端到端实测**（虚拟学习者阿哲，"答不出"的学生脚本）：

```
观测1 计划落库      PASS（items=1）
观测2/3 模型问了    PASS（第 1 回合就回捞该点；三回合都没推进 → 保持未解决）
观测4 证据          PASS  review:result:真实投入与报价数字之间的折算关系
                          rating=again  status=not-recalled  progress=0  confidence=0.6  •  带 elapsedDays
观测5 预算回校准     PASS  successRate=0 → budget 1（低档）——失败第一次真正压低了预算
观测6 难度锚点       PASS  direction=keep  applied=false
                          reasons=[fragile_concepts, struggling_concepts, prerequisite_gaps]
```

这一次运行同时证实了四件事：

1. **失败入库通道生效**（`askedAt` → `not-recalled` → `again`）——此前失败永不入库；
2. **契约改动生效**（模型终于有一个诚实的"仍答不出"表达方式）；
3. **P1-1 政策生效**：只有知识类理由时 `direction=keep`（不再降档），且 `applied=false` 自然成为台账的对照分组（§3.10）；
4. **失败真正进入记忆**：FSRS 记 `again` + 证据落库 + 预算下调 + 保持曲线首次拿到失分点（§3.8）。

**遗留（下一轮）**：① 保持曲线的"间隔"目前只有少数样本，仍不够拟合；② 账本与"日窗口"在跨 UTC 日界附近出现过一次"脚本预演 1 条 / 开课 0 条"的漂移（该轮验证因此空跑），已在 §3.14 定案；③ ~~A（收窄入库）尚未做~~ → **已被否证并替代（§3.15 / §3.18）**：数据表明缺的不是"收窄"，而是**吞吐与溯源**，故改为 `memory_traces.pathId` 溯源 + "只当前路径"的范围过滤。

## 3.14 追查"配额漂移"：一次并发竞态 + 一个真缺陷（2026-09-17）

### (1) 漂移是**测试竞态**，不是产品缺陷

判别线索：同一概念两次复算的 `load` 从 **1.95 变成 1.3** —— 说明在"脚本预演"与"开课"之间，那条 `memory_traces` **被改写过**。虚拟学习者是**共享资源**（并行 worker 的会话会写同一批 trace：dueAt / mastery / load），预演快照天然会过期。
⇒ 已在验证脚本里加诊断（预演有样本而开课 0 条时，提示优先怀疑竞态并打印当日额度），避免下一次又误判。

### (2) 但顺着它发现一个**真缺陷**：记忆层"读侧用墙钟、写侧用模拟钟"

| 侧 | 位置 | 时钟 |
|---|---|---|
| **写** | `recordExtraction` / `applyKtEstimate` / `bumpReviewInterval`（`memory-trace.service.ts:193/401/451`） | `simulatedNowOr()` |
| **读** | `getDueTraces`（`:295`）、`getRetentionSnapshot`（`:357`）、`buildReviewPlan`（`review-plan.service.ts:344`）、配额账本（`review-quota.service.ts:74/92/123`） | **墙钟 `new Date()`** |

后果（日期模拟下）：`dueAt` 是按模拟时刻写的，而"到期"是按墙钟判的 ——
**模拟到未来 → 永远算不出到期（温故静默失效）；模拟到过去 → 全部算到期（积压爆掉）**。
这与文档里"跨天口径必须同一时钟"的纪律（以及 §3.7 里锚点 `occurredAt` 的同类修复）是同一类问题。

**修复**：读侧默认值统一改走 `simulatedNowOr()`（无模拟上下文时**等价 `new Date()`，现网行为零变化**），
共 5 处；并补两个回归测试：① 模拟上下文内 `quotaDateKey()` 取模拟日；② `buildReviewPlan` 传给到期查询的 `now` 必须是模拟时刻。
（`memory` 域 7 套 108 例全过。）

## 3.15 A（收窄入库）的前提被数据否掉：积压不是"垃圾入库"（2026-09-17）

**A 的原始假设**（§3.11）："每个被抽取的概念都会成为可调度记忆项（无筛选）" ⇒ 收窄入库即可治积压。

**实测（按 source 拆开看）**：

```
memory_traces 共 576 条：
  derived      455 条  ← 课上真正出现过的看板点（全部 lastSeenAt 非空、extractionCount ≥ 1）
  kt-estimate  116 条  ← 每回合 LLM 提到的概念，全部 lastSeenAt = null
  review-event   5 条  ← 复习结果（本次验证产出）

到期堆（dueAt <= now）421 条：**全部是 derived**。
kt-estimate 那 116 条因为 lastSeenAt 为 null，被 `getDueTraces` 的"never-seen 不判到期"规则排除 ✓
```

看板点按状态：`mastered` 49% + `learning` 35% + `pending` 10% + `review` 6%
⇒ 队列里 **84% 是学习者真正学过/推进过的点**（`pending` 只占 10%）。

**结论：A 的前提不成立**——队列没有被"顺带提到的概念"污染；它是"课上教过的每个点都要排间隔复习"
与"每课只发 1–2 条"之间的**吞吐 vs 覆盖面**问题（人均 ~25 条到期、每天 1–2 条 ⇒ 过一遍要数周）。

**因此真正的选项不是"收窄入库"，而是**：

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| **A′ 明确覆盖边界**（推荐） | 产品上把"温故 1–2 分钟"的承诺与"并非所有点都会被复习到"讲清；并把复习范围**限定在与当前里程碑/路径相关的旧知**（其余留画像） | 需要定义"相关性"；跨路径旧知的价值会被放弃 |
| **B′ 提高吞吐** | 在负担预算内把每课实际条数从 1–2 提到 2–3（现在 `MAX_WARMUP_ITEMS=3` 是上限，但因单条 load 1.3–3.0 对 2.0 预算，实际常只落到 1 条） | 与"只花 1–2 分钟"的承诺冲突；需要先论证 load 估算没有虚高 |
| **C′ 逾期淘汰** | 逾期超过 K×间隔的点退出队列 | **科学上可疑**：遗忘后再提取正是合意困难的核心价值（§4.1），淘汰掉最该复习的点方向相反 |

**我的建议**：先做 **A′ 的产品口径澄清**（不改算法、只改"承诺与范围"），把 B′（load 估算是否虚高）留到有
真实吞吐数据之后再说；C′ 不做。
**下次动手前先定 A′ 的"相关性"口径**（按当前里程碑 / 按路径 / 按最近 N 天），这属产品取舍。

## 3.16 修复记录：`load` 估算与预算语义打架——"每课只发 1 条"的结构性原因（2026-09-17）

**症状**：所有学习者、每节课的温故计划都只有 **1 条**，即使到期几十条（§3.3/§3.11 记录过，当时归因于"积压"）。

**根因**：`estimateConceptLoad` 里对"掌握度 < 0.5"乘 **×1.3**（`unfamiliar:mastery`）。而
**到期项的掌握度本来就低**（到期 = 保留率跌破阈值）⇒ 这个系数几乎给**每一条**统一加价：
单条最低 **1.3**，两条就 **2.6 > 基准预算 2.0** ⇒ **结构上永远只装得下 1 条**。
而 `BASE_LOAD_BUDGET` 的注释写明"约等于**两个原子点**"——语义被这个统一加价架空了。

**实测（11 个有到期点的虚拟学习者）**：

```
修复前：共发出 12 条（每人 1 条；少数 1 条就吃掉 used=2.93）
单条负担分布：min=1.0  p50=1.3  max=2.93（预算 2.0）
反证：有学习者单条正好 1.0（掌握稳）时 → 现在就能装下 2 条 ✓ 说明语义本来可达
修复后：共发出 15 条（+25%；两个人从 1 条变 2 条）
```

**修复**：`estimateConceptLoad` **不再把掌握度当负担乘数**——"生疏"本来就是它到期的原因，
且选点顺序已按保留率从低到高排（优先级不受影响）；真正有区分度的结构复杂度（复合/流程）保留。
同时把 `BASE_LOAD_BUDGET` 注释改成可达的口径（"两个原子点，或一个复合/流程点"）。

**为什么是"修语义"而不是"调参"**：+25% 而不是翻倍，因为多数概念是复合/流程型（1.5/2.25），
第二个点常常仍装不下——这是**正确**的（重负担点就该占更多预算）。**日上限 6.0 未动**，不引入新的额度放大。

**顺带修掉一个既有的日期脆弱测试**：`learner-state-aggregation.test.ts` 有一处
`getAggregatedState('u1')` 没传 `asOf` → 用真实墙钟；快照时间戳固定为 `2026-09-16T03:00`，
日期跨到 09-17 后那条被自然衰减（算出 `1.2+(9.5−1.2)×0.74+2.0 = 9.342`，断言假失败）。
已锚定 `asOf`。（这类"随日历到期"的测试会被任何人撞上。）

## 3.17 **从零验证**：空库起步，整条闭环自己长出来（2026-09-17）

此前所有验证都建立在**带历史包袱**的虚拟学习者上（几十条遗留 trace、几十条到期）——无法回答
"这套东西在没有历史数据时能不能自己长出来"。为此新增
`src/scripts/verify-from-zero.ts`：**新建虚拟学习者** → 生产链路生成路径 → 上课 → 跨天 → 再上课，
用当前代码 + 真实 LLM 跑，逐项核对。

```
PASS 0  造人            user=dd0a42d0（isVirtualLearner=true）profile=ae1dbbf3
PASS 1  路径            path=lp_1789605 里程碑=3 首任务=「通读短文并标记核心主张句」
PASS 1b 空库起步        起步时 memory_traces=0（确认无历史）
PASS 2  首课无温故       warmupItems=0 ← 从零没有到期点，**不该温故**（空计划分支正确）
PASS 2b 课后长出记忆     memory_traces=2（起步 0）
PASS 2c 课后落状态       learning_state 行=1
PASS 2d 首课无复习证据   review:completed=0
PASS 3  跨 3 天后有温故  warmupItems=1 →「主张与证据的关系标注」   ← 第 1 节的点到期了
PASS 4  温故结果入库     rating=hard status=learning progress=60 **elapsedDays=3**
INFO 5  难度锚点=1；计划 backlog=0 successRate=0
```

**这一跑的分量**：

- 它一次性验证了 **造人 → 路径 → 任务 → 上课 → 记忆入库 → 跨天到期 → 温故 → 结果回写** 全链，
  **不依赖任何历史数据**；
- 观测 3 同时是 §3.14 **时钟修复的端到端证据**：读侧若仍用墙钟，第 2 节课（模拟 +3 天）就会
  "永远算不出到期"、温故不会出现；
- 观测 4 的 `elapsedDays=3` 说明保持曲线的横轴在**空库起步**时也正常；
- 观测 2 反向证明了"**没有到期点就不温故**"这条边界（不是所有课都硬塞温故）。

**过程中的两个工程细节**（已写进脚本注释，供后来者）：
① 阶段任务由**后台任务**生成（`runBackgroundTask('learning.path.stage-enrichment')`），
`generate()` 返回时任务还没落库 → 必须轮询等待（生产线里由前端轮询 run 状态）；
② 时钟工具在 `services/virtual-lab/`（不是 `virtual-lab/`），脚本里容易写错。

**复现**：`npx ts-node --transpile-only src/scripts/verify-from-zero.ts --turns=2 --days=3`
（会真实新建一个虚拟学习者；跑完可用 `audit-warmup-loop.ts` / `audit-difficulty-ledger.ts` / `audit-retention-curve.ts` 回看）

## 3.18 A′ 实施：先否证两个便宜口径，再补上真正的缺失（溯源）——2026-09-17

### (1) 先量：两个"便宜口径"都不可用

| 候选口径 | 实测保留率 | 结论 |
|---|---|---|
| 只复习"最近 14 天接触过"的旧知 | **100%**（到期项本来就都是最近接触的） | 过滤 0%，**无效** |
| 只复习"命中本路径任务目标/标题"的旧知 | **0–1%**（如 1/86、0/46） | 几乎全砍，**等于关掉温故** |

副作用认知：把范围限定成"只复习当前路径"还会**违反既有设计**——跨路径复习是刻意支持的
（`originPathTitle` 的用途就是解释"这是你在《X》里学过的"）。

### (2) 根因：记忆条目**没有路径身份**

`memory_traces` 此前没有 `pathId`；`originPathTitle` 只能靠"曾经复习过 → 那次会话的路径"反查，
所以**首次温故永远说不清来源**，按路径限定范围也无从实现。

### (3) 落地（本次）

- **`memory_traces.pathId`**（迁移 `20260917000000_memory_trace_origin_path` + 索引）；
- **写入侧带上来源路径**：`recordSessionOutcome`（课末看板）、`recordExtraction`（复习提取）、
  `applyKtEstimate`（回合观测）、`ReviewCompletedConsumer`（复习事件首建）——统一从会话带入；
  **只在首次创建时写，更新不覆盖**（`originPathTitle` 的语义是"最早出现"）；
- **`originPathTitle` 改为 pathId 优先**，老数据再回落到证据反查（兼容，不迁移历史行）；
- 顺手把读侧的 `getDueTraces` 也带出 `pathId`。

### (4) 立刻可见的收益

**首次温故就能说清来源**（此前必须"曾经复习过"才有）。从零验证复跑（12 项全绿）：

```
PASS 4  温故结果入库     rating=again status=not-recalled elapsedDays=3   ← 失败通道
PASS 6  记忆条目带来源路径 4/4 条有 pathId
PASS 7  温故项带来源路径   「科普论证复述入门」          ← 首次温故即带出路径标题
```

### (5) 仍未做：范围的**过滤**

现在 pathId 有了，'只复习某条路径的旧知' 距实现只差一个过滤条件——但**口径要你定**：
只当前路径 / 最近活跃路径（14 天）/ 不限（现状）。注意上面 (1) 的测量：单靠"名字匹配"不可行，
必须用 pathId 这类**结构身份**。

### (5) 范围的过滤（阶段口径：**只当前路径**）—— 已实现

- `buildReviewPlan(userId, { pathId })`：**来源明确且非本节路径**的旧知不进本节队列；
  **`pathId` 为空的历史行仍可复习**（无法判断归属，避免老数据一刀切失效）；
  不传 `pathId` 则不启用（脚本/后台回看与旧行为一致）。
- 开课时由 `AITeachingCoordinator.startSession` 传入本节路径（`context.learningPathId`）。
- `backlogCount` 天然按范围算（队列本就是按池子计，不额外查库）。
- **验收（真实数据，只读操作）**：
  - 兼容：两个老学习者（痕迹无来源路径）带/不带 `pathId` **完全一致**（1 条 / backlog 59）；
  - 生效：新学习者把时间推到 +30 天后 —— 不带范围 1 条、带本路径 1 条、**带不存在的路径 0 条**；
    且该项来源标题正是《科普论证复述入门》（**首次温故即可说清来源**）。
- **未纳入范围**：显式复习课（`mode='review'`）走的是另一条选点（`LearnerExitService.getDueReview`），
  保持全局——那是学习者**主动要复习**，不属于"本节温故范围"的语义。

## 3.19 skill 层全链路调查（2026-09-17；回应"课堂 skill 有没有做动态"）

**方法**：29 个 `prompts/core/*.yaml`（唯一事实源）按链路分三组**逐条读完**（课堂 6 / 路径 10 / 学习者模型 11），
每个 skill 记录：消费的动态输入、显式自适应规则（带阈值）、产出与回馈、与代码的重复/冲突、缺口、跨课记忆/自校准。

### (1) 结论先行：**skill 层的动态远比我此前讲的密集——我的旧判断要修正**

| skill | 自适应规则 | 双向 | 带阈值 | 跨课记忆 |
|---|---|---|---|---|
| `teaching-turn` | **~22 条** | 是 | 是（loadIndex 0.3 / 0.6–0.8 / 0.85；understanding≥0.8；连续 2 轮；样本 <3/<5；检查点 ≥4 轮）| 是 |
| `goal-conversation` | ~21 条 | 是（收敛节奏）| 是（overall<60、≥1 轮具体场景、<2 轮禁 confirmed）| 是（自管 state）|
| `path-planning` | ~13 条 | 是 | 是（milestone 3-6、hub 复用、相邻新概念≤2…）| 是（reviewerFeedback / learnerReplanProjection）|
| `session-wrapup` | ~8 条 | 是（自评即权威指标）| 是（8-10/5-7/1-4、retrievability<0.8）| 是（reviewHints）|
| `stage-designer` | 9 条 | 部分 | 是（loadTarget 分档、ICAP 非递减）| 复用重排投影 |
| 其余 24 个 | 0–6 条 | 多为单向（文案/报告）| 部分是 | 少 |

**课内那条带确实存在**：`teaching-turn` 规则 92 的三路由（`loadIndex<0.3` 且正答 → 抛高阶边界用例/反常识反问；
`0.6–0.8`"愤悱带" → 只给一条最小提示；`>0.85` → 共情 + 拆步）+ 规则 64（轻松达标→升级／反复失败→降级）+
规则 109（bored → 换 challenge/reflect）。⇒ **逐回合、双向、有带**。我在对话里说错的那句已当场更正。

### (2) 最重要的结构性发现：分工是「**prompt 定语义/分档，代码定数值/裁决**」

`taskDifficulty.adjusted`（代码 `decideTaskDifficulty`）、`learningControlState.*`（代码 `deriveLearningControlState`）、
`loadIndex` → `determineNextStage`（代码路由）、BKT 数值（代码 `concept-belief`）、referee/actor-auditor 的
verdict 权重、predictor 的 `stallRisk` clamp 与 tone 自洽……**这是纪律，不是缺陷**——
与我一直在做的"LLM 只出观测、档位/数值由代码给"一致。skill 层负责的是**怎么教**，代码层负责**该多难/该多少量**。

### (3) 但查出 12 处**断链 / 死规则 / 双源**（前 4 条本次已亲自复核 ✓）

**P0（规则写了，数据没喂 / 恒值）**

1. **`path-planning` 的 `learnerLearningContext` 是死规则** —— 值在 `learning.service.ts:1821` 赋好，
   但 `path-planning/index.ts` 的 `buildPromptFriendlyNormalizedInput` **不包含该字段**，全仓再无引用
   ⇒ 规则 53「按 mastered/fragile/struggling/blocked 校准路径」**永不生效**（**路径生成实际上没看学习者证据**）。【✓复核】
2. **`peer-reinforcement` 的 `strategy` 恒为 `'feynman'`**（`AITeachingCoordinator.ts:2116,3528`）
   ⇒ 规则 38「按 `cognitiveLevel` 选手法（类比/反例/辩论）」永不触发；规则 41 的"高负荷"分支因输入无
   `loadIndex/emotionalState` **不可达**。【✓复核】
3. **`session-wrapup` 声称有 loadIndex 均值/峰值，实际没有** —— `computeSessionEvidence` 返回
   （`AITeachingCoordinator.ts:1242-1251`）不含任何 loadIndex；`session_load` 只落 `learning_metrics`、从不进 wrapup payload
   ⇒ 规则 29/43 按高负荷判定的分支无据。【✓复核】
4. **`learner-state-review` 的 `priorInsights` 硬编码 `[]`**（`LearnerStateReviewService.ts:279`）
   ⇒ 历史洞察的自反馈断链（每次评审看不到上次的洞察）。【✓复核】

**P1**

5. `stage-designer` 规则 39 依赖 `milestone.loadTarget`，代码从不注入 → 死规则。
6. `path-reviewer`：`successCriteria` 未传；yaml 的 input ref（`sandbox:path.normalizedInput.prerequisiteTree`）与代码实传（`analysis.cognitiveCore.prerequisiteTree`）不符。
7. **replan 召回两套阈值并存**：`LearnerSnapshotService.deriveReplanSignal`（7 reasonCodes）vs `ReplanAdvisoryService.build`（另含 lss≥6 / movedToReview / ktl≥7）→ skill 收到的 `reasonCodes` 与实际召回方向可能不一致。
8. 4 个 skill 的 yaml **没有 `inputs:` 契约段**（`teaching-opening-generator` / `adaptive-guidance-copy` / `learner-progress-report` / `replan-attribution`）→ 契约只在代码里，迁移风险。
   → **已补（2026-09-17），但第一版被 CI 抓到缺陷**：我最初按"代码 payload 字段"写了 `sandbox:teaching.openingMode` 这类路径，
   而沙盘路径注册表（`agent-contract-view`：输入通道 / 输出字段 / `SANDBOX_EXTRA_KEYS`）里**没有这些键** ⇒
   `prompts:check:all` 的 **strict 对账**报 18 个 `sandbox-path-unregistered`。
   修正为**注册表里真实存在的键**（如 `teaching.scenario` / `teaching.learner.learnerProjection` /
   `profile.snapshot.replanSignal` / `teaching.session.wrapup` / `path.path.summary`），并把"调用方派生的字段"写进 `desc`；
   同步 `skills.yaml` 的 `dataSource.sandbox` 两向对齐。**教训**：87 步"补契约"必须把
   `prompts:check:all`（含 inputs↔handoff strict 对账）列入门禁清单——我当时只跑了前缀两向比对的子集，漏了这条严格门禁。

9. `virtual-learner-referee` 的 `buildUserPayload` 漏发 `storyMeta/metricCompleteness`，但代码用它们打分、yaml 也声明为输入。

**P2（口径 / 理念）**

10. `teaching-turn` 自相矛盾：规则 82「不得自行推断难度档位」vs 规则 108 要求模型自估 `ktEstimate.currentTaskDifficulty`。
11. `memory-curator`「自评 0.5–0.65 算嘴硬」vs 代码 fallback 阈值 0.65/0.4 —— 口径不一致。
12. `persona-designer` yaml 要求"禁止兜底句"，代码 normalize 却大量默认值回填 —— 理念冲突（保成功率优先）。
    另有两处**双源并存**：`recommendedPacing`（runtimeSignals）与 `learningControlState.paceMode`；`loadIndex` 模型自产又自消费、代码也消费。

### (4) 正面的资产：4 处**自我校准**闭环（真实学习者侧只有 2 处）

| skill | 校准方式 |
|---|---|
| `learning-predictor` | 预测 → 任务后回填 → 命中率/校准桶 → `reliability` 回注教学（样本 <5 不引用）|
| `learner-state-review` | 可证伪断言 → hit/miss → hitRate；**被证伪的 claim 不再回注教学** |
| `virtual-learner-memory-curator` | `selfCalibration` → 回写画像 `selfAssessmentAccuracy` |
| `virtual-learner-actor-auditor` | `frictionCalibration<60` → 回写 `frictionBudget` |

（后两处在**虚拟学习者**侧，不影响真实学习者。）

### (5) 对前面章节的修正

- **§4.2(2) / §3.10「只有刹车没有油门」只在"跨课档位"成立**（`taskDifficulty` 确实只看状态理由）；
  **课内不成立**——`teaching-turn` 有 ~22 条双向规则（含 loadIndex 三路由带）。
- **第三件（目标成功率带）要重新表述**：缺的不是"动态"，而是
  ① 课内那条带的横轴是**负荷**（loadIndex），不是**成功率**（85% 规则针对错误率，两者相关但不等价）；
  ② 三条升/降判据（三路由 / cognitiveLevel / bored）彼此独立、**没有统一目标带**；
  ③ 课内动态**不带跨课记忆**（跨课输入有 lastLessonRecap/behavioralProfile，但没有"最近几节 loadIndex/正答分布"这种**带**）。

### (6) 优先级（据本次调查重排）

**先修断链（便宜、确定、影响大），再谈新测量**：P0 → ①②③④；P1 → ⑤–⑨；P2 → ⑩–⑫；最后才是第三件（目标带 + 独立信号）。

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
| ~~**`lapses` 恒为 0**~~ → **已落库（2026-09-17）**（新增列 `memory_traces.fsrsLapses`，5 处硬编码改为读列/写结果） | **口径修正（实测）**：`enable_short_term: false` 下 lapses **不改变** stability/difficulty/interval（ts-fsrs 内部据此判 `Relearning`，但短期步进关闭时与 `Review` 同结果）⇒ 价值在**计数本身**（卡壳率 / leech 判定 / E4 参数拟合维度），不是"间隔变短" |
| `enable_short_term: false` | 短期学习步进关闭，首日节奏退化为近似固定 1 天 |
| **直接用默认参数、无按用户优化** | FSRS 默认 17 参数在基准里 log loss 0.36–0.38（优化后 0.33）→ **兑现不了选型收益** |
| **无逾期补偿 / 无积压上限 / 无 cram 模式** | 435 条到期 + 每课 1 条 → 积压单调增长（§3.3） |
| `mode=review` 走**两条写路径**（`applyReviewExtraction` 直接写 + `review:completed` 消费者再写一次 FSRS） | 可能重复调度 / `extractionCount` 重复自增【B】 |

**(2) 难度自适应：一个**「只有刹车、没有油门」**的控制律 —— 这是最深的科学性风险**

- 降档理由有 7 条，每条 −1（上限 −2）：`lesson_stress_high`、`path_load_unbalanced`、`fatigue_high`、`global_imbalance`、`fragile/struggling/prerequisite_gaps`；
- 升档只有**一条且要同时满足**：无任何降档理由 **且** `cap==='high'` **且** `paceMode==='push'` **且** `ktl≥5 && lf≤3 && lss≤4`（`TaskDifficultyAdjustmentService.ts:152-158`）；而 `paceMode='push'` 本身又要求 `ktl≥5 && lf≤3`。
- **后果**：系统是一个纯阻尼控制器，其稳态就是**最低难度档**。更糟的是，它的"成功"判据是"下一条同路径状态不再触发同类降档理由"（`TaskDifficultyAdjustmentLedger.ts:238-255`）——而降档本身就会让状态回落，所以**它几乎必然报告自己有效**（自我印证的度量）。
- 与 85% 目标的关系：难度降 → 成功率升到 `>0.9` → 预算升（3.0），但**难度档位不会跟着升**。于是系统会稳定在"高成功率 + 低难度"，这与"把错误率维持在 15%"的文献目标**方向相反**。
  → **已修（结构部分）**：见 §3.10（知识类理由不再降档 + 升档门槛去掉重复消费）；
  **独立传感器 + 双向带已落地（2026-09-17，§7 P1-1）**：带由代码裁决的检查点成功率驱动，
  低于带降档、高于带升档（不再要求"无任何理由"），带内/样本不足不动；**"85% 目标闭环"仍是接线完成、非已达成**。
  ⚠️ **限定范围（2026-09-17 补）**：本条的"纯阻尼/没有油门"**只对"跨课档位"成立**。**课内**的动态在 skill 层——
  `teaching-turn` 有 ~22 条带阈值的双向规则（loadIndex 三路由 0.3/0.6–0.8/0.85、cognitiveLevel 升降、bored 判定），
  详见 §3.19。

**(3) 知识追踪（BKT）：公式对，但既没拟合、也没消费**

- 更新式与 Corbett & Anderson 一致，参数为手填先验（注释明说"不是拟合结果"）；
- 经典参数约束（如 `p(G)+p(S)<1`、Baker 等建议 `p(G)<0.5,p(S)<0.5`、1995 原文更严 `p(G)<0.3,p(S)<0.1`）**未见校验**：`hard` 档 `pG=0.35 / pS=0.15` 已超出 1995 建议；【B】
  → **已修（2026-09-17）**：补 `validateBktParams`（启动即校验分档表）+ `hard` 档改 `0.25/0.1`；取舍见 §7 P1-3；
- 观测来自 LLM 的 `conceptAssessments.observed`（语义判断），而 BKT 假设是**单技能二值作答**；
- **`pKnowL` 目前零下游消费者**（不驱动间隔、不驱动难度、不驱动衰减）——现状是"看起来科学"的装饰；
  → **已解（2026-09-17）**：唯一的消费是**有界**的"信念背离 → 回路径重学建议"（`review-plan` 的 `belief-divergence`），
  **仍不驱动间隔/难度**（理由：参数未拟合、观测不满足 BKT 假设）；
- 文献趋势：25 年系统综述显示增强方向是引入学生特征/干预；对 LLM 场景，研究更倾向 **LLM 原生 KT**（LLMKT）而非套经典 BKT。

### 4.3 无依据（工程启发式）的部分

| 家族 | 具体 | 说明 |
|---|---|---|
| **LSS 公式** | 难度 0.3 + 认知负荷 0.3 + (1−效率)×4；时间因子 1.3/1.1/0.9；完成率 0.7+0.3r；类型 0.9/1.0/1.2/1.1 | 权重无来源；**2026-09-17 已把同名 LSS 从三套收敛为两套**：状态真源 = `learning-state.service.calculateLSS`（0–10 五因子），显示层 = `metrics/LearningMetricService.calculateLSS`（0–100 任务完成口径，`LearnerProgressService` 改为委托它） |
| **衰减率** | LSS 0.82/天、KTL 0.99/天、LF 0.74/天（回归基线 1.2） | 无来源；**LF 三套法则已定位并归一（2026-09-17）**：状态 EWMA `0.70/0.30`、任务完成更新 `0.70/0.15 → 0.70/0.30`（原系数和 0.85 使稳态 = 0.5c）、自然衰减 `0.74/天` |
| **半衰期注释** | 注释曾称 KTL 42 天、LF 7 天；实际 λ=0.95→**13.5 天**、λ=0.70→**1.94 天** | **已修（2026-09-17）**：`learning-state.service` 头部与公式注释统一为 13.5 / 1.9 天 |
| **聚合** | 活跃窗口 14 天；按路径 max；当日课量：每多一节 +0.5（上限 2.0）、超 90 分钟后每 30 分钟 +0.25（上限 1.5） | 无来源（"90 分钟"尤其像拍脑袋） |
| **控制状态阈值** | `lf≥6/3`、`ktl≥5/6`、`lss≥6/4`、`lsb<0`、`struggling>1` … | 无来源；仓库 `EDUCATIONAL_THEORY_MAP.md:67-69` **自己承认**：阈值来源"2026-05 历史分析（**已清理不保留**）"、EWMA 系数"**待真实数据拟合**"，并立下纪律"任何学习状态阈值须注明理论来源"——该纪律目前**大面积未被满足** |
| **档位刻度** | low 4 / medium 7 / high 10；基线 low3/med5/high7；Bloom 3–8 | 无来源 |
| **负荷预算** | 基准 2.0 / 低 1.0 / 高 3.0；单条负担 1.5/1.5/1.3，上限 3.0 | 部分有据（85% 目标），数值本身是工程估算 |

### 4.4 声称了但没有的部分

| 声称 | 实际 |
|---|---|
| **掌握学习**（mastery learning） | **无标准参照**：`mastered` 是 LLM 输出的字符串；`acceptanceCriteria` **明确不作门禁**（`teaching-turn/index.ts:457-469`）；检查点选项**没有正确答案**（`:290-292`），`passed` 由 `completionReady || status==='mastered'` 反推。→ 目前**不能声称掌握学习**。**部分改善（2026-09-17）**：检查点可带**答案键**并由**代码裁决**（`judgeCheckpointAnswer`），该通道下 `passed` 不再来自模型自评；但答案键仍由 LLM 给出，且 `acceptanceCriteria` 仍不作门禁——所以"掌握学习"仍**不能声称**，只能说"第一个独立于自评的观测已就位" |
| **认知负荷理论（CLT）** | 名义引用（配额给内在负荷留预算）；`LSS` 是加权和，**无测量学验证**（无信度/效度、无与 Paas/NASA-TLX 的聚合效度检验） |
| **心流 / Yerkes–Dodson** | 映射写在控制状态里，但仓库自己标注为"已实现但未命名（需补注释）" |
| **"效果度量"** | 只有**过程代理**（同类降档理由是否复发），知识类理由诚实标注 `not_measurable`；且生产无锚点（§3.4） |

### 4.5 缺失的维度

- **动机/情感**：`emotionalState`、`engagement`、`frustratedStreak` 有观测。**现状核对（2026-09-17）**：
  `frustratedStreak` **已进一处决策**（PF 模式逃生舱：连续 ≥2 轮受挫 → `ready_to_close`，`AITeachingCoordinator:821`），
  但**仍不进难度/节奏**；`emotionalState`/`engagement` 只进提示词上下文。→ 未闭环部分：受挫/疲劳 → **节奏与支架**的信号化
  （注意：这些是 LLM 观测=软传感器，只宜作"降档/减速"方向，不能作升档依据）。毅力、自我效能、目标定向均未建模。
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
| **P0** | **无结果测量**，且"有效"判据自我印证 → 不可证伪 → **部分已修（2026-09-17）**：检查点**答案键 + 代码裁决**给出第一个独立于自评的观测（§7 P1-1）；**延迟/迁移后测仍缺**（§6） | §3.4、§4.2(2)【A/B】 |
| **P1** | ~~难度升档几乎不可能触发（纯阻尼控制律，稳态=最低档）~~ → **已修并实测（2026-09-17）**：成功率带上沿触发升档（5→6，理由含 `success_rate_above_band`） | §4.2(2)【A】 |
| **P1** | ~~难度调整**生产无锚点** → 效果度量只跑过模拟~~ → **已修（§3.7）**：开课路径写 `task:difficulty:adjustment` 锚点 | §3.4【A】 |
| **P1** | ~~**两套 LSS** 公式并存；**LF 三套法则**（含系数和 0.85 未归一）；KTL/LF 半衰期注释与实现不符~~ → **已收口（2026-09-17，§7 P1-2）** | §4.3【B】 |
| **P1** | ~~**BKT 零消费**（写了不用）~~ → **已决策（2026-09-17，§7 P1-3）**：保留投影（E4 底座），补参数约束校验 + 一处**有界**消费（信念背离 → 回路径重学建议），仍不驱动间隔/难度 | §4.2(3)【B】 |
| **P1** | 到期积压无治理（435 到期 / 每课 1 条）→ **部分已修（2026-09-17）**：每日额度 + 顺延（`ReviewQuotaService`）+ 单节课份额上限；**cram 模式 / 逾期补偿仍未做** | §3.3【A】 |
| **P2** | ~~`checkpointHistory`~~ → **已消费（2026-09-17）**：写侧补 `title/type`，读侧注入 `teaching-turn` 的 `scenario.checkpointHistory`（摘要：计数 + 最近 5 条），提示词要求"未通过的点换表征再确认、不得向学生汇报统计"；~~`helpSeekingType`/`rsmAttempts`~~ → **已消费（2026-09-17）**：求助→软拦截、解法台账→wrapup 方法整合；`session_load` = E5 研究仪器（已登记，非缺陷） | 【B】 |
| **P2** | ~~`mode=review` 双写调度（可能重复排期/重复计数）~~ → **已修（2026-09-17：单一写入者）**；~~`lapses` 恒 0~~ → **已落库**；~~`reps` 与 `extractionCount` 可能发散~~ → **已修（2026-09-17：`fsrsReps` 真列，口径=FSRS 调度过的复习数）** | 【B】 |
| **P2** | ~~无法按会话核算 token/成本（日志表无 `sessionId` 外键）~~ → **已具备（2026-09-17）**：`agent_call_logs.sessionId` 升为真列 + `(sessionId, calledAt)` 索引 + 历史回填 + 只读聚合脚本 `audit-session-cost.ts`。**已知缺口**：会话内触发的 aux skill（learner-state-review / concept-consolidator 等）未传 `sessionId`，在脚本里归入"(无会话)"栏 | 【B】 |

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

**补记（2026-09-17）：结果通道改造为结构化 —— 从"靠模型自觉"变成"有契约"**

上面三条验收的前提是"模型把温故结果回写进 `knowledge.points`"。实测这条不稳定：
两次全流程验证一次摘到一次没摘到；本轮又从零回归复现了**成功方向**的漏报
（温故点在会话消息里出现 5 次、却没进 `knowledge.points` ⇒ `outcome` 恒 null）。

改造（两半，缺一不可）：
1. **输出契约**：`teaching-turn` 的 `control.warmupOutcomes`（`{conceptKey|itemIndex, recall, evidence?}`），
   `recall` 是"给了多少帮助才想起来"的三档：`unaided` / `with-hint` / `failed`（desirable difficulty 的直接观测量）；
   规则独立成条，并显式提示"**答对时最容易漏报**"、"报告时点以学生这一次作答为准"（不把随后的提示算成 with-hint）。
2. **代码裁决**：`extractWarmupOutcomes` 首选结构化通道（`itemIndex` 相对模型看到的待回捞视图解析，
   否则按 `normalizeConceptKey` 匹配），旧的名字匹配只作兼容；`knowledge.points` 不再参与结果判定。

**验收证据（用真实模型 + 真实链路，2026-09-17）**：
- 隔离评估（两种作答）：答对 → `recall: "unaided"`；答不出 → `recall: "failed"`（首版规则曾误报 `with-hint`，已按"报告时点"修正）；
- 从零回归：日志 `温故结构化结果 {reported:1, extracted:1, settled:1, dropped:0, recalls:["unaided"]}`，
  观测 4 的入库结果由过去的"丢失/again"变为 **`rating: "easy", status: "mastered", progress: 100, masteryScore: 0.9`** ——
  **成功方向第一次被如实记录**（老通道根本修不了这个方向）；
- 采样率留痕：`reported/extracted/settled/dropped` 进日志，仅在"学生确有机会作答却没报"时告警
  （避免"这轮刚问、还没答"的误报）。

### P0-2 难度调整落生产锚点（一行）—— **已完成并验证（§3.7）**

在 `TeachingContextBuilder` 计算档位处调用 `recordTaskDifficultyAdjustment`（与模拟脚本同一入口）。
**验收**：真实课产生 `task:difficulty:adjustment` 证据；回看脚本能对真实数据出 `relievedRate`，且 `applied` 不再恒等于模拟值。

### P0-3 最小结果测量层（关键，其它实验的前置）—— **已完成（观测层），因果实验仍待做（§3.8）**

- 在课内温故/复习课里增加**延迟回捞**：对同一概念记录 `elapsedDays`（1/3/7/14）与结果，按间隔分桶；
- 用现有 `review:completed` 证据即可实现，**不需要新表**（`payload` 里补 `elapsedDays`）。

**验收**：能画出一条"**保持率 ~ 间隔**"曲线（哪怕是模拟数据）。这条曲线是：① 间隔调度参数（FSRS 本地化）的唯一依据；② 后续一切"有效性"主张的证据底座。

### P1-1 难度控制律加"油门"（把 85% 目标真正闭环）—— **已接线（2026-09-17）：独立传感器 + 双向带；待样本积累**

- 目标带（如成功率 0.80–0.90）**双向**调节档位：低于带下沿降档、高于带上沿升档（升档条件从"四条件同时满足"放宽为单一主指标）；
- 把"有效"判据从"状态理由消失"改为**独立传感器**（下一条同路径任务的作答正确性/理解度），并保留 `applied` 对照。

**第一步：独立传感器（2026-09-17 已落地）**：检查点带**答案键** + **代码裁决**
（详见下方 `judgeCheckpointAnswer` 与 `learner_evidence:checkpoint:result` 的实现说明）。

**第二步：目标成功率带（2026-09-17 已落地，`independent-success-band.service.ts`）**
- **只吃独立信号**：`loadCodeJudgedSuccess` 只统计 `judgedBy='code'` 的检查点结果
  （`model-reference` 是模型派生判定，混进来就把自证回路又接回去了）；窗口 14 天。
- **带 + 死区 + 样本下限**：`evaluateSuccessBand` —— `<0.80` → downgrade、`>0.90` → upgrade、
  带内或样本 `<6` → hold。样本下限的理由是统计的：SE=√(p(1−p)/n)，n=6 时 SE≈0.16，
  带（0.10 宽）比噪声还窄，此时动作只是放大噪声。
- **双向油门**：`decideTaskDifficulty` 里 `success_rate_below_band` 计入降档（与原 4 条负荷理由同口径、合计 ≤−2）；
  `success_rate_above_band` **直接 +1**，不再要求"无任何理由 + cap=high"同时成立
  （旧口径正是"只有刹车没有油门"，审计 §4.2(2)）；安全仍由 `challengeLevelCap` 单独封顶兜底。
- **效果判据刻意不同**：带理由**不进**台账的"可度量理由"集合——它的效果判据是"成功率回到带内"，
  而不是"同类理由不再出现"（后者自我印证）。因此台账仍只度量原 4 条负荷理由。

**第三步：让样本真的攒起来（2026-09-17）——出题时机改由代码给 + 脚手架会作答**

- **基线实测**：最近 60 个会话 **零检查点、零提交、零证据**（`checkpointHistory` 全空）——
  因为出题时机此前完全由模型自决（提示词写"满足全部条件才输出"），模型基本不出题。
- **改法（分工回到纪律上）**：`shouldEmitCheckpoint`（代码，条件可复算：无待处理题、距上次 ≥4 条消息、
  不在收尾阶段、上一轮确有进展 understanding ≥0.6）→ 注入 `controls.emitCheckpoint`；
  提示词改为"true 必须出题（含答案键）、false/缺失不得出题"。**代码定"何时探测"，模型只定"探测什么"。**
- **脚手架补齐**：`verify-from-zero` 现在会在出现待处理检查点时**由虚拟学习者作答**
  （交替答对/答错，覆盖两条判定路径），并新增观测 8。
- **端到端结果**（真实链路）：
  ```
  [AITeaching] 检查点结果留痕 {checkpointId: cp_…, passed: true, judgedBy: "code"}
  [zero] PASS 8 检查点由代码裁决并留痕 — 1/1 条 judgedBy=code｜本课作答 1 次：single_choice=通过(code)
  证据行：{"type":"single_choice","passed":true,"judgedBy":"code","detail":"选项集合与答案键一致（B）","selectedOptionIds":["B"]}
  ```
  ⇒ 独立传感器**第一次在真实链路里产出可审计的代码裁决结果**；带读到 1 个样本（<6）→ `hold`（符合设计）。
- **仍未达成**：样本要攒到 ≥6 才会真正动档位，所以现在仍是"接线 + 样本开始积累"。

**第四步：攒样本 → 观察油门真的打开（2026-09-17，真实链路）**

样本是**按用户**累积的（一次从零验证只产生 1 条），所以用一个虚拟学习者连跑 3 节课把样本推到阈值以上：

```
第 1 节：本节作答 1 次｜代码裁决样本 2（rate=1.00）→ 带判定 hold（样本不足 2/6）
第 2 节：本节作答 2 次｜代码裁决样本 4（rate=1.00）→ hold（4/6）
第 3 节：本节作答 3 次｜代码裁决样本 7（rate=1.00）→ **upgrade（1.00 > 0.90）** ← 带上沿第一次触发
再开一节（此时样本已 7）→ 难度锚点：baseline=5 **adjusted=6** direction=increase
                            reasons=["fragile_concepts","struggling_concepts","prerequisite_gaps",**"success_rate_above_band"**]
```

⇒ **这套系统第一次真的把油门打开了**：档位因**独立传感器**（代码裁决的检查点成功率）而升高，
而且知识类理由**仍留痕但不再一票否决**（旧口径下它们会让档位停在基线）、升档仍被 `cap=medium(7)` 约束。

**一处容易误读的地方（留档）**：第 3 节看到的锚点仍是 `keep`——因为锚点在**开课时刻**记录，
那时样本才 4 条（还没到 6）。所以"带判定变 upgrade"与"档位真的升"之间**隔着一次开课**，
看回看时要对齐时间轴，否则会误判成"接线没生效"。

**回看工具**：新增只读脚本 `audit-success-band.ts`（`--user` / `--path` / `--limit`）——
一眼看清样本数、成功率、带判定、按题型分解（选择题=可靠通道、简答保守）、以及最近锚点里是否真的出现带理由。
不调 LLM、不写库，因此"带动没动"可以便宜地复核：

```
[band] 代码裁决样本 7（通过 7）｜成功率 1.00｜带 0.8–0.9｜样本下限 6
[band] 带判定 = upgrade（成功率 1.00 高于带上沿 0.9）
[band] 最近 1 次难度锚点：baseline=5 adjusted=6 increase ← success_rate_above_band
```

**诚实边界（现在还不能声称什么）**：
- 带只在有 **≥6 条代码裁决**样本时才会动作，且样本**按用户**累积 ⇒ 单个学习者要跨几节课才可能动档位
  （实测：3 节课 / 7 条样本后触发升档）；
- 简答通道的要点判定对措辞敏感（会低估成功率），故不计入带；
- 已经验证的是"**接线生效 + 油门真的会打开**"；**不是**"把错误率维持在 15%"——那需要长期数据，
  且有效性最终只能靠延迟/迁移后测（§6 / §8 E1–E3）判定。

**独立传感器（第一步，2026-09-17 已落地）**：检查点带**答案键** + **代码裁决**
- 契约：`control.checkpoint` 增 `correctOptionIds`（选择题）/ `expectedKeywords`（简答；**优先出选择题**，
  因为选项集合可精确判定，是可靠通道）；答案键服务端保存、客户端投影**剥离**（`stripCheckpointAnswerKeys`）。
- 裁决：`judgeCheckpointAnswer` —— 选择题按集合比对；简答按"要点是否出现"**保守**判定（宁可漏判通过）；
  无答案键 → 返回 `null`，退回模型派生判定并标 `judgedBy='model-reference'`（**不冒充独立**）；
  有键 → `judgedBy='code'`。
- 留痕：`learner_evidence` type=`checkpoint:result`（含 `judgedBy`/`type`/`detail`），
  置信度按来源给（code=0.95 / model-reference=0.6）。**两类分开记账**，第 3 步的带只在 code 通道上算。
- **实测口径（用真实模型跑）**：模型能产出可用答案键且**不泄漏**
  （`single_choice` + `correctOptionIds:["B"]`，reply/options/hint 中无答案痕迹）；
  **已知薄弱点**：简答的要点包含判定对措辞敏感（学生答"没有具体数字"不含要点"没有数字"）
  ⇒ 简答通道按"保守、可能低估成功率"使用，故不要把它与选择题通道混算。

### P1-2 状态量口径收口（低成本、防误判）—— **主体已完成（2026-09-17）**，剩"常量来源字段进 CI"

- 合并两套 LSS（保留 0–10 一套，0–100 只作显示层）——**已做**：显示层只保留任务完成口径一套
  （`metrics/LearningMetricService.calculateLSS`，已加 JSDoc 写明它**不是状态真源**）；
  `LearnerProgressService` 的**第三套**私有公式（`difficulty × timeFactor × subjective/5 × 10`）删除，改为委托同一函数
  （该调用点本就以权威 state 的 0–100 display 值优先，只在其缺失时兜底）；
- 统一 LF 的三套法则（至少把 `0.70/0.15` 改成归一化 `0.70/0.30`）——**已做**：任务完成侧改为
  `LF_EWMA_LAMBDA = 0.70`（归一化，与 `learning-state.service` 的 λ 同源）。**修正一处口径认知**：
  系数和 0.85 的后果不是"衰减更快"，而是**稳态被压到 0.5c**（`0.15c/(1−0.70)`）⇒ 消费侧 `lf ≥ 6` 的疲劳阈值
  实际要求真实疲劳 ≈ 12（量程外），**疲劳保护近乎失效**——这是这条修复真正修掉的东西；
- 修 KTL/LF 半衰期注释（13.5 天 / 1.9 天）——**已做**：`learning-state.service` 头部与两处公式注释
  （原写"42 天/7 天"，与实现矛盾，同文件内已有正确值 13.5/1.9）；
- 给每个常量补"来源"字段（`文献` | `工程启发式`）并**进 CI 检查**——**未做**（需要新检查脚本 + 全量标注，单独立项）。

### P1-3 BKT 决策 —— **已决策并落地（2026-09-17）：保留投影，但只允许它有界消费**

**决策**：不删（它是 E4「参数本地化/拟合」的现成底座，删掉等于自断后路），但**停止把它当调度真值**。
落地三件事：

1. **参数约束校验**（`validateBktParams` + 启动即校验分档表）：`pG+pS<1`、各值 0–1 为硬要求；
   `pG<0.3`、`pS≤0.1`（Corbett & Anderson 1995）为严格建议，违反即 warn。
   顺带修掉违反约束的 `hard` 档（原 `pG 0.35 / pS 0.15` → `0.25 / 0.1`）。
2. **一处有界消费**：`review-plan` 新增只读依赖 `loadConceptBeliefs`，做**信念背离判定**——
   `masteryScore ≥ 0.7`（状态说掌握）**且** `pKnowL ≤ 0.2`（信念说没掌握）→ 进 `relearnSuggestions`
   （`reason: 'belief-divergence'`，建议回路径重学）。**不改间隔、不改难度档位**。
3. **诚实标注**：service 头注明"参数是未拟合先验；观测是 LLM 语义判断，不满足 BKT 的单技能二值作答假设"。

**代价（明确记录）**：约束修正后 `hard` 档不能再靠高 `pS` 实现"坏消息更弱"（该性质本质上要求高 pS，与 1995 约束冲突）
——难点档的保守性改由更低的 `pL0/pT` 承担；原断言已改为"约束优先"取向并加注释防无声漂回。
若将来要做 E4 拟合，应以**拟合结果**替换这些先验，而不是放宽约束。

### P2 积压与重复治理

- 到期 > N（如 30）时开启清账模式或提高每课配额上限——**部分已做**（`ReviewQuotaService` 每日额度 + 顺延，`dc8e05a9`；
  2026-09-17 再补**单节课份额上限**，防第一节课吃光当天额度，见 §3.6 问题②）；
- 复核 `mode=review` 的双写——**已做（2026-09-17）**：复习结果改为**只采集**，记忆引擎的唯一写入者是
  `ReviewCompletedConsumer`（含误解干扰 ×0.85）。原状是同一成绩被应用 **2~3 次**
  （`recordExtraction(fsrsGrade)` + `bumpReviewInterval` + 事件消费者），间隔被过度拉长、计数重复自增；
- 补 `lapses` 记录——**已做（2026-09-17）**：新增 `memory_traces.fsrsLapses` + 读写打通；口径见 §4.2(1)（**不改调度**）；
- `reps` 与 `extractionCount` 可能发散——**已修（2026-09-17）**：新增 `memory_traces.fsrsReps` 真列，
  写入侧落 `result.card.reps`、读取侧优先真列（历史行回退 `extractionCount`）。
  实测口径：`reps` **不影响**当前调度结果（给定 stability/difficulty 时 reps=0/3/20 产出相同），
  但错的口径会污染 E4 拟合/回看 ⇒ 按"数据正确性"修，而不是按"调度影响"修；
- `session_load`（每次课末写一条 `learning_metrics`）——**判定为有意的研究仪器，非缺陷**：
  它是 E5（状态量效度：与 PaaS/NASA-TLX 自评对照）所需的**每课负荷分布**原始数据；
  与 `learning_state` 行已按 `metricType` 隔离（不会污染状态读取）。当前无读侧 = "等实验用"，已在 §8 E5 登记；
- `helpSeekingType` / `rsmAttempts`（teaching-turn 每回合产出）——**已消费（2026-09-17）**：
  此前只写在 `message.analysis` 里、没人读。现 `helpSeekingType` 汇总进行为画像
  （`behavioralProfile.recentHelpSeeking/helpSeekingCount`：最近 5 条原话 + 次数）供**软拦截**；
  `rsmAttempts` 进 `computeSessionEvidence`（最近 5 条解法尝试台账）供 **wrapup 做方法层面的整合**。
  **用真实模型评估产出**（改完实测，两处都跑了）：
  - 求助画像：**首版规则被实测否掉**——写的是"先给最小提示"，模型却回"**我马上帮你做**两件事"（更迁就，方向反了）；
    改成"**产出量不因求助次数放宽**、不得提出代劳（"我来帮你做/你把原文发来我就写"）、每次只加一级提示"后复测 →
    "我不能直接给完整答案，得靠你自己做出来才算真会。咱们换个简单起点：先只看文章开头，用你自己的一句话…"
    （**不代劳 + 起点降一级**）✓
  - 解法台账：wrapup 产出直接做方法对比（"通过对比顺推法与逆推法…"、keyTakeaways 讲方法适用性、
    actionPlan 给"整理两种方法适用场景对比表"），而不是只复述知识点 ✓
- `checkpointHistory` 只写不读——**已消费（2026-09-17）**：写侧补 `title/type`，读侧把摘要（计数 + 最近 5 条）
  注入 `teaching-turn` 的 `scenario.checkpointHistory`，并在提示词里要求"未通过的点换表征再确认、不得向学生汇报统计"。
  **实测评估**（同一情境跑两次，真实模型）：无历史 → 模型重复原要求；有"1 个未通过" → 模型换表征拆小步
  （"证据得是原话本身而不是解释"+ 两个小动作），且全程未出现"检查点/通过率"等系统词；
- 无法按会话核算 token/成本——**已具备（2026-09-17）**：`agent_call_logs.sessionId` 从 metadata JSON 升为
  真列 + `(sessionId, calledAt)` 索引（迁移 `20260917020000`），写入侧补列、历史行尽力回填，
  新增只读脚本 `audit-session-cost.ts`（`--session` / `--user` / `--top`，按 skill 分解）。
  实测：新学习者 3 个会话共 119,820 tokens，最贵会话 46,082（teaching-turn 40,867 + session-wrapup 5,215）。
  **归属已补全（2026-09-17 后续）**：此前会话内触发的 aux skill（`learner-state-review`/`concept-consolidator`/
  `concept-load-estimator`/`replan-attribution`）不传 `sessionId`，成本落在"(无会话)"栏；
  现用 `AsyncLocalStorage` 在收束流程声明"当前教学会话"（`teaching-session-context.ts`），
  `v4-aux-skills` 的 `runAux` 兜底读取 ⇒ 这些调用自动归到本课。
  复测（新学习者）：最贵会话分解已含 `learner-state-review` 2,148 / `replan-attribution` 1,262 /
  `concept-consolidator` 806 / `concept-load-estimator` 633 tokens（"（无会话）"只剩开课前的路径生成等）；
- **新观察（2026-09-17）**：`fail 4 温故结果入库` 在本轮从零回归里复现了"模型没回写"那一半——
  温故点「论据类型识别」在会话消息里出现 5 次（模型确实问了），但最终 `knowledgeState` 里
  **没有该点** ⇒ 按名字摘取自然落空、`memoryWarmup.items[0].outcome` 为 null、无 `review:warmup` 证据。
  此前修的只是**匹配侧**（调序/截断），这一半是**模型不按规则回写**。待办：把温故结果从
  "要求模型写进 knowledge.points" 改成**确定性输出字段**（结构契约），不再依赖提示词依从性。
  → **已完成（2026-09-17）**：`teaching-turn` 输出新增 `control.warmupOutcomes`
  （三档召回等级 `unaided`/`with-hint`/`failed`），`extractWarmupOutcomes` **首选**该通道、代码不做名字匹配，
  旧通道仅作兼容；并加**采样率留痕**（`reported/extracted/settled/dropped` + recall 分布），
  仅在"学生确有机会作答却没报"时告警。见 §7 P0-1 补记与 §3.6 问题④。

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
