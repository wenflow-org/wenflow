# 单用户多路径 · 概念图有用性 · 学习者信号作用域

> 📌 类型：活规范（学习者信号按用户级 / 路径级 / 教学现场级分域的现行规则）｜索引见 [doc/README.md](./README.md)。

> 关联：`doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md`（L1/L2/L3 设计）

## 1. 图消费

### 1.2 图消费的两处接入

`neighboringConcepts` 取当前概念的 1-hop 图邻居（`prerequisite` / `part_of`，按关系优先级确定排序，前置优先）；`prerequisiteGaps` 沿**概念级前置投影**后的 `prerequisite` 边向上游取闭包——物化时跳过自环、互为反向的一对只保留一条，缺 kcId→coreConcept 映射时只写 KC 级边。任务概念是 `concept` 级、`kcGraph.edges` 是 `kc→kc` 级，两者由 `source='prerequisite-projection'` 的概念级前置投影衔接。

## 2. 学习者 agent 信号作用域分类（A–E）

数据流总入口：`LearnerSnapshotService.getSnapshot()` → `LearnerKnowledgeMemoryService.build({userId, learningPathId?})`。
产出 `LearnerKnowledgeMemory = { currentPath?, globalSignals, globalBackground }`，再被 `LearnerProjectionService.toPlanningProjection()` 转成
`learnerLearningContext` 注入**路径生成**（`path-generation.core.ts:360`），并被教学回合 / 重规划消费。

判定依据：`build()` 内每条数据源实际带的过滤键（`pathId` vs `userId`）。

### A. 适合跨 path（用户级）——应当跨，且机制正确

| 信号 | 出处 | 为什么该跨 |
|---|---|---|
| 认知负荷四指标 `lss/ktl/lf/lsb`（聚合） | `learningStateService.getAggregatedState(userId,{asOf})` | 每路径取最新再取 max + 当日课量疲劳加成。**疲劳是人的属性**，按路径割裂会低估真实负荷 |
| 记忆痕迹 `memory_traces`（ACT-R） | `build()` 按 `userId` 取（**无 pathId**）→ 注入 `conceptStates` 为 `sourceType='memory-trace'` | 一个概念在任一路径学过，其余路径就是已会 |
| 概念身份 `concepts`/`concept_aliases` | 主键 `(userId, aliasNorm)` | 身份是人的属性 |
| 误解台账 `misconception_ledger` | 按 `userId` | 同一误解在别的路径也是坑 |
| 每日温故额度 / 复习排程 | `ReviewQuotaService` 按 `userId` | 按人排，不按路径排 |

### B. 只该 path 内（路径级）——机制正确

| 信号 | 出处 |
|---|---|
| `currentPath.{milestoneProgress, taskMastery, recentEvidence}` | `teaching_sessions`/`learner_evidence` 均按 `pathId: path.id` 过滤 |
| `currentPath.conceptStates` 的任务/会话来源信号 | 由该 path 的 `subtasks` / `teaching_sessions` 生成 |
| `prerequisiteGaps`（上游闭包） | `upstreamClosure(..., {pathId})`，沿该路径 prerequisite 边走 |
| `dynamicState.lessonMetrics` | `resolveLessonState(userId, lessonScopePathId)` |
| `replanSignal` | 针对当前路径（`scope: next_milestone / downstream_path`） |
| 路径级难度基线 | `decideTaskDifficulty(...lessonMetrics...)` |

### C. 名字是 global、取数为用户级的信号

1. **`globalBackground.conceptLedger / recurringConfusions / blockedFoundations / transferSignals`**
   来源 `learner_evidence` 按**用户级全部路径**取（`allPersistedEvidence`，`pathId: { in: pathIds }`，
   `pathIds` = 当前路径 + 最近 8 条其它路径）。
   证据：`sourcePaths` 由「概念 → 出现过的路径」倒排累积多路径
   （`LearnerKnowledgeMemoryService.ts:1048-1056` 注释「globalBackground 是用户级台账，sourcePaths 必须如实跨路径」、
   `:1090-1092`），字段名是复数 `sourcePaths`，语义与数据一致。
   → 路径 B 里被阻塞的地基概念，会提醒路径 A。

2. **`globalSignals.masteredConcepts / fragileConcepts / strugglingConcepts`**
   由 `globalConceptStates` 推导（`:956-970`，注释「globalSignals 是用户级视角（跨路径并集），不用 currentPath 子集」）；
   而 `globalConceptStates` = **用户级概念状态**（全部路径 + 用户级痕迹）。
   → 名"global"即为**跨路径并集**；路径 B 里通过课堂蒸馏掌握的概念（无痕迹）也会进路径 A 的 globalSignals。
   `currentPath.conceptStates` 才是它的路径子集（`:818-820`）。

3. **`build()` 无 `learningPathId` 时的兜底是最新一条 active 路径**
   （`LearnerKnowledgeMemoryService.ts:318-321`，`findFirst({userId,status:'active'}, orderBy updatedAt desc)`）。
   它只决定 `currentPath` 取哪条路径；`globalSignals` / `globalBackground` 按用户级并集取数，不受兜底路径影响。

4. **概念图 `concept_edges` 有 `scope='user'` 边**
   物化时同一条 KC 级前置**同时落一条 `pathId=null` 的用户级边**
   （`concept-graph.service.ts:342-349`，`relation: RELATION_PREREQUISITE, scope: SCOPE_USER, pathId: null`）——跨路径查询（多路径用户图谱）因此连得起来。
   → 但跨路径共享概念本身仍为 0：用户级图会呈现为若干互不相连的簇，缺的是共享概念身份，不是边。

### D. 教学现场级（teaching）——短暂，不必跨

`teachingHints`（promptEnhancement / emphasize / avoid / riskFactors）、`checkpointNeed`、
`shouldOfferBreak`、`recommendedInteraction`（hintTiming / encouragement / challenge）、SRL phase。

### E. 需要产品裁决（两处都吃，语义未定）

| 信号 | 当前行为 | 建议 |
|---|---|---|
| 难度基线 | `decideTaskDifficulty` 同时吃 `globalMetrics`（跨）与 `lessonMetrics`（path） | "这节课该多难"以**路径级**为准；"今天还能不能加量"以**用户级**为准 |
| `conceptLoad`（概念负荷） | 按当前路径算 | 若指"这节课的概念量"→路径级；若指"人当前能扛多少"→用户级。当前混 |

---

## 3. 结论

1. **A/B 两类分工正确**——不必大改。
2. **C1/C2 的取数为用户级并集**：`globalBackground` 四件套与 `globalSignals` 取用户级并集
   （`learner_evidence` 按 `pathId: { in: pathIds }` 取，`sourcePaths` 累积多路径）。
3. **C4 的用户级边**：`scope='user'` 边在物化时与路径级边同时写入（`pathId=null`），多路径图可连通；
   仍缺的是跨路径共享概念身份。
4. **E 类需要产品裁决**，不擅自定。
5. **前置缺口 = 上游闭包**：任务概念是 `concept` 级，而 `prerequisite` 边是 `kc→kc` 级，靠物化时的概念级前置投影衔接。
   剩余未命中的任务，其概念在当前路径里没有 prerequisite 结构（kc-mapper 没给）——"无图可依"与"图接错了"是两回事。
6. **`neighbors` 按关系优先级确定排序**（前置优先），不再按 DB 行序截断。
7. **kc-mapper 重跑会在 `concept_edges` 里累积被覆盖版本的边**：多出的行端点不在 stored `kcGraph.nodes` 里。
   图里会混入少量已作废的边（同一路径、同一领域，危害有限）；"等号"口径因此失效，
   断言改为逐路径的**超集不变式**（"物化行数 ≥ stored 数"，即物化未漏），多出行数单独报出。
   是否清理作废边属产品裁决（可能误删合法的重规划边）。
8. **跨路径概念共享为 0**：这不是 bug，而是"跨 path 迁移"这个能力**缺前提**——先有共享概念身份，才谈得上跨路径复用。
   `scope='user'` 边在物化时写入，但共享概念仍为 0，多路径图仍呈现为若干不连通的簇。
9. **教学上下文的"本课知识范围"三槽位**：`buildTaskKnowledgeSeeds` 取 `kcAnnotation.taskKcLinks`
   （回落任务自身的 canonical 概念）；`LearnerPrerequisiteGap.source` 区分 `graph`（真上游前置）与
   `fallback`（图缺失时的本课薄弱概念）；`pickPrerequisiteConcepts` 对 `source==='graph'` 直接采用
   （上游概念按定义就与本课概念不同名，不做名字子串匹配）；`supportingConcepts` 同时排除 `primary` 与 `prerequisite`。
   实测 `primary` 16/16、`prereq` 有真缺口时非空（3/16），三槽位互不重复。
