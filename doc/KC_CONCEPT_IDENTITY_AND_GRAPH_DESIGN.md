# KC 概念身份与图关系改造设计

> 状态：**L1/L2/L3 + 前端画布已落地**（见文末「交付状态」）｜日期：2026-09-22（2026-09-23 更新）
> 关联：`doc/LEARNER_STATE_REVIEW_DESIGN.md`（调控分工纪律）、`doc/local/VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md`（跨日模拟契约）、`doc/LEARNER_MODEL_ARCHITECTURE.md`
> 验证手段：现有虚拟学习者存量回填 + `src/scripts/simulate-learner-e2e.ts` 跨日对照

---

## 0. 结论（TLDR）

1. **先做身份，再做图。** 现在图建起来节点也对不上——`concept-2` 在 A 路径是"Excel数据加载与清洗后输出的结构化管道"，在 B 路径是"文件路径与数据加载的映射关系"，同键不同义。
2. **归并 ≠ 身份。** 系统里已有 `ConceptConsolidatorService` 在做概念归并，但它是"事后**重写/删除** `memory_traces` 行"的人工工具（P1 观察默认、P2 需显式开关），产物落在 `learner_projections(scope='concept-consolidation')` 审计里，**没有任何调控链路消费者**。它改变的是"行数"，不是"可 join 的键"。
3. **"图对 LLM 友好"这个判据在本项目不成立。** 调控的每一个决策点都是**代码**判定的（难度/FSRS/检查点/重规划），LLM 只出观测档位。图不进 prompt，进 prompt 的是**代码已经查好的 1-hop 邻域**。所以选型判据是"对代码可查询"，答案是轻量 typed edge 表，不是知识图谱。
4. **改造分四期**，每期可独立上线、独立回滚；验证用可丢弃虚拟学习者做跨日对照，观测量全部来自已落地的 `day-timeline` 只读聚合，不新造口径。

---

## 1. 现状盘点（实测证据）

数据取自 `backend/prisma/dev.db`（只读探测，2026-09-22）。

### 1.1 三套互不相通的身份体系

| 载体 | 键的形式 | 实测规模 | 问题 |
|---|---|---|---|
| `memory_traces.conceptKey` | 自由文本概念名（"皮亚杰认知发展阶段"） | **848 行 / 843 个不同键 / 39 用户** | 843 个串对 848 行 ≈ 一行为一键；键空间是"每用户自由文本"，不是领域概念表 |
| `misconception_ledger.conceptKey` | 又一种自由文本（长句："「快点」是旧启动键，冒出来不等于要执行"） | **4232 行 / 829 个不同键** | 与 `memory_traces` 键**交集仅 231**（≈28%）→ 多数误解无法 join 到它的掌握度痕迹 |
| `subtasks.linkedConceptId` / `milestones.coreConceptId` | **`concept-N` 路径内局部序号** | **2425 / 2415 非空，100% 形如 `concept-N`** | 同键不同义（见 §0.1）；跨路径聚合静默错 |
| `learning_paths.aiPromptTemplate.kcAnnotation` | JSON blob（`kcGraph{nodes,edges}`） | **284 条路径 / 246 条已落**（86.6%，其余是修复前老路径） | 无独立表、无索引、SQL 查不了 |

补充实测：`milestones` 734 行 / 730 有 `coreConceptId`；`teaching_sessions` 269；`learner_evidence` 4328。

**关键判读**：`subtasks` 的概念引用填得很满（99.6%），**不是没数据，是数据的 "id" 不是 id**——是列表下标。而 `memory_traces` 按**名字**做键。两套身份系统完全不相交。

`memory_trace.service.ts:63-68` 的注释自认了这件事：

> conceptKey 直接取模型生成的知识点名字，模型换一种说法就多一条，导致同一概念被记成多条痕迹（实测「离开前翻页立好」被记成 5 条），复习清单因此爆炸。

现有 `normalizeConceptKey`（`memory-trace.service.ts:69-81`）只做正则：压缩空白 → 去引号 → 去冒号后从句 → 去尾部标点。**是文本清洗，不是身份解析**：无别名表、无 canonical id、无语义近义处理。

### 1.2 生产 → 消费链路与断点

```
path-planning ──► cognitiveCore.coreConcepts[]  (id:"concept-1" / name / description)
                     │
                     └─► aiPromptTemplate.cognitiveCore

kc-mapper ──────► conceptKcs[]   (conceptId:"concept-1" → kcs[]: kcId:"kc-1a")
                  taskKcLinks[]  (taskTitle → linkedKCs[])
                  kcGraph{nodes[{kcId,name,taxonomy}], edges[{from,to,relation}]}
                  gapCoverage    (covered[] / uncovered[])
                     │
                     └─► aiPromptTemplate.kcAnnotation   ← JSON blob，无表无索引
```

消费端**只有两处**，都在 `TeachingContextBuilder.ts`：

| 位置 | 读了什么 | 没读什么 |
|---|---|---|
| `resolveTaskKcsFromPath`（`:337-367`） | `taskKcLinks` + `kcGraph.nodes` → 摊平成当前任务的 KC 数组 | **`kcGraph.edges` 一次都没读** |
| `buildCognitiveFrame`（`:392-445`） | `coreConcepts`，`neighboringConcepts = filter(≠当前).slice(0,3)` | **不是图遍历，是取前三个** |

`prerequisiteConcepts`（`:984-987`）来自 `learnerSnapshot.knowledgeMemory.currentPath.prerequisiteGaps`，而后者由 `LearnerKnowledgeMemoryService.ts:559-568` 计算：拿**当前任务**的概念名去 `memory_traces` 找掌握度低的（`masteryScore < 0.45` 或 `stability === 'fragile'`）。

**断点清单**：

1. `kcGraph.edges` **纯写不读**——前置依赖在调控回路里贡献为零。
2. `prerequisiteGaps` **语义是错的**——它算的是"当前概念自己没掌握"，不是"前置缺口"。
3. `neighboringConcepts` 用 `.slice(0,3)` 代替图遍历。
4. `memory_traces` / `misconception_ledger` / `subtasks` / `kcGraph` 四套键**无法互 join**。
5. `concept-consolidator` 的归并建议**无调控消费者**（只有 admin 人工页）。

### 1.3 已有的身份基础设施及其边界

`ConceptConsolidatorService`（`src/services/learner/ConceptConsolidatorService.ts`）已经解决了"语义近义"这一半问题：

- LLM 提**可证伪建议**（merges / ambiguous / dropCandidates），代码执行归并，全程审计可回滚（`:379-819`）。
- 两档：**P1 观察**（默认，一个字节不动）/ **P2 执行**（需显式开关，只执行 `autoApplicable`——词面相似度 ≥ 0.5）。
- 自动触发：会话结束（`teaching-session-lifecycle.ts:908`）、任务完成（`task-completion.service.ts:513`），均走 `refreshInBackground`（P1）。
- 人工入口：`POST /api/admin/memory-review/:userId/apply|rollback`（`memory-review.ts:306/337`）。

**边界（本设计的出发点）**：

- 它**重写 `memory_traces` 行**（`executeMerges` 做 update/delete/createMany），是**破坏性**的（靠审计快照回滚）。
- 产物是**审计投影**，不是可 join 的键——归并完 `memory_traces.conceptKey` 仍然是自由文本。
- 它**只覆盖 memory_traces 这一层**，碰不到 `subtasks`/`milestones`/`kcGraph`。
- 默认 P1，实际长期处于"只观察"状态 → 现网 848 行/843 键就是没归并过的样子。

**结论：身份机器已经有了，但它是"人工审核工具"，不是"底座"。** 本设计的 L1 就是把它的决策**升格为注册表**。

### 1.4 调控决策点：全部由代码判定

这是"对 LLM 友好度"这个判据不成立的证据。

| 决策点 | 实现 | 判定方 |
|---|---|---|
| 任务难度档位 | `TaskDifficultyAdjustmentService.ts` | **纯函数，代码**（注释：档位由代码给，LLM 只出观测；关键路径不允许 inline await LLM） |
| 复习调度 | `memory-trace.service` + `fsrs.ts`/`actr.ts` + `review-plan.service` | **代码**；LLM 只出 granularity/knowledgeType/difficultyBand 档位 |
| 检查点出题/判分 | `teaching-checkpoint.ts` | **代码**（`shouldEmitCheckpoint`、`judgeCheckpointAnswer` 选项 id 集合匹配 + 关键词包含） |
| 重规划建议 | `ReplanAdvisoryService.build`（`:120-186`） | **代码**（阈值 + reasonCodes）；LLM 只贡献 sessionKtl/Lss/Lf 观测值 |
| 概念真值裁决 | `concept-truth-fusion.ts` + `truth-discovery.ts` | **代码**（`code_judged` 权重 0.95 压过 `self_report` 0.20） |
| 概念信念 | `concept-belief.service.ts`（BKT） | **代码**；明确"pKnowL 不驱动间隔/难度" |

---

## 2. 设计总览

```
L1 概念注册表（身份）        concepts + concept_aliases
    ├─ 解析器 resolveConcept(userId, rawText) → conceptId
    ├─ 写入点全部落 conceptId（memory_traces / misconception_ledger / subtasks / milestones / kcGraph）
    └─ concept-consolidator 从"重写 traces"改为"登记 alias"（非破坏）

L2 边表（关系）              concept_edges
    ├─ kcGraph.edges 物化（不再只塞 JSON）
    └─ part_of 边把 KC 挂到 coreConcept 上

L3 调控接入（消费）
    ├─ cognitiveFrame.neighboringConcepts  ← 1-hop 图遍历
    ├─ prerequisiteGaps                    ← 沿 prerequisite 边向上游找缺口
    └─ ReplanAdvisory severity             ← 按缺口深度/是否阻塞定级
```

**粒度裁定**：注册表注册**可调度单元**（= `memory_traces` 的粒度，实测多为 KC 级：动词+可观测对象）。coreConcept 也注册为节点（`level='concept'`），两者用 `part_of` 边相连。理由：掌握度/FSRS 的载体是 `memory_traces`，调控需要细粒度（哪个 KC 脆弱），concept 级是 rollup。

---

## 3. L1：概念注册表

### 3.1 数据模型

```prisma
/// 概念身份（canonical）。身份是**用户级**的：同一个名字对新手是技能簇、对熟手只是一个词
/// （复用 concept-load.service 的既有判读），且遗忘不分路径 → 不做 path 隔离。
model concepts {
  id             String   @id              // cpt_<ulid>，全局唯一
  userId         String
  canonicalLabel String                    // 权威展示名（归并时取出现最多/最长的原文）
  level          String   @default("kc")   // concept | kc
  taxonomy       String?                   // factual|conceptual|procedural|metacognitive
  granularity    String?                   // atomic|cluster（复用 concept-load 判定结果）
  originPathId   String?                   // 首次出现路径（仅溯源，不做隔离键）
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  aliases        concept_aliases[]
  @@unique([userId, canonicalLabel])
  @@index([userId, level])
}

/// 别名表：**唯一索引就是解析器的全部机制**——一次索引命中完成身份解析。
/// 非破坏性：归并 = 插一行 alias，不重写任何 traces。
model concept_aliases {
  id         String   @id
  conceptId  String
  userId     String
  aliasNorm  String                        // normalizeConceptKey 后的键（与既有口径一致）
  aliasRaw   String                        // 原文（展示/审计）
  source     String                        // write_time | consolidator | human | backfill
  confidence Float    @default(1)
  createdAt  DateTime @default(now())
  concept    concepts @relation(fields: [conceptId], references: [id], onDelete: Cascade)
  @@unique([userId, aliasNorm])            // 一个别名只能属于一个概念（用户内）
  @@index([conceptId])
}
```

写入点新增列（**只新增，不改既有列语义** → 满足跨日模拟契约 §五 不变式 1）：

| 表 | 新增列 | 既有列的去向 |
|---|---|---|
| `memory_traces` | `conceptId String?`（+ index） | `conceptKey` 保留为展示原文 |
| `misconception_ledger` | `conceptId String?`（+ index） | `conceptKey` 保留 |
| `subtasks` | `conceptId String?`（+ index） | `linkedConceptId` 保留（path 内局部序号语义） |
| `milestones` | `conceptId String?`（+ index） | `coreConceptId` 保留 |
| `kcGraph.nodes[]`（JSON 内） | 每节点加 `conceptId` | `kcId` 保留（KC 级局部序号） |

### 3.2 与 concept-consolidator 的关系：升格，不是新建

不新写一个 LLM 解析器。**把 consolidator 的决策物化为 alias 行**：

- P1（观察）语义不变：只写审计投影。
- P2（执行）语义**改变**：不再 `executeMerges` 重写/删除 `memory_traces`，而是
  1. 选定 canonical（现有 `canonicals` 参数，`memory-review.ts:322`）；
  2. 为其建立 `concepts` 行（若不存在）；
  3. 把被归并的每个 `conceptKey` 插为 `concept_aliases(source='consolidator')`；
  4. 回填受影响 `memory_traces.conceptId`。
- **回滚 = 删 alias 行**，比现在的"按审计快照重放"简单一个量级，且天然幂等。

`refreshInBackground` 的自动触发点（会话结束/任务完成）保持不变，只是产物从"建议"变成"建议 + 可选的 alias 登记"。

### 3.3 解析器

```ts
// services/learner/concept-registry.service.ts
export async function resolveConcept(
  userId: string,
  rawText: string,
  opts?: { createIfMissing?: boolean; source?: string; level?: 'concept'|'kc' }
): Promise<{ conceptId: string; created: boolean } | null>
```

- **第一跳（纯代码，零 LLM）**：`normalizeConceptKey(rawText)` → 查 `concept_aliases` 唯一索引 → 命中即返回。
- **未命中**：`createIfMissing` 时创建 `concepts` + 首条 alias（`source='write_time'`）。
- **语义近义**不在这里做——留给 consolidator 的 LLM 建议，异步、可证伪、需人工或闸门通过才执行。**关键路径上永不 await LLM**（沿用 `TaskDifficultyAdjustmentService` 纪律）。
- 缓存：进程内 LRU（`userId:aliasNorm` → `conceptId`），失效由 alias 写入事件驱动。

### 3.4 写入点改造清单

| # | 位置 | 现状 | 改造 |
|---|---|---|---|
| 1 | `memory-trace.service.ts:190` `recordExtraction` | 只写 `conceptKey` | 先 `resolveConcept`，同写 `conceptId` |
| 2 | `memory-trace.service.ts:290` `recordExtraction` 批量入口 | 同上 | 同上（批量去重后一次 resolve） |
| 3 | `memory-trace.service.ts:435` `bumpReviewInterval` | 按 `conceptKey` | 按 `conceptId`（回落 key） |
| 4 | `LearnerKnowledgeMemoryService.ts:559` `prerequisiteGaps` | 按 `conceptKey`/`label` 匹配 | L3 阶段改走图（见 §5） |
| 5 | `misconception-ledger.service.ts` 写入 | 只写 `conceptKey` | 同写 `conceptId` |
| 6 | `stage-enrichment.ts` 子任务落库 | `linkedConceptId = concept-N` | 增写 `conceptId`（resolve `linkedConceptName`） |
| 7 | `kc-annotation.ts` 持久化 | `kcGraph` 塞 JSON | 节点补 `conceptId`；边物化（L2） |
| 8 | `LearnerProjectionService.ts` / `LearnerSnapshotService.ts` | 按 label 聚合 | 按 `conceptId` 聚合（`label` 保留展示） |

**双写期**：P0 只写不读（读路径完全不动，零行为变化）；P1 读路径切换，保留"`conceptId` 为空则回落 `conceptKey`"的兼容分支。

### 3.5 迁移与回填

三步，全部可重入：

1. **建表**（`prisma/migrations`）——纯新增，无数据风险。
2. **存量回填**（`scripts/backfill-concept-registry.ts`）：
   - 对每个 `userId`，把 `memory_traces.conceptKey` 去重后逐个 `resolveConcept(createIfMissing)`；
   - 同样处理 `misconception_ledger.conceptKey`（**这一步就把 28% 的交集覆盖率顶上去**——同一文本解析到同一 `conceptId`）；
   - `subtasks`/`milestones` 按 `linkedConceptName`/`coreConceptName` resolve；
   - 只对 `isVirtualLearner=1` 先跑（隔离真实用户）。
3. **归并执行**（可选）：对回填结果跑 consolidator P2，把语义近义登记为 alias。

回填必须**幂等**且**可分批**（按 userId 分片、支持 `--dry-run`、`--limit`）。

### 3.6 回滚与兼容

- 回滚：删表 + 删新增列即可，读路径的兼容分支保证回滚后行为与改造前一致。
- 兼容：所有读点写成"`conceptId` 优先，空则回落原键"，故 P0/P1 期间新旧数据共存无碍。
- **不破坏的不变式**（对齐跨日模拟契约 §五）：Path 契约不改（只增列）；`simulationClock` 结构不改；`asOf` 上界排除真实行。

---

## 4. L2：边表

### 4.1 数据模型

```prisma
/// 概念边。scope 区分"路径内局部依赖"与"用户级全局关系"——两者语义不同，不可混算。
model concept_edges {
  id            String   @id
  userId        String
  fromConceptId String
  toConceptId   String
  relation      String   // prerequisite | part_of | related | contrasts_with | transfer_to
  scope         String   @default("path")   // path | user
  pathId        String?                     // scope='path' 时必填
  source        String                      // kc-mapper | path-planning | consolidator | human
  confidence    Float    @default(1)
  createdAt     DateTime @default(now())
  @@unique([userId, fromConceptId, toConceptId, relation, scope, pathId])
  @@index([userId, fromConceptId, relation])   // 后继查询（"学 X 之前要什么"）
  @@index([userId, toConceptId, relation])     // 前置查询（"哪些 KC 依赖 X"）
}
```

### 4.2 关系类型

| relation | 语义 | 来源 |
|---|---|---|
| `prerequisite` | 要理解 B 必须先掌握 A（A→B） | kc-mapper `kcGraph.edges`（现在唯一产出） |
| `part_of` | KC 属于某个 coreConcept | kc-mapper `conceptKcs` 的嵌套结构（**代码可推**，不必让 LLM 再标） |
| `related` | 相关但无严格先后 | 预留 |
| `contrasts_with` | 易混概念（误解台账可用） | 预留 |
| `transfer_to` | 迁移目标 | path-planning `transferable` 预留 |

**`part_of` 由代码从 `conceptKcs` 的既有嵌套推出来，不新增 LLM 调用。**

### 4.3 物化

- kc-mapper 落库时（`kc-annotation.ts`），把 `kcGraph.edges` 逐条 `resolveConcept` 两端 + 写 `concept_edges(relation='prerequisite', scope='path', pathId)`；`conceptKcs` 嵌套推 `part_of`。
- `kcAnnotation` JSON 仍保留（生成快照 + 审计），但**读路径改走表**。
- 幂等：`@@unique` 保证重复生成不产生重复边。

### 4.4 为什么不是知识图谱

- 代码要的是**邻接查询**，一条索引 SQL 即可（`@@index([userId, fromConceptId, relation])`）。JSON blob 无索引、无约束、join 不了。
- 知识图谱（embedding 检索 / 多跳 / 图嵌入）在本项目**没有消费者**：§1.4 已证调控全在代码，LLM 不做多跳推理。
- 大图多跳注入 prompt 会退化；进 prompt 的应是代码查好的 1-hop 邻域。

---

## 5. L3：调控接入

三处"该用图没用"，按收益排序：

### 5.1 `neighboringConcepts`：`.slice(0,3)` → 1-hop 遍历

`TeachingContextBuilder.ts:406-416`。改为：

```ts
// 伪码：当前 concept 的 1-hop 邻居（prerequisite 入边优先 → 后继 → part_of 兄弟）
const neighbors = await conceptGraphService.neighbors(userId, currentConceptId, {
  relations: ['prerequisite', 'part_of'],
  direction: 'in',        // 前置优先（教学需要先唤醒基础）
  limit: 3,
  pathId: path.id,
});
```

**收益**：教学上下文里的"相邻概念"第一次有语义依据。

### 5.2 `prerequisiteGaps`：语义修正（最高价值）

`LearnerKnowledgeMemoryService.ts:559-568` 现在是"当前概念自己没掌握"。改为：

```ts
// 沿 prerequisite 边**向上游**找未掌握的前置 KC（才是"缺口"）
const upstream = await conceptGraphService.upstreamClosure(userId, currentConceptId, { maxDepth: 2, pathId });
const gaps = upstream.filter((node) => isWeak(traceByConceptId.get(node.conceptId)));
```

**收益**：这是把 `kcGraph.edges` 第一次接进调控回路；且修正了一个**语义错误**——现在路径规划补前置时依据是错的。

### 5.3 `ReplanAdvisory` severity：按缺口结构定级

`ReplanAdvisoryService.ts:133/149`。severity 从"仅按 `stability === 'fragile'`"升级为按**缺口深度 + 是否阻塞当前 KC**（有 prerequisite 边直连当前 → high；两跳 → medium）。

**风险控制**：severity 影响 `highRisk` → 影响是否弹重规划建议，属**用户可见行为**。必须用跨日对照确认触发率没有异常抬升（见 §6.3 断言 7）。

---

## 6. 验证方案：端到端 + 跨日模拟

### 6.1 已有基础设施（直接复用，不新建）

| 能力 | 位置 |
|---|---|
| 可丢弃学习者端到端驱动（断点续跑/不烧日/自动清理） | `src/scripts/simulate-learner-e2e.ts`（483 行） |
| 纯函数判定层（就绪/退避/终局分类） | `src/services/virtual-lab/run-harness.ts` |
| 逐日推进（重放业务时间戳，不 mock 时钟） | `POST /api/admin/virtual-learners/sessions/:id/advance-day`（`virtual-learners.ts:3112`） |
| 模拟时钟读取 | `GET .../simulation-clock`（`:1998`） |
| **每日只读聚合（核心观测量）** | `GET .../day-timeline`（`:2016`）→ `dayLoad` / `metrics{lss,ktl,lf,lsb}` / `pacing` / `tasks[]` / `difficultyAdjustments[]` / `reviewQuota` / `memory{traceCount,dueCount,fragileCount,stableCount,avgRetention}` |
| 批量规模化 | `batch-experiment.service.ts`（多学习者 × 各自 Goal→Path→学完→跨日衰减） |

### 6.2 两条验证轨道

**轨道 A · 存量回填验证（验证 L1 的效果，只读对比）**

对**已存在的虚拟学习者**（`isVirtualLearner=1`）跑回填，前后对比只读指标——不改真实用户、不新增学习者：

```
回填前：memory{dueCount, traceCount, fragileCount, avgRetention} 快照
  → scripts/backfill-concept-registry.ts --virtual-only --dry-run  # 看计划
  → 正式回填
回填后：同口径再取一次
```

**轨道 B · 前瞻跨日对照（验证 L1+L2+L3 的端到端效果）**

用 `simulate-learner-e2e.ts` 跑可丢弃学习者，**同参数改造前/后各跑一轮**：

```bash
# 基线（改造前代码）
E2E_ADMIN_NAME=admin E2E_ADMIN_PASSWORD=*** \
  npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts \
    --name="[kc-design] 基线 0922" --days=14 --base-days-ago=21 \
    --state=C:/tmp/kc-baseline.json

# 改造后（同 name 前缀便于对比；--keep 保留现场供 day-timeline 复查）
E2E_ADMIN_NAME=admin E2E_ADMIN_PASSWORD=*** \
  npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts \
    --name="[kc-design] 改造 0922" --days=14 --base-days-ago=21 \
    --state=C:/tmp/kc-after.json --keep
```

`--days=14` 覆盖至少两个复习周期（FSRS 首轮间隔 + ACT-R 幂律衰减可见段）；`--base-days-ago=21` 让日历锚点在过去、不进入未来（契约 §一）。

### 6.3 观测量与断言

每条断言都能从 `day-timeline` 或一次 SQL 直接取到，**不新造口径**。

| # | 断言 | 取数 | 阈值 |
|---|---|---|---|
| 1 | **重复键收敛**：`distinct conceptKey / distinct conceptId` 比值 | `memory_traces` SQL | 改造前 ≈1.00（848/843）；改造后 ≥1.15 |
| 2 | **跨表可 join**：`misconception_ledger.conceptId` ∩ `memory_traces.conceptId` 覆盖率 | SQL | 改造前 28%（231/829）；改造后 ≥80% |
| 3 | **子任务可解析**：`subtasks` 有 `conceptId` 的比例 | SQL | 改造后 100%（2415 全部 resolve） |
| 4 | **归并不失真**：`avgRetention` 前后差 | `day-timeline.memory` | \|Δ\| ≤ 0.05（不能把掌握度搞乱） |
| 5 | **复习清单收敛但不消失**：`dueCount` | `day-timeline.memory` | 下降但 > 0（归并重复项，不是清空） |
| 6 | **邻域有依据**：`cognitiveFrame.neighboringConcepts` 每项与当前 concept 间存在 edge | 新增只读断言脚本 | 100% |
| 7 | **重规划触发率无异常抬升**：`difficultyAdjustments[]` / replan advisory 触发天数 | `day-timeline` | 与基线偏差 ≤ 1 天/14 天 |
| 8 | **前置缺口语义正确**：gap 的 conceptId 必须是当前 concept 的**上游** | 新增只读断言脚本 | 100% |
| 9 | **边物化一致**：`concept_edges`(relation='prerequisite', scope='path') 行数 == 各路径 `kcGraph.edges` 总数 | SQL | 相等 |

**新增断言脚本**（只读，不改业务）：`src/scripts/verify-kc-identity.ts` —— 一次跑完断言 1/2/3/9；断言 6/8 需读一次教学上下文的 `cognitiveFrame`，可在 e2e 跑完后对保留的 `--keep` 学习者调 `TeachingContextBuilder` 校验。

### 6.4 规模化

单学习者对照只能看趋势；要"看到效果"的稳定性，用 `batch-experiment.service.ts` 跑 **N=6~10 个可丢弃学习者 × 14 天**（覆盖不同 `sampleType`：学生样本 / 自由生成），把 `day-timeline` 的 `memory.*` 与 `difficultyAdjustments` 按天聚合，看分布而非单点。

### 6.5 前置条件与坑（历史教训）

- **必须重启后端**：改造涉及服务层与读路径，`ts-node-dev` 热重载不覆盖所有模块；不重启会看到旧行为（本项目已多次踩坑）。
- **在途请求会被重启掐断**：e2e harness 已内置断点续跑（`--state=`），续跑用同一条命令。
- **路径生成窗口**：`advance-day runTasks` 在路径未就绪时返回 `started:false` 且**不消耗模拟日**，harness 会等就绪重试同日——不要误判为失败。
- **隔离**：`asOf` 上界天然排除真实行；回填先 `--virtual-only`。

---

## 7. 分期、门禁与风险

| 期 | 内容 | 行为变化 | 门禁 |
|---|---|---|---|
| **P0** | L1 建表 + 解析器 + 写路径双写（只写不读） | **零**（读路径不动） | tsc / eslint / jest 全量；存量回填 dry-run 报告 |
| **P1** | 存量回填 + consolidator 升格（P2 非破坏化）+ 读路径切 `conceptId`（带回落） | 内部口径；用户可见行为不变 | 轨道 A 断言 1-5；跨日回归 |
| **P2** | L2 边表物化（`kcGraph.edges` → `concept_edges`） | **零**（无消费者） | 断言 9；重复生成幂等测试 |
| **P3** | L3 三处接入（邻域 / 前置缺口 / severity） | **有**（教学上下文内容、重规划触发） | 轨道 B 断言 6-8；基线对照 |

**主要风险**：

1. **severity 变更抬升重规划触发率** → 断言 7 卡住；P3 可只上 5.1+5.2、暂缓 5.3。
2. **回填把"同词异义"错误合并** → 回填**只做文本精确解析**（`normalizeConceptKey` 后相等），语义近义一律留给 consolidator 建议 + 人工；不做自动语义合并。
3. **`concept-N` 与 canonical 双 id 共存期读错** → 读点统一封装在 `concept-registry.service`，禁止散落判断。
4. **概念身份是用户级的**：跨用户不做全局归一（同一名字对不同人粒度不同，见 §3.1 注释）。

---

## 8. 明确不做

- **不做 embedding 检索 / 图谱嵌入 / 多跳 prompt 注入**——无消费者，且会退化。
- **不改 Path 契约**（只增列，不改既有列语义与 `path-status` 字段）。
- **不训练模型**（沿用 `LEARNER_STATE_REVIEW_DESIGN.md` §6）。
- **不让 LLM 直接写 `conceptId`**——LLM 只出可证伪建议，代码执行（沿用 consolidator 纪律）。
- **不在关键路径 await LLM**（沿用 `TaskDifficultyAdjustmentService` 纪律）。
- **不合并每日温故额度与每日时长上限**（跨日模拟契约 §五 不变式 7）。

---

## 附：改造后的链路（目标态）

```
path-planning ──► coreConcepts[] ──resolve──► concepts(level='concept')
kc-mapper ──────► conceptKcs / taskKcLinks / kcGraph
                    ├─ nodes ──resolve──► concepts(level='kc')
                    ├─ edges ───────────► concept_edges(relation='prerequisite', scope='path')
                    └─ 嵌套结构 ──代码推──► concept_edges(relation='part_of')
                                                │
memory_traces ──resolveConcept──► conceptId ────┤
misconception_ledger ─resolve────► conceptId ───┤
subtasks / milestones ─resolve───► conceptId ───┤
                                                ▼
                          调控接入（全部代码判定）
                          ├─ cognitiveFrame.neighboringConcepts ← 1-hop 入边
                          ├─ prerequisiteGaps                  ← 上游闭包 × 掌握度
                          └─ ReplanAdvisory severity           ← 缺口深度 + 是否阻塞
```

---

## 交付状态（2026-09-23）

| 期 | 内容 | 提交 | 实测 |
|---|---|---|---|
| P0 | 建表 + 注册表服务 + 写入点双写（只写不读） | `735d4979` | concept-registry 12/12 |
| P1 | 存量回填 + 只读度量脚本 | `735d4979` | 子任务 canonical 覆盖 0→99.9%；误解↔痕迹贯通 27.9%→87.8% |
| P1 续 | 双写扩到误解台账 + 子任务；键对齐 + 局部序号护栏 | `89cb0a7e` `7bf2e0e4` | 真实生成 4/4 子任务带 id |
| S2 | 读侧携带 conceptId（+ 修痕迹循环被误圈在会话循环内的门控 bug） | `032cc70e` | 675/675 |
| S3 | consolidator 升格 alias 策略（非破坏：登记别名 + 改指，不删行） | `f2650c59` | consolidator 35/35 |
| S1 | **L2 边表物化**：`kcGraph.edges` → `concept_edges`（+ part_of 代码推导） | `ee028e0b` | 断言 9 转绿：`kcGraph.edges=111 == concept_edges=111` |
| S4a | `neighboringConcepts` → 1-hop 图遍历（图缺失回落旧行为） | `bcc78948` | 5/5 |
| S4b | `prerequisiteGaps` → 上游闭包（**修正语义错误**：缺口 = 上游未掌握） | `a3d739a9` | 4/4 |
| S4c | 缺口 severity → 重规划风险 契约 | `6a2ac4ac` | 3/3 |
| S5 | 图视图 API + `MkGraph.vue` 画布 + 学习者详情「知识图谱」tab | `4a2316d0` | 后端 10/10+11/11；前端 555/555、design:check 通过 |

**边方向语义（实测标定）**：`edges[{from,to}]` 表示 **`from` 是 `to` 的前置**（用 5 条真实路径的
66 条边与 `conceptKcs[].kcs[].prerequisiteKCs` 交叉验证：66 一致、0 反向）。

**已知限制（诚实边界）**
1. `prerequisite` 边**极稀疏**：157 条含 kcAnnotation 的路径里只有 5 条产出边（kc-mapper 产出侧局限）；
   `part_of`（代码从 `conceptKcs` 嵌套推导）才是主要结构。
2. `memory_traces` 内部比值无改善（`@@unique(userId,conceptKey)` 写入时已去重）。
3. **计划↔痕迹贯通率仍仅 ~7.8%**——子任务的"关系描述式"命名与痕迹的 KC 级命名是两套词汇，
   机械归一化桥不过去；**S3 的 alias 升格（LLM 建议）才是收敛杠杆**，需实际跑一轮归并才会见效。
4. 物化钩子**需要一次干净的后端重启**才在服务进程内生效：实测 ts-node-dev `--respawn`
   偶发漏重载深层模块，导致 2 条新路径未物化（重启后实测触发：`prerequisite:16, partOf:15`）。
5. S4b/S4c 是**用户可见**改动（`hasPrerequisiteGaps` / 重规划触发率）。**2026-09-23 已跑跨日对照**
   （单用户 3 路径 × 2 模拟日，见 `doc/KC_MULTIPATH_AND_LEARNER_SIGNAL_SCOPE.md`），结论修正如下：
6. **S4b 曾因层级错配而实际未生效（2026-09-23 已修）**：任务概念是 `concept` 级（当时实测 25/25），
   而 `prerequisite` 边是 `kc→kc`（22/22），故 `upstreamClosure` 在所有任务上返回 0，
   `prerequisiteGaps` 静默回落旧算法。修法 = 物化时增加**概念级前置投影**
   （`source='prerequisite-projection'`，自环与反向对跳过），修后上游闭包命中 6/9、5/8、1/8。
7. **S4a 曾返回 `part_of` 子节点而非前置（2026-09-23 已修）**：`neighbors` 的 `limit` 截断原本依 DB 行序
   `slice`，顺序不确定；已改为前置优先的确定排序。
8. **kc-mapper 重跑会累积被覆盖版本的边**：实测某路径 stored `kcGraph.edges`=11 而物化行=22，
   多出的 11 条端点不在 stored `kcGraph.nodes` 中。故断言 9 已从"等号"改为逐路径**超集不变式**
   （"物化行数 ≥ stored 数"，即未漏），并把多出行数单独报出。是否清理作废边属产品裁决。
9. **教学上下文的"本课知识范围"曾恒空（2026-09-23 已修）**：`buildTaskKnowledgeSeeds` 是空桩，
   `subtasks.learningObjectives` 全库为空（2037/2037）⇒ `primaryConcepts` 恒空 ⇒ 按它过滤的
   `prerequisiteConcepts` **结构性永远为空**（上游闭包修好了却在此被丢掉）。
   修后 `primary` 16/16、`prereq` 有真缺口时非空；`LearnerPrerequisiteGap` 增 `source` 字段区分
   真上游与回落口径。详见 `doc/KC_MULTIPATH_AND_LEARNER_SIGNAL_SCOPE.md` §1.2d。
