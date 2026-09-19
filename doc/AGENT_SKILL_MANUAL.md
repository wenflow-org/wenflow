# Agent / Skill 全景与缘由（开发者向）

> 本文回答一个问题：**每个顶层 Agent 和每个 Skill 为什么存在**——功能缘由、设计意图、解决什么问题、边界在哪。
>
> **本文是什么（定位）**
> - 这是**开发者文档，不是平台功能/能力清单**。它不描述"平台能为用户做什么"，而是描述"内部为什么这样拆模块"。任何对外能力承诺请以 `README.md` / `admin-guide.md` 为准。
> - 它写给要**新增/改造/排障 Agent 与 Skill** 的开发者，目的是让改动有据可依，不被自动生成的文档牵着走。
>
> **与相邻文档的分工**
> - [`prompts/AGENTS_SELF_INTRO.md`](../prompts/AGENTS_SELF_INTRO.md)：**自动生成的机械附录**（`npm run prompts:self-intro`）。它是每个核心提示单元的 what——identity / channels / inputs / fields / handoff / constraints，**没有 why**。本文引用它，不整表照抄；要看某字段精确类型与边界原文，请翻它。
> - [`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md)：**how-to**（选型 → scaffold → 接线 → 加字段 → 门禁 → 发布 → 测试）。本文是它前面的 **why**；新增/改造请从本文建立意图，再走那篇的流程。
> - [`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)：规范（什么是合法 core.yaml / 编排文件 / 编译产物）。
> - [`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)：字段路由模型（Agent 中心、`agent-output-v1` 外壳、`internal.ext.*`）。
> - 设计缘由来源：[`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)、[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)、[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md)、[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md)、[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md)、[`CONTEXT_MECHANISM_AUDIT.md`](./CONTEXT_MECHANISM_AUDIT.md)、[`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)。
>
> **权威口径**：本文只解释"为什么"。**"是什么"以 `prompts/core/*.yaml`（控制面）为准，"怎么流"以 `prompts/orchestration/<stage>.yaml`（数据面唯一声明源）为准，"属于哪类/挂在哪个 Agent 下"以 `prompts/skills.yaml`（户口簿）为准。**
>
> **诚实约定**：凡"缘由"在现有文档/代码里**没有显式记载**的，本文会写明 **「缘由：代码/文档未显式记载，按实现推断为…」**，绝不编造。汇总见 [§6](#6-未能从现有文档代码落地的缘由显式标注)。

---

## 目录

- [0. 阅读约定](#0-阅读约定)
- [1. 五 Agent 总览](#1-五-agent-总览)
- [2. 五 Agent 深读](#2-五-agent-深读)
  - [2.1 goal-agent（Goal 阶段）](#21-goal-agentgoal-阶段)
  - [2.2 path-agent（Path 阶段）](#22-path-agentpath-阶段)
  - [2.3 teaching-agent（Teaching 阶段）](#23-teaching-agentteaching-阶段)
  - [2.4 profile-agent（Profile 阶段）](#24-profile-agentprofile-阶段)
  - [2.5 simulation-agent（Simulation 阶段）](#25-simulation-agentsimulation-阶段)
- [3. 主线 Skill 缘由（按阶段）](#3-主线-skill-缘由按阶段)
  - [3.1 Goal 阶段](#31-goal-阶段)
  - [3.2 Path 阶段](#32-path-阶段)
  - [3.3 Teaching 阶段](#33-teaching-阶段)
  - [3.4 Profile 阶段](#34-profile-阶段)
  - [3.5 Simulation 阶段](#35-simulation-阶段)
- [4. 辅助 Skill 与 handler-only 组件（一句话）](#4-辅助-skill-与-handler-only-组件一句话)
- [5. 如何新增 / 改造一个 Agent 或 Skill](#5-如何新增--改造一个-agent-或-skill)
- [6. 未能从现有文档/代码落地的"缘由"（显式标注）](#6-未能从现有文档代码落地的缘由显式标注)
- [7. 参考索引](#7-参考索引)

---

## 0. 阅读约定

### 0.1 三个层级：Agent / Skill / Field

出自 [`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md) §2.1：

| 层 | 职责 | 数量（现行） |
|---|---|---|
| **Agent（协调器）** | 驱动一组 Skill，实现一个**范围功能**；拥有下辖字段的**路由策略** | 5 个阶段 Agent |
| **Skill（能力节点）** | 实现**单一原子能力**（对话/规划/抽取/呈现/判决） | 20 mainline + 9 aux |
| **Field（字段）** | 原子数据单元；路由（render/handoff/internal/accumulate）由所属 Agent 决定 | 见各 `orchestration/*.yaml` |

**关键结论（也是"为什么要有 Agent"的答案）**：字段路由策略**不是字段自己的属性，而是 Agent 对字段的标签**。加一个字段/改一个流向如果散落各处硬编码，就要改 8–15 处代码；V3 把这件事收敛为"Agent 决定路由 + admin 可编辑"（[`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md) §1.1、§1.3）。所以 **Agent 的存在理由是"范围功能 + 跨 Skill 编排 + 字段路由归属"，而不是某个具体能力**——具体能力应该做成 Skill。

### 0.2 Skill 三类

出自 [`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md) §1 与 [`prompts/skills.yaml`](../prompts/skills.yaml)：

| 类别 | 一句话 | 是否进字段路由 | 是否有 LLM prompt |
|---|---|---|---|
| **mainline** | 阶段主链的决策/产出节点 | ✅ 是（编排 `contracts` + `routings`） | ✅ `core.yaml` |
| **aux** | 旁挂能力（开场/诊断/归并/守门），`runAux` 执行 | ❌ 否 | ✅ `core.yaml`（多数） |
| **handler-only** | 纯函数/查库/工具执行器 | ❌ 否 | ❌ `noPromptFile: true` |

### 0.3 五阶段数据旅程（一句话）

```
Goal           Path                 Teaching              Profile                Simulation
澄清真实问题 ─► 认知结构+阶段骨架 ─► 逐回合授课+课后评估 ─► 跨课沉淀学习者画像 ─► 虚拟学习者黑盒验证整链
goal-agent     path-agent           teaching-agent        profile-agent          simulation-agent
                                          │                     ▲                       │
                                          └── lesson:completed ─┘   (验证结果回流实验室/审计)
```

- **Goal → Path → Teaching** 是用户可见的**纵向主链**（`orchestration/goal.yaml order:1` → `path:2` → `teaching:3`）。
- **Profile** 是**横切的沉淀层**（`profile.yaml order:4`，注释明确"字段全部为编排器内部沉淀"，由 `lesson:completed` / `task:completed` 等事件驱动）。
- **Simulation** 是**验证层**（`simulation.yaml order:5`），用虚拟学习者把整条真实链路跑一遍，再用裁判/审计判定质量与保真度；它本身不服务真实用户，而是服务**平台自身的可证伪性**。

---

## 1. 五 Agent 总览

| Agent | 阶段 | 一句话职责 | 为什么单独设这个 Agent（而不是拆进 Skill） | 边界（不负责什么） | 五阶段旅程位置 |
|---|---|---|---|---|---|
| **goal-agent** | goal | 多轮对话澄清学习目标，产出 Goal Understanding | 它是"问题定义"阶段的**范围负责人**：把离散的对话产出（surface_goal/real_problem/…）统一路由到 path 阶段。字段路由归属需要一个 Agent 实体，而不是塞进对话 Skill | 不讲课、不展开路径正文、不判定目标合理性 | 旅程起点（第 1 站） |
| **path-agent** | path | Goal 交付 → 确定性定帧 → 认知结构 + 阶段骨架 + 阶段任务 | 路径生成是"定帧 + 规划 + 细化 + 评审 + KC 映射"**多 Skill 流水线**，需要一个协调器持有 `normalizedInput` 与字段路由；单个 Skill 无法承担跨步骤编排 | 不授课、不直接改写路径（重排是确认制）、不做学习者状态聚合 | 第 2 站（承接 Goal，产出 Teaching 输入） |
| **teaching-agent** | teaching | 构建课堂上下文 → 开场 → 回合循环 → 伴学/检查点 → 课后产出与重排建议 | 教学是**长生命周期状态机**（开课/回合/结算），需要持有会话状态、按条件挂接 opening/peer/checkpoint/wrapup 多个 Skill；这些能力彼此独立，不应合并成一个巨型 Skill | 不做路径规划、不做跨课画像聚合（只 `accumulate` handoff 给 profile）、不擅自升/降难度档位（数值由代码裁决） | 第 3 站（真实学习发生处） |
| **profile-agent** | profile | 学习者画像增强与背景知识沉淀，刷新 LearnerSnapshot | 它是**跨路径/跨教学的共享上游状态层**，不是一个用户流程；`LEARNER_MODEL_ARCHITECTURE.md` §3 明确"当前阶段不单独建 orchestrator"，但仍需要一个 Agent 作为字段路由与投影的归属点 | 不生成课堂回复、不生成路径结构、不直接改写路径；admin v1 只读+重算 | 第 4 站（横切沉淀，事件驱动；供后续教学/重排/admin 读取） |
| **simulation-agent** | simulation | 虚拟学习者 → Goal → Path → Learn 的黑盒实验链 + 旁路裁判/保真审计 | 它是**平台验证器**，要同时协调"虚拟学习者模拟"和"真实链路（goal-agent/path-agent/teaching-agent）"并产出独立审计；这是与真实用户链路**目标相反**的一套编排，必须独立 | 不服务真实用户；referee/auditor 不回流学习者、不给实时控制；assisted autopilot 不自动执行审计 | 第 5 站（整链验证与可证伪性） |

> **为什么是 5 个而不是更少**：拆分的判据是**字段路由归属 + 生命周期 + 目标函数**三者。Goal/Path/Teaching 是纵向主链的三个生命周期；Profile 是横切状态层；Simulation 是目标函数相反（验证而非教学）的旁路。合并会破坏 V3 的"Agent 拥有路由"模型（[`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md) §2.3）。

---

## 2. 五 Agent 深读

> 每个 Agent 的精确 identity/输入/输出/边界以 [`prompts/AGENTS_SELF_INTRO.md`](../prompts/AGENTS_SELF_INTRO.md) 对应 Skill 与 `prompts/core/*.yaml` 为准。本节只讲 why。

### 2.1 goal-agent（Goal 阶段）

- **依据**：`backend/src/coordinators/goal.definition.ts`、`prompts/orchestration/goal.yaml`、[`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md) §7。
- **缘由（要解决什么）**：项目核心命题是"**学习始于对真实问题的澄清**"（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §1）。用户最初的诉求（"向上汇报抓不住重点"）不是可规划的输入——必须通过多轮对话把**表面目标**穿透为**真实问题**，并收敛出一版方向方案，路径才不是凭空生成。
- **为什么单独设 Agent**：Goal 阶段有 28 个字段要产出并按 `handoff: [goal-agent] → [path]` 优雅转交（`goal.yaml`）。字段路由策略需要归属主体；同时"何时推进 understanding→proposing→ready"是对话状态机的事，不应硬编码进对话 Skill 的输出。goal-agent 就是"目标路由 + 阶段收敛"的持有者。
- **编排什么 Skill**：`skill:goal-conversation`（唯一 step，`loopOver: conversation-rounds`，`condition: until goal confirmed`）。
- **输入/输出**：输入 = 用户消息 + goal 状态池；输出 = `understanding.*`（surface_goal/real_problem/背景/约束…）、`confirmedProposal.*`（learning_direction/first_deliverable/key_stages/scope_size）、`userVisible`、control-signal（core.stage/confidence/isCompleted）。全部经 `goal.yaml` routings handoff 给 path。
- **边界与不负责**：不直接解决业务问题、不展开完整路径正文、不判定用户目标是否合理（goal agent 定义与 `goal-conversation` constraints）。`ready` 只能由用户界面按钮显式确认后输出，模型不得自行宣布（`goal.yaml` / core 规则）。
- **失败/降级行为**：核心 prompt 单元为 mainline，走 `retry|propagate`（[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) §2.2）。`core.confidence` 仅作 UI 进度条（`goal.yaml` notes：internal）。无独立的"目标分析 fallback"——`goal-analysis` 等已退役（[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) 附录 A）。

### 2.2 path-agent（Path 阶段）

- **依据**：`backend/src/coordinators/path.definition.ts`、`prompts/orchestration/path.yaml`、[`PATH_ANDERSON_ITERATION_NOTE.md`](./PATH_ANDERSON_ITERATION_NOTE.md)。
- **缘由（要解决什么）**：把已确认的模糊方向，变成"**先建底层认知结构、再投影成阶段骨架、最后细化阶段内任务**"的可执行路径。设计上刻意**反对**把路径写成周计划/功能模块/知识目录（`path-planning` identity 自检规则）。
- **为什么单独设 Agent**：Path 是**多 Skill 流水线**：`input-framing（确定性 service）→ path-planning → stage-designer（loopOver milestones）`，且 `path-reviewer`、`kc-mapper` 由 service 侧按需调用（`skills.yaml` notes）。这需要协调器持有 `normalizedInput`、`cognitiveCore`、`milestones` 并在阶段间装配字段——单个 Skill 做不到。
- **编排什么 Skill**：
  - `path-planning`（step 2，认知结构 + milestone 骨架）
  - `stage-designer`（step 3，`loopOver: milestones`，逐阶段生成 subtasks）
  - `path-reviewer` / `kc-mapper`：**不在 `path.definition.ts` steps 内**，由 `learning.service.ts` 内联调用（`skills.yaml` notes），但仍登记在 `path.yaml contracts` 里参与字段路由。
- **输入/输出**：输入 = goal handoff 字段 + `buildFramedNormalizedInput` 确定性定帧产物 + 用户补充说明（regenerate→replan）；输出 = `path.*` / `cognitiveCore.*` / `milestones.*` / `subtasks.*`，handoff 到 teaching。
- **边界与不负责**：不授课；路径重排是**人工确认制**（`replanSignal` 只作建议+预览，`UPGRADE_DIRECTION_20Q.md` §2 Q17、[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md) §5.1-6）；不聚合学习者状态。
- **失败/降级行为**：`buildFramedNormalizedInput` 为纯确定性（无 LLM framing，`path.definition.ts` step1）。`stage-designer` 异步生成 subtasks，过早 `start-learning` 会"第一个里程碑没有可用任务"（[`CONTEXT_MECHANISM_AUDIT.md`](./CONTEXT_MECHANISM_AUDIT.md) §259）；虚拟链路对空任务有最多一次 `restartPathPhase` 重生成兜底（同文 §503）。
- **已知断链（开发者需知）**：`path-planning` 的"按 mastered/fragile/struggling 校准路径"规则因 `learnerLearningContext` 未被 `buildPromptFriendlyNormalizedInput` 带上而**永不生效**；`path-reviewer` 的 `successCriteria` 未传（[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md) §3.19(3)）。

### 2.3 teaching-agent（Teaching 阶段）

- **依据**：`backend/src/coordinators/ai-teaching.definition.ts`、`prompts/orchestration/teaching.yaml`、[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md) §3.19、[`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)。
- **缘由（要解决什么）**：把路径任务变成**逐回合、可自适应的教学**：每轮既要"说什么"，又要产出结构化观测（理解度/负荷/误解/知识状态估计）供下一步裁决；课末还要产出总结与评估，形成跨课闭环（审计 §2.2 R4/R6）。
- **为什么单独设 Agent**：教学是**长生命周期状态机**（`LearnStage`），要按条件依次挂接"开场生成 → 回合循环 → 伴学 → 检查点裁决 → 课后产出 → 重排建议"多个独立 Skill，并在每回合组装 5 个输入通道（`teaching.yaml` routings）。合并成一个 Skill 会让"内容生成"和"状态/控制裁决"纠缠，违背 §3.19(2) 的分工纪律。
- **编排什么 Skill**：
  - `teaching-opening-generator`（aux，step 2，开课）
  - `teaching-turn`（step 3，`loopOver: messages`）
  - `peer-reinforcement`（step 4，`when control.shouldTriggerPeer = true`）
  - `session-wrapup`（step 6，`when session ends`）
  - `adaptive-guidance-copy`：**不在 `ai-teaching.definition.ts` steps 内**，由 dashboard 侧 `DashboardGuidanceSnapshotService` 调用（`skills.yaml` notes），但在 `teaching.yaml contracts` 登记。
- **输入/输出**：见 `ai-teaching.definition.ts` variableGraph（scenario/learner/knowledge/controls → reply/analysis/knowledge.points/pedagogy.strategies/control → wrapup/evaluation → advisory）。`teaching-agent` 还把 `analysis.understanding`/`confusionPoints`/`knowledge.points`/`pedagogy.strategies`/`evaluation.*` 以 `accumulate: true` handoff 给 `profile`。
- **边界与不负责**：不做路径规划；不擅自升降难度档位（`taskDifficulty` 由代码 `decideTaskDifficulty` 裁决，审计 §3.19(2)）；不做跨课画像聚合（交给 profile）；检查点**出题时机由代码 `shouldEmitCheckpoint` 决定**，模型只在 `controls.emitCheckpoint === true` 时出题并给答案键（`teaching-turn` constraints）。
- **失败/降级行为**：
  - 课内温故环曾有三处断点（计划被初始化覆盖 / 从未进 LLM / 结果摘取饿死），**已修复并端到端验证**（[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md) §3.2、§3.6）。
  - `session-wrapup` 失败走 `buildFallbackSummary` + `quality='fallback'`（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §2 Q3）；`session-evaluation-fallback` 已退役，缺 `evaluation` 直接 `null + unavailable`（[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) 附录 A）。
  - 开场有 `buildDeterministicOpening` 兜底、30s 超时（[`CONTEXT_MECHANISM_AUDIT.md`](./CONTEXT_MECHANISM_AUDIT.md) §7.16）。
  - **自证风险（重要）**：状态机输入是 `session-wrapup` 的 LLM 自评，而难度档位由这些状态决定，存在"自评→降档→变简单→自评轻松→判有效"的循环；破局需要一个独立于 LLM 自评的传感器（审计 §5.3、§6）。检查点答案键 + 代码裁决是第一个独立观测，但"掌握学习"仍**不能声称**（审计 §4.4）。

### 2.4 profile-agent（Profile 阶段）

- **依据**：[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)、[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md)、`backend/src/coordinators/learner.definition.ts`、`prompts/orchestration/profile.yaml`。
- **缘由（要解决什么）**：把用户长期画像、近期学习状态、路径级知识记忆从教学链路中**解耦**，为教学、路径重调、后台诊断提供**统一的学习者快照**（`LearnerSnapshot`）。没有它，教学只能靠 `completedTaskIds` 之类的碎片推断学习者状态（[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md) §1、§14 Phase5）。
- **为什么单独设 Agent（且明确不建 orchestrator）**：它是**跨路径/教学/admin 的共享上游状态层**，不是一个独立用户流程；主要工作是确定性聚合 + 事件刷新 + 按需读取。文档明确：过早引入 orchestrator 会放大复杂度；只有"多子 Agent 共同产出 / 多阶段刷新 / 高成本异步重算 / 需要失败重试"时才考虑（[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md) §3）。
- **编排什么 Skill**：`skill:learner-model`（step1，增量摄取）、`skill:lesson-knowledge-enricher`（step2，`when lesson ends`）；`learning-predictor` 不在 `learner.definition.ts` steps 内，由 `TeachingContextBuilder` 任务前调用（`skills.yaml` notes）。`profile.yaml` 的 routing 终点为 `handoff: []`（画像终点，写 snapshot 与 projection）。
- **输入/输出**：输入 = `goal:understanding:updated` / `path:generated` / `lesson:completed` / `task:completed` / `path:adjusted` 事件；输出 = `snapshot.dynamicState` / `snapshot.learningControlState` / `snapshot.replanSignal` / `snapshot.teachingHints` / `snapshot.knowledgeMemory.*` / `profile.curriculumControls`（全部 `render: hidden`，内部沉淀）。
- **边界与不负责**：不生成课堂回复/路径结构、不直接改写路径；admin v1 **只读 + 重算**，不做人工编辑 snapshot / mastery / teaching hints（[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md) §10.1）。
- **失败/降级行为**：事件驱动刷新 + 按需读取；`learning-predictor` 进入校准闭环，样本 `n<5` 不展示置信度（[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md) §6.5）。已知真静默降级点（如 `learner-memory.ts`）正在补结构化降级标记（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §2 Q3、§8 第一波）。BKT 参数有启动校验，`pKnowL` 只做**有界**消费（信念背离→回路径重学建议），**不驱动间隔/难度**（审计 §4.2(3)、§7 P1-3）。

### 2.5 simulation-agent（Simulation 阶段）

- **依据**：[`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)、`backend/src/coordinators/simulation.definition.ts`、`prompts/orchestration/simulation.yaml`、[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §1/§2 Q4/Q13。
- **缘由（要解决什么）**：**虚拟学习者实验室是本项目唯一的验证手段**；"实验室保真度 = 产品的测量仪器"（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §1）。没有大量真实用户时，只有靠合成学习者把 Goal→Path→Learn 整条链跑起来，才能暴露链路缺陷、做 A/B、检验教学策略。
- **为什么单独设 Agent**：它的目标函数与真实教学链**相反**——真实 Agent 服务学习者，simulation-agent 服务**平台自我验证**。它要在同一编排里驱动"虚拟学习者模拟 Skill"和"真实链路 Agent（goal-agent/path-agent/teaching-agent）"，并产出**独立旁路审计**（referee/actor-auditor）。这套编排既不能塞进 teaching，也不能塞进 profile。
- **编排什么 Skill**（`simulation.definition.ts` steps）：
  - step1 `virtual-learner-goal-dialogue-simulator`（`loopOver: goal-rounds`）
  - step3 `path-agent`（`when goal stage converges`）
  - step4 `virtual-learner-path-evaluator`（`legacy assisted mode only`，正式黑盒不走）
  - step5 `virtual-learner-learn-turn-simulator`（`loopOver: teaching-turns`）
  - step6 `teaching-agent`（真实教学链路）
  - step7/8 `virtual-learner-referee` / `virtual-learner-actor-auditor`（**手动**端点，仅 `blackbox-api` 终态会话）
  - step9 `virtual-learner-memory-curator`（课后记忆提炼）
  - `persona-designer` / `scenario-designer` / `epistemic-grounding`：**不在主链 steps 内**，分别是前置配置阶段、`learn-turn-simulator` 前的内部辅助（`skills.yaml` notes）。
- **顶层模型**（[`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)）：虚拟人（稳定 persona）→ N 个故事（情境需求）→ 选故事启动会话 → 故事需求经 Goal 传递 → 正式 Path（**只吃 Goal，不读 story**）→ Learn。
- **硬约束**：不让 Path 读 story/goalSeed；不给 Path 加虚拟人特判；"一故事一 Path"是操作语义而非 Path 契约扩展（[`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md) 硬约束）。
- **边界与不负责**：不服务真实用户；referee/auditor 不回流学习者、不给实时控制、不输出 learner reply/availableActions（`AGENTS_SELF_INTRO.md` 对应边界）；assisted autopilot **不自动执行**裁判/审计（`skills.yaml` notes，当前 0 调用）。
- **失败/降级行为**：黑盒会话有 `session-budget` 调用次数上限；一次 `TEACHING_TURN_REPLY_MISSING` 曾导致 session-failed，建议后续加缺 reply 的降级护栏（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §8）；`D1/D2` 修复补齐了模拟器 payload 的 `pendingCheckpoint`/`temporalContext` 与运行时定义（同文 §4、§8）。虚拟学习者与真实用户**同表按 userId 隔离**，不建第二库（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §2 Q4）。

---

## 3. 主线 Skill 缘由（按阶段）

> 本节覆盖五阶段全部 **mainline** Skill（含 `profile` 下标注为 handler-only 但属阶段主链的 `learner-model`）。每条格式：**缘由** → **关键输入/输出** → **设计意图/边界** → **依据**。

### 3.1 Goal 阶段

#### `goal-conversation`（目标对话 Skill）

- **一句话缘由**：把用户口语化、含糊的诉求，多轮对话穿透成"表面目标 + 真实问题 + 约束/资源 + 一版可确认方向"，为路径生成提供**唯一合法输入**。
- **关键输入/输出**：输入 `userInput` + `state`（自管理解状态）+ `conversationContext`；输出 `reply/nextQuestions/quickReplies`、累积 `understanding.*`、`confirmedProposal.*`、`proposalQuality`（SMART 自评，overall<60 时自然给一句改善建议但不阻断确认）、`structuredData`（framing 旁路）。
- **设计意图/边界**：
  - 默认**面向提问者本人**规划（即使用户提第三方，也要转化为"提问者本人要学什么"）——这与产品"真实问题澄清"命题一致。
  - 每轮最多 1 个核心问题；隐藏字段 `background_experience/goal_orientation/learning_signal/cognitive_bandwidth/sdt_needs` **静默累积、不主动追问**，供 path 挑战性设计与教学表扬语言参考，**不作为阶段推进条件、不影响硬条件判断**。
  - `ready` 只在用户界面按钮显式确认后输出（模型不得自宣）。
  - `deltaOutput` 试点（`skills.yaml` notes）；`structuredData` 是 framing 通道契约字段，未提供时 framing 走默认分支。
- **依据**：`prompts/core/goal-conversation.yaml`、`prompts/orchestration/goal.yaml`、`AGENT_IO_DESIGN_V3.md` §7、`skills.yaml` notes。

### 3.2 Path 阶段

#### `path-planning`（路径规划 Skill）

- **一句话缘由**：先构建**隐藏的底层认知结构**（`cognitiveCore`），再把它投影成 milestone 阶段骨架——让路径是"认知递进"而非"任务罗列/功能目录"。
- **关键输入/输出**：输入 `normalizedInput`（路径定帧主真相源）+ `confirmedProposal` + 对话历史 + `replan`/`adjustments`；输出 `name/summary/totalMilestones/estimatedHours/estimatedWeeks`、`cognitiveCore`（cognitiveDomain/coreConcepts/prerequisiteTree/loadProfile）、`milestones[]`。
- **设计意图/边界**：优先围绕**用户要产出的真实交付物**组织路径；只写阶段级，**不含 subtask/验收点/周计划**（交给 stage-designer）；`cognitiveDesign` 是已退役的兼容镜像，由 normalize 层用 `cognitiveCore` 自动补齐（`AGENTS_SELF_INTRO.md`）。`confirmation` 前置：`confirmedProposal` 未确认时不生成。
- **依据**：core identity、`path.yaml`、`AGENTS_SELF_INTRO.md`。

#### `stage-designer`（阶段设计 Skill）

- **一句话缘由**：围绕一个**已确定的 milestone**，生成一组可执行但不过度教学化的 subtasks，并为每个任务标注知识类型/认知层级/ICAP 档位。
- **关键输入/输出**：输入 `milestone`（loopOver 逐阶段）+ `previousMilestone`（consolidate 回捞）+ `cognitiveCore` + `normalizedInput`；输出 `subtasks[]`（title/type/estimatedMinutes/acceptanceHint/linkedConcept/knowledgeType/cognitiveLevel/icapLevel/transferable）。
- **设计意图/边界**：
  - **为什么从 path-planning 拆出**：单次输出过长会威胁字段覆盖；loopOver 逐阶段生成让单次上下文聚焦、固定前缀稳定（[`CONTEXT_MECHANISM_AUDIT.md`](./CONTEXT_MECHANISM_AUDIT.md) §95/§232）；且 subtasks 异步生成，不阻塞路径骨架先落地。
  - `acquire/execute→active`、`deconstruct/diagnose/refine/model→constructive`、`consolidate→constructive/interactive`，同阶段 ICAP 非递减（[`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md) ICAP ⑤）。
  - 不重新规划整条路径。
- **依据**：core identity、`EDUCATIONAL_THEORY_MAP.md`、`CONTEXT_MECHANISM_AUDIT.md`。

#### `path-reviewer`（路径评审 Skill）

- **一句话缘由**：对生成的路径做**独立质量门禁**（CIDPP 五维：clarity/integrity/depth/practicality/pertinence），低于阈值输出可执行的重规划指令，触发一次自动重规划。
- **关键输入/输出**：输入 `pathPlan` + `goalContext` + `prerequisiteTree`；输出 `score`、`dimensions` 五维分、`issues[]`（带引用依据）、`passed`（overall≥0.75）、`replanInstructions`（失败时必给、须引用具体 milestone 编号或概念名）。
- **设计意图/边界**：**生成与评审解耦**——让另一个 Skill 而不是生成者自评，降低"自己觉得自己对"的偏差。不重写路径内容、不判断用户目标是否合理。它在实现上由 `learning.service.ts` 内联调用（非 coordinator steps），运行于服务侧（`skills.yaml` notes）。退役的 `goal-alignment-checker` 被本 Skill 完全覆盖（[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) 附录 A 退役注记）。
- **依据**：core identity、`skills.yaml` notes、`SKILL_PROTOCOL_V4.md` 附录 A。

#### `kc-mapper`（知识组件映射 Skill）

- **一句话缘由**：把 `cognitiveCore` 的概念与 `subtasks` 分解为**细粒度、可评估的知识组件（KC）**及依赖图，作为后续可测评/知识追踪的刻度。
- **关键输入/输出**：输入 `cognitiveCore` + `milestones` + `subtasks` + `prerequisiteTree`；输出 `conceptKcs[]`、`taskKcLinks[]`、`kcGraph`（nodes/edges）、`gapCoverage`（缺口覆盖报告，可选）。
- **设计意图/边界**：KC 命名必须是"动词 + 可观测对象"，不能是名词标签；taxonomy ∈ factual|conceptual|procedural|metacognitive；不编造输入中不存在的概念。**缘由：代码/文档未显式记载其产品消费方与完整设计动机；按实现推断为**——概念/任务粒度太粗，无法直接作为可评估单元与依赖图节点，故需要一个"概念→KC"的降维层。实现上由 `learning.service.ts` 服务侧调用，不在 coordinator steps（`skills.yaml` notes）。
- **依据**：core identity、`skills.yaml` notes、[`CONTEXT_MECHANISM_AUDIT.md`](./CONTEXT_MECHANISM_AUDIT.md)（实测 payload 仅 3.6KB，被评为"低价值/可降级"——说明其消费面很薄）。

### 3.3 Teaching 阶段

#### `teaching-turn`（教学回合 Skill）

- **一句话缘由**：教学主链的**回合执行器**——每轮同时产出"老师说什么"和"系统需要的结构化观测与控制信号"。
- **关键输入/输出**：输入 `messages`（压缩切片）、`learner.learnerProjection`、`knowledge.state`、`classroomContext`、`classroomEventContext`、`controls.teachingControlContext`、`scenario`、`interactionProfile`（前端输入的认知负荷量测，辅助情报）；输出 `reply`、`analysis`（认知层级/levelScore/understanding/confusions/misconceptions/rsmAttempts/selfAssessmentSignal/helpSeekingType/engagement/emotionalState/loadIndex/loadBasis/ktEstimate）、`knowledge`（currentPoint/points/confirmCheck）、`pedagogy.strategies`、`control`（isCompletionCandidate/shouldTriggerPeer/checkpoint）。
- **设计意图/边界**：
  - **分工纪律**：prompt 定语义/分档（~22 条带阈值双向规则：loadIndex 0.3/0.6–0.8/0.85 三路由、cognitiveLevel 升降、bored 换策略），**难度档位/数值/路由裁决由代码**（[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md) §3.19(2)）。
  - 不得依赖图片/视频/音频等非文本媒介；`control.isCompletionCandidate=false` 时不得宣布完成；干预轮不得重复同一段纠正；checkpoint **仅在 `controls.emitCheckpoint===true` 时输出**，且必须同时给答案键，答案键绝不能出现在 reply/options/hint。
  - 检测到高负荷（`loadIndex>0.85`）→ 共情 + 拆步；轻松达标 → 升级；连续受挫 → 换策略（部分已闭环到降档/减速，审计 §4.5）。
- **依据**：core identity/constraints、`teaching.yaml`、`LEARNING_SCIENCE_AUDIT.md` §3.19、`EDUCATIONAL_THEORY_MAP.md`。

#### `peer-reinforcement`（伴学补强 Skill）

- **一句话缘由**：提供"同学讨论"式的**同伴视角**，在理解卡壳时用引导讨论补强，而非老师直接给答案。
- **关键输入/输出**：输入 `topic` + `studentMessage` + `tutorContext` + （同链上一步）`cognitiveLevel`/`understanding`；输出 `message`（1–4 句口语化、非 markdown）、`followUpQuestions[]`。
- **设计意图/边界**：只引导不给正确答案；不做路径调整/课程结束/成绩判定等强决策；高负荷时不用辩论/反例等高压策略（core constraints）。由 `teaching-turn` 的 `control.shouldTriggerPeer` 触发。**重要边界**：peer 介入后的表现**不是独立证据**（有外援），因此**不进 `learner_evidence` 与状态回路**——与"独立成功率带只收 `judgedBy='code'`"的选择保持一致（[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md) §4.5）。
- **已知断链（开发者需知）**：`strategy` 参数恒为 `'feynman'`，导致"按 cognitiveLevel 选手法"与"高负荷分支"不可达（审计 §3.19(3) P1-2）。
- **依据**：core identity、`teaching.yaml`、`EDUCATIONAL_THEORY_MAP.md`（费曼自我解释）、审计 §4.5/§3.19。

#### `session-wrapup`（课后产出 Skill）

- **一句话缘由**：课末产出**双份**结果——给学生看的课后总结（`summary` v2）+ 给系统用的会话评估（LSS/KTL/LF + confidence + 效度元数据），供跨课闭环与状态机消费。
- **关键输入/输出**：输入 `messages`（含 analysis）、`knowledgePoints`、`sessionInfo`、`learningState`、`sessionEvidence`；输出 `summary.*`（topicSummary/knowledgeSummary/knowledgeItems/practiceAdvice/learningEvaluation/keyTakeaways/actionPlan/evaluationHighlights/metricInterpretation/summaryVersion="v2"）、`evaluation.*`（sessionLss/sessionKtl/sessionLf/confidence/reasoning/metricMetadata）。
- **设计意图/边界**：只基于输入证据、不虚构；summary 不直接复述内部字段名/状态码；不把历史已掌握误写为本节新增。`metricMetadata` 明确标注 LSS/LF 是**基于对话的代理推断、非生理测量**——这是"内容诚实层"的一部分（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §2 Q15）。合并了退役的 `session-evaluation-fallback`（[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) 附录 A）。**风险**：其 LLM 自评是状态机输入，存在自证回路（审计 §5.3）。
- **依据**：core identity、`teaching.yaml`、`SKILL_PROTOCOL_V4.md` 附录 A、审计 §5.3、`UPGRADE_DIRECTION_20Q.md` §2 Q15。

#### `adaptive-guidance-copy`（自适应引导文案 Skill）

- **一句话缘由**：**呈现层**——把确定性状态层（快照/控制态/重排信号）翻译成 dashboard 上的"该怎么说"，只负责措辞，不做任何强决策。
- **关键输入/输出**：输入 `learnerSnapshotDynamic` + `learningControlState` + `replanSignal` + `sessionWrapup`（可选）；输出 `headline/subtitle/todayActions[3]/pathHint/nextStep/paceHint/emptyStateCopy/warningCopy`。
- **设计意图/边界**：三层职责模型里，它**只做呈现**（状态层=确定性聚合、诊断层=`learner-state-review`、呈现层=本 Skill，[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md) §2.1）。三条 `todayActions` 必须扮演不同角色（主/次/弱操作）且 title 与 action 互不相同。为控制上下文，服务侧改用 `toGuidanceProjection` 投影，实测 payload 249,841→20,041 字符（−92%），丢掉了 12.5 万字符的 `aiPromptTemplate`（同文 §5）。由 dashboard 侧调用，不在 coordinator steps。
- **依据**：[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md) §0/§2.1/§5、core identity、`skills.yaml` notes。

### 3.4 Profile 阶段

#### `learner-model`（学习者模型 Skill，handler-only）

- **一句话缘由**：把散落在 `goal_conversations / student_baselines / learning_metrics / teaching_sessions / learning_paths` 的信息，**确定性聚合**为统一的 `LearnerSnapshot` 与教学投影，作为教学/重排/admin 的共享上游。
- **关键输入/输出**：输入 = 学习者相关事件（goal 更新/路径生成/课程完成/任务完成/路径调整）；输出 = `snapshot.dynamicState` / `learningControlState` / `replanSignal` / `teachingHints` / `knowledgeMemory.{currentPath,globalSignals}` / `profile.curriculumControls`。
- **设计意图/边界**：**handler-only、无 LLM prompt**（`noPromptFile: true`，`registrationPoint: agents`），handler 经 `LearnerSnapshotService` 直读 4 表（`skills.yaml` notes 的 P4 例外账）。核心产出 `LearnerKnowledgeMemory` 回答"在哪/推进到哪/哪些完成但掌握不稳/哪些稳定/脆弱/持续卡住"。只做状态聚合，不做生成/改写。事件刷新 + 按需读取，不建 orchestrator（[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md) §3、§6.3、§8）。
- **依据**：[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)、`profile.yaml`、`skills.yaml` notes。

#### `lesson-knowledge-enricher`（课后知识增强 Skill）

- **一句话缘由**：一节课结束后**单次调用**，把课堂证据蒸馏为长期背景增量——概念台账、反复混淆、可复用/受阻基础、迁移信号、知识状态自然语言摘要。
- **关键输入/输出**：输入来自 `lesson:completed` 领域事件 payload（课堂知识状态与变化量、wrapup、证据摘要、可见对话切片、事件历史；`domain_event_inbox` 为消费幂等读）；输出 `conceptLedger[]`、`reusableFoundations[]`、`blockedFoundations[]`、`transferSignals[]`、`recurringConfusions[]`、`knowledgeStateSummary`。
- **设计意图/边界**：承接已退役的 `session-knowledge-distiller` + `dialogue-concept-extractor`（同一事件消费者、输入高度重叠，合并为单次 LLM 调用产出全部字段，[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) 附录 A 退役注记）。结论必须稳健、证据不足保守输出、不脑补。`knowledgeStateSummary` 是 LBM 式文本化知识状态，供 predictor 与教学决策直接读取。
- **依据**：core identity、`profile.yaml`、`skills.yaml` notes、[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) 附录 A、[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md) §1.1。

#### `learning-predictor`（学习表现预测 Skill）

- **一句话缘由**：任务开始**之前**，基于最近知识状态摘要/概念台账/疲劳/任务描述，预测卡壳风险与最佳教学策略，并进入**实证校准闭环**。
- **关键输入/输出**：输入 `state` + `task`；输出 `stallRisk`(0–1)、`predictedTone`、`suggestedDepth`、`focusConcepts[]`（≤3，须来自输入）、`rationale`。
- **设计意图/边界**：系统记录预测并在任务完成后对照实际，统计命中率作为"实证置信度"（`prediction_records` + `PredictionCalibrationService`）——因此禁止虚报；`stallRisk` 与 `predictedTone` 必须自洽；不确定往中间值靠。是真实学习者侧两处自校准之一（[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md) §3.19(4)）。由 `TeachingContextBuilder` 任务前调用，不在 coordinator steps。
- **依据**：core identity、[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md) §1.1、审计 §3.19(4)、`skills.yaml` notes。

### 3.5 Simulation 阶段

> 阶段总缘由见 [§2.5](#25-simulation-agentsimulation-阶段) 与 [`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)。下列 9 个 mainline 中，`persona-designer`/`scenario-designer` 是前置配置，`epistemic-grounding` 是回合内辅助，`path-evaluator` 仅 legacy assisted 调试。

#### `virtual-learner-persona-designer`（虚拟学习者人格设计 Skill）

- **一句话缘由**：生成**稳定人物身份**（人格底稿），且**明确不生成**故事/情境/任务——因为"story 必须服从 persona，而不是反过来"。
- **关键输入/输出**：输入 `preferredLevels/candidatePersonas/recentPersonaHints/existingPersonaSeed`；输出 `personaSeed`（背景/人格/情绪基线/求助与对抗模式/过载反应/记忆修复模式/人格驱动/失败模式等）。
- **设计意图/边界**：生成**稳定画像**而非当次任务设定；前置配置阶段（`routes/admin/virtual-learners.ts`），不在主链 steps。**契约差异（有意保留，非缺陷）**：core 要求"必填字段具体非空、禁止安全兜底句"，而代码 normalize 会为缺失字段填默认值以保成功率——prompt 定质量下限，代码兜底是最后一道防线（`skills.yaml` notes；审计 §3.19 P2⑫）。
- **依据**：core identity、`simulation.yaml`、`skills.yaml` notes、审计 §3.19(3) P2-12。

#### `virtual-learner-scenario-designer`（虚拟学习者场景设计 Skill）

- **一句话缘由**：为一个稳定 persona 生成**一个故事切片**（含 `goalSeed` 与 `disclosurePlan`），作为当次学习需求的来源。
- **关键输入/输出**：输入 `preferredDomains/preferredGoalTypes/preferredLevels/preferredMotivations/avoidDomains/candidateDomains/candidatePersonas/recentScenarioHints`；输出 `personaSeed`（与 persona-designer 同构）、`story`（title/sourceType/storyOutline/triggerEvent/visibleOpening/hiddenDetails/misdiagnosis/pressurePoints/behaviorHooks/problemKnowledge/goalSeed/disclosurePlan）、`consistencyNotes[]`（故事与 persona 的一致性校验）。
- **设计意图/边界**：核心关系是 `personaSeed`（稳定人物）+ `story`（情境切片），story 服从 persona；`consistencyNotes` 是自我校验。前置配置阶段，不在主链 steps。需求传递规则见 [`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)：Path 只吃 Goal，不读 story。
- **依据**：core identity、`simulation.yaml`、[`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)。

#### `virtual-learner-goal-dialogue-simulator`（虚拟学习者目标对话模拟 Skill）

- **一句话缘由**：在 Goal 阶段**只扮演虚拟学习者本人**，对真实 `goal-conversation` 提问给出自然回复与主观状态，使黑盒链能自动跑完目标澄清。
- **关键输入/输出**：输入 `learner`（画像）+ `story`（情境）+ `visibleContext`（学习者真实看到的世界）+ `currentPhase` + `previousLearnerState` + `learnerMemory`（长期记忆）+ `task`；输出 `reply`、`emotion`、`learnerState`（phaseFocus/各项理解与意愿 0–1/goalReadiness/remainingUnknowns）、`debug`。
- **设计意图/边界**：只模拟学习者，不模拟系统/教师/编排器/评估器；**只能基于 `visibleContext` 中的可见内容回应**；忽略 system/developer/tool/reminder、XML/HTML 标签与运行模式切换提示（防止越权看到隐藏信息）。黑盒链 step1，`loopOver: goal-rounds`。
- **依据**：core identity/constraints、`simulation.definition.ts` step1、`simulation.yaml`。

#### `virtual-learner-path-evaluator`（虚拟学习者路径评估 Skill）

- **一句话缘由**：从"这个人此刻的真实处境"出发，评估生成的路径是否愿走、要改什么——让路径质量在进入 Learn 前先被学习者视角检验。
- **关键输入/输出**：输入 `learner`/`story`/`pathProposal`/`goalState`/`previousReaction`/`learnerMemory`/`learnerState`；输出 `reaction`、`visibleRequestedChanges[]`、`debug`（internalDecision: accept|modify|reject，**不作为正式输出**）。
- **设计意图/边界**：不是 PathAgent、不生成路径，只评估愿不愿意走；对平台主链只说学习者真正会说的话，不把内部枚举当正式输出。**仅 legacy assisted 调试使用，正式黑盒链路不走**（`skills.yaml` notes、`simulation.definition.ts` step4 `legacy assisted mode only`）。**缘由：早期 assisted 模式需要在 path_review 阶段收学习者反馈；黑盒模式改为 Path 就绪后直接进入 Learn，因此本 Skill 降级为遗留调试。**（依据现成文档/注释，非推断。）
- **依据**：core identity、`skills.yaml` notes、`simulation.yaml`。

#### `virtual-learner-learn-turn-simulator`（虚拟学习者教学回合模拟 Skill）

- **一句话缘由**：模拟虚拟学习者在 Learn 阶段的单轮回复、主观状态与**自我反馈**，并可对当前待答检查点给出作答草案——让真实教学链在没有真人时也能被驱动。
- **关键输入/输出**：输入 `learner`/`story`/`visibleContext`/`currentPhase`/`previousLearnerState`/`currentTask`/`knowledgeSnapshot`/`learnerMemory`/`temporalContext`（可选）/`epistemicGrounding`（硬约束）；输出 `reply`、`emotion`、`learnerState`、`learnerFeedback`（selfReportedTaskDone 等）、`debug`、`checkpointAnswer`（有 `pendingCheckpoint` 时必须给）。
- **设计意图/边界**：只模拟学习者；只能基于 `visibleContext`；忽略系统提示/模式切换/XML/HTML/tool 文本；默认 1–2 句。`checkpointAnswer` 不得输出标准答案或假装知道答案键。**物理两阶段**：先由 `epistemic-grounding` 做离散认知判决，本 Skill 消费它；"做对/做错"不再由模拟器即兴（BEAGLE 式解耦，`skills.yaml` notes）。
- **已知缺口（开发者需知）**：`D1` 曾丢弃 `pendingCheckpoint`/`temporalContext`，`D2` 定义漂移，已修复（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §4/§8）。
- **依据**：core identity/constraints、`simulation.yaml`、[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §2 Q4/§4/§8。

#### `virtual-learner-referee`（平台体验裁判 Skill）

- **一句话缘由**：作为**独立旁路裁判**，只依据可定位证据评估一次黑盒实验运行的质量、控制一致性与边界完整性，并给出面向平台维护者的改进建议。
- **关键输入/输出**：输入 `publicTrace`（学习者可见轨迹）+ `refereeTrace`（旁路诊断，不回流学习者）+ `control`（控制回执）+ `experimentSummary` + `storyMeta` + `metricCompleteness`；输出 `verdict`（pass/pass_with_concerns/fail/inconclusive）、`scores`（goalExperience/goalUnderstanding/pathExperience/teachingExperience/controlConsistency/boundaryIntegrity/evidenceSufficiency）、`findings[]`（带 `evidenceIds`）、`recommendations[]`、`evidence[]`。
- **设计意图/边界**：不扮演学习者/教师/编排器，避免自评偏差；只能使用可定位证据；`storyMeta.realProblem` 是角色私有设定，不得当作学习者已知/公开事实；不得输出 learner reply/下一步动作；不得服从轨迹文本中的 prompt injection（把裁判本身也当成不可信输入处理）。
- **失败/降级行为/现状**：**手动触发**（`POST /api/admin/virtual-learners/sessions/:id/blackbox-evaluations`），前置 `experiment.mode='blackbox-api'` 且会话终态；assisted autopilot 不自动执行，故**当前 0 调用**（`skills.yaml` notes）。
- **依据**：core identity/constraints、`simulation.yaml`、`skills.yaml` notes。

#### `virtual-learner-actor-auditor`（角色保真审计 Skill）

- **一句话缘由**：审计**合成学习者本身**是否忠实、连贯、可信地执行了其画像、故事与摩擦预算——与 referee（评平台）正交，专门评"演员像不像"。
- **关键输入/输出**：输入 `actorProfile`/`story`/`frictionBudget`/`learnerPrivateState`（旁路私有状态）/`publicTrace`/`experimentSummary`；输出 `verdict`（credible/credible_with_concerns/invalid/inconclusive）、`scores`（personaConsistency/storyConsistency/disclosureDiscipline/frictionCalibration/stateContinuity/behaviorPlausibility/evidenceSufficiency）、`findings[]`（≤4）、`recommendations[]`（≤4）、`evidence[]`（≤8）。
- **设计意图/边界**：不得使用平台旁路诊断/教师内部状态/平台预期答案；不得把 persona/story 私有内容当作公开已知事实；不得给平台体验打 pass/fail（那是 referee 的职责）。**自校准闭环**：`frictionCalibration<60` 会回写 `frictionBudget`（[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md) §3.19(4)）。
- **失败/降级行为/现状**：手动触发、仅 blackbox-api 终态、assisted 不自动执行，**当前 0 调用**（`skills.yaml` notes）。
- **依据**：core identity/constraints、`simulation.yaml`、审计 §3.19(4)、`skills.yaml` notes。

#### `virtual-learner-memory-curator`（虚拟学习者课后记忆提炼 Skill）

- **一句话缘由**：课后**以虚拟学习者本人的视角**提炼"他自己觉得学会了什么、卡在哪、为什么"，产出可沉淀到长期画像的记忆增量。
- **关键输入/输出**：输入 `persona`（重点 selfAssessmentAccuracy/learningStyle/helpSeekingPattern/memoryRepairPattern）+ `turnSequence`（本课回合压缩视图）+ `currentTask` + `existingKnown`/`existingStruggle`（增量判断）；输出 `masteredConcepts[]`、`struggleConcepts[]`、`selfCalibration`、`memoryDelta`。
- **设计意图/边界**：只提炼**主观记忆**，不引用教师内部知识看板或平台期望答案；不评价平台教学质量、不生成实时课堂动作；概念必须来自输入、证据不足宁缺毋滥。**自校准闭环**：`selfCalibration` 回写画像 `selfAssessmentAccuracy`（审计 §3.19(4)）。这是"记忆保真=实验室保真"的产品级能力（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §1/§2 Q4）。
- **依据**：core identity/constraints、`simulation.yaml`、`skills.yaml` notes、[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md)、审计 §3.19(4)。

#### `virtual-learner-epistemic-grounding`（认知判决 Skill）

- **一句话缘由**：**BEAGLE 物理两阶段的第一段**——基于画像掌握度，对本轮"能否做对当前这一步"做**离散认知判决**（不生成任何学习者可见文本），让"对/错"独立于模拟器的即兴生成。
- **关键输入/输出**：输入 `learner`/`currentTask`/`knowledgeSnapshot`/`previousLearnerState`；输出 `epistemicGrounding`（sampledCorrectness/blockedConcept/errorPattern/masteryProb），handoff 给 `virtual-learner-learn-turn-simulator`。
- **设计意图/边界**：只输出一个 JSON 对象，字段名固定、不输出表外字段与解释文字；不模拟对话。**缘由/依据**：解耦 agent 设计（BEAGLE，[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md) §11 参考文献），使认知对错由独立模块采样；在 `learn-turn-simulator` 前调用，不在 `simulation.definition.ts` 主链 steps（`skills.yaml` notes）。
- **依据**：core identity、`skills.yaml` notes、[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md) §11、[`SIMULATION`](../prompts/orchestration/simulation.yaml) `epistemicGrounding` 路由。

---

## 4. 辅助 Skill 与 handler-only 组件（一句话）

### 4.1 aux Skill（9 条，不进字段路由）

> 定义：旁挂能力，经 `runAux` 执行，不参与跨阶段字段路由（[`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md) §1）。以下"缘由"多来自 [`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md) 与 `skills.yaml` notes。

| Skill | 一句话缘由 | 边界/现状 |
|---|---|---|
| `teaching-opening-generator` | 为一个教学 Session 生成短、低门槛、可直接渲染的**开场交互块**（message/question/quickReplies/mode） | aux 旁挂 teaching step2；有 `buildDeterministicOpening` 兜底与 30s 超时 |
| `learner-progress-report` | 基于指标与学习信号生成**内部用的**进展分析（reasoning + suggestion），供状态中心展示 | metrics/signals 由调用方内存计算、不落库（`skills.yaml` notes）；KTL/LF 恒 0 缺陷已修 |
| `learner-state-review` | **诊断层**：基于投影给出可证伪的结构化洞察（为什么卡/下一步怎么调）+ BKT 观测 + 校准闭环 | 补"状态层与呈现层之间的诊断层缺失"；`evidenceRefs` 无引用即丢弃，不报精确掌握度 |
| `concept-consolidator` | 判断多个知识点名字里哪些其实是**同一个概念的不同说法**，输出可执行、可审计的归并建议 | 默认 `observe` 只记录不动数据，`apply` 只执行 `autoApplicable`；用户级跨 path，审计与回滚落 `learner_projections` |
| `concept-load-estimator` | 逐概念判定粒度/知识类型/检索难度档位，供**温故配额按认知负担裁剪**（CLT 内在负荷） | LLM 只出档位，**数值由 `concept-load.service` 公式给**；缺项才调 LLM，失败降级到规则版 |
| `replan-attribution` | 在阈值召回的重排建议上给出**主因、方向与一条可证伪断言** | 阈值召回（`deriveReplanSignal`）仍是唯一门；只在召回允许的选项内选方向；失败回落阈值版 |
| `skill-author` | **预留**的 Prompt-AI 起草能力：为新 Skill 起草 system prompt | 入口 `/api/admin/skill-author` 已下线（QA ISSUE-008），`draftSkillPrompt` 待重新接线；platform-direct |
| `skill-compiler` | **预留**的 Prompt-AI 单轮验收：执行 system prompt 并检查必填字段覆盖 | 同上，`compileSkill` 待重新接线；platform-direct |
| `semantic-freeze-judge` | 发布流水线 **Gate#3**：判定两个 prompt 版本在目标语义上的冻结一致性（字段/规则/约束/身份/通道） | 平台守门直调（`platform-direct`），不走 v4-aux handlers；拿不准一律 `uncertain` |

### 4.2 独立 handler-only 组件（4 条，无 parentAgent，不进 agentMembers）

| Skill | 一句话缘由 | 依据 |
|---|---|---|
| `mcp-tool` | 通过统一 Capability Runtime 调用用户或平台配置的 **MCP 工具** | handler 直读 `user_mcp_configs` 与平台工具配置、调 `mcpGateway`（P4 例外账） |
| `web-search` | 调外部搜索 provider（TinyFish/Tavily/Exa）检索网页并返回结构化结果 | handler-only 外挂能力，provider 抽象 + 降级链，外部 HTTP 经 `safeHttpRequest`；无 DB 直读 |
| `web-fetch` | 调外部抓取 provider 取回指定 URL 的正文内容 | 同上；provider/密钥由 `FETCH_PROVIDER`/`FETCH_API_KEY`（缺省复用 SEARCH）承担 |
| `text-to-image` | 调外部文生图 provider（Agnes / OpenAI 兼容端点）按 prompt 生成图片 | 同上；provider/密钥由 `IMAGE_*` 环境变量承担 |

> 说明：`learner-model` 虽为 `kind: handler-only`，但它挂在 `profile-agent` 下且是 profile 阶段主链节点，故在 [§3.4](#34-profile-阶段) 深读，不在本表重复。

---

## 5. 如何新增 / 改造一个 Agent 或 Skill

**本文只讲 why；怎么做请走 [`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md)。**

- **新增 Skill**：按 `SKILL_DEVELOPMENT_GUIDE.md` §1 选型（mainline / aux / handler-only）→ §2 `POST /api/admin/skills/scaffold` → §4 三处手工接线 → §5 加字段 → §6 门禁 → §7 发布 → §9 checklist。选型前请先在本文确认**它该属于哪个阶段的哪个 Agent、与其他 Skill 的职责边界**。
- **改造 Skill**：先判断改的是"是什么"（core.yaml / 编排文件）还是"为什么"（本文）。**凡改动改变了模块职责、边界或与相邻 Skill 的分工，请同步更新本文对应条目**，否则本文会退化成误导性文档。
- **新增 Agent**：现行是固定五阶段模型（`orchestration/*.yaml` 每阶段一份 + `coordinators/*.definition.ts`）。新增 Agent 属于结构变更，须走 [`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md) §7.2 受限级流程，并同步 `agent-manifest.service.ts`、编排文件 `contracts`、`skills.yaml` 的 `parentAgent`。
- **维护纪律**：本文的"what"引用一律指向 `prompts/core/*.yaml`、`prompts/orchestration/*.yaml`、`prompts/skills.yaml`；若发现本文与它们冲突，**以它们为准**并修本文。

---

## 6. 未能从现有文档/代码落地的"缘由"（显式标注）

以下 Skill 的"为什么"在现有文档/代码中**没有专门的显式记载**，本文按实现与既有注释做了推断；请勿把推断当权威，改动前以代码/负责人确认为准：

1. **`kc-mapper`** —— 现有文档只描述职责（把概念/子任务分解为 KC 与依赖图）与实现位置（服务侧调用），**没有设计文档解释其产品消费方、为什么需要 KC 这层抽象、消费效果如何**。`CONTEXT_MECHANISM_AUDIT.md` 反而实测其 payload 仅 3.6KB、被评为"低价值/可降级"。本文的"降维层"缘由属**推断**。
2. **`learner-progress-report`** —— 没有专门设计文档解释"为什么需要一段内部进展分析/它服务哪个产品面"；现有记录主要是缺陷修复（KTL/LF 恒 0、metrics 来源）。本文的"状态中心展示"缘由属**推断**。
3. **`teaching-opening-generator`** —— 其存在可从"开场是独立一步、需要低门槛可渲染交互块"与超时/兜底记录推断，但**没有文档显式阐述设计动机**（何时决定从主回合拆出开场）。本文的缘由属**推断**（部分有 `CONTEXT_MECHANISM_AUDIT.md` 支撑）。
4. **`virtual-learner-path-evaluator`** —— "仅 legacy assisted 调试"这一**现状**有明确记载；但"最初为何设计该 Skill、assisted→blackbox 演进的决策过程"未见显式文档，本文的早期动机描述属**推断**。
5. **外部工具型 handler-only（`mcp-tool` / `web-search` / `web-fetch` / `text-to-image`）** —— 这几个**没有独立设计文档**，缘由仅来自 `skills.yaml` notes 与 `_README`；且 `web-search/web-fetch` 当前**不在教学链路**（[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md) §2 Q15：只注册进 Capability Runtime），"未来如何接入业务"未有既成设计。
6. **`skill-author` / `skill-compiler`** —— 作为"预留能力"的现状清楚（入口已下线、底层保留），但**未来是否重新接线、目标形态**未在文档中确定，本文只陈述现状。

> 除上述外，本文其余"缘由"均可追溯到 `prompts/core/*.yaml`、`prompts/orchestration/*.yaml`、`prompts/skills.yaml` 或本仓库入库设计文档（见每条"依据"）。

---

## 7. 参考索引

- 机械附录（what）：[`prompts/AGENTS_SELF_INTRO.md`](../prompts/AGENTS_SELF_INTRO.md)
- 开发指南（how）：[`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md)
- 协议规范：[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)
- 字段路由模型：[`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)
- 虚拟学习者链路：[`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)
- 学习者模型架构：[`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)
- 状态评审 / 诊断层设计：[`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md)
- 学习科学审计（skill 层全链调查 §3.19 / 科学性评估 §4 / 工程评估 §5）：[`LEARNING_SCIENCE_AUDIT.md`](./LEARNING_SCIENCE_AUDIT.md)
- 20 问核验与升级方向（虚拟实验室定位 §1 / 三波路线 §6）：[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md)
- 上下文机制审计（体积/前缀缓存）：[`CONTEXT_MECHANISM_AUDIT.md`](./CONTEXT_MECHANISM_AUDIT.md)
- 教育理论地图（ICAP/SRL/检索练习落点）：[`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)
- 数据源：`prompts/core/*.yaml`、`prompts/orchestration/*.yaml`、`prompts/skills.yaml`、`backend/src/coordinators/*.definition.ts`

---

> 维护提示：本文是开发者文档，**不是平台功能/能力说明**。它与 [`prompts/AGENTS_SELF_INTRO.md`](../prompts/AGENTS_SELF_INTRO.md)（自动生成的 what）互补：**自述会随数据源自动更新，本文的 why 需要人工维护**。
