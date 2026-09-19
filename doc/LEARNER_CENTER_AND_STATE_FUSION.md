# 学习者中心与状态融合（Q6 / Q7 专门说明 · 开发者向）

> **本文回答两个原始"北星"问题**（见 [`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §0.5、[`20questions/TWELVE_QUESTIONS_INVESTIGATION.md`](./20questions/TWELVE_QUESTIONS_INVESTIGATION.md) §6/§7）：
>
> - **Q6**：从学习支持服务角度来看，学习者模型更像是学习者中心；**通常有哪些需要考虑的维度，哪些是本项目特异的**？
> - **Q7**：知识或状态的**聚合、拆分、融合、评估**，**具体是怎么做到的**？
>
> **本文是什么（定位）**
> - 是**开发者文档**：解释"为什么这样拆、代码在哪、哪些没做"，服务于改造/排障，不承诺产品能力。对外能力以 `README.md` / `admin-guide.md` 为准。
> - 与 [`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md) 的分工：那篇讲 `LearnerSnapshot` 的**契约与场景设计**（what）；本文只补 Q6/Q7 特有的**维度判别**与**机制级解释**（why + how），**不重复**其快照字段表。
> - 相邻：[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md)（诊断层 + BKT + 校准闭环）、[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md)（自认边界与溯源）、[`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)（理论落点）。
>
> **诚实约定**：每条机制结论尽量带 `文件:行`。凡代码里**没有真正接线**、或只是纯函数/`test-only` 的，本文明确标 **「已实现算法，未接线」** 或 **「未实现/未核实」**，绝不用"架构上支持"糊过去。

---

## 目录

- [0. 为什么有这份文档](#0-为什么有这份文档)
- [1. 学习者模型：通用维度 vs 特异性维度](#1-学习者模型通用维度-vs-特异性维度)
  - [1.1 通用维度（任何"学习者中心"都需要）](#11-通用维度任何学习者中心都需要)
  - [1.2 本项目特异维度（为什么是它）](#12-本项目特异维度为什么是它)
  - [1.3 已实现 vs 未实现（一句话对账）](#13-已实现-vs-未实现一句话对账)
- [2. 状态的聚合与拆分](#2-状态的聚合与拆分)
  - [2.1 数据层级：原始事件 → 投影 → 概念聚合](#21-数据层级原始事件--投影--概念聚合)
  - [2.2 "拆分"发生在哪里](#22-拆分发生在哪里)
  - [2.3 增量更新：Delta 三态](#23-增量更新delta-三态)
- [3. 融合（fusion）](#3-融合fusion)
  - [3.1 总纪律：LLM 只出观测/建议，代码裁决](#31-总纪律llm-只出观测建议代码裁决)
  - [3.2 概念身份归并：真正的多源融合落地](#32-概念身份归并真正的多源融合落地)
  - [3.3 多源真值发现：算法已实现，**未接线**](#33-多源真值发现算法已实现未接线)
  - [3.4 冲突信号怎么处理](#34-冲突信号怎么处理)
- [4. 评估（evaluation）](#4-评估evaluation)
  - [4.1 "学会了吗"目前的判据](#41-学会了吗目前的判据)
  - [4.2 独立传感器：代码裁决的检查点](#42-独立传感器代码裁决的检查点)
  - [4.3 独立锚题探针（证伪，不改写）](#43-独立锚题探针证伪不改写)
  - [4.4 难度调整：从"纯阻尼"到"双向带 + 地板"](#44-难度调整从纯阻尼到双向带--地板)
  - [4.5 观察 ≠ 因果，以及"阻尼陷阱"](#45-观察--因果以及阻尼陷阱)
- [5. 与字段数据旅程（Q9 逻辑图）的关系](#5-与字段数据旅程q9-逻辑图的关系)
- [6. 已知边界与未做](#6-已知边界与未做)
- [附录 · 代码索引](#附录--代码索引)

---

## 0. 为什么有这份文档

**Q6 原话**（[`20questions/TWELVE_QUESTIONS_INVESTIGATION.md:80`](./20questions/TWELVE_QUESTIONS_INVESTIGATION.md)）：
> 从学习支持服务角度看学习者模型（通常要考虑什么 / 什么是特异的）。

**Q7 原话**（同文件 `:90`）：
> 知识/状态的聚合与拆分、融合、评估怎么做到的。

**为什么此前"少做"**：这两问的答案**散落在** `LEARNER_MODEL_ARCHITECTURE.md`（快照契约）、`EDUCATIONAL_THEORY_MAP.md`（理论落点）、`LEARNING_SCIENCE_AUDIT.md`（诚实边界）三处，没有一份**把"通用/特异"判据与"聚合→拆分→融合→评估"机制串起来**的开发者文档。
[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §0.5 把 Q6/Q7 的"剩余"列为 **"专门说明文档（此前少做）"**，§5① 与 §6 也把它列为"现在就能做/剩余可选"。**本文就是补齐这一项**。

**本文修什么**：
1. 给 Q6 一张"通用维度 → 本项目是否实现 + 证据"的对账表，并明确本项目的**特异维度**（哪些是产品私有、为什么不该照抄通用框架）。
2. 给 Q7 一条**从 append-only 事件到概念的完整数据旅程**，逐个点名真实的表/服务/纯函数，并**明确区分"已接线"与"仅算法"**。

---

## 1. 学习者模型：通用维度 vs 特异性维度

### 1.1 通用维度（任何"学习者中心"都需要）

"通用"的判据：**换一个学习产品仍然需要，且不依赖本项目的教学理念**。下表右列给出本项目落点；"落点"只写**真实接线**的位置。

| 通用维度 | 为什么通用（学习支持服务视角） | 本项目实现 | 真实证据 |
|---|---|---|---|
| **认知 / 知识状态** | 决定"教什么、补什么"：已掌握/脆弱/前置缺口 | ✅ 已实现 | `LearnerKnowledgeMemoryService.ts:83`（`globalSignals`）/ `memory_traces`（`schema.prisma:677`，`@@unique([userId, conceptKey])`）/ `concept-belief.service.ts:125` BKT |
| **元认知** | 自评准不准决定"要不要给校准反馈"；SRL 阶段决定支架 | ✅ 已实现（自评准确度 + SRL 命名） | `calibration.service.ts:20` `computeCalibrationBias`；`LearnerSnapshotService.ts:39` `deriveSrlPhase`；`types.ts:20` `selfAssessmentAccuracy` |
| **情感 / 动机** | 疲劳、焦虑、动机决定"还能不能上强度" | 🟡 部分（疲劳/情绪有，SDT 三需求/成长型思维缺） | `learning-state.service.ts` LSS/LF；`types.ts:49` `EmotionalProfile`；缺口见 `EDUCATIONAL_THEORY_MAP.md:31`（归属感缺失） |
| **行为** | 节奏、求助、坚持度影响交互设计 | 🟡 部分（有字段，部分为死默认） | `types.ts:23` `BehavioralBaseline`；`UPGRADE_DIRECTION_20Q.md:226` 指 `frustrationTolerance`/`BehavioralBaseline` 是死默认 |
| **社会 / 归属** | 同伴与归属感影响坚持 | ❌ 未建模 | `EDUCATIONAL_THEORY_MAP.md:31`：归属缺失，"peer 是教学功能非关系" |
| **时间尺度隔离**（短期状态 vs 长期特质） | 否则"今天很累"会被写进"这个人很懒" | ✅ 已实现（显式分层） | 长期：`LearnerProfileService.ts:8` `getProfile`；短期：`LearnerSnapshotService.ts:196` `getSnapshot` 的 `dynamicState`；课内：`deriveLearningControlState`（`LearnerSnapshotService.ts:65`） |
| **证据 / 来源可追溯**（provenance） | 不同来源可靠性差异极大，融合前必须知道来源 | ✅ 已实现（`evidenceType` + `confidence`） | `learner_evidence`（`schema.prisma:580`，`evidenceKey`/`evidenceType`/`confidence`）；`confidence` 按来源给（code 0.95 / model-reference 0.6，`AITeachingCoordinator.ts:1561`） |
| **学习者可见 / 可控（OLM）** | "开放学习者模型"要求学习者能看/纠自己的模型 | ❌ 未实现 | `UPGRADE_DIRECTION_20Q.md:233`：无 OLM 自述仲裁；属治理轴，不在此定位范围 |
| **量表 / 标准化测量**（Paas/NASA-TLX 等） | 让自评可与系统观测对照 | ❌ 未实现 | `EDUCATIONAL_THEORY_MAP.md` 未落量表；`UPGRADE_DIRECTION_20Q.md:234` 明确"量表/贝叶斯融合不做" |

> **判别该不该建模某个维度的口径**（本项目实际采用的）：
> ① 它是否**进决策回路**（能改变难度/排程/支架）？只展示不进回路的维度，优先级低。
> ② 它是否有**零成本证据来源**（既有事件/字段可推），还是要新基建（量表、训练模型、向量库）？后者在 MIT/Demo 定位下不做（`UPGRADE_DIRECTION_20Q.md` §1"技术栈"）。

### 1.2 本项目特异维度（为什么是它）

"特异"= **与本项目教学理念或工程约束强绑定**，换产品未必需要。

| 特异维度 | 为什么特异 | 真实证据 |
|---|---|---|
| **"真实问题澄清"起点** | 命题是"学习始于对真实问题的澄清，而非选课"；画像从 goal 对话抽取，而不是先修课程/测评 | `goal_conversations`（`schema.prisma:238`）；`LearnerModelProfile` 的 `narrativeInsights`（`types.ts:66`） |
| **运动科学负荷隐喻 LSS/KTL/LF/LSB** | 用负荷/疲劳/平衡这套自造标度驱动课堂，是产品私有口径（审计承认是工程启发式） | `learning-state.service.ts:1-19`（EWMA λ + 半衰期）；`TWELVE_QUESTIONS_INVESTIGATION.md:86` |
| **预测校准闭环** | 不信"LLM 自报置信度"，用"预测 vs 实际命中率"替代 | `prediction_records`（`schema.prisma:650`）；`PredictionCalibrationService.ts:27` |
| **记忆与画像分层**（用户级跨路径记忆 vs 路径级概念隔离） | 刻意让"遗忘不分路径"，但"知识结构分路径"，避免跨路径污染 | `ConceptConsolidatorService.ts:9-13`（分层边界）；`memory_traces` 无 `pathId` 唯一约束、`conceptLedger` 按 path 隔离 |
| **教学提示层 + 任务级难度裁决** | `taskDifficulty` 由代码判定后整体注入课堂 prompt，不让模型自行揣测难度 | `LearnerProjectionService.ts:173` `toTeachingProjection`；`TeachingContextBuilder.ts:890` |
| **真实/虚拟同表按 `userId` 隔离** | 虚拟学习者实验室是唯一验证手段，必须与真实链路同构 | `schema.prisma:677-705`（同表）；`UPGRADE_DIRECTION_20Q.md:81` |
| **纯函数 + LLM、零训练/零新基建** | 无向量库/无本地小模型；LLM 只出观测，数值由代码公式给 | `EDUCATIONAL_THEORY_MAP.md`；`concept-load.service.ts:6-7`（"LLM 出观测 + 代码算数值"）；`concept-belief.service.ts:4`（不训练模型） |

### 1.3 已实现 vs 未实现（一句话对账）

- **已实现（进决策回路）**：认知/知识状态、元认知（自评准确度 + SRL）、情感（疲劳/情绪）、行为（部分）、时间尺度隔离、证据来源、以及全部"特异维度"中的负荷标度/预测校准/记忆分层/难度裁决。
- **未实现（明确不做或待场景）**：SDT 归属感 / 成长型思维（`EDUCATIONAL_THEORY_MAP.md:31,40`）、OLM 自述仲裁与"自述覆盖推断"（`UPGRADE_DIRECTION_20Q.md:233`）、标准化量表与贝叶斯融合（`UPGRADE_DIRECTION_20Q.md:234`）、动机/情感进**升档**回路（软传感器结构上无升档路径，`TaskDifficultyAdjustmentService.ts:222-224`）。
- **半成品/死字段（诚实标注）**：`frustrationTolerance`、`BehavioralBaseline` 为死默认（`UPGRADE_DIRECTION_20Q.md:226`）；`narrativeInsights` 的若干字段是 LLM 文本，未进任何确定性判定。

---

## 2. 状态的聚合与拆分

### 2.1 数据层级：原始事件 → 投影 → 概念聚合

真实层级如下（自上而下）：

```text
① 只追加事件层   domain_event_outbox / domain_event_inbox（schema.prisma:541/569）
                 └─ LearnerEvidenceProjector.ts:11  handle()：事件 → learner_evidence + 投影计数
② 证据台账层     learner_evidence（schema.prisma:580）：append-only 事实流
                 evidenceKey / evidenceType / confidence / pathId / taskId / sessionId
③ 派生投影层     learner_projections（schema.prisma:627）：按 (projectionKey) 幂等的 JSON blob
                 scope 示例：events / beliefs / review / concept-consolidation / concept-load / insight-records
④ 概念物化层     memory_traces（schema.prisma:677）：(userId × conceptKey) 唯一一行
                 masteryScore / FSRS(state,difficulty,stability) / dueAt / ktMasteryEma
⑤ 会话/路径指标   learning_metrics（schema.prisma:295）：LSS/KTL/LF/LSB 的时序落点
⑥ 统一快照       LearnerSnapshotService.ts:196 getSnapshot() → LearnerSnapshot（契约见架构文档）
                 缓存回写：LearnerSnapshotRefreshService.ts:20 refresh()
```

**关键点**：
- ② 是**事实源**，只追加（`LearnerEvidenceProjector.ts:21`）；③④ 都是**可重建的投影**——这是把"知识/状态聚合"做在代码而非模型里的一半原因。
- ⑤ 的 LSS/KTL/LF/LSB 是**确定性的 EWMA**（`learning-state.service.ts:16-19`：KTL λ=0.95≈13.5 天、LF λ=0.70≈1.9 天），不是 LLM 产出。
- ④ 的 `memory_traces` 是**概念级物化聚合**：复习/温故的结果经 FSRS 更新后落到该行（`fsrs.ts:128` `fsrsSchedule`、`:161` `fsrsRetrievability`）。

> **关于"per-skill 聚合"的诚实说明**：系统**没有**一张"按 skill 聚合的长期状态表"。skill 维度出现在**证据的 `evidenceType`/运行用量**（如 `checkpoint:result`、`task:difficulty:adjustment`）与 `prompt_call_logs` 的运行时统计里；**长期学习状态的聚合键是 `conceptKey`（概念），不是 skill**。这是有意的：教的内容跨 skill 复用，概念才是知识结构的单位。

### 2.2 "拆分"发生在哪里

同一份 `LearnerSnapshot` 按**消费者**拆成不同投影（`LearnerProjectionService.ts`），避免"一份大对象喂所有模型"造成上下文膨胀：

| 拆分 | 消费者 | 代码 |
|---|---|---|
| `toTeachingProjection` | 教学回合（课堂 prompt） | `LearnerProjectionService.ts:173`（含 `taskDifficulty` 注入） |
| `toReplanProjection` | 路径重排 | `LearnerProjectionService.ts:229` |
| `toReviewProjection` | 状态评审诊断层 | `LearnerProjectionService.ts:126` |
| `toPlanningProjection` | **新建路径**的难度校准（冷启动无历史返回 null） | `LearnerProjectionService.ts:280` |
| `toGuidanceProjection` | dashboard / learning-state 文案 | `LearnerProjectionService.ts:54`（明确裁掉 10.9 万 token 的大字段） |

**其它切分维度**：
- **按 learner**：所有层都按 `userId`；虚拟与真实同表隔离（`schema.prisma:677-705`）。
- **按 concept**：`memory_traces` 唯一键 `(userId, conceptKey)`；`leaner_projections` 的 `beliefs` 按 `userId:pathId` 分片（`concept-belief.service.ts:136` `beliefProjectionKey`）。
- **按 path**：概念/结构层 path 内隔离，记忆层跨 path（`ConceptConsolidatorService.ts:9-13`）。
- **按 session/task**：`learner_evidence` 的 `sessionId`/`taskId` 外键；`learning_metrics` 亦可落到 task。
- **按作用域**：快照 `scope` 支持 `global | path | teaching`（`LearnerSnapshotService.ts:20`）；`deriveLearningControlState` 用**路径级** `lessonMetrics` 判"这节课难易"、用**全局**判节奏（`LearnerSnapshotService.ts:65-95`）。

### 2.3 增量更新：Delta 三态

- 语义：**缺席=不变，null=清空，输出=覆盖**（对象深合并、数组替换）。实现：`skills/goal-conversation/delta-merge.ts:4`，目前在 `goal-conversation` 试点（`prompts/core/goal-conversation.yaml:169` `deltaOutput: true`，`prompts/skills.yaml:45` 标注"试点"）。
- 其余 skill 仍是整包输出（`deltaOutput: false`）。
- 防增量漏报：`goal-conversation` 的守卫在 Delta 模式下把 `state` 缺席视为合法并回填上一轮（`skills/goal-conversation/structured-validator.ts:103,161`；`index.ts:653,718,880`）。

---

## 3. 融合（fusion）

### 3.1 总纪律：LLM 只出观测/建议，代码裁决

项目硬约束（`UPGRADE_DIRECTION_20Q.md` §1"工程纪律"）：**LLM 只出观测/建议，档位/排序/状态由代码裁决**。融合因此分成两半：

- **LLM 侧**：产出**可证伪建议**（如"这两个概念是同一个"、"这个概念的难度档是 high"）。
- **代码侧**：做**闸门校验、数值计算、落库、回滚**；模型不得自报分数（`concept-load.service.ts:6-7`）。

### 3.2 概念身份归并：真正的多源融合落地

问题：`conceptKey` 是 LLM 自由文本，同一概念多种说法，靠字符串相等对齐会碎成多条。
实现：`ConceptConsolidatorService.ts`——**LLM 出建议 + 代码执行 + 按次留档 + 可回滚**。

| 环节 | 机制 | 代码 |
|---|---|---|
| 候选投影 | 用户级跨 path 活跃概念，只带名字/次数，**不带掌握度数值**（防 LLM 编数字） | `ConceptConsolidatorService.ts:399` `buildProjection` |
| LLM 建议 | `concept-consolidator` skill 输出 `canonical/aliases/confidence/rationale` | `:481` `callSkill` |
| **越界校验** | canonical/alias 必须来自候选，否则丢弃 | `:238` |
| **把握度闸门** | `confidence ≥ 0.8` 才进 merges，否则降级 `ambiguous` | `:29` `MIN_CONFIDENCE`、`:246` |
| **词面闸门** | 词面相似度 `≥ 0.5` 才允许 P2 自动执行 | `:31` `MIN_LEXICAL_SIMILARITY`、`:256` |
| **默认观察** | 默认 `mode:'observe'`，一字不改；`apply` 才执行且只执行 `autoApplicable` | `:462-505` |
| **字段并合规则** | dueAt 取最早、mastery 取最高、`ktMasteryEma` 按观测加权、FSRS 取最稳固那条 | `:316` `buildMergedFields` |
| **按次凭据 + 回滚** | 每次执行写 `learner_evidence`（`evidenceType='concept:merge:applied'`），存胜出者整行 + 被删行整行；凭据落库失败**当场撤销**改动 | `:686` `recordMerge`、`:782-789`；回滚 `:603` `rollbackMerge` |
| 节流 | 同候选指纹 12h 内不重复调 LLM | `:471-477` |

**冲突信号（同词异义）**：候选带 `pathTitles`（归属路径），跨 path 是风险信号（`ConceptConsolidatorService.ts:426` `attachOriginPaths`）；不确定的建议落入 `ambiguous` 而非强行合并。

### 3.3 多源真值发现：算法已实现，**未接线**

`backend/src/services/learner/truth-discovery.ts` 是 Q7 里"多源加权融合"的算法实现，**纯函数、无 IO、确定性**：

- 来源权重：`code_judged 0.95 > structured_choice 0.75 > llm_inference 0.50 > self_report 0.20`（`truth-discovery.ts:44-49` `DEFAULT_SOURCE_WEIGHTS`）。
- 融合值 = `Σ(weight×value)/Σ(weight)`（`discoverTruth`，`:137`）；分歧度 = 以融合值为中心的**加权标准差**（`:159-167`）。
- 元认知校准：`metacognitiveCalibration(self, truth)` 给出带符号 `gap` + `bias`（overconfident/accurate/underconfident）（`:182`）。
- 设计意图：**"代码裁决一票否决主观声称"**——一条 code 裁决（0.95）远大于自评（0.20），自评不能凭数量/时效压过它（`:33-42`）。

> ⚠️ **必须诚实标注的关键缺口**：该模块**目前没有任何生产消费者**（`grep discoverTruth` 仅命中自身与单测 `__tests__/truth-discovery.test.ts`）。文件末尾注释明确写着"**后续接入知识状态融合（不在本模块实现）**"（`truth-discovery.ts:223-236`）。也就是说：
> - **已实现**：融合数学 + 单元测试（`1e1b0fba`）。
> - **未接线**：没有把 `checkpoint:result`/`learner-state-review`/自评各自转成 `TruthClaim`，也没有消费融合值去向 `concept-belief` 或 profile 写状态。
> - 因此 Q7 的"多源真值融合"当前是**可用的纯算法，不是运行中的回路**。

### 3.4 冲突信号怎么处理

| 冲突 | 处理 | 代码 |
|---|---|---|
| 两来源对"是否掌握"不一致 | 多源加权（设计上），代码裁决权重最高；分歧度大时降权/触发重测（**注释设计，未接线**） | `truth-discovery.ts:11-13,234` |
| 概念归并"像又不像" | 把握度/词面双闸门 + `ambiguous` 挂起 | `ConceptConsolidatorService.ts:246-257` |
| 掌握信念与状态冲突 | BKT 信念只做**有界判定**（`belief-divergence` 建议重学），**不驱动间隔/难度** | `concept-belief.service.ts:9-13` |
| 锚题证伪既有信念 | 只标 `false_mastery`/`false_struggle`，**绝不静默改写**掌握/难度/BKT | `anchor-probe.ts:16-21`；接线 `AITeachingCoordinator.ts:1677` |
| 成功率带只认独立来源 | 只采 `judgedBy='code'`，排除 `model-reference` 与简答 | `independent-success-band.service.ts:95-98` |
| 知识类信号 vs 负荷类信号 | 知识类**只挡升档**、不降档；负荷类才降档 | `TaskDifficultyAdjustmentService.ts:160-187,260-262` |
| "谁最后写谁生效" | 概念归并可回滚；状态投影幂等；`learner_evidence` 只追加 | `ConceptConsolidatorService.ts:603`；`LearnerEvidenceProjector.ts:15-18` |

真正**在运行中**的"校准"是 `calibration.service.ts:20` `computeCalibrationBias`：用 `memory_traces` 的 `masteryScore`（系统评估）对比 FSRS `stability/difficulty`（复习实际表现），样本 <5 回退 `accurate`，再把 `overconfident/underconfident` 写回画像——这是元认知校准的**已接线**版本，而非 `truth-discovery` 的 `selfValue` 版本。

---

## 4. 评估（evaluation）

### 4.1 "学会了吗"目前的判据

- **过程层**：LSS/KTL/LF/LSB + 理解度/负荷（`learning-state.service.ts`）。
- **记忆层**：`memory_traces` 的 `masteryScore` + FSRS 状态；考试目标保留率默认 0.9（`fsrs.ts:38`），到期 = `lastReview + stability` 天（`:143`）。
- **结果层（最小）**：**保持率 × 间隔**曲线（`memory/retention-curve.ts:79` `buildRetentionCurve`）。按 `elapsedDays` 分桶统计检索成功率，数据来源是既有复习结果，不新增测验（`:1-15`）。
- **独立层**：代码裁决的检查点 + 独立锚题探针（见下）。
- **未得**：标准参照后测、延迟后测、迁移测。"有没有学会"在**多数路径上仍是 LLM 自述**（`LEARNING_SCIENCE_AUDIT.md:15`、`TWELVE_QUESTIONS_INVESTIGATION.md:100`）。

### 4.2 独立传感器：代码裁决的检查点

- `judgeCheckpointAnswer`（`AITeachingCoordinator.ts:1485`）：选择题按选项集合精确判定；简答按"要点是否出现"保守判定。**有答案键才返回 `judgedBy:'code'`**，否则返回 `null`，退回模型派生并标 `model-reference`（`:1481`）。
- 结果落 `learner_evidence`（`evidenceType='checkpoint:result'`），置信度 code=0.95 / model-reference=0.6（`AITeachingCoordinator.ts:1529-1561`）。
- **答案键绝不下发**：`checkpointForMessageResult` 剥离 `correctOptionIds`/`expectedKeywords`，否则反作弊前提失效（`AITeachingCoordinator.ts:1706-1719`）。
- **成功率带**（真正的"油门"）：带 0.80–0.90、最小样本 6、回看 14 天（`independent-success-band.service.ts:21-27`）；低于带降档、高于带升档、带内或样本不足 `hold`（`:44` `evaluateSuccessBand`）。读取只认 `judgedBy='code'` 且排除 `short_answer`（`:95-98`，避免简答系统性低估触发误降档）。
- 接线：`TeachingContextBuilder.ts:910` 取 `resolveSuccessBandVerdict`，`:890` 交给 `decideTaskDifficulty`。

### 4.3 独立锚题探针（证伪，不改写）

目的：打破"教它的课也测它"的自证回路（`anchor-probe.ts:4-8`）。三条纪律（`:14-21`）：

1. **代码裁决**：探针只认 `judgedBy='code'`。
2. **只标记、不改写**：`evaluateAnchorProbeOutcome`（`:278`）只产 `falsified`+`signal`，绝不静默改 `masteryScore`/信念/难度。
3. **不与检查点抢采样**：有未完成检查点一律不投放（`:233`）。

排期闸门 `shouldRunAnchorProbe`（`:224`）：72h 最小间隔（`:32`）、最少 6 教学轮（`:34`）、自上次证伪连续 3 个探针则退避（`:40`）。
目标选择 `selectAnchorCandidates`（`:172`）：只选 `mastered`/`struggling`（`learning` 形不成可证伪预期），假掌握优先于假挣扎，`limit≤3`。
接线：`AITeachingCoordinator.ts:1592` `resolveAnchorProbeTarget`（读 `anchor:result` 证据聚合 + 过闸 + 选目标）、`:1645` `recordAnchorProbeResult`（幂等落 `anchor:result`；`falsified` 只打 warn）。

### 4.4 难度调整：从"纯阻尼"到"双向带 + 地板"

`TaskDifficultyAdjustmentService.ts:249` `decideTaskDifficulty`（纯函数，不 inline await LLM）：

- **基线确定**：`cognitiveLoad`（低/中/高→3/5/7）或 `cognitiveLevel`（认知层级→3–8），都不给则 5（`:133` `resolveBaselineLevel`）——基线不随 LLM 措辞漂移。
- **降档理由（负荷类，参与 delta）**：`lesson_stress_high / path_load_unbalanced / fatigue_high / global_imbalance / frustration_streak`（`:160-166`），合计最多 −2（`:262`）。
- **知识类理由（`fragile/struggling/prerequisite_gaps`）只挡升档、不降档**（`:183-187,225-231`）——否则"学新内容途中理由恒大于 0"会变成纯阻尼。
- **升档**：带高于上沿直接升一档（`:266-269`）；否则要求"无任何理由 + `challengeLevelCap='high'` + 上节课 LSS≤4"（`:243-247`）。
- **D_floor（最小挑战保底，防自我实现预言）**：降档最多低于基线 1 档且绝对值 ≥3（`:34-41` `resolveDifficultyFloor`）。
- **软传感只降不升**：连续受挫 ≥2 轮只降档/挡升档，结构上进不了 `canIncrease`（`:222-224,265-269`）。
- **留痕与效果**：`TaskDifficultyAdjustmentLedger.ts:22` 落 `task:difficulty:adjustment`。

### 4.5 观察 ≠ 因果，以及"阻尼陷阱"

两条必须随结论一起给出的边界：

- **观察性保持率曲线不是因果**：什么点在什么间隔被回顾由调度器（按稳定性/到期）与配额决定，与概念难度/掌握度相关，不能把"间隔越长成功率越低"直接读成因果（`retention-curve.ts:10-14`、`LEARNING_SCIENCE_AUDIT.md:264`）。要因果结论需**随机分配间隔**（MRT/E1–E3，尚未做）。
- **阻尼陷阱（历史缺陷，已部分修复）**：难度控制律曾是纯阻尼——7 条降档理由、升档要"无任何理由"永远不成立，稳态必然沉到最低档；而它的"有效"判据（同类降档理由不再出现）**几乎必然自我印证**（降档本身让状态回落）。见 `LEARNING_SCIENCE_AUDIT.md:697-702`、`TaskDifficultyAdjustmentLedger.ts:8`。修复 = 独立传感器 + 双向成功率带（§4.2）。**限定**：修复只对"跨课档位"成立，课内动态另在 skill 层。
- **弱独立要自认**：检查点的题目与答案键仍由 LLM 产出，独立的只是"评判学习者"这一步（`AITeachingCoordinator.ts:1483`）；简答按关键词判定仍是噪声源（`independent-success-band.service.ts:96-98`）。
- **BKT 参数是未拟合先验**，只用于有界判定，不驱动调度（`concept-belief.service.ts:9-13`）；已补经典约束校验（`:64` `validateBktParams`）。

---

## 5. 与字段数据旅程（Q9 逻辑图）的关系

Q9 的产出是 admin 的**「字段数据旅程（逻辑图 · 字段血缘）」**（后端 `routes/admin/platform.ts`，前端 `frontend/src/views/admin-redesign/Orchestrator.vue:45` + `DataFlowGraph.vue:58`），它回答"**字段**从哪个 skill 产出、流到哪个下游、运行时有没有真的命中"。

这些**学习状态字段的数据旅程**正是逻辑图上的节点：

| 字段 / 产物 | 产出方（逻辑图节点） | 落点 / 下游 |
|---|---|---|
| `checkpoint:result`（含 `judgedBy/passed`） | 教学回合的代码裁决 `AITeachingCoordinator.ts:1485` | `learner_evidence` → 成功率带、锚题、审计 |
| `conceptAssessments`（LLM 诊断观测） | `learner-state-review` skill | `LearnerStateReviewService.ts` → `concept-belief`（BKT） |
| 概念归并建议 `merges/ambiguous` | `concept-consolidator` skill | `ConceptConsolidatorService.ts` 校验/执行/回滚 |
| `taskDifficulty`（`adjusted/reasons/floor`） | `TaskDifficultyAdjustmentService.ts:249` | `LearnerProjectionService.ts:173` → 课堂 prompt |
| 概念档位（granularity/difficultyBand） | `concept-load-estimator` skill | `concept-load.service.ts` → `learner_projections(scope=concept-load)` |
| 快照各投影（teaching/replan/review/planning） | `LearnerProjectionService` | 对应消费者 |

**字段级运行时命中**（Q9 后半程）由三块纯函数 + 一个路由 join 组成：
- `topology/field-hit-rates.ts`（聚合 `prompt_call_logs.extractedJson` 顶层键 → produced/dead/drift）；
- `topology/topology-field-stats.ts`（把命中率贴到逻辑图字段节点与 routing 边）；
- `topology/handoff-edge-usage.ts`（哪条交接边真的在跑）；
- join 与响应：`routes/admin/platform.ts:1510`（`fieldStats`，失败降级为 null 不阻断）。

**关系一句话**：学习者状态是**图上的字段/数据**，逻辑图是**这些字段在哪、是否被消费**的运行时视图；Q7 讲的是字段**怎么被聚合/拆分/融合/评估**，Q9 讲的是字段**在编排图上怎么流动**。两者互证：逻辑图的 `dead`/`drift` 统计（`UPGRADE_DIRECTION_20Q.md:153`）能暴露"声明了但没人产出/没人消费"的状态字段。

---

## 6. 已知边界与未做

1. **多源真值发现未接线**：`truth-discovery.ts` 是纯算法 + 单测，没有消费者（`:223-236`）。当前"多源融合"在生产里由**概念归并**（身份层）与**校准服务**（自评层）分别承担，而不是统一的 truth discovery。
2. **无 per-skill 长期状态聚合**：长期状态键是 `conceptKey`，不是 skill（§2.1）。
3. **掌握判定仍大量依赖 LLM 自述**：先修/后测/迁移测缺位；只有检查点是弱独立。
4. **结果测量是观测层，非因果**：无随机实验（MRT/E1–E3），保持率曲线不能读因果（§4.5）。
5. **锚题只标记不改写**：`falsified` 不会自动触发重学/降级——需要人工或独立流程，且投放在真实模型长跑中未大规模验证。
6. **BKT 参数未拟合**：只是有人工档位的可调先验，`pKnowL` 不驱动间隔/难度。
7. **D_floor / 成功率带 / 归并阈值都是政策常量**，不是拟合结果（`TaskDifficultyAdjustmentService.ts:28-35`、`independent-success-band.service.ts:20-27`、`ConceptConsolidatorService.ts:26-35`）。
8. **未建模维度**：SDT 归属/自主/胜任、成长型思维、OLM 自述仲裁、标准化量表（§1.1）。
9. **死字段/半成品**：`frustrationTolerance`、`BehavioralBaseline` 死默认；`narrativeInsights` 未进确定性判定（§1.3）。
10. **Q8 延迟锚题复用未做**：锚题探针目前只覆盖"已掌握/挣扎"两信念（`UPGRADE_DIRECTION_20Q.md` §6）。

---

## 附录 · 代码索引

> 行号以本文写作时（2026-09-19）的仓库为准；`schema.prisma` 指 `backend/prisma/schema.prisma`。

### 学习者模型 / Q6

| 主题 | 文件:行 |
|---|---|
| 画像维度定义（cognitive/behavioral/learning/preferences/emotional/narrative） | `backend/src/agents/learner-model-agent/types.ts:15-108` |
| 画像聚合入口 | `backend/src/services/learner/LearnerProfileService.ts:8` |
| 快照服务 / 契约实现 | `backend/src/services/learner/LearnerSnapshotService.ts:196` |
| 疲劳/SRL/节奏/控制态派生 | `LearnerSnapshotService.ts:32,39,53,65` |
| 知识记忆（globalSignals / conceptLedger / prerequisiteGaps） | `backend/src/services/learner/LearnerKnowledgeMemoryService.ts:83` |
| 预测校准闭环 | `backend/src/services/learner/PredictionCalibrationService.ts:27`；`prediction_records`（`schema.prisma:650`） |
| SDT/成长型思维缺口 | `doc/EDUCATIONAL_THEORY_MAP.md:31,40` |
| OLM/量表不做 | `doc/UPGRADE_DIRECTION_20Q.md:233-234` |

### 聚合 / 拆分 / Q7

| 主题 | 文件:行 |
|---|---|
| 事件 → 证据/投影 | `backend/src/services/learner/LearnerEvidenceProjector.ts:11` |
| 快照刷新与缓存回写 | `backend/src/services/learner/LearnerSnapshotRefreshService.ts:20` |
| 投影拆分（teaching/replan/review/planning/guidance） | `backend/src/services/learner/LearnerProjectionService.ts:173,229,126,280,54` |
| 共享状态聚合 helper | `backend/src/services/learner/assemble-learning-state.ts:57` |
| LSS/KTL/LF/LSB EWMA | `backend/src/services/learning/learning-state.service.ts:1-19` |
| Delta 三态合并 | `backend/src/skills/goal-conversation/delta-merge.ts:4` |
| 证据表 / 概念物化表 / 投影表 | `schema.prisma:580,677,627`；`learning_metrics` `:295` |

### 融合

| 主题 | 文件:行 |
|---|---|
| 多源权重 + 加权融合 + 分歧度 | `backend/src/services/learner/truth-discovery.ts:44-49,137,159-167` |
| 元认知校准（自评 vs 真值） | `truth-discovery.ts:182` |
| **未接线声明** | `truth-discovery.ts:223-236` |
| 概念身份归并（建议→校验→执行→回滚） | `backend/src/services/learner/ConceptConsolidatorService.ts:399,481,238,246,316,553,603` |
| BKT 概念信念（只做有界判定） | `backend/src/services/learner/concept-belief.service.ts:4,49,125,162` |
| 已接线的校准（mastery vs FSRS） | `backend/src/services/learner/calibration.service.ts:20` |
| 同一实体的多来源冲突处理 | `ConceptConsolidatorService.ts:426`；`independent-success-band.service.ts:95-98` |

### 评估

| 主题 | 文件:行 |
|---|---|
| 代码裁决检查点 | `backend/src/services/ai-teaching/AITeachingCoordinator.ts:1485,1529,1561,1706` |
| 成功率带（双向 + 样本下限） | `backend/src/services/learner/independent-success-band.service.ts:21-27,44,69,117` |
| 独立锚题探针（选择/排期/归因） | `backend/src/services/learner/anchor-probe.ts:172,224,278` |
| 锚题接线 | `AITeachingCoordinator.ts:1592,1645,1677` |
| 难度裁决 + D_floor | `backend/src/services/learner/TaskDifficultyAdjustmentService.ts:249,34-41,160-187,243-247` |
| 难度留痕 | `backend/src/services/learner/TaskDifficultyAdjustmentLedger.ts:22` |
| 保持率曲线（观测层） | `backend/src/services/memory/retention-curve.ts:79`（边界 `:10-14`） |
| FSRS 调度与可提取率 | `backend/src/services/memory/fsrs.ts:128,161` |
| 阻尼陷阱 / 观察非因果 | `doc/LEARNING_SCIENCE_AUDIT.md:264,697-702` |

### 逻辑图（Q9）

| 主题 | 文件:行 |
|---|---|
| 字段命中率聚合 | `backend/src/services/topology/field-hit-rates.ts:1` |
| 命中率贴到逻辑图 | `backend/src/services/topology/topology-field-stats.ts:1` |
| 交接边用量 | `backend/src/services/topology/handoff-edge-usage.ts:1` |
| 路由 join + 响应 `fieldStats` | `backend/src/routes/admin/platform.ts:1510` |
| 前端逻辑图 | `frontend/src/views/admin-redesign/DataFlowGraph.vue:58`、`Orchestrator.vue:45` |
