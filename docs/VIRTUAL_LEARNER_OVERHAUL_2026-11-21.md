# 虚拟学习者子系统全面改造（2026-11-21）

## 范围

本轮改造覆盖五个层面：人设生成 → 落库/读取 → 模拟器表现 → 评估闭环 → 记忆/校准。
不改 Goal 澄清流程，不替换教学 DS 模型。

## 1. 人设生成与落库

### 1.1 personalityTraits 全链路

- `simulation-persona-designer.yaml` 把 `personalityTraits` 六项（verbosity / enthusiasm /
  confusionStyle / patience / questionStyle / emotionalRange）和 `motivationType` 列为必填。
- `simulation-persona-designer/index.ts` 的 `validatePersonaOutput` 拒绝缺失/非法子枚举，
  不再用六项默认值静默补齐。
- 三条落库链路同步写独立列：
  - `routes/admin/virtual-learners.session-lifecycle.ts`（创建/PUT，从 `personaSeed` 或
    `profile.personalityTraits` 提取）；
  - `virtual-lab/learner-provisioning.ts`（批量实验生成人设后写列）；
  - `frontend/src/views/admin-redesign/live.ts`（角色卡创建时显式提交）。
- `coordinators/simulation.helpers.ts` 的 `parseProfileData` 在列空时回退读 `profile` JSON，
  覆盖 186 个历史嵌套画像。
- 实测（dev.db）：可读 traits 的画像从 **9/739** 提升到 **195/739**。

### 1.2 声纹样本 voiceSamples

- persona-designer / scenario-designer 新增 `voiceSamples`（2 句本人原话）。
- `PERSONA_FIELD_ANCHORS_HINT` 增加 `learner.profile.voiceSamples` 锚点。
- persona-designer 校验要求至少 2 句，避免再次退化成“礼貌客服腔”。

### 1.3 代码侧分层采样

- 新增 `virtual-lab/learner-sampling.ts`：`buildSamplingDirectives(index)` 用错位取模掷出
  `sampleType / availableTime / techComfort / learningStyle / cognitiveLoadTolerance /
  motivationType` 六项硬坐标，学生比例 3/10。
- persona-designer 新增 `samplingDirectives` 输入；提示词只负责围绕坐标构造自洽人物。
- 批量实验用进程内游标 `samplingIndex`；单次管理端生成用随机序号。
- 冒烟实测：给定坐标与产出六项完全一致。

## 2. 模拟器表现层

### 2.1 回复长度服从 verbosity

- `simulation-learn-turn/index.ts` 的 `resolveReplyBudget` 接入 `personalityTraits.verbosity`：
  terse=1 句/48 字，normal=2 句/96 字（blocked 80），verbose=3 句/180 字（blocked 120）。
- 老师要求列举 6 句、收口/离场 1 句的例外保留。
- 三处「默认 1-2 句」改为分档描述。

### 2.2 blocked 阶段按 confusionStyle 表达

- direct 可点名卡点；hinting 只表现犹豫/答偏，不替老师用专业术语自诊。
- epistemicGrounding 判错轮同样按 confusionStyle 暴露卡点。

### 2.3 工作记忆超载

- 新增 `virtual-lab/cognitive-load.ts`：按教师消息长度、句子数、枚举数、因果链数 +
  `cognitiveLoadTolerance` 计算 `overloadSignal`（保守阈值，至少两条信号）。
- assisted / blackbox 两条链路都把信号传给 epistemic-grounding 与 learn-turn：
  - 判决强制 `sampledCorrectness=false`、`masteryProb<=0.3`；
  - learn-turn 强制 `phaseFocus=blocked`、`cognitiveLoad>=0.8`、登记「信息太多没接住」，
    不得结课。
- 高耐受学习者阈值更高；纯长文无枚举/因果不轻易触发。

### 2.4 remainingBlockers 单一真相源

- `learnerFeedback.remainingBlockers` 为唯一真相源；显式给出（含空数组）以它为准，
  缺省时沿用 state；随后 state 镜像同一份。
- 超载轮强制登记卡点，防止提前结课。

## 3. 评估闭环

### 3.1 前置自测 probeAnswers

- 新增 `virtual-lab/probe-answers.ts`：从 `confirmedProposal.prerequisiteDiagnostics`
  抽取题目（含判分键，只进旁路诊断），按画像 `struggleConcepts` 确定性生成作答：
  命中卡点→故意答错，否则答对。
- platform-user-adapter 的 `confirm_proposal` 透传 `probeAnswers`；blackbox runner 从
  上一轮旁路诊断读取题计划；assisted 链路把题计划落 `stageResults.goal.probePrompts`，
  确认轮提交。
- 这样「前置答对/答错 → path 跳过或补前置」首次进入虚拟实验室覆盖。

### 3.2 裁判

- `findings.category` 新增 `data`（代码白名单 + contracts 类型），不再静默改成 `trace`。
- R1 增加 `not_judgeable` 硬阻断豁免，并读取 `control.hardBlocked/expectedNoPath`。
- R2 增加「首阶段偷跑后段概念」「零基础首课负荷倒挂」扣分。
- 新增 Goal 过度脑补/过早收敛审计。

### 3.3 声纹审计

- actor-audit 新增：回复长度是否匹配 verbosity、用词是否贴合年龄职业、
  hinting 是否替老师自诊、多个画像是否趋同成客服腔。

### 3.4 稳定误区跨轮持有（heldMisconception）

- `simulation-learn-turn` / `simulation-epistemic-grounding` 新增 `heldMisconception`
  输入：只要老师还没给出**具体反例/冲突事实**，判决必须按这条错误直觉判错，演员也继续
  按它推理或反驳；老师给出反例后才允许修正。
- assisted（`simulation.learn-phase.ts`）与 blackbox（`blackbox-runner.ts`）同口径计算：
  受控错误命中真人误区语料时写入 `{concept, statement, why, source, createdTurn}`；
  未命中则继承上一轮持有项，最多持有 3 轮（防拖成整节课无法收束）。
- 释放由模型显式输出 `heldMisconception=null` 触发；未输出时沿用注入项，避免每个回合
  重新采样把误区演丢。
- 持有项随 `learnerState.heldMisconception` 落 `stageResults` / 黑盒私有状态，下一轮
  重新注入；既有 `remainingBlockers` 仍独立管理卡点，两者不互相覆盖。

## 4. 记忆与校准

- `simulation-memory-curate` 新增结构化 `selfCalibrationBias`
  （accurate|overestimate|underestimate|unknown）；代码优先读枚举，散文只做说明，
  旧数据/缺字段回退确定性解析器。
- `knowledgeSnapshot` 只保留学习者页面可见的「当前任务锚点 + 本课知识点」；
  画像 mastered/dueReview/struggling 走 `learnerMemory`，不再混进看板。

### 4.1 远迁移掌握门（transferEvidence）

- memory-curate 新增 `transferEvidence: [{concept, kind, evidence}]`，
  `kind ∈ own_words | new_context | reverse_explain | none`。
- 只有「用自己的话重述 / 换场景仍能做对 / 反向讲解」才算远迁移；`kind=none`
  （只会复述老师结论）时该概念掌握 `confidence` 由代码压到 **≤0.6**，不得直接判 mastered。
- 代码按 `conceptKey` 归一匹配；缺字段时回退为空数组，旧输出不受影响。

## 5. 验证

- 后端 `tsc -p tsconfig.build.json --noEmit`：通过。
- 前端 `vue-tsc --noEmit`：通过。
- 模拟相关测试：**65 suites / 696 tests 全过**（含稳定误区 3 例与远迁移门用例）。
- `prompts:compile-all → sync-core → snapshots → self-intro`：完成。
- `prompts:check:all`、`prompts:core:check`、`prompts:runtime-contract:check`：全过。
- persona 冒烟两次：
  - 采样坐标六项完全命中；traits 为差异化组合；
  - `voiceSamples` 为两句中文原话；`occupation/education` 已回到中文。
- 真实 DB 验证：traits 可读画像 9 → 195。

### 5.1 真实链路单案（2026-11-21）

单案 `g02-geometry-proof`（33 岁校外数学辅导老师，几何证明；`frictionBudget=stress_test`），
在本地后端上跑通 goal → path → teaching：

- **链路**：黑盒会话 `a760d082-…`，goal 确认后生成 4 任学习路径，teaching 连续 30+ 轮；
  `publicTrace` 55 条、`learnerPrivateStateTrace` 33 条，无中断/降级为终态。
- **overloadSignal（自然触发）**：teaching 第 43 条私有状态 `cognitiveLoad=0.85`，
  `remainingBlockers=["信息太多没接住"]`，判决 `errorPattern="单轮信息量过载，没接住"`、
  `masteryProb=0.3`、`sampledCorrectness=false`——代码信号强制 blocked 的分支在真实链路命中。
- **heldMisconception（消费链路）**：该画像 `struggleConcepts` 为空，任务概念不在 14 条语料内，
  受控错误没有自然命中语料，故未自动写入。为验证消费端，暂停 autopilot 后向私有状态注入
  一条语料持有项再重启：下一轮私有状态保留该 `heldMisconception`（未被模型丢弃），
  说明读取→注入→回写链路在真实会话中生效。
- **技能级冒烟（真实 provider）**：用同一 payload 直接调两个 skill：
  - grounding 输出 `blockedConcept="几何证明"`、`errorPattern` 与语料原句逐字一致；
  - learn-turn 回复「我打算直接利用两直线平行的条件，得出角A等于角B」，并把
    「没确认截线关系」登记为卡点，`learnerState.heldMisconception` 原样保留。
- **probeAnswers**：本 case 的 `confirmedProposal.prerequisiteDiagnostics=[]`
  （成人学习者已有基础），按设计不产生 `probePrompts`、确认时不提交 `probeAnswers`；
  非空路径由 `probe-answers` 3 例单测 + `platform-user-adapter` 契约测试覆盖。

## 6. 尚未覆盖

- **误区语料扩容**：现有 `misconception-corpus`（14 条，偏地理/几何/健康管理）覆盖面窄；
  `heldMisconception` 只在受控错误命中语料时写入，未命中仍回退即兴卡点。
  按领域补充有出处的条目属于内容生产，不是代码契约。
- **probe 通道的真实非空样本**：需要一个前置诊断为非空的初学者 case 才能在全链路看到
  `probeAnswers` 提交；本轮单案的诊断为空，属于设计上的 no-op，不是代码失败。
