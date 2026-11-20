# Goal 与 Path 的澄清契约

**面向原生 LLM 教育的第一性原理设计**  
版本：v0.5（2026-11-20）  
状态：Phase 3 最小闭环已生效（**默认开启**，`GOAL_CLARIFICATION_ENFORCE=0` 为回滚口）：Goal 在 first-station/stopping 缺口未闭合时强制走澄清提问；Path 的 `MilestoneRationale` 缺失先触发一次带反馈重规划，仍缺失则在落库前阻断（`CLARIFICATION_REQUIRED`，路径标 failed）。

---

## 0. 摘要

Goal 不是“收集用户信息”的表单，而是**澄清**：把学习者嘴里一个模糊的词，变成一条可被路径执行、可被证据检验的“学习问题”。Path 不是“按标签套模板”，而是把这份澄清契约翻译成一条从当前基线走到停机条件的认知路线。

本设计只做三件事：

1. **把 Goal 的产出从“分类标签”换成“澄清契约”**：核心问题/张力、先验基线、停机条件、约束、假设。
2. **把 Path 的输入从“身份标签”换成“契约字段”**：不再读 `entry_type / intent_type / skill_nature`，而是直接读核心问题、基线证据、停机条件。
3. **把“要不要问、问到什么时候停、能不能出方案”变成可计算的门控**：只问会改变路径结构的问题；剩余未知不影响第一站和停机条件时就出方案；影响就继续问。

一句话：**Goal 负责把问题问清楚，Path 负责把问题变成路；两者之间传递的是“问题”，不是“人的类型”。**

---

## 1. 问题陈述：入口不是表单，澄清不是采集

现行 Goal 契约的核心问题是**把“澄清”降级成了“填槽”**：

- 每轮强制产出 `intent_type`（8 型）、`entry_state`（2 型）、`primary_block_type`（5 型）、`support_need`（3 型）、`skill_nature`（4 型）、`platform_judgment`（3 型）等隐藏标签；
- 标签被持久化，并透传给 Path（`entryState / intentType / skillNature`），成为路径规划的硬输入；
- 标签一旦落库，模型和下游都会“按标签生成”，而不是“按用户这句话生成”；
- 每次标签误判，就在 prompt 里加一条例外；例外之间互相冲突，再加例外。2026-11-18 的外部评审已经把这件事命名为 **case-driven patching**。

实际后果（`gc_1795101266039_5uhoo12`）：

- 用户说“学习科学，和 CLT 的关系”，系统把 `entry_state` 判成 `exploratory`，按“零基础兴趣读者”出方案；
- `current_baseline.level` 明明写着 `unknown`（“用户未说明是否接触过”），系统仍然直接出提案；
- 用户没提 AI、短视频、学习法广告，方案里却出现了“AI 生成内容、短视频学习”“挑一条学习法宣传做点评”；
- 这不是模型偶然跑偏，而是契约在鼓励它：`first_deliverable` 要求可观察行为，interest 型正例就是“看到一条 AI 教育新闻，能一眼说出它底层用了哪代技术”。

**所以问题不是“规则不够多”，而是“入口的产物错了”。** 入口应该产出“我们对这个学习问题的共同理解”，而不是“这个用户属于哪一类”。

---

## 2. 学术依据

### 2.1 澄清的判据是“够用”，不是“填满”

Clark & Brennan（1991）的 grounding 理论把对话理解为双方建立共同基础的过程：参与者不需要对彼此的全部信息达成一致，只需要达到 **grounding criterion**——“我们和对方都相信，我们已经理解了彼此的意思，且足以应对当前目的”。[1]

这直接推翻了“字段填满才能收敛”的设计：

- 澄清的停止条件不是“所有槽位都有值”，而是“剩余的不确定不再影响当前决策”；
- 当前目的就是“排一条能走的路”，所以只需要澄清**会改变路径结构**的信息；
- 这与“把用户画像填完整”是两种不同的目标。

### 2.2 只问会改变决策的问题：信息价值（VOI）

决策分析里的 **Expected Value of Perfect Information（EVPI）** 给出一个简单判据：一条信息的价值，等于“知道它之后决策的期望收益”减去“不知道它时的最优决策期望收益”。如果知道答案也不会改变决策，这条信息的价值就是零。[2]

把它翻译成 Goal 的提问策略：

> **一个问题只有在“答案会改变提案的第一站、范围或停机条件”时才值得问。**

这条判据同时解决两个方向的错误：

- 不该问的： “这次是考试、工作还是纯兴趣？”——它不改变第一站的认知负荷，也不改变停机条件，信息增益极低；
- 该问的： “你读过 Sweller 的样例效应/元素交互吗？”——它直接决定第一站是从实验切入，还是从 2006 年争论切入。

对话式检索的研究也给出同向证据：在开放域信息寻求对话中，**只问一个好问题**就能带来超过 100% 的相对提升（MRR、P@1、nDCG 等指标）；但“对所有歧义都问”会显著伤害体验，因此需要判断“是否值得问”。[3][4]

### 2.3 问到什么程度：目标设定与问题形成

Goal-setting theory（Locke & Latham）的核心结论是：具体、有难度且有反馈的目标，比“尽力而为”更有效；目标的作用机制包括方向、努力、持久性和策略选择。[5]

但 Goal 阶段真正要做的不是“设定一个 SMART 目标”，而是**问题形成（problem formulation）**：

- 学习者最初说的“我想学学习科学”是一个**结构不良问题**（ill-structured problem）：目标、约束、可接受的解都没有定义；
- 澄清的任务是把它变成一个**结构良好的学习问题**：要解决的具体张力是什么、当前站在哪里、什么算解决；
- 这不是把用户塞进一个目标模板，而是和用户一起把问题“做出来”。

这与 Wiggins & McTighe 的逆向设计（UbD）同构：先明确“期望的学习结果”，再明确“什么证据能证明达成”，最后才设计学习活动。[6] Goal 的停机条件就是 UbD 的 Stage 1 + Stage 2，Path 的路线就是 Stage 3。

### 2.4 先验基线为什么必须是硬输入

认知负荷理论（CLT）与 expertise reversal effect 给出直接证据：

- 内在认知负荷由“材料复杂度 × 学习者先验知识”共同决定；同一个任务对新手是高负荷，对专家可能接近零。[7]
- **Expertise reversal effect**：对新手有效的教学支持（详细解释、样例、强脚手架），对高先验知识者可能变成冗余，反而增加负荷、降低学习效果。[8]
- ZPD / scaffolding 的传统同样要求支持是** contingent** 的：根据学习者当前表现校准支持强度，并逐步撤除。[9]

所以“先验基线”不是画像里的一个软字段，而是**决定第一站怎么起笔的硬输入**。CLT 案例里，用户自然说出“CLT”，这本身就是基线证据；系统却把它当成“零基础兴趣读者”，这是 expertise reversal 的典型误用。

### 2.5 停机条件：不是“作业”，是“证据”

Black & Wiliam 的 formative assessment 综述给出一个可操作的定义：教师和学生用来**调整教与学**的信息，就是形成性评估；高质量形成性评估对标准化测验的效应量大约在 0.4–0.7。[10]

这带来两个设计结论：

- 停机条件必须是**可观察的证据**，而不是“学完了”的主观感觉；
- 证据的形式可以多样：解释、判断、作品、外部验收。**不是所有学习都必须产出一个现实世界的“作业”。** 对于“想通一个理”的目标，证据可以是“能解释核心分歧 / 把新案例放进框架 / 画出概念关系”；强行捏造一个“点评学习法广告”的现实任务，是把形成性评估误当成“必须有的作品”。

### 2.6 Path 怎么排：从基线到停机条件的认知路线

Path 的学术依据在仓库的 `_lit-03-goal-path.md` 已有较完整的整理，这里只保留与本设计直接相关的四条：

1. **逆向设计**：先定结果与证据，再排活动。[6]
2. **认知负荷 / expertise reversal**：按基线调节内在负荷与支持强度，避免对高先验者重复讲基础。[7][8]
3. **脚手架与 ZPD**：支持是 contingent、可撤除的；不是越多越好。[9]
4. **productive failure / desirable difficulties**：短期的“有点难”可能带来更持久的迁移；不是所有顺畅的讲解都是好教学。[11][12]

此外，检索练习、间隔、交错练习的证据支持 Path 在阶段内安排“提取—间隔—变式”，而不是“讲—讲—讲”。[13]

### 2.7 原生 LLM 教育的证据： pedagogy-first，不是 model-first

Kestin et al.（2025）在哈佛物理课做的随机对照试验显示：一个围绕教学法原则专门设计的 AI 导师，相比同内容的主动学习课堂，学习增益中位数超过两倍，且用时更少。[14]

这项研究的关键不是“AI 比老师强”，而是：**收益来自教学设计，而不是模型参数量**。这正好支持“原生 LLM 教育”的入口设计：Goal 和 Path 的价值不在于“收集更多信息”，而在于“用对话把学习问题澄清到可教、可练、可验收”。

### 2.8 研究发现 → 设计约束

| 研究发现 | 对 Goal/Path 的硬约束 |
|---|---|
| Grounding 的判据是“足以应对当前目的”，不是“信息完整”[1] | 澄清的停止条件 = 剩余未知不再改变第一站/停机条件，而不是字段填满 |
| 信息价值取决于“是否改变决策”[2]；一个高质量澄清问题收益很大，但问太多会伤害体验[3][4] | 只问 plan-impact 为 `first-station` / `stopping` 的问题；其余写进 `assumptions` |
| 具体、有难度、有反馈的目标更有效；被分配的目标需要理由[5] | 停机条件必须可观察；提案要说明“为什么这样切”，不能只给结论 |
| 结构不良问题需要先定义目标、约束和可接受的解[6] | Goal 的产物是“问题定义”，不是“用户画像” |
| 先验知识决定内在负荷；对高先验者的支持可能反噬[7][8] | 基线是硬输入；Path 第一站必须按证据分叉，不能按标签分叉 |
| 脚手架是 contingent、可撤除的[9] | Path 的支持强度随阶段和表现衰减，不能全程同一套 |
| 形成性评估的核心是“用证据调整教学”[10] | 每个阶段都要有可观察证据；Path 的终点必须能产出停机条件的证据 |
| productive failure / desirable difficulties：短期顺畅不等于长期学会[11][12] | Path 不能把“讲清楚”当成唯一目标；要安排提取、变式、适度挣扎 |
| 检索/间隔/交错练习支持长期保持[13] | Path 的阶段内任务要包含提取与间隔，不是连续讲解 |
| 专门按教学法设计的 AI 导师显著优于同内容主动学习课堂[14] | 入口和路径的价值在 pedagogy-first 的设计，不在模型能力堆叠 |

---

## 3. Goal 阶段设计

### 3.1 职责

Goal 只做四件事：

1. **澄清核心问题/张力**：用户到底想解决什么、想通什么、想做出什么。
2. **建立基线证据**：用户已经知道什么、做过什么、卡在哪；用证据，不用自评标签。
3. **定义停机条件**：什么证据出现时，用户会认为“通了/解决了”。
4. **判断何时可以出方案**：剩余未知不再改变第一站和停机条件时，出方案；否则继续问。

它**不**做：动机分型、人格分型、能力分型、学习风格诊断、路径规划。

### 3.2 最小充分信息集（3 + 1）

| 维度 | 要回答的问题 | 证据形式 | 为什么必须是硬输入 |
|---|---|---|---|
| **核心问题/张力** | 你想弄清/解决的具体矛盾是什么？ | 用户原话 + 一句复述确认 | 决定 Path 的第一站和阶段目标 |
| **先验基线** | 你已经知道什么、试过什么、卡在哪？ | 具体经历、术语、作品、卡点 | 决定第一站的负荷与脚手架（expertise reversal） |
| **停机条件** | 什么算“通了/解决了”？ | 可观察的证据（解释/判断/作品/外部验收） | 决定 Path 的终点与验收 |
| **约束** | 时间、预算、环境、截止 | 用户明示 | 决定路径体量与可行性；不改变问题本身 |

三条核心 + 一条约束。**没有“动机类型”，没有“进入态”，没有“学习风格”。**

### 3.3 澄清回路

```
open ──► probe ──► propose ──► confirm
  ▲        │          │
  └────────┘          └──► 用户调整 → 回到 probe
```

- **open**：用户给出一个词/主题。系统做一次“解释性复述”（我理解你想弄清的是 X，而不是 Y），并提出一个**区分性问题**。不是“考试还是兴趣”。
- **probe**：每次只问一个“会改变路径结构”的问题。问题必须能说出“两种答案分别会把第一站带到哪里”。
- **propose**：三条核心清晰，或用户明确授权“就按你的思路来”，且剩余未知只影响后续阶段时，出方案。方案里每个元素都要能回溯到用户证据，或显式标记为假设。
- **confirm**：用户确认/调整。确认后的契约就是 Path 的输入。

### 3.4 提问策略（VOI）

每条问题必须满足四个条件：

1. **有决策差异**：答案不同 → 第一站/范围/停机条件不同。说不清差异的问题，不问。
2. **有证据基础**：不重复问用户已经说过的；用户说出专业术语/缩写时，把它当基线证据，而不是当“需要科普”的信号。
3. **一次一个**：每轮最多一个问句；优先“二选一/判别式”，而不是开放式“再具体说说”。
4. **可放弃**：用户答不上来或不愿答时，给一个默认假设并继续，不追第二遍。

问题优先级：

```
第一站影响 > 停机条件影响 > 范围影响 > 后续阶段影响
```

只有前两类阻止 `propose`；后两类可以“先提案 + 写假设”。

**反例（现行）**： “这次是考试/工作要用，还是纯兴趣？”——不改变第一站，也不改变停机条件，信息增益低。
**正例（CLT）**： “你读过 Sweller 的样例效应/元素交互吗？如果读过，我们直接从 2006 年那场争论切入；如果只是听过 CLT，我们先从样例效应实验建立直觉。”——两种答案对应两条不同的第一站。

### 3.5 提案门控（plan-impact）

不再用“类型标签”决定能不能出方案，而用**未知项的影响面**：

```ts
canPropose =
  core.question is clear
  && baseline.evidence.length > 0
  && stopping.statement is clear
  && unknowns.every(u => u.planImpact === 'later' || u.planImpact === 'scope')
```

- 如果 `unknowns` 里有 `first-station` 或 `stopping` 级别的未知 → 必须继续问；
- 如果只剩 `scope` / `later` → 可以提案，但必须在 `assumptions` 里写清楚；
- 如果用户明确说“就按你的思路来” → 允许带假设提案，但要把假设放在方案开头，用户可改。

这条门控是**服务端可执行的**：即使模型输出了 `proposal`，服务端也能根据 `unknowns` 把它降级为 `ask`。不依赖模型自觉。

### 3.6 反脑补：可追溯性

提案里的每一个“用户没说过的东西”，必须满足以下之一：

1. **引用**：用户原话/术语/经历的直接引用或紧邻复述；
2. **推导**：从用户明示的约束推导出来（如“你说每天 30 分钟，所以每站按 25 分钟设计”）；
3. **假设**：显式写成“我先假设……，如果不对你改我”。

禁止：

- 发明用户没提过的应用场景（AI、短视频、职场报告、点评广告）；
- 发明用户没提过的交付物；
- 把“理解型”目标强行改写成“现实任务型”；
- 用“市面上常见的学习法”这类泛化对象代替用户的具体问题。

### 3.7 输出契约（建议）

```ts
interface GoalTurnOutput {
  reply: string
  nextAction: 'ask' | 'propose' | 'close'

  contract: {
    core: {
      question: string | null        // 具体张力，不是主题词
      evidence: string[]             // 用户原话/术语
    }
    baseline: {
      known: string[]                // 有证据的已知
      unknown: string[]              // 明确未知
      misconceptions: string[]       // 有证据的误解
      evidence: string[]
    }
    stopping: {
      kind: 'explain' | 'do' | 'decide'
      scope: 'instance' | 'class'
      evidence: 'platform' | 'self' | 'external'
      statement: string | null
    }
    constraints: {
      timePerSessionMin?: number
      totalBudgetHours?: number
      deadline?: string
      environment?: string[]
    }
    assumptions: string[]
    blockingNeed: 'none' | 'emotional' | 'referral'
    unknowns: Array<{
      id: string
      question: string
      planImpact: 'first-station' | 'stopping' | 'scope' | 'later'
      discriminates: string[]        // 两种答案分别把路径带到哪
    }>
  }

  question?: {
    text: string
    targets: string                  // unknowns.id
  }

  proposal?: {
    direction: string
    firstStation: string
    stages: string[]
    stoppingEvidence: string
    outOfScope: string[]
    assumptions: string[]
  }

  evidence: string[]                 // 本轮引用的用户原话
}
```

注意：

- `stopping.kind = 'explain'` 时，`stoppingEvidence` 可以是“能解释核心分歧/把新案例放进框架”，**不要求**现实作品；
- `stopping.scope = 'instance'` 时（例如“今天这份表怎么填”），不应该生成学习路径，应该走一次性解答/操作；
- `stopping.evidence = 'external'` 时（需要他人验收/线下动作），Path 可以生成训练计划，但不能假装平台能验收。

### 3.8 Prompt 骨架（≤20 条规则）

1. 你的唯一任务是把学习问题澄清到可排路径；不是给方案，不是做心理分型。
2. 每轮先复述你听到的“核心张力”，再决定问还是提案。
3. 只问会改变第一站/停机条件的问题；说不清差异就不要问。
4. 一次只问一个问题；优先判别式问题，不用问卷。
5. 用户已经说过的，不重复问；用户用了专业术语，把它当基线证据。
6. 基线用证据写，不写“beginner/intermediate”标签；判不出就写 unknown。
7. 停机条件必须是可观察证据；理解型目标可以是解释/判断，不强行造现实任务。
8. 提案里的每个元素必须能回溯到用户证据，否则写成显式假设。
9. 禁止发明用户没提过的场景、工具、交付物。
10. 剩余未知只影响后续阶段时，可以提案 + 写假设；影响第一站或停机条件时，继续问。
11. 用户说“就按你的思路来”时，可以带假设提案，但要把假设放在最前面。
12. 用户答不上来时，给默认假设并继续，不追第二遍。
13. 不在 reply 里展开理论正文；提案轮最多用两句话解释“为什么这样切”。
14. 不用“考试/工作/兴趣”这类粗分型来决定提问；动机只作为理解背景，不作为分支条件。
15. 不输出 `intent_type / entry_state / skill_nature` 等身份标签；需要时只写进契约字段。
16. `stage` 只表示 clarify/propose/confirm，不表示用户类型。
17. 用户中途改口时，以最新表述为准，重写契约，不维护旧标签。
18. 提案必须写“这一版不覆盖什么”，避免用户误以为要学完整个学科。
19. 提案后不再问“先看哪一块”；第一站已经写进方案。
20. 任何不确定，宁可写进 `unknowns`，不要用编造填补。

---

## 4. Path 阶段设计

### 4.1 输入契约

Path 不再读 `learnerProfile.entryState / intentType / skillNature`。它读：

```ts
interface PathInput {
  clarification: GoalTurnOutput['contract']
  confirmedProposal: GoalTurnOutput['proposal']
  conversationEvidence: string[]
}
```

`currentBaseline` 保留，但语义改为“基线证据包”，不再是 `beginner/intermediate/advanced` 的标签。

### 4.2 从澄清到路径的推导

| 契约字段 | Path 的消费方式 |
|---|---|
| `core.question` | 决定 `cognitiveCore` 的核心概念、每个 milestone 的“认知透镜”、阶段目标 |
| `baseline.known/unknown/misconceptions` | 决定 `prerequisiteTree`、第一站难度、`loadProfile`、脚手架强度 |
| `stopping.statement/evidence` | 决定最终 milestone 的验收、`successCriteria`、路径完成条件 |
| `constraints` | 决定阶段数、单次时长、总预算、是否拆成多次 |
| `assumptions` | 写进路径的“待确认前提”，在第一次教学时校准 |
| `blockingNeed` | emotional/referral 时不生成纯学习路径，先给支持/转介 |
| `stopping.scope = instance` | 不生成学习路径，走一次性解答/操作 |
| `stopping.evidence = external` | 生成训练计划，但明确“平台不验收外部动作” |

### 4.3 路径可追溯性

每个 milestone 必须声明它服务哪个契约字段：

```ts
interface MilestoneRationale {
  serves: 'core' | 'baseline' | 'stopping' | 'constraint'
  evidence: string        // 引用契约里的哪一条
  assumes?: string        // 依赖哪个假设
}
```

Path reviewer 增加一条硬检查：

- 每个 milestone 必须至少服务 `core` 或 `stopping`；
- 如果某个 milestone 只服务“学科完整性”而不服务核心问题 → 删掉或合并；
- 如果最终 milestone 不能产出 `stopping.statement` 的证据 → 返回 `CLARIFICATION_REQUIRED`，而不是编一个验收。

### 4.4 反馈回路

Path 生成时如果发现：

- 停机条件不可观察；
- 基线证据与目标难度矛盾；
- 核心问题在现有阶段结构里无法闭环；

不静默脑补，而是返回：

```ts
{
  status: 'clarification_required',
  gaps: [{ field: 'stopping.statement', question: '...' }]
}
```

Goal 收到后，只问这一个问题，不重新走完整澄清。

### 4.5 与现有 Path 机制的关系

现有 `path-planning` 已经有三块正确的基础设施：

- **RPKT 前提递归**（`path-planning.yaml:99`）：用 `backgroundExperience/currentBaseline` 和对话历史判断前置已知/未知；
- **CLT 负荷分区**（`:101`）：按 `currentBaseline` 调节 intrinsic load；
- **UbD 式的里程碑验收**：每个 milestone 有 goal 和 evidence。

本设计不是推翻它们，而是**把上面的标签层拿掉**，让它们直接读澄清契约：

- `entryState=exploratory` 的“起步路径豁免” → 改为 `stopping.scope=class && constraints.totalBudgetHours <= 2` 的“起步契约”；
- `intent_type=exam` 的补课门禁 → 改为 `stopping.evidence=external && core.question` 的考纲覆盖检查；
- `skillNature` 的 AI 代跑边界 → 改为 `stopping.evidence` + `baseline.known` 的能力判断；
- `pathTopologyHint` 的 exam/exploratory 两值 → 改为 `stopping.scope` + `constraints` 派生，不再作为标签透传。

---

## 5. 字段减法表

| 现行字段 | 处置 | 替代 |
|---|---|---|
| `intent_type` | 退役（仅事后遥测） | `core.question` + `stopping.kind` |
| `entry_state` | 退役 | `unknowns` + `constraints` |
| `primary_block_type` | 退役 | `stopping.scope/evidence` + `blockingNeed` |
| `support_need` | 收敛为 `blockingNeed`，仅决策点使用 | `blockingNeed` |
| `skill_nature` | 退役 | `stopping.evidence` + `baseline` |
| `platform_judgment` | 退役 | `stopping.evidence` |
| `current_baseline` | 保留，改为证据包 | `baseline.known/unknown/evidence` |
| `first_deliverable` | 替换 | `stopping.statement`（explain/do/decide） |
| `learning_style` | 退役 | 不收集；教学时从行为推断 |
| `goal_orientation` | 退役 | 不收集 |
| `sdt_needs` | 退役 | 不收集；需要时在教学中观察 |
| `cognitive_bandwidth` | 退役 | 不收集；用时间约束代替 |
| `mi_frames` | 退役 | 不收集；澄清不靠动机访谈帧 |
| `motivation/urgency/pain_points` | 保留为证据，不作为槽位 | `evidence` / `constraints` |
| `needsMaterial` | 保留 | Path 的资料需求，不属于澄清核心 |

目标：`understanding` 从 8 顶层 / 48 子键，收敛到 1 个契约对象（约 12 个字段）。

---

## 6. 迁移计划

### Phase 0：设计与评测集（本稿）

- 固化本设计；
- 建 20 例评测集：包含 CLT、纯兴趣、考试、一次性操作、情绪、转介、身体技能、零基础、高先验等；
- 指标：提案接受率、澄清轮次、修改轮次、路径返工率、脑补元素率、下游教学匹配度。

### Phase 1：契约并行（feature flag）

- Goal 输出增加 `contract / nextAction / unknowns`，旧字段保留但不再驱动新逻辑；
- 服务端增加 `canPropose` 门控：`nextAction=propose` 但存在 first-station/stopping 级未知 → 降级为 ask；
- 不改 Path，先观察 Goal 行为。

**2026-11-20 已完成（shadow 版）**：

- `prompts/core/goal-conversation.yaml` 增加 `clarification` / `nextAction`（shadow 观测，提示词明确“不改变本轮提问/提案策略”）；
- `skills/goal-conversation` 透传这两个字段，不参与 stage / 提案门禁；
- `goal-conversation.service.logClarificationShadow` 只在“已有提案但契约拦截”时写 warn 日志，不改回复、不改阶段、不改持久化；
- CLT 两轮真机重放：旧契约仍 `proposing + proposal=true`，新契约 `allowed=false`、`blocking=unknowns.first-station`，证明“本应拦截”成立（详见 §9.3）。

### Phase 2：enforce + Path 契约（2026-11-20 已完成）

- **开关**：Phase 2 时曾为 `GOAL_CLARIFICATION_ENFORCE=1` 显式开启；Phase 3 起**默认开启**，`GOAL_CLARIFICATION_ENFORCE=0` 为回滚口。
- **Goal 门控**：`goal-clarification-gate.ts` 在提案存在且契约拦截时，把本轮改写为澄清回合：
  - `internal.core.stage` / `runtimeEnvelope.businessState.phase` → `understanding`；
  - `confirmedProposal` → `null`（前端不再出确认卡）；
  - `reply` → 最高优先级 `unknown` 的提问（带“在给你排方案前，我还需要确认一件事”前缀）；
  - `runtimeEnvelope.contextUpdate.nextState` 同步改写，防止持久化层把 proposing 写回去。
- **Path 契约**：`GoalPathRequest.clarification` → `PathGenerationInput.clarification` → `normalizedInput.clarification`；
  - `normalizeGoalRequest` 默认调用 `assertClarificationReadyForPath`，契约不完整直接抛 `CLARIFICATION_REQUIRED`（422，带 gaps）；
  - `path-planning` 新增“澄清契约优先”与 `MilestoneRationale` 规则：每个 milestone 声明 `serves=core|baseline|stopping|constraint`，最后一个必须 `serves=stopping`；
  - `path-task-design` 读 `normalizedInput.clarification` 决定 acquire/execute 与最终验收；
  - `path-reviewer` 在契约存在时审计 rationale，不再用 exploratory 起步豁免绕过；
  - 审计取数走 `aiPromptTemplate.suggestedMilestones`：`milestones` 表没有 `rationale` 列，`persistGeneratedPath` 只写白名单字段；若读 DB milestones，审计会恒报「缺少 rationale」。`path-reviewer` 的 `goalContext.clarification` 也由同一份定帧输入透传，保证 Integrity 规则不是死引用。
- **A/B（同一份真实模型输出）**：见 §9.4。

### Phase 3：最小闭环（2026-11-20 已完成）

- **Goal 默认澄清**：门控默认开启；CLT 第二轮（附录 B）在默认配置下（不设任何 env）由 `proposing + 学习法广告式交付物` 改写为 `understanding + 问 u2`，单测钉死（`goal-clarification-gate.test.ts`）。
- **Path 重规划**：`path-planning.validateParsedOutput` 在契约存在时审计 rationale；缺失/终点不服务 stopping → 校验失败，`retryStrategy` 带具体补写要求重试一次（现有 `maxAttempts=2`）。
- **Path 硬阻断**：重试后仍缺失 → `persistGeneratedPath` 在做任何 DB 写入前抛 `CLARIFICATION_REQUIRED`，core run 标 failed，不再落一条 active 的不可追溯路径；`path.coordinator` 保留落库后回读审计，异常触发时同样阻断并把路径标 failed。
- **默认生效的边界**：只有传了 `clarification` 的调用方受门控/审计影响；旧会话、直连 `POST /paths`（无契约）保持原行为。
- **回滚**：`GOAL_CLARIFICATION_ENFORCE=0` 同时关闭 Goal 改写与 Path 预检/审计。

### Phase 4：旧标签链路退场（2026-11-20 已完成）

- **Path 边界退场**：`buildFramedNormalizedInput` 在 `clarification` 存在时把 `entryState / intentType / skillNature` 置空，不再作为 Path 的定帧输入；`pathTopologyHint` 随之缺省，由 path-planning 按契约语义判拓扑。旧会话（无 contract）保留标签回退。
- **分诊契约优先**：`triageGoalResponse` 检测到 `clarification` 时直接按 `stopping.scope / kind / blockingNeed` 派生去向，不再读 `intent_type / primary_block_type / skill_nature`；标签分支仅服务无 contract 的旧会话。
- **Goal 字段保留但断链**：`intent_type / entry_state / skill_nature` 仍按原 prompt 产出（直接删除字段的试验在 20 例里造成 Goal 收敛率下降，已回退），但 Path 定帧与分诊不再消费；它们只作兼容遥测。**链路退场点在下游，不在 prompt 语法层。**
- **Path Prompt 标注**：path-planning / path-reviewer / path-task-design 中所有标签分支明确标为「仅无 clarification 的旧会话」。
- **A/B**：20 例 OFF vs ON 见 §9.6；最终态默认门控路径生成 20/20、Goal 未收敛 0/20，优于 OFF 的 14/20 与 6/20。

### 回滚

- `clarificationContract` feature flag 关闭即回到旧契约；
- DB 采用“新增 contract 字段、旧字段保留”的兼容写入，不做破坏性迁移。

### 代码触点（Phase 1–3）

| 层 | 文件 | 改动 |
|---|---|---|
| Prompt | `prompts/core/goal-conversation.yaml` | 用 §3.8 的骨架替换标签规则；保留 `reply/quickReplies` 等对话工程字段 |
| Skill | `backend/src/skills/goal-conversation/index.ts` | 输出 schema 增加 `contract/nextAction/question/proposal/evidence` |
| 归一化 | `backend/src/services/learning/goal-conversation.ext.ts` | 透传 `contract`，不再从 `understanding` 派生标签 |
| 服务 | `backend/src/services/learning/goal-conversation.service.ts` | 持久化 `contract`；接入服务端 `canPropose` 门控；硬阻断改读 `stopping/blockingNeed` |
| 摘要 | `backend/src/services/learning/goal-path-visible-summary.ts` | 用 `contract` 替换 `entryState/intentType/skillNature/currentBaseline` 的标签映射 |
| Path | `backend/src/coordinators/path.coordinator.ts` | `normalizedInput.clarification` 替代 `learnerProfile` 标签；保留 `currentBaseline` 为证据包 |
| Path Prompt | `prompts/core/path-planning.yaml` / `path-reviewer.yaml` / `path-task-design.yaml` | 删除 `entryState/intentType/skillNature` 分支，改为读 `core/baseline/stopping`；增加 `MilestoneRationale` 与 `clarification_required` |
| 分诊 | `backend/src/services/learning/response-triage.ts` | 从“标签→mode”改为“契约属性→决策”；逐步删除只为标签服务的正则分支 |
| 测试 | `backend/src/coordinators/__tests__/simulation.goal.steps.test.ts`、`goal-conversation` 相关套件、path 契约测试 | 覆盖 `canPropose`、CLT 分支、无标签路径、`clarification_required` |

---

## 7. 风险与反方观点

1. **“没有标签，Path 怎么知道是考试还是兴趣？”**  
   考试/兴趣不是 Path 需要的；Path 需要的是 `stopping.scope`（一次 vs 一类）、`stopping.evidence`（平台/外部/自评）、`constraints`（时间/截止）。这些是请求属性，不是人的类型。

2. **“没有标签，怎么做分诊/负向出口？”**  
   分诊仍然存在，但变成“这个请求有没有可验收的证据、是不是一次性、是不是主要需要情绪/转介”。判断对象是请求，不是用户身份。

3. **“澄清轮次会不会变多？”**  
   会，但只在“未知会影响第一站/停机条件”时变多；其余情况允许“提案 + 假设”。VOI 门控保证不会无限追问。

4. **“Prompt 能保证模型不脑补吗？”**  
   不能。所以需要服务端门控 + 可追溯性检查 + 评测集。Prompt 只负责“意图”，代码负责“边界”。

5. **“这套东西是不是又一层抽象？”**  
   不是。它是**减法**：删掉 6 个身份标签、30+ 心理字段和它们的例外规则，换成一个 12 字段的契约。Path 侧也删掉标签分支，回到它已有的 RPKT/CLT/UbD 机制。

---

## 8. 附录 A：设计漂移史（为什么现在要收口）

| 时间 | 事件 | 与分型的关系 |
|---|---|---|
| 2026-04-12 | 初始 Goal Agent：学习规划顾问、问题穿透、每次 1-2 问、“不要编造用户没说的信息” | 无 `intent_type/entry_state`；动机是静默字段，不是分流问题 |
| 2026-05-21 | 删除独立 `goal-type-identifier` Skill（四型 + 知识分布） | 显式分型曾被移除 |
| 2026-07-28 | v4 Goal Prompt：最小信息 + 4 硬条件；`current_baseline` 列为软信息 | 无分型；但硬条件偏 problem-fix |
| 2026-09-19 | 加 `primary_block_type` + 响应分诊 | 为“不该只产路径”补标签 |
| 2026-09-20 | 加 `support_need` 第二轴 | 为情绪/现实支持补标签 |
| 2026-09-27 | 加 `intent_type` 四型 | 为 mastery 用户不被追问用途、路径体量不塌 |
| 2026-11-07 | `intent_type` 扩到 8 型并强制落库 | 为“兴趣型判定出这一轮就消失，下游拿不到” |
| 2026-11-17 | 加 `entry_state` | 为主题型诉求不被逼成完整画像 |
| 2026-11-18 | 外部评审：goal prompt 已陷入 case-driven patching；清理 38 处事故复盘 | 只清理重复，未去掉标签层 |
| 2026-11-19 | 本设计 | 用澄清契约替换标签层 |

结论：**分型不是初版设计，而是为修具体事故逐层加回来的补丁。** 现在的问题不是“再加一条 CLT 规则”，而是把入口的产物从“人的类型”换回“问题的澄清”。

---

## 9. 附录 B：CLT 案例在新契约下的走法

### 9.1 Goal 回合

**用户第一轮**：“我想学一下，学习科学”

```json
{
  "nextAction": "ask",
  "contract": {
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
  },
  "question": { "text": "你是想系统建立学习科学的版图，还是先弄清它和某个具体理论（比如 CLT）的关系？", "targets": "u1" }
}
```

这不是“考试/工作/兴趣”的动机分型，而是**核心问题的两种可能结构**；答案会改变第一站，所以值得问。

**用户第二轮**：“就是学一下，我对这个感兴趣，想了解一下，和 clt 之间关系”

```json
{
  "nextAction": "ask",
  "contract": {
    "core": {
      "question": "学习科学与 CLT 是包含关系还是冲突关系，边界在哪",
      "evidence": ["和 clt 之间关系"]
    },
    "baseline": {
      "known": ["用户主动使用 CLT 缩写"],
      "unknown": ["是否读过样例效应/元素交互", "关注学科史还是教学应用"],
      "misconceptions": [],
      "evidence": ["用户自然说出 CLT，说明不是零基础"]
    },
    "stopping": {
      "kind": "explain",
      "scope": "class",
      "evidence": "platform",
      "statement": "能解释两者的关系，并把一个新案例放进这个框架"
    },
    "constraints": {},
    "assumptions": [],
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
  },
  "question": { "text": "你读过 Sweller 的样例效应/元素交互吗？", "targets": "u2" }
}
```

此时**不出提案**：`u2` 影响第一站，不能靠猜。也不会出现 AI、短视频、点评学习法广告——这些都不是用户证据。

**用户第三轮**（假设）：“只听过名字，没读过”

```json
{
  "nextAction": "propose",
  "contract": {
    "core": { "question": "学习科学与 CLT 是包含关系还是冲突关系，边界在哪", "evidence": ["和 clt 之间关系"] },
    "baseline": {
      "known": ["知道 CLT 与 Sweller 的名字"],
      "unknown": ["学科史细节", "教学应用"],
      "misconceptions": [],
      "evidence": ["只听过名字，没读过"]
    },
    "stopping": {
      "kind": "explain",
      "scope": "class",
      "evidence": "platform",
      "statement": "能解释两者的关系，并把一个新案例放进这个框架"
    },
    "assumptions": ["先按学科史与学派争论的切面组织；若你更想偏教学设计应用，第一站可以换"],
    "blockingNeed": "none",
    "unknowns": []
  },
  "proposal": {
    "direction": "从样例效应实验建立 CLT 的直觉，再把它放回学习科学的学派版图",
    "firstStation": "Sweller 的样例效应实验：新手自己解题 vs 先看完整样例",
    "stages": [
      "样例效应与两条前提：工作记忆有限、图式构建",
      "2006 年争论：CLT 与建构主义/探究式学习到底在争什么",
      "用一个新案例判断它站在哪一边，并说明依据"
    ],
    "stoppingEvidence": "能解释两者的关系，并把一个新案例放进框架",
    "outOfScope": ["学习科学的完整学科分支", "教学设计工具链", "文献精读方法"],
    "assumptions": ["先按学科史与学派争论的切面组织；若你更想偏教学设计应用，第一站可以换"]
  }
}
```

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
      "goal": "能选一个用户自己关心的学习法/教学主张，判断它更接近哪一方的假设，并说明依据"
    }
  ],
  "assumptions": ["若用户实际读过样例效应，第一站可替换为 2006 年争论"]
}
```

如果用户第三轮说“读过，想弄清学派争论”，Path 就直接从第二站起笔，第一站被跳过；这不是“标签不同”，而是**基线证据不同**导致的同一套推导结果。

### 9.3 Phase 1 shadow 实测（2026-11-20）

用真实模型（`skill:goal-conversation`，`deepseek-v4.1-flash`）重放 CLT 前两轮：

**旧契约仍然照常运行：**

```
stage       : proposing
intent_type : interest
entry_state : exploratory
baseline    : {"level":"unknown","evidence":"用户能主动提出 CLT ... 但未说明接触史"}
proposal    : true
```

**新契约 shadow 的同一轮：**

```
nextAction  : propose
core        : 学习科学与 CLT 是「领域与分支理论」的包含关系，还是两套并行甚至相互冲突的路线
baseline    : known = ["知道 CLT 这一术语，并主动把它与学习科学并置比较"]
              evidence = ["「和clt之间关系」表明用户已有 CLT 概念，但位置未定"]
stopping    : explain / class / self
unknowns    : u1 = 用户是在文章、产品还是自身学习体验中碰到 CLT 的
              planImpact = first-station
```

**门控结果：**

```
allowed     : false
blocking    : ["unknowns.first-station"]
nextQuestion: 用户是在文章、产品还是自身学习体验中碰到 CLT 的
判定        : 新契约本应拦截该提案
```

结论：

1. **拦截生效**：旧契约在 `baseline.level=unknown`、第一站未定的情况下直接进入 proposing；新契约把同一轮标成“本应拦截”，且能指出缺的是“第一站来源”而不是笼统的“信息不足”。
2. **用户可见行为零变化**：旧 stage / proposal / reply 仍按原逻辑返回，shadow 只写服务端日志。
3. **暴露了下一次要补的口子**：模型这一轮仍然在 reply 里写了“拿一篇近期讲认知负荷/学习效率的科普或产品文案”——契约的 `stopping.statement` 允许它，但提案里这个“材料”没有用户证据。Phase 2 需要把“提案元素可追溯”从结构检查升级为语义检查（或强制 `assumptions` 标注），否则门控只能拦住“时间点”，拦不住“脑补内容”。

### 9.4 Phase 2 A/B 实测（2026-11-20）

同一份真实模型输出（`deepseek-v4.1-flash`，CLT 前两轮），分别过 `enforce off` / `enforce on`：

**A：enforce OFF（旧行为）**

```
stage    : proposing
proposal : true
reply    : 学习科学是研究「人到底怎么学会」的交叉领域……这版先按两站走：第一站先立一张最小地图……
```

**B：enforce ON（门控后）**

```
stage      : understanding
proposal   : false
nextAction : ask
reply      : 在给你排方案前，我还需要确认一件事：CLT 是否就是认知负荷理论
```

**Path 侧：**

```
incomplete contract : CLARIFICATION_REQUIRED ["unknowns.first-station"]
complete contract   : 放行生成
```

结论：

1. **拦截生效且可回滚**：Phase 2 时显式设 `GOAL_CLARIFICATION_ENFORCE=1`；Phase 3 起默认开启，`GOAL_CLARIFICATION_ENFORCE=0` 即回滚到旧行为。
2. **Path 不再带病生成**：契约仍有 first-station 级未知时，`generateFromGoal` 在生成前抛 `CLARIFICATION_REQUIRED`，不会先落库再失败。
3. **仍需人工看一处**：这次模型给的 first-station unknown 是“CLT 是否就是认知负荷理论”（术语消歧），而不是“你读过样例效应吗”（基线）。它仍会拦住提案，但提问质量取决于模型；Phase 4 需要在 `unknowns` 选择上优先“基线/停机条件”而不是“术语确认”。

### 9.5 Phase 3 默认配置实测（2026-11-20）

不设任何 `GOAL_CLARIFICATION_*` 环境变量（`env: (unset)`），用真实模型（`deepseek-v4.1-flash`）重放 CLT 第二轮：

**模型原始输出：**

```
stage       : proposing
proposal    : true
nextAction  : propose
reply       : 学习科学和 CLT 的关系……这一版先安排两次学习，每次约 25 分钟。
              第一站从「看的时候都懂，一合上书就想不起来」开始……（给出了完整两站方案）
```

**默认门控后：**

```
stage       : understanding
proposal    : false
nextAction  : ask
reply       : 在给你排方案前，我还需要确认一件事：你最想弄清的具体问题或矛盾是什么？
blocking    : ["core.question"]
```

结论：默认配置下，入口不再把「直接给两站方案」交给用户，而是先回到澄清；同一份契约在 `GOAL_CLARIFICATION_ENFORCE=0` 时保持原样（单测覆盖）。这次拦的是 `core.question`（模型没有把核心问题写成一句话），而不是 u2；拦截正确，提问质量仍是 Phase 4 的优化项。

### 9.6 Phase 4 20 例 A/B（2026-11-20）

同一份 20 用例集（`2026-11-13-20-users.json`），默认 1 个模拟日、并发 5；两臂唯一差异是 `GOAL_CLARIFICATION_ENFORCE`：

| 指标 | A：enforce OFF | B：默认 ON（最终清理后） |
|---|---|---|
| 生成路径 | 14 / 20 | **20 / 20** |
| Goal 未收敛离场 | 6（u02/u04/u10/u14/u18/u20） | **0** |
| 平均阶段 / 课次 / 时长 | 2.3 / 2.6 / 0.9h | 2.3 / 2.5 / 0.9h |
| 课堂失败 / 空会话 | 0 | 0 |
| 开场假定经历 / 标题剧透 | 0 | 0 |
| 材料目标未触发采集 | 7 | 1（u10） |

> 过程说明：门控严格版先测到 19/20（1 个 goal 未收敛）；Phase 4 标签链路退场后，最终态为 20/20、0 个 goal 未收敛。中途两次过度拦截的修正见下。

结论：默认门控**没有造成路径/教学回归**；Goal 收敛率与路径生成率反而提升。A/B 同时抓出两次过度拦截，均已修正：

1. **`core.question` / `baseline.evidence` 被当成提案硬门**：模型给出可用方案但没写这两项摘要字段时，门控反复要求补字段，学习者离场（u02/u03/u07/u08）。修正：提案门控只拦 `stopping.statement` 与 `unknowns.first-station/stopping`；两个摘要字段降为 advisory。
2. **`stopping.scope=instance` 被直接判成一次性请求**：审自己那份合同（kind=decide、有基线）被分诊成 `answer_then_hook`，路径入口被跳过。修正：只有 `scope=instance × kind=do × 无基线证据` 才判 one-off。

**未达标项**：u14（逻辑谬误）在两臂都 goal 未收敛，是 Goal 收束/拟真学习者行为问题，不是门控引入；1 天批次只验证「路径能否生成、课堂能否开课」，不代表 8 天课程的最终形状。

### 9.7 外部评审后的三处收敛（2026-11-20，Phase 4 之后）

外部评审指出：Phase 3 的契约虽然生效，但 `goal-conversation.yaml` 头部仍留着旧「进入态/裸主题先分流/exploratory 免基线」规则，与契约打架；`out_of_scope` 的 prompt 约定与确认面板展示不一致；`temperature=0.7` 让「缺口是否闭合」的判断发散。逐条处理如下。

**1. 头部规则换成「先澄清，再提案」**

- 删除「裸主题先分流（考试/工作/兴趣）」「exploratory 直接给起步提案、不探基线」两类旧规则；它们正是用户批评的“动机分型导致脑补”的入口。
- 新 rule 1：Goal 的产物是 `clarification`，不是分型表；只给主题时先问一个能区分第一站的具体问题（之前接触过什么 / 最近一次卡在哪 / 想弄懂到能做什么），答完再决定是否提案。
- 旧的分型规则保留为“提问/提案形态”的内部启发，但不再作为输出字段，也不再追加提问。
- 提案给出后不得再问「先看哪一块 / 先从哪开始」，入口必须已写进方案第一段。

**2. `out_of_scope` 的 prompt 契约对齐 UI**

- 原 prompt 写“hidden/内部”，前端确认面板却渲染成「暂不包含 · 走完这段再定」。
- 统一为：`out_of_scope` **会展示**在确认面板「本轮暂不展开」；只允许写用户本人明确提出、本轮协商延后的内容，用户没提过的主题严禁写入，没有就输出 `[]`。前端标签同步改为中性的「本轮暂不展开」。

**3. 降温度、收死规则**

- `defaultTemperature: 0.7 → 0.35`：澄清契约是强约束状态机 + 自然对话，低温压低“同一轮既想提案又补未知”的发散；模型不变（教学基准模型不动）。**注意：当时只改了 `definition.ts`，core YAML 的 `params.temperature` 仍是 0.7，实际运行并未生效；已在 §9.8 修正。**
- 删除/改写与契约重复、互相打架的死规则；保留的旧规则加「仅无 clarification 的旧会话」前缀，避免与契约同权竞争。

**4. 补掉 `baseline.unknown` 绕过口**

live 探针暴露：模型把「是否已能读懂单根K线与成交量」只写进 `baseline.unknown`，`unknowns` 只留一个 scope 项，于是仍然提案。处理：

- `deriveClarificationGaps` 新增 `baseline.unknown` 缺口；仅当 `unknowns` 里没有 first-station/stopping 项时触发（同一未知已镜像进 `unknowns` 的不重复拦，避免逼模型删掉真实基线记录）。
- 提案门控拦它；Path 入口 `assertClarificationReadyForPath` 显式过滤它——基线未知只在提案前拦，不在 Path 入口二次判死。
- prompt 明确：**propose 回合 `baseline.unknown` 必须清空**；会影响第一站的写进 `unknowns`，已答清的移到 `known`，不打算问的（含默认周期/标的/范围）写进 `assumptions`。
- 门控改写提问时，若唯一缺口是 `baseline.unknown`，直接追问该条目本身，而不是复读「你之前接触过什么」。

**live 探针（`deepseek-v4.1-flash`，默认配置，门控已应用）：**

| 回合 | 结果 |
|---|---|
| 学习科学 · 只给主题 | `ask`，问「从哪儿起意 / 有没有具体不顺」；未按考试/工作/兴趣分流 |
| 炒股 · 只给「看不懂」 | `ask`，把「看不懂」收窄到 K线/财报/公告三类之一 |
| 炒股 · 答「指标、走势」 | 一次运行 `propose`，`baseline.unknown=[]`、`unknowns=[]`；另一次运行仍保留一个 first-station 未知 → 门控继续 `ask` |
| 炒股 · 答「想自己判断走势」 | 确认方向，给出两站方案；不再追加「先看哪块」 |

**5. 补真实任务例外（单例回归暴露）**

6 例抽测（u02/u04/u10/u14/u18/u20，1 个模拟日）里 5 例生成了路径，u02（租房合同）却把「今天要签的合同怎么看」当成一次性直答，`stage=completed`、未出路径。原因是「一句话讲透测试」被模型用来收口，尽管这份合同当天要签、判断错有真实代价。修正：在「一句话讲透测试」加例外——用户手上正有今天/本周要交付的真实任务，且请求是「教我怎么判断/怎么审/怎么改」时，即使答案能一条讲透，也按「真实任务当教材」出提案；同时明确 `stopping.scope=instance` 只表示「拿一份具体材料验收」，`kind=decide` 的实例目标仍要出路径。

单例复测（u02，默认配置）：第 1 轮给判断口径 + 一个范围问题 → 第 2 轮用户补充维修责任 → 第 3 轮确认 → `path/running`，路径最终 `status=active`。Goal→Path 链路打通，不再 answer-only 收口。

结论：低温没有消除模型方差，但门控把“未闭合却提案”变成了不变量；探针中不再出现 `baseline.unknown` 藏未知而放行的情况。

### 9.8 去伪正则：goal-conversation 结构重写（2026-11-20）

外评指出提示词用“自然语言正则”驯服概率模型：信号词穷举、故障词典、字面话术黑名单、单 case 硬补丁。审计确认成立，按结构重写处理：

| 病灶 | 处置 | 结果 |
|---|---|---|
| 意图分型 5 条信号词表（系统学/彻底搞懂/纯兴趣/纪录片…） | 全删；7 条分型规则压成 4 个语义维度 + 5 条紧凑类型说明 | 不再靠词表归类 |
| 一次性故障词典（蓝屏/报错/打不开/连不上…） | 改为语义条件：要修好眼前这一次，不是掌握可迁移原理 | 词典消失 |
| 单 case 补丁（盘库/报销单/p-π/F 和弦/剪映/黄山/AutoGPT/Coze 品牌） | 删除具象补丁，保留底层原则；Coze/Dify 等品牌名与黄山行程单均移除 | 0 处单 case 词 |
| 话术字面黑名单（行话/导师语气/不复读/播报假设） | 压成 3 条风格原则 + 1 条确认轮纪律 | 从 9 条降到 4 条 |
| 同一门禁多处重复（ready/unknowns/answer-only） | 每条只留一处权威表述，字段描述改为引用 | 规则项 81 → 58 |

**体量**：36,705 → 29,767 字符（-18.9%）；rules 区 26,033 → 19,109 字符（-26.6%）；规则项 81 → 58（-28%）。剩余 9,606 字符是 fields schema（输出契约，不是伪正则），未强拆。

**保留的硬约束**：`clarification.unknowns` 缺口未闭合必须 ask、`ready` 只能按钮触发、`not_judgeable` 一律不排路径、`needsMaterial` 未登记不得承诺真实材料、`out_of_scope` 只写用户提出且延后的内容。这些是系统不变量，只写一次，尽量由代码硬校验。

**顺带修掉一个真 bug**：`definition.ts` 的 `defaultTemperature` 已改 0.35，但 core YAML 的 `params.temperature` 仍是 0.7；实际运行时读的是后者，所以之前所有“降温”都没生效。本次改为 `params: { temperature: 0.35 }`，`prompts:compile-all` 产物首行已确认 `temperature: 0.35`。

**验证**：`prompts:check:all` 通过；守卫/契约/哈希 80 个用例通过；0.35 下 live 探针（学习科学、炒股）仍先澄清后提案，`baseline.unknown` 清空后才 propose；单例 u02 三步收敛到 `path/running`，路径 `status=active`，标题「杭州租房中介合同签约前审出押金退租风险」。

### 9.9 第二轮：清掉 4 处自相矛盾与 2 处杂质（2026-11-20）

通读结构重写后的文件，又发现 4 处新旧口径打架、2 处工程杂质，已修：

1. **“分型不是输出字段” vs fields“必须产出”**：顶部改为“分型不是给用户看的字段，也不驱动提问；只按语义静默落库供历史兼容”。hidden 字段仍标“必须产出”，但不再是“不要输出”的矛盾指令。
2. **“软信息不阻止收敛”后门**：`current_baseline`、`background_experience` 从软信息列表移出，只留 `constraints_and_boundaries`；并明确前两者仍按「第一性规则」用 `baseline.evidence` 决定第一站。兴趣/通识型补一句“仍需先有一条 baseline.evidence 决定第一站起点”。
3. **“方向先给”诱导首轮脑补**：改为分条件——已有明确任务/交付/最近卡点时可先给方向；只给主题/领域时先承接原话、点出最影响起点的分叉点，拿到核心张力与 baseline 后再给方向，不在没有基线时猜。
4. **fields 里的 exploratory 幽灵**：`real_problem`、`scenario`、`first_deliverable`、`key_stages` 四处改为“无具体事故场景的理解型目标 / 起步段 / 起步提案”；`entry_state` 定义改为“本轮提案仍是起步形态（且已补过 baseline）时”。现在只剩 enum 列表与该定义里的枚举值，不再有“首轮起步提案”的推进许可。
5. **Agent 四模块领域知识**：从「论文/毕设术语与证据」删除 LLM/Planning/ReAct/Memory/Tool Use 与 Trace 的课程定义，只留“必须用标准术语，比喻只能作入口并当场对标”。守卫测试同步改为断言这些领域词**不出现**在 goal prompt。
6. **分型细则与判断维度重复**：掌握/研究、problem-fix 两条压缩约 40%，兴趣型把“最新/近期/今年/现在/当下/前沿/动态”词表改成语义条件“用户明确要求时效性/最新进展”。保留应试主观题、兴趣不排作业、工作背景不替代知识目标等硬约束。

**体量**：29,767 → 29,735 字符；rules 19,109 → 19,089。字符数几乎不变，是因为删掉的重复被“基线/方向”的精确表述抵消；分型细则本身从约 1,500 字符降到 926（-38%）。

**验证**：`prompts:check:all` 通过；守卫/契约/哈希 80 个用例通过；typecheck 通过；0.35 下 live 探针中，学习科学/炒股均先澄清、不猜方向，`baseline.unknown` 清空后才 proposal，未再出现“首轮给方案”。

### 9.10 声线改造：从“客服/评审腔”切到“克制的熟人前辈”（2026-11-20）

外部评审指出 Goal 的 reply 缺“人味儿”，并列出五个源头。实测核对：5 条 live 回复里 4 条出现「哪种情况」、2 条出现「你这边」、5 条都把用户原话套「」；但回复长度只有 86–143 字，并不是“百科朗读机”。真正的病灶是**固定句式 + 内部术语 + 三段式模板**。

改动：

1. **identity 重写**：从“学习目标澄清与方向收敛助手”改成“懂行、说话实在、不端架子的学习搭档”；明确“字段冷、reply 热”，并把“reply 要顺着上一句聊”写回去，避免每轮重新起范。
2. **四条语气规则合并为两条**：
   - 「说话像懂行的真人，不像客服或教材」：先接话再推进、用正常人的词、不当百科复读机、有观点但不压人、不暴露系统机制、保持连贯。
   - 「接住画面再推进（方向先给、问题后置）」：已有明确任务可先给方向；只给主题时先承接原话、点分叉点，拿到 baseline 后再给方向。
3. **reply 三段式模板删除**：不再要求“先总结 + 说明 + 提问”，改成“接住画面 → 点破关键 → 顺口一问”；保留“整轮只出现一个问号”。
4. **内部词只在 reply 禁用**：`坐学 / 第一站/第二站 / 起步提案 / 闭环 / 抓手 / 痛点 / 卡点` 换成“先搞定哪件事 / 先看哪块 / 每次二十来分钟 / 卡在哪一步”；并给了一个正向替换例子（别再说“最好用的抓手”，说“最好用的入口/例子”）。Path 层内部仍可使用这些结构词。
5. **两组极短声线示例**：客服腔→人话、评审腔→人话；示例不绑定具体行业，避免变成新的单 case 补丁。
6. **确认收口模板同步换掉**：“这版方向就定住了；你点确认我就开始排路径” → “好，那咱就按这个路子走；你点一下确认，我就把后面排出来，想调哪块随时说”。

**实测（0.35 温度、5 条 live 回复）**：`你这边`、`哪种情况`、`坐学`、`第一站/第二站` 全部为 0；引号复述从 5/5 降到 1/5；长度 81–243 字，提案轮用“两段 / 每次二十五分钟”而不是“两站 / 坐学”。仍有一次模型用了“抓手”，已补正向替换例子。温度本轮不动——声线变化和结构稳定性分开验证。

**验证**：`prompts:check:all` 通过；守卫/契约/哈希 80 个用例通过；typecheck 通过；后端已重启到新 prompt。未跑批量 case。

### 9.11 炒股对话的 4 个局部跑偏与修复（2026-11-20）

同一句「我最近炒股，不太顺利 → 我看不太懂走势，就投资，被套着了」暴露了 4 条规则在后台互相拉扯：

| 表现 | 触发语句 | 处理 |
|---|---|---|
| 首轮未取证先下判断 | `:45` 示例「其实这块最容易踩的坑是…」、`:54` 示例「听起来你是被这件事卡住了…」 | 改成事实前置：没拿到具体对象/动作前只描述听到的画面；示例改为「你刚说「学不进去」——我先不猜原因…」 |
| 用户点名「看不懂走势」却被拉去复盘追涨/扛单 | `:62` 提问优先级「最近一次卡住场景」、`:147` real_problem「失败场景优先」、`:72` troubleshooting「2-3 个高频现场」 | 新增「紧跟用户点出的具体对象」；提问优先级把「用户已点名的知识/技能对象」提到最前；real_problem/troubleshooting 对知识对象改用「当前理解边界/认知切口」，不套失败现场剧本 |
| 提案轮还派「今晚先做的小事」 | `:95` 真实任务触发太宽（正在发生即可）、`:96` 每轮都可给诊断动作、`:97` 又禁止「弄好回我」 | 触发收紧为「有明确交付物或外部截止」；诊断动作只在 understanding 阶段给，进入 proposing 后只写进第一课，禁止在聊天里布置课前作业 |
| 快速自测出成行为自述题 | `:112` 仅说「方向判断依赖」、`:225-227` 只要求「二元判断」，未要求客观答案 | 改为「仅用于校准第一课从多深讲起」，必须存在唯一客观正确答案、correctOption 有实质意义；严禁行为自述/经历回溯/偏好选择；不适用时输出 [] |

**实测**（0.35 温度，3 轮）：第 1 轮只问「卡在读盘还是买卖时机」；第 2 轮用户说看不懂走势后，追问「完全看不出图上在讲什么，还是能看出大概涨跌但判断不了后续」；第 3 轮进入 proposing，reply 不再派「今晚作业」，`prerequisiteDiagnostics=[]`。第一次改完仍出现「当时买进去是听消息还是自己看图」的行为复盘，补强「知识对象优先于失败场景」后才切回走势本身。

第 4 条「中后段内部词（坐学/第一站/起步提案）清理」按计划留到大瘦身时统一做，未混入本轮行为验证。

### 9.12 语法路径被压成「2 阶段 / 1 小时」的修复（2026-11-20）

用户实测「我想从头学一下语法」，路径预览只有 2 阶段、objectiveScopeHours=1h。查对话数据：clarification 的 `unknowns=[]`、`assumptions=["第一站按零基础入口走","单次节奏按默认25分钟"]`、`objectiveScopeHours=1`、`scopeAnchor="按 2 个关键阶段 × 每次约 25 分钟估"`。不是用户信息太少，而是提示词把「单次 25 分钟」焊成了「1 阶段 = 1 次课」，又把「起步提案 ≤2 阶段/2h」变成了全局默认。

三处病根与处理：

1. **单次时长与内容体量解耦**：删除「sessionsLengthSource=default 时按 阶段数×25 分钟 估（2 站≈1h）」在起步形态、时间模型、时间口径三处的重复公式。`sessionsLengthMin` 只表示每次坐下学多久；一个阶段可以包含多次 25 分钟微课；`objectiveScopeHours` 只由内容体量估（单点 0.5-2h、技能模块 4-12h、完整学科 15-40h）。
2. **路径体量分档**：新增「路径体量分档（禁止把大体系硬压成 2 阶段）」——轻起步仅限窄单点/泛泛好奇；用户明确「从头学/系统学/彻底弄明白」一个体系时走完整路径 3-6 阶段，不套 2h 上限。原「起步提案形态」收窄为「轻起步提案形态（仅限窄目标）」。
3. **体系目标先定落点**：用户说「从头学 X」但没说学到什么程度时，先问「核心骨架够用，还是整套体系顺通」；答案决定阶段数/体量。回答前不把体系压成 2 阶段 1 小时。`out_of_scope` 允许写该体系内未覆盖的模块，但不写相邻但用户没提的能力。

**实测**：同一段语法对话，第 3 轮现在会先问落点并记录 `planImpact=scope` 未知；用户选「整套顺通」后，提案为 5 阶段（句子骨架→时态语态→三大从句→非谓语→综合拆解）、objectiveScopeHours=24、scopeAnchor「按 5 个关键阶段估，每阶段含多次 25 分钟微课」，不再是 2 阶段/1 小时。

**产品选择建议**：确认面板应展示完整路线图（5 阶段可见），而不是只显示前 2 阶段；可以用「完整路线图 + 本期先激活前 1-2 阶段」的滚动解锁形态，既不让用户误以为 1 小时是全部，也不一次性压满认知负荷。

### 9.13 Path 三文件的阶段边界与时长契约修复（2026-11-20）

语法路径暴露的不是「体量又塌了」，而是三个阶段契约同时失守：goal 的 `first_deliverable` 写成整条路径的终点成果（含从句/时态），`path-planning` 又把它当成 M1 验收，`path-task-design` 再把总 `stopping.statement` 抄进每一阶段。落库路径 `lp_1795161885247_ue3u3i3` 里，M1 goal 明确要求「含一处从句的句子」，第 1 阶段第 5 课直接做「五句带从句的句子连拆」，第 4 课已经在用非谓语——而 `loadProfile` 给 M1 标的是 `low`。这不是单条正则，是缺一个「阶段只能用已解锁概念验收」的不变量。

**修了七组：**

1. **硬冲突**：`path-planning` 的 `scope=instance` 改为与 goal/`response-triage` 同口径（instance ≠ 一次性操作，kind=do 且无基线才是）；删掉 `cognitiveDesign = cognitiveCore` 的镜像要求，只保留「已退役、不再输出」；`path-reviewer` 移除看不到 subtasks 的「同一阶段两课核心动词」「字体行距」条款。
2. **firstDeliverable 语义**：goal 字段改为「整条路径最早可见的成果，不是第一站验收单」；path-planning 的 M1 只做它的第一跳，不得把后序阶段的核心概念/核心动作写进 M1 goal 或验收；`observableResult` 只要求同向，不要求 M1 产出终点。
3. **阶段概念隔离墙**：task-design 只在末阶段对齐总 `stopping.statement`；非末阶段以 `milestone.goal` 为准。本阶段讲解与验收只能用本阶段 coreConcept 及其 prerequisiteTree 前置；后序概念只能作不考核的背景材料，不得进 title/acceptanceHint 判据。首站例句只出现本阶段能解释的结构，不得用后序结构（语法里的从句/非谓语/完成时）做干扰项。`pathStageMap` 增加 `coreConceptName`，让墙能按概念而不是只按标题判断。
4. **评审与负荷**：reviewer 新增「终点前置 / 概念偷跑」「负荷倒挂」两个失败特征；planning 新增「首站材料复杂度服从 loadTarget」，翻车靶子难在直觉会错，不是难在结构没学过。
5. **时长承诺**：静默默认 25 分钟的上界从 35 收到 30（+5 分钟），`summary` 按 `timeDimensions.sessionsLengthMin` 写实际值，删掉「35 分钟真课」示例。
6. **low 负荷密度**：`loadTarget=low` 下，若一个任务必须同时用到两个尚未建立的概念，拆成两个连续任务、各自只推进一个；同一任务并列教授 ≥4 个平级子类（五类句型、六种时态等）时，按 2-3 个一组拆成连续任务，每组独立验收。拆分属于负荷控制，不算按样本序号注水。
7. **标题与验收同域**：`path-planning` 增加规则——milestone title 点名的每个核心概念/关系对象，必须在同 milestone 的 goal 里有对应验收；标题写「从句与非谓语」，goal 不能只验从句、把非谓语留给任务。`path-reviewer` 的「标题与验收脱节」按同一口径判。

**实测（单例，不落库）**：重放同一语法输入后，M1 变成「凭谓语动词辨出句子主干与基本句型」，M1 goal 不再含从句；第 1 阶段任务为「They book a room 词性/成分」「She is reading 里几个谓语」「SV/SVO/SVP…」「诊断批注」「缺宾语」——不再出现非谓语/从句/完成时干扰，分钟 25/30/30/25/30。重放的 stage 3 因 provider 超时中断（非本次改动），path 与 stage 1 已验证。

**线上重生成（2026-11-20 第二轮，`lp_1795161885247_ue3u3i3`）**：按 `loadTarget=low` 再做一次负荷拆分——首课段拆成「同形词词性」「句子成分（主/谓/宾/修饰语）」「唯一谓语与主干边界」三节；五类句型拆成「SV/SVO/SVP」与「SVOO/SVOC」两节。当前为 4 阶段/10h：第 1 阶段 5 节（30 分钟 × 5，共 150 分钟，正好 2.5h 阶段上限），首三段分别只推进一个判断动作，后两段各覆盖 3 类/2 类句型；M1 只要求单谓语简单句，M4 的 title 与 goal 同时包含从句与非谓语（分词/不定式/动名词），全路径不再出现「限时」验收。第 2-4 阶段按渐进模式在进入时生成。

**2026-11-20 验证**：`prompts:check:all` 退出码 0；backend/frontend `typecheck` 通过；prompt guards 43 项通过；hero/progressive 前端测试 10 项通过；重生成后 `pathAudit` 的 `missingPrerequisiteKcs=0`、`latePrerequisiteEdges=0`。

**顺带修复**：渐进/追加模式下 `stage-enrichment` 的 `plannedAnchorHours` 原来用**过滤后**的 `learningPath.milestones` 求和（只剩当前阶段），导致 4 阶段/9.5h 的路径在第 1 阶段生成后显示成 2.5h；改用过滤前的全量 `allMilestones`，片段模式写「骨架锚」与「本轮实际交付」的较大值。

**验证**：`prompts:check:all` 通过；`typecheck` 通过；path-planning/hints 14 套 242 个用例、prompt guards 40 个用例通过。未跑批量 case。

---

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
