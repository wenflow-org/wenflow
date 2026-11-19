# VL-02：虚拟学习者「扮演真人对话」机制盘点与残留问题向量

> 调查基准：commit e736f7aa（2026-11-19）。对照背景：docs/VIRTUAL_LEARNER_REALISM_2026-11-11.md（真实性审计与四层修复）。
> 方法：逐条读 prompts/core/simulation-*.yaml（9 个）与编译产物 prompts/skill.simulation-*.md、技能 handler（backend/src/skills/simulation-*）、编排层（backend/src/coordinators/simulation.*.ts）、虚拟实验室（backend/src/virtual-lab/*）、跑数 harness（backend/src/scripts/simulate-learner-e2e.ts）。
> 所有引用格式：`文件:行号`（代码）或 `prompts/core/<id>.yaml:行号`（提示词）。行号以 e736f7aa 为准。

---

## 1 扮演机制编目

「像真人」的全部约束机制，按功能族编目。共 18 条机制（M1–M18）。

### 1.1 离场纪律（goal 阶段专属）

| # | 机制 | 规则要点 | 防御的失真模式 | 出处 |
|---|---|---|---|---|
| M1 | shouldEnd 离场信号 | 模型自报「本轮之后真人是否不再发消息」；只有显式 `true` 才收尾，缺省/非法一律按继续对话（不误收尾）；reply 仍须给出那句自然收尾 | 模拟器没有「停止说话」的动作 → 对方一收口学习者就必须再接一句 → 告别死循环（蓝屏 8 轮告别、77 条消息） | prompts/core/simulation-goal-dialogue.yaml:77-80；backend/src/skills/simulation-goal-dialogue/index.ts:231-233（`parsed?.shouldEnd === true` 才真） |
| M2 | endReason 四枚举 | leaving（去忙/离开）/ satisfied（已得到答案）/ declining（明确不继续）/ no_more_questions（没有新问题）；留空规则写死 | 离场不可归因、审计无法区分「自然走」与「被问跑」 | prompts/core/simulation-goal-dialogue.yaml:81-84 |
| M3 | 「像真人一样离场」话语纪律 | 对方只是收口/确认/叮嘱/复述已定事项且无新问题时：一句 ≤15 字自然收尾 + shouldEnd=true；不为礼貌再答应一遍、不表决心、不复述对方步骤；一旦说出「我先去忙/回头再试/等我……再说/先去按步骤试」本轮必须 shouldEnd=true——即使对方句尾追问也不回；同一段告别只说一次；默认 1-2 句口语 | 换词复读式告别（「好，那我先去忙」×8 变体）、表决心式拖延、复述对方步骤的假收尾 | prompts/core/simulation-goal-dialogue.yaml:64（编译产物 prompts/skill.simulation-goal-dialogue.md:51）；后置规则：拍板轮不得 shouldEnd（yaml:63 末句） |
| M4 | 拍板纯化 | proposal_evaluation 拍板轮（readyToProceed=true）：reply 必须是一句纯粹口播确认，严禁顺带新背景/时间条件/顾虑/追问——附带条件会被 goal-confirm-adjudicator 判「仍在改需求」拦截排课；没系统替你按确认，「只提高兴绪字段不算」 | 学习者字段说同意、嘴上却在改需求 → 平台代签/排课被拦的割裂 | prompts/core/simulation-goal-dialogue.yaml:63 |

### 1.2 摩擦预算的「演法」

| # | 机制 | 规则要点 | 防御的失真模式 | 出处 |
|---|---|---|---|---|
| M5 | friction 五档预算 + 编排层采样 | none/low(0.15)/normal(0.30)/high(0.55)/stress_test(0.85)；触发与否由 `decideFrictionTrigger` 在代码里按概率采样（可测量、可复现统计），LLM 只负责「触发了怎么演 / 没触发必须合作」；每个 payload 注入 `{budget, triggerProbability, triggered, guidance}`，guidance 按「触发轮/平稳轮」预写好 | 概率交 LLM 自行把握 → 不可测；学习者「每轮都配合的答题机」（空壳人设时代 11 case 全部如此） | backend/src/skills/virtual-learner-shared/schemas.ts:126-255（表:126-199，采样:243-255）；prompts/core/simulation-goal-dialogue.yaml:56、simulation-learn-turn.yaml:96、simulation-path-evaluate.yaml:50 |
| M6 | friction 触发后的演法菜单 | normal 触发轮：从五种行为**任选一种**（同一轮最多一种、自然嵌入、不喊「我有顾虑」）——adversarialPattern（嫌理想化提时间不够）/ failurePatterns 翻旧账 / emotionalTriggers 情绪 / helpSeekingPattern 追问具体细节 / 短暂偏题联系 background；high 允许 1-2 种、stress_test 几乎必触发；平稳轮「保持自然合作，不表达对抗、不翻旧账、不偏题」 | 摩擦退化为「每轮随机抱怨」或「对抗是贴标签念出来」 | schemas.ts:139-177（normal trigger/calm guidance 文本） |
| M7 | 会话级预算锚定 | frictionBudget 落在 `stageResults.simulationConfig.frictionBudget`（创建会话时请求 > 画像 runtimePrefs > 默认 normal），逐轮读取不变 | 预算漂移、实验分组不可比 | backend/src/coordinators/simulation.helpers.ts:946-949；backend/src/virtual-lab/session-factory.ts:262-267；backend/src/routes/admin/virtual-learners.session-lifecycle.ts:803-811 |

### 1.3 能力悖论防御（会了装不会 / 不会装会）

| # | 机制 | 规则要点 | 防御的失真模式 | 出处 |
|---|---|---|---|---|
| M8 | 认知判决器（BEAGLE 两阶段第一段） | 独立 LLM 只输出 `{sampledCorrectness, blockedConcept, errorPattern, masteryProb}`，不生成学习者文本；模拟器「严格基于 epistemicGrounding 写 reply 与 learnerState，不得推翻」：判错时 reply 必须暴露卡点或给出一致错误尝试、不得给正确答案，自评掌握度不得高于判决；masteryProb 是掌握概率上界参考 | 同一个模型既判对错又演对错 → 「19 连对零失手」的学霸扮演（判决概率自由发挥） | prompts/core/simulation-epistemic-grounding.yaml:56-68；simulation-learn-turn.yaml:115 |
| M9 | 受控错误注入（编排层采样） | `decideControlledError`：按 friction 档位 wrongProbability(0~0.25)×struggleBoost(1~3) 采样首答判错；开课头两轮豁免；卡点必须在**本轮任务概念域**内取（P1-5）；命中真人误区语料库时按有出处的误区演（「不要换个错法，被纠正后自然接受，不要秒懂」）；判决器不服从时代码强制覆写 sampledCorrectness=false、masteryProb=0.15 | 判决概率交 LLM → 永远答对；卡点跟人设/本轮教学无关 | schemas.ts:257-382（表:265-276，采样:310-382）；backend/src/coordinators/simulation.learn-phase.ts:993-1019、1061-1087 |
| M10 | 支架两轴判决 | 判决必须同时看画像先验与教师当轮支架：「无支架冷测必挂」（struggle 概念 + 教师只抛开放式问题 → 必判错）；「有支架微步可过」（具象场景+判断口径+低门槛作答三件套齐 → 可判对但 masteryProb 保持 0.40-0.55）；课内已做对且未加难 → 不得仅因 struggle 名单判错；教师直接给答案/让抄不算支架 | 能力悖论两个方向：struggle 者永远答对（假聪明）与 struggle 者永远答错（死板名单） | prompts/core/simulation-epistemic-grounding.yaml:61-65、68 |
| M11 | 判决服从核验与钳制（确定性） | 判错轮：`auditGroundingCompliance` 检查 reply 是否暴露卡点/是否宣称已会（SUCCESS_CLAIM_PATTERN 正则）/自评是否越过 masteryProb+0.1 容差 → 只记 drift 不改文本；`clampLearnerStateToJudgment` 把 conceptualMastery/proceduralMastery 硬钳到 masteryProb（模拟器 normalize 与主链各做一次） | 「判决→翻案→答对」形态无法被审计甄别；判 0.3 却自评 0.9 | backend/src/coordinators/simulation.learn.steps.ts:438-529；simulation-learn-turn/index.ts:374-384（P1-4 钳制） |

### 1.4 记忆与自评（selfReportedTaskDone / 四态 / checkpoint）

| # | 机制 | 规则要点 | 防御的失真模式 | 出处 |
|---|---|---|---|---|
| M12 | selfReportedTaskDone 严格判定 | 只是「学习者自认为学完」，非平台裁决；必须同时：老师明显收束 + 能完成当前 task + remainingBlockers 为空 + 不想继续追问；**必须服从认知判决**（判错或 masteryProb 低于阈值时须为 false——prompt 侧软约束）；代码侧 `normalizeOutput` 再叠加 `!wantsMoreHelp && feedbackBlockers.length===0`；判错只记 `judgeCompletionBlock` 留痕不改自评（#46 结课权威在教师侧） | 「每轮都说会了」的假完成；以及反面：判决一 false 就永远不能结课（29/29 轮判死、40 轮空转的旧 bug） | prompts/core/simulation-learn-turn.yaml:103；backend/src/skills/simulation-learn-turn/index.ts:388-398；backend/src/coordinators/simulation.learn.steps.ts:340-379（computeClosureDecision，closureAuthority='teacher'） |
| M13 | 记忆四态 CLEAR/VAGUE/CONFUSED/FAILED | **代码裁决**（非模型自判）：对到期复习点按 `(会话,天,概念)` 确定性种子跑 `probabilisticRecall`，保留率来自 FSRS progress；模拟器按状态人设化表达且**不得推翻**——CLEAR 用旧框架解新情境、VAGUE 卡在关键判据、CONFUSED 把旧规则和 outputConceptKey 混用（自信地用错）、FAILED 请老师点拨；同一天内稳定、跨天重抽 | 「上次学的永远记得」或「随机忘」；记忆忽好忽坏不可回放 | backend/src/virtual-lab/memory-recall.ts:54-81；simulation-learn-turn.yaml:109；backend/src/coordinators/simulation.memory.ts:94-108 |
| M14 | checkpointAnswer 检查点作答 | 有 pendingCheckpoint 时本轮必须直接作答不闲聊；选择题只能从给定 options 选真实 id（单选一个）、简答一句 answerText、附 confidence；作答必须与认知判决一致（判错允许答错、不许硬凑正确）；代码白名单投影题面（不含答案键）、normalize 剔除编造 id、超长裁剪（3 句/160 字） | 编造选项 id 被判无效；看到题面却装没看见；判决说不会却答出标准答案 | prompts/core/simulation-learn-turn.yaml:114、148-156；backend/src/skills/simulation-learn-turn/index.ts:327-347（normalizeCheckpointAnswer）、478-493（projectPendingCheckpoint） |
| M15 | 课后记忆提炼与回写 | simulation-memory-curate 以学习者视角提炼 mastered（须带 evidence+confidence）/struggle（blocker+severity），概念名必须是可复用知识点（禁整句任务标题）；「完成≠掌握」：自评 <0.65 归 struggle 或降 confidence（与代码阈值 0.65/0.4 同口径）；回写 union-only 进 knownConcepts、按完整 known 集过滤防自相矛盾（D13）；判错降级概念显式移出 knownConcepts | 画像先验被任务名污染、同一概念又懂又卡、判错后下一课又读回 mastered | prompts/core/simulation-memory-curate.yaml:38-43；backend/src/virtual-lab/learner-memory.ts:47-50（MASTERED_CONFIDENCE_THRESHOLD=0.65/STUCK=0.4）；backend/src/coordinators/simulation.memory.ts:342-391（persistProfileConcepts） |

### 1.5 人设/故事落话（personaAnchorHint / disclosurePlan / 六维）

| # | 机制 | 规则要点 | 防御的失真模式 | 出处 |
|---|---|---|---|---|
| M16 | personaAnchorHint 字段锚点（平台常量） | 固定文本按优先级列出：verbosity（terse=1句/normal=1-2/verbose=2-3）、confusionStyle（直说/委婉暗示）、questionStyle（不问/问细节/质疑）、emotionalRange（克制/自然/明显）、helpSeekingPattern、adversarialPattern、emotionalTriggers、failurePatterns、story.disclosurePlan（哪些可暴露哪些保留）、story.pressurePoints；「不要把字段名读出来，隐式影响回复」 | 人设字段堆在 payload 里被平均化、扮演成「谁都能套的模板人」 | schemas.ts:388-401（PERSONA_FIELD_ANCHORS_HINT）；simulation-goal-dialogue.yaml:57、simulation-learn-turn.yaml:97、simulation-path-evaluate.yaml:51 |
| M17 | disclosurePlan / hiddenDetails 披露面 | story 只区分「首轮最可能怎么说」（visibleOpening）与「被追问后才补的关键细节」（hiddenDetails/disclosurePlan{opening, revelationTriggers, resistancePoints, idealProbe}）；真人不会一口气说完故事；payload 里 story 带全量私有面（含 hiddenDetails），约束是提示词级（"storyHistory 不得复述细节/不得把别的故事私有信息当已发生"，goal yaml:66、learn yaml:110）+ 事后 actor-audit 打分（disclosureDiscipline 维度） | 开场即倾倒全部背景；把私有底牌当公开事实说出 | prompts/core/simulation-scenario-designer.yaml:61、116；backend/src/virtual-lab/session-factory.ts:237-259（storyContext 全量注入）；backend/src/skills/virtual-learner-shared/payload-projection.ts:9-11、61-78（storyPool→storyHistory 投影，剔私有字段） |
| M18 | 人设生成纪律（源头防失真） | persona-designer：身份分布禁白领默认、学生样本须有课纲/考试/家长期望、emotionalTriggers/failurePatterns 各 2-4 项必填且须「可观察行为」、age 与学段自洽、四枚举（availableTime/techComfort/learningStyle/cognitiveLoadTolerance）须覆盖全部档位大致均衡（历史 73% minimal/68% low/62% doing 判不合格）、禁止安全兜底句；scenario-designer：realProblem 禁「缺乏…能力」笼统句、primaryBlockType 判定口径写死、story 必须服从 persona 不得换人、consistencyNotes 须给 2-4 条对齐校验点 | 空壳人设、抽象不可区分字段（「有真实顾虑」「先自己试再问」）、采样偏差 | prompts/core/simulation-persona-designer.yaml:30-45；simulation-scenario-designer.yaml:52-73、112-113 |

### 1.6 对话风格与话语卫生

| # | 机制 | 规则要点 | 防御的失真模式 | 出处 |
|---|---|---|---|---|
| M19* | 回复长度纪律与确定性裁剪 | learn-turn：默认 1-2 句；老师明确要求列举/分点/总结/复述时按老师要求写全（最多 6 句，具体指令优先）；ready_to_close 只做简短收口；代码侧 `cropReply` 按阶段裁剪（ready_to_close 1 句/48 字、普通 2 句/96 字、blocked 80 字、检查点 3 句/160 字、老师列举请求 6 句/360 字），按句末标点收、子句截断补省略号 | 小作文式汇报、多步清单只答第一项、截断半句被教师脑补 | prompts/core/simulation-learn-turn.yaml:102、161；backend/src/skills/simulation-learn-turn/index.ts:231-280（cropReply/EXTENDED_REPLY_REQUEST） |
| M20* | 不重复对方步骤 / 不回抛已收口问题 | goal：「不要复述对方刚说的步骤」（M3 内）；learn：「不要再用『不过说实话我还是嘀咕…』把已收口或已推后的问题重新抛回」「老师已明确收束时只简短确认，延伸意愿只走 wantsExtension 且整课最多一次」 | 收口后再扩展、复读机、以「嘀咕」句式无限拖延 | prompts/core/simulation-goal-dialogue.yaml:64；simulation-learn-turn.yaml:102、104 |
| M21* | remainingBlockers 任务边界裁剪 | 只登记**本 task 范围**的卡点；老师明确推到后面的疑问必须移出清单（reply 可说「记下了下节再说」）；判据唯一：挡不挡本 task 要交的东西（实测反例：一条被推后的疑问挂 13 轮导致 task 结构性关不上） | 清单只进不出 → 结课判据永不满足 | prompts/core/simulation-learn-turn.yaml:105、142 |
| M22* | 知识看板校准自评 | 自评先对照 knowledgeSnapshot：还不能独立处理看板当前概念（含人设 struggling）时不得自评过高、selfReportedTaskDone 不得 true；看板与 epistemicGrounding.blockedConcept 冲突的 mastered 项以判决为准（平台落库前对账降级） | 看板明示 learning/40 却自评「已掌握」 | prompts/core/simulation-learn-turn.yaml:106 |
| M23* | learnerMemory 自然引用纪律 | 只在情境相关时顺口引用；优先 recentDetails 的具体操作（「上次我把报价单压到一页宽」）而非概念名；**不编造记忆里没有的经历/成果**；材料被引用但对话里从未给原文时不得虚构数字——应说明没看到、请给原文 | 凭空编造成果/材料内容（幻觉式具身细节） | prompts/core/simulation-learn-turn.yaml:107；simulation-goal-dialogue.yaml:65 |
| M24* | 时间感（temporalContext） | 可选注入（simulatedDay/dayIndex/simulatedNow/sinceLastSessionDays）；仅当提供且情境自然时流露「隔了几天」；**不得**改变认知判决对错、不得编造输入没有的时间跨度；未提供时不得提及任何时间跨度；memoryRecall 以模拟日为步进种子 | 无中生有的「好几天没练了」；时间感推翻对错判决 | prompts/core/simulation-learn-turn.yaml:108；memory-recall.ts:32-40（种子纪律） |
| M25* | emotion 情绪字段 | 枚举 neutral/slightly_frustrated/happy/confident/confused，随轮输出；黑盒链随私有状态留痕（persistPrivateState 带 emotion），actor-audit 检查状态连续性 | 情绪字段与话语脱节（说「气死了」标 neutral）——**当前只有事后审计，无逐轮校验**（见 V-D4） | prompts/core/simulation-goal-dialogue.yaml:73-76；simulation-learn-turn.yaml:121-124；backend/src/virtual-lab/blackbox-runner.ts:1039-1044 |
| M26* | 私有状态连续性（previousLearnerState 回灌） | goal：stageResults.goal.learnerState 每轮落库、下一轮回灌（P1-12/GD-2 开场轮也接回）；learn：learningState.learnerState（经判决钳制后的 clampedLearnState）逐轮合并 profile/story bias 回灌；phaseFocus 由模型认知判断、编排器只做钳制（孤立 ready_to_close 需 readyForNextTask=true 否则阈值机回退） | 主观状态每轮重置、「上一轮刚说卡住这一轮就声称会了」 | simulation-goal-dialogue.yaml:26-29、simulation-learn-turn.yaml:35-38；backend/src/coordinators/simulation.execution.ts:526-531、678；simulation.learn.steps.ts:219-267（buildTeachingTurnContext）、simulation.helpers.ts:724-735（resolveLearnerPhase） |

\* 编号顺延，总计 26 条机制（M1–M26）。

---

## 2 跨轮状态连续性

### 2.1 各状态的「谁写、谁读、进哪轮」

| 状态 | 写入方 | 读取/回灌方 | 缝隙 |
|---|---|---|---|
| **personaAnchorHint** | 无写入：平台常量 `PERSONA_FIELD_ANCHORS_HINT`（schemas.ts:388-401），goal/learn/path-evaluate 三个 payload 同一份（simulation-goal-dialogue/index.ts:300、simulation-learn-turn/index.ts:581） | 每轮注入稳定前缀首位（KV 缓存锚，payload-stability.ts:51-65） | 常量无泄漏风险；但它只锚 4/6 个 personalityTraits（见 V-D5） |
| **friction** | 会话级 budget 落 `stageResults.simulationConfig.frictionBudget`（session-factory.ts:267）；每轮 `decideFrictionTrigger(budget)` 在 buildUserPayload 内**重新采样** triggered/guidance（simulation-goal-dialogue/index.ts:273、simulation-learn-turn/index.ts:503） | 每轮注入 payload.friction | 每轮独立伯努利，无连续性记忆（V-D3） |
| **story / storyHistory** | storyPool 由 `generateAndApplyStory` 追加进 profile JSON（learner-provisioning.ts:225-234）；会话创建时选定故事切片（含 hiddenDetails/disclosurePlan）写 `stageResults.story`（session-factory.ts:237-259） | 全量切片作为 `story` 进每轮 payload；池中**其他**故事发送前被 `projectSimulatorPayload` 收敛为 storyHistory（只留标题+≤160 字概述，剔除私有字段；payload-projection.ts:38-55） | 投影是发送时的深遍历，任何层级的 storyPool 都被转换（防串场泄露，已闭环） |
| **learnerMemory** | 课后结算链：persistAssistedLearnerMemory → memory-curate（LLM）→ writeProfileConceptsAfterLesson + recordCompletedArtifact（simulation.memory.ts:149-245）；快照读画像+memory_traces（learner-memory.ts buildLearnerMemorySnapshot） | goal 轮（simulateGoalLearnerReply:952-955）、learn 轮（loadTeachTurnKnowledgeAssets:299→payload）、path 评审（path-evaluate）、blackbox（buildLearnerMemoryForSimulator）都有 | 无；切片上限 mastered/dueReview/struggling 各 8、recentCompleted 5、recentDetails 4 |
| **memoryRecall 四态** | 只读不写：buildAssistedMemoryRecall 按 (userId, sessionId, dayIndex) 确定性生成（simulation.memory.ts:94-108） | learn 轮 payload（learn-phase.ts:1092-1096、1130） | v1 恒 `confusables: []`（memory-recall.ts:13、buildMemoryRecallHints 未传 confusablesFor）→ **CONFUSED 态在 assisted 链路实际不可达**（只有 VAGUE/FAILED/CLEAR 会出现） |
| **previousLearnerState（goal）** | 每轮 `updateStageResults('goal', {learnerState: currentGoalLearnerState})`（simulation.execution.ts:741-750、778-784、917-929）；开场轮也落（:526-531，P1-12/GD-2） | 下一轮 `stageResults.goal?.learnerState` 传入模拟器（:678）；mergeLearnerState(default+storyBias+previous) 后作为 base（helpers:751-783） | 闭环。注意 finalizeGoalLearnerState 在 ready/completed 且无显式拒绝时会把 goalReadiness 抬到 ≥0.86、readyToAdvance=true（helpers:853-869）——代码代抬「同意方向」，但显式拒绝位受 hasExplicitGoalRefusal 保护 |
| **previousLearnerState（learn）** | 每轮 clampedLearnState 写 learningState（learn-phase.ts:1147-1166）+ conversationHistory 追加学习者/教师消息（:1485-1494、1536-1544 等） | 下轮 buildTeachingTurnContext → mergeLearnerState → previousLearnerState + currentPhase=resolveLearnerPhase（learn.steps.ts:219-267） | 闭环；历史窗口裁到最近 6 条（trimLearningConversationHistory，helpers:705-717），goal 侧全量历史（execution.ts:655）经 buildGoalVisibleContext 不裁剪（helpers:802-819） |
| **concernPool / disclosedConcerns（goal 私有关切）** | 每轮 buildGoalConcernPool(profile,goalState) 确定性重建 + inferDisclosedGoalConcerns 关键词匹配累积，写 stageResults.goal（execution.ts:772-784） | **无消费者回灌模拟器**——simulateGoalLearnerReply 的参数表里没有这两个字段（simulation.coordinator.ts:941-979）；只在 stageResults 留痕 | 「算了不喂」的死状态（V-D3b）：学习者已说过的关切不进下一轮上下文，靠 visibleContext 历史间接延续 |
| **画像 knownConcepts/struggleConcepts** | 任务结算 union-only 回写（persistProfileConcepts，simulation.memory.ts:342-391）；判错降级显式移出（writeProfileConceptsAfterLesson downgraded） | learn payload 里从 learner 剥离到尾部 conceptProgress（learn-turn/index.ts:519-535，保 KV 缓存） | known union-only 永不移除——降级只能靠 lessonDowngradedConcepts 显式通道（:216-220），两条通道都要跑对才不回灌 mastered |
| **autopilot/会话状态** | learnerEnded/noPath 写 stageResults.goal + autopilot 状态机写 stopped/completed（autopilot.service.ts:654-669） | autopilot 循环、harness、（不含 executeAutoLoop——见 V-D1） | 会话保持 running（audit 残留 #4，未改）；executeSingleStep 入口不查 learnerEnded（execution.ts:443-449 只挡 failed/abandoned + stage 闸） |

### 2.2 结论

主链（story / learnerMemory / previousLearnerState / 四态 / 画像概念）读写闭环都有明确归属，2026-11-11 时代的「零落库」「丢收束轮」「老师嘴代学生自评」等断裂已修（P1-3/P1-6/P1-7 注释均为证据）。当前真正的连续性缝隙是三个**方向性问题**而非断链：friction 无惯性（V-D3a）、concernPool/disclosedConcerns 算而不喂（V-D3b）、learnerEnded 无入口闸（V-D1）。

---

## 3 确定性护栏（prompt 违规时代码能否兜住）

| 护栏 | 位置 | 能兜住什么 | 兜不住什么 |
|---|---|---|---|
| `isRepetitiveLearnerReply` | simulation.goal.steps.ts:106-150 | ①新回复与最近两条学习者发言三字组重合都 ≥0.35 且长度 ≥12 字（换词复读）；②连续 3 条「≤24 字且无问号」学习者发言 + 导师短收口（短告别循环）；命中 → `repetition-loop` 收尾落 virtual-leave（execution.ts:704-770） | 「每轮换一个话题但都不走」的语义空转（audit 残留 #3 自己承认，未修）；<12 字的复读（但被分支②部分覆盖） |
| shouldEnd 消费 + virtual-leave | simulation.execution.ts:704-770 | 模型自报离场 → 不再调 continueConversation、落 virtual-leave 日志 + learnerEnded/learnerEndReason | shouldEnd 模型不报（主信号失效时只剩三字组兜底） |
| noPath 合法终局 | execution.ts:562-605（开场即终局）、849-906（回合终局 goalReady && stage∈{completed,ready} && !learningPathId） | 不排课会话置 completed/currentStage=goal、stageResults.goal.noPath=true、返回 noPath，不再进 path 空等 | completed+goal 状态会话无重入闸（/step 可再推进，V-D1） |
| autopilot 停条件 | autopilot.service.ts:654-669 | learnerEnded → markStopped；noPath → completed + 停 | 仅 assisted 自动驾驶；`executeAutoLoop`/`executeFullSession`（execution.ts:1015-1062、1114-1131）**不查** learnerEnded/noPath（V-D1） |
| harness 单驱动 + 终局识别 | simulate-learner-e2e.ts:574-579（autopilot:'off'）、222-301（learnerEnded/noPath 停）、607-616（--expect 兑付） | 双驱动复活；把不排课误记 goal-not-converged | harness 专属；平台 /auto、/step 手动入口不受此保护 |
| 受控错误强制覆写 | learn-phase.ts:1061-1087（含判决器异常降级路径） | 判决器忽略 forcedCorrectness（旧 prompt 未同步）→ 代码强制 sampledCorrectness=false + masteryProb=0.15 | 受控错误关闭开关（VIRTUAL_CONTROLLED_ERROR_ENABLED=0）时全链回退 LLM 自判 |
| 判决服从钳制/审计 | learn-turn/index.ts:374-384（P1-4 payload 侧）+ learn-phase.ts:1141-1162 + learn.steps.ts:452-529（主链钳制 + SUCCESS_CLAIM_PATTERN 审计） | 判错轮自评越过 masteryProb（硬钳）；「判错却宣称已会」留 drift 证据链 | reply 文本不改写——「翻案答对」话语本身只能事后审计，不能实时拦 |
| 结课熔断 | LEARN_CLOSURE_LOOP_BREAK_TURNS=3（learn.steps.ts:33、167-170；learn-phase.ts:1352-1397） | 学员连续 3 轮自评完成而教师未收 → learner-loop-break 按学员意愿结课 | 卡死收课另有 evaluateStuckClosure + 课堂契约门（learn-phase.ts:1460-1505），未达成时停课不结算 |
| checkpoint 白名单 + id 校验 | learn-turn/index.ts:327-347、478-493 | 编造选项 id、答案键泄露进 payload | 简答题答非所问（只有判决器前瞻判对错兜着） |
| 回复超长裁剪 | learn-turn/index.ts:231-280 | 小作文、半句截断（句末/子句+省略号） | goal 侧 reply 无对应裁剪（只有 sanitizeVisibleContent 去 XML/压空白，goal index.ts:152-159）——离场 ≤15 字纯靠 prompt |
| prompt-realism 门禁 | backend/src/skills/__tests__/prompt-realism-guards.test.ts:14-150（离场收口不下快选、not_judgeable 不排路径、交付物归属唯一等 24+ 断言）；`prompts:check:all` 链（backend/package.json:58-63）；fields-sync 孤儿豁免登记 shouldEnd/endReason（check-core-fields-sync.ts:164-173） | 提示词回归（规则被删/改写即测试红） | 只锁文本特征，不锁运行时行为 |

总评：**goal 阶段的离场纪律有「模型主信号 + 三字组兜底 + autopilot/harness 停条件」三重防线，但防线只覆盖 assisted 自动驾驶与 harness 两条驱动路径；learn 阶段的能力悖论防线（判决器→钳制→审计）最完整；话语风格类规则（长度/离场字数/emotion 一致性）在 goal 侧基本无代码兜底。**

---

## 4 修复核验（2026-11-11 清单逐项）

| 修复项 | 状态 | 证据 |
|---|---|---|
| 模拟器 shouldEnd/endReason 进 fields 表 | **已落** | prompts/core/simulation-goal-dialogue.yaml:77-84（fields 表带 turn:true）；编译产物 prompts/skill.simulation-goal-dialogue.md:60-61 |
| shouldEnd 进 outputSchema | **已落** | backend/src/skills/simulation-goal-dialogue/index.ts:118-120（outputSchema 注释「2026-11-11 离场语义」）；fields-sync 孤儿豁免登记（check-core-fields-sync.ts:164-173） |
| 离场话语纪律进 prompt | **已落** | simulation-goal-dialogue.yaml:64（编译产物 :51 一致，无双源漂移） |
| 协调器 shouldEnd→virtual-leave 提前收尾 | **已落** | simulation.execution.ts:704-770（learnedEndedByModel 主信号 + endReason 落 stageResults.goal.learnerEndReason） |
| isRepetitiveLearnerReply 确定性兜底 | **已落且加强** | simulation.goal.steps.ts:100-150——比 audit 描述多第二条结构分支（连续短告别+导师短收口，对应跑批 21 轮告别循环）；测试 simulation.goal.steps.test.ts:7-41 共 4 例 |
| harness 单驱动（start-session autopilot:'off'） | **已落** | simulate-learner-e2e.ts:574-579 |
| harness `--expect=path|no-path` | **已落** | simulate-learner-e2e.ts:222-242（goalTerminalSignal）、250-257、607-616（learner-left/no-path 按 expect 兑付，不再记 goal-not-converged） |
| harness `--realistic-persona` | **已落，且比 audit 多一层身份锚定** | simulate-learner-e2e.ts:421-478——2026-11-13 追加：persona-designer 无视 existingPersonaSeed 生成无关职业时，把 nameHint/occupation/background 锚回 case、只保留行为字段（triggers/failures/time），drift 有告警日志 |
| autopilot learnerEnded→stopped / noPath→completed | **已落** | autopilot.service.ts:652-669 |
| 不排课终局（开场轮 + 回合轮两条路径） | **已落** | execution.ts:562-605、849-906；currentStage 钉在 'goal'、noPath=true |
| Goal 提示词「离场信号 ≠ 延期信号」 | **已落（规则改写重命名）** | 旧「延期信号同权」条款已不存在（grep「延期」0 命中）；现行 goal-conversation.yaml:50「授权或信息不足时直接推进」（管「说不准/回头看」→ 按假设出方案）+ :51「话已说完就收口」（≤2 句、不提问、不复述步骤、不下 quickReplies）+ :211 quickReplies 字段说明「用户离场/收口轮必须留空」；prompt-realism-guards.test.ts:14 锁定 |
| not_judgeable 一律不排路径 | **已落** | goal-conversation.yaml:103-112（档位定义 + 媒体成片兜底 + 「不得输出 confirmedProposal/不得进 proposing/禁假实操任务」）；prompt-realism-guards.test.ts:138 锁定 |
| path-planning「交付物归属唯一」 | **已落（扩散为三条）** | path-planning.yaml:77、path-task-design.yaml:92（audit 里的「stage-designer 不越界」语义并入 path-task-design，规则名统一为「交付物归属唯一」）；prompt-realism-guards.test.ts:144-189 多条锁定 |
| goal simulator 测试 9/9（shouldEnd 透传/缺省不误收尾） | **已落** | simulation.goal.steps.test.ts（buildGoalStepResult learnerEnded/noPath 透传、noPath 不误报 goalReady）+ goal index.ts:231-233「只有显式 true 才收尾」 |
| 残留 #4（learner-ended 会话保持 running） | **未改（audit 自己标注为产品待定）** | execution.ts:741-770 只写 stageResults，不动 session.status；无 paused 语义 |
| 残留 #3（语义看门狗） | **未做** | 仍只有三字组 + 短告别结构兜底，无「连续 N 轮无信息增量」检测 |
| 残留 #2（persona 种子可控） | **部分**：harness 有身份锚定兜底（上述），但「显式 persona 种子参数」未进 harness CLI（applyRealisticPersona 用 --profile-role/--profile-scenario 间接控制） |

---

## 5 残留问题向量

按严重度排序。V-D1/V-D2 为新发现（2026-11-11 审计未覆盖），V-D6 为 audit 自认残留的现状态。

**V-D1｜learnerEnded/noPath 终局没有入口闸：状态只进不出，手动/auto 入口可让离场学习者复活（严重度：中高）**
- 证据：`executeSingleStep` 入口只挡 `status∈{failed,abandoned}` 与 `currentStage!=='goal'`（backend/src/coordinators/simulation.execution.ts:443-449），**不读** `stageResults.goal.learnerEnded`；`executeAutoLoop` 只在 `!stepResult.success` 或 `stepResult.goalReady` 时 break（:1027-1061），`executeFullSession` Phase A 只看 `lastGoal.goalReady`（:1114-1131）——两者都不识别 learnerEnded/noPath。`POST .../step` 与 `POST .../auto` 直接驱动这两个函数（virtual-learners.assisted-runtime.ts:44-74、80+）。noPath 后 session.status='completed' 也不在挡列表里（execution.ts:443 只挡 failed/abandoned）。
- 失真形态：学习者在 goal 说完「我先去忙」后，管理端点一次「自动循环」会继续 step 到 maxRounds——每轮让一个已经说过告别的人再告一次别（模型自报 shouldEnd 会再次命中 virtual-leave，但循环不会因此终止）；一键全流程则会把 learner-ended 误报成「Goal 在 N 轮内未收敛」错误。2026-11-11 的修复只接到了 autopilot（autopilot.service.ts:663-669）与 harness（simulate-learner-e2e.ts:250-283）两个调用方，编排器自身的两个通用入口漏接。
- 兜底现状：isRepetitiveLearnerReply 能把每轮压成一次 virtual-leave，不让复读膨胀成对话，但挡不住循环本身白烧 LLM 调用与日志。

**V-D2｜blackbox 链路忽略 shouldEnd，且用数值字段代发确认——与 assisted 已废除的「代签」语义不一致（严重度：高，对黑盒实验产品面）**
- 证据：blackbox-runner.ts:1014-1044 goal 分支只消费 `output.reply / learnerState / emotion`，`shouldEnd/endReason` 被丢弃（grep 全仓 shouldEnd 消费方仅 goal.steps/execution/goal-index/fields-sync 四处，blackbox-runner 不在内）；:1037-1038 `shouldConfirm = availableActions.includes('confirm_proposal') && learnerState.readyToAdvance === true` → 直接发 `confirm_proposal` 动作。而 assisted 侧 2026-11-07 已拍板「确认信号归学习者自己，确认必须出现在 reply 里，协调器不再按 readyToAdvance 代发」（simulation.execution.ts:793-807、helpers.ts:886-892；提示词 simulation-goal-dialogue.yaml:63「没有任何系统会替你按确认，只提高兴绪字段不算」）。
- 失真形态：①blackbox goal 对话没有离场动作——对方收口后学习者被 step 就必须再答，蓝屏式告别循环在黑盒实验里仍可能复现（且无 isRepetitiveLearnerReply 兜底，该函数在 assisted goal.steps.ts）；②黑盒里「拍板」由 readyToAdvance 数值代签，而该数值会被 finalizeGoalLearnerState 在 ready/completed 阶段抬到 ≥0.86 并置 readyToAdvance=true（helpers.ts:853-869）——同一套「平台替学习者按确认」的失真在黑盒产品面上还活着。blackbox 的确认语义或许是有意保留按钮直通（UI 有确认按钮），但与 yaml「拍板必须口播」的规则组合后，黑盒学习者的行为与 assisted 同一角色不可比。
- 附带：blackbox learn 侧与 assisted 同口径（6 条窗口、受控错误、判决链，blackbox-runner.ts:1062-1137）——不对称只在 goal。

**V-D3｜friction 每轮独立重采样、无惯性建模；concernPool/disclosedConcerns 算而不喂（严重度：中）**
- 证据 a：`decideFrictionTrigger` 在 buildUserPayload 内每轮调用（simulation-goal-dialogue/index.ts:273、simulation-learn-turn/index.ts:503），伯努利独立采样；平稳轮 guidance 明文「不翻旧账」（schemas.ts:157）。上一轮刚触发「时间不够」的对抗，下一轮 70% 概率必须「保持自然合作」——真人争辩中途不会瞬间归零，学习者会在对方刚回应顾虑时突然无条件配合，摩擦呈白噪声而非剧情。
- 证据 b：goal 私有关切池每轮确定性重建 + 关键词匹配累积（execution.ts:772-784、helpers.ts:894-915），写进 stageResults.goal，但 simulateGoalLearnerReply 参数表无此二字段（simulation.coordinator.ts:941-979）——disclosedConcerns（这人已经承认过哪些顾虑）是死状态，防重复倾诉/防「忘了自己说过」都靠 visibleContext 历史间接承担（而 goal 可见历史不裁剪，尚可覆盖；一旦历史丢失则无兜底）。
- 附带：friction.triggerProbability 注入值恒为 `triggered ? 1 : 0`（goal index.ts:294-299），payload 里的字段名与档位概率表脱钩——模型看到的是「这一轮必须/不必对抗」的既成事实，这是设计使然（可测性），但也意味着「这轮没触发」与「这人根本不爱对抗」在话语上不可区分，只能靠会话级统计还原。

**V-D4｜emotion/endReason 无枚举校验、与话语一致性无逐轮检查（严重度：低中）**
- 证据：两个模拟器 normalize 都是 `safeText(parsed?.emotion) || fallback`（goal index.ts:230、learn index.ts:408），任意字符串通过；endReason 只 `slice(0,40)`（goal index.ts:233），四枚举只写在 yaml desc（goal yaml:81-84）。emotion 落日志（execution.ts:717、learn-phase.ts:1196）与黑盒私有状态（blackbox-runner.ts:1039-1044），黑盒再由 actor-audit 事后看连续性（simulation-actor-audit.yaml:35）。话语说「太气人了」配 emotion=neutral 不会有任何即时信号；goal 阶段私有状态不入黑盒审计通道（assisted 链无 actorProfile 审计调用点，audit 技能只在 blackbox/vlab 实验编排中消费）。

**V-D5｜personalityTraits 六维只有四维有话语锚点；patience/enthusiasm 只进私有数值（严重度：低）**
- 证据：PERSONA_FIELD_ANCHORS_HINT 列 verbosity/confusionStyle/questionStyle/emotionalRange + 4 个人设模式字段（schemas.ts:388-401）；learn yaml 规则 6 同样只提这四个+helpSeekingPattern（simulation-learn-turn.yaml:97）。patience/enthusiasm 只落 buildDefaultLearnerState 的数值（patienceBase→attentionLevel/persistenceLevel、enthusiasmBase→motivationLevel，helpers.ts:538-556）与 concernPool 一条 hidden 关切（:614-616），而私有数值状态对「这句话怎么说话」的影响远弱于锚文本。低耐心人设与高耐心人设的话语差异基本靠模型从 profile JSON 自由发挥（payload 里带全量 traits 对象，但无使用说明）。scenario-designer 明确产出六维（yaml:70、97），两头之间缺一环。

**V-D6｜「换话题不走」语义看门狗仍缺失（2026-11-11 残留 #3，未修，严重度：中）**
- 证据：isRepetitiveLearnerReply 只抓「换词复读」与「短告别循环」两类形态（goal.steps.ts:106-150）；学习者在压力话题间跳跃（每轮换个新借口拖延但不离场）不命中任何护栏，autopilot 的 AUTOPILOT_GOAL_MAX_ROUNDS 与 harness GOAL_MAX_STEPS 是唯一上界。audit 建议的「连续 N 轮无信息增量」检测未实现（grep 无对应实现）。

**V-D7｜CONFUSED 态在 assisted 链路不可达、四态覆盖面收窄（严重度：低）**
- 证据：memory-recall.ts:13「v1 范围：不接混淆池（confusables: []）」，buildAssistedMemoryRecall 未传 confusablesFor（simulation.memory.ts:101-107）→ probabilisticRecall 的 CONFUSED 分支（probabilistic-recall.ts:349）永远不触发。提示词与人设文档描述的「把旧规则和别的概念自信地混用」这一失真演法当前实际演不出来；到期点只会在 CLEAR/VAGUE/FAILED 间落。属功能缺口而非失真，但会让「四态」在评测报告里呈现为三态。

**V-D8｜goal 开场确定性模板化：开场永远 storyDemand.text + 固定预算句（严重度：低，设计取舍）**
- 证据：开场不调模拟器，`openingReply = storyDemand.text + budgetLine`，budgetLine 是固定句式「时间上我这边是 X 天内，每天大约 Y 分钟，总投入约 Z 小时」（execution.ts:453-495，P2-10 为消「状态与开场不自洽」与白烧调用而设）；openingLearnerState 由 finalizeGoalLearnerState 从画像代码推导。个体差异完全由故事文本承担，同一故事重跑会开场逐字相同；「时间自述」句式千人一面。这是需求传递保真与扮演自然的权衡，当前完全偏向前者。

**V-D9｜ensurePersonaFallbacks 的兜底值仍是「通用模板人」种子（严重度：低）**
- 证据：learner-provisioning.ts:97-114——未生成人设的卡兜底 `age=28 / learningStyle='doing' / emotionalTriggers=['遇到挫折'] / failurePatterns=['半途而废'] / knownConcepts=['基础概念']`。这与 audit 批判的空壳人设同源：不走 --realistic-persona 的旧跑数/手建卡仍会带着这些占位情感触发进 friction 演法菜单（触发轮 guidance 让模型「触发你的 emotionalTriggers」时，演的就是「遇到挫折」这种空洞触发）。persona-designer 侧已堵（必填 2-4 项具体可观察，yaml:44），但兜底路径没堵。

**已排除的疑似向量（调查后确认不成立）**
- 「friction 只在 goal 有、learn 无摩擦预算」：不成立。learn-turn 有 friction 输入+硬规则（simulation-learn-turn.yaml:83-86、96）且编排逐轮传入（learn-phase.ts:1134）；path-evaluate 也有（yaml:50）。
- 「记忆四态由模型自判无地面真值」：不成立。四态是代码按 FSRS 保留率+确定性种子裁决（memory-recall.ts:54-81），模拟器只演不判且「不得推翻」（learn yaml:109）。
- 「selfReportedTaskDone 完全自由」：不成立。prompt 有严格判定条件+判决服从（yaml:103），代码叠加 `!wantsMoreHelp && blockers 空`（learn index.ts:393-395），结课链另有教师权威+3 轮熔断。
- 「storyHistory 泄露其他故事私有信息」：已由发送前投影闭环（payload-projection.ts:61-78），只留标题+概述。

---

## 6 小结

- 扮演机制编目 **26 条**（离场纪律 4、摩擦演法 3、能力悖论 4、记忆自评 4、人设落话 3、话语卫生 8），每条均含「规则要点 + 防御的失真模式 + 出处」。
- 跨轮状态 9 类读写链主闭环，缝隙集中在 friction 惯性、concernPool 死状态、learnerEnded 无入口闸。
- 确定性护栏 12 项：goal 离场三重防线完整但只覆盖 autopilot/harness 两个驱动方；learn 能力悖论防线最厚。
- 2026-11-11 修复清单 **13 项已落**（多数比原描述更强：测试锁定、身份锚定、规则扩散），2 项 audit 自认残留未动（语义看门狗、paused 语义），1 项部分落（persona 种子）。
- 残留问题向量 **9 条**（V-D1 入口闸缺失可复活离场、V-D2 黑盒忽略 shouldEnd+代签确认、V-D3 摩擦白噪声+关切死状态、V-D4 emotion 无校验、V-D5 两维无锚点、V-D6 看门狗缺、V-D7 CONFUSED 不可达、V-D8 开场模板化、V-D9 兜底模板人），另排除 4 条疑似向量。
