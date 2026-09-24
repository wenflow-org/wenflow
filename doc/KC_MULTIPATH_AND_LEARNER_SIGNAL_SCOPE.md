# 单用户多路径 · 概念图有用性 · 学习者信号作用域

> 日期：2026-09-23 ｜ 关联：`doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md`（L1/L2/L3 设计）
> 驱动：`backend/scripts/kc-multipath-run.ts`（单用户 3 路径 × 2 跨日；`--case=` 跑具名单案例）
> 续跑：`backend/scripts/kc-resume-case.ts`（会话中断后补课，不重算路径与图）
> 度量：`backend/scripts/kc-multipath-measure.ts`（只读）、`scripts/q-trace-join.ts`（痕迹↔节点）、
> `scripts/q-case-state.ts`（会话/任务/痕迹状态）、`scripts/q-miscon.ts`（误解归并诊断）

## 0. 为什么做这件事

上一轮把 L1（概念身份注册表）/ L2（概念图边表）/ L3（调控接入）都落地了，但两点没验证：

1. **跨日模拟没跑成**（只到 3 个模拟日、无前后对照）；
2. **单用户多 path 完全没测**——而设计里图的 `scope` 明确分 `path` / `user` 两半。

本文件记录：(a) 真实跑出的多路径跨日结果；(b) 改造后的图到底有没有被消费；(c) 学习者侧信号哪些该跨 path、哪些只该 path 内。

---

## 1. 实测：单用户 3 路径 × 2 跨日

学习者 `[kc] 多路径 0923a`（userId=`ae3ccc10-1d03-4c69-8278-a3e585755842`，
profileId=`dd6845fa-c069-4508-8367-2447642e4f28`，baseDate=2026-09-02，`--keep` 保留）。
原始数据：`C:/tmp/kc-multipath.json`。复跑：`npx ts-node --transpile-only scripts/kc-multipath-run.ts --name=... --paths=3 --days=2 --keep`；
度量：`scripts/kc-multipath-measure.ts`、`scripts/kc-multipath-days.cjs`。
（保留的现场可用 `DELETE /api/admin/virtual-learners/dd6845fa-c069-4508-8367-2447642e4f28` 清理。）

### 1.1 运行结果

3 条路径全部生成成功（goal 各 13 步内收敛 → `path/running`）：

| # | 路径 | id | prerequisite 边 | part_of 边 | 图节点 |
|---|---|---|---|---|---|
| 1 | 用完整时段客流推算下午高峰排班 | `lp_1790127746709_dwgbfi4` | 22 | 22 | 28 |
| 2 | 销售报表下滑品类讲清三句话 | `lp_1790127881444_mffbmww` | 34 | 25 | 32 |
| 3 | 用四组数定位首页改版流失点 | `lp_1790128034790_jkpajv7` | 29 | 22 | 38 |

跨日：每条路径各推进 **2 个模拟日**（09-03、09-04），每天 2 个课次；无一天失败，最多重试 1 次（路径生成窗口内"未就绪"）。

**但 25 个任务里只有 1 个真正 completed**（2 in_progress、22 todo）。
`课次=2` 是**课堂回合数**，不等于完成任务——两天的课没有把任何一条路径的任务推完。

> 顺带解释了一个存量疑问：161 条含 `kcAnnotation` 的路径只有 10 条有边，
> 是因为只有 kc-mapper 契约修复（`164323f5`/`aecc2f7e`）之后的路径才带 `kcGraph`/`conceptKcs`。
> **新跑的路径都会物化**（本次 3/3），不是管道坏了。

### 1.2 图有没有被消费——**改造前：只有一半**

**S4a `neighboringConcepts`：确实在用。** 对每个任务的当前概念做
`neighbors(in, [prerequisite, part_of])`：path#1 **9/9**、path#2 **8/8**、path#3 **8/8** 命中，
返回内容语义正确（例：概念「完整时段与缺失时段之间的比例可比性判断」→ 邻居是同一概念下的 KC
「识别手写记录中上午与晚上的完整数字并归到同一天」）。

**但它返回的是 `part_of` 子节点，不是前置。** 实测 node level：

- 任务当前概念（canonical）**全部是 `concept` 级**（25/25，id 形如 `cpt_...`）；
- `prerequisite` 边**全部是 `kc → kc`**（22/22）；
- `part_of` 边是 `kc → concept`（22/22）。

所以从概念级节点出发的 `direction:'in'` 只能命中 `part_of`。设计里写的"前置优先"**没有落地**。

**S4b `prerequisiteGaps`：实际是空的。** `upstreamClosure`（只沿 prerequisite）在所有任务上返回 **0**
——概念级节点上没有 prerequisite 边。于是 `buildUpstreamPrerequisiteGaps` 返回 `[]`
（`LearnerKnowledgeMemoryService.ts:87-88`），`prerequisiteGaps` **静默回落旧算法**
（"当前概念自己没掌握"）。

> 后果：难度调整记录里出现的 `prerequisite_gaps` 理由**不代表上游缺口**，只是旧语义借用了这个标签。
> **S4b 声称修正的"语义错误"在实测中没有生效**——行为与改造前一致。

### 1.2b 修复：概念级前置投影（2026-09-23）

**根因**：同一路径内存在两套粒度的节点——`kcGraph.edges` 两端是 **KC 级**，任务概念经
`resolveTaskConcept` 出来是 **concept 级**。概念级节点上没有 prerequisite 边，所以概念级查询恒空。

**修法**：在 `materializePathGraph` 里增加一步**概念级投影**——
把每条 KC 级 prerequisite 的两端各自折叠到其所属 `coreConcept`，产出
`concept → concept` 的 prerequisite 边，`source='prerequisite-projection'`（与 kc-mapper 原始边分开统计，便于对账）。

规则与护栏：

- **跳过自环**（同一 coreConcept 内部两个 KC 的前置关系不构成概念间前置）；
- **互为反向的一对只保留字典序较小的一条**，避免概念级两跳环；
- 缺 kcId→coreConcept 映射时**只写 KC 级边**，不凭空造概念级边；
- 复用同名同 level 的解析缓存（兜底映射会让多个 kcId 指向同一 name）。

同时修 `neighbors` 的 **`limit` 截断顺序**：改为前置优先的**确定**排序。
改造前它直接对 DB 行序 `slice`，同样的图会因行序不同返回不同邻居——这正是"返回的全是 part_of"的直接原因。

**修复后实测**（同一条学习者，只补跑回填，未重新生成路径）：

| 路径 | 有图邻居 | **有上游闭包** |
|---|---|---|
| #1 | 9/9 | **6/9**（改造前 0） |
| #2 | 8/8 | **5/8**（改造前 0） |
| #3 | 8/8 | **1/8**（改造前 0） |

上游内容语义正确，例：概念「用已记录的相邻时段给缺失时段假设一个参照结构」→ 上游
「完整时段与缺失时段之间的比例可比性判断」@d1；概念「比较基线与差异归因的追问链」→ 上游
「把幅度差异翻译成业务含义的映射」@d1。邻居列表也变成**前置概念排第一**（改造前第一位是子 KC）。

回填规模：`prerequisite=150（概念级投影 +30） part_of=152`。

### 1.2c 端到端复验（新跑学习者，不经回填）

另起一个学习者 `[kc] 投影验证 0923b`（userId=`90d3e0f5-fa66-4304-87e0-6252c4ced125`，
profileId=`01de1df0-eae8-41e6-afc6-c46d54a76172`，2 路径 × 1 模拟日，`--keep` 保留），
路径由**修复后的实时管道**生成（投影边来自物化钩子，不是回填）：

| 路径 | kc-mapper/prereq | part_of | **投影** | 有图邻居 | **有上游闭包** |
|---|---|---|---|---|---|
| #1 把客流曲线变成排班人数建议 | 14 | 12 | **5** | 8/8 | **4/8** |
| #2 从销售报表定位下滑品类 | — | — | — | 6/6 | **4/6** |

上游内容正确，例：概念「把崩盘基准放到历史常态线上做一次对照」→ 上游
「崩盘场景反推加人门槛基准」@d1；概念「把问题品类的环比降幅按月连成一条线」→ 上游
「环比降幅的横向排序与异常品类识别」@d1。**邻居列表第一位已是前置概念**（改造前是子 KC）。

**关于难度决策的准确口径**：`prerequisite_gaps` 属于**知识类理由**，
按设计**只挡升档、不降档**（不在 `DECREASE_REASON_SET` 里，只让 `canIncrease` 返回 false）。
所以观察到的 `5→5 keep applied=false` 是**符合设计**的，不是"图没起作用"——
修复带来的变化是：这个理由**从"旧语义回落"变成了真的上游缺口**（4/8、4/6 命中）。
它当前的可观测效果是"否决加速"，不是"降低难度"。

### 1.2d 第二个断点：教学上下文里的"本课知识范围"恒空（2026-09-23 修）

用四个 demo 学习者（苏芮/李昊/孙浩/陈嘉）的真实任务调 `buildTeachingScenarioContext`，
发现 `taskKnowledgeScope` 里：

| 槽位 | 修复前 | 修复后 |
|---|---|---|
| `supportingConcepts`（图邻居） | 有（9/9、8/8…） | 有 |
| `primaryConcepts`（本课概念） | **全空 16/16** | **16/16 有值** |
| `prerequisiteConcepts`（前置） | **全空 16/16** | 有真缺口时非空（3/16） |

**两个原因叠加**：

1. `buildTaskKnowledgeSeeds`（`TeachingContextBuilder.ts`）是**恒返回 `[]` 的空桩**；
2. `subtasks.learningObjectives` **全库为空**（实测 2037/2037）。

于是 `primaryConcepts` 恒为 `[]`；而 `prerequisiteConcepts` 的过滤器是
`.filter(label => primaryConcepts.some(...))` → 空数组 `.some()` 恒 false → **结构性永远为空**。
**这是我修好的上游闭包（S4b）在下一环节被丢掉的地方**——图算出来了，没递到模型。

**修法**（三处，均为纯函数/最小改动）：

- `buildTaskKnowledgeSeeds` 改为取 `kcAnnotation.taskKcLinks`（复用既有 `resolveTaskKcsFromPath`，
  含契约漂移归一），取不到时回落任务自身的 canonical 概念（`coreConcept`/`linkedConceptName`，覆盖 100%）。
- `LearnerPrerequisiteGap` 增 `source: 'graph' | 'fallback'`，由 `LearnerKnowledgeMemoryService` 标注；
  教学侧据此区分**真上游前置**与"图缺失时的回落口径（实为本课自身薄弱概念）"。
- 抽出纯函数 `pickPrerequisiteConcepts(gaps, anchor)`：`source==='graph'` **直接采用**——
  不再做名字子串匹配，因为上游概念按定义就与本课概念**不同名**，子串过滤恰好会把它们全滤掉。
  锚点也不再只依赖 `primaryConcepts`（它曾恒空）。
- 顺带修槽位重复：`supportingConcepts` 现在同时排除 `primary` 与 `prerequisite`（前置修好后才会重复）。

**实测（陈嘉新路径，未学，故有真缺口）**：

```
primary = ["在混合积分题上按判断清单选定换元或分部并标记卡点"]
prereq  = ["被积结构与微分元的配对关系识别", "改结构（换元）与拆结构（分部）的分工边界"]
support = []
```

三个槽位互不重复（实测 `support∩prereq = []`、`support∩primary = []`）。
`primary` 恒空的副作用一并消失：`supportingConcepts` 的 `!primaryConcepts.includes(c)` 过滤
从"永远放行"变成"真的在去重"。

新增测试：`src/services/ai-teaching/__tests__/task-knowledge-seeds.test.ts`（9 条）。

**注**：`primaryConcepts` 恒空是否曾被**有意**用于 productive-failure（`determineTaskMode` 用
`persistedLearningObjectives.length === 0` 判"新概念"）——没有。那个判定读的是
`persistedLearningObjectives`，与 `primaryConcepts` 无关，故本次修复**不改变** PF 模式判定。

### 1.3 动态调整轨迹

`day-timeline`（`SimulatedDayEntry` 同时给用户级 `metrics` 与分路径 `perPath[]`）：

| 模拟日 | dayLoad | 用户级 metrics | pacing | perPath | 难度决策 |
|---|---|---|---|---|---|
| 09-02 (day0) | null | null | – | – | 无 |
| 09-03 (day1) | null | null | – | – | 3 条，全 `5→5 keep applied=false`，理由 `prerequisite_gaps` / `fragile_concepts+prerequisite_gaps` |
| 09-04 (day2) | 课1 分0 | lss=4 ktl=5.444 lf=2.81 lsb=2.634 | fast | **只有 path#1** | 1 条 `5→5 keep`，理由 `fragile_concepts/struggling_concepts/prerequisite_gaps` |

记忆：day2 痕迹 14、到期 0、稳 10；温故额度 6/已用 0。

**关键限制**：只有 path#1 写入了 committed `learning_metrics`（3 行：session-wrapup / task-completion / session_load）。
path#2/#3 有 `teaching_session` 但没有 committed learning_state。
→ 所以"用户级合并"在这次运行里**实际上只反映了 1 条路径**，跨路径的合并效果没有被真正压到。

### 1.4 跨路径

**三对路径的概念交集全部为 0**（按 canonical conceptId）。三条都属"用数据做判断"，
但 LLM 生成的 KC 词汇完全局部化 → 用户级/跨 path 的图结构无处生长。

身份覆盖倒是满的：subtasks **25/25**、memory_traces **14/14**、misconception_ledger **20/20** 都带 `conceptId`。

---

## 2. 学习者 agent 信号作用域分类（代码实证）

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

### B. 只该 path 内（路径级）——已是路径级，正确

| 信号 | 出处 |
|---|---|
| `currentPath.{milestoneProgress, taskMastery, recentEvidence}` | `teaching_sessions`/`learner_evidence` 均按 `pathId: path.id` 过滤 |
| `currentPath.conceptStates` 的任务/会话来源信号 | 由该 path 的 `subtasks` / `teaching_sessions` 生成 |
| `prerequisiteGaps`（上游闭包） | `upstreamClosure(..., {pathId})`，沿该路径 prerequisite 边走 |
| `dynamicState.lessonMetrics` | `resolveLessonState(userId, lessonScopePathId)` |
| `replanSignal` | 针对当前路径（`scope: next_milestone / downstream_path`） |
| 路径级难度基线 | `decideTaskDifficulty(...lessonMetrics...)` |

### C. 错位：名字是 global，实际只算了一条路径（**该跨而未跨**）

1. **`globalBackground.conceptLedger / recurringConfusions / blockedFoundations / transferSignals`**
   来源 `learner_evidence` 在 `build()` 里按 `pathId: path.id` 过滤（`persistedEvidence`）。
   证据：`sourcePaths: [path.id]` **字面硬编码单路径**（`LearnerKnowledgeMemoryService.ts:747`），
   而字段名是复数 `sourcePaths`、`deterministicConfusions.pattern` 文案写着"后续新目标与新路径中应视为不稳定前置"
   ——**语义明确指向跨路径，数据却只有一条路径**。
   → 后果：路径 B 里被阻塞的地基概念，不会提醒路径 A。

2. **`globalSignals.masteredConcepts / fragileConcepts / strugglingConcepts`**
   由 `conceptStates` 推导（`:646-654`）；而 `conceptStates` = **当前路径**的任务/会话信号 **+ 用户级痕迹**。
   → 名"global"实为"当前路径 + 痕迹"，**不是跨路径并集**。路径 B 里通过课堂蒸馏掌握的概念（无痕迹）不会进路径 A 的 globalSignals。

3. **`build()` 无 `learningPathId` 时的兜底是"最新一条 active 路径"**
   （`LearnerKnowledgeMemoryService.ts:199-202`，`findFirst({userId,status:'active'}, orderBy updatedAt desc)`）。
   生成新路径（path#2）时规划上下文拿到的是 **path#1**，不是并集。
   → 跨路径迁移是**偶然而非设计**，且最多覆盖一条路径。

4. **概念图 `concept_edges` 全是 `scope='path'`，`scope='user'` 零行**
   设计的用户级那一半未实现（`concept-graph.service.ts` 无写 user 级边的代码）。
   → 多路径图不连通：跨路径共享概念之间没有边。

### D. 教学现场级（teaching）——短暂，不必跨

`teachingHints`（promptEnhancement / emphasize / avoid / riskFactors）、`checkpointNeed`、
`shouldOfferBreak`、`recommendedInteraction`（hintTiming / encouragement / challenge）、SRL phase。

### E. 需要裁决（当前两处都吃，语义未定）

| 信号 | 现状 | 建议 |
|---|---|---|
| 难度基线 | `decideTaskDifficulty` 同时吃 `globalMetrics`（跨）与 `lessonMetrics`（path） | "这节课该多难"以**路径级**为准；"今天还能不能加量"以**用户级**为准 |
| `conceptLoad`（概念负荷） | 按当前路径算 | 若指"这节课的概念量"→路径级；若指"人当前能扛多少"→用户级。当前混 |

---

## 3. 结论与建议

1. **A/B 两类已经分对了**——不必大改。
2. **C 类是真正要修的**：把 `globalBackground` 四件套与 `globalSignals` 的取数从"单路径"改为"用户级并集"，
   否则"跨路径迁移"这个宣称的能力是空的。最小改法：`build()` 里对 `learner_evidence` 去掉 pathId 过滤（或并集），
   并让 `sourcePaths` 真的累积多路径。
3. **C4 是结构性缺口**：`scope='user'` 边未实现 → 多路径图不连通。要么补，要么在 UI/文档里明确"图是路径级的"。
4. **E 类需要产品裁决**，不建议擅自定。

### 实测暴露的问题与处置

5. **S4b（前置缺口 → 上游闭包）原本是空的，已修**。根因是**层级错配**：任务概念是 `concept` 级，
   而 `prerequisite` 边是 `kc→kc` 级。修法 = 物化时增加**概念级前置投影**（§1.2b），
   修后上游闭包命中 6/9、5/8、1/8（改造前 0）。
   → 剩余未命中的任务：其概念在当前路径里没有 prerequisite 结构（kc-mapper 没给）。
   这类"无图可依"与"图接错了"是两回事，不该再混为一谈。

6. **S4a 的"前置优先"原本没落地，已修**。`neighbors` 的 `limit` 截断改为按关系优先级的**确定排序**
   （改造前对 DB 行序 `slice`，返回的其实全是 `part_of` 子节点）。

7. **新发现：kc-mapper 重跑会在 `concept_edges` 里累积被覆盖版本的边**。
   实测 path#1 的 stored `kcGraph.edges` = 11，而 `kc-mapper` 物化行 = 22，
   多出的 11 条**端点不在 stored `kcGraph.nodes` 里** → 来自上一版被覆盖的 kc-mapper 输出。
   影响：图里会混入少量已作废的边（同一路径、同一领域，危害有限），但
   **A9 的"等号"口径因此失效**——已把断言 9 改成逐路径的**超集不变式**
   （"每条路径物化行数 ≥ stored 数"，即"物化未漏"），并把多出的行数单独报出来。
   要不要顺手清理作废边，属于产品裁决（可能误删合法的重规划边）。

8. **跨路径概念共享为 0**（本次 3 条路径两两零交集）。
   这不是 bug，而是"跨 path 迁移"这个能力**缺前提**：先有共享概念身份，才谈得上跨路径复用。
   `scope='user'` 边未实现（C4）之前，多路径图必然是若干不连通的簇。

9. **教学上下文的"本课知识范围"恒空，已修**（§1.2d）。`buildTaskKnowledgeSeeds` 是空桩 +
   `learningObjectives` 全库为空 ⇒ `primaryConcepts` 恒空 ⇒ 按它过滤的 `prerequisiteConcepts`
   **结构性永远为空**——上游闭包（第 5 条）修好了，却在这里被丢掉。
   修后实测 `primary` 16/16、`prereq` 有真缺口时非空（3/16），三槽位互不重复。
   → 教训：**"接了"不等于"通了"**。L3 的每一跳都要端到端验一次，单看某一跳的命中率会漏掉下游断点。


---

## 4. 图在哪儿看、长什么样（2026-09-23 UI 改造）

### 4.1 这张图反映什么

**「这个学习者在这条路径上的知识结构 + 他掌握到什么程度」**，不是课程大纲：

| 元素 | 含义 | 来源 |
|---|---|---|
| 节点（圆点） | 核心概念（`level='concept'`） | 路径规划的 coreConcept |
| 节点（圆角方块） | 知识组件（`level='kc'`） | kc-mapper 拆出的最小知识单元 |
| 实线 | **前置依赖**：先掌握左边才能学右边 | `kcGraph.edges`（KC 级）+ 概念级投影 |
| 虚线 | **归属**：知识组件属于哪个核心概念 | 由 `conceptKcs` 嵌套代码推导 |
| 颜色 | 掌握度/稳定性 | 该学习者自己的记忆痕迹（ACT-R） |
| 点的大小 | 连接度（枢纽更大） | 图内 degree |

**硬边界**：图**不是跨路径的**——路径级图只含当前路径；多路径之间目前没有跨路径边
（`scope='user'` 未实现），所以用户级聚合图会呈现为**若干个互不相连的簇**
（实测：陈嘉两条同为"定积分换元/分部"的路径，概念交集为 **0**，聚合页上就是两团分开的点）。
另外只有生成时带 `kcGraph`/`conceptKcs` 的路径才有边，老路径是空的。

### 4.2 两个入口

| 位置 | 入口 | 数据 | 作用域 |
|---|---|---|---|
| **用户侧 · 课内** | `/learn/:taskId` →「本节知识点」面板 →「列表 / 图谱」 | `GET /api/learning/concept-graph?pathId=` | **当前路径** |
| **用户侧 · 聚合页** | 顶部导航「知识图谱」→ `/knowledge-map` | 同上，**不传 pathId** | **全部路径**，可按路径筛选 |
| **Admin** | `/admin/learner-center?view=learner&id=<userId>&tab=graph` | `GET /api/admin/memory-review/:userId/concept-graph` | **用户级全部路径**，可按路径筛选 |

用户侧接口是 **self-scoped**（只读 `req.user.userId`，不接 userId 参数，防越权）。
课内那处另有一个「全部路径 →」桥接到聚合页。

### 4.3 重设计做了什么

改造前 admin 只有一个裸画布：**167 个概念 · 29 条关系**一行字，没有统计、没有筛选、
没有图例，长中文标签被截成"…"，而且图缩在画布一角。根因三条（都是代码级）：

1. **布局被反复重置**：`ResizeObserver` 每 tick 都 `setOption(..., true)`（notMerge），
   力导向布局一次次被打回起点 → 图永远不收敛、偏在一侧。
   修法：resize 只 `chart.resize()`；**只有"窄/宽档位"翻转**才重建 option。
2. **标签被截断**：`overflow:'truncate'` + `width:120` 把中文长标签全切了。
   修法：显式两行折行（`\n`）放在节点下方，不再截断（超两行才加省略号）。
3. **图例是假的**：`categories` 列的是"关系"，而节点没有 `category` 字段——
   点图例会隐藏整张图。修法：去掉画布内图例，图例改由外层用 DOM 呈现。

改造后（`MkGraphExplorer` 统一外壳，admin 与用户侧聚合页共用）：
统计条（概念/关系/已掌握/在学/脆弱/未评估，口径与画布着色一致）、
路径筛选（走接口重新请求）、层级筛选（核心概念/知识组件）、
孤立节点开关、DOM 图例、选中节点详情面板（层级/掌握度/稳定性/提取次数 + 前置/后继/所属三组关系，
点关系可跳转）。

配套后端改动：`buildGraphView` 的 `meta` 增加 `paths`（路径候选）。
候选取自**全量**边——若先按 pathId 过滤再取候选，下拉会只剩当前那一条、切过去就回不来。

---

## 5. 单路径案例：3-6 岁儿童行为判断（2026-09-23 晚收尾）

用一个**没有数据科学成分**的主题再跑一遍，验证图不只在"数据分析"这类结构性主题上成立。

- 学习者 `[case] 3-6岁儿童行为 0923`（userId=`43c65d04-60a9-4217-bd62-094fc831ecd3`，
  profileId=`79e7ccc7-9776-4283-ae7c-c8def5a180a7`）
- 路径 `lp_1790149867127_ulb8vl2`「识别社会性行为背后的指南对照关系」，3 里程碑 / 9 子任务
- 驱动：`scripts/kc-multipath-run.ts --case=children36`（新增具名 case 预设）
- 续跑：`scripts/kc-resume-case.ts --session=<id> --days=N`（**新增**，见 5.3）

### 5.1 跑完之后图上有没有东西

| 指标 | 跑课前 | 跑完 3 个模拟日（6 节课） |
|---|---|---|
| 图节点 | 16 | **21**（`kc` 18 / `concept` 3） |
| 图边 | 27 | 27（`prerequisite` 14 + `part_of` 13） |
| 记忆痕迹 | 2 | **9**，**9/9 带 `conceptId`** |
| 图中节点带掌握度 | 2/16 | **9/21** |
| 掌握度分布 | — | 已掌握 5 · 脆弱 4 · 未评估 12 |
| 已完成子任务 | 0/9 | 1/9（另有 1 在学、7 待做） |

**关键一测：痕迹 → 节点 9/9 命中**（`scripts/q-trace-join.ts --name=...`）。
即"教学产生的记忆痕迹"确实落在图上、并带出掌握度颜色——图不是装饰，
`已掌握/在学/脆弱/未评估` 四档口径与画布着色同源（`MkGraphExplorer.counts`）。

节点从 16 涨到 21：其中 4 个概念是**教学过程中新发现**的（`cpt_1790156642552_…` 等，
id 时间戳晚于路径生成），说明物化不是一次性快照。

### 5.2 L3 消费面（真跑一次，不是单测）

`scripts/kc-multipath-measure.ts`：9 个任务 **9/9 有图邻居**、**5/9 有非空上游闭包**。
闭包里出现了 2 跳链（`专业判断降维转译` ← `行为表现偏离度识别`@d1 ← `社会性行为映射`@d2），
即概念级前置投影确实被 `upstreamClosure` 吃到了（对应 1.2b 的修复）。
身份覆盖：`memory_traces` 9/9、`misconception_ledger` 22/22 带 `conceptId`。

### 5.3 中断与续跑：三个独立故障叠在一起

案例第一次跑只落了 2 条痕迹就停了，排查出**三个互不相干**的原因：

1. **会话被置 `abandoned`**（上一次跑被我手动停掉），`advance-day` 对它只会返回"未就绪"空转。
   恢复用 `POST /api/admin/virtual-learners/sessions/:id/restart-learning`——它保留 goal 与路径，
   把阶段重置回 `teaching/running`，并从**第一个未完成课程**续传，不重算路径与图。
2. **客户端 300s 掐断**：undici 默认 `headersTimeout=300s`，长教学回合在 300s 处断连，
   服务端随即 `caller_abort`（日志里是 `CALLER_ABORTED` / "请求已取消，停止 Learn 上游调用"）。
   修法是把 dispatcher 换成 `headersTimeout:0, bodyTimeout:0`——
   `kc-multipath-run.ts` 本来就有这段，`kc-resume-case.ts` 第一版漏了，补上后当天即成功。
   续跑耗时实测：day1 125s、day2 218s、day3 34s（每 2 节）。
3. **上游模型间歇性返回空补全**（见 5.5），命中时整个回合约 15 分钟才失败。

### 5.4 新发现的缺陷：误解台账不去重

跑完 6 节课后 `misconception_ledger` 攒了 **22 行**，但按语义只有约 4 个误解：

| canonicalLabel | 行数 | 不同的 hypothesisHash |
|---|---|---|
| （空） | 6 | 6 |
| 一个行为只能对应一个维度 | 12 | 12 |
| 关键词提取等同于行为复述 | 4 | 4 |

根因在 `misconception-ledger.service.ts:79`：去重键是 `(userId, conceptKey, hypothesisHash)`，
而 `hypothesisHash` 是**对原始 hypothesis 文本做 sha256**。LLM 每次换一种说法表述同一个误解
（实测同一概念下 12 条 hypothesis 文字各不相同），哈希就永远不同 → 行行新建、`occurrenceCount` 恒为 1。
`ConceptConsolidatorService` 只回填这些行的 `conceptId`，**从不合并行本身**。

后果是用户可见的：学习者看到 22 条"误解"而不是 4 条；`confidence` 也不会因为重复出现而升级
（`status` 停在 `suspected`）。这与 L1 已经解决的"两套词汇无法机械归一"是同一类问题，
只是发生在误解层——`canonicalLabel` 字段已存在但只用于展示，没有做归一。

未修（不在本轮范围）。修法方向与 L1 一致：给误解也建 canonical + alias，
或让判断方（LLM）只出可证伪的 canonical 建议、由代码归并。
→ **已于同日修复，见 §6。**

### 5.5 上游网关：会静默换模型，且会返回空补全

同一时段对网关（`AI_API_URL`，OpenAI 兼容）直接压测，实测两件事：

1. **静默替换模型**：请求 `deepseek-v4-flash`，响应体 `model` 字段有 **6/8** 次是
   `deepseek-v4.1-flash`；请求 `deepseek-v4-pro` 时也有 **4/8** 次落到 `deepseek-v4.1-flash`。
   即"配的是哪个模型"与"实际跑的是哪个"不等价——这解释了同一 prompt 质量时好时坏。
2. **空补全**（`content=""` 但 http=200）：在小 `max_tokens`（150）下 12 次里中 2 次，
   `finish_reason` 分别是 `length` 与 `tool_calls`，成因是**推理 token 吃光了输出预算**
   （`usage.completion_tokens_details.reasoning_tokens` = 150 = max_tokens）。
   按生产预算（`max_tokens=2000`、`thinking.disabled`）复测，`deepseek-v4-flash` 与
   `deepseek-v4-pro` 各 8/8 正常、中位耗时约 3.4s——**所以当前是「间歇性抖动」而不是「持续不可用」**。

网关对空补全的处理有一处会放大故障：`executor.ts:754` 只把 `finish_reason='length'` 判为
**可重试**，`tool_calls` 走 `INVALID_RESPONSE_SCHEMA` → `retryable:false` → 直接跳到
fallback（`models.config.ts:134` 声明 `deepseek-v4-flash` 的 fallback 是 `agnes-3.0-flash`），
而实测 `agnes-3.0-flash` **连续 5 次全部 45s 无响应**。
于是"一次空补全"要烧完 fallback 的 300s 超时才算失败——这正是上一轮那条
`durationMs: 900436` 的 `RETRY_BUDGET_EXHAUSTED` 的来历。

未改上游（不是本仓库的代码）。可做的两件事：把 `agnes-3.0-flash` 从 fallback 链摘掉或换掉，
以及把 `tool_calls` 空补全也纳入可重试。

### 5.6 结论

- 图**有用**：跑完课后 9/21 节点带真实掌握度、9/9 痕迹命中节点、9/9 任务有图邻居、5/9 有上游闭包。
- 图**会生长**：教学过程中新发现的概念会进图（16→21）。
- 主题无关性成立：一个纯幼教主题跑出的图结构与"数据分析"主题同构。
- 剩下的债不在图本身，而在两层：**误解台账缺少归并**（5.4）、**上游网关抖动且静默换模型**（5.5）。

---

## 6. 误解台账去重（2026-09-23 修复）

§5.4 的 22 行 → 约 4 个真误解。修复分四步，已全部落地并验证。

### 6.1 先证伪一条错误路线：词面相似度救不了

动手前先量了相似度分布（`scripts/q-miscon-sim.ts`，用仓库既有的 `lexicalSimilarity`）：

| 对照 | lexicalSimilarity |
|---|---|
| **同标签**对（同一误解的不同措辞） | **0.13 ~ 0.48** |
| **异标签**对（不同误解） | 最高 **0.26** |

两个分布重叠且**反向**——同误解可以比不同误解更不像。所以任何"相似度阈值自动归并"
都会既漏并又错并。**可靠信号只有模型产出的 `canonicalLabel`**，这也正是它在契约里的定位
（"匹配到的规范误解标签"），只是此前没有任何代码把它当身份用。

### 6.2 改动

1. **去重锚点改用标签**（`misconceptionDedupeAnchor`）：
   - 有 `canonicalLabel` → `lbl:` + 归一标签哈希；
   - 没有 → `hyp:` + 归一 hypothesis 哈希（至少吃掉标点/空白差异）。
   锚点仍写进 `hypothesisHash` 列（该列语义就是"upsert 锚点"），**不动表结构、不需要迁移**。
2. **兄弟行标签回扫 + 锚点自愈**（`findLedgerRow`）：直查未命中且本轮带标签时，回扫同概念未处理行
   按归一标签匹配；命中就把该行锚点改写为标签锚点，下一轮直查即命中。
   这样历史 hypothesis 锚点的行也能被并进来，不必等下一次归并。
3. **存量归并**（`planMisconceptionConsolidation` 纯函数 + `consolidateMisconceptions` 执行）：
   按 **(conceptKey, 归一标签)** 分组（不跨概念——台账是按概念读的）；
   winner = 最早观察到的那行，`occurrenceCount` 求和、`confidence` 取最大、`status` **只升不降**、
   `firstSeenAt` 取最小 / `lastSeenAt` 取最大、证据取最近一次。
   无标签行**只有归一文本完全相同才并**，其余原样保留并计入 `ungroupedRows`（不猜）。
4. **CLI**：`src/scripts/consolidate-misconceptions.ts`，**默认 dry-run（纯只读）**，`--apply` 才动数据。

审计：写进 `learner_projections`。**两种模式用两个键**——
`misconception-consolidation:<userId>`（apply，含被删行完整快照 = 回滚凭据）与
`misconception-consolidation-preview:<userId>`（observe）。
第一版两者共用一个键，结果"跑一次 dry-run 就把已执行归并的回滚凭据冲掉了"（实测踩到，已修）。

### 6.3 实测结果（同一个 3-6 岁案例）

| 时点 | 行数 |
|---|---|
| 修复前 | 22 |
| 归并后（删 13 行） | **9**（"一个行为只能对应一个维度" x11 → 1 行 occurrence=11；"关键词提取等同于行为复述" x4 → 1 行） |
| 再跑 2 个模拟日后 | 13（新增 4 行，**全部是标签为 null 的那一类**） |

`lbl:` 两行在后续 2 天的 4 节课里 **occurrence 未变**（4 / 11）——课没再报这两个误解，
所以锚点机制没被反向验证；但新写入的行**确实带上了 `hyp:` 前缀**，证明新代码在线上生效。

### 6.4 残留：标签为 null 的行仍会累积（**根因在 prompt，未改**）

新行全落在概念「定位行为维度对应的指南领域条目」下、`canonicalLabel` 全为 `null`。
追到契约层，是两句话互相矛盾：

- `prompts/core/teaching-turn.yaml:107`：「hypothesis 写"学生误以为…"的自由形式假设
  （**不是从标签库选择**、不是症状复述）」
- `prompts/core/teaching-turn.yaml:135`：`canonicalLabel` 是「**匹配到的规范误解标签**或 null」

字段按"有个标签库可以匹配"设计，规则却明说不要从标签库选，而 payload 里从来没给过标签库
（`scenario.priorMisconceptions` 只回了历史行的标签，历史行本身也是 null）→ 模型只能编或给 null。

**这一处没改**，因为它不是代码改动：改 `prompts/core/*.yaml` 要走 publish-core 发布流程
（`loadCoreAgentPromptSeeds` 对漂移的 core 是**跳过**而不是自动采用，见
`seed-core-agent-prompts.ts:264-277`），属于带 freeze 判官的版本化发布，需要单独决定。

**2026-09-23 19:00 追加：本轮确认「不能由我发」。** 发布入口是
`POST /api/prompt-lab/publish-core`（`routes/prompt-lab.ts:571`），闸门依次是
五块结构 → 字段冻结 → `classifyCoreEdit`（增删字段需开发确认）→ 语义冻结判官。
问题是它用 `loadCoreFile(skillId)` **从磁盘读**，而此刻
`prompts/core/teaching-turn.yaml` 上正压着**并行会话未提交的结构性改动**——
新增 `visual` 输入字段（教学配图，对应未提交的 `teaching-visual.service.ts`、
`aiTeaching.ts` 的 `images`、`V2LearningPage.vue` 的配图渲染）。
在该文件上做任何编辑或发布，都会连带把别人未完成的功能推上线（或覆盖其工作副本）。
**故本轮到此为止**：等该文件安静下来（对方提交或撤下），再把下面两处改完发布。

建议改法（两处，各一句）：

1. `prompts/core/teaching-turn.yaml:137` 的字段说明，把
   `"canonicalLabel": 匹配到的规范误解标签或 null`
   改为
   `"canonicalLabel": 规范误解标签——若 scenario.priorMisconceptions 中有语义相同的一条，**原样复用其 canonicalLabel**；确属新误解则给一个 ≤12 字的短标签（不含学生原话、不含"本轮/上次"等时间词）；确实概括不出时才为 null`
2. `prompts/core/teaching-turn.yaml:109` 规则里的
   `（不是从标签库选择、不是症状复述）`
   改为
   `（自由措辞，但必须同时在 canonicalLabel 给出可复用的短标签；不是症状复述）`
   ——括号原意是"hypothesis 别写成标签"，但读起来像"别用标签"，与字段说明正好相反。

发完之后：`npm run prompts:core:check` 必须回到全 in-sync，再跑一个模拟日看
`canonicalLabel` 是否还出 null（验收口径 = 同一概念的已报误解不再新增 `hyp:` 行）。

配套已做的一处接头（属代码范围）：`TeachingContextBuilder` 取历史误解时**补上了本课 KC 名**
（台账的 `conceptKey` 往往就是 KC 名）。此前只按三个概念槽位查，KC 粒度的误解一条都拉不到；
拉到标签才有"复用"的可能——但对本案例这批 null 行仍然无解（互相没标签可复用），
所以它治的是"有标签时复用得上"，不是这批 null 的根因。

### 6.5 门槛

- `misconception-ledger.test.ts` **23/23**（锚点/归一/分组/写路径/审计键分离/执行顺序）
- `src/services/learner/__tests__` + `ai-teaching/__tests__` + `scripts/__tests__`：**627 passed / 0 failed**
- `tsc --noEmit` 干净；`eslint` 改动文件 0 problem
  （刻意没往 `.eslintrc.json` 的 `no-explicit-any` 白名单里加新文件——deps 改成按用途命名的强类型接口）
- 新增脚本：`scripts/q-miscon.ts`、`q-miscon-sim.ts`、`q-miscon-dump.ts`、`q-audit-check.ts`、`q-audit-keys.ts`（均只读诊断）


---

## 7. 身份迁移做了但**没上**：先证伪了它的前提（2026-09-24）

### 7.1 出发点

commit `a76cbfac` 记录了重跑 kc-mapper 的风险：新旧 KC 名同名交集≈0 → 物化生成新 conceptId →
路径既有 `memory_traces` 仍指向旧概念 → 图上旧概念变"幽灵节点"。当时结论是
"要安全重跑，需要身份迁移：把新 KC 名登记为旧概念的别名（LLM 出建议 + 代码执行）"。
本轮把这条做完并**实测了它的收益**，结论是：**工具正确，但不该跑**。

### 7.2 工具（已落地，默认 dry-run）

`src/scripts/kc-identity-migrate.ts`：

1. 读旧标注的 KC 名 → `resolveConcept(createIfMissing:false)` 取旧 conceptId 与痕迹分布
2. 跑一次 kc-mapper（只取输出，不落库）→ 新 KC 名
3. **LLM 出匹配建议**（`{newKc, oldKc|null, confidence, reason}`）
4. 代码执行三道护栏 → `registerAlias(source:'backfill')`
5. 路径内清边 → 落库**已捕获的同一份标注** → 重物化
6. 复验"痕迹落图"数

为什么匹配必须过 LLM（**先证伪了代码匹配**）：字符二元组 Jaccard 实测 28 个新 KC 里
≥0.5 的只有 5 个（18%），且**分数与对错不相关**（0.263 是对的；0.188 与 0.583 指向同一个旧 KC
→ 存在碰撞）。代码匹配定不出阈值。

三道护栏（`decideAliases` 纯函数，9 条单测钉住）：**一对一**（同一旧概念只被最高置信度认领）、
**名字冲突即放弃**（新名在别处已有身份 → 登记会把两条路径的两个概念永久并成一个）、
**默认只收 high**。别名是用户级身份变更但**可回滚**：审计文件记下每条 `aliasRaw`，
回滚 = `removeAliases`（只删别名行，不动业务表）。

**一个必须记住的工程点**：apply 时**不能重跑模型**。kc-mapper 是 `temperature 0.3`，
重跑一次名字就变，登记的别名会指向一批不存在的名字。故落库用的是**匹配时捕获的那一份**标注
（为此把 `persistKcAnnotationToPath` 导出复用）。

### 7.3 实测：收益上限只有 12%，所以**没上**

13 条有痕迹路径全量 dry-run：**提出 81 条别名**，但**别名覆盖的痕迹只有个位数**。
追根因，量了"痕迹名 vs 本路径标注 KC 名"的漂移（`scripts/q-trace-name-drift.ts`）：

| 档 | 含义 | 条数 | 占比 |
|---|---|---|---|
| A | 归一化后**精确命中**标注 KC 名 | 14 | **11.9%** |
| B | 与本路径某 KC 名共享 ≥8 字公共子串（改写） | 2 | 1.7% |
| C | 都不占 | **102** | **86.4%** |

**118 条痕迹里 102 条的名字根本不在本路径标注里**，而且这与"是否被重跑过"无关
（未重跑的 `六年级追及题` 26 条痕迹只有 5 条命中；`定积分看结构定方法` 32 条只有 1 条）。

→ 身份迁移（**新标注 ↔ 旧标注**匹配）的收益天花板 = 12%。为恢复个位数条痕迹去登记
81 条**用户级永久身份合并**，风险收益比不成立。**故不 apply**；工具与单测保留，
等身份改成按 `kcId` 键控后（见下）它才是对的杠杆。

### 7.4 真正的根因在**写入侧**（本轮最重要的发现）

`SessionFinalizationService.collectReviewOutcomes` 取的是
`session.knowledgeState[].name` —— **教学模型自己写的 `knowledge.points` 名字**，
以及 `analysis.ktEstimate.conceptMastery` 的名字（`source='kt-estimate'`）。
两处都是**模型自由措辞**，再由 `resolveConceptIdSafe` 按字面解析成 conceptId。

于是漂移长这样（真实数据）：

| 痕迹名（模型写的） | 标注 KC 名 | 公共子串 |
|---|---|---|
| 判断两元素间成立的对齐关系类型 | 识别两个元素间成立的对齐关系类型 | 12 |
| 同向一前一后与相向而行的类型辨别 | 辨别同向一前一后与相向而行的方向特征 | 12 |
| 位置线的左右与前后对应约定 | （无对应） | 低 |
| 识别遗忘发生在哪一层 | （无对应） | 2 |

**为什么模型会自由措辞**：`buildTaskKnowledgeSeeds`（把 KC 名递进教学 prompt 的
`primaryConcepts`）此前是**恒返回 `[]` 的空桩**——§1.2d 已修（commit `8cdb8401`）。
所以这些老路径在教学时**从未拿到过 KC 名**，模型只能自己造。最新一条痕迹
（`2026-09-23T19:28`，`拆分主张与依据`，source=`kt-estimate`）与本路径标注名**精确相等**，
与"修好之后开始对上"一致。

**结论与建议（未实施，属新工作项）**：只要 KC 身份仍按**两次不同时刻的模型自由文本**做键，
漂移就会持续。durable 的修法是**写入侧按稳定键**——标注里每个 KC 已有 `kcId`（`kc-1a`），
`taskKcLinks` 也已经是 task→kcId 映射；让教学模型回报 `kcId`（而不是名字），
`memory_traces.conceptId` 才有稳定锚点。这是架构级改动，不在本轮范围。
