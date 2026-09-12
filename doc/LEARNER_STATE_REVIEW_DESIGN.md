# 学习者状态评审设计（LLM 诊断层 + 可配置 BKT）

> 状态：设计草案（2026-09-12）
> 关联文档：[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)（状态层契约）、[`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)（⑯ 预测校准、LBM/CIKT）、[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)
> **硬约束**：不引入任何额外/训练模型。全部能力由 **prompt + LLM + 既有确定性代码** 实现。

---

## 0. 结论（TL;DR）

现状把「学习者画像」拆成了：**确定性状态层**（数值/聚合）+ **LLM 呈现层**（`adaptive-guidance-copy` 文案），**中间的「诊断层」缺失且不闭环**——LLM 只在最后一跳写文案，没有把证据变成可审计的判断并回写模型。

本设计补上这一段：

1. **新增一个 prompt+LLM 的诊断 skill** `learner-state-review`，事件驱动，输入是**裁剪后的投影**，输出**可证伪的结构化洞察**（带证据引用），回写并闭环到 dashboard / 教学 / replan。
2. **掌握度用时序信念更新**（可配置 BKT，4 个标量、零训练）：**LLM 负责产出观测**（逐概念 掌握/未掌握 + 证据），**代码负责更新公式**。
3. **校准闭环**：洞察里的可证伪断言落 `insight_records`，用真实结果回填命中率，反哺参数与展示（n<5 不展示置信度）。

分三步落地：**Slice 1 投影止血 → Slice 2 诊断 skill + 闭环 → Slice 3 校准与护栏**。

---

## 1. 背景与问题

### 1.1 现状盘点（LLM 已在环内，但只在两端）

| 环节 | LLM | 产物 / 去向 |
|---|---|---|
| `skills/lesson-knowledge-enricher/` | ✅ | `conceptLedger / recurringConfusions / reusable·blockedFoundations / transferSignals` → `learner_evidence`（`session-knowledge-distilled`）→ 回读进 `knowledgeMemory.globalBackground` |
| `skills/teaching-turn/`（`analysis.misconceptions`） | ✅ | → `services/learner/misconception-ledger.service.ts`（suspected→confirmed→addressed）→ 回注教学 |
| `skills/learning-predictor/` | ✅ | `stallRisk/tone/depth` → `prediction_records` → `PredictionCalibrationService` 校准 |
| `skills/adaptive-guidance-copy/` | ✅ | dashboard / learning-state 评审**文案**（只上屏，不回写） |
| `dynamicState`(lss/ktl/lf/lsb)、`learningControlState`、`replanSignal`、`LearnerStateSummary`、`taskMastery/conceptStates` | ❌ | `services/learner/LearnerSnapshotService.ts`、`LearnerKnowledgeMemoryService.ts` 阈值/权重 |

即：**状态层是确定性的，呈现层是 LLM 的，诊断层是空的。**

### 1.2 问题清单

| # | 问题 | 证据 |
|---|---|---|
| P1 | **无独立「状态评审」LLM skill**：enricher 只覆盖知识台账，misconception 来自教学回合；没有谁周期性对「当前整体状态」做归因（前置/疲劳/动机/粒度） | 全仓无 `learner-state-review` 类 skill |
| P2 | **评审不闭环**：`adaptive-guidance-copy` 输出只进快照，teaching/replan 读不到 | `DashboardGuidanceSnapshotService.ts:150` 之后无回写洞察 |
| P3 | **掌握度是拍脑袋常数**：任务完成 = `score 0.45 / learning / developing`，无时序信念更新 | `LearnerKnowledgeMemoryService.ts:229` |
| P4 | **无 guidance 投影**：把整行路径（含 `aiPromptTemplate` 12.5 万字符）与整块 `knowledgeMemory` 灌进 prompt | 实测单次 ~10.9 万 token / 130s |
| P5 | **置信度粗、校准面窄**：misconception 置信度 `0/25/50/75/100`；校准只覆盖 predictor | `misconception-ledger.service.ts:19` |

---

## 2. 设计原则

### 2.1 三层职责

| 层 | 回答 | 谁做 | 是否 LLM |
|---|---|---|---|
| **状态层**（facts） | 在哪 / 掌握多少 / 风险几档 | 确定性聚合 + 可配置信念更新 | ❌ |
| **诊断层**（why / what next） | 为什么卡：前置缺口？疲劳？动机？粒度？ | `learner-state-review` skill | ✅ |
| **呈现层**（wording） | 怎么说给用户 | `adaptive-guidance-copy`（消费洞察） | ✅ |

### 2.2 约束下的取舍

- **不训练模型**：掌握度用「LLM 观测 + 可配置 BKT 公式」，参数手填/分档/校准，不做 EM 拟合。
- **LLM 不自报掌握度置信度**：数值信念由公式给，LLM 只给观测与归因（可证伪），命中率必须带样本数 n，n<5 不展示。
- **可证伪 + 证据引用**：每条洞察必须引用输入中存在的证据；否则不输出。
- **有界上下文**：喂给 LLM 的永远是投影，不是原始快照/整行路径。
- **幂等 + 版本化**：洞察按 hash 去重，带 `promptVersion / model / generatedAt`。

---

## 3. 目标架构

```text
确定性事实：subtasks / teaching_sessions / learning_metrics / learner_evidence / misconception_ledger
        │
        ▼
LearnerSnapshotService（已有）→ LearnerSnapshot
        │
        ├─ LearnerProjectionService（扩展）
        │      ├─ toTeachingProjection（已有）
        │      ├─ toReplanProjection（已有）
        │      ├─ toReviewProjection（新增，给诊断层）
        │      └─ toGuidanceProjection（新增，给呈现层）
        │
        ├─[LLM] learner-state-review（新增）──► learner_insights（洞察，回写）
        │                                   └─► learner_concept_beliefs（BKT 信念）
        │
        ├─[代码] BKT 更新（LLM 观测 → 信念）──► learner_concept_beliefs
        │
        └─[校准] insight_records（可证伪断言 → 命中率）
                 │
                 ▼
   dashboard / learning-state 呈现（读 insights）
   TeachingContextBuilder（注入 top-N active insights）
   replan（rationale 引用 insights）
```

---

## 4. 诊断层：`learner-state-review` skill

### 4.1 定位与触发

- 类型：mainline（profile stage）或 aux（service 直调）；走 v4 机制（`prompts/core/learner-state-review.yaml` + `skills/learner-state-review/` + `executeSkill` + ACTIVE prompt 编译同步 + 遥测）。
- 触发（事件驱动，与既有刷新同源）：
  - `lesson:completed`、`task:completed`、`review:completed`
  - 手动重算：`POST /api/admin/learner-models/:userId/recompute`（可加 `withReview=1`）
  - 节流：同一 `(userId, pathId, 输入指纹)` 命中缓存/已存在洞察则跳过。

### 4.2 输入契约（投影，目标 ≤ ~2k token）

```ts
interface LearnerStateReviewInput {
  learnerDigest: {
    level: number
    metrics: { lss: number; ktl: number; lf: number; lsb: number }
    trend: 'improving' | 'stable' | 'declining'
    fatigue: 'low' | 'medium' | 'high'
    pacing: 'slow' | 'moderate' | 'fast'
    srlPhase: 'forethought' | 'performance' | 'self-reflection'
  }
  pathDigest: {
    title: string
    progressPercent: number
    currentMilestone: string
    currentTask: string
    milestonesBrief: Array<{ title: string; completed: number; total: number }>
  }
  knowledgeDigest: {
    mastered: string[]
    fragile: string[]
    struggling: string[]
    prerequisiteGaps: Array<{ label: string; reason: string; severity: 'low' | 'medium' | 'high' }>
    recentEvidence: Array<{ id: string; signal: 'mastery' | 'struggle' | 'fatigue' | 'incomplete'; concepts: string[]; at: string }>
  }
  priorInsights: Array<{ id: string; claim: string; status: 'active' | 'confirmed' | 'addressed' | 'refuted'; evidenceRefs: string[] }>
  recentWrapups: string[]  // ≤2 条
}
```

> 每个 `recentEvidence.id` 是稳定引用锚点，洞察必须引用其中的 id。

### 4.3 输出契约（严格 JSON）

```ts
interface LearnerStateReviewOutput {
  insights: Array<{
    type: 'prerequisite_gap' | 'misconception' | 'fatigue' | 'motivation' | 'granularity' | 'strategy_fit'
    claim: string
    evidenceRefs: string[]                 // 必须来自输入中的 evidence id
    confidence: number                     // 0-1，LLM 自评仅作排序，非准确率
    action: string                         // 建议动作（给教学/展示）
  }>
  conceptAssessments: Array<{
    conceptKey: string
    observed: 'mastered' | 'not'           // BKT 观测（见 §6.2）
    masteryBand: 'low' | 'medium' | 'high' // 粗档，仅展示用
    rationale: string
    evidenceRefs: string[]
  }>
  falsifiableClaims: Array<{
    claim: string
    checkOn: 'next_lesson' | 'next_task' | 'next_review'
    expect: string
  }>
  narrative: string                        // 1-2 句人话总结（LBM 式）
  reviewVersion: 1
}
```

### 4.4 prompt 护栏（写进 core.yaml）

1. 只依据输入证据；**每条 insight 必须引用 `evidenceRefs`**；证据不足则少输出，禁止编造。
2. 掌握度只给 `low/medium/high` 与 `observed: mastered|not`，**不报精确数值**。
3. 区分「观察」与「假设」；不确定的进 `falsifiableClaims`，并给出可检验的 `expect`。
4. 输出仅 JSON，无 markdown 围栏、无解释文本；低温、必要时 reasoning tier。
5. 输入里的 `priorInsights`：能延续/推翻就显式说明，不要重复造新条目。

### 4.5 存储：`learner_insights`

```prisma
model learner_insights {
  id             String   @id
  userId         String
  pathId         String?
  generatedAt    DateTime
  model          String?
  promptVersion  Int?
  inputFingerprint String                // 幂等锚
  payload        String                  // LearnerStateReviewOutput
  status         String   @default("active") // active|superseded|expired
  @@index([userId, pathId, generatedAt])
}
```

### 4.6 洞察生命周期（复用 `misconception-ledger` 模式）

- 按 `hypothesisHash = hash(userId + conceptKey + claim)` upsert；
- 生命周期：`suspected → confirmed → addressed | refuted | expired`；
- 新评审产出时：延续仍成立的、标记被推翻的、追加新的。

---

## 5. 投影层（`LearnerProjectionService` 扩展）

现状只有 `toTeachingProjection`（`TeachingContextBuilder.ts:739`）与 `toReplanProjection`（`AITeachingCoordinator.ts:2304`）。新增两个：

| 投影 | 消费者 | 关键裁剪 |
|---|---|---|
| `toReviewProjection(snapshot)` | `learner-state-review` | 只带 §4.2 的 digest；丢 `knowledgeMemory.currentPath.taskMastery/conceptStates` 全量 |
| `toGuidanceProjection(snapshot, path)` | `adaptive-guidance-copy` | 只带 state 摘要 + 当前任务 + top 概念；**丢 `learning_paths.aiPromptTemplate`（单字段 ~12.5 万字符）与完整 `knowledgeMemory`** |

**效果（实测，2026-09-12）**：真实用户单次 guidance payload `249,841 → 20,041 字符`（**−92%**，约 `11.9 万 → 9.5k token`），其中 `aiPromptTemplate` 单项丢弃 116,887 字符；`knowledgeMemory` 明细与路径冗余字段一并裁掉。如需进一步压缩，可继续收敛 `profile.narrativeInsights`、`wrapup`、`path.description/subject/replanReason`。

---

## 6. 掌握度：可配置 BKT（零训练）

### 6.1 更新公式（纯代码算术）

```text
观测"对"：P(L|对) = P(L)·(1−pS) / [P(L)·(1−pS) + (1−P(L))·pG]
观测"错"：P(L|错) = P(L)·pS   / [P(L)·pS   + (1−P(L))·(1−pG)]
传播：   P(L') = P(L|obs) + (1−P(L|obs))·pT
初始：   P(L0)
```

### 6.2 观测映射（LLM → BKT observation）

| 来源（现有信号） | 粒度 | 映射 |
|---|---|---|
| `conceptAssessments.observed` | 概念 | 直接作为 observation（主） |
| `review:completed` 结果 | 概念 | 客观「对/错」观测（优先） |
| `misconception_ledger` `addressed` | 概念 | 弱「对」观测 |
| `subtasks.status=completed` | 任务 | 弱「对」（注意「完成 ≠ 掌握」，低权重） |
| `teaching_sessions.knowledgeState.status` | 概念 | 软观测（LLM 标注，中权重） |

> 无观测时**只做传播**（`P(L') = P(L) + (1−P(L))·pT`），不凭空改。

### 6.3 参数来源与默认表（零训练）

| 参数 | 含义 | 默认 | 来源 |
|---|---|---|---|
| `p(L0)` | 初始已掌握先验 | 0.30 | 默认表；LLM 建概念时给「先验难度」分档 |
| `p(T)` | 学习率（一次机会后掌握） | 0.15 | 默认；按概念类型分档 |
| `p(G)` | 猜对（未掌握却对） | 0.25 | 由「可猜性」派生（选择题高、开放任务低） |
| `p(S)` | 失误（掌握却错） | 0.10 | 默认；行为派生（看提示/时间过短上调） |

分档建议（示例）：

| 概念难度 | p(L0) | p(T) | p(G) | p(S) |
|---|---|---|---|---|
| 易 | 0.45 | 0.25 | 0.30 | 0.08 |
| 中 | 0.30 | 0.15 | 0.25 | 0.10 |
| 难 | 0.18 | 0.10 | 0.20 | 0.12 |

参数落地形态：一个**配置常量表**（按概念难度/类型），可在 admin 只读展示、可手动覆盖。**不是模型、不训练。**

### 6.4 与纯 LLM 的取舍

- **纯 LLM**：实现最轻；但同一状态两次结论可能不同（不可复现）、成本高、易漂移。
- **可配置 BKT**：多一条公式和一张参数表，换来**时序一致、可复现、便宜、不幻觉漂移**；观测仍由 LLM 给，完全符合「prompt+LLM」约束。
- 推荐：**默认走 BKT**；若某概念长期无观测，退化为「LLM 档位直出」。

### 6.5 校准闭环：`insight_records`

```prisma
model insight_records {
  id             String   @id
  userId         String
  insightId      String
  claim          String
  checkOn        String   // next_lesson|next_task|next_review
  predictedAt    DateTime
  expected       String
  outcome        String?  // hit|miss|unknown
  checkedAt      DateTime?
  @@index([userId, checkOn])
}
```

- 命中率随样本累积：`hitRate = hits / (hits + misses)`，`reliability = null if n<5`。
- 用命中率**反推参数档位**（离线小脚本对 `p(T)/p(G)/p(S)` 做网格校准，调几个数字，不训练模型）。
- 展示纪律：n<5 不展示置信度；校准桶应单调（风险越高实际越难），非单调即评审失效信号。

---

## 7. 闭环消费

| 消费者 | 变更 |
|---|---|
| `DashboardGuidanceSnapshotService` / `LearningStateGuidanceService` | `adaptive-guidance-copy` 改为**读 `learner_insights` + `toGuidanceProjection`**，而非原始快照 |
| `TeachingContextBuilder` | 注入 top-N `active` insights（有界，建议 ≤3）到 scenario，供教学回合引用 |
| `replan` | `replanSignal.rationale` 可引用 `prerequisite_gap` 类洞察 |
| admin（`LearnerDetail.vue`） | 新增「洞察」卡片：claim / 证据 / 状态 / 命中率（n<5 显示「样本不足」） |

---

## 8. 数据模型（草案汇总）

- `learner_insights`（§4.5）：洞察版本与生命周期。
- `learner_concept_beliefs`：`userId + conceptKey → { pKnowL, lastObservedAt, evidenceCount, paramsTier }`。
- `insight_records`（§6.5）：可证伪断言 → 命中率。
- （可选）`learner_review_config`：参数表与分档覆盖。

均可复用现有 `learner_projections`/`prediction_records` 的落库与查询模式。

---

## 9. 分阶段实施

### Slice 1 · 投影止血（零新 LLM）

- `LearnerProjectionService` 增 `toGuidanceProjection`（丢 `aiPromptTemplate`/完整 `knowledgeMemory`）。
- 两个 guidance 服务改读投影。
- 复盘指标：单次刷新 prompt token、时延。
- **DoD**：实测 payload 体积下降 ≥90%（249,841 → 20,041 字符，−92%）；文案语义不变；单测覆盖投影裁剪（`LearnerProjectionService.test.ts` + 服务测试断言传入的是投影）。

### Slice 2 · 诊断 skill + 闭环

- 新增 `skills/learner-state-review/` + `prompts/core/learner-state-review.yaml`。
- 新增 `learner_insights`（或复用 projection）与事件触发（`lesson/task/review:completed`）。
- dashboard/learning-state/teaching 改消费 `insights`；`toReviewProjection`。
- **DoD**：一次课后产出结构化洞察并落库；dashboard 文案引用洞察；教学能读到 top-N。
- **进度（2026-09-12）**：**2a 已落地**——`LearnerProjectionService.toReviewProjection` + `LearnerStateReviewService`（评审载荷落 `learner_projections`，`scope=review`，`getLatest`/`refreshInBackground`，`source='rules'`）+ 单测。LLM 诊断 skill（`learner-state-review`，走 v4 aux 管线）与消费接入为 **2b**。

### Slice 3 · BKT + 校准 + 护栏

- `learner_concept_beliefs` + 可配置参数表 + 更新公式。
- `insight_records` 回填命中率、`reliability` 展示、n<5 不显。
- prompt 证据引用硬校验 + JSON schema 校验 + fallback；幂等指纹。
- **DoD**：同输入重复评审结论稳定；命中率可查；越权/无证据洞察被拒。

---

## 10. 风险与护栏

| 风险 | 护栏 |
|---|---|
| LLM 幻觉 / 无证据断言 | `evidenceRefs` 硬校验；schema 校验；无证据即丢弃 |
| 同输入结论漂移 | 低温 + 幂等指纹 + BKT 兜时序；缓存 |
| 成本/上下文膨胀 | 只喂投影；事件节流；缓存 |
| 仿真数据自证偏差 | 校准优先用**真实用户**数据；虚拟学习者数据只做冒烟 |
| 置信度误导 | LLM 自评不作为准确率；只展示实证命中率（n<5 隐藏） |
| 概念口径漂移 | 复用 `conceptKey` 归一化优先级（`LEARNER_MODEL_ARCHITECTURE.md` §9.3） |

---

## 11. 参考

- `ES-LLMS`（AIED 2026）：决策确定性、措辞交给 LLM，规则编排 + BKT + renderer。arXiv [2603.23990](https://arxiv.org/abs/2603.23990)
- `Agentic BKT`（2026）：LLM 分类 + 逐域 BKT + judge，预测效度 ≈ 3× 单 LLM。arXiv [2606.25358](https://arxiv.org/abs/2606.25358)
- `ConceptKT`（LREC 2026）：LLM 概念级缺陷诊断。arXiv [2603.24073](https://arxiv.org/abs/2603.24073)
- `Responsible-DKT`（2026）：符号规则 + 神经，低数据更优、不一致率最低。arXiv [2604.08263](https://arxiv.org/abs/2604.08263)
- `Specialised KT Outperform LLMs`（EDM 2026）：数值预测专用 KT 胜 LLM。arXiv [2603.02830](https://arxiv.org/abs/2603.02830)
- `LBM`（语言瓶颈模型）：文本化知识状态摘要。arXiv [2506.16982](https://arxiv.org/abs/2506.16982)（见 `EDUCATIONAL_THEORY_MAP.md` §四）
- `EduClaw-Bench`（2026）：30 天长程、KT 驱动模拟学习者、跨家族 LLM judge。arXiv [2608.03206](https://arxiv.org/abs/2608.03206)
- `BEAGLE`（2026）：SRL + 半马尔可夫 + 瑕疵注入 BKT + 解耦 agent。arXiv [2602.13280](https://arxiv.org/abs/2602.13280)
