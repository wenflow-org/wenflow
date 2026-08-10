# Skill 生命周期注册链全景调查

> 只读审计（2026-08-10）。范围：一个 skill 从"声明"到"可调用"需要动哪些地方——身份/归属/可调用性散落在哪些文件，新增一个 skill 要动几处，外部数据三通道（sandbox 注入 / 代码直读 / MCP）的使用点。
> 全部证据精确到 `file:line`。未改动任何代码。

---

## 1. 注册链全景（一个 skill 的"户口"）

### 1.1 分层概念（来自代码注释的官方定义）

- **Agent 层**：`backend/src/services/agent-manifest.service.ts:2-14`（注释自称"真理源"）——5 个顶层 Agent（kind=agent），不持有 prompt、不直接调 LLM，只下辖 Skill（agentMembers）。
- **编排层**：`backend/src/coordinators/*.definition.ts`（definitions-registry.ts:9-10 称"定义层单一代码源"）——steps 顺序/condition/loopOver，`managedByCode=true`，实际执行体在各 Coordinator 代码。
- **Skill 层**：`prompts/core/*.yaml`（业务 SSOT）+ `backend/src/skills/<id>/index.ts`（handler）。

### 1.2 主链 skill（8 个）户口位置清单

| # | 位置 | 主链 8 个在此处的登记 | 手写/派生 |
|---|---|---|---|
| 1 | `backend/src/services/agent-manifest.service.ts` | goal-conversation L138-150（aliases L146、ioContractVersion L147、defaultModelConfig L149）；path-planning L154-164；stage-designer L166-176；teaching-turn L180-191（aliases L188）；peer-reinforcement L193-204（aliases L201）；session-wrapup L206-217（aliases L214）；adaptive-guidance-copy L219-229；lesson-knowledge-enricher L247-257 | **手写**（kind/category/monitoringGroup/aliases/displayName/defaultModelConfig 逐条写） |
| 1a | 同文件 `agentMembers`（归属） | goal-agent L67-69 → goal-conversation；path-agent L80-83 → path-planning/stage-designer；teaching-agent L95-100 → teaching-turn/peer-reinforcement/session-wrapup/adaptive-guidance-copy；profile-agent L111-114 → learner-model/lesson-knowledge-enricher | **手写**（与条目分开的两处声明） |
| 1b | 同文件 `validateManifest()` L498-534 | 启动 fatal 校验：skill 无 `defaultModelConfig` 且无 `noPromptFile` → 报错 L521-523；agent 成员必须在 manifest L510-515；alias 冲突 L526-530 | 校验（自动） |
| 2 | `backend/src/coordinators/*.definition.ts` | goal.definition.ts L7-13（goal-conversation）；path.definition.ts L16-27（path-planning L17-20、stage-designer L22-27）；ai-teaching.definition.ts L6-58（teaching-opening-generator L16-20、teaching-turn L22-27、peer-reinforcement L29-34、session-wrapup L43-49）；learner.definition.ts L6-29（learner-model L9、lesson-knowledge-enricher L16）；definitions-registry.ts L32-47/49-55 汇总两表 | **手写**（文档/展示性质；`managedByCode=true` 标注实际执行在代码） |
| 3 | `backend/src/skills/index.ts` | `allSkillDefinitions` L102-176：stage-designer L103、adaptive-guidance-copy L104、lesson-knowledge-enricher L105（模块 import），主链 6 个为**内联字面量** L116-175（goal-conversation L116-127、path-planning L128-139、teaching-turn L140-151、session-wrapup L152-163、peer-reinforcement L164-175） | **手写**（两处：数组 + handlers map） |
| 3a | 同文件 `skillHandlers` L179-198 | stage-designer L180、adaptive-guidance-copy L181、lesson-knowledge-enricher L182、goal-conversation L193、path-planning L194、teaching-turn L195、session-wrapup L196、peer-reinforcement L197 | **手写**（与定义分开的第二个注册点） |
| 3b | 同文件 `executeSkillWithResult` L213-225 | 找不到 handler 抛 `Skill handler not found: <id>` L222 | 运行时兜底 |
| 4 | `backend/src/skills/<id>/index.ts` | 每 skill 一个目录：goal-conversation/index.ts（spec L796 `requireActivePrompt: true`）、path-planning/index.ts（L588）、stage-designer/index.ts（L172）、teaching-turn/index.ts（definition L191、handler L598）、peer-reinforcement/index.ts（L230）、session-wrapup/index.ts（L471）、adaptive-guidance-copy/index.ts（L220）、lesson-knowledge-enricher/index.ts（L226） | **手写**（handler + PromptCallSpec + definition） |
| 5 | `prompts/core/<id>.yaml` | 主链 8 个文件：goal-conversation/path-planning/stage-designer/teaching-turn/peer-reinforcement/session-wrapup/adaptive-guidance-copy/lesson-knowledge-enricher.yaml；加载 `core-file-loader.ts:17-19`（CORE_FILES_DIR） | **手写**（业务 SSOT） |
| 5a | `prompts/skill.<id>.md`（编译产物） | 由 `compile-core-files.ts:19-24` 从 core.yaml 生成，frontmatter 带 `coreHash`/`coreVersion`（skill.teaching-turn.md:1-8） | **派生**（`npm run prompts:compile-all`） |
| 5b | seed 进 DB：`scripts/seed-core-agent-prompts.ts` | `loadCoreAgentPromptSeeds` L263-278：coreHash 与 core.yaml 不同步的文件**跳过** L267-276；`prompts:sync`/启动 ensure 写入 `agent_prompts`（ACTIVE） | 脚本（自动，但依赖 5a 先编译） |
| 5c | 运行时要求：`composers/prompt-composer.ts:228-266` | `requireActivePrompt` 且无 ACTIVE prompt → 抛 `<ID>_PROMPT_MISSING` L228-259（不进 LLM） | 运行时硬校验 |
| 6 | `prompts/orchestration/<stage>.yaml` | 字段路由唯一源（teaching.yaml 头注 L1-4）：goal.yaml contracts L11-12；path.yaml L9-11；teaching.yaml contracts L10-15（含 adaptive-guidance-copy L14）、fields L17-209、routings L211-571；profile.yaml contracts L13-15（lesson-knowledge-enricher L13、learner-model L14）；simulation.yaml contracts L17-24 | **手写** |
| 6a | `scripts/field-routing-orchestration-sync.ts` | 三表 upsert：agent_contracts L39-66、field_definitions L68-116、agent_field_routings L118+；`npm run prompts:orchestration:sync` | 脚本（自动） |
| 6b | sandbox ref 对账：`services/prompt-lab/input-handoff-check.ts:77+`、`services/agent-contract-view.ts:225-245` | 未注册 sandbox 路径报 `sandbox-path-unregistered`（warn/CI） | 校验（自动） |
| 7 | 业务调用点（真正的"接线"） | teaching 链：`services/ai-teaching/AITeachingCoordinator.ts:1399`（teaching-turn）、L1470/L2588（peer-reinforcement）、L1842（session-wrapup）、L1261（teaching-opening-generator aux）；goal 链：`services/learning/goal-conversation.service.ts:636`；path 链：`services/learning/learning.service.ts:2509/2933/4093`；profile 链：`services/learner/LessonKnowledgeEnrichmentConsumer.ts:27`（enricher）、`LearningStateGuidanceService.ts:89` + `DashboardGuidanceSnapshotService.ts:149`（adaptive-guidance-copy） | **手写**（`executeSkill(<definition>, input)` 直调） |
| 8 | 启动注册：`backend/src/index.ts:474-490` | `registerOfficialAgents`（agents/index.ts:98-125）+ `for (allSkillDefinitions) instance.registerSkill` L481-486 → gateway skillRegistry（skill-registry.ts:196 upsert skill_registrations、L224-225 loadFromDatabase） | 自动（遍历，不按名手写） |

### 1.3 aux skill（9 个）

| 位置 | 说明 | 手写/派生 |
|---|---|---|
| `skills/v4-aux-skills/index.ts:19-28` | `AuxSkillId` 联合类型（9 个 id） | **手写** |
| 同文件 L160-170 | `META`：skillId/displayName/description/category | **手写** |
| 同文件 L331 | `auxSkillDefinitions = Object.values(META).map(definition)` | **派生**（META 决定） |
| 同文件 L337-347 | `auxSkillHandlers`（9 个 handler 映射） | **手写** |
| `skills/index.ts:40-41` | import + re-export；L114 `...auxSkillDefinitions`、L191 `...auxSkillHandlers` | 展开（自动） |
| manifest | **不在** AGENT_MANIFEST（无条目、无 agentMembers） | — |
| `prompts/core/*.yaml` | 9 个：teaching-opening-generator/basic-evaluator/course-design/generic-chat/goal-alignment-checker/learner-progress-report/session-evaluation-fallback/skill-author/skill-compiler | **手写** |
| 调用点 | AITeachingCoordinator.ts:1261（teaching-opening-generator）；session-wrapup/index.ts:631（session-evaluation-fallback，wrapup handler 内部兜底调 aux）；LearnerProgressService.ts:251（learner-progress-report）；ai.service.ts:340（generic-chat）/L812（course-design）；services/skill-author/index.ts:47/145（skill-author/skill-compiler） | **手写** |
| 僵尸 aux | basic-evaluator / goal-alignment-checker：META + core.yaml 齐全但**零生产调用**（skill-output-validator.ts:151 注释明示），且被 cleanup 名单点名（见 §1.5） | — |

### 1.4 handler-only（learner-model）

- `backend/src/agents/learner-model-agent/index.ts:235-240`（handler 本体）；definition.ts:4（id `skill:learner-model`）
- gateway 注册：`backend/src/agents/index.ts:81` `'skill:learner-model': learnerModelAgentHandlerFn`；`registerOfficialAgents` L98-125（走 allAgentDefinitions L69-77 遍历 + agentHandlers 查找，manifest `runtimeEnabled=false` 则跳过 L105-107）
- manifest：agent-manifest.service.ts:233-245（`noPromptFile: true` L242 → 跳过 prompt 文件校验 L521-523）
- 无 core.yaml、无 skill.<id>.md、无 allSkillDefinitions 条目——三处都靠 `noPromptFile` 豁免
- 归属：profile-agent agentMembers L112、learner.definition.ts:9
- 调用方：outbox 消费者序列（index.ts:662-677 区域，durableConsumers）；大量服务**绕过 skill 注册**直调 learnerProfileService/profileAggregator/snapshot 服务（agents/learner-model-agent/index.ts:179-231 内部直读 DB）

### 1.5 退役 skill：RETIRED_SKILLS 两份名单的差异现状

| 名单 | 位置 | 数量 | 用途 |
|---|---|---|---|
| A：`RETIRED_SKILLS` | `backend/src/index.ts:45-92` | 34 个 | `purgeRetiredSkills` L497-516 **启动时**删：skill_registrations/skill_model_configs/user_skill_configs/agent_prompts/agent_field_routings/agent_contracts |
| B：`RETIRED_SKILLS` | `backend/src/scripts/cleanup-retired-field-data.ts:9-23` | 41 个 | 一次性清理脚本（同语义 5 表删行 + agent-snapshots 误入行 L31） |

**差异（B ⊃ A，多 7 个）**：
1. `basic-evaluator`、`goal-alignment-checker`（B L22）：**仍活跃**——在 aux META（v4-aux-skills/index.ts:168-169）、core.yaml、skills/index.ts 注册里。跑 B 会删掉活数据的契约/注册行（skill-output-validator.ts:151 注释"零生产调用"暗示作者想退役但代码未摘）。
2. `goal-understanding-composer`、`teaching-strategy-selector`、`acceptance-evidence-evaluator`（B L20）：**半退役**——代码目录还在（backend/src/skills/ 下），skills/index.ts:24-33 仍 export definition，但不在 allSkillDefinitions/skillHandlers；teaching-turn/index.ts:6-7 仍 import 它们的确定性函数（evaluateByCriteria/getFallbackStrategies）→ 代码不能删，只是不再注册为可执行 skill。
3. `concept-priority`、`path-adjustment-generator`（B L22）：仅名单存在，无代码无 yaml。
4. 旁路类 `semantic-freeze-judge`：有 core.yaml + skill.semantic-freeze-judge.md，不进 manifest 不进注册表，由 `services/prompt-lab/semantic-freeze-judge.ts:82-85` 直接 `callPrompt`（发布门禁"守门直调"，skill-output-validator.ts:149-156 注释）。

---

## 2. "新增一个 skill"的完整动作清单

假设 teaching 阶段新增主链 skill「错题讲解员」`wrong-question-expert`（有 LLM prompt）。按**依赖顺序**编号：

| # | 动作 | 位置 | 不做会怎样 |
|---|---|---|---|
| 1 | 写 `prompts/core/wrong-question-expert.yaml`（identity/channels/inputs/fields/rules/params） | 手写 SSOT | 一切后续无法编译 |
| 2 | `npm run prompts:compile-all` → 生成 `prompts/skill.wrong-question-expert.md`（frontmatter 含 coreHash） | 派生（compile-core-files.ts:19-24） | seed 阶段 `loadCoreAgentPromptSeeds` 找不到文件 → **无 ACTIVE prompt** |
| 3 | `npm run prompts:sync`（或重启走 ensure）→ 写 `agent_prompts`（ACTIVE） | seed-core-agent-prompts.ts:263-278 | 运行时 `callPrompt` 抛 `WRONG_QUESTION_EXPERT_PROMPT_MISSING`（prompt-composer.ts:228-259，`requireActivePrompt` 硬拦截，**不进 LLM**） |
| 4 | 写 `backend/src/skills/wrong-question-expert/index.ts`：definition + handler（内部 `callPrompt`，requireActivePrompt） | 手写 | 无 handler 可注册 |
| 5 | `skills/index.ts` 两处：`allSkillDefinitions` 数组加定义（L102-176）、`skillHandlers` map 加映射（L179-198） | 手写 | 有人 `executeSkill` 时抛 `Skill handler not found`（skills/index.ts:222）；启动注册 L481-486 遍历时静默跳过（`if (handler)` L482-484）——**不报错**，属于"静默缺失" |
| 6 | `agent-manifest.service.ts`：新增条目（kind='skill'、category='teaching'、monitoringGroup='Teaching'、`defaultModelConfig`、`ioContractVersion`）+ teaching-agent 的 `agentMembers` 加 `'skill:wrong-question-expert'`（L95-100） | 手写 | 缺条目：`validateManifest` 只校验已声明条目 → **不拦**；但 getAgentOfSkill（executor.ts:159）返回 undefined、监控分组/拓扑/用户可见性缺失。缺 defaultModelConfig：**启动 fatal**（L521-523）。agentMembers 引用了 manifest 不存在的成员：**启动 fatal**（L510-515） |
| 7 | `prompts/orchestration/teaching.yaml`：contracts 加 agentId（L10-15）、fields 加产出声明、routings 加 handoff 行 | 手写 | 字段路由/展示/沙盘注册表无此 skill；admin 端看不到；`prompts:check-handoff:strict` 可能因 sandbox ref 未注册报 `sandbox-path-unregistered`（input-handoff-check.ts:77） |
| 8 | `npm run prompts:orchestration:sync` → 三表 upsert（agent_contracts/field_definitions/agent_field_routings） | 脚本 | 仅声明未同步，DB 无行 |
| 9 | 业务接线：AITeachingCoordinator.ts 内 `executeSkill(wrongQuestionExpertDefinition, input)`（参考 L1399 teaching-turn 调用模式）+ `ai-teaching.definition.ts` steps 加一步（文档性） | **手写（最容易漏的一步）** | 注册齐全但**永远不会被调用**——没有任何自动发现机制 |
| 10 | 若新输入走 sandbox：core.yaml inputs 写 `ref: sandbox:teaching.<key>` + `SANDBOX_EXTRA_KEYS['teaching-agent']` 加键（agent-contract-view.ts:74-93）+ 装配代码提供该键（buildTeachingTurnInput AITeachingCoordinator.ts:767 或 buildTeachingSandboxPool sandbox-resolver.service.ts:215-246） | 手写 3 处 | 对账 warn-only（sandbox-resolver.service.ts:130-137），不阻断但缺数据 |
| 11 | `npm run prompts:snapshots` 重新生成 `prompts/agent-snapshots.md` | 派生 | 文档漂移（CI `prompts:snapshots:check` 会挂） |
| 12 | 校验闭环：`npm run prompts:check:all`（lint / check-handoff:strict / snapshots:check / drift-check）+ `prompts:core:check` | 脚本 | CI/人工把关 |

### 2.1 只写 core.yaml + 编排文件、不写代码/注册，会发生什么

| 场景 | 坏在哪（代码证据） |
|---|---|
| core.yaml 写好了但没编译 | seed 跳过（seed-core-agent-prompts.ts:267-276 只同步 coreHash 匹配的文件）→ DB 无 ACTIVE → 运行时 `WRONG_QUESTION_EXPERT_PROMPT_MISSING`（prompt-composer.ts:228-259） |
| 编排文件加了 contracts/routings 但没跑 sync | DB 三表无行 → admin 字段路由/沙盘视图查不到（agent-contract-view.ts:145-193 全部走 DB routings） |
| 没有 manifest 条目 | 启动**不报错**（validateManifest 只查已声明项）；executor.ts:159 `getAgentOfSkill` 返回 undefined；用户/监控不可见 |
| 没有 handler 注册 | 启动**不报错**（index.ts:482-484 `if (handler)` 静默跳过）；被调用时 `Skill handler not found`（skills/index.ts:222） |
| 有注册但没接线 | 一切正常，skill 永远不被调用——**最安静的失败** |

即：**"声明"类错误（prompt 缺失）是硬失败；"注册"类错误（无 manifest/handler）是静默降级；"接线"类错误完全无声。**

### 2.2 aux 类新增的最小动作集 vs 主链差异

| 步骤 | aux（如新「阅读难度评估器」） | 主链（错题讲解员） |
|---|---|---|
| core.yaml + compile + seed | ✅ 同 | ✅ 同 |
| handler + definition | v4-aux-skills/index.ts：AuxSkillId L19-28 + META L160-170 + auxSkillHandlers L337-347（definitions 由 META 派生 L331，不用单加） | skills/wrong-question-expert/index.ts + skills/index.ts 两处（L102-176 + L179-198） |
| manifest | ❌ 不需要（aux 不进 manifest） | ✅ 必需 |
| orchestration | ❌ 可选（仅展示需要） | ✅ 通常需要 |
| 调用点 | 调用方 `executeSkillWithResult(auxSkillDefinitionMap['xxx'])` | 协调器接线 |
| 合计手写点 | **3 处代码 + 1 yaml** | **6-7 处代码/注册 + 2 yaml** |

---

## 3. 外部数据三通道完整使用点

### 3.1 通道 A：sandbox 注入（声明式）

**core.yaml 全部 `sandbox:` ref 清单（按 agent 分组）**：

- **goal**（goal-conversation.yaml:20,24；path-planning.yaml:30 复用）：
  - `goal.collectedData.state`、`goal.collectedData.history`
- **path**（path-planning.yaml:18,22,26,34；stage-designer.yaml:17,25）：
  - `path.normalizedInput.learnerProfile.surfaceGoal`、`path.normalizedInput`、`path.normalizedInput.confirmedProposal`、`path.replan`、`path.previousMilestone`
- **teaching**（teaching-turn.yaml:12-40 ×8；peer-reinforcement.yaml:13,21；session-wrapup.yaml:12-28 ×5）：
  - `teaching.session.messages/topic/info/evidence`、`teaching.learner.learnerProjection`、`teaching.knowledge.state`、`teaching.classroomContext`、`teaching.visibleDialogueContext`、`teaching.controls.teachingControlContext`、`teaching.scenario`、`teaching.scenario.interactionProfile`、`teaching.learningState`
- **simulation**（7 个仿真 skill 的 yaml，共 40 个 ref，覆盖 learner/story/visibleContext/currentPhase/previousLearnerState/task/pathProposal/goalState/previousReaction/learnerState/currentTask/knowledgeSnapshot/publicTrace/refereeTrace/control/experimentSummary/storyMeta/metricCompleteness/actorProfile/frictionBudget/learnerPrivateState/preferredLevels/candidatePersonas/recentPersonaHints/existingPersonaSeed/preferredDomains/preferredGoalTypes/preferredMotivations/avoidDomains/candidateDomains/recentScenarioHints）
- **profile**：core 文件无 sandbox ref（learner-model 无 prompt；enricher 输入走 outbox payload）

**注册表与说明书**：
- `SANDBOX_EXTRA_KEYS`：agent-contract-view.ts:55-137（goal-agent L56-62 / path-agent L63-73 / teaching-agent L74-93 / profile-agent L94-103 / simulation-agent L104-136），用于补充"编排状态池中未登记 routings 行的合法键"
- 动态推导：`buildAgentSandboxView` agent-contract-view.ts:145-193（routings 行 → 输入通道/输出字段）；对账 `validateSandboxPath` L225-245（channel/output/extra 三者任一命中即合法）
- 说明书：`prompts/agent-snapshots.md`（由 `scripts/generate-agent-snapshots.ts` 生成；L78-107 表 + L133-144 合法沙盘键；`npm run prompts:snapshots`）
- 运行时解析：`services/sandbox-resolver.service.ts`（resolveSandboxPath L24-40；checkAgentSandboxRefs L118-142 **缺键只 warn 不阻断** L130-137；pool provider 注册表 L266-298：goal/teaching/path/simulation 四条链的池形状集中声明）

**新开一个 sandbox 键要动几处**：
1. `SANDBOX_EXTRA_KEYS[<agent>]` 加键（agent-contract-view.ts:55-137）——若该键不经 routings 行推导
2. 装配代码提供该键：teaching→buildTeachingTurnInput（AITeachingCoordinator.ts:767）+ buildTeachingSandboxPool（sandbox-resolver.service.ts:215-246）；goal→buildGoalSandboxPool L196-212；path→buildPathSandboxPool L249-259
3. core.yaml inputs 写 `ref: sandbox:...`（消费侧）
4. （派生）重新生成 agent-snapshots.md
→ **至少 3 处手写**（注册表 + 装配 + 消费声明），2 处派生。

### 3.2 通道 B：代码直读（无声明直读清单）

**关键结论：skill handler 层基本零直读**——backend/src/skills/ 下只有 executor.ts:138（user_skill_configs 权限门禁）与 mcp-tool/index.ts:1-3（MCP 配置）。主链/仿真 skill 的数据全部由**编排层代码直读 DB 后组装进 payload**，再经 executeSkill 注入。以下为"直读点"清单：

| skill | 直读点（喂数据的编排层） | file:line | 数据 |
|---|---|---|---|
| goal-conversation | goal-conversation.service.ts | L377-394（goal_conversations + learning_paths.findFirst）、L883 | 会话/路径状态 |
| path-planning / stage-designer | learning.service.ts（DB 查询链） | L2314（learning_paths.create）、L2509（executeSkill(pathAgentDefinition)）、L2829/2933、L3849/4093 | 路径/任务/里程碑 |
| teaching-turn / peer / wrapup / opening | AITeachingCoordinator.buildTeachingTurnInput + TeachingContextBuilder | AITeachingCoordinator.ts:1364（buildTeachingScenarioContext）、L1394-1399；TeachingContextBuilder.ts:316（teaching_sessions.findFirst）、L393（subtasks.findUnique） | 会话/任务/学习者投影 |
| wrapup 后指标 | AITeachingCoordinator | L680（learning_metrics.upsert） | 写指标 |
| lesson-knowledge-enricher | LessonKnowledgeEnrichmentConsumer | L27（outbox 事件 + DB 组装） | 会话产出/知识台账 |
| adaptive-guidance-copy | LearningStateGuidanceService / DashboardGuidanceSnapshotService | L89 / L149 | 学习者快照/引导数据 |
| learner-progress-report | LearnerProgressService | L251 | 指标/信号 |
| 仿真 7 个 | simulation.coordinator.parseProfileData + session-factory | simulation.coordinator.ts:609（parseProfileData）、L1394/2105/2539（virtual_learner_profiles）；session-factory.ts:33-65（storyPool 读取） | 画像/故事池 |
| persona/scenario designer | routes/admin/virtual-learners.ts | L558-567、L758-759、L1304-1341 | storyPool CRUD |
| 通用 | api-gateway/router.ts | L236（user_api_configs，LLM API key 注入，非 skill 数据） | 密钥 |

→ 全部是"代码直读后注入 payload"，无"skill 内直读"→ 与 sandbox: 声明的对账只能靠 sandbox-resolver 的 warn（3.1）。**声明与装配之间的真相在代码，不在 yaml。**

### 3.3 通道 C：MCP

| 层 | 声明位置 | 生效路径 |
|---|---|---|
| 平台级 | `backend/config/mcp.json`：servers L5-66（openai/newapi/anthropic）、tools L67-102（web-search/file-reader/code-interpreter）、agents L103-122（skill:path-planning 等模型映射）、routing L123-130；schema `mcp-schema.json` | McpGateway 启动加载；admin 管理端点 `routes/admin/mcp.ts`：GET / L10-35、POST /tools L38-71、PUT L74-102、DELETE L105-118、POST /tools/:id/test L121-152（updateConfig 写运行时，**不回写 mcp.json 文件**） |
| 用户级 | `user_mcp_configs` 表 → `services/mcp/user-mcp-config.service.ts`（getUserMcpRuntimeConfig/isLocalMcpTool） | skills/mcp-tool/index.ts:80-123：优先匹配用户工具（禁用/本地工具拦截 L84-93），fallback 平台工具 L126-145（admin/system 特权走 callTool，普通用户走 callConfiguredTool + 公网策略 L139-145） |
| 调用链 | 入口 `routes/user-mcp.ts:326` `gateway.executeSkill('mcp-tool', {toolId, params})` → skills/index.ts:190 skillHandlers['mcp-tool'] → executor.ts 包装（权限/统计/遥测）→ executeMcpTool 输出 `{toolId, source: 'user'\|'platform', result}`（mcp-tool/index.ts:100-104/146-150） | 一次完整调用：HTTP → executor（assertSkillEnabledForUser L136-147）→ handler |
| 结果回 AI 上下文 | **无自动注入机制**：mcp-tool 是独立 skill，结果通过 executeSkill 返回值交给调用方；调用方（prompt-ops 等）需手动把 `result` 拼进后续 LLM 的 payload。skill 层不会自动把工具结果喂给下一个 prompt | 手动桥接 |
| 相关注释 | skill-output-validator.ts:149-167 按调用方分类（平台守门直调 semantic-freeze-judge / 无生产调用 basic-evaluator 等） | — |

**注意**：mcp.json `agents` 段（L103-122）与 manifest `defaultModelConfig`（agent-manifest.service.ts:149/163/175/190 等）并存两套模型参数声明；`planner-agent`（mcp.json:116-121）已不在 manifest——残留配置。

---

## 4. 痛点汇总

### 4.1 手写重复（同一身份要写 N 遍）
1. **一个主链 skill 的身份/归属/可调用性散在 7+ 处手写点**：manifest 条目 + agentMembers、skills/index.ts 定义数组 + handlers map、skill/<id>/index.ts、core.yaml、orchestration yaml（contracts+fields+routings）、协调器接线（§2 清单）。无单一注册表。
2. `skills/index.ts` 风格分裂：主链 6 个定义是**内联字面量**（L116-175），stage-designer/adaptive-guidance-copy/lesson-knowledge-enricher 是**模块 import**（L103-105）；aux 又是 META 派生（v4-aux-skills/index.ts:331）。三种写法并存。
3. 主链 6 个 skill 在 `agents/index.ts:69-87` 还有第三份注册（allAgentDefinitions + agentHandlers，供 gateway 可发现性），与 skills/index.ts 双轨并存（注释自述 L92-97）。

### 4.2 无校验（注册缺失大多是静默的）
4. **skills/index.ts handlers map 与 manifest 无交叉校验**：manifest 有而 handlers 无 → 启动不报错（index.ts:482-484 静默跳过），调用时才 `Skill handler not found`（skills/index.ts:222）。
5. **manifest 与 orchestration 无交叉校验**：routings 里的 agentId 不在 manifest 也能同步进 DB（field-routing-orchestration-sync.ts 不查 manifest）。
6. **接线无校验**：注册齐全但协调器没调用 → 完全无声（§2.1）。
7. sandbox 声明↔装配对账 **warn-only**（sandbox-resolver.service.ts:130-137），脱节不阻断。

### 4.3 缺声明 / 名单漂移
8. **RETIRED_SKILLS 双名单漂移**：index.ts:45-92（34 个，启动 purge）vs cleanup-retired-field-data.ts:9-23（41 个，一次性脚本）。B 名单含**仍活跃**的 basic-evaluator/goal-alignment-checker（v4-aux-skills/index.ts:168-169）——跑清理脚本会删活数据。
9. 半退役 skill（goal-understanding-composer / teaching-strategy-selector / acceptance-evidence-evaluator）：代码 + definition 导出还在（skills/index.ts:24-33），skill 注册已摘，但主链仍 import 其确定性函数（teaching-turn/index.ts:6-7）——清理脚本的"注销"假设与代码存在不一致。
10. 僵尸注册：basic-evaluator / goal-alignment-checker 注册着但零调用（skill-output-validator.ts:151 注释自认）。
11. mcp.json `agents` 段残留 `planner-agent`（mcp.json:116-121），与 manifest 的 defaultModelConfig 双处模型参数并存。
12. agent-snapshots.md 是派生产物，漏跑 `prompts:snapshots` 即漂移（CI check 才暴露）；`loadCoreAgentPromptSeeds` 对未 publish 的 core 静默跳过（seed-core-agent-prompts.ts:267-276）——新增 skill 忘 publish 时 DB 无 ACTIVE，运行时才炸。
