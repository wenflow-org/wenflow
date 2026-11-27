# KC 概念身份与知识图谱设计

> 📌 类型：活规范（概念身份注册表、概念边表与调控接入的现行规则）｜索引见 [doc/README.md](./README.md)。

> 关联：`doc/LEARNER_STATE_REVIEW_DESIGN.md`（调控分工纪律）、`doc/VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md`（跨日模拟契约）、`doc/LEARNER_MODEL_ARCHITECTURE.md`

---

## 0. 结论（TLDR）

1. **先身份，后图。** `concept-N` 是路径内局部序号：`concept-2` 在 A 路径是"Excel数据加载与清洗后输出的结构化管道"，在 B 路径是"文件路径与数据加载的映射关系"——同键不同义。图必须先有可 join 的身份。
2. **归并 ≠ 身份。** `ConceptConsolidatorService` 做概念归并：LLM 出可证伪建议、代码执行、全程审计可回滚；它改变的是建议/审计，不是可 join 的键。身份由 L1 注册表承担——consolidator 的决策物化为 alias 行（§3.2）。
3. **"图对 LLM 友好"这个判据在本项目不成立。** 调控的每一个决策点都是**代码**判定的（难度/FSRS/检查点/重规划），LLM 只出观测档位。图不进 prompt，进 prompt 的是**代码已经查好的 1-hop 邻域**。所以选型判据是"对代码可查询"，答案是轻量 typed edge 表，不是知识图谱。

---

## 2. 设计总览

```
L1 概念注册表（身份）        concepts + concept_aliases
    ├─ 解析器 resolveConcept(userId, rawText) → conceptId
    ├─ 写入点全部落 conceptId（memory_traces / misconception_ledger / subtasks / milestones / kcGraph）
    └─ concept-consolidator 以"登记 alias"代替"重写 traces"（非破坏）

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

- P1（观察）：只写审计投影。
- P2（执行）：不 `executeMerges` 重写/删除 `memory_traces`，而是
  1. 选定 canonical（`canonicals` 参数，`memory-review.ts:322`）；
  2. 为其建立 `concepts` 行（若不存在）；
  3. 把被归并的每个 `conceptKey` 插为 `concept_aliases(source='consolidator')`；
  4. 回填受影响 `memory_traces.conceptId`。
- **回滚 = 删 alias 行**，比"按审计快照重放"简单一个量级，且天然幂等。

`refreshInBackground` 的自动触发点（会话结束/任务完成）保持不变，产物是"建议 + 可选的 alias 登记"。

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

### 3.4 写入点清单

| # | 位置 | 现行写入 |
|---|---|---|
| 1 | `memory-trace.service.ts:190` `recordExtraction` | 先 `resolveConcept`，同写 `conceptId` |
| 2 | `memory-trace.service.ts:290` `recordExtraction` 批量入口 | 同上（批量去重后一次 resolve） |
| 3 | `memory-trace.service.ts:435` `bumpReviewInterval` | 按 `conceptId`（回落 key） |
| 4 | `LearnerKnowledgeMemoryService.ts:559` `prerequisiteGaps` | 走图（见 §5） |
| 5 | `misconception-ledger.service.ts` 写入 | 同写 `conceptId` |
| 6 | `stage-enrichment.ts` 子任务落库 | 增写 `conceptId`（resolve `linkedConceptName`） |
| 7 | `kc-annotation.ts` 持久化 | 节点补 `conceptId`；边物化（L2） |
| 8 | `LearnerProjectionService.ts` / `LearnerSnapshotService.ts` | 按 `conceptId` 聚合（`label` 保留展示） |

**读取口径**：`conceptId` 优先，空则回落 `conceptKey`（兼容旧数据）。

### 3.5 迁移与回填

三步，全部可重入：

1. **建表**（`prisma/migrations`）——纯新增，无数据风险。
2. **存量回填**（`scripts/backfill-concept-registry.ts`）：
   - 对每个 `userId`，把 `memory_traces.conceptKey` 去重后逐个 `resolveConcept(createIfMissing)`；
   - 同样处理 `misconception_ledger.conceptKey`（同一文本解析到同一 `conceptId`，跨表 join 覆盖率随之抬升）；
   - `subtasks`/`milestones` 按 `linkedConceptName`/`coreConceptName` resolve；
   - 只对 `isVirtualLearner=1` 先跑（隔离真实用户）。
3. **归并执行**（可选）：对回填结果跑 consolidator P2，把语义近义登记为 alias。

回填必须**幂等**且**可分批**（按 userId 分片、支持 `--dry-run`、`--limit`）。

### 3.6 回滚与兼容

- 回滚：删表 + 删新增列即可，读路径的兼容分支保证回滚后行为与改造前一致。
- 兼容：所有读点写成"`conceptId` 优先，空则回落原键"，故新旧数据共存无碍。
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

**边方向**：`edges[{from,to}]` 表示 `from` 是 `to` 的前置（用 5 条真实路径的 66 条边与 `conceptKcs[].kcs[].prerequisiteKCs` 交叉验证：66 一致、0 反向）。

### 4.3 物化

- kc-mapper 落库时（`kc-annotation.ts`），把 `kcGraph.edges` 逐条 `resolveConcept` 两端 + 写 `concept_edges(relation='prerequisite', scope='path', pathId)`；`conceptKcs` 嵌套推 `part_of`。
- `kcAnnotation` JSON 仍保留（生成快照 + 审计），但**读路径改走表**。
- 幂等：`@@unique` 保证重复生成不产生重复边。

### 4.4 为什么不是知识图谱

- 代码要的是**邻接查询**，一条索引 SQL 即可（`@@index([userId, fromConceptId, relation])`）。JSON blob 无索引、无约束、join 不了。
- 知识图谱（embedding 检索 / 多跳 / 图嵌入）在本项目**没有消费者**：调控全在代码，LLM 不做多跳推理（见 §0）。
- 大图多跳注入 prompt 会退化；进 prompt 的应是代码查好的 1-hop 邻域。

---

## 5. L3：调控接入

三处图消费点，按收益排序：

### 5.1 `neighboringConcepts`：1-hop 图遍历

`teaching-context-knowledge.ts:146`（`fetchGraphNeighbors`）与 `:246`（`buildCognitiveFrame` 内选邻居）按 1-hop 图取邻居：

```ts
// 伪码：当前 concept 的 1-hop 邻居（prerequisite 入边优先 → 后继 → part_of 兄弟）
const neighbors = await conceptGraphService.neighbors(userId, currentConceptId, {
  relations: ['prerequisite', 'part_of'],
  direction: 'in',        // 前置优先（教学需要先唤醒基础）
  limit: 3,
  pathId: path.id,
});
```

**收益**：教学上下文里的"相邻概念"有语义依据。

### 5.2 `prerequisiteGaps`：沿 prerequisite 边找上游缺口（最高价值）

`LearnerKnowledgeMemoryService.ts:559-568` 的 `prerequisiteGaps` 指"沿 prerequisite 边**向上游**找未掌握的前置 KC"，不是"当前概念自己没掌握"：

```ts
// 沿 prerequisite 边**向上游**找未掌握的前置 KC（才是"缺口"）
const upstream = await conceptGraphService.upstreamClosure(userId, currentConceptId, { maxDepth: 2, pathId });
const gaps = upstream.filter((node) => isWeak(traceByConceptId.get(node.conceptId)));
```

**收益**：`kcGraph.edges` 接进调控回路；路径规划补前置的依据是真正的上游缺口，而不是"当前概念自己没掌握"。

### 5.3 `ReplanAdvisory` severity：按缺口结构定级

`ReplanAdvisoryService.ts:133/149`。severity 按**缺口深度 + 是否阻塞当前 KC** 定级（有 prerequisite 边直连当前 → high；两跳 → medium），不再仅依据 `stability === 'fragile'`。

**风险控制**：severity 影响 `highRisk` → 影响是否弹重规划建议，属**用户可见行为**。必须用跨日对照确认触发率没有异常抬升（见 §6.3 断言 7）。

---

## 6. 验证方案：端到端 + 跨日模拟

### 6.1 已有基础设施（直接复用，不新建）

| 能力 | 位置 |
|---|---|
| 可丢弃学习者端到端驱动（断点续跑/不烧日/自动清理） | `src/scripts/simulate-learner-e2e.ts`（512 行） |
| 纯函数判定层（就绪/退避/终局分类） | `src/services/virtual-lab/run-harness.ts` |
| 逐日推进（重放业务时间戳，不 mock 时钟） | `POST /api/admin/virtual-learners/sessions/:id/advance-day`（`virtual-learners.assisted-simulation.ts:178`） |
| 模拟时钟读取 | `GET .../simulation-clock`（`virtual-learners.session-lifecycle.ts:913`） |
| **每日只读聚合（核心观测量）** | `GET .../day-timeline`（`virtual-learners.session-lifecycle.ts:931`）→ `dayLoad` / `metrics{lss,ktl,lf,lsb}` / `pacing` / `tasks[]` / `difficultyAdjustments[]` / `reviewQuota` / `memory{traceCount,dueCount,fragileCount,stableCount,avgRetention}` |
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

用 `simulate-learner-e2e.ts` 跑可丢弃学习者，**同参数基线 / 现行各跑一轮**：

```bash
# 基线（参照版本）
E2E_ADMIN_NAME=admin E2E_ADMIN_PASSWORD=*** \
  npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts \
    --name="[kc-design] 基线 0922" --days=14 --base-days-ago=21 \
    --state=C:/tmp/kc-baseline.json

# 现行（同 name 前缀便于对比；--keep 保留现场供 day-timeline 复查）
E2E_ADMIN_NAME=admin E2E_ADMIN_PASSWORD=*** \
  npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts \
    --name="[kc-design] 现行 0922" --days=14 --base-days-ago=21 \
    --state=C:/tmp/kc-after.json --keep
```

`--days=14` 覆盖至少两个复习周期（FSRS 首轮间隔 + ACT-R 幂律衰减可见段）；`--base-days-ago=21` 让日历锚点在过去、不进入未来（契约 §一）。

### 6.3 观测量与断言

每条断言都能从 `day-timeline` 或一次 SQL 直接取到，**不新造口径**。

| # | 断言 | 取数 | 阈值 |
|---|---|---|---|
| 1 | **重复键收敛**：`distinct conceptKey / distinct conceptId` 比值 | `memory_traces` SQL | 2026-09 基线 ≈1.00（848/843）；目标 ≥1.15 |
| 2 | **跨表可 join**：`misconception_ledger.conceptId` ∩ `memory_traces.conceptId` 覆盖率 | SQL | 2026-09 基线 28%（231/829）；目标 ≥80% |
| 3 | **子任务可解析**：`subtasks` 有 `conceptId` 的比例 | SQL | 100%（2026-11-26：3145/3145 全部 resolve） |
| 4 | **归并不失真**：`avgRetention` 前后差 | `day-timeline.memory` | \|Δ\| ≤ 0.05（不能把掌握度搞乱） |
| 5 | **复习清单收敛但不消失**：`dueCount` | `day-timeline.memory` | 下降但 > 0（归并重复项，不是清空） |
| 6 | **邻域有依据**：`cognitiveFrame.neighboringConcepts` 每项与当前 concept 间存在 edge | 断言脚本 | 100% |
| 7 | **重规划触发率无异常抬升**：`difficultyAdjustments[]` / replan advisory 触发天数 | `day-timeline` | 与基线偏差 ≤ 1 天/14 天 |
| 8 | **前置缺口语义正确**：gap 的 conceptId 必须是当前 concept 的**上游** | 断言脚本 | 100% |
| 9 | **边物化一致（未漏）**：逐路径 `concept_edges`(relation='prerequisite', scope='path', source='kc-mapper') 行数 ≥ 该路径 stored `kcGraph.edges` 数；多出行数单独报出 | SQL | 无路径「物化行数 < stored 数」（超集不变式：未漏） |

**断言脚本**（只读，不改业务）：`src/scripts/verify-kc-identity.ts` —— 一次跑完断言 1/2/3/9；断言 6/8 需读一次教学上下文的 `cognitiveFrame`，可在 e2e 跑完后对保留的 `--keep` 学习者调 `TeachingContextBuilder` 校验。

### 6.4 规模化

单学习者对照只能看趋势；要"看到效果"的稳定性，用 `batch-experiment.service.ts` 跑 **N=6~10 个可丢弃学习者 × 14 天**（覆盖不同 `sampleType`：学生样本 / 自由生成），把 `day-timeline` 的 `memory.*` 与 `difficultyAdjustments` 按天聚合，看分布而非单点。

### 6.5 前置条件

- **评估前必须重启后端**：`ts-node-dev` 热重载不覆盖服务层与读路径的全部模块。统一用 `node backend/restart.mjs`。
- **在途请求会被重启掐断**：e2e harness 已内置断点续跑（`--state=`），续跑用同一条命令。
- **路径生成窗口**：`advance-day runTasks` 在路径未就绪时返回 `started:false` 且**不消耗模拟日**，harness 会等就绪重试同日——不要误判为失败。
- **隔离**：`asOf` 上界天然排除真实行；回填先 `--virtual-only`。

---

## 7. 风险与已知限制

| 风险 | 护栏 |
|---|---|
| **severity 变更抬升重规划触发率** | 断言 7 卡住；可只启用 5.1+5.2、暂缓 5.3 |
| **回填把"同词异义"错误合并** | 回填**只做文本精确解析**（`normalizeConceptKey` 后相等），语义近义一律留给 consolidator 建议 + 人工；不做自动语义合并 |
| **`concept-N` 与 canonical 双 id 共存时读错** | 读点统一封装在 `concept-registry.service`，禁止散落判断 |
| **概念身份是用户级的** | 跨用户不做全局归一（同一名字对不同人粒度不同，见 §3.1 注释） |

**已知限制**

1. **`prerequisite` 边在路径内不均衡**：kc-mapper 只为部分路径产出前置结构（2026-11-26 复核：526 条路径中 256 条有 kc-mapper 前置边）；`part_of`（代码从 `conceptKcs` 嵌套推导）是另一类结构，两类边都由同一套物化写入。
2. `memory_traces` 内部比值无改善（`@@unique(userId,conceptKey)` 写入时已去重）。
3. **计划↔痕迹贯通率低**——子任务的"关系描述式"命名与痕迹的 KC 级命名是两套词汇，机械归一化桥不过去；alias 升格（LLM 建议）才是收敛杠杆，需实际跑一轮归并才会见效。
4. **kc-mapper 重跑会累积被覆盖版本的边**：多出的边端点不在 stored `kcGraph.nodes` 中。断言 9 按逐路径**超集不变式**（物化行数 ≥ stored 数）执行，多出行数单独报出；是否清理作废边属产品裁决。
5. `upstreamClosure` 的命中受限于 kc-mapper 是否为该路径产出 prerequisite 结构；"无图可依"与"图接错"是两回事。

---

## 8. 明确不做

- **不做 embedding 检索 / 图谱嵌入 / 多跳 prompt 注入**——无消费者，且会退化。
- **不改 Path 契约**（只增列，不改既有列语义与 `path-status` 字段）。
- **不训练模型**（沿用 `LEARNER_STATE_REVIEW_DESIGN.md` §6）。
- **不让 LLM 直接写 `conceptId`**——LLM 只出可证伪建议，代码执行（沿用 consolidator 纪律）。
- **不在关键路径 await LLM**（沿用 `TaskDifficultyAdjustmentService` 纪律）。
- **不合并每日温故额度与每日时长上限**（跨日模拟契约 §五 不变式 7）。

---

## 附：概念身份与图链路

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
