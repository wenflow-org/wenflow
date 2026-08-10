# dataSource 声明化（P4）决策调查 —— 输入来源全景与声明对象判定

> 版本：v1.0（2026-08-10）
> 性质：**只读调查**（未改任何代码）。为 `prompts/skills.yaml` 条目预留字段 `dataSource`（P4 实施，warn 级校验）产出决策证据。
> 前置确认：`SKILL_EXPANSION_DESIGN.md` §5.2（代码直读声明化）、`SKILLS_YAML_SPEC.md` §1.3 字段表 + W5 校验行、`skills-file.ts` 已预留 `dataSource?: { db?: string[]; api?: string[] }` 形状校验（schema 解析已上线，P4 未启用）。
> 方法：对 15 主链 + 2 handler-only + 10 aux 共 27 条注册，逐一追踪 `executeSkill` 调用点 → 组装函数 → prisma/服务/外部调用。全部证据精确到 file:line。

---

## 0. 核心结论（TL;DR）

1. **handler 层零数据直读成立（两个特例）**：15 个主链 handler + 9 个 aux handler（semantic-freeze-judge 平台直调除外）均为纯函数——只消费 `executeSkill` 注入的 input，内部仅调 `callPrompt`（LLM）+ `agentConfigService.getActivePrompt`（读自己的系统 prompt 载体 `agent_prompts`）。**例外**：`mcp-tool`（直调 MCP 外部工具）、`learner-model`（handler-only 服务型 handler，直读主库 4 表）。
2. **LLM 输入 100% 由编排层/调用方组装**：所有 payload 由协调器/service/route/outbox consumer 拼装，来源分三层（sandbox 声明式注入 / 协调器直读主库 / 外部 MCP）。**db-table 层是唯一零声明、零对账的层**。
3. **dataSource 现有 schema 语义与事实不符**：`SKILL_EXPANSION_DESIGN` §5.2 定义它为"handler 代码直读声明"，但 handler 层零直读 → 按原语义扫描只会命中 mcp-tool 一条，声明将形同虚设。**P4 必须把声明对象修正为"该 skill 的 LLM 输入由编排层从哪些数据源组装"**（声明挂在 skill 条目上，描述的是编排层行为），并把扫描器目标从 handler 源码改为 `executeSkill` 调用点数据流。
4. **静态校验可行（函数级摘要 + 调用点数据流），建议 warn 级**：32 个生产调用点可静态枚举；组装函数（build*Input / assemble* / buildTeachingScenarioContext）数量有限（~15 个），对它们做 prisma 表读取摘要即可覆盖大部分输入来源。
5. **建议实施：做，但缩小范围**——只声明 db-table 类 + sandbox 类，api 类仅 mcp-tool（已由 mcpTools 字段覆盖）；schema 扩展为 `{ db: [{table, keys?, via}] }`；扫描器出初稿 → 人工确认 → W5 warn 上线。不做运行时强制（维持 §5.2 决策）。

---

## 1. 输入来源全景表

组装方式图例：**[配置式]** = routings 表驱动抽取（field-dispatcher）；**[手拼+沙盘对账]** = 手拼 payload + sandbox-resolver 运行时键对账；**[手拼]** = 纯代码拼装。

### 1.1 主链 15 个

| # | skill | 组装点（executeSkill 调用） | 组装时读取的数据源（精确到表/键） | 组装方式 | 分层 |
|---|---|---|---|---|---|
| 1 | goal-conversation | `services/learning/goal-conversation.service.ts:636`（callAI） | `goal_conversations`（:604 findUnique → `collectedData` JSON：`messages/history`、`understanding`、`stage`、`confirmedProposal`、`structuredData`、`confidenceScores`、`collected`）；沙盘对账 `checkAgentSandboxRefsFromContext`（:620-633，goal provider 5 键） | 手拼 + 沙盘对账 | ②+① |
| 2 | path-planning | `services/learning/learning.service.ts:2509`（analyzePathWithAgent） | 输入 = `buildPathAgentInput`（:2449）自 `GeneratePathData`：goal 链上游 = `goal_conversations.collectedData`（经 `buildGoalPathRequest` goal-conversation.service.ts:787-843，含 `goalHandoffFields`）；`buildFramedNormalizedInput`（:2491，确定性定帧，只读 `config/pedagogy.config` 代码常量）；path.coordinator 侧 `getPathAgentInputConfig`（path.coordinator.ts:371/376 → `agent_lab_configs` agentConfig.service.ts:101）；沙盘 path provider 对账（sandbox-resolver.service.ts:249-259） | 手拼 + 沙盘对账 | ②+① |
| 3 | stage-designer | `learning.service.ts:2933`（generateStageTasks）、`:4093`（redesignMilestoneTasks） | `learning_paths`（:2829 findUnique → `aiPromptTemplate` 内 `cognitiveDesign/normalizedInput/sceneFraming`）、内嵌 `milestones`（:2882）、`subtasks`（completed 任务 :4062）；replan 链另含 `learnerReplanProjection`（:4090）；配置式跨轮上下文 `assembleStageDesignerChannels`（:2899-2906 → `agent_field_routings` 表 path-agent 行） | 配置式 + 手拼 | ②+① |
| 4 | teaching-turn | `services/ai-teaching/AITeachingCoordinator.ts:1399` | 输入 = `buildTeachingTurnInput`（:767-889）：`session`（TeachingSessionRepository → `teaching_sessions`，claimOperation :1342）；`context` = `buildTeachingScenarioContext`（:1364 → `subtasks`+`milestones`+`learning_paths` TeachingContextBuilder.ts:393-405、`learning_metrics`+`teaching_sessions` learning-state.service:378-444、learner 快照 `learner_evidence`/`teaching_sessions`/`subtasks`/`learning_paths` LearnerSnapshotService.ts:173-302、`teaching_sessions` 上一节 recap :316-326）；配置式通道 `assembleTeachingTurnChannels`（:854 → `agent_field_routings` teaching-agent 行）；沙盘 teaching provider 对账（:829-850） | 配置式 + 手拼 + 沙盘对账 | ②+① |
| 5 | peer-reinforcement | `AITeachingCoordinator.ts:1470`（processStudentMessage）、`:2588`（processPeerMessage） | `teaching_sessions`（getById :2575 / claimOperation :1342）；教学回合内存输出（teachingOutput.analysis）；最近 6 条消息（session.messages） | 手拼 | ② |
| 6 | session-wrapup | `AITeachingCoordinator.ts:1842`（endSession 流） | `teaching_sessions`（claimFinalization :1795 → teachingState/messages/knowledgeState）、`context`（buildTeachingScenarioContext :1840，同上 ② 表集）；**嵌套调用** session-evaluation-fallback（session-wrapup/index.ts:631，输入 = wrapup 输入透传） | 手拼 | ② |
| 7 | adaptive-guidance-copy | `services/learner/DashboardGuidanceSnapshotService.ts:149`、`services/learner/LearningStateGuidanceService.ts:89` | 共享聚合 `assembleLearningState`（assemble-learning-state.ts:62-113 → `users`/`learning_paths`(+milestones+subtasks)/`subtasks`/`teaching_sessions`，:135 `learnerSnapshotRefreshService.refresh` → learner_evidence 等，:144 learning-state `checkWarnings` → learning_metrics）；输入 = `{learnerSnapshot, learningState, path, sessionWrapup, advisory}` | 手拼 | ② |
| 8 | lesson-knowledge-enricher | `services/learner/LessonKnowledgeEnrichmentConsumer.ts:27` | `domain_event_inbox`（:12 消费幂等）；事件 payload 来自 `lesson:completed` 领域事件（AITeachingCoordinator.ts:1981-2003 发布，含 `knowledgeState`/`visibleDialogueContext`/`wrapup`/`performance`，即 teaching_sessions 数据投影） | 手拼（事件驱动） | ② |
| 9 | learner-model | **handler 直读（反例）**：`agents/learner-model-agent/index.ts:78-120` handler 本体经 LearnerSnapshotService/profileAggregator/personalizationEngine/learnerExitService 直读 | `learner_evidence`（LearnerSnapshotService.ts:173/:292）、`teaching_sessions`（:179/:297）、`subtasks`（:184/:302）、`learning_paths`（:394/:404）；outbox 消费者（index.ts:599-613）经 service 直调 | 无组装（服务型 handler） | ②（handler 内） |
| 10 | virtual-learner-persona-designer | `routes/admin/virtual-learners.ts:927`（generate-profile）、`:1237`（generate-persona）、`:1268`（draft-profile） | `virtual_learner_profiles`（:1261 findUnique → profile/personalityTraits/learningGoal）；`buildRecentScenarioHints`（:687-696 → `virtual_learner_profiles` findMany 最近 12 条 profile/notes/learningGoal） | 手拼 | ② |
| 11 | virtual-learner-scenario-designer | `routes/admin/virtual-learners.ts:1208`（generate-scenario）、`:1315`（draft-stories 链） | `buildRecentScenarioHints`（同上 :687）；DEFAULT 常量（代码） | 手拼 | ② |
| 12 | virtual-learner-goal-dialogue-simulator | `coordinators/simulation.coordinator.ts:811` | `virtual_sessions`(+`virtual_learner_profiles` include，:587)、`goal_conversations`（:602/:1661）；会话 `stageResults` JSON（含 story/profile/learnerState） | 手拼 | ② |
| 13 | virtual-learner-path-evaluator | `simulation.coordinator.ts:2126` | `virtual_sessions`（:2099）、`learning_paths`（:2112 → title/description/milestones）、`milestones`（:2120）；`stageResults`（:2109） | 手拼 | ② |
| 14 | virtual-learner-learn-turn-simulator | `simulation.coordinator.ts:2783`、`virtual-lab/quick-learn/quick-learn.service.ts:560` | 主链：`virtual_sessions`、`learning_paths`（:2555）、`milestones`+`subtasks`（currentTask/currentMilestone/knowledgeSnapshot :2772-2782）；quick-learn：`virtual_learner_profiles`（:99）、`subtasks`（:104）、`milestones`（:583） | 手拼 | ② |
| 15 | virtual-learner-referee | `virtual-lab/blackbox-runner.ts:540`（buildRefereeInput :1641-1662） | `virtual_sessions`（:512）、`virtual_learner_profiles`（:1557）、`stageResults`（publicTrace/refereeTrace/control）、`teaching_sessions`+`learning_metrics` 时间线（learningStateService.getSessionStateTimeline :1695） | 手拼 | ② |
| 16 | virtual-learner-actor-auditor | `blackbox-runner.ts:605`（buildActorAuditInput :1715-1729） | `virtual_sessions`、`virtual_learner_profiles`（:1557 via getExperimentSnapshot）、`stageResults`（learnerPrivateState/publicTrace） | 手拼 | ② |

> 注：表 1.1 的 #1-#15 即主链 15 个；#9 learner-model 为 handler-only 但按 SKILLS_YAML_SPEC 归 profile 主链序列，此处如实列出（它是唯一 handler 直读反例）。#10-#16 为 simulation 组 7 个（persona/scenario 是前置配置阶段，不在 simulation.definition.ts 主链 steps 内，见 skills.yaml:165/:178 notes）。

### 1.2 handler-only / aux 10 个

| # | skill | 组装点 | 数据源 | 组装方式 | 分层 |
|---|---|---|---|---|---|
| 17 | mcp-tool（handler-only） | `routes/user-mcp.ts:326`；admin skill 沙盒 `routes/admin/skills.ts:201` | **handler 直读（反例）**：`user_mcp_configs`（mcp-tool/index.ts:80 getUserMcpRuntimeConfig）、`config/mcp.json` 平台工具（:126）；**外部调用** `mcpGateway.callTool/callConfiguredTool`（:95/:140 → safe-http 外呼 MCP 服务器） | 无组装（工具执行器） | ③ |
| 18 | teaching-opening-generator（aux） | `AITeachingCoordinator.ts:1261`（generateOpening） | context = buildTeachingScenarioContext（:1248/1364，表集同 teaching-turn ②）；`deriveTeachingRuntimeSignals`（:1249，纯派生） | 手拼 | ② |
| 19 | session-evaluation-fallback（aux） | `skills/session-wrapup/index.ts:631`（嵌套调用） | 输入 = session-wrapup 的 input 透传（教学回合产物，非 DB 直读） | 手拼（嵌套） | ②（间接） |
| 20 | learner-progress-report（aux） | `services/learner/LearnerProgressService.ts:251`（generateLearningReport，触发点 `learning.service.ts:4623` 任务完成） | metrics/signals 由调用方计算：learning-state（`learning_metrics`/`teaching_sessions` 聚合）+ `subtasks` 完成度 | 手拼 | ② |
| 21 | generic-chat（aux） | `services/ai/ai.service.ts:340`（chat 通用兜底） | 调用方消息/历史（无 DB） | 手拼 | ②（无数据源） |
| 22 | course-design（aux） | `ai.service.ts:812`（designWeekCourses） | 请求体 + 代码常量 COURSE_DESIGN_MODEL；**僵尸**：唯一调用点无调用者（skills.yaml:294 notes） | 手拼 | ②（无数据源） |
| 23 | skill-author（aux） | `services/skill-author/index.ts:47` | 用户提交的 prompt 文本/字段清单（无 DB） | 手拼 | ②（无数据源） |
| 24 | skill-compiler（aux） | `services/skill-author/index.ts:145`（compileSkill） | 用户提交 systemPrompt/requiredFieldIds（无 DB） | 手拼 | ②（无数据源） |
| 25 | basic-evaluator（aux） | **无调用点**（僵尸，skills.yaml:316） | — | — | — |
| 26 | goal-alignment-checker（aux） | **无调用点**（僵尸，skills.yaml:324） | — | — | — |
| 27 | semantic-freeze-judge（aux，platformGate） | `services/prompt-lab/semantic-freeze-judge.ts` 直调 callPrompt（不走 v4-aux handler，skills.yaml:335） | 两个 prompt 版本文本（发布流水线 Gate#3） | 平台直调 | ②（无 DB） |

### 1.3 其余调用点（不计入主链/aux 生产调用）

- `routes/admin/skills.ts:201`：admin skill 沙盒通用执行（任意输入）。
- `routes/admin/prompt-ops.ts:1170`：admin 手工试跑 goal-conversation。
- `scripts/verify-kv-prefix-cache.ts:51`：离线脚本 FIXED_INPUT 试跑。
- `blackbox-runner.ts:2143`：黑盒实验 action 重放通用执行（definition 动态）。

---

## 2. 数据来源分层统计与声明现状

### ① 编排注入（sandbox 声明式，有对账）—— 已有注册表

- 注册表：`SANDBOX_EXTRA_KEYS`（`services/agent-contract-view.ts:55-137`，5 个 agent 分组共 70+ 键：goal-agent 5 / path-agent 9 / teaching-agent 17 / profile-agent 8 / simulation-agent 27+）+ routings 推导键 + core.yaml `inputs[].ref: sandbox:...` 声明。
- 对账链：snapshots 生成、`sandbox-path-unregistered`、`prompts:check-handoff --strict`（静态）+ `checkAgentSandboxRefsFromContext` 运行时 warn（goal-conversation.service.ts:619-633、AITeachingCoordinator.ts:829-850）。
- 声明现状：**完整**（设计 C §5.1 sandboxKeys 迁入编排文件仍在 P3 待办，静态表现役）。

### ② 协调器直读主库（无声明）—— 本调查的主体

| 库 | 表 | 消费链（file:line） |
|---|---|---|
| 主库 | `goal_conversations`（collectedData JSON） | goal：goal-conversation.service.ts:604 |
| 主库 | `learning_paths`（aiPromptTemplate/cognitiveDesign/milestones） | path：learning.service.ts:2829；teaching：TeachingContextBuilder.ts:393-405；simulation：simulation.coordinator.ts:2112/2555 |
| 主库 | `milestones` | path：learning.service.ts:2882；simulation：simulation.coordinator.ts:2120；quick-learn：:583 |
| 主库 | `subtasks` | path：learning.service.ts:4062；teaching：TeachingContextBuilder.ts:393；simulation/quick-learn：:104 |
| 主库 | `teaching_sessions`（teachingState/messages/knowledgeState/wrapup/advisory） | teaching：TeachingSessionRepository.ts:303-573、AITeachingCoordinator.ts:1342/1795/2575；profile：TeachingContextBuilder.ts:316；guidance：assemble-learning-state.ts:97 |
| 主库 | `learning_metrics` | teaching：learning-state.service.ts:378/434；guidance：assemble-learning-state.ts:144 |
| 主库 | `learner_evidence` | learner-model 链：LearnerSnapshotService.ts:173/292；lesson-knowledge-enricher 写入：LessonKnowledgeEnrichmentConsumer.ts:61 |
| 主库 | `users` | guidance：assemble-learning-state.ts:63；learning-state.service.ts:637 |
| 主库 | `virtual_sessions`（stageResults） | simulation：simulation.coordinator.ts:587、blackbox-runner.ts:512 |
| 主库 | `virtual_learner_profiles` | simulation：blackbox-runner.ts:1557、virtual-learners.ts:1261/688、quick-learn.ts:99 |
| 主库 | `domain_event_inbox/outbox` | profile 链：LessonKnowledgeEnrichmentConsumer.ts:12、index.ts:591-614 |
| 系统库 | `agent_field_routings` + `field_definitions`（routings 装配） | field-dispatcher/index.ts:90-93（配置式三链的底座） |
| 系统库 | `agent_lab_configs`（path 输入配置） | agentConfig.service.ts:101（path.coordinator.ts:371） |
| 系统库 | `agent_prompts`（系统 prompt 载体，非 LLM 输入数据） | agentConfig.service.ts:222；消费于 goal-conversation/index.ts:904/987/1064、v4-aux-skills/index.ts:148 |
| 系统库 | `user_skill_configs` / `skill_registrations`（executor 基础设施，非 LLM 输入数据） | skills/executor.ts:138（开关校验）、:275-293（遥测） |

- 声明现状：**零声明、零对账**（SKILL_EXPANSION_DESIGN §1.3 表格"代码直读"行已标注，本调查证实该行为实际全部发生在**编排层**而非 handler）。

### ③ 外部服务/API —— 仅 MCP 一条通道

- 除 `mcpGateway`（core/mcp/McpGateway.ts:166 callTool → utils/safe-http）外，`services/`、`skills/`、`coordinators/` 目录 **无任何 `fetch(`/`axios`/http client 直呼**（全仓 grep 为零命中）。
- 声明现状：MCP 独立体系（`config/mcp.json` 平台工具 + `user_mcp_configs` 用户工具），工具级对账在 mcp 服务内部；skills.yaml `mcpTools` 字段 P4 交叉校验（F13）规划中。

### 统计小结

| 层 | 参与 skill | 注册表 | 对账 | 结论 |
|---|---|---|---|---|
| ① sandbox 注入 | goal/path/teaching（profile 仅快照引用） | 有（SANDBOX_EXTRA_KEYS + routings 推导） | 有（静态 + 运行时 warn） | 已声明化 |
| ② 协调器直读主库 | 全部 21 个生产调用 skill | **无** | **无** | 最大空白 |
| ③ 外部 MCP | 仅 mcp-tool | 独立体系 | 工具级内部 | 已有出口（mcpTools 字段） |

---

## 3. dataSource 声明对象判定

### 3.1 判定：声明挂在 skill 条目上，描述的是**编排层组装行为**，不是 handler 直读

- 事实：handler 是纯函数（证据见 §4.1 反例清单），LLM 输入全部由编排层组装（§1 全景表）。
- 因此 `dataSource` 的语义应为：**"该 skill 的 LLM 输入由协调器/服务从哪些数据源组装"**——即"输入血缘声明"。声明位置在 skill 条目（身份/归属层），实际表达的是编排层行为，二者通过"skillId ↔ executeSkill 调用点"关联。
- 原 schema 语义（`{ db: [模型名], api: [端点] }` = "handler 代码直读"，SKILL_EXPANSION_DESIGN §5.2:271-283）**与事实不符**，必须修正：若照原语义扫描 handler 源码，除 mcp-tool 外全部零命中 → 27 条声明全空 → W5 无意义。

### 3.2 反例清单（handler 确实直读的）

| # | skill | 直读内容 | 证据 | 性质 |
|---|---|---|---|---|
| 1 | mcp-tool | MCP 外部工具（经 mcpGateway）；`user_mcp_configs`、`config/mcp.json` | mcp-tool/index.ts:1（import）、:80、:95、:126、:140 | 设计使然：它本身就是"外部资源执行器"，声明 = `mcpTools` 字段，不需 dataSource 重复 |
| 2 | learner-model | `learner_evidence`/`teaching_sessions`/`subtasks`/`learning_paths`（经 LearnerSnapshotService 等服务） | agents/learner-model-agent/index.ts:78-120（handler 内 switch 直调服务）、LearnerSnapshotService.ts:173-404 | handler-only 服务型 handler（registrationPoint=agents，无 LLM）；**这是 dataSource 唯一真正适用"handler 直读"语义的条目** |

**非直读但易误判的"基础设施读"**（建议明确排除出声明范围，写入规格）：
- executor 每次调用读 `user_skill_configs`（executor.ts:138）+ `skill_registrations`（:275）——执行开关/遥测，非 LLM 输入。
- handler 内 `agentConfigService.getActivePrompt` → `agent_prompts`（goal-conversation/index.ts:904/987/1064、v4-aux-skills/index.ts:148）——系统 prompt 载体本身，非数据输入。
- 嵌套 skill 调用：session-wrapup → session-evaluation-fallback（session-wrapup/index.ts:631）——skill 间组合，数据源已在父 skill 声明，子 skill 输入 = 父 skill 输入投影。

### 3.3 声明粒度建议

在保留现有 `{ db: string[], api: string[] }` 形状兼容的前提下，扩展为：

```yaml
dataSource:
  inputs:            # 只声明"读"（LLM 输入来源）
    - type: db       # 数据源类型枚举：db | sandbox | service
      source: learning_paths        # 表名（prisma 模型名）或 sandbox agent 别名或服务名
      keys: [aiPromptTemplate, title]   # 具体键/字段（可选，粒度到列/JSON 键）
      via: prisma    # 读取通道：prisma（协调器直读）| routings（字段路由表驱动）| service（服务封装）| event（领域事件）
  outputs:           # 可选，只声明"写"（skill 输出落库去向，血缘展示用）
    - type: db
      source: learner_evidence
```

理由：
- `type` 三值覆盖 §2 的三层来源；`via` 区分直读/路由表/服务/事件四条通道（service/event 用于 learnerSnapshot 等间接来源，允许粗粒度 `source: learner_snapshot_service` 不展开到表，控误报）。
- **读写方向分离**：LLM 输入侧（读）是 W5 校验对象；输出侧（写）仅文档/血缘用途，不校验（skill 输出落库点分散在消费方，静态追踪成本高、价值低）。
- `keys` 可选：`learning_paths` 这类表几乎每个字段都可能进输入（cognitiveDesign/normalizedInput/milestones），精确到键维护负担重、漂移敏感；建议只对"有明确键语义"的表填（如 `goal_conversations.collectedData` 的 `messages/understanding/stage`）。**最小实施可以只声明 `source` 不填 `keys`**（§6）。
- sandbox 类：不与 SANDBOX_EXTRA_KEYS 重复注册（那是对账注册表），dataSource 里只做"该 skill 输入含 sandbox 注入"的指认（`source: teaching-agent`），校验走既有沙盘对账链。

---

## 4. 静态校验可行性

### 4.1 可行性结论：可行，中等复杂度，误报可控

**① 调用点可静态枚举（高可靠）**：`executeSkill(` / `executeSkillWithResult(` 全仓 32 个生产调用点（§1.3 已列），每点第一参数即 skill definition，可直接建立 skillId → 调用点映射。这是 W5 扫描器的锚点，可靠性 ~100%。

**② 组装函数摘要（中可靠）**：对每个调用点，回溯参数对象来源：
- 直接字面量（如 peerInput AITeachingCoordinator.ts:1458-1468）：精确。
- 局部变量（如 `turnInput` ← `buildTeachingTurnInput(session, context)` :1394-1399）：需跨函数追踪。
- 跨文件函数（如 `buildTeachingScenarioContext` TeachingContextBuilder.ts:387 → `prisma.subtasks.findUnique` :393、`fetchLastLessonRecap` → `teaching_sessions` :316）：需对 ~15 个组装函数做"prisma 表读取摘要"（正则/ast 提取 `prisma.<table>.(find|query|aggregate)` 即可，函数体直读模式稳定）。

**③ 服务封装层（低可靠，建议豁免）**：`learnerSnapshotService.getSnapshot`、`learningStateService.getCurrentState`、`teachingSessionRepository` 等内部再读多表。静态展开服务内部会显著放大误报率；建议声明 `via: service` 粗粒度（source=服务名）并**跳过服务内部的表级校验**（人工复核兜底）。

**④ 校验点设计（W5，warn 级）**：
- W5a：调用点摘要中的 db 表 ∉ 声明 → warn「协调器组装输入直读 learning_paths 未声明」。
- W5b：声明中 db 表 ∉ 任何调用点摘要 → warn「声明过期，疑似已改数据源」。
- W5c：handler 源码扫描（保留原 §5.2 模式）只对 registrationPoint=agents/platform-direct 例外账执行（learner-model/mcp-tool/semantic-freeze-judge），普通 skill 跳过——避免"全零命中"的无效扫描。

**⑤ warn 级 vs fail-fast 判定**：维持 **warn 级**（SKILL_EXPANSION_DESIGN §5.2 已决策，本调查支持该决策）：
- 数据流分析非完备（服务封装、动态键、条件分支），fail-fast 会误杀合法演化；
- 一次性为 21 个生产 skill 全量声明，人工复核窗口内 fail-fast 会阻断启动/CI；
- 声明价值是可见性与审计，不是运行时门禁；future strict 开关（L2）保留不实现。

---

## 5. 价值与成本评估

### 5.1 价值（能发现什么）

| 场景 | 现状 | 声明化后 |
|---|---|---|
| 数据血缘可见性 | admin 无法回答"teaching-turn 用了哪些表"（散在 4 个文件） | 面板/文档一眼可见（skills.yaml 条目） |
| 组装漂移 | 协调器悄悄换表（如 collectedData 改存新表）零感知 | W5b 报「声明过期」 |
| 新增 skill 审计 | 无任何输入来源清单 | 向导表单引导填写 + 扫描器复核 |
| 与 sandbox 体系对齐 | db-table 层是全仓唯一零声明数据层 | 三层来源（sandbox/db/mcp）全部有注册出口 |
| 僵尸/降级监控 | course-design 等僵尸项无输入面 | 声明为空 + W3 接线扫描联动 |

### 5.2 成本

- **维护负担**：21 个生产 skill，平均每条声明 2-4 个 source；初稿由扫描器生成 → 人工确认（一次性 ~1-2 人日）。后续变更 handler 输入结构时需同步声明，但 warn 级无阻断压力；且声明的是"组装点数据源"，改动频率低于 handler 本身。
- **静态分析误报率**：调用点锚定 → 低（字面量级零误报）；组装函数摘要 → 中（函数内直读模式稳定，误报主要来自 `via` 判断）；服务封装 → 豁免后归零。预计整体误报 <10%，且 warn 级可白名单。
- **schema/校验成本**：`skills-file.ts:299-330` 已有 dataSource 形状校验，仅需扩展对象结构；扫描器为新增脚本（对标 `check-skills-file.ts` 模式），无运行时改动。

### 5.3 不做/全做的代价

- 不做：db-table 层继续零对账，P4 数据面（SKILLS_YAML_SPEC §5.2 迁移表）悬空，W5 永远空转。
- 全做（含 api 类 + 输出侧 + 运行时 strict）：api 类仅 mcp-tool 一条（与 mcpTools 字段重叠），输出侧落库点分散且非 LLM 输入语义，strict 拦截违反 §5.2 决策且误杀风险高——**均不划算**。

---

## 6. P4 实施建议

### 6.1 结论：做，但缩小范围 + 修正语义

1. **修正声明语义**：`dataSource` = "该 skill 的 LLM 输入由编排层从哪些数据源组装"（§3.1），在 SKILLS_YAML_SPEC §1.3 字段表与 SKILL_EXPANSION_DESIGN §5.2 同步改写（两处 doc 目前写"代码直读"，与事实不符）。
2. **只声明两类**：`db`（主库/系统库表）与 `sandbox`（指认注入来源）；`api` 类仅 mcp-tool，由 `mcpTools` 字段承担，dataSource.api 保持 schema 兼容但不启用。
3. **覆盖范围**：15 主链 + 4 个有生产调用的 aux（teaching-opening-generator / session-evaluation-fallback / learner-progress-report / generic-chat）+ 2 个 handler-only 例外（learner-model 直读 / mcp-tool api）；僵尸 3 条（course-design/basic-evaluator/goal-alignment-checker）声明留空并在 notes 标注；semantic-freeze-judge 声明 `inputs: []`（平台直调无组装）。
4. **校验**：W5 warn 级，三通道（W5a 未声明 / W5b 过期 / W5c 例外账 handler 扫描）；扫描器出初稿 → 人工确认写入 → 上线。
5. **不做**：输出侧（写）声明、运行时 strict 拦截、api 端点枚举（无此需求）。

### 6.2 Schema 草案（最小实施）

```yaml
# skills.yaml 条目内（兼容现有形状校验 skills-file.ts:76，需把 db 值域从 string[] 扩为 string | object）
dataSource:                    # 可选；输入血缘声明（P4，warn 级 W5）
  db:                          # 编排层为该 skill 组装 LLM 输入时直读的表（via=prisma/routings）
    - learning_paths
    - teaching_sessions
    # 或带键/通道的细粒度形态（可选，最小实施可只用裸表名）
    - table: goal_conversations
      keys: [collectedData]    # 可选
      via: prisma              # prisma | routings | service | event（缺省 prisma）
  sandbox:                     # 可选；输入含 sandbox 注入（指认 agent 别名，不重复注册键）
    - teaching-agent
```

校验点：
- **F 类（fail-fast，已有/顺带）**：值域形状（type ∈ db/sandbox；table 名 ∈ prisma schema 模型名集合——可在加载时读 `prisma/db schema` 或维护模型名白名单；sandbox source ∈ 5 个 agent 别名）。（注：表名存在性若做 fail-fast 需全量迁移后上线，P4 内可先 warn。）
- **W5（warn）**：扫描器比对（§4.1 ④）；例外账 handler 扫描（learner-model/mcp-tool/semantic-freeze-judge）；僵尸条目声明为空检查。
- **W3 联动**：dataSource 空声明 + 接线引用为 0 → 强化僵尸提示（可选）。

### 6.3 落地步骤（对齐 SKILLS_YAML_SPEC §5.2 P4 行）

1. 扫描器（`backend/src/scripts/scan-skill-data-sources.ts`，对标 check-skills-file.ts）：输出"skillId → 调用点 → 组装函数摘要（prisma 表清单）"报告。
2. 初稿写入 skills.yaml 27 条（db 裸表名级），人工复核 1 轮（重点：service 通道豁免项、僵尸空声明）。
3. `skills:check` 扩展 W5（三通道）+ schema 扩展；`prompts:check:all` 并入。
4. 文档同步：SKILLS_YAML_SPEC §1.3 字段表 / SKILL_EXPANSION_DESIGN §5.2 语义修正（§3.1 结论）。
5. 验收：扫描报告人工复核通过；warn 清零或白名单；CI 连续两轮无新增误报。

---

## 附：证据索引（核心 file:line）

- 调用点全景：goal-conversation.service.ts:636 / learning.service.ts:2509,2933,4093 / AITeachingCoordinator.ts:1261,1399,1470,1842,2588 / LessonKnowledgeEnrichmentConsumer.ts:27 / DashboardGuidanceSnapshotService.ts:149 / LearningStateGuidanceService.ts:89 / LearnerProgressService.ts:251 / session-wrapup/index.ts:631 / ai.service.ts:340,812 / skill-author/index.ts:47,145 / simulation.coordinator.ts:811,2126,2783 / blackbox-runner.ts:540,605 / virtual-learners.ts:927,1208,1237,1268,1315 / quick-learn.service.ts:560 / user-mcp.ts:326
- 组装函数：field-dispatcher/index.ts:183,204,218（配置式三链，routings 表 :90-93）；TeachingContextBuilder.ts:387-529；AITeachingCoordinator.ts:767-889；assemble-learning-state.ts:56-208；sandbox-resolver.service.ts:196-298（provider 注册表）
- handler 纯函数证据：skills/index.ts:179-198（注册表）；skills/* 全量 import 扫描零 prisma/fetch（§3.2）；executor.ts:149-271（唯一 DB 接触在 executor 基础设施）
- 反例：mcp-tool/index.ts:1,57-164；learner-model-agent/index.ts:78-120 + LearnerSnapshotService.ts:173-404
- schema 现状：skills-file.ts:76,109,299-330（形状校验已上线）；SKILLS_YAML_SPEC.md:51,181,252,308,387；SKILL_EXPANSION_DESIGN.md:271-283（§5.2 原语义）
