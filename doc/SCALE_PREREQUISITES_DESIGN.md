# 规模化前置设计基线：Q18 真实用户实验 / Q19 学习者生命周期 / Q20 单位经济（2026-09-19）

> 缘起：`doc/UPGRADE_DIRECTION_20Q.md` 把 Q18（真实用户实验基建）、Q19（学习者生命周期）、Q20（单位经济）
> 归入"第三波 · 规模化前置"，并明确标注"缺基建 / 当前无对象（缓做，别现在动）"（该文 §2-Q18/Q19/Q20、§5、§6、§8「仍未做」）。
> 本文承接该结论，**只做设计基线、不含任何实现**：把三条各自"现状是什么、最小可行怎么落、前置与决策点、怎样算做完"写清，
> 供后续真实用户规模化时直接进入实施，而不必重新调查。
>
> 方法：**不采信文档结论，逐条回代码复核**，结论一律带 `文件:行`。凡与文档不一致处，在「现状核实」里显式标注。
> 性质：**设计 / 决策文档**，未改任何代码、schema、prompt、测试。
> 边界：
> - 三条共同的前提是**有真实用户**；当前 Demo 站定期清库、无规模化真实用户，因此本文所有"收益"均为设计目标而非可复现实验结论。
> - 合规层不重复 `doc/PRIVACY_DATA_GOVERNANCE_BASELINE.md`（Q16）与 `NON_FUNCTIONAL_GOVERNANCE_PLAN.md` NF-P2-1；Q18/Q19 的同意/未成年人前置**直接引用**前者，本文只写"实验/生命周期如何消费它"。
> - 编号沿用 `UPGRADE_DIRECTION_20Q.md`；原始二十问调查（`doc/20questions/`）为**本机过程材料，不入库**，本工作树亦不存在，故问题陈述以入库的 `UPGRADE_DIRECTION_20Q.md` 为准。

---

## 0. 三条共同结论（先给判断）

| # | 最大的已验证缺口 | 最小可行方向（不引重基建） | 是否必须 schema 变更 |
|---|---|---|---|
| **Q18** | 全仓**无真实用户分流**：无 feature flag、无按用户哈希分桶、无真实 cohort；`cohort` 只属虚拟批量学习者，`experimentId/runId` 只属合成 blackbox 投影 | 复用现有 `SplitMix64PRNG`（sha256 种子）做稳定分桶 + **代码/配置注册表**（不落库）+ 复用 `learner_evidence` 记曝光与结果 + 合规门 | **可避免**（分桶读时计算、曝光/结果复用既有事件表）；注册表若需运营可编辑再上系统库表 |
| **Q19** | 冷启动继承已有，但 `sinceLastSessionDays` 由**模拟时钟**填充、只服务虚拟链路；真实教学链**无时间跨度信号**；churn/winback/dormant 零命中；streak 破一次即重置、无免死/修复 | 真实侧用既有时间戳**读时计算** gap；复用 FSRS `fsrsRetrievability`（`19/81` 幂律）做长间隔重校准；churn 用只读脚本从既有表推导；streak 修复存 `learner_projections` 而非加列 | **可避免**（读时计算 + `learner_projections` 通用 KV） |
| **Q20** | `agent_call_logs` 已有 `model`+token+`sessionId` 真列，但**无按模型单价表**、无金额换算、无 per-user 预算；`costCeiling` 是**调用次数**且仅虚拟；路由是静态 tier | 单价表先落 `models.config.ts`（无 schema）；金额换算区分 `agent_call_logs` 粗算与 `llm_execution_attempts` 缓存精确算；护栏按"测量→归因→软告警→硬上限"分层，真实预算复用 `learner_projections` | **可避免**（先配置表；运营需改价再上系统库 `model_pricing`） |

---

## 1. Q18 · 真实用户实验基建

### 1.1 现状核实（file:line 证据）

**已验证"不存在"的部分：**

- **无 feature flag / 无按用户哈希分流**：全 `backend/src` 检索 `featureFlag` / `feature_flag` **零命中**（唯一 `bucket` 命中是生成客户端的 `MetricHistogramBucket`，与分流无关）。
- **"cohort"只属虚拟批量学习者**：`backend/src/virtual-lab/batch-job.service.ts:38`（`cohort?: string`）、`:229`（写入虚拟画像 `profile.background`）。
  `batch_experiments` / `batch_experiment_runs`（`backend/prisma/schema.prisma:1104`、`:1118`）是**虚拟学习者批量实验**表，非真实用户实验。
- **`experimentId` / `runId` 只属合成 blackbox 投影**：作为网关上下文透传（`backend/src/gateway/api-gateway/context.ts:53-54`、`types.ts:108-109`、`index.ts:67-68`），
  仅写进 `agent_call_logs.metadata`（`backend/src/gateway/api-gateway/executor.ts:900`），并由虚拟 `blackbox-runner` 消费（`backend/src/virtual-lab/__tests__/blackbox-runner.test.ts:78,267-275`）。**没有真实用户赋值语义。**
- **无真实用户 cohort / 保护属性**：`users` 模型字段见 `schema.prisma:810-856`，除 `isVirtualLearner`（`:821`）外，无分组、无实验臂、无保护属性列。
- **虚拟 A/B 是"路径/开关"级，不是用户分流**：`backend/src/scripts/simulate-learner-days.ts:9-12` 用独立路径 `lp_sim_<run>_A/B`；
  `:59-60` 用 `applyAdjustment` 区分对照/实验（只判定 vs 按调整执行）。这是合成剧本内对照，非无偏用户随机化。
- **按用户策略存在但与实验无关**：`backend/src/services/memory/review-quota.service.ts:14-15,23`（`learner_projections(scope='review-quota')` 每日温故账本）、
  `goal_scheduling_ledger`（`schema.prisma:278-293`）——确定性策略/账本，非随机分配。

**与文档一致性核对：** `UPGRADE_DIRECTION_20Q.md` §2-Q18 记"✅ 全无。只有虚拟模拟 A/B……无 feature flag、无用户哈希分流"——**与代码一致，无夸大**；
§5/§6 记"缓做/缺基建"亦一致。需要**补充标注**的一点：`experimentId/runId` 并非完全不存在，而是**只服务合成 blackbox 投影**，实施时不要误当作已有实验基建。

### 1.2 最小可行设计

设计原则：**能读时计算的都不落库；能复用既有事件表的都不建新表；分流必须确定性、可复现、可回滚。**

**(a) 稳定分桶（无 schema 变更）**
- 复用已有确定性随机源 `SplitMix64PRNG`（`backend/src/services/memory/probabilistic-recall.ts:190-211`），其种子为 `sha256(seedPhrase)` 前 16 hex（`:193-196,225-229`），跨进程/跨机器一致。
- 新增**纯函数** `bucketOf(userId, experimentKey, saltVersion)`：`sha256(`${experimentKey}:${saltVersion}:${userId}`)` 取前 8 字节 → `% 1000` → 落入各变体权重区间。
  - 只做分桶不必用 PRNG 流，但复用 sha256 口径与既有模块保持一致、可测试。
  - **粘性**：同一 `(experimentKey, saltVersion, userId)` 恒定落桶；换 salt 视为新实验，必须留版本号以便识别"重新分桶污染"。
- **反模式**：禁用 `Math.random()`（与 `probabilistic-recall.ts:11` 的纪律一致）。

**(b) 实验注册表 / 配置（首版不落库）**
- 首版用**仓库内配置模块**（如 `backend/src/config/experiments.config.ts`，与 `models.config.ts` 同为单一事实源）：
  每条含 `key / status(off|draft|running|stopped) / saltVersion / variants[{name,weight}] / eligibility / exposureEvent / outcomeEvents / owner / startAt / endAt`。
- 分配在**读时计算**，不写 assignment 表；若后续运营需热改/热停，可再迁到 `system` 库（仿 `skill_model_configs`，`backend/prisma/system/schema.prisma:131`）。**迁移是增量，不阻塞首版。**
- **kill-switch**：`status='stopped'` 立即对所有新会话关停该实验（幂等；存量数据保留）。

**(c) 结果收集（复用既有事件链，不建新表）**
- 曝光：首次命中写入 `learner_evidence`（`schema.prisma:580-600`，append-only、有 `occurredAt`/`payload`/`confidence`），`evidenceType='experiment:exposure'`，payload 带 `{experimentKey, variant, saltVersion}`。
- 结果：复用已有结果事件，无需新表——`review:completed`（`elapsedDays/rating`，见 `ReviewCompletedConsumer`）、`checkpoint:result`、`anchor:result`（锚题探针，见 `UPGRADE_DIRECTION_20Q.md` §8）、`prediction_records`（`:650-672`）、`memory_traces`（保留率，`:677-686`）。
  分析口径：按 `experiment:exposure` 的臂 join 上述结果事件。
- 注意：`learner_evidence` 已被删除覆盖矩阵纳入（`UPGRADE_DIRECTION_20Q.md` §8 记 `1d3b55ef`/`2d205f9b`），因此实验数据天然继承删除/导出语义。

**(d) 污染控制**
- **排除非目标对象**：`users.isVirtualLearner=true`（`:821`）、`isAdmin=true`（`:820`）、`deletedAt` 非空（`:823`）不参与分流。
- **一致性哈希**保证与遍历顺序无关；按 `userId` 去重（同一用户多次曝光不重复计臂）。
- **SRM（Sample Ratio Mismatch）审计**：只读脚本比对曝光臂比例 vs 配置权重，超阈值告警（阈值属决策点）。
- **防护栏**：全局 `enabled=false` 总闸；单实验曝光上限；`saltVersion` 变更须显式提升。
- **不交叉污染**：同一用户同一时间只进一个会改变同一结果的实验（由注册表声明互斥组）。

**(e) 合规 / 伦理前置（引用 Q16，不重复）**
- 现状：**无知情同意记录**（`PRIVACY_DATA_GOVERNANCE_BASELINE.md` G1，`:69-70`；注册/引导仅 `onboardingCompleted`，`schema.prisma:833`）；**无未成年人门/年龄采集**（G2，`:73-76`）。
- 该文已明确：**未成年人不得参与 Q18 真实用户分流/实验**（`:136`），并建议新增 `consent_records{userId,purposeCode,version,grantedAt,revokedAt,source}`（`:124`）。
- 因此 Q18 的**硬前置**：先有"同意台账 + 成年/监护人判定"，再谈入组；实验是**需要单独用途码**的数据处理，撤回同意后不得继续入组。

**(f) 分析方法（仅设计，不实现）**
- **A/B / 组间对比**：按曝光臂比结果均值/留存；需要真实 N。
- **DID（差分中差）**：利用 `learner_evidence.occurredAt` 的 pre/post 窗口，比较臂内变化；需稳定 pre 期。
- **MRT（微随机试验）**：在**每个决策点**随机化（`hash(userId+decisionIndex)`），估计近端效应；对决策密度与 N 要求最高，**仅在真实用户量与决策频次足够时**才做。
- **Cox / 生存分析**：以 churn/回归为事件、时间戳取 `users.lastLoginAt`（`:829`）或 `teaching_sessions.startTime`（`:492`），估计风险比；事件定义与删失规则属决策点。
- 共同前提：**当前无真实用户 → 以上都无法产出可解释结论**，属"设计待命"。

### 1.3 前置与决策点（需产品/法务拍板）

1. **【法务】同意与用途码**：实验属何种合法依据、是否单独同意、撤回后果（引用 PRIVACY §4-1/§4-2）。
2. **【法务】未成年人阈值与机制**：13/14/16/18 取档、家长同意如何验证、是否对未成年人完全关闭实验（PRIVACY §4-3，`:186`）。
3. **【产品】首批实验对象与假设**：第一波要做哪个杠杆（例如温故配额、D_floor、支架 fading），成功指标与最小样本。
4. **【数据】统计规则**：SRM 阈值、最小可检测效应、提前停止规则、多重比较校正。
5. **【工程】是否需要落库**：首版配置表（无 schema）是否够用；何时需要系统库实验注册表 + assignment 表。
6. **【合规】实验数据保留期**：与 PRIVACY §4-4 保留天数联动。

### 1.4 验收 / 里程碑

- **M0（无真实用户即可做）**：纯函数分桶 + 配置注册表骨架 + 单元测试（同 salt 恒定、异 salt 可辨、权重边界正确）；曝光事件字段契约成文。
- **M1（试点）**：同意门 + 资格过滤（排除虚拟/管理员/已删除）+ SRM 只读审计脚本 + 至少一个 flag 接到一个真实杠杆并可在管理端热停。
- **M2**：出具首份组间对比报告；若决策密度与 N 足够，再评估 MRT。
- **M3（重）**：系统库实验注册表 + assignment 表（仅在需要运营热改/审计追溯时）。
- **Done 定义**：能在**真实 cohort** 上跑一次无偏对比，SRM 在阈值内、曝光可追溯、kill-switch 生效、未成年人被排除、同意可撤回。

---

## 2. Q19 · 学习者生命周期（冷启动 / 长间隔 / 流失 / 回归）

### 2.1 现状核实（file:line 证据）

**已存在：**
- **冷启动继承（路径级 → 全局回退）**：写入侧 `backend/src/services/learning/learning-state.service.ts:1043-1053`（该路径无历史时回退到学习者全局最新，避免"新路径第一课当满血新人"）；
  读取侧 `backend/src/services/learner/LearnerSnapshotService.ts:441-453`（`resolveLessonState` 该路径无历史返回 `undefined`，调用方回退全局——与写入侧同口径）；
  指标侧 `backend/src/services/metrics/LearningMetricService.ts:180-182`（前值按路径取，无则服务层回退全局）；
  路径规划侧 `backend/src/skills/path-planning/index.ts:175-178`（无学习历史则**省略键**，冷启动行为与原先一致）。
- **`sinceLastSessionDays` 已被填充**：声明于 `backend/src/services/virtual-lab/simulated-day.service.ts:237-244`，
  由 `temporalContextFromClock`（`:247-259`）经 `previousCourseDayGap`（`:206-213`）计算并注入。
- **streak / 成就存在**：`users.streakDays/streakLastDate/longestStreak`（`schema.prisma:830-832`）；更新逻辑 `backend/src/services/learning/learning.service.ts:4479-4519`（相邻日 +1，否则重置为 1）；`achievements`（`schema.prisma:12-30`）。

**已验证"不存在"的部分：**
- **churn / winback / dormant 零命中**：`backend/src` 检索 `churn|winback|dormant|reengage|streakFreeze|streak.*freeze` **无任何匹配**（无流失信号、无召回、无休眠分层、无连续学习免死）。
- **streak 无免死/修复**：`learning.service.ts:4493-4503` 一旦 `diffDays !== 1` 即 `newStreak = 1`，没有冻结/补签路径。

**需要纠正文档的一处状态：** `UPGRADE_DIRECTION_20Q.md` §3 记 `sinceLastSessionDays` 为"死字段"，同文 §8 记 A3 已"打通"（`338c7717`）。
**复核结论：两者都只对虚拟链路成立。** `temporalContext` 的生产与消费**全部在虚拟侧**——生产 `simulation.coordinator.ts:3045,3100`、消费 `virtual-learner-learn-turn-simulator/index.ts:368,394,438`；
真实教学协调器 `backend/src/services/ai-teaching/AITeachingCoordinator.ts` 中 **`temporalContext` / `sinceLastSessionDays` 零命中**。即：字段不再"死"，但**真实用户没有长间隔信号**。

**可直接复用的可观测列（均已在库，无需加列）：**
- `users.lastLoginAt`（`schema.prisma:829`）、`users.streakLastDate`（`:831`）
- `teaching_sessions.startTime/endTime/status`（`:492-493,486`，索引 `:511-512`）
- `learner_evidence.occurredAt`（`:592`，索引 `:596`）
- `learning_metrics.calculatedAt`（`:310`，索引 `:321`）
- `memory_traces.lastSeenAt`（`:684`）
- `learner_projections.generatedAt`（`:639`）
- `agent_call_logs.calledAt`（`:47`）

### 2.2 最小可行设计

**(a) 长间隔重校准（真实侧，读时计算，无 schema 变更）**
- 真实侧新增一个**纯函数** `resolveRealTemporalContext(userId)`：从上述既有时间戳取最近一次学习时间（优先 `teaching_sessions.startTime` 有实际教学者，其次 `learner_evidence.occurredAt`，兜底 `users.lastLoginAt`），
  与当前时间求自然日差 → 产出与虚拟侧同形的 `temporalContext`（`simulated-day.service.ts:237-244`）。省键规则沿用现有语义：无历史则省略 `sinceLastSessionDays`（`:256-257`）。
- **重校准规则**复用既有 FSRS 保留率，不新造公式：
  `fsrsRetrievability(state, now)`（`backend/src/services/memory/fsrs.ts:161-171`，`R=(1+(19/81)·t/S)^-0.5`）；批量读取用 `memoryTraceService.getRetentionSnapshot`（`backend/src/services/memory/memory-trace.service.ts:385`）。
  设计：当 `sinceLastSessionDays` 超阈值且到期点保留率低于目标（`review-quality-metrics.ts` 的 `desiredRetention` 语义）时，**教学更保守**——提高支架、降低难度、优先前置概念复测。
- 与 Q13 的接口：重校准可复用 `D_floor`/独立锚题探针（`UPGRADE_DIRECTION_20Q.md` §2-Q13、§8 B4/锚题接线），但**是否纳入**属决策点。

**(b) churn 信号（读时推导，不落库；需要才加重表）**
- 定义休眠分层（如 D7/D14/D30 "距上次学习"）——**全部由既有时间戳计算**，只读脚本 `audit-lifecycle.ts` 即可产出分布，**不需要新增列或表**。
- 若要做 winback，通知能力已存在：`notifications` 模型（`schema.prisma:1015`）与 `users.notifications` 关系（`:853`）。但**召回/营销类通知需单独的同意依据**（见 2.3），且不能与教学链强耦合。
- 预测性 churn 模型（若未来要做）也应先从此代理量开始，避免一上来建特征仓库。

**(c) streak 破局恢复（复用通用 KV，避免加列）**
- 不修改 `users` 的 streak 列语义；把"免死/补签"状态存 `learner_projections`（通用 KV，`schema.prisma:627-646`），`scope='streak-recovery'`——
  该范式已在 `review-quota.service.ts:14-15,164-176` 验证（幂等 upsert + payload JSON + 版本）。
- 规则示例（待产品定）：每 N 天积累 1 次免死、上限 M、仅覆盖 1 天断档；读取时与 `learning.service.ts:4479-4519` 的 streak 更新合并判定。
- **备选**：若产品认为"修复"语义过重，可只改展示口径（如"最长连续/近 7 日达标"），则完全无状态、零改动。

**(d) 复用边界（不重复建设）**
- 冷启动继承**已实现**，本项**不再动它**；Q19 只补"长间隔 / 流失 / 回归"三块。
- 时间口径必须与既有 UTC 日切片一致（`learning.service.ts:4482`、`review-quota.service.ts:74-77`），避免跨时区重复计数。

### 2.3 前置与决策点

1. **【产品】gap 阈值与"更保守"的具体行为**：几天算长间隔；重校准是降难度、补支架、还是强制前置复测；是否触发锚题复测。
2. **【产品】休眠分层与触达策略**：D7/D14/D30 各做什么；是否发 winback 通知；是否与成就/连续学习联动。
3. **【产品】streak 修复语义**：是否允许免死/补签、额度与上限、是否付费/任务获取；还是只改展示。
4. **【法务】召回触达的同意依据**：营销/召回通知需独立同意，不能默认继承教学同意（引用 PRIVACY §4-1）。
5. **【工程】是否需要物化**：首版全部读时计算 + `learner_projections`；只有到性能/审计瓶颈时才考虑物化表。
6. **【跨项】是否与 Q18 联合**：把"长间隔重校准"作为首个真实实验的候选杠杆（可复用 Q18 分流能力）。

### 2.4 验收 / 里程碑

- **M0**：只读 `audit-lifecycle.ts` 能从既有表输出休眠分布与"距上次学习"分位；纯函数单测覆盖空历史/跨周末/时钟边界。
- **M1**：真实教学链注入 `temporalContext.sinceLastSessionDays`，长间隔时**可观测地**更保守（降难度/补支架/前置复测之一），并有测试。
- **M2**：streak 修复经 `learner_projections` 落地（或明确改为展示口径），无 DB 迁移。
- **M3**：winback 通知（若产品决定）复用 `notifications`，带同意校验。
- **Done 定义**：离开 ≥X 天后回归，系统会依据真实间隔与记忆保留率调整教学；休眠用户可量化、可分层；连续学习断档有明确且可回滚的恢复策略。

---

## 3. Q20 · 单位经济（成本可核算 / 可归因 / 有护栏）

### 3.1 现状核实（file:line 证据）

**已存在：**
- **`agent_call_logs` 已有模型与 token 真列**：`model`（`schema.prisma:58`）、`promptTokens`（`:62`）、`completionTokens`（`:63`）、`tokensUsed`（`:44`）、`providerId`（`:55`）、`userId`（`:35`）、`sessionId`（`:68`，2026-09-17 由 metadata 升真列并建索引 `:77`）、`calledAt`（`:47`）。
  写入：`backend/src/gateway/api-gateway/executor.ts:835-866`（`model: request.model || route.model`，token 累加 `:833-834`，`sessionId` `:842`）。
- **更细的调用级明细**：`llm_execution_attempts` 有 `requestedModel/resolvedModel/responseModel`（`:143-145`）、`promptTokens/completionTokens/totalTokens`（`:161-163`）、
  **KV 前缀缓存命中/未命中 token**（`promptCacheHitTokens/promptCacheMissTokens`，`:172-173`）、`ttftMs`（`:171`）、`userId`（`:135`）。
- **既有的成本读取脚本（只给 token / 调用数）**：`backend/src/scripts/audit-session-cost.ts` 明确"**金额不换算：缺按模型单价的权威表**"（`:11`，输出口径 `:142`），
  已支持按会话（`:127-133`）、按用户（`:114,131-133`）、按 `actorType/actorId` 分解（`:73-91`）。
- **既有成本护栏（虚拟专属、调用次数）**：`backend/src/virtual-lab/session-budget.ts:11,23-24` 明确 `costCeiling` 是"一次会话累计 **AI 调用（含重试）** 上限"，
  解析 `:70-74`，上界 `MAX_COST_CEILING=100_000`（`:20`），来源 `story|profile|default`（`:34`）。**不是钱、也不覆盖真实用户。**
- **既有省成本优化**：
  - 上下文压缩 `backend/src/services/ai-teaching/TeachingContextCompressionService.ts:5-7`（默认 40k token 窗口、0.7 触发、保留最近 12 条），接入 `AITeachingCoordinator.ts:1762-1879`。
  - KV 前缀缓存可观测：`executor.ts:770-792`（DeepSeek `prompt_tokens_details.cached_tokens` / OpenAI `prompt_cache_hit_tokens`），验证脚本 `backend/src/scripts/verify-kv-prefix-cache.ts:4-6`；
    审计口径见 `doc/CONTEXT_MECHANISM_AUDIT.md`（README 摘要 `doc/README.md:35-37` 记全局命中率 20.9%）。

**已验证"不存在"的部分：**
- **无模型单价表、无金额换算**（`audit-session-cost.ts:11,142` 自述）。
- **无 per-user / per-session 预算**：只有虚拟 `costCeiling`（调用次数）。
- **无单位经济**：`routes/admin/platform.ts:683` 按 `userId` 聚合 token/调用，但**不换算金额**，无 ARPU/成本比。
- **路由是静态 tier**：`backend/src/config/models.config.ts:13,24-60`（`chat|reasoning` + `DEFAULT_MODELS`）；`backend/src/gateway/api-gateway/router.ts:136-137`、`:342-343`、`:359-361` 仅按 tier 选模型，**无成本/复杂度输入**。

**与文档一致性核对：** `UPGRADE_DIRECTION_20Q.md` §2-Q20 记"`costCeiling` 是调用次数不是钱、仅虚拟；无单价表；无 per-user 预算；路由静态 tier"——**与代码完全一致，无夸大**。
需要**补充标注**：文档把闭环写成"补一张单价表 → 现有 token 日志即可出金额"（§2-Q20 末、§5），但**精确金额还差一步**——缓存命中 token 只存在 `llm_execution_attempts`（`:172-173`），
若单价的"缓存输入价"不同，用 `agent_call_logs` 的 `promptTokens` 粗算会**高估**缓存部分成本。这是实施时必须显式选择的口径。

### 3.2 最小可行设计

**(a) 模型单价表（首版不落库）**
- **存储**：首版扩展 `backend/src/config/models.config.ts` 的 `AVAILABLE_MODELS`，为每个模型加 `pricing: { inputPerMillion, outputPerMillion, cachedInputPerMillion?, currency, effectiveFrom }`（单一事实源、随代码评审）。
  备选（后置）：系统库新增 `model_pricing` 表（位置仿 `skill_model_configs`，`backend/prisma/system/schema.prisma:131`），支持运营改价与生效历史；**迁移是增量**。
- **应用**：
  - **粗算口径**（用 `agent_call_logs`，量大、便于按 user/session）：`Σ promptTokens×input + completionTokens×output`，join `model` 列。
  - **精确口径**（用 `llm_execution_attempts`，缓存友好）：按 `resolvedModel` + `promptCacheHitTokens×(cachedInput) + promptCacheMissTokens×input + completionTokens×output`（列见 `:143-145,161-163,172-173`）。
  - 首版建议：**报表默认粗算 + 标注"未计缓存折扣"；对账/重点会话用精确口径**。扩展 `audit-session-cost.ts` 或在旁新增只读 `audit-unit-economics.ts`。
- **实现约束**：只读脚本沿用现有 `--session/--user/--days/--top` 参数范式（`audit-session-cost.ts:29-39`）；不写库。

**(b) per-user / per-session 成本归因（不落库，读时聚合）**
- `agent_call_logs` 的 `(sessionId, calledAt)`（`:77`）与 `(userId)`（`:75`）索引已支持按会话/按用户聚合；
  **无会话调用**（路径生成、画像等）单独成桶——现有脚本已如此处理（`audit-session-cost.ts:12,64,82`），设计沿用。
- 产出：按用户/日、按会话的成本视图；有真实定价后再算"收入 − 成本"（单位经济）。**当前无真实收入数据，故只到成本侧。**
- 删除/导出：`agent_call_logs` 已纳入用户删除级联（`virtual-cleanup.service.ts:180`、`purge-soft-deleted-users.ts`），归因视图不应新增长期留存副本。

**(c) 成本护栏分层（虚拟 → 真实）**
- **L0（已有，虚拟）**：`session-budget.ts` 调用次数 `costCeiling`——保留为虚拟实验室事故护栏。
- **L1（已有能力，真实单次）**：单次输出上限由 `models.config.ts` 的 `maxOutputTokens`（`:16-17,111-113`）与 `resolve-llm-call-params.ts` 封顶；接入成本后用于单次预算。
- **L2（新增，真实会话级）**：把 `resolveSessionBudget` 的"解析顺序 + 钳制"范式（`session-budget.ts:51-94`）推广为**价格感知的会话成本上限**；真实会话预算可存 `learner_projections`（`scope='session-budget'`，仿 review-quota）——**避免 schema 变更**。
- **L3（新增，用户级）**：按日/月用户成本预算，存储同样可复用 `learner_projections`；**硬执行点在网关/执行器**（`executor.ts` 调用前）——属代码改动，需单独立项。
- **L4（后置，路由）**：成本/复杂度驱动路由（在静态 tier 之上引入"低成本任务用便宜模型"）。**必须先有真实单位经济数据**，且不得违反"LLM 只出观测、代码裁决"纪律。
- **推进顺序**：**测量（单价表）→ 归因（per-user/session）→ 软告警（超阈值提示）→ 硬上限（拦调用）**；不跳级。
- **优化杠杆可见化**：单价表纳入缓存输入价后，KV 前缀缓存命中（`llm_execution_attempts:172-173`）与上下文压缩（`TeachingContextCompressionService.ts`）的节省应能在报表中直接看到。

### 3.3 前置与决策点

1. **【财务】权威单价**：各 provider/model 的输入/输出/缓存输入单价、币种、生效日期、调价历史；是否含平台加价。
2. **【财务/产品】目标口径**：单位经济的分子分母（每用户/每会话/每完成任务的成本；毛利率目标）；报表是否对运营可见。
3. **【产品】预算行为**：超预算时"阻断 / 降级到便宜模型 / 仅告警"；不同用户层级是否不同模型/额度。
4. **【法务/隐私】成本日志属性**：`agent_call_logs` 是用户归因遥测，确认其数据分类与保留期（引用 PRIVACY 分类矩阵与 NF-P2-1 保留期，`:180-190`）。
5. **【工程】单价源与口径**：配置表 vs 系统库表；粗算 vs 精确（缓存）；执行点是否动网关。
6. **【工程】与 Q18 的接口**：成本相关杠杆（模型降级、压缩阈值）是否作为实验对象，需复用 Q18 分流。

### 3.4 验收 / 里程碑

- **M0**：单价表落地 + 只读金额报表；用**一段真实 provider 账单**抽样对账，偏差 < 5%（缓存口径须说明）。
- **M1**：per-user / per-session 成本归因脚本/端点；能指出"最贵用户/会话/skill"，并展示缓存与压缩的节省量。
- **M2**：真实会话级成本上限（复用 `learner_projections`），超阈值软告警；无 schema 迁移。
- **M3**：用户级预算 + 网关硬执行点；再评估成本驱动路由。
- **Done 定义**：每一次 LLM 调用都可定价，成本可归因到用户/会话，护栏能在真实规模下阻止失控支出，且缓存/压缩优化在数字上可验证。

---

## 4. 三条之间的关系与实施顺序（建议）

- **共享前提是 Q18**：Q19 的重校准策略、Q20 的成本护栏是否有效，都应在真实分流下检验。因此若要动工，建议顺序 **Q18（分流骨架 + 合规门）→ Q19（长间隔/流失，可作为首个实验杠杆）→ Q20（单价与护栏）**；
  但 Q20 的**单价表**成本极低、且不依赖真实用户，可**并行先行**。
- **与既有文档边界**：Q18 的同意/未成年人**完全引用** `PRIVACY_DATA_GOVERNANCE_BASELINE.md`，不重复其决策点；Q20 的数据保留引用 NF-P2-1；Q19 的教育科学依据引用 `LEARNING_SCIENCE_AUDIT.md` / `EDUCATIONAL_THEORY_MAP.md`。
- **不变量**：全部设计遵守现有纪律——确定性（禁 `Math.random`）、LLM 只出观测/建议、代码裁决、单源化配置、可回滚、尽量复用 `learner_evidence` / `learner_projections` / `agent_call_logs` / `llm_execution_attempts`。

## 5. 附：本文关键证据索引

- **Q18**：`backend/src/services/memory/probabilistic-recall.ts:190-211`（SplitMix64 + sha256）、`backend/src/virtual-lab/batch-job.service.ts:38,229`（虚拟 cohort）、`backend/prisma/schema.prisma:1104,1118`（虚拟批量实验表）、`:810-856`（users 无 cohort）、`backend/src/gateway/api-gateway/executor.ts:900`（experimentId 进 metadata）、`backend/src/scripts/simulate-learner-days.ts:9-12`（虚拟 A/B）。
- **Q18 合规**：`doc/PRIVACY_DATA_GOVERNANCE_BASELINE.md:69-76`（G1/G2）、`:124`（consent_records 建议）、`:136`（未成年人不得入实验）。
- **Q19**：`backend/src/services/learning/learning-state.service.ts:1043-1053`、`backend/src/services/learner/LearnerSnapshotService.ts:441-453`、`backend/src/services/metrics/LearningMetricService.ts:180-182`、`backend/src/skills/path-planning/index.ts:175-178`（冷启动继承）；`backend/src/services/virtual-lab/simulated-day.service.ts:206-213,237-259`（gap，仅模拟时钟）；`backend/src/services/ai-teaching/AITeachingCoordinator.ts`（真实侧无 temporalContext，零命中）；`backend/src/services/learning/learning.service.ts:4479-4519`（streak 无免死）；`backend/src/services/memory/fsrs.ts:161-171`（保留率公式）；`backend/src/services/memory/memory-trace.service.ts:385`（getRetentionSnapshot）；`backend/prisma/schema.prisma:627-646`（learner_projections）、`:1015`（notifications）。
- **Q20**：`backend/prisma/schema.prisma:32-82`（agent_call_logs 列/索引）、`:128-189`（llm_execution_attempts 含缓存 token）、`backend/src/gateway/api-gateway/executor.ts:833-866`（写入）、`backend/src/scripts/audit-session-cost.ts:11,73-91,127-142`（无单价表）、`backend/src/virtual-lab/session-budget.ts:10-24,70-74`（调用次数护栏）、`backend/src/config/models.config.ts:13,24-60`、`backend/src/gateway/api-gateway/router.ts:136-137,342-343,359-361`（静态 tier）、`backend/src/services/ai-teaching/TeachingContextCompressionService.ts:5-7`、`backend/src/scripts/verify-kv-prefix-cache.ts:4-6`、`doc/CONTEXT_MECHANISM_AUDIT.md`（缓存命中率）。
