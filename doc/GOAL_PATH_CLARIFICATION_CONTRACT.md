# Goal 与 Path 的澄清契约

> 📌 类型：活规范（澄清契约的字段、服务端门控与 Path 消费方式；提示词细则以 [`goal-conversation.yaml`](../prompts/core/goal-conversation.yaml)、[`path-planning.yaml`](../prompts/core/path-planning.yaml) 为准）｜索引见 [doc/README.md](./README.md)。

## 0. 一句话结论

**Goal 负责把问题问清楚，Path 负责把问题变成路；两者之间传递的是「问题」，不是「人的类型」。**

- Goal 的产物是**澄清契约**：核心问题/张力、先验基线、停机条件、约束、假设。
- Path 的输入是**契约字段**，不再读 `entry_state / intent_type` 等身份标签。
- 「要不要问、问到什么时候停、能不能出方案」是**服务端可执行的门控**：只问会改变路径结构的问题；剩余未知不影响第一站和停机条件时就出方案。

## 1. 要解决的问题：澄清不是填槽

把 Goal 做成「收集用户信息」的表单，会把澄清降级成填槽：

- 每轮强制产出一组隐藏身份标签（`intent_type`、`entry_state`、`primary_block_type`、`support_need` …）；
- 标签落库后透传给 Path，成为路径规划的硬输入；
- 模型和下游于是「按标签生成」，而不是「按用户这句话生成」；
- 标签一旦误判，只能继续加例外规则，例外之间再互相冲突（case-driven patching）。

典型后果：用户说「学习科学，和 CLT 的关系」，系统判成「零基础兴趣读者」——基线明明写着 `unknown` 仍直接出方案，方案里还出现用户没提过的场景和交付物。

**问题不在规则不够多，而在入口的产物错了。** 入口应该产出「我们对这个学习问题的共同理解」，而不是「这个用户属于哪一类」。

## 2. 学术依据

### 2.1 澄清的判据是「够用」，不是「填满」

Clark & Brennan 的 grounding 理论：对话双方不需要对全部信息达成一致，只需达到 grounding criterion——「足以应对当前目的」。[1] 当前目的是「排一条能走的路」，所以只需澄清**会改变路径结构**的信息。停止条件不是「所有槽位都有值」，而是「剩余的不确定不再影响当前决策」。

### 2.2 只问会改变决策的问题

决策分析里的 Expected Value of Perfect Information：一条信息的价值等于「知道它之后决策的期望收益」减去「不知道它时的最优决策期望收益」；知道答案也不会改变决策，价值就是零。[2] 翻译成提问策略：

> **一个问题只有在「答案会改变提案的第一站、范围或停机条件」时才值得问。**

对话式检索的研究同向：只问一个好问题就能带来很大相对提升，但「对所有歧义都问」会显著伤害体验。[3][4]

### 2.3 问到什么程度：问题形成，而不是套目标模板

Goal-setting theory：具体、有难度且有反馈的目标比「尽力而为」更有效。[5] 但 Goal 阶段真正要做的是**问题形成**——学习者最初说的「我想学学习科学」是结构不良问题，澄清的任务是把它变成结构良好的学习问题：要解决的具体张力、当前站在哪里、什么算解决。这与逆向设计（UbD）同构：先定期望的学习结果，再定「什么证据能证明达成」，最后才设计活动。[6] Goal 的停机条件对应 UbD 的 Stage 1 + 2，Path 的路线对应 Stage 3。

### 2.4 先验基线是硬输入

认知负荷理论：内在认知负荷由「材料复杂度 × 学习者先验知识」共同决定。[7] **Expertise reversal effect**：对新手有效的教学支持（详细解释、样例、强脚手架），对高先验知识者可能变成冗余，反而增加负荷。[8] 脚手架必须是 contingent 的——按当前表现校准强度并逐步撤除。[9] 所以基线不是画像里的软字段，而是**决定第一站怎么起笔的硬输入**。用户自然说出「CLT」，这本身就是基线证据。

### 2.5 停机条件是「证据」，不是「作业」

形成性评估的要点是「用信息调整教与学」。[10] 两个设计结论：停机条件必须是**可观察的证据**；证据形式可以多样——解释、判断、作品、外部验收。**不是所有学习都必须产出现实世界的「作业」**：对「想通一个理」的目标，证据可以是「能解释核心分歧 / 把新案例放进框架」。

### 2.6 Path 怎么排

与澄清契约直接相关的四条：逆向设计；按基线调节内在负荷与支持强度（避免对高先验者重复讲基础）；脚手架 contingent、可撤除；productive failure / desirable difficulties——短期「有点难」可能带来更持久的迁移。[6][7][8][9][11][12] 检索练习、间隔、交错练习的证据支持阶段内安排「提取—间隔—变式」。[13]

### 2.7 pedagogy-first，不是 model-first

Kestin et al. 在哈佛物理课的随机对照试验：围绕教学法原则专门设计的 AI 导师，学习增益中位数超过同内容的主动学习课堂两倍，且用时更少。[14] 关键不是「AI 比老师强」，而是**收益来自教学设计**。Goal 和 Path 的价值不在「收集更多信息」，而在「把学习问题澄清到可教、可练、可验收」。

### 2.8 研究发现 → 设计约束

| 研究发现 | 对 Goal / Path 的硬约束 |
|---|---|
| Grounding 的判据是「足以应对当前目的」，不是「信息完整」[1] | 澄清的停止条件 = 剩余未知不再改变第一站/停机条件，而不是字段填满 |
| 信息价值取决于「是否改变决策」[2]；问太多会伤害体验[3][4] | 只问 plan-impact 为 `first-station` / `stopping` 的问题；其余写进 `assumptions` |
| 具体、有难度、有反馈的目标更有效[5] | 停机条件必须可观察；提案要说明「为什么这样切」 |
| 结构不良问题需要先定义目标、约束和可接受的解[6] | Goal 的产物是「问题定义」，不是「用户画像」 |
| 先验知识决定内在负荷；对高先验者的支持可能反噬[7][8] | 基线是硬输入；Path 第一站按证据分叉，不按标签分叉 |
| 脚手架是 contingent、可撤除的[9] | Path 的支持强度随阶段和表现衰减 |
| 形成性评估的核心是「用证据调整教学」[10] | 每个阶段都要有可观察证据；路径终点必须能产出停机条件的证据 |
| 短期顺畅不等于长期学会[11][12] | Path 要安排提取、变式、适度挣扎，不能把「讲清楚」当唯一目标 |
| 检索/间隔/交错练习支持长期保持[13] | 阶段内任务要包含提取与间隔 |
| 按教学法设计的 AI 导师显著优于同内容主动学习课堂[14] | 入口和路径的价值在 pedagogy-first 的设计，不在模型能力堆叠 |

## 3. 契约字段

`clarification` 随 Goal 每轮输出，类型定义见 `backend/src/services/learning/goal-clarification-contract.ts`：

```ts
interface ClarificationContract {
  core: {
    question: string | null        // 具体张力/问题，不是主题词
    evidence: string[]             // 用户原话/术语
  }
  baseline: {
    known: string[]                // 有证据的已知（术语、经历、作品、判断）
    unknown: string[]              // 明确未知；propose 回合必须为空
    misconceptions: string[]       // 有证据的误解
    evidence: string[]             // 基线证据：用户原话/具体经历，不写等级标签
  }
  stopping: {
    kind: 'explain' | 'do' | 'decide'
    scope: 'instance' | 'class'
    evidence: 'platform' | 'self' | 'external'
    statement: string | null       // 什么证据出现算「通了/解决了」
  }
  constraints: {
    timePerSessionMin?: number
    totalBudgetHours?: number
    deadline?: string
    environment?: string[]
  }
  assumptions: string[]            // 提案依赖的显式假设
  blockingNeed: 'none' | 'emotional' | 'referral'
  unknowns: Array<{
    id: string
    question: string
    planImpact: 'first-station' | 'stopping' | 'scope' | 'later'
    discriminates: string[]        // 两种（或更多）答案分别把路径带到哪
  }>
}
```

三条口径：

- `stopping.kind = explain` 时，停机证据可以是「能解释核心分歧 / 把新案例放进框架」，**不要求**现实作品；理解型目标不强行造现实任务。
- `stopping.scope = instance` 只表示「拿一份具体材料或一次真实决策来验收」，**不等于一次性操作**；`kind = decide` 的实例目标（审这份合同、判这份报表）仍要出路径。
- `stopping.evidence = external` 时，Path 可以生成训练计划，但不能假装平台能验收外部动作。

## 4. Goal 阶段规则

### 4.1 职责

Goal 只做四件事：

1. **澄清核心问题/张力**：用户到底想解决什么、想通什么、想做出什么。
2. **建立基线证据**：用户已经知道什么、做过什么、卡在哪；用证据，不用自评标签。
3. **定义停机条件**：什么证据出现时，用户会认为「通了/解决了」。
4. **判断何时可以出方案**：剩余未知不再改变第一站和停机条件时出方案，否则继续问。

不做：动机分型、人格分型、能力分型、学习风格诊断、路径规划。

### 4.2 最小充分信息集（3 + 1）

| 维度 | 要回答的问题 | 证据形式 | 为什么必须是硬输入 |
|---|---|---|---|
| **核心问题/张力** | 你想弄清/解决的具体矛盾是什么？ | 用户原话 + 一句复述确认 | 决定 Path 的第一站和阶段目标 |
| **先验基线** | 你已经知道什么、试过什么、卡在哪？ | 具体经历、术语、作品、卡点 | 决定第一站的负荷与脚手架（expertise reversal） |
| **停机条件** | 什么算「通了/解决了」？ | 可观察的证据 | 决定 Path 的终点与验收 |
| **约束** | 时间、预算、环境、截止 | 用户明示 | 决定路径体量与可行性；不改变问题本身 |

### 4.3 澄清回路

```
open ──► probe ──► propose ──► confirm
  ▲        │          │
  └────────┘          └──► 用户调整 → 回到 probe
```

- **open**：用户只给主题时，先问一个能区分第一站的具体问题（之前接触过什么 / 最近一次卡在哪 / 想弄懂到能做什么），不先问「考试/工作/兴趣」这种身份分流，也不按零基础直接猜。
- **probe**：每轮只问一个「会改变路径结构」的问题，且要能说出两种答案分别把第一站带到哪。
- **propose**：三条核心清晰，或用户明确授权「就按你的思路来」，且剩余未知只影响后续阶段时出方案。提案里的每个元素都要能回溯到用户证据，或显式标记为假设。
- **confirm**：用户确认/调整。确认后的契约就是 Path 的输入。

### 4.4 提问策略

每条问题必须满足四个条件：

1. **有决策差异**：答案不同 → 第一站/范围/停机条件不同。说不清差异的问题，不问。
2. **有证据基础**：不重复问用户已经说过的；用户说出专业术语/缩写时，把它当基线证据，而不是「需要科普」的信号。
3. **一次一个**：每轮最多一个问句；优先判别式问题，不用问卷。
4. **可放弃**：用户答不上来或不愿答时，给默认假设并继续，不追第二遍。

优先级：`第一站影响 > 停机条件影响 > 范围影响 > 后续阶段影响`。只有前两类阻止提案；后两类可以「先提案 + 写假设」。

- 反例：「这次是考试、工作要用，还是纯兴趣？」——不改变第一站，也不改变停机条件。
- 正例：「你读过 Sweller 的样例效应/元素交互吗？读过就从 2006 年那场争论切入；只是听过 CLT，就先从样例效应实验建立直觉。」——两种答案对应两条不同的第一站。

收敛纪律：连续 2–3 轮补充同类细节时优先收敛；第 3 轮起每轮必须给方向性建议；第 5 轮仍缺硬条件时把假设落进字段并进入提案，不无限追问。

### 4.5 反脑补：可追溯性

提案里每一个「用户没说过的东西」，必须是以下三者之一：**引用**（用户原话/术语/经历的直接引用或紧邻复述）、**推导**（从用户明示的约束推导，如「你说每天 30 分钟，所以每站按 25 分钟设计」）、**假设**（显式写成 `assumptions`，用户可改）。

禁止：发明用户没提过的应用场景或交付物；把「理解型」目标强行改写成「现实任务型」；用「市面上常见的学习法」这类泛化对象代替用户的具体问题；把「工作场景」当成学习目标（学习目标是用户要学的那门知识，工作只是应用背景）。

`out_of_scope` 只允许写用户本人明确提出、本轮协商延后的内容；用户没提过的主题严禁写入，没有就输出 `[]`。

### 4.6 回复声线

「字段冷、reply 热」：结构化字段按最严谨的后台判断填写；`reply` 像真人在聊天窗口里接话。

- 身份是「懂行、说话实在、不端架子的学习搭档」，不是客服或教材。
- 先接住对方的具体画面，再说人话；整轮只出现一个问号。
- `reply` 里不出现内部词（第一站/第二站、起步提案、闭环、抓手、痛点、卡点）和客服套话；换成「先搞定哪件事」「先看哪块」「卡在哪一步」。
- 没拿到具体事实前只描述听到的画面，不用经验断言替用户定性。
- 提案给出后不再问「先看哪一块」；方案讲清后不复读。
- 用户说「先去忙 / 回头再说」时一句话收口，不再提问、不下发快捷回复。

### 4.7 旧字段的现行处置

| 字段 | 现行状态 |
|---|---|
| `intent_type`、`entry_state` | 仍由提示词产出（hidden），但不再驱动提问；有契约的会话里 Path 定帧与分诊不读它们，只作兼容遥测 |
| `primary_block_type`、`support_need`、`recurrence` | 仅服务无契约的旧会话的分诊 |
| `skill_nature`、`platform_judgment` | **不在退场名单**：它们是能力物理属性（AI 能否代跑核心动作、平台能否判对错），照常产出并透传给任务层 |
| `current_baseline.level` | 只作旧链路兜底与展示；与契约证据冲突时以 `clarification.baseline` 为准 |
| `targetDiscipline` / `applicationContext` | 学科对象与应用背景分开落位；Path 的学科锚与命名以 `targetDiscipline` 为准 |

直接从提示词里删掉标签字段的试验（20 例）造成 Goal 收敛率下降，因此没有采用；**链路退场点在下游，不在 prompt 语法层。**

## 5. 服务端门控

门控不依赖模型自觉：即使模型输出了提案，服务端也会按契约把它降级为提问。判定内核是纯函数（`goal-clarification-contract.ts`），响应改写在 `goal-clarification-gate.ts`。

### 5.1 缺口清单

| 缺口 | 条件 | 级别 |
|---|---|---|
| `core.question` | 没把主题收窄成具体问题/张力 | blocking |
| `baseline.evidence` | 没有任何先验基线证据 | blocking |
| `baseline.unknown` | 基线仍有未决项，且 `unknowns` 里没有 first-station/stopping 项 | blocking |
| `stopping.statement` | 没有停机条件 | blocking |
| `unknowns.first-station` / `unknowns.stopping` | 存在会改变第一站/停机条件的未决项 | blocking |
| `unknowns.scope` | 只影响范围的未决项 | advisory |
| `constraints` | 没有时间约束（Path 按默认单次时长起步） | advisory |

### 5.2 三道闸

| 闸 | 时机 | 拦什么 | 入口函数 |
|---|---|---|---|
| **提案门控** | 模型已给出提案（或 `nextAction = propose` / stage 为 proposing、ready） | 只拦 `stopping.statement`、`baseline.unknown`、`unknowns.first-station`、`unknowns.stopping`；`core.question` 与 `baseline.evidence` 降为 advisory | `canProposeClarification` / `decideClarificationGate` |
| **确认边界** | 用户点确认或打字确认、即将绑定路径之前 | 严格口径：`core.question`、`baseline.evidence`、`stopping.statement` 齐全，且无 first-station/stopping 级未知；`baseline.unknown` 豁免 | `decideClarificationConfirmationGate` |
| **Path 入口** | 生成路径之前 | 与确认边界同一严格口径；不满足直接抛 `CLARIFICATION_REQUIRED`（422，带 gaps），不做任何落库 | `assertClarificationReadyForPath` |

提案门控放宽两项的原因：20 例实测里，把 `core.question` / `baseline.evidence` 当硬门会让已经拿到可用方案的学习者被反复要求补字段，直至离场——这正是要避免的「填表式入口」。路径需要可追溯的问题与基线，所以在确认边界和 Path 入口仍按严格口径要求。

`baseline.unknown` 的规则是为堵一个绕过口：模型曾把「会改变第一站」的未知只写进 `baseline.unknown`、不写进 `unknowns`，从而直接提案。现在它非空即视为未闭合；propose 回合里会影响第一站的写进 `unknowns`，已答清的移到 `known`，不打算问的写进 `assumptions`。已镜像进 `unknowns` 的项不重复拦，避免逼模型为了过门删掉真实的基线记录。

### 5.3 拦截时怎么改写

被拦的回合整体改写成「澄清回合」：

- `stage` / `phase` → `understanding`，`isCompleted` → false；
- `confirmedProposal` → null（前端不再出确认卡）；
- `reply` → 「在给你排方案前，我还需要确认一件事：<最高优先级的 unknown>」；没有可问的 unknown 时按缺口给兜底问句（问核心问题 / 问什么算通了 / 追问基线里那条未决项）；
- `nextQuestions` / `quickReplies` 同步替换，`runtimeEnvelope.contextUpdate.nextState` 同步改写，防止持久化层把 proposing 写回去。

### 5.4 分诊

`triageGoalResponse` 在存在契约时只按**请求属性**派生去向，不读身份标签：

- `platformJudgment = not_judgeable` → referral（一律不排路径）；
- `blockingNeed ≠ none` → 情绪支持或转介；
- `scope = instance` **且** `kind = do` **且** 没有任何基线证据 → 一次性直答（不排课）；
- 其余 → 学习路径（停机条件缺失时置信度降低，但仍可生成，由提案门控负责拦）。

判断对象是「这个请求有没有可验收的证据、是不是一次性、是不是主要需要情绪/转介」，不是「用户是谁」。

### 5.5 生效范围与回滚

- **默认开启**；`GOAL_CLARIFICATION_ENFORCE=0`（或 `false` / `off` / `no`）同时关闭 Goal 改写、确认边界与 Path 预检/审计，是唯一回滚口。
- 只有携带 `clarification` 的调用受门控约束；没有契约的旧会话、直连 `POST /paths` 保持原行为。
- DB 采用「新增契约字段、旧字段保留」的兼容写入，不做破坏性迁移。

## 6. Path 阶段规则

### 6.1 契约字段怎么被消费

| 契约字段 | Path 的消费方式 |
|---|---|
| `core.question` | 决定认知主线（`cognitiveCore`）与每个里程碑的「认知透镜」，不得退成学科目录 |
| `baseline.known / unknown / misconceptions / evidence` | 决定第一站与 `prerequisiteTree`：已知的跳过、未知的补前置；不得按身份标签推断基线 |
| `stopping.statement / evidence` | 决定最后一个里程碑的验收与路径完成条件 |
| `constraints` | 决定阶段数与单次时长 |
| `assumptions` | 写进里程碑的「待确认前提」，在第一次教学时校准 |
| `blockingNeed` | emotional / referral 时不生成纯学习路径 |
| `stopping.scope = instance` | 终点落在对该实例的判断/解释上 |
| `stopping.evidence = external` | 只做训练计划，不假装平台验收 |

### 6.2 MilestoneRationale

契约存在时，每个里程碑必须声明它服务契约的哪一条：

```ts
interface MilestoneRationale {
  serves: 'core' | 'baseline' | 'stopping' | 'constraint'
  evidence: string        // 引用契约里的哪一条
  assumes?: string        // 依赖哪个假设
}
```

最后一个里程碑必须 `serves = stopping`，否则路径终点不产出停机证据。只服务「学科完整性」而不服务核心问题的里程碑要删掉或合并。

执行分两级：

1. **带反馈重规划**：输出校验发现 rationale 缺失或终点不服务 stopping → 校验失败，带具体补写要求重试一次。
2. **落库前硬阻断**：重试后仍缺失 → 在任何 DB 写入之前抛 `CLARIFICATION_REQUIRED`，路径标 failed，不会以 active 形态交出去；`path.coordinator` 另有落库后回读审计，触发即 fail closed。

代码层只做结构检查（`auditMilestoneRationales`）；「是否真的服务了契约」由 `path-reviewer` 做语义评审。审计取数走 `aiPromptTemplate.suggestedMilestones`——里程碑表没有 `rationale` 列，落库只写白名单字段。

### 6.3 与 Path 既有机制的关系

Path 原有的三块基础设施保留，改为直接读契约：RPKT 前提递归、CLT 负荷分区、UbD 式里程碑验收。契约证据与 `current_baseline.level` 冲突时以契约证据为准。

有契约时，`entryState / intentType` 在定帧输入里置空，`pathTopologyHint` 缺省，由 `path-planning` 按契约语义判拓扑（拓扑随路径落库，是课堂层判断「起步段」的唯一信号）。提示词里的旧标签分支都标明「仅无 clarification 的旧会话」。

## 7. 风险与反方观点

1. **「没有标签，Path 怎么知道是考试还是兴趣？」** Path 需要的是 `stopping.scope`（一次 vs 一类）、`stopping.evidence`（平台/外部/自评）、`constraints`。这些是请求属性，不是人的类型。
2. **「没有标签，怎么做分诊/负向出口？」** 分诊仍然存在，但判断对象是请求：有没有可验收的证据、是不是一次性、是不是主要需要情绪/转介。
3. **「澄清轮次会不会变多？」** 会，但只在「未知会影响第一站/停机条件」时；其余情况允许「提案 + 假设」。收敛纪律保证不会无限追问。
4. **「Prompt 能保证模型不脑补吗？」** 不能。所以需要服务端门控和评测集。Prompt 负责「意图」，代码负责「边界」。
5. **「这套东西是不是又一层抽象？」** 是减法：用一组契约字段替代身份标签驱动的分支，Path 侧回到它已有的 RPKT/CLT/UbD 机制。

## 8. 验证结论

20 例 A/B（同一份 20 用例集、1 个模拟日、并发 5，两臂唯一差异是门控开关）：

| 指标 | 门控关闭 | 门控开启（默认） |
|---|---|---|
| 生成路径 | 14 / 20 | **20 / 20** |
| Goal 未收敛离场 | 6 | **0** |
| 平均阶段 / 课次 / 时长 | 2.3 / 2.6 / 0.9h | 2.3 / 2.5 / 0.9h |
| 课堂失败 / 空会话 | 0 | 0 |
| 材料目标未触发采集 | 7 | 1 |

- 默认门控没有造成路径/教学回归；Goal 收敛率与路径生成率反而提升。
- A/B 暴露的两次过度拦截已是现行规则：`core.question` / `baseline.evidence` 不作提案硬门；`scope = instance` 不直接判一次性。
- 低温采样（`temperature: 0.35`）压低「同一轮既想提案又补未知」的发散，但不能消除模型方差；门控的作用是把「未闭合却提案」变成不变量。
- **已知边界**：门控拦的是「时间点」，拦不住「脑补内容」——提案元素是否可回溯到用户证据，目前靠提示词规则，没有语义级校验。提问质量也仍取决于模型（可能问术语消歧而非基线）。1 天批次只验证「路径能否生成、课堂能否开课」，不代表多日课程的最终形状。

## 9. 算例：CLT 案例在契约下的走法

### 9.1 Goal 回合

**第一轮**：「我想学一下，学习科学」

```json
{
  "nextAction": "ask",
  "clarification": {
    "core": { "question": null, "evidence": ["我想学一下，学习科学"] },
    "baseline": { "known": [], "unknown": [], "misconceptions": [], "evidence": [] },
    "stopping": { "kind": "explain", "scope": "class", "evidence": "platform", "statement": null },
    "assumptions": [],
    "blockingNeed": "none",
    "unknowns": [
      {
        "id": "u1",
        "question": "你是想系统建立学习科学的版图，还是先弄清它和某个具体理论（比如 CLT）的关系？",
        "planImpact": "first-station",
        "discriminates": ["版图型：第一站是学科地图", "关系型：第一站是具体理论之间的张力"]
      }
    ]
  }
}
```

这是**核心问题的两种可能结构**，不是动机分型；答案会改变第一站，所以值得问。

**第二轮**：「就是学一下，我对这个感兴趣，想了解一下，和 clt 之间关系」

```json
{
  "core": {
    "question": "学习科学与 CLT 是包含关系还是冲突关系，边界在哪",
    "evidence": ["和 clt 之间关系"]
  },
  "baseline": {
    "known": ["用户主动使用 CLT 缩写"],
    "unknown": ["是否读过样例效应/元素交互", "关注学科史还是教学应用"],
    "evidence": ["用户自然说出 CLT，说明不是零基础"]
  },
  "stopping": {
    "kind": "explain", "scope": "class", "evidence": "platform",
    "statement": "能解释两者的关系，并把一个新案例放进这个框架"
  },
  "blockingNeed": "none",
  "unknowns": [
    {
      "id": "u2",
      "question": "你读过 Sweller 的样例效应/元素交互吗？",
      "planImpact": "first-station",
      "discriminates": [
        "只听过名字：第一站从样例效应实验建立直觉",
        "读过：第一站直接进入 2006 年那场争论，跳过基础"
      ]
    }
  ]
}
```

此时**不出提案**：`u2` 影响第一站，不能靠猜；提案门控会拦下「未闭合却提案」的回合。也不会出现 AI、短视频、点评学习法广告——这些都不是用户证据。

**第三轮**（假设）：「只听过名字，没读过」→ `unknowns` 清空，带一条假设出提案（字段形态示意，细则见提示词的 `confirmedProposal` 定义）：

```json
{
  "nextAction": "propose",
  "clarification": {
    "assumptions": ["先按学科史与学派争论的切面组织；若你更想偏教学设计应用，第一站可以换"],
    "baseline": { "known": ["知道 CLT 与 Sweller 的名字"], "unknown": [], "evidence": ["只听过名字，没读过"] },
    "unknowns": []
  },
  "confirmedProposal": {
    "learning_direction": "从样例效应实验建立 CLT 的直觉，再把它放回学习科学的学派版图",
    "first_deliverable": "能解释学习科学与 CLT 的关系，并把一个新案例放进这个框架说明依据",
    "key_stages": [
      "样例效应与两条前提：工作记忆有限、图式构建",
      "2006 年争论：CLT 与建构主义/探究式学习到底在争什么",
      "用一个新案例判断它站在哪一边，并说明依据"
    ],
    "out_of_scope": []
  }
}
```

`out_of_scope` 为空：用户没提过的主题不得写入。

### 9.2 Path 回合

```json
{
  "milestones": [
    {
      "title": "用样例效应实验建立 CLT 的两条前提",
      "serves": "core",
      "evidence": "core.question = 学习科学与 CLT 的关系；baseline.known = 只听过名字",
      "goal": "能用自己的话解释：为什么新手先看完整样例，反而比自己摸索学得快"
    },
    {
      "title": "把 CLT 放回学习科学的学派版图",
      "serves": "core",
      "evidence": "core.question = 包含还是冲突；2006 年争论是这一张力的公开化",
      "goal": "能说出 2006 年争论双方各自的主张，以及他们为什么互相不买账"
    },
    {
      "title": "用一个新案例做判断",
      "serves": "stopping",
      "evidence": "stopping.statement = 把新案例放进框架",
      "goal": "能选一个自己关心的学习法/教学主张，判断它更接近哪一方的假设，并说明依据"
    }
  ],
  "assumptions": ["若用户实际读过样例效应，第一站可替换为 2006 年争论"]
}
```

如果用户第三轮说「读过，想弄清学派争论」，Path 就直接从第二站起笔。这不是「标签不同」，而是**基线证据不同**导致的同一套推导结果。

## 10. 参考文献

1. Clark, H. H., & Brennan, S. E. (1991). Grounding in communication. In L. B. Resnick et al. (Eds.), *Perspectives on Socially Shared Cognition*. APA. https://worrydream.com/refs/Clark_H_1991_-_Grounding_in_Communication.pdf
2. Expected value of information (EVI/EVPI/ESVI). Analytica Docs. https://docs.analytica.com/index.php/Expected_value_of_information_--_EVI,_EVPI,_and_ESVI
3. Aliannejadi, M., et al. (2019). Asking Clarifying Questions in Open-Domain Information-Seeking Conversations. SIGIR. https://arxiv.org/html/1907.06554
4. Deciding whether to ask clarifying questions in large-scale spoken language understanding. Amazon Science. https://www.amazon.science/publications/deciding-whether-to-ask-clarifying-questions-in-large-scale-spoken-language-understanding
5. Locke, E. A., & Latham, G. P. (2002). Building a practically useful theory of goal setting and task motivation: A 35-year odyssey. *American Psychologist*, 57(9), 705–717. https://pubmed.ncbi.nlm.nih.gov/12237980
6. Wiggins, G., & McTighe, J. (2005). *Understanding by Design* (2nd ed.). ASCD. https://files.ascd.org/staticfiles/ascd/pdf/siteASCD/publications/UbD_WhitePaper0312.pdf
7. Sweller, J., van Merriënboer, J. J. G., & Paas, F. (1998). Cognitive architecture and instructional design. *Educational Psychology Review*, 10, 251–296.
8. Kalyuga, S. (2007). Expertise reversal effect and its implications for learner-tailored instruction. *Educational Psychology Review*, 19, 509–539. https://www.uky.edu/~gmswan3/EDC608/Kalyuga2007_Article_ExpertiseReversalEffectAndItsI.pdf
9. Wood, D., Bruner, J. S., & Ross, G. (1976). The role of tutoring in problem solving. *Journal of Child Psychology and Psychiatry*, 17(2), 89–100.
10. Black, P., & Wiliam, D. (1998). Inside the black box: Raising standards through classroom assessment. *Phi Delta Kappan*, 80(2), 139–148. https://fairtest.org/value-formative-assessment-pdf
11. Kapur, M. (2016). Examining productive failure, productive success, unproductive failure, and unproductive success in learning. *Educational Psychologist*, 51(2), 289–299.
12. Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning. In *Psychology and the Real World*. https://learninghub.marzanoacademies.org/blog/theory-when-learning-feels-hard-the-science-of-productive-struggle
13. Australian Education Research Organisation. Spacing and retrieval practice guide. https://www.edresearch.edu.au/guides-resources/practice-guides/spacing-and-retrieval-practice-guide-full-publication
14. Kestin, G., Miller, K., Klales, A., Milbourne, T., & Ponti, G. (2025). AI tutoring outperforms in-class active learning: An RCT introducing a novel research-based design in an authentic educational setting. *Scientific Reports*, 15, 17458. DOI: 10.1038/s41598-025-97652-6

## 11. 代码与提示词触点

| 层 | 位置 | 职责 |
|---|---|---|
| 提示词 | [`prompts/core/goal-conversation.yaml`](../prompts/core/goal-conversation.yaml) | Goal 的第一性规则、澄清契约字段、声线与收敛纪律 |
| 提示词 | [`path-planning.yaml`](../prompts/core/path-planning.yaml) · [`path-reviewer.yaml`](../prompts/core/path-reviewer.yaml) · [`path-task-design.yaml`](../prompts/core/path-task-design.yaml) | 契约优先、MilestoneRationale、旧标签分支仅限无契约会话 |
| 契约内核 | `backend/src/services/learning/goal-clarification-contract.ts` | 纯函数：`deriveClarificationGaps`、`canProposeClarification`、`decideClarificationConfirmationGate`、`assertClarificationReadyForPath`、`auditMilestoneRationales`、`isClarificationEnforceEnabled` |
| 响应改写 | `backend/src/services/learning/goal-clarification-gate.ts` | `applyClarificationGateToResponse`、`enforceClarificationGate`、`enforceClarificationConfirmationGate` |
| 服务与分诊 | `goal-conversation.service.ts` · `response-triage.ts`（同目录） | 接入门控；`triageGoalResponse` 按契约属性派生去向 |
| Path 编排 | `backend/src/coordinators/path.coordinator.ts` | `normalizeGoalRequest` 入口预检；`generate` 落库后回读审计 |
| Path 生成 | `backend/src/services/learning/generation/path-generation.core.ts` | `assertClarificationRationalesReadyForPersistence`：落库前硬阻断 |
| Skill | `backend/src/skills/path-planning/index.ts` | 输出校验时审计 rationale，缺失即带反馈重试一次 |
| 测试 | `goal-clarification-contract.test.ts`、`goal-clarification-gate.test.ts`、`path-generation.rationale.test.ts` | 门控语义、改写行为、rationale 两级防线 |
