# 仿真与辅助 Skill 运行环境地图

> 审计员只读调查产物（2026-08-10）。覆盖：simulation 家族 8 个 skill + aux skill 9 个 + handler-only 1 个（skill:learner-model）。注：aux 中 session-evaluation-fallback 已于 2026-08-11 退役（调查时点仍注册，见 §2.2 标注）。
> 证据精确到 file:line。路径相对仓库根 `D:\wenflow\wenflow`。
> 字段路由唯一源 = `prompts/orchestration/simulation.yaml`（simulation 家族）+ 主链各 stage yaml（goal/path/teaching/profile）。

## 0. 关键文件索引

| 文件 | 作用 |
|---|---|
| `prompts/orchestration/simulation.yaml` | simulation 阶段字段路由唯一声明源（契约 8 个 agent、字段 16 个、路由 28 行） |
| `prompts/core/<skillId>.yaml` | 各 skill 的 v4 核心文件（fields 声明 + failurePolicy + sandbox refs） |
| `backend/src/coordinators/simulation.coordinator.ts` | 辅助模式（assisted）协调器 = `simulation-agent` 运行时 |
| `backend/src/virtual-lab/blackbox-runner.ts` | 正式黑盒（blackbox-api）运行时 + 旁路裁判/审计 |
| `backend/src/virtual-lab/quick-learn/quick-learn.service.ts` | 快速学习运行器（真实生产链账号自动学习） |
| `backend/src/skills/v4-aux-skills/index.ts` | 9 个 aux skill 的 runAux 统一框架（2026-08-11 起 8 个，session-evaluation-fallback 已退役） |
| `backend/src/services/agent-manifest.service.ts` | agent 归属真理源（5 顶层 agent + 16 skill） |
| `backend/src/services/skill-output-validator.ts` | core fields 契约校验 + 排除名单 |

---

# 一、simulation 家族档案（8）

## 1.1 skill:virtual-learner-persona-designer（虚拟学习者人格设计）

- **声明**：`prompts/core/virtual-learner-persona-designer.yaml`。fields 顶层名：`personaSeed`（object，含 20+ 子字段）。编排字段：`personaSeed`（simulation.yaml:100-105，render=visible，handoff=[simulation-agent]，internal=false，accumulate=false）。
- **agent 归属**：manifest kind=skill、category=simulation、`agentMembers` 在 `simulation-agent` 下（agent-manifest.service.ts:125-126）；`simulation.yaml` contracts 第 17 行。
- **调用链**：无主链/黑盒调用，全部在管理端路由手拼输入后直调：
  - `backend/src/routes/admin/virtual-learners.ts:828`（POST /generate-persona）：输入 `preferredLevels`/`candidatePersonas`/`recentPersonaHints`（来自 buildRecentScenarioHints）/`existingPersonaSeed`；
  - `:853`（POST /:id/draft-profile）：增量增强，输入 `preferredLevels` + 现库 personaSeed；
  - 均经 `executeSkill`（skills/index.ts:227-234 → executor.ts:149），无 `runWithContext` 注入、无 sandbox 对账（对比 blackbox-runner.ts:2130-2139）。
  - 输出收取：skill 内 `normalizePersonaOutput`（skills/virtual-learner-persona-designer/index.ts:171）读取 `personaSeed` 并补 canonical 字段；路由读 `result.personaSeed`（:844/:879）。
  - （POST /generate-profile 旧签名端点已于 2026-08 清债删除，画像生成唯一入口为 generate-persona）
- **流转**：handoff=[simulation-agent]（声明层）。落库去向：`virtual_learner_profiles` 由 admin 手工保存（POST / 路由 :1554-1571 手写 profile JSON；draft 结果仅回给前端，由前端保存）。下游消费：`parseProfileData`（simulation.coordinator.ts:609-643）、`captureCurrentExperimentSnapshot`（blackbox-runner.ts:1952-1972）、quick-learn `learnerPersona`（quick-learn.service.ts:330-336）。
- **运行环境**：**管理工具**。触发方式：admin 路由显式点击（生成/增强画像）。失败语义：core `failurePolicy: retry`（yaml:69）；LLM 失败抛错 → 路由 500；无 fallback 降级。validation 排除名单内（skill-output-validator.ts:160）。

## 1.2 skill:virtual-learner-scenario-designer（虚拟学习者场景设计）

- **声明**：`prompts/core/virtual-learner-scenario-designer.yaml`。fields：`personaSeed`、`story`、`consistencyNotes`（yaml:67-107）。编排字段：仅 `consistencyNotes`（simulation.yaml:108-113，render=visible，handoff=[simulation-agent]）；`personaSeed`/`story` 未登记路由（注释见 simulation.yaml:34：goalSeed/situationSeed/stories 已退役，语义由 story.goalSeed 与 profileData.storyPool 承接）。
- **agent 归属**：manifest kind=skill、category=simulation、simulation-agent 成员（agent-manifest.service.ts:126-127、273-283）；simulation.yaml contracts 第 18 行。
- **调用链**：管理端路由直调：
  - `virtual-learners.ts:894`（POST /:id/draft-stories）：输入 preferredMotivations/existingPersonaSeed/existingStoryPool/targetStoryCount=1。
  - 输出收取：`normalizeScenarioOutput`（skills/virtual-learner-scenario-designer/index.ts:175）读取 `personaSeed`/`story`/`consistencyNotes`；draft-stories 路由读 `result.story`（:935）。
  - （POST /generate-scenario 无持久化旧变体已于 2026-08 清债删除，场景生成唯一入口为 draft-stories）
- **流转**：handoff=[simulation-agent]（声明层）。落库去向：draft-stories 自动持久化到 `virtual_learner_profiles.profile.storyPool`（:1337-1347，`normalizeStoryPoolData` 见 session-factory.ts:32-67）。下游消费：`createSessionForProfile` 选故事（session-factory.ts:118-133、195-220）、`resolveStorySessionDemand`（story-demand.ts，blackbox-runner.ts:704-711、simulation.coordinator.ts:1404-1411）。
- **运行环境**：**管理工具**。失败语义：core `failurePolicy: retry`（yaml:109）；无 fallback。validation 排除（skill-output-validator.ts:163）。

## 1.3 skill:virtual-learner-goal-dialogue-simulator（Goal 阶段学习者回合模拟器）

- **声明**：`prompts/core/virtual-learner-goal-dialogue-simulator.yaml`。fields：`reply`/`emotion`/`learnerState`/`debug`（yaml:46-67）。编排字段：`reply`/`emotion`/`learnerState`（visible）+ `debug`（hidden+internal，internal=true）（simulation.yaml:116-140）。
- **agent 归属**：manifest kind=skill、category=simulation、simulation-agent 成员（agent-manifest.service.ts:128、285-295）；simulation.yaml contracts 第 19 行。
- **调用链**：
  - **assisted（协调器）**：`simulateGoalLearnerReply`（simulation.coordinator.ts:801-845，executeSkill 在 :811）→ 调用点：开场（:1414-1423，仅旁路观测，开场正文用 storyDemand.text）、常规轮（:1562-1573，包 `retryLearnUpstream` 3 次）。输入为服务端手拼（learner/story/visibleContext/currentPhase/previousLearnerState/frictionBudget/task）。
  - **blackbox（正式链）**：`autoStep`（blackbox-runner.ts:717-733，经 `executeSimulatorSkill` :2126，带快照 prompt/route 覆写 + L2 sandbox 对账 :2130-2139）。输入按 stageResults.experimentSnapshot 拼装。
  - 输出收取：skill 内 `normalizeOutput`（skills/virtual-learner-goal-dialogue-simulator/index.ts:186）读 reply/emotion/learnerState/debug；协调器再读 `output.reply`/`output.emotion`/`output.debug?.stateChangeReason`/`runtimeEnvelope.contextUpdate.nextState`（:1432-1445、:1594-1602）；blackbox 读 `output.reply`/`output.learnerState`/`output.emotion`/`output.debug`（:733-741）。
- **流转**：handoff=[simulation-agent]。落库：assisted → `virtual_sessions.stageResults.goal.learnerState/lastRuntimeEnvelope`（updateStageResults :1610-1616）与 `logs[].phase=virtual-reply`；blackbox → `stageResults.blackbox.learnerPrivateState.goal` + `learnerPrivateStateTrace`（persistPrivateState blackbox-runner.ts:736-741、1887-1926）。下游消费：SessionCockpit 私有状态时间线（frontend/src/views/admin-redesign/SessionCockpit.vue:1444+）、actor-auditor 输入（buildActorAuditInput :1715-1729）。
- **运行环境**：**仿真黑盒 + 辅助模式**（双链）。触发：goal 每轮自动。失败语义：skill 层 fallback（yaml:72 failurePolicy=fallback；LLM 失败返回 `degraded:true` 保守兜底 :299-315）；协调器层 `retryLearnUpstream` 3 次（:401-420）+ reply 缺失即抛错（:1575-1577）；blackbox 层 reply 缺失抛 `BLACKBOX_*`（:733）。validation 排除（skill-output-validator.ts:157）。

## 1.4 skill:virtual-learner-path-evaluator（Path 评估器）

- **声明**：`prompts/core/virtual-learner-path-evaluator.yaml`。fields：`reaction`/`visibleRequestedChanges`/`debug`（yaml:44-56）。编排字段：`reaction`/`visibleRequestedChanges`（visible）+ `debug`（hidden+internal）（simulation.yaml:143-161）。
- **agent 归属**：manifest kind=skill、category=simulation、simulation-agent 成员（agent-manifest.service.ts:129、297-307）；simulation.yaml contracts 第 20 行。
- **调用链**：**仅 assisted 模式**。`reviewPathProposal`（simulation.coordinator.ts:2091-2215，executeSkill :2126）。core 明确"blackbox 模式不调用本技能"（path-evaluator.yaml:7）。输入手拼：learner=parseProfileData、pathProposal=learning_paths+milestones、previousReaction=stageResults.path_review、frictionBudget。
- **输出收取**：`normalizeOutput`（skills/virtual-learner-path-evaluator/index.ts:148）读 reaction/visibleRequestedChanges/debug；决策读 `debug.internalDecision`（合法枚举否则默认 'accept'，:2155-2157）、`debug.internalConfidence`、`debug.visibleSignal`（:2159）。
- **流转**：handoff=[simulation-agent]。落库：`stageResults.path_review`（:2178-2190）+ `logs[].phase=path-review`。下游：acceptPathReview（:2218-2251）/replanPathFromReview（:2254-2324）/resolvePathReview（:2330-2371）人工闸门。
- **运行环境**：**仿真黑盒的辅助调试旁路**（仅 assisted/legacy；blackbox 不触发）。失败语义：core `failurePolicy: fallback`（yaml:61，skill 层有 buildFallback）；reaction 缺失抛"虚拟用户 Path 评审结果无效"（:2148-2150），reviewPathProposal catch 后返回 success=false（:2204-2214）。validation 排除（skill-output-validator.ts:159）。

## 1.5 skill:virtual-learner-learn-turn-simulator（Learn 阶段回合模拟器）

- **声明**：`prompts/core/virtual-learner-learn-turn-simulator.yaml`。fields：`reply`/`emotion`/`learnerState`/`learnerFeedback`/`debug`（yaml:55-85）。编排字段：`reply`/`emotion`/`learnerState`/`learnerFeedback`（visible）+ `debug`（hidden+internal）（simulation.yaml:164-194）。
- **agent 归属**：manifest kind=skill、category=simulation、simulation-agent 成员（agent-manifest.service.ts:130、309-319）；simulation.yaml contracts 第 21 行。
- **调用链**（三个运行时全用）：
  - **assisted**：`executeLearningStep`（simulation.coordinator.ts:2783，包 retryLearnUpstream，输入含 knowledgeSnapshot :2772-2782、acceptanceCriteria :2805）。
  - **blackbox**：`autoStep` teaching 分支（blackbox-runner.ts:758-798，经 executeSimulatorSkill :2126）。
  - **quick-learn**：`runSimulatorTurn`（quick-learn.service.ts:560-571，固定 `frictionBudget: 'none'` :570，story=null）。
  - 输出收取：`normalizeOutput`（skills/virtual-learner-learn-turn-simulator/index.ts:198）读 reply/emotion/learnerState/learnerFeedback/debug；assisted 经 `resolveSimLearnerState`（coordination :847-854，优先 envelope.contextUpdate.nextState）；收束判定读 learnerFeedback.{selfReportedTaskDone,wantsMoreHelp,stopAsking,remainingBlockers}（:2877-2882；quick-learn :384-389；blackbox :781-784）。
- **流转**：handoff=[simulation-agent]。落库：assisted → `stageResults.teaching.learnerState/latestLearnerFeedback/closureDecision/taskRuntime/conversationHistory`（:3072-3114）；blackbox → `learnerPrivateState.teaching` + trace；quick-learn → `virtual_quick_learn_runs.transcript/report`（:669-670）。下游：SessionCockpit 课堂面板、QuickLearnPanel.vue:400 传播报告。
- **运行环境**：**仿真黑盒 + 辅助模式 + 快速学习**（三链共用）。失败语义：core `failurePolicy: fallback`（yaml:91）；assisted 层 retry 3 次 + reply 空抛错（:2826-2829）+ turn 预算 30 显式失败（LEARN_TASK_TURN_BUDGET=30，:47、:2724-2745）；blackbox reply 缺失抛错（:780）；quick-learn 连续 3 次 degraded 终止运行（SIMULATOR_FAILURE_LIMIT=3，quick-learn.service.ts:41、:360-369）。validation 排除（skill-output-validator.ts:158）。

## 1.6 skill:virtual-learner-referee（平台体验裁判）

- **声明**：`prompts/core/virtual-learner-referee.yaml`。fields：`verdict`/`scores`/`findings`/`recommendations`/`evidence`（yaml:45-68）。编排字段：5 个全 visible、handoff=[simulation-agent]（simulation.yaml:197-226）。
- **agent 归属**：manifest kind=skill、category=simulation、simulation-agent 成员（agent-manifest.service.ts:131、321-331）；simulation.yaml contracts 第 22 行。
- **调用链**：**仅 blackbox 旁路**。`referee()`（blackbox-runner.ts:511-574，executeSkill :540）。前置：会话必须终态（completed/abandoned/failed，:515-517）。输入服务端组装 `buildRefereeInput`（:1641-1662，含 buildRefereeStoryMeta :1665-1687、buildRefereeMetricCompleteness :1690-1713）。输出收取：`normalizeRefereeOutput`（skills/virtual-learner-referee/index.ts:63-142）——scores 按 stageCoverage 置 null、overall 固定权重重算、verdict 由分数派生（LLM 的 verdict 不作为最终值，仅 normalizedFallback 语义）、evidenceSufficiency<50 → inconclusive（:133-139）。报告写入 `stageResults.blackbox.refereeReports`（去重：inputFingerprint :520-530、:1833-1835）。
- **流转**：handoff=[simulation-agent]（声明层）。落库：`stageResults.blackbox.refereeReports[].report`（最多 10 份，:559-567）。下游：SessionCockpit 裁判评估卡片（SessionCockpit.vue:339-401，从 session 详情 stageResults.blackbox 渲染；GET /blackbox-snapshot 重复读端点已于 2026-08 清债删除）。
- **运行环境**：**仿真黑盒（终局旁路审计）**。触发：admin 手动（POST /blackbox-evaluations，virtual-learners.ts:1939）；非自动。失败语义：core `failurePolicy: retry`（yaml:76）；skill 层 LLM 失败返回 success=false（referee/index.ts:211-217）→ 路由 502（:1951）；幂等去重（同 runId+inputFingerprint 复用）。validation 排除（skill-output-validator.ts:161）。（单裁判 POST /blackbox-referee 已删，由 evaluations 双评估覆盖）

## 1.7 skill:virtual-learner-actor-auditor（角色保真审计）

- **声明**：`prompts/core/virtual-learner-actor-auditor.yaml`。fields：`verdict`/`scores`/`findings`/`recommendations`/`evidence`（yaml:45-68，verdict 枚举为 credible 系）。编排字段：与 referee 共享同一组 fieldId（simulation.yaml:229-258，词汇统一批次 actor*→verdict）。
- **agent 归属**：manifest kind=skill、category=simulation、simulation-agent 成员（agent-manifest.service.ts:132、333-343）；simulation.yaml contracts 第 23 行。
- **调用链**：**仅 blackbox 旁路**。`actorAudit()`（blackbox-runner.ts:576-636，executeSkill :605）。前置：终态（:580-582）。输入组装 `buildActorAuditInput`（:1715-1729：actorProfile/story/frictionBudget/learnerPrivateState+Trace/publicTrace/experimentSummary）。输出收取：`normalizeActorAuditOutput`（skills/virtual-learner-actor-auditor/index.ts:60）读 verdict/scores/findings/recommendations/evidence。
- **流转**：handoff=[simulation-agent]。落库：`stageResults.blackbox.actorAuditReports[]`（:621-629，inputFingerprint 去重）。下游：getSnapshot → SessionCockpit 角色评估卡片（SessionCockpit.vue:403-460）。
- **运行环境**：**仿真黑盒（终局旁路审计）**。触发：admin 手动（/blackbox-evaluations :2527-2533）。失败语义：core `failurePolicy: retry`（yaml:74）；失败 → 路由 502。validation 排除（skill-output-validator.ts:162）。

## 1.8 simulation-agent（编排器，非 skill）

- **声明**：无 core.yaml（编排器无 prompt）。编排字段：全部 28 行路由 handoff 均指向它（simulation.yaml:98-258）。
- **agent 归属**：manifest kind=agent、category=agent、runtimeEnabled、userVisible=false、monitoringGroup=Simulation（agent-manifest.service.ts:117-134）；7 个成员即 simulation 家族。
- **调用链**：两套运行时 + 三个定义文件：
  - `simulation.coordinator.ts`（assisted 编排器，COORDINATOR_ID='simulation-agent' :40）；调用入口：admin 路由 step/auto/advance-path/review/accept/replan/start-learning/teaching-step/auto-learning/run-full/restart-*/stop/wrapup（virtual-learners.ts:1652-2410）+ regression-run（:2531）。
  - `blackbox-runner.ts`（blackbox-api 编排器）；入口：start-blackbox-session（:1731）/blackbox-rerun（:1756）/blackbox-action/step/observe/evaluations（:1891-1953）。
  - 定义视图：`simulation.definition.ts:6-15`（8 步链，step 7/8 = referee/actor-auditor 终态旁路）；`agent-contract-view.ts` SANDBOX_EXTRA_KEYS['simulation-agent']（:104-136）声明输入通道为服务端注入（simulation.yaml:8）。
- **流转**：手写状态机（非 LLM）。落库：`virtual_sessions.stageResults`（updateStageResults :1020-1042）/`virtual_experiment_commands`（blackbox :304-315）/`virtual_experiment_leases`（:248-267）。
- **运行环境**：**仿真黑盒 + 辅助模式**。失败语义：assisted 租约 409/503（VirtualSessionLeaseBusyError :63-94）、Learn 上游重试 3 次、课时预算 30；blackbox 幂等命令 + 对账（BlackboxReconciliationPendingError :109-118）。

---

# 二、aux skill 档案（9）

> ⚠️ 2026-08-11：本节为调查时点（2026-08-10）快照；§2.2 session-evaluation-fallback 已于当日完整退役（注册/户口簿/产物注销，见 doc/FALLBACK_RETIREMENT_PLAN.md Phase A），下文相关条目仅作历史图谱保留。

> 统一框架：`backend/src/skills/v4-aux-skills/index.ts`。`runAux`（:74-138）约定：所有 handler 只经 `callPrompt` 调 ACTIVE prompt（requireActivePrompt）；`__prompt` 透传调用上下文、`__fallback` 提供降级值、`__onFailure` 覆盖策略；失败策略运行时从 ACTIVE prompt 的 failurePolicy 解析（resolveDefaultFailureMode :145-154：deterministic-fallback/best-effort→降级，blocking/retry→抛错，解析失败保守抛错）。
> **共性：均无编排字段声明**（不在任何 prompts/orchestration/*.yaml contracts/routings 中，也不在 agent-manifest 中——agent-manifest.service.ts 全文无 aux id）。字段契约保障见总结节 §4.2。

## 2.1 skill:teaching-opening-generator（课堂开场交互生成器）

- **声明**：core.yaml fields：message/question/quickReplies/mode（type 依次 string/string/object[]/enum）。params failurePolicy=**fallback**。无编排字段。
- **agent 归属**：manifest 无此 id（不在 AGENT_MANIFEST）；仅出现在视图层 `ai-teaching.definition.ts:16`（teaching-agent 的 step 2，kind=skill）。
- **调用链**：`AITeachingCoordinator.generateOpening`（AITeachingCoordinator.ts:1248-1306），executeSkillWithResult 在 :1261（包 withTimeout 15s）。输入手拼（subject/topic/taskTitle/.../openingMode/learningSignal/lastLessonRecap）+ `__fallback: fallbackOpening`（:1277）+ `__prompt.callerAgentId=AI_TEACHING_AGENT_ID`（:1282）。输出收取：handler normalize 读 message/question/quickReplies/mode（v4-aux-skills/index.ts:193-203）。
- **流转**：输出作为 teaching session 的 opening 块存 `teaching_sessions`（startSession 流程内）。下游：quick-learn openingMessage 拼接（quick-learn.service.ts:325-328）、前端课堂开场。
- **运行环境**：**平台直调（教学主链）**。触发：每次 startSession 自动。失败语义：fallback（__fallback 确定性 opening）；超时/异常 → fallbackOpening（:1286-1305），不阻断开课。字段契约：**不在排除名单**，受 core fields 校验（prompt-composer.ts:506-523）。

## 2.2 skill:session-evaluation-fallback（课程评估补全器）

> ⚠️ **已退役（2026-08-11）**：本 skill 已四同步注销（v4-aux-skills 注册 / skills.yaml 户口簿 / core / manifest / md 产物删除，进 PURGED_SKILLS 由启动 purge 清存量 DB 行）。本节约为调查时点（2026-08-10）历史图谱，调用链描述已不适用。

- **声明**：core.yaml fields：sessionLss/sessionKtl/sessionLf/confidence/reasoning（全 number/number/number/number/string）。failurePolicy=**fallback**。无编排字段。
- **agent 归属**：无 manifest。
- **调用链**：`session-wrapup/index.ts` `generateEvaluationFallback`（:624-646），executeSkill 在 :631，懒加载避循环依赖（:629-630）。输入 = SessionWrapupInput 全量 + `__fallback: null`（:633）。输出收取：handler normalize 原样透传（v4-aux-skills/index.ts:226）；调用方 `extractEvaluation` 读 sessionLss/sessionKtl/sessionLf/confidence/reasoning（:639）。
- **流转**：主 wrapup 的 evaluation 缺失时补全 → `teaching_sessions.wrapup.evaluationSource='ai-fallback'`；也经 generateWrapupForSession 进 `stageResults.teaching.wrapup`（simulation.coordinator.ts:3636-3645）。
- **运行环境**：**平台直调（教学主链 fallback 分支）**。失败语义：fallback（builtinFallback=null → 调用方返回 null → wrapup 标 evaluationSource='failed'）；LLM 失败不抛（:640-645）。字段契约：**不在排除名单**，受 core fields 校验。

## 2.3 skill:learner-progress-report（学习进展报告生成器）

- **声明**：core.yaml fields：reasoning/suggestion（string）。failurePolicy=**fallback**。无编排字段。
- **agent 归属**：无 manifest。
- **调用链**：`LearnerProgressService.generateLearningReport`（LearnerProgressService.ts:226-274），executeSkill 在 :251。输入手拼（task/metrics/signals）+ `__fallback` 内置句（:232-235、:264）+ `__prompt.callerAgentId='profile-agent'`（:268）。输出收取：handler normalize 读 reasoning/suggestion（v4-aux-skills/index.ts:239-242）。
- **流转**：进度报告文本回流 LearnerProgressService（学习者状态中心）；调用方 catch 兜底（:271-273）。
- **运行环境**：**平台直调（profile 辅助）**。失败语义：fallback。字段契约：**不在排除名单**，受 core fields 校验（reasoning/suggestion 必填）。

## 2.4 skill:generic-chat（平台通用文本能力）

- **声明**：core.yaml fields：reply（string）；outputMedia=text（非 JSON 对象）。failurePolicy=**propagate**。无编排字段。
- **agent 归属**：无 manifest。
- **调用链**：`AIService.chat`（ai.service.ts:304-382），executeSkillWithResult 在 :340。输入 = systemPrompt + message + 历史 assistantMessages + 生成参数覆盖（model/temperature/maxTokens 走 generationOverride，v4-aux-skills/index.ts:85-89）。输出收取：handler normalize 强制 string（:257）。
- **流转**：通用 AI 文本接口，供各服务兜底对话（请求路径 /services/ai/chat）。
- **运行环境**：**平台直调（通用能力）**。失败语义：propagate → 抛错（chat 调用方处理）。字段契约：**排除名单**（非 JSON 对象输出，skill-output-validator.ts:154）。

## 2.5 skill:course-design（课程设计器）

- **声明**：core.yaml fields：tasks（object[]）。failurePolicy=**propagate**。无编排字段。
- **agent 归属**：无 manifest。
- **调用链**：`AIService.designWeekCourses`（ai.service.ts:789-835），executeSkillWithResult 在 :812（指定 COURSE_DESIGN_MODEL + callerAgentId='course-design'）。输出收取：handler normalize 原样透传（v4-aux-skills/index.ts:272）。
- **流转**：设计结果经 AIService 返回；**未发现任何路由/主链调用 designWeekCourses 的生产入口**（全库仅 ai.service.ts 自身）。
- **运行环境**：**已退役（死注册）**。失败语义：propagate（但无生产触发）。字段契约：排除名单（"无生产调用"注释，skill-output-validator.ts:166——注意与 ai.service 中仍存在的调用方法形成文档/实现漂移）。

## 2.6 skill:skill-author（Prompt 起草助手）

- **声明**：core.yaml fields：systemPrompt（string）；outputMedia=markdown。failurePolicy=**propagate**。无编排字段。
- **agent 归属**：无 manifest。
- **调用链**：`services/skill-author/index.ts` `draftSkillPrompt`（:42-67），executeSkillWithResult 在 :47，`__prompt.requestPath=/services/skill-author/draft`。HTTP 入口：`routes/admin/skill-author.ts:33`（POST /draft）。输出收取：handler normalize 强制 string（v4-aux-skills/index.ts:284）。
- **流转**：起草的 system prompt 由 admin 继续走 skill-compiler 验收 + 发布。
- **运行环境**：**管理工具**。失败语义：propagate → 抛 SKILL_AUTHOR_EMPTY_OUTPUT（:53）。字段契约：排除名单（markdown 输出，skill-output-validator.ts:155）。

## 2.7 skill:skill-compiler（Skill Prompt 验收器）

- **声明**：core.yaml fields：pass（boolean）/parsedJson（object?）/missingFields（string[]）/rawOutput（string）。failurePolicy=**propagate**。无编排字段。
- **agent 归属**：无 manifest。
- **调用链**：`services/skill-author/index.ts` `compileSkill`（:121-180），executeSkillWithResult 在 :145，`__prompt.requestPath=/services/skill-author/compile`。HTTP 入口：`routes/admin/skill-author.ts:89`（POST /compile）。输出收取：handler normalize 原样透传（v4-aux-skills/index.ts:296）；调用方读 output.parsedJson/missingFields/pass（:149-163）。
- **流转**：验收结果回 admin（pass/fieldHits/missingFields/suggestions）。
- **运行环境**：**管理工具**。失败语义：propagate → 调用方 catch 记 error 并返回 pass=false（:176-179）。字段契约：**不在排除名单**，受 core fields 校验。

## 2.8 skill:basic-evaluator（学习质量评估器，已退役）

- **声明**：core.yaml 仍存在（fields：score/grade/dimensions/strengths/improvements/overallFeedback/nextSteps；failurePolicy=**propagate**）。无编排字段。
- **agent 归属**：无 manifest。
- **调用链**：**零生产调用**（全库唯一引用 = v4-aux-skills/index.ts:27、303-313 handler 定义）。handler 仍注册（`auxSkillDefinitions` → `allSkillDefinitions` → 启动注册循环 index.ts:481-486）。
- **流转**：无。
- **运行环境**：**已退役（死注册/僵尸注册）**。证据：`scripts/cleanup-retired-field-data.ts:22` 将 'basic-evaluator' 列入退役清理；`skill-output-validator.ts:151,164` 标注"无生产调用"。但 `index.ts` 启动 purge 名单 RETIRED_SKILLS（:45-92）**未包含** basic-evaluator/goal-alignment-checker → 每次启动仍被重新注册进 skill_registrations（一次性脚本清理后被注册循环复活）。

## 2.9 skill:goal-alignment-checker（路径目标对齐检查器，已退役）

- **声明**：core.yaml 仍存在（fields：score/knowledgeDistribution/cognitiveProgression/goalRelevance/suggestions；failurePolicy=**fallback**）。无编排字段。
- **agent 归属**：无 manifest。
- **调用链**：**零生产调用**（唯一引用 = v4-aux-skills/index.ts:28、315-325 handler 定义）。同 basic-evaluator：handler/definition 仍注册。
- **流转**：无。
- **运行环境**：**已退役（死注册/僵尸注册）**。证据同 2.8（cleanup-retired-field-data.ts:22 + skill-output-validator.ts:151,167）。core 文件仍在 prompts/core/ 且未被 purge，ACTIVE prompt 残留可能性高。

---

# 三、handler-only（1）

## 3.1 skill:learner-model（学习者画像与状态中心）

- **声明**：**无 core.yaml**（manifest `noPromptFile: true`，agent-manifest.service.ts:242）。无编排字段（仅在 profile.yaml 契约区出现，profile.yaml:14；无 routings 行——handler-only 无 LLM 输出）。
- **agent 归属**：manifest kind=skill、category=profile、**profile-agent 成员**（agent-manifest.service.ts:111-112、233-245）；非 simulation-agent。
- **调用链**：handler-only 确定性服务（无 LLM）：`agents/learner-model-agent/index.ts:26-75`（action=get/update/get-personalization/get-snapshot/get-exit，走 profileAggregator/personalizationEngine/learnerSnapshotService/learnerExitService）。
- **仿真/后台关联**：
  - quick-learn 的前后快照对比消费其 snapshot/projection：`learnerSnapshotService.getSnapshot` + `learnerProjectionService.toTeachingProjection`（quick-learn.service.ts:278-288、500-506）；传播报告 diff 经 snapshot-diff（propagation-report.ts:11）。
  - teaching-turn 消费 `TeachingLearnerProjection`（skills/teaching-turn/index.ts:8）；teaching 主链 snapshot 刷新由 `LearnerSnapshotRefreshService` 承接（profile-agent 主链，不在本地图范围）。
- **运行环境**：**平台直调（profile 主链服务）**。失败语义：纯函数无 LLM 失败语义；executor 层错误码统一。

---

# 四、总结节

## 4.1 仿真链路总图（样本设计 → 主链模拟 → 旁路审计）

```
[配置阶段·管理工具]                        [正式黑盒 blackbox-api]                    [旁路审计·终局]
persona-designer ─┐
  (generate-persona/                       start-blackbox-session
   draft-profile :828/:853)                (session-factory.ts:142-264：
scenario-designer ┘                          选故事→storyContext→experimentSnapshot)
  (draft-stories :894 → storyPool             │
   持久化 :940)                               ▼
                                    ┌─ blackbox-runner.autoStep（:689，链式状态机）────┐
                                    │ 首轮: storyDemand.text 开场（:704-711）           │
                                    │ goal:   goal-dialogue-simulator（:717-733）      │
                                    │ path:   observe→start_learning（:742-752）      │
                                    │         （**不调 path-evaluator**，core:7 明示）  │
                                    │ teaching: learn-turn-simulator（:758-798）       │
                                    │         动作映射 confirm_complete/request_hint/  │
                                    │         request_example/chat（:781-789）         │
                                    └──────────────┬──────────────────────────────────┘
                                                  ▼ 终态(completed/abandoned/failed)
                                     referee（:511）／ actor-auditor（:576）
                                     admin 手动触发 /blackbox-evaluations
                                     → stageResults.blackbox.refereeReports/
                                       actorAuditReports → SessionCockpit

[辅助模式 assisted·协调器]（黑盒之外的 legacy 调试链，同一批 skill 双轨）
simulation.coordinator：
  executeSingleStep :1383（goal 开场 :1414 → goal-dialogue :1562 → goal-conversation 主链 :1620）
  advanceToPathGeneration :1958（path 主链 :2034；**path-evaluator 仅此链调用**）
  reviewPathProposal :2091 → accept/replan 人工闸门（:2218/:2254）
  executeLearningStep :2523（learn-turn :2783 ↔ AI teaching 主链 :2865）
  generateWrapupForSession :3570（session-wrapup :3633）
→ stageResults.{goal,path,path_review,teaching} + logs

[快速学习 quick-learn]（与黑盒并列的另一验证形态，**不共享会话状态**）
quick-learn.service.startRun :98 → executeRunInContext :258
  startSession（真实教学主链 :316）→ learn-turn-simulator（:560，friction='none'）
  → 双重收束（teacherReady && learnerReady，:413）→ endSession（含 wrapup，:452）
  → completeTask（:464）→ 等待 outbox 投影（:614-636）→ 前后快照 diff → PropagationReport
→ virtual_quick_learn_runs（:155-166、:664-675）→ QuickLearnPanel
```

要点：
- **blackbox 链式执行顺序**：`autoStep`（blackbox-runner.ts:689-805）为单步状态机（goal→path→teaching→terminal），与 `act`（:638-687）配对；动作经 `runCommand` 幂等命令层（:173-339）+ 平台投影对账（journalProjectionReceipt :945-979、persist :830-926）。path 阶段不评审直接 start_learning。
- **referee/actor-auditor 不自动跑**：仅在实验终态后由 admin 手动触发（POST /blackbox-evaluations，virtual-learners.ts:1939），且 referee 需 `status ∈ {completed,abandoned,failed}`（blackbox-runner.ts:515-517）。
- **assisted 链与 blackbox 链互斥**：session-mode.ts 区分 `blackbox-api` 与 assisted（assertBlackboxSessionMode/assertAssistedSessionMode，virtual-learners.ts:1836-1845）；run-full（:2215）与 regression-run（:2531）走 assisted。
- **quick-learn 与黑盒的关系**：独立形态。黑盒 = 合成会话（projection token 驱动平台 API，blackbox-runner.ts:807-828）；quick-learn = 真实虚拟账号沿生产链学习（frictionBudget 恒 'none'，只验证链路）；两者共用 learn-turn-simulator 与 virtual_learner_profiles，但落库不同（stageResults.blackbox.* vs virtual_quick_learn_runs）。

## 4.2 aux skill 调用矩阵

| skill | 调用者（file:line） | 输入组装 | 输出收取 | failurePolicy |
|---|---|---|---|---|
| teaching-opening-generator | AITeachingCoordinator.ts:1261 | 手拼 context 字段 + `__fallback`+`__prompt` | runAux normalize → message/question/quickReplies/mode（index.ts:193-203） | fallback |
| session-evaluation-fallback | ~~session-wrapup/index.ts:631~~（已退役 2026-08-11，调用点已删） | SessionWrapupInput 全量 + `__fallback:null` | normalize 透传 → extractEvaluation（:639） | fallback |
| learner-progress-report | LearnerProgressService.ts:251 | 手拼 task/metrics/signals + `__fallback` | normalize → reasoning/suggestion（:239-242） | fallback |
| generic-chat | ai.service.ts:340（AIService.chat） | systemPrompt+message+history+generationOverride | normalize → string（:257） | propagate |
| course-design | ai.service.ts:812（designWeekCourses） | params 全量 + model 覆盖 | normalize 透传（:272） | propagate |
| skill-author | services/skill-author/index.ts:47 → admin/skill-author.ts:33 | DraftSkillPromptInput + `__prompt` | normalize → string（:284） | propagate |
| skill-compiler | services/skill-author/index.ts:145 → admin/skill-author.ts:89 | CompileSkillInput + `__prompt` | normalize 透传 → pass/parsedJson/missingFields（:149-163） | propagate |
| basic-evaluator | **无生产调用**（仅定义 v4-aux-skills/index.ts:303-313） | — | — | propagate（不生效） |
| goal-alignment-checker | **无生产调用**（仅定义 :315-325） | — | — | fallback（不生效） |

**字段契约保障（无编排字段时）**：
1. **core.yaml fields 声明** = 契约源（每个 aux 的 core 文件均有 fields 表）；
2. **callPrompt 管线层强制校验**：`validateSkillOutputFields`（skill-output-validator.ts:220-248）在 prompt-composer.ts:506-523 对**所有** LLM 调用生效——校验不过 → 该 attempt 失败重试/按 failurePolicy 处理；
3. 排除名单（skill-output-validator.ts:153-168）豁免：generic-chat / skill-author（非 JSON 输出）、semantic-freeze-judge（守门直调）、simulation 家族 8 个、basic-evaluator/course-design/goal-alignment-checker/concept-priority（无生产调用）；
4. 因此**实际受 core fields 契约校验的 aux = teaching-opening-generator / learner-progress-report / skill-compiler**（3 个；session-evaluation-fallback 已退役不计数）；
5. 输入侧契约 = runAux 的 `buildUserPayload` 白名单（index.ts:180-325）+ core.yaml `inputs` 声明；无 sandbox ref 校验（aux 无 ref 声明）、无编排字段注册（不进字段路由表）、无 agent-manifest（不可被 gateway 的 agent 拓扑/监控发现）。

## 4.3 运行环境分类表

| 分类 | skill | 触发源 | 失败语义 |
|---|---|---|---|
| 仿真黑盒（blackbox-api） | goal-dialogue-simulator / learn-turn-simulator | admin 黑盒动作/autoStep（virtual-learners.ts:1891/:1909） | skill fallback（degraded）→ 黑盒抛 BLACKBOX_*；命令对账可重试 |
| 仿真黑盒·终局旁路 | referee / actor-auditor | admin 手动（/blackbox-evaluations :1939） | core retry；失败 502；inputFingerprint 幂等去重 |
| 辅助模式（assisted，legacy 调试） | goal-dialogue / path-evaluator / learn-turn | admin step/auto/run-full/regression-run（:1652/:1678/:2215/:2531） | retryLearnUpstream×3；turn 预算 30；path-evaluator fallback |
| 快速学习 | learn-turn-simulator（friction='none'） | admin quick-learn/runs（virtual-quick-learn.ts:119） | 连续 3 次 degraded 终止；teacherReady streak>4 收束；不续跑（interrupted 标记 :218-228） |
| 管理工具 | persona-designer / scenario-designer / skill-author / skill-compiler | admin 路由（virtual-learners.ts:763-971；skill-author.ts:33/:89） | core retry/propagate；无 fallback；500 报错 |
| 平台直调（主链/服务） | teaching-opening-generator / ~~session-evaluation-fallback~~（已退役 2026-08-11）/ learner-progress-report / generic-chat / learner-model（handler-only） | 教学主链 startSession、wrapup fallback 分支、LearnerProgressService、AIService.chat、snapshot 服务 | fallback（前三者）/ propagate（generic-chat）/ 纯函数 |
| 已退役（死注册） | basic-evaluator / goal-alignment-checker | 无 | 不生效；每次启动被重新注册 |

## 4.4 环境缺口

1. **死注册（僵尸注册）**：basic-evaluator / goal-alignment-checker 已在 `scripts/cleanup-retired-field-data.ts:22` 退役清理，但：
   - 仍留在 `AuxSkillId` 联合类型与 META（v4-aux-skills/index.ts:19-28、160-170）→ 仍进 `auxSkillDefinitions`（:331）→ 每次启动经注册循环（index.ts:481-486）重新写回 skill_registrations；
   - `index.ts` 启动 purge 名单 RETIRED_SKILLS（:45-92）**未覆盖**这两个 id，与一次性清理脚本清单不一致（两份名单漂移）；
   - core.yaml 文件（prompts/core/basic-evaluator.yaml、goal-alignment-checker.yaml）与 ACTIVE prompt 仍存在；skill-output-validator.ts:151 的"无生产调用"注释与 ai.service.ts:812 仍存在的 course-design 调用方法互相印证 course-design 也处于"有定义无入口"状态（skill-output-validator.ts:166 注释称其无生产调用——文档已过期但结论相同）。
2. **声明与调用不一致（模拟器家族）**：
   - 编排文件宣称 handoff=[simulation-agent]（交付给编排层组装），但实际**无任何 stage 间字段传递**（simulation.yaml:7-10 已自述"无阶段间 handoff"）；personaSeed/story 两个字段未登记路由（仅 consistencyNotes 登记），与 core.yaml 三字段输出形成声明缺口；
   - path-evaluator 在 simulation.yaml 契约/路由在册，但 blackbox 正式链不调用（core:7 明示），仅 assisted 调试链调用——"在册"与"仅 legacy 生效"并存；
   - referee/actor-auditor 的 verdict/scores/findings/recommendations/evidence 5 字段在仿真阶段路由表中是"交付声明"，实际输出直接进 stageResults.blackbox 报告（blackbox-runner.ts:544-558），不经任何 handoff 组装。
3. **sandbox ref 对账覆盖不全**：L2 声明化装配只对黑盒的 goal/teaching 模拟器生效（blackbox-runner.ts:2130-2139，sandbox-resolver.service.ts:171-189）；persona/scenario-designer（管理端直调）与 coordinator 侧模拟器调用无运行时对账，sandbox refs 仅编译期 advisory（prompt-lab.ts:477-478 checkInputHandoffs）。
4. **字段契约豁免清单**（skill-output-validator.ts:153-168）：
   - 模拟器家族 8 个全部豁免（turn 字段多、fallback 路径特殊、referee 旁路通道）——意味着这 8 个 skill 的 core fields 声明不参与运行时校验，仅靠 skill 内 normalize 自查；
   - generic-chat / skill-author：非 JSON 对象输出；
   - semantic-freeze-judge：平台守门直调，且 gateway 强制关闭 thinking mode（router.ts:76-78），失败一律 uncertain（semantic-freeze-judge.ts:57-65、109-131）；
   - basic-evaluator / course-design / goal-alignment-checker：无生产调用（course-design 有残留 service 方法，见缺口 1）。
5. **quick-learn 与黑盒状态不互通**：quick-learn 产物在 `virtual_quick_learn_runs`，黑盒在 `virtual_sessions.stageResults.blackbox.*`；quick-learn 不消费 story/stageResults，学习结果回流真实账号的 learner snapshot——两类"仿真"数据源在 SessionCockpit/QuickLearnPanel 分开展示，无统一视图。
6. **learner-model 声明为空**：handler-only 无 core.yaml（noPromptFile=true），其仿真关联（snapshot 供给 quick-learn/teaching）仅存在于服务层引用（quick-learn.service.ts:278-288、skills/teaching-turn/index.ts:8），无任何 prompt/字段契约可审计。
