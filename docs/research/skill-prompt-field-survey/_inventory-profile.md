# profile 系列 skill prompt 字段清单底表（编译产物调查）

- **调查时间**：2026-11-19
- **仓库**：`D:\wenflow\wenflow`（git commit `e736f7aa` = `e736f7aaeac8bf6ed29856a7c799725b4d07d56c`）
- **调查对象**：`prompts/` 目录下 7 个「编译产物 skill prompt」文件（均为 UTF-8 中文 markdown，五块结构：身份 / 使用通道 / 执行规则 / 输出字段 / 边界约束，块名以实际内容为准）：

| 文件 | skillId | displayName（身份块自述） | coreVersion | temperature | maxTokens |
| --- | --- | --- | --- | --- | --- |
| skill.profile-adaptive-copy.md | skill:profile-adaptive-copy | 动态引导文案生成器 | 1 | 0.6 | 64000 |
| skill.profile-concept-consolidate.md | skill:profile-concept-consolidate | 概念归并判定器 | 1 | 0.2 | 64000 |
| skill.profile-concept-load.md | skill:profile-concept-load | 概念负担判定器（WenFlow） | 1 | 0.2 | 64000 |
| skill.profile-learning-predict.md | skill:profile-learning-predict | 学习表现预测器 | 1 | 0.2 | 64000 |
| skill.profile-lesson-enrich.md | skill:profile-lesson-enrich | 课后知识增强器 | 1 | 0.4 | 64000 |
| skill.profile-progress-report.md | skill:profile-progress-report | 学习进展报告生成器 | 1 | 0.4 | 64000 |
| skill.profile-state-review.md | skill:profile-state-review | 学习状态评审诊断器（WenFlow） | 1 | 0.3 | 64000 |

**方法与口径说明**：
- ref 前缀 = 来源分类：`skill` 上游模型输出 / `sandbox` 编排注入 / `user` 用户平台。**本批 7 个文件的输入契约中实际只出现 `sandbox:`（编排注入）与 `user:`（用户平台）两类前缀，未出现 `skill:` 上游模型输出前缀。**
- `skill.profile-concept-consolidate` 与 `skill.profile-concept-load` 两个文件**没有「输入契约声明」块**，输入只在「使用通道」与「执行规则」中被引用，已单独标注为「规则引用输入（未入契约）」。
- object 字段说明中出现的子字段以 `父.子` 逐行列出；仅在执行规则中被引用、未写入契约声明的深层子字段，单独标注来源规则。
- 所有语义摘要保留 prompt 原文关键措辞；各文件末块实名为「边界约束」，均要求「只输出一个 JSON 对象，字段名与输出字段表完全一致，不输出表外字段与解释文字」。

---

## skill:profile-adaptive-copy（动态引导文案生成器，coreVersion: 1）

**角色**：学习产品的动态引导文案生成器——按视图（dashboard=学习台首屏 / learning-state=学习状态页）生成接手式或解读式的引导文案，只负责「怎么说」，不做路径调整、课程结束或成绩判定等强决策。

使用通道：task（当前任务/场景/控制指令）、learner（学习者画像投影）、path（路径与确认方案上下文）、evidence（客观事实轨迹，只读追加）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句，保留原文关键术语） |
| --- | --- | --- |
| learner（object） | `sandbox:profile.snapshot.dynamicState`（编排注入） | 学习者快照投影（profile/dynamicState/knowledgeMemory/learningControlState/replanSignal 都在其下） |
| learner.profile | 同 learner | 学习者长期画像子投影（执行规则 7 引用其下 narrativeInsights.practicePreferenceNote：画像给出的练习/交付形式偏好） |
| learner.dynamicState | 同 learner | 学习者动态状态子投影 |
| learner.knowledgeMemory | 同 learner | 知识记忆子投影（执行规则 13 引用其下 globalBackground.transferSignals：该学习者在既有概念上已具备的迁移就绪度信号） |
| learner.learningControlState | 同 learner | 学习控制状态子投影 |
| learner.replanSignal | 同 learner | 重排信号子投影（同 advisory 来源） |
| learner.profile.narrativeInsights.practicePreferenceNote | （未入契约；执行规则 7 引用，源链 `sandbox:profile.snapshot.dynamicState`） | 练习/交付形式偏好，首次出现或变化时兑现为一句可见承诺；缺失或为空则不承诺 |
| learner.knowledgeMemory.globalBackground.transferSignals | （未入契约；执行规则 13 引用，源链同上） | 迁移就绪度信号列表，每项含 label/readiness/confidence；readiness 为 high/medium 且与当前路径焦点相关时可兑现为「可以把 X 用到 Y」类下一步，readiness=low 或缺失时不得宣称已具备迁移能力 |
| learningState（object） | `sandbox:profile.snapshot.learningControlState`（编排注入） | 学习状态；进度计数在 learningState.tasks（completed/total/inProgress/started） |
| learningState.tasks | 同 learningState | **当前主路径**（scope=primary-path）的任务计数，与同页面路径进度条同一口径 |
| learningState.tasks.completed | 同 learningState.tasks | 已完成任务数（pathHint 进度数字必须直接取自输入字段） |
| learningState.tasks.total | 同 learningState.tasks | 任务总数 |
| learningState.tasks.inProgress | 同 learningState.tasks | 进行中任务数 |
| learningState.tasks.started | 同 learningState.tasks | 已启动任务数（= 已完成 + 进行中）；严禁把「已完成 X / 总数」写成「已启动 X / 总数」 |
| advisory（object） | `sandbox:profile.snapshot.replanSignal`（编排注入） | 重排信号（阈值召回 + 归因），文案里 advisory 的来源；无信号时为 null |
| wrapup（object） | `sandbox:teaching.session.wrapup`（编排注入） | 最近一节的收束摘要（可选）——无历史时缺失 |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| headline | string | 页面主标题或主提示（当轮） | — |
| subtitle | string | 副标题或补充说明（当轮） | — |
| todayActions | object[] | 输出 1~3 条当前情境下最值得做的动作（凑满 3 条不是目标）；view=dashboard 按主操作/次操作/弱操作分角色，view=learning-state 严禁输出 to=learning-state（指向本页自身的自指深链）；多条时 title、action 不得雷同，desc 必须是一句具体内容 | title（行动标题）、desc（一句具体说明）、action（按钮文字）、to（continue-learning\|learning-state\|achievements\|create-goal\|path-detail，只能输出语义化目标） |
| pathHint | string | 解释当前路径进展（当轮）；进度数字直接取自输入字段（learningState.tasks 口径），不得自行换算或混用口径 | — |
| nextStep | string | 下一步最值得做什么（当轮）；可兑现 practicePreferenceNote 偏好承诺与迁移就绪度信号（「可以把 X 用到 Y」） | — |
| paceHint | string | 学习节奏提醒（当轮）；与负荷联动：高负荷/需减速（paceMode=recover 或疲劳信号）时指向「调慢节奏、优先恢复」 | — |
| emptyStateCopy | string | 没有路径/没有任务时的引导（当轮）；只在空态时写，其余场景输出空字符串 ""，与预警文案不得互相顶替 | — |
| warningCopy | string | 疲劳、卡点、进度滞后等情况的提醒（当轮）；只有真实风险才写，无预警场景输出 ""；语气不指责、不制造愧疚，必须附带 1 个可执行下一步，先认可已有投入再提调整 | — |

### 教育学术语标注

- **迁移就绪度（readiness）** — 执行规则 13 / 输入 `learner.knowledgeMemory.globalBackground.transferSignals`：学习者在既有概念上已具备的迁移就绪度信号（每项含 label/readiness/confidence），readiness=high/medium 可兑现为「可以把 X 用到 Y」；就绪度由系统判定，模型只读不改。
- **学习者画像 / 画像投影** — 使用通道 learner、输入 learner 说明、执行规则 7（practicePreferenceNote：画像给出的练习/交付形式偏好）。
- **疲劳（信号）** — 执行规则 8/10/11、输出 warningCopy：疲劳/卡点/进度滞后等风险提醒；规则 11 中 paceMode=recover 或疲劳信号时指向「调慢节奏、优先恢复」。
- **卡点** — 执行规则 8/10、输出 warningCopy 语境：卡点风险提醒。
- **进度滞后** — 执行规则 8/10、输出 warningCopy 语境：进度滞后提醒。
- **负荷 / 高负荷** — 执行规则 11：paceHint 与负荷联动，高负荷/需减速时节奏提醒指向恢复而非追加任务。
- **学习节奏** — 输出 paceHint（学习节奏提醒）与规则 11/12（「本周节奏」卡）。
- **置信度（confidence）** — 执行规则 13：迁移信号的 confidence 数值属内部信令，不得写进文案（信令隔离规则）。

---

## skill:profile-concept-consolidate（概念归并判定器，coreVersion: 1）

**角色**：对给定的候选知识点名字做机器可读的**归并判定**——判断哪些其实是同一个概念的不同说法（换词、加解释从句、截断变体、加引号强调），输出可被代码执行、可被事后审计的结构化建议；是数据判定任务，不是讲解或分析报告任务。

使用通道：learner（学习者画像投影）、evidence（客观事实轨迹，只读追加）、state（不推进：平台维护的主记忆快照，当前值，含 stage）。

**本文件无「输入契约声明」块**，无 ref 前缀声明；输入字段仅见于执行规则。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句，保留原文关键术语） |
| --- | --- | --- |
| candidates（候选概念名列表，规则引用输入，未入契约） | 未声明（执行规则 2/3/6/7/10 引用） | 判定对象：候选知识点名字列表，每项含 conceptKey；canonical 与 aliases 必须原样取自 candidates 的 conceptKey，禁止新造、改写 |
| canonicalWhitelist（规则引用输入，未入契约） | 未声明（执行规则 8 引用） | 上一轮**尚未执行**的待办规范键名单（均为 candidates 里出现过的 conceptKey）：给 merges 时优先从它挑 canonical（延续上轮判断、避免同一族反复换规范名），但不是强制来源 |
| aliasMap（规则引用输入，未入契约） | 未声明（执行规则 9 引用） | 已知「别名 → 规范名」映射（键值均为 candidates 里的 conceptKey）：出现某别名时优先按该映射给出 merges；映射只作先验，与词面明显冲突则如实放 ambiguous |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| merges | object[] | 确信的归并建议；canonical 与 aliases 必须是 candidates 里出现过的 conceptKey 原文；同一概念族只输出一条 merge，canonical 选最完整、最能自我解释的名字；confidence < 0.8 的建议一律不放这里 | canonical（规范名）、aliases（别名数组）、confidence（「这俩是不是同一个东西」的把握度 0-1，不是掌握度）、rationale（判定理由） |
| ambiguous | object[] | 看着像同义但拿不准的候选对（宁漏并不错并；同词异义、纯语义远距离推测放这里）；只记录、不会被执行 | a、b、reason |
| dropCandidates | object[] | 名字本身不可用的条目（命名残缺到无法判断指向，或已被更完整条目完全覆盖）；不确定就不放 | conceptKey、reason |

### 教育学术语标注

- **掌握度** — 执行规则 1（「不做教学诊断、不给掌握度」）、规则 5（confidence 是把握度，**不是掌握度**）、边界约束（不输出掌握度、难度、优先级等未被要求的判断）：全部为**否定式出现**，用于划清本 skill 职责边界。
- **教学诊断** — 执行规则 1：明确不做教学诊断（否定式）。
- **上位概念 / 概念图** — 执行规则 4：只做「身份归并」，不因主题相关把概念合并成上位概念（「那是概念图的事，不在本 skill 职责内」）；概念图（concept map）为教育/认知科学术语，此处否定式出现。
- **同词异义** — 执行规则 3：同一个词在两条路径里可能指不同的能力（语言学/概念辨析语境）。
- **概念族 / 规范名（canonical）** — 执行规则 6/8：同一概念族只输出一条 merge、延续上轮规范名，属概念组织与知识规范化语境。
- **置信度 / 把握度（confidence）** — 执行规则 5、输出 merges.confidence：「这俩是不是同一个东西」的把握度（0-1）。

---

## skill:profile-concept-load（概念负担判定器，coreVersion: 1）

**角色**：WenFlow 的概念负担判定器——给定一批知识点名字，逐个判断它在「学生要把它回忆出来」这件事上的真实负担：一条名字里到底装了一个概念还是几个、它偏陈述性还是程序性、检索难度大概在哪一档。

使用通道：learner（学习者画像投影）、evidence（客观事实轨迹，只读追加）、state（不推进：平台维护的主记忆快照，当前值，含 stage）。

**本文件无「输入契约声明」块**，无 ref 前缀声明；输入字段仅见于执行规则。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句，保留原文关键术语） |
| --- | --- | --- |
| 概念名列表 / 每项 conceptKey（规则引用输入，未入契约） | 未声明（执行规则 1/8、输出 concepts 说明引用） | 一批知识点名字，逐个判定负担档位；conceptKey 必须原样取自输入，禁止新造、改写、拆分后另起名字（拆分建议写在 rationale 里）；每个输入项都要有一条输出，顺序与输入一致 |
| （明确不在输入中）出现次数、掌握度、路径信息 | — | 执行规则 3：只按名字本身的语义判断，不根据出现次数、掌握度或路径信息推测（那些不在输入里，也不要编） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| concepts | object[] | 逐概念的负担档位；conceptKey 必须是输入里出现过的原文 | conceptKey（概念名原文）、granularity（一条名字里装了几个可独立回忆的单元：atomic=一个单元 / cluster=用「、/和/与/及/→」并列或明显塞了多个步骤/多个判定标准）、knowledgeType（factual=术语/事实；conceptual=关系/原理/区别；procedural=步骤/流程/操作；metacognitive=策略/自省/心态类）、difficultyBand（把它从零回忆出来的难度：low=单个事实或短语 / medium=需要组织一小段解释 / high=需要多步推理或同时满足多个条件才能说清；名字残缺、指向不明时给 unknown）、rationale（一句话 ≤40 字说清判断依据，不复述名字） |

### 教育学术语标注

- **概念负担 / 负担档位** — 身份与输出 concepts：知识点名字在「学生要把它回忆出来」这件事上的真实负担（本 skill 的核心构念）。
- **可独立回忆的单元（granularity：atomic/cluster）** — 执行规则 2：判「一条名字里装了几个可独立回忆的单元」，与认知负荷理论的组块（chunk）概念同源。
- **陈述性 / 程序性知识** — 身份（「它偏陈述性还是程序性」）与执行规则 4（factual/conceptual/procedural/metacognitive 四分类）：对应教育心理学中的知识维度分类（陈述性知识 declarative vs 程序性知识 procedural，及 Anderson & Krathwohl 修订版布卢姆分类的事实性/概念性/程序性/元认知知识四维）。
- **元认知（metacognitive）** — 执行规则 4：metacognitive=策略/自省/心态类知识。
- **检索难度 / 从零回忆出来的难度（difficultyBand：low/medium/high/unknown）** — 身份（「检索难度大概在哪一档」）与执行规则 5：提取/回忆难度分档，与记忆提取（retrieval）研究语境相关。
- **掌握度** — 执行规则 3 与边界约束：明确不依据、不输出掌握度（否定式出现）。

---

## skill:profile-learning-predict（学习表现预测器，coreVersion: 1）

**角色**：学习表现预测器——在新任务开始前，基于学习者最近的知识状态摘要、概念台账、疲劳信号与目标任务描述，预测学习者完成该任务的卡壳风险与最佳教学策略；输出用于校准闭环（按条件对齐后的实际结果校准，不以历史命中率作为惩罚），须给出「该教学条件下最可能的卡壳概率」——可验证、不虚报，但也不为求稳而回避判断。

使用通道：state（不推进：平台维护的主记忆快照，当前值，含 stage）、task（当前任务/场景/控制指令）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句，保留原文关键术语） |
| --- | --- | --- |
| fatigueSignal（string?） | `sandbox:teaching.learningState`（编排注入） | 学习者负荷分类得到的疲劳风险（low\|medium\|high），调用方由 learningState 的 ktl/lf 计算后注入；无学习状态时不出现 |
| knowledgeStateSummary（string?） | `sandbox:teaching.knowledgeStateSummary`（编排注入） | 最近一次课后知识状态摘要（画像快照 knowledgeMemory.globalBackground；任务前预测输入）；无历史摘要时调用方填「无历史摘要」 |
| taskContext（object） | `sandbox:teaching.taskContext`（编排注入） | 目标任务描述 {title, knowledgeType?, learningObjectives?}（任务标题/知识类型/目标概念，编排层组装） |
| taskContext.title | 同 taskContext | 任务标题 |
| taskContext.knowledgeType | 同 taskContext | 知识类型（可选） |
| taskContext.learningObjectives | 同 taskContext | 目标概念 / 学习目标（可选） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| stallRisk | number | 卡壳风险概率 0-1（0=必然顺畅，1=必然卡住）；依据：概念掌握程度、历史混淆、疲劳信号、任务复杂度；必须基于输入证据推导，禁止无证据拍脑袋，禁止为保险固定输出 0.5 | — |
| predictedTone | string | 本任务学习基调的机器判定枚举（smooth\|struggle\|fatigue）；只填枚举值供系统阈值判定，自由描述放 toneDetail；与 stallRisk 必须自洽（stallRisk>0.7 时不应是 smooth） | — |
| toneDetail | string? | 学习基调的自由描述原文（保留完整语义，如「前半顺畅、后半吃力」「预计在方法选择环节吃力」）；枚举仅作机器判定，本字段是教学层读语义的来源 | — |
| suggestedDepth | string | 建议讲解深度的机器判定枚举（shallow\|standard\|deep）；只填枚举值，自由描述放 depthDetail | — |
| depthDetail | string? | 建议深度的自由描述原文（如「轻量带过即可」「需要深挖原理并配对比练习」） | — |
| focusConcepts | string[] | 建议优先聚焦/复习的概念（最多 3 个，必须来自输入） | — |
| rationale | string | 一句话预测依据（可解释性要求：供教师/系统解释，需具体到概念或信号，不要空泛）；证据不足时写明「证据不足，依据是…」 | — |

### 教育学术语标注

- **卡壳风险 / 卡壳概率（stallRisk）** — 身份、输出 stallRisk、执行规则 2：学习者完成该任务的卡壳概率（0-1），是本 skill 的核心预测构念。
- **最佳教学策略 / 讲解深度（suggestedDepth：shallow/standard/deep）** — 身份与输出：任务前给出的教学深度建议（教学适配/支架调整语境）。
- **校准（闭环）** — 身份：输出将被用于校准闭环，在与建议深度相当的教学条件下按实际结果校准，「不以历史命中率作为对你的惩罚」——预测校准（calibration）方法论语境。
- **疲劳信号 / 疲劳风险（fatigueSignal）** — 输入：由负荷分类得到（low/medium/high），由 learningState 的 ktl/lf 计算后注入。
- **知识状态摘要（knowledgeStateSummary）** — 输入：最近一次课后知识状态摘要（画像快照 knowledgeMemory.globalBackground），任务前预测输入。
- **知识类型（knowledgeType）** — 输入 taskContext：目标任务的知识类型（与 concept-load 的 factual/conceptual/procedural/metacognitive 分类同源）。
- **学习目标 / 目标概念（learningObjectives）** — 输入 taskContext：目标概念列表（教育学「学习目标」语境）。
- **概念掌握程度 / 历史混淆** — 输出 stallRisk 依据：概念掌握程度与历史混淆信号进入风险推断。
- **学习基调（predictedTone：smooth/struggle/fatigue）** — 输出：任务学习基调的机器判定枚举 + toneDetail 语义原文双层结构。
- **任务复杂度** — 输出 stallRisk 依据之一。
- **抹平方差（禁止）** — 执行规则 9 与边界约束：禁止「不确定就往 0.5 靠」「为保险统一给 standard」这类抹平预测区分度的做法（预测方差/区分度语境）。

---

## skill:profile-lesson-enrich（课后知识增强器，coreVersion: 1）

**角色**：课后知识增强器——一节课结束后，基于课堂知识状态与变化量、wrapup 产物、课堂证据摘要、可见对话切片与课堂事件历史，一次性产出两份长期背景增量：结构化知识台账（conceptLedger 系列字段）、隐性概念线索（recurringConfusions）与一段自然语言知识状态摘要（knowledgeStateSummary）；若提供 transferGoal，还需判断本课是否为迁移目标提供了可迁移基础并在 transferSignals 中标注迁移就绪度。

使用通道：evidence（客观事实轨迹，只读追加）、task（当前任务/场景/控制指令）。

**说明**：身份块还提及经通道进入的输入——课堂知识状态与变化量、wrapup 产物、课堂证据摘要、可见对话切片、课堂事件历史（经 evidence/task 通道，未列入输入契约声明）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句，保留原文关键术语） |
| --- | --- | --- |
| transferGoal（string?） | `user:lessonCompleted.transferGoal`（用户/平台） | 本任务的可迁移目标（task.transferable 派生，由 lesson:completed 事件携带）；缺失时不做迁移意图锚定 |
| lessonReport（object?） | `user:lessonCompleted.lessonReport`（用户/平台） | 课堂契约报告（平台确定式产出）；缺失时不做契约锚定；与 wrapup 冲突时以它为准 |
| lessonReport.met | 同 lessonReport | 主线契约是否达成；met=false 时 knowledgeStateSummary 必须点明「本节契约未达成」及缺口 |
| lessonReport.coveredKcs | 同 lessonReport | 本课覆盖的 KC（知识点）列表 |
| lessonReport.missingKcs | 同 lessonReport | 缺失的 KC：其中的概念不得在 conceptLedger 中标为高熟悉度，应进 blockedFoundations（或 recurringConfusions，若有对应卡点） |
| lessonReport.independentCount | 同 lessonReport | 独立证据计数（met=false 时须点明「缺哪些 KC 的证据/独立证据不足」） |
| lessonReport.branch | 同 lessonReport | 分支信息（课堂契约报告组成项） |
| lessonReport.parkingLot | 同 lessonReport | 课上未展开、课后待处理的问题；只能作为后续线索，不得当作已掌握或已解决 |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| conceptLedger | object[] | 概念台账；只输出能在输入里找到的概念（知识看板概念，或对话/事件中确实出现过的）；概念身份键、熟悉度、迁移就绪度、证据条数由系统按知识看板与证据行计算，不要输出（输出了也会被系统覆盖） | label（概念白话标签）、misconceptionRisk（low\|medium\|high）、sourcePaths（来源路径 ID 数组）、sourceTasks（来源任务 ID 数组）；**系统侧字段（模型不输出）**：conceptKey（概念身份键）、familiarity（熟悉度）、transferReadiness（迁移就绪度）、evidenceCount（证据条数）、masteryScore（0-1 数值掌握度，与画像/图谱同一口径） |
| reusableFoundations | string[] | 课后可复用的稳定基础（「这节课后可复用的稳定基础」） | — |
| blockedFoundations | string[] | 仍不稳定、会阻塞后续学习的前置 | — |
| transferSignals | object[] | 迁移信号列表；优先覆盖与 transferGoal 直接相关的概念（迁移意图锚定）并如实标注就绪度，证据不足不虚报 high；readiness 若与看板状态冲突，以看板为准 | label（概念白话标签）、readiness（low\|medium\|high）、confidence（0-1）；conceptKey 由系统按 label 归一，不要输出 |
| recurringConfusions | object[] | 反复混淆模式：只记录对话或事件中反复出现的卡住/混淆模式，confidence 范围 0-1 | label（概念白话标签）、pattern（混淆表现描述）、confidence（0-1）、count（出现次数）；conceptKey 由系统按 label 归一，不要输出 |
| knowledgeStateSummary | string | 本节课后学习者的知识状态摘要（2-4 句中文自然语言），供后续教学决策与预测器直接读取；必须涵盖：① 已掌握/半掌握/未掌握的关键概念（引用本节课概念名）② 反复出现的卡点或误解（具体到表现）③ 认知负荷与情绪状态（是否疲劳、焦虑、超载）④ 面向下一个任务的建议（一句话，可执行） | — |

### 教育学术语标注

- **迁移 / 可迁移目标 / 迁移意图锚定（transferGoal）** — 身份、输入 transferGoal、执行规则 5：本任务的可迁移目标，作为迁移意图锚定（learning transfer 语境）。
- **迁移就绪度（readiness / transferReadiness）** — 身份、执行规则 3/4/5、输出 conceptLedger（系统侧 transferReadiness）与 transferSignals（readiness：low/medium/high）：概念迁移就绪度，与看板状态冲突时以看板为准。
- **概念台账（conceptLedger）** — 身份与输出：结构化长期知识台账。
- **熟悉度（familiarity）** — 输出 conceptLedger 说明：系统按知识看板与证据行计算的熟悉度；missingKcs 概念不得标为高熟悉度。
- **掌握度（masteryScore）** — 输出 conceptLedger 说明：0-1 数值掌握度，由系统计算、与画像/图谱同一口径，模型不输出。
- **误解 / 误区风险（misconceptionRisk / misconception）** — 输出 conceptLedger.misconceptionRisk（low/medium/high）与 recurringConfusions、knowledgeStateSummary ②：概念误解及其风险分档（misconception 为概念转变研究核心术语）。
- **KC / 知识组件（coveredKcs / missingKcs / independentCount）** — 输入 lessonReport、执行规则 6：知识点（KC）的覆盖、缺失与独立证据计数（KC 为知识追踪/认知建模标准术语）；met=false 时须点明缺哪些 KC 的证据/独立证据不足。
- **课堂契约 / 契约报告（lessonReport.met / branch）** — 输入与执行规则 6：平台确定式的课堂契约报告，是主线达成度的确定式证据，与 wrapup 冲突时以它为准。
- **parkingLot（停车坪 / 课后待处理问题）** — 输入 lessonReport、执行规则 6：课上未展开、课后待处理的问题，只能作后续线索，不得当作已掌握或已解决。
- **前置知识阻塞（blockedFoundations）** — 输出与执行规则 9：「仍不稳定、会阻塞后续学习的前置」（prerequisite 语境）。
- **可复用稳定基础（reusableFoundations）** — 输出与执行规则 8：「这节课后可复用的稳定基础」（知识巩固/迁移基础语境）。
- **反复混淆模式（recurringConfusions / 卡点）** — 身份（隐性概念线索）、输出与执行规则 7：对话或事件中反复出现的卡住/混淆模式。
- **认知负荷** — 输出 knowledgeStateSummary ③：「认知负荷与情绪状态」必填项（cognitive load 术语直接出现）。
- **情绪状态：疲劳、焦虑、超载** — 输出 knowledgeStateSummary ③：是否疲劳、焦虑、超载（学业情绪/过载语境）。
- **掌握 / 半掌握 / 未掌握** — 输出 knowledgeStateSummary ①：关键概念的掌握程度三档表述。
- **知识状态摘要（knowledgeStateSummary）** — 身份与输出：供后续教学决策与预测器直接读取的自然语言知识状态摘要（profile 内 lesson-enrich → learning-predict 的数据流衔接点）。

---

## skill:profile-progress-report（学习进展报告生成器，coreVersion: 1）

**角色**：学习进展报告生成器——基于任务学习数据、指标与学习信号，生成一段内部用于学习者状态中心的简短分析（语气亲切、具体、鼓励，但不替用户做学习决策，不输出指标定义、公式或诊断结论）。

使用通道：task（当前任务/场景/控制指令）、learner（学习者画像投影）、evidence（客观事实轨迹，只读追加）、state（不推进：平台维护的主记忆快照，当前值，含 stage）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句，保留原文关键术语） |
| --- | --- | --- |
| task（object） | `sandbox:teaching.session.info`（编排注入） | 当前任务信息 { title, timeSpent, difficulty }（调用方由 session/taskData 投影） |
| task.title | 同 task | 任务标题 |
| task.timeSpent | 同 task | 任务耗时 |
| task.difficulty | 同 task | 任务难度 |
| metrics（object） | `sandbox:profile.snapshot.dynamicState`（编排注入） | 本节指标 { completionRate, ktl, lf, lss }（调用方由 dynamicState 与权威学习状态投影） |
| metrics.completionRate | 同 metrics | 完成率 |
| metrics.ktl | 同 metrics | 指标 ktl（prompt 未展开定义；在 learning-predict 中 ktl/lf 被用作疲劳计算的输入） |
| metrics.lf | 同 metrics | 指标 lf（同上，prompt 未展开定义） |
| metrics.lss | 同 metrics | 指标 lss（prompt 未展开定义） |
| signals（string） | `sandbox:teaching.session.evidence`（编排注入） | 学习信号描述（分号分隔的文本串，调用方由会话证据派生） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| reasoning | string | 1 到 2 句话解释当前学习状态与近期变化原因 | — |
| suggestion | string | 1 到 2 句话给出可执行的下一步建议 | — |

### 教育学术语标注

- **学习信号（signals）** — 输入：由会话证据派生的学习信号描述文本串。
- **学习指标组（completionRate / ktl / lf / lss）** — 输入 metrics：本节指标；completionRate 即完成率，ktl/lf/lss 为内部指标缩写，**本 prompt 未展开其口径定义**（旁证：learning-predict 输入 fatigueSignal 由 learningState 的 ktl/lf 计算得出，指向负荷/疲劳计量）。
- **任务难度（difficulty）/ 学习投入时间（timeSpent）** — 输入 task：任务难度与耗时（学习行为计量语境）。
- **掌握（知识点已掌握）** — 边界约束：不承诺任务已完成或知识点已掌握，除非输入证据明确给出（否定式出现，掌握证据意识）。
- **诊断结论** — 执行规则 3：不输出指标定义、公式或诊断结论（否定式，职责边界）。

---

## skill:profile-state-review（学习状态评审诊断器，coreVersion: 1）

**角色**：WenFlow 的学习状态评审诊断器——基于给定的学习状态摘要、知识线索与最近证据，给出可被后续事实检验的诊断性判断（为什么卡、下一步怎么调），而不是复述指标；不做路径改写、成绩判定或课程结束等强决策。

使用通道：learner（学习者画像投影）、path（路径与确认方案上下文）、evidence（客观事实轨迹，只读追加）、state（不推进：平台维护的主记忆快照，当前值，含 stage）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句，保留原文关键术语） |
| --- | --- | --- |
| learnerDigest（object） | `sandbox:profile.snapshot.dynamicState`（编排注入） | 学习者状态摘要（confidenceLevel/recentTrend/节奏与卡点线索） |
| learnerDigest.confidenceLevel | 同 learnerDigest | 学习者信心水平 |
| learnerDigest.recentTrend | 同 learnerDigest | 近期趋势 |
| knowledgeDigest（object） | `sandbox:profile.snapshot.knowledgeMemory.currentPath`（编排注入） | 知识线索摘要（当前路径的掌握/脆弱/先修缺口线索） |
| recentEvidence（object[]） | `sandbox:teaching.session.evidence`（编排注入） | 最近课堂证据 [{ id, signal, concepts[], at }]；insight.evidenceRefs 只能引用其中出现过的 id |
| recentEvidence[].id | 同 recentEvidence | 证据条目 ID（evidenceRefs 引用键） |
| recentEvidence[].signal | 同 recentEvidence | 证据信号内容 |
| recentEvidence[].concepts[] | 同 recentEvidence | 证据关联概念列表 |
| recentEvidence[].at | 同 recentEvidence | 证据时间戳 |
| priorInsights（object[]） | `sandbox:profile.narrativeInsights`（编排注入） | 上一轮已产出的诊断（可延续/推翻；不得重复造新条目） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| insights | object[] | 诊断条目数组；每条必须给出 evidenceRefs（引用输入 recentEvidence.id），无引用则不输出该条；证据不足时减少条数，不得编造 | type（prerequisite_gap\|misconception\|fatigue\|motivation\|granularity\|strategy_fit）、claim（诊断主张）、evidenceRefs（引用的证据 id）、confidence（置信度）、action（下一步调节动作） |
| conceptAssessments | object[] | 逐概念观测；掌握度只给低/中/高与 mastered/not，不输出精确数值或百分比 | conceptKey（概念键）、observed（mastered\|not）、masteryBand（low\|medium\|high）、rationale（观测依据）、evidenceRefs（证据 id 引用） |
| falsifiableClaims | object[] | 可证伪断言；不确定的判断放入此处，并给出可检验的 expect | claim（断言内容）、checkOn（next_lesson\|next_task\|next_review：下次上课/下次任务/下次复习时检验）、expect（可检验的预期） |
| narrative | string | 1 到 2 句话人话总结（只说面向学习者的中文，不得出现内部字段名如 recentEvidence、evidenceRefs 或任何英文键名）；recentEvidence 为空时 insights 输出空数组，narrative 固定按「本次没有可依据的课堂证据，无法给出有证据支撑的判断」口径说明 | — |

### 教育学术语标注

- **诊断性判断** — 身份与执行规则 6：「为什么卡、下一步怎么调」的教育诊断定位（可被后续事实检验）。
- **掌握度（masteryBand / observed: mastered|not）** — 执行规则 3、输出 conceptAssessments：掌握度只给低/中/高与 mastered/not，不输出精确数值或百分比（分档掌握度表述）。
- **先修缺口（prerequisite_gap）** — 输入 knowledgeDigest（「掌握/脆弱/先修缺口线索」）与输出 insights.type：前置知识缺失诊断（prerequisite 术语）。
- **脆弱知识（脆弱线索）** — 输入 knowledgeDigest：当前路径的脆弱点线索（fragile knowledge 语境）。
- **误解 / 错误概念（misconception）** — 输出 insights.type：概念误解类诊断。
- **疲劳（fatigue）** — 输出 insights.type 与输入 learnerDigest（节奏线索）：疲劳作为诊断类型。
- **动机（motivation）** — 输出 insights.type：学习动机作为诊断类型。
- **粒度（granularity）** — 输出 insights.type：概念粒度问题作为诊断类型（与 concept-load 的 granularity 同名）。
- **策略匹配（strategy_fit）** — 输出 insights.type：当前策略与学习者匹配度的诊断类型。
- **可证伪断言（falsifiableClaims / checkOn / expect）** — 执行规则 4 与输出：「区分『观察』与『假设』；不确定的判断放入 falsifiableClaims，并给出可检验的 expect」——将波普尔可证伪性方法论用于学习诊断，检验时点为下次上课/任务/复习。
- **复习（next_review）** — 输出 falsifiableClaims.checkOn 取值之一：下次复习时检验断言。
- **信心水平（confidenceLevel）** — 输入 learnerDigest：学习者信心水平线索（注意是学习者信心，不是模型置信度）。
- **置信度（confidence）** — 输出 insights 与 conceptAssessments 子字段：诊断条目/观测的置信度。
- **观察与假设的区分** — 执行规则 4：认识论方法论约束（观察 ≠ 假设，不确定判断须标为可证伪断言）。

---

## 数量汇总

| skillId | 输入契约字段 | 输入表行数（含子字段/规则引用行） | 输出字段 | 输出子字段 |
| --- | --- | --- | --- | --- |
| skill:profile-adaptive-copy | 4 | 16 | 8 | 4（todayActions 的 title/desc/action/to） |
| skill:profile-concept-consolidate | 0（无契约块；规则引用输入 3：candidates、canonicalWhitelist、aliasMap） | 3 | 3 | 9（merges 4 + ambiguous 3 + dropCandidates 2） |
| skill:profile-concept-load | 0（无契约块；规则引用输入 1 类：概念名列表/conceptKey） | 1（另 1 行明确排除项） | 1 | 5（concepts 的 conceptKey/granularity/knowledgeType/difficultyBand/rationale） |
| skill:profile-learning-predict | 3 | 6 | 7 | 0（均为标量/数组字段，无 object 子字段） |
| skill:profile-lesson-enrich | 2 | 8 | 6 | 模型输出子字段 11（conceptLedger 4 + transferSignals 3 + recurringConfusions 4），另有 5 个系统侧字段明确不输出（conceptKey/familiarity/transferReadiness/evidenceCount/masteryScore） |
| skill:profile-progress-report | 3 | 9 | 2 | 0 |
| skill:profile-state-review | 4 | 10 | 4 | 14（insights 5 + conceptAssessments 5 + falsifiableClaims 4） |

**教育学术语跨文件汇总**（去重）：迁移/迁移就绪度（readiness）、迁移意图锚定、概念负担、可独立回忆的单元（组块）、陈述性/程序性知识、知识维度四分类（factual/conceptual/procedural/metacognitive）、元认知、检索难度/从零回忆难度、掌握度（masteryScore/masteryBand/mastered-not，含多处否定式约束）、掌握/半掌握/未掌握、熟悉度（familiarity）、卡壳风险/卡壳概率（stallRisk）、卡点、进度滞后、疲劳（信号/诊断类型）、认知负荷、超载、焦虑/情绪状态、动机（motivation）、误解/错误概念（misconception/misconceptionRisk/recurringConfusions）、先修缺口（prerequisite_gap）、脆弱知识、粒度（granularity）、策略匹配（strategy_fit）、可证伪断言（falsifiableClaims/expect/next_review 复习检验）、观察与假设区分、预测校准（校准闭环）、抹平方差（禁止）、KC/知识组件（coveredKcs/missingKcs）、独立证据（independentCount）、课堂契约（met）、parkingLot（课后待处理问题）、前置知识阻塞（blockedFoundations）、可复用稳定基础（reusableFoundations）、概念台账（conceptLedger）、知识状态摘要（knowledgeStateSummary）、学习基调（predictedTone）、讲解深度（suggestedDepth）、学习目标（learningObjectives）、知识类型（knowledgeType）、信心水平（confidenceLevel）、置信度（confidence）、概念图（否定式）、教学诊断（否定式）、同词异义。
