# Skill 字段契约审计（2026-11-11）

> 范围：`prompts/core/*.yaml` 32 个核心文件 + 对应 skill handler + `prompts/orchestration/*.yaml` 沙盘/路由。
> 方法：不只看「字段有没有声明」，而是沿调用链核对 **声明 → 载荷 → 消费 → 生命周期（跨轮/跨阶段保留、重置、终局）**。
> 门禁：`prompts:check:all`、`prompts:core:check`、`npm run typecheck`、定向 jest 全绿（见 §6）。

---

## 1. 结论摘要

| 级别 | 数量 | 说明 |
| --- | --- | --- |
| P0 运行时会炸 / 字段丢失 | 0 | 未发现 |
| P1 上下游对不上（声明了但没人给 / 给了但没声明 / 声明名≠载荷键） | 10 | 已修（F1-F5、F7、F12-F15） |
| P2 字段语义/生命周期冲突或死字段 | 1 | 已修（F6） |
| P3 文档/命名/血缘漂移 | 4 | 已修 4（F8-F11），另 7 条记录不阻塞 |

一句话结论：**主链字段没有出现「模型被要求输出、下游却读不到」的硬断裂；问题集中在 handler-only / aux skill 的 payload 键没有进入 inputs 声明、以及一个已死字段仍在消耗模型注意力。**

---

## 2. 已修复

### F1 `path-reviewer` 输入名拼写错误（P1）

`prompts/core/path-reviewer.yaml:21` 原为 `prerreqTree`，而运行时注入与 `kc-mapper` 同源键是 `prerequisiteTree`（`path-reviewer-context.ts` / `path-generation.core.ts` 评审调用）。声明名与载荷键不一致 ⇒ 写 prompt 的人按声明去引用会永远取不到值。已改为 `prerequisiteTree`，ref 保持 `sandbox:path.prerequisiteTree`。

### F2 `virtual-learner-scenario-designer` 缺两个输入声明（P1）

`learner-provisioning.ts:212-217` 实际向 scenario-designer 传了 `existingPersonaSeed` / `existingStoryPool`，prompt 规则也明确要求「补故事时不得换人、必须避开已有故事池」，但 core `inputs` 从未声明这两个键。声明后 `check-handoff --strict` 才能对账，模型侧也才能明确知道这两个键的存在。

### F3 goal 模拟器缺 `personaAnchorHint` / `friction` 输入声明（P1）

`virtual-learner-goal-dialogue-simulator/index.ts` 的 `buildUserPayload` 每轮都构造 `personaAnchorHint` 与 `friction`，规则也按这两个键写死约束，但 core `inputs` 只有 learner/story/visibleContext/currentPhase/previousLearnerState/learnerMemory/task。已补声明（ref 走 `sandbox:simulation.*` 注册键）。

### F4 learn-turn 模拟器缺 `personaAnchorHint` / `friction` / `pendingCheckpoint` 输入声明（P1）

同上：payload 构造与规则引用都存在，声明缺失。`pendingCheckpoint` 还直接决定本轮是否必须输出 `checkpointAnswer`，声明缺失会让「有题不答」看起来像模型自由发挥。已补。

### F5 新增沙盘键未登记（P1，随 F2-F4）

`agent-contract-view.ts` 的 `SANDBOX_EXTRA_KEYS` 已登记 `existingPersonaSeed`、`existingStoryPool`、`personaAnchorHint`、`friction`，否则 `check-handoff:strict` 会判 `sandbox-path-unregistered`。

### F6 `goal-conversation` 的 `state.done` 是死字段（P2）

- 声明处：`prompts/core/goal-conversation.yaml:127` 要求模型每轮输出 `"done": false`；
- 消费侧：`goal-conversation.service.ts` 只用 `stage` 派生 `isCompleted`（`:331`），全仓没有任何地方读 `state.done`；
- 后果：模型每轮多填一个无意义布尔，且可能误以为 `done=true` 能结束会话（实际不能），与「stage 是唯一权威」的内部语义打架。

已从 state 描述与重试提示（`skills/goal-conversation/index.ts:1070`）中删除 `done`，明确「stage 是唯一阶段权威，平台由 stage 派生 isCompleted」。解析器对旧输出中的 `done` 仍然宽容（忽略），不影响历史数据。

### F7 `goal-confirm-adjudicator` 规则引用了未声明的输入（P1）

规则写的是 `userUtterance` / `proposal` / `lastAssistantExcerpt`，但 core 文件没有 `inputs:`。该 skill 是 handler-only，`buildUserPayload` 直接透传 TS 输入对象，键名与规则一致；问题在契约层：写 prompt 的人无法从 inputs 看出这三个键由谁提供。已补 `userUtterance → user:latestMessage`，并在注释里写明另外两个键由 `goal-conversation.service` 直供（无沙盘来源，故不进 inputs）。

### F8 goal 模拟器 `outputSchema` 与 core fields 不同步（P3）

skill 静态 `outputSchema` 未列 `shouldEnd` / `endReason`，admin 契约视图会显示成「模型不产出这两个字段」。已补齐（运行时校验用 core fields，不依赖该 schema，但文档/契约视图需要一致）。

### F9 确认链路注释过期（P3）

`simulation.execution.ts` 仍写「白名单快路径 / confirmIntent 模型判意图」，实际已改为「按钮 flag 直通 / 打字走 goal-confirm-adjudicator」。已更新，避免后续维护者按旧机制排查。

### F10 `learner-provisioning` 死参数（P3）

`GenerateStoryOptions.targetStoryCount` 从未被读取，已删除，避免调用方以为「传了数量就会生成多条」。

### F11 harness goal 步数上限偏紧（测试工具，非产品）

`simulate-learner-e2e.ts` 的 `GOAL_MAX_STEPS` 原为 14。2026-11-11 的合同案例在拟真人设下用到第 13 步才进 path，留给「慢但正常」的余量不足，已提到 20，避免把拟真摩擦误判成 `goal-not-converged`。产品侧 goal 轮次上限不受影响。

### F12 `learner-progress-report` 声明名与 payload 键完全对不上（P1）

- 声明：`sessionEvidence`（`sandbox:teaching.session.evidence`）、`learnerSnapshotDynamic`（`sandbox:profile.snapshot.dynamicState`）；
- 实收：`LearnerProgressService` 的 handler 固定下发 `{ task, metrics, signals }`（`v4-aux-skills/index.ts:337-339`）；
- 后果：编译后的 prompt 告诉模型「你有 sessionEvidence / learnerSnapshotDynamic」，payload 里根本没有这两个键；模型只能靠规则里的中文「任务信息、指标和信号」猜。

已把 inputs 改为 `task` / `metrics` / `signals`（ref 保留原沙盘来源，并注明「调用方投影」）。新增回归测试 `skills/__tests__/progress-report-declaration.test.ts`，钉住「每个 inputs.name 都是真实载荷键」。

### F13 `replan-attribution` 声明名与规则键两套名字（P1）

- 声明：`replanSignal` / `sessionWrapup` / `pathSummary`；
- 实收与规则：`recall` / `allowedRecommendations` / `evidence` / `pathContext`（`ReplanAttributionService.ts:118-128`，规则第 1-2 条直接写 `recall.reasonCodes`、`allowedRecommendations`、`evidence`）。

`rule-input-key-undeclared` 护栏之所以没拦住，是因为 fields desc 里也写了 `recall.reasonCodes`，`documented(root)` 把「字段自述」误当成「声明」。已把 inputs 改为实收四键，ref 走 `replanSignal` / `planningHints` / `wrapup` / `path.summary`。

### F14 `learner-state-review` 完全没有 inputs 声明（P1）

规则明确引用 `recentEvidence.id`（第 11、19、20 条），payload 也确实有 `learnerDigest` / `knowledgeDigest` / `recentEvidence` / `priorInsights`，但 core 没有 `inputs:`。已补四个声明；`recentEvidence` 的 ref 用 `sandbox:teaching.session.evidence`，`priorInsights` 用 `sandbox:profile.narrativeInsights`。

### F15 profile-agent 沙盘键带错前缀（P1，注册表 bug）

`SANDBOX_EXTRA_KEYS['profile-agent']` 里登记的是 `profile.narrativeInsights` / `profile.curriculumControls`；而 `validateSandboxPath('profile.narrativeInsights')` 解析出的 key 是 `narrativeInsights`（agent 段已剥离），带前缀的键只在 `sandbox:profile.profile.X` 双前缀下才命中 ⇒ 这两个键实际上永远无法注册。已补无前缀别名，并在注释里说明原因。

---

## 3. 调用周期审计（上下游 + 生命周期）

### 3.1 Goal 链

`userInput → goal-conversation → state/understanding/confirmedProposal → simulation goal → shouldEnd/noPath → path`

- **state**：`stage` 唯一权威；`confidence` 每轮覆盖；`motivation_signal` / `mi_frames` 跨轮浅合并（`parseGoalConversationResponse`）。`done` 已删除，见 F6。
- **understanding**：`mergeUnderstanding` 跨轮累积；本轮缺席=沿用，`null`=清空（`needsMaterial` 同口径）。无「上一轮字段被本轮空对象覆盖」的路径。
- **confirmedProposal**：模型确认后由 `derivePlannedOutline` 追加 `plannedMilestones` / `milestoneRange` / `previewStages` 三个派生键；下游 path 只读 `learning_direction` / `first_deliverable` 等原始字段，派生键不会反向污染契约。
- **shouldEnd（本轮新增）**：模拟器输出 → `simulation.execution` 的 `learnedEndedByModel` → `virtual-leave` 日志 + 提前收尾，不进入编排数据面路由（`ORPHAN_EXEMPT_FIELDS` 已登记）。与 `ready` 阶段的确认规则有明确互斥：`proposal_evaluation` 且 `readyToProceed=true` 时不得 `shouldEnd`。
- **noPath**：`goalReady && !learningPathId` 才判终局。已核对 `advanceConfirmedProposal` 内路径生成是 `await` 同步完成并写回 `learningPathId`（`goal-conversation.service.ts:1626`），因此不存在「路径还在后台生成、会话已被判 no-path」的竞态。开场轮的 `openingReady && !openingPathId` 同理。

### 3.2 Path 链

`goal → path-planning(milestones) → path-reviewer(pathPlan/goalContext/prerequisiteTree) → replan-attribution → path-planning → stage-designer(subtasks) → kc-mapper(conceptKcs/taskKcLinks/kcGraph) → teaching`

- `path-planning` 的 `milestones` 明确「只写阶段级，不含 subtask/acceptanceCriteria/周计划」；`path-generation.core.ts:453` 在转成 `suggestedMilestones` 时补 `tasks: []` 作为占位，是代码行为，不是模型越界输出。
- `materialRefs` 在 `suggestedMilestones` 白名单重建时显式保留（`path-generation.core.ts:459`），不会在评审边界丢失。
- 渐进式设计 `append-tasks` 走 `mergeKcStageAnnotation` 的并集合并（`conceptKcs` / `taskKcLinks` 按稳定键 union，`kcGraph` 节点/边合并），不会覆盖前序阶段 KC。
- `path-reviewer` 的 `goalContext` 是从 `normalizedInput` 投影出的子集（surfaceGoal/confirmedProposal/learnerProfile/successCriteria/timeDimensions/resources），ref 用 `sandbox:path.normalizedInput` 是近似登记；实际载荷键名是 `goalContext`，与 prompt 一致。

### 3.3 Teaching 链

`teaching-opening-generator → teaching-turn ↔ learn-turn simulator → closure → session-wrapup → enricher / curator / snapshot / replan`

- **pendingCheckpoint**：每轮从 `getSessionDetail` 重新读取（答案键已剥离），同一轮同时给判决器与模拟器；模拟器产出 `checkpointAnswer` 后随教学回合提交，下一轮重新读取（提交后平台清空），不存在「同一道题被反复作答」的残留。
- **closure**：`computeClosureDecision` 以教师 `isCompletion/autoEnded` 为 `canCompleteTask` 唯一权威；`learnerFeedback.selfReportedTaskDone` 只作观测与连击熔断（`learner-loop-break`）。learn-turn prompt 的「结课权威在教师侧」与代码一致。
- **lessonKnowledgePoints**：新课堂初始化时显式置 `undefined`（`simulation.learn-phase.ts:297`），不继承上一课看板；检查点提交回合看板为空时保留上一轮，避免判决回退到画像先验。
- **session-wrapup 与 completeTask 的顺序**：`SessionFinalizationService` 先 `endSession`（生成 wrapup、会话置 completed）再 `completeTask`；`completeTask` 内才触发 `triggerNextStageDesign`。因此 `buildPreviousStageOutcome` 查询「上一阶段 status=completed 的最近 wrapup」时，wrapup 已落库，`stillLearning` 不是必然为空。此前担心的「下一阶段设计早于 wrapup」不成立。
- **已知异步边界**：`lesson:completed` 的课后知识增强（enricher）是独立泳道、不 await；`buildPreviousStageOutcome` 自己 refresh 快照只能保证 task 完成证据入账，不能保证 enricher 产物已入账。下一阶段设计主要依赖快照的 fragile/struggling/gaps，wrapup 的 stillLearning 是补充信号——当前设计可接受，若未来要求「设计必须吃到课后增强」，需要在 enricher 完成后再触发或显式等待。

### 3.4 字段名/类型交叉检查

对 32 个 core 文件做了同名输出字段的类型矩阵，只有两组同名不同类型：

- `quickReplies`：goal-conversation `string[]` vs teaching-opening-generator `object[]?`。两者分属不同阶段、不同 UI 消费者，当前无共享读取路径；登记为命名复用，不是运行时冲突。
- `summary`：path-planning `string?` vs session-wrapup `object`。领域不同，无交叉消费。

同名输入的类型差异均为「必填 vs 可选」（`normalizedInput`、`schoolAnchor`、`pendingCheckpoint`、`existingPersonaSeed`），不构成冲突。

---

## 4. 保留观察项（未改代码）

### D1 learn-turn 模拟器没有「离场」语义（P2，行为缺口）

goal 模拟器已有 `shouldEnd`，learn-turn 的 fields 仍只有 reply/emotion/learnerState/learnerFeedback/debug/checkpointAnswer（`virtual-learner-learn-turn-simulator.yaml:114-154`）。如果模拟学习者在课中说「我先去忙」，教学循环没有对应终局信号，只能靠 40 回合上限或教师收束退出。这不是字段互相打架，而是「goal 有、learn 没有」的能力不对称。建议下一批给 learn-turn 加 `shouldEnd/endReason`，由 `simulation.learn-phase` 识别为 `learner-left` 并保留课堂现场（可续跑），不要直接判任务完成。

### D2 scenario-designer 的 `personaSeed` 在 provisioning 链路被丢弃（P3）

`generateAndApplyStory` 只取 `result.story`（`learner-provisioning.ts:219`），不写回 `result.personaSeed`；而 story-drafts 链路会读 `result.personaSeed`（`virtual-learners.story-drafts.ts:225`）。prompt 要求「补故事只能补空缺、不得换人」，但如果模型在 personaSeed 里改写了 occupation/behavior 等核心字段，provisioning 不会发现，可能造成 story 与已存 persona 漂移。建议二选一：
1. provisioning 只用 personaSeed 填补 profile 的空缺字段（不覆盖已有值）；或
2. 在 prompt 里明确「personaSeed 只作一致性自检，平台不会落库」，减少模型改写动机。

### D3 `session-wrapup.evaluation` 的「模型字段形态」与「产物类型」不同（P3，设计如此）

模型按 prompt 输出 `{ tier, evidence }` 档位对象；skill 归一化后产物是 `sessionLss/sessionKtl/sessionLf: number` + `metricTiers`（`skills/session-wrapup/index.ts:113-136`）。这是有意的「档位→数值统一映射」，消费方按数值读。文档上建议在 fields desc 里补一句「落库产物为数值 + metricTiers」，避免后来者按 prompt 形状去读产物。

### D4 `adaptive-guidance-copy` 的 TS 接口名与载荷键不同（P3）

接口用 `learnerSnapshot` / `sessionWrapup`，`buildPrompt` 映射成 `learner` / `wrapup`（`skills/adaptive-guidance-copy/index.ts:121-131`），与 core inputs 一致。属于内部命名漂移，不是运行时问题；已在 core 文件顶部注释说明「声明=载荷键」。

### D5 `stillLearning` 包含 `review` 状态（P3，语义命名）

`extractLearnerSignals` 用 `status !== 'mastered'` 过滤（`progressive-design.ts:70`），因此 wrapup 里 `status=review`（已掌握但到期复习）也会进 `stillLearning`。测试显式断言了这一点（`progressive-design.test.ts`），说明是有意把「到期复习」也算作下一阶段需要照看的信号。字段名容易被读成「还没学会」，建议改名为 `needsReinforcement` 或在类型注释里写清「含到期复习点」。

### D6 `sandbox:` ref 被用于 skill 层合成的 payload 键（P3）

`simulation.friction` / `simulation.personaAnchorHint` 并不存在于编排状态池，是 skill 的 `buildUserPayload` 用 `frictionBudget` / 平台常量现场合成的。`SANDBOX_EXTRA_KEYS` 登记让门禁通过，但这些 ref 只表示「模型输入键」，不是「沙盘状态键」。建议在 `agent-contract-view.ts` 的 simulation 段加一行注释区分两类键，避免后续有人去状态池里找。

### D7 friction 是逐轮独立采样（P3，行为观察）

`decideFrictionTrigger` 每轮按 `triggerProbability` 独立采样（normal=0.3，high=0.55），没有冷却/连续对抗抑制。真实人的对抗模式通常有情境连续性，逐轮 IID 可能显得情绪跳跃。不是字段冲突，若后续 batch 观察到「上一轮很配合、下一轮突然翻旧账」，优先考虑加 cooldown 或按会话段采样。

### D8 其余 handler-only / aux skill 的 inputs 缺失或聚合声明（P3，存量）

同属「声明面看不见 payload 键」的还有：

- `concept-consolidator`：规则引用 `candidates` / `canonicalWhitelist` / `aliasMap`，core 无 `inputs`；
- `concept-load-estimator`：规则引用 `conceptKey`，core 无 `inputs`；
- `material-collector`：规则引用 `need.title`，core 无 `inputs`；
- `teaching-opening-generator`：声明 `scenarioContext` / `learnerProjection` / `sessionInfo` 三个聚合对象，实际 payload 是 `subject/topic/taskTitle/...` 扁平键；规则第 64 条还引用 `scenarioContext.taskDescription`。

这些 skill 都是 handler-only，payload 由调用方现场组装；运行时模型能从 payload 看到键，但编译产物会把「聚合声明名」当成真实输入。建议后续统一成「声明名 = payload 键」；本轮只修了其中会造成字面冲突的 F12-F14，避免一次改太多缓存前缀。

---

### 5.1 拟真回归（上一轮修复后）

| 案例 | 结果 | goal 步数 | 终局 |
| --- | --- | --- | --- |
| 蓝屏排障 | 通过 | 3 | learner-left（说完「先去忙」即收尾，不再 8 轮告别） |
| 游泳（answer-only） | 通过 | 5 | no-path（不提案、不排路径） |
| 合同审查 | 通过 | 4 | path |

### 5.2 五个审计案例（拟真人设 + `--days=1`）

| 案例 | goal 步数 | goal 终局 | 当日结果 |
| --- | --- | --- | --- |
| 合同 | 13 | path | max-days-reached（path/阶段设计耗时 197s，1 天窗口不够跑完课） |
| 盘库 | 6 | path | max-days-reached（阶段设计等待约 5 分钟） |
| 考研 | 5 | path | max-days-reached（阶段设计等待约 6 分钟） |
| 财务 | 6 | path | max-days-reached（阶段设计等待约 6 分钟） |
| 心理 | 7 | path | max-days-reached（阶段设计等待约 5 分钟） |

结论：5/5 都从 goal 正常收敛到 path，没有出现「提案再拒单」「告别复读」「goal 不收敛」。`max-days-reached` 是 `--days=1` 与「路径 + 首阶段设计」实际耗时（2-8 分钟）叠加的结果，不是字段契约故障；跑完整课需要 `--days=2` 或更长窗口。合同案例 13/14 步接近旧上限，已按 F11 提到 20。

补充：2026-11-10 的「渐进三验」在 `--days=2` 下先 exhausted、续跑后完成完整课堂（`round=2`，`findings=0`，日志见 `.tmp-batch-1111/progressive-verify3.json.log`）。说明 teaching / wrapup / 推进下一课的字段链在完整课堂上可闭环；审计案例的 max-days 不是该链路的阻塞。

---

## 6. 门禁与验证

```text
npm run prompts:compile-all        → success, 32 core files
npm run prompts:sync               → updated: learner-progress-report / learner-state-review / replan-attribution（其余已同步）
npm run prompts:check:all          → 全绿（lint / handoff strict / snapshots / drift / skills / data-source / yaml / reachability / fields-sync / payload-prefix / threshold-coupling）
npm run prompts:core:check         → 32/32 in-sync, hasErrors=false
npm run typecheck                  → 通过
全量 jest（--runInBand）            → 771 suites / 7145 tests 通过（3 suites / 9 tests 跳过，与本次无关）
prompt-lab 契约测试（最终改动后）   → 14 suites / 139 tests 通过
定向 jest                           → 拟真/离场/终局/声明对齐共 9 suites / 98 tests 通过
```

`prompts:fields-sync` 汇总：扫描 20 个 mainline skill，**缺项 0 / 孤儿 0 / 类型不一致 0**。新增的 `shouldEnd` / `endReason` 仍按 handler 直读口径豁免（协调器 `simulation.execution` 直接消费，不进字段路由），豁免证据已写入 `check-core-fields-sync.ts`。

---

## 附录 A：32 个核心文件的字段面

> 输出字段 = core `fields`；输入声明 = core `inputs`。handler-only skill 的输入声明可能少于实际 payload 键，差异见 §4 D8。

| skill | 输出字段 | 输入声明 |
| --- | --- | --- |
| adaptive-guidance-copy | headline, subtitle, todayActions, pathHint, nextStep, paceHint, emptyStateCopy, warningCopy | learner, learningState, advisory, wrapup |
| concept-consolidator | merges, ambiguous, dropCandidates | —（见 D8） |
| concept-load-estimator | concepts | —（见 D8） |
| goal-confirm-adjudicator | confirm | userUtterance |
| goal-conversation | reply, state, understanding, nextQuestions, quickReplies, confirmedProposal, confidenceScores, structuredData | userInput, state, conversationContext |
| kc-mapper | conceptKcs, taskKcLinks, kcGraph | cognitiveCore, milestones, subtasks, prerequisiteTree |
| learner-progress-report | reasoning, suggestion | task, metrics, signals |
| learner-state-review | insights, conceptAssessments, falsifiableClaims, narrative | learnerDigest, knowledgeDigest, recentEvidence, priorInsights |
| learning-predictor | stallRisk, predictedTone, toneDetail, suggestedDepth, depthDetail, focusConcepts, rationale | fatigueSignal, knowledgeStateSummary, taskContext |
| lesson-knowledge-enricher | conceptLedger, reusableFoundations, blockedFoundations, transferSignals, recurringConfusions, knowledgeStateSummary | transferGoal |
| material-brief | status, brief, notes | —（正文由 handler 直供） |
| material-collector | status, pack, provenance, coverage, notes | —（见 D8） |
| path-planning | name, summary, totalMilestones, estimatedHours, estimatedWeeks, cognitiveCore, cognitiveDesign, milestones | rawGoal, normalizedInput, confirmedProposal, conversationHistory, replan, adjustments |
| path-reviewer | score, dimensions, issues, passed, replanInstructions | pathPlan, goalContext, prerequisiteTree |
| peer-reinforcement | message, followUpQuestions | topic, studentMessage, tutorLatestReply, tutorContext, cognitiveLevel, understanding, peerHistory |
| replan-attribution | primaryReasonCode, recommendation, reason, claim, checkOn, expect, evidenceRefs | recall, allowedRecommendations, evidence, pathContext |
| semantic-freeze-judge | verdict, findings, rationale | —（材料由 handler 直供） |
| session-wrapup | summary, evaluation | messages, knowledgePoints, sessionInfo, learningState, sessionEvidence, knowledgeContext, sessionStructure |
| skill-author | systemPrompt | — |
| skill-compiler | pass, parsedJson, missingFields, rawOutput | — |
| stage-designer | subtasks | milestone, previousMilestone, cognitiveCore, normalizedInput, materials, repairHints, supplementRequest, schoolAnchor, pathStageMap, allPreviousStageTasks, previousStageOutcome |
| teaching-opening-generator | message, question, quickReplies, mode | scenarioContext, learnerProjection, sessionInfo, learnerPersona, schoolAnchor, taskProfile, learnerPrediction（见 D8） |
| teaching-turn | reply, analysis, knowledge, pedagogy, control, visual, diagram, figure | learner, knowledge, classroomContext, classroomEventContext, controls, scenario, interactionProfile |
| virtual-learner-actor-auditor | verdict, scores, findings, recommendations, evidence | actorProfile, story, frictionBudget, learnerPrivateState, publicTrace, experimentSummary |
| virtual-learner-epistemic-grounding | epistemicGrounding | learner, knownConcepts, struggleConcepts, currentTask, knowledgeSnapshot, previousLearnerState, visibleContext, pendingCheckpoint, forcedCorrectness |
| virtual-learner-goal-dialogue-simulator | reply, emotion, shouldEnd, endReason, learnerState, debug | learner, story, visibleContext, currentPhase, previousLearnerState, learnerMemory, task, personaAnchorHint, friction |
| virtual-learner-learn-turn-simulator | reply, emotion, learnerState, learnerFeedback, debug, checkpointAnswer | learner, conceptProgress, story, visibleContext, currentPhase, previousLearnerState, currentTask, knowledgeSnapshot, learnerMemory, temporalContext, memoryRecall, epistemicGrounding, personaAnchorHint, friction, pendingCheckpoint |
| virtual-learner-memory-curator | masteredConcepts, struggleConcepts, selfCalibration, memoryDelta | persona, turnSequence, currentTask, existingKnown, existingStruggle |
| virtual-learner-path-evaluator | reaction, visibleRequestedChanges, debug | learner, story, pathProposal, goalState, previousReaction, learnerMemory, learnerState |
| virtual-learner-persona-designer | personaSeed | preferredLevels, candidatePersonas, recentPersonaHints, existingPersonaSeed |
| virtual-learner-referee | verdict, scores, findings, recommendations, evidence | publicTrace, refereeTrace, control, experimentSummary, storyMeta, metricCompleteness |
| virtual-learner-scenario-designer | personaSeed, story, consistencyNotes | preferredDomains, preferredGoalTypes, preferredLevels, preferredMotivations, avoidDomains, candidateDomains, candidatePersonas, recentScenarioHints, existingPersonaSeed, existingStoryPool |

---

## 7. 后续建议（按优先级）

1. **给 learn-turn 补离场语义**（D1）：字段与协调器同 goal 口径，避免课堂里「人已经走了，老师还在讲」。
2. **统一 handler-only / aux skill 的 inputs 声明**（D8）：concept-consolidator / concept-load-estimator / material-collector / teaching-opening-generator 逐步改成「声明名 = payload 键」，并像 F12 一样加回归测试。
3. **明确 scenario-designer personaSeed 的落库策略**（D2）：补空缺或声明仅自检，二选一，消除 story/persona 漂移。
4. **在 wrapup fields desc 标注产物形态**（D3）：模型输出档位对象、落库为数值 + metricTiers。
5. **给 sandbox 合成键加注释**（D6），把「状态池键」与「模型输入键」分开。
6. 若后续 batch 仍观察到摩擦跳跃，再评估 friction 冷却（D7），不要提前改概率表。

---

## 8. 外部评审第二轮：虚拟学习者管线 × Meno / R2 / R1 / 间隔迁移

外部评审（2026-11-11）提出 4 条「扮演 → 对话」机制冲突。逐条核到代码后的判定与处理：

| # | 评审项 | 判定 | 关键证据 |
| --- | --- | --- | --- |
| 1 | `epistemic-grounding` 只看静态人设，吞掉教师支架效果 | **成立** | 原 rule 5 只按 `knownConcepts/struggleConcepts` 判；`visibleContext.lastTeacherMessage` 虽已注入，规则没让它参与判决 |
| 2 | goal 模拟器「拍板带尾巴」被 confirm 裁决器误杀 | **成立** | 模拟器 rule 11 允许确认句带顾虑；`goal-confirm-adjudicator` 第 3 条把「补充信息」一律判 false |
| 3 | 教师 figure/diagram 没进学习者 `visibleContext` | **成立** | `NormalizedTeachingTurn` 只透传 `images`；`conversationHistory` 只写 `content`，`figures/diagrams` 在仿真链路被丢弃 |
| 4 | recurrence 枚举 `once/oneoff` 不一致；referee 未认识 R1/R2/R4 | **成立** | scenario-designer `once|recurring` vs goal-conversation `oneoff|recurring`；referee rules 无 R1/R2/R4 |

补充修正：评审说「首轮会被编排层 forcedCorrectness 强制判 false」——代码里 `decideControlledError` 有 `turnIndex < 2` 冷启动保护（`virtual-learner-shared/schemas.ts`），首轮不会注入受控错误。首轮被吞掉的是 **rule 5 的静态人设判决**，不是 forcedCorrectness；两者都修了才完整。

### 8.1 已修

**F16 epistemic-grounding 支架感知判决（P1，行为）**

`virtual-learner-epistemic-grounding.yaml` rule 5 改成两轴判决：

- 无支架冷测（没场景/没口径/直接开放问）→ 必判 false，errorPattern 记「教师未给前置积木」；
- 有支架微步（场景 + 判断口径 + 二选一/最小填空，不超负荷）→ 允许 true，但 `masteryProb` 锁 0.40-0.55（接住脚手架≠独立掌握）；
- 课内已做对且未加难 → 不得仅因 struggle 列表判 false；
- 只给答案让学生抄/复述结论不算支架。

同步 `virtual-learner-actor-auditor.yaml` rule 6：脚手架轮判 true + 中低 masteryProb 属于合理承接，不得记「能力悖论泄露」。

**F17 goal 模拟器拍板禁带尾巴（P1，行为）**

`virtual-learner-goal-dialogue-simulator.yaml` rule 11：`readyToProceed=true` 时只说一句纯拍板确认，当轮严禁补充背景/时间条件/顾虑/追问；还有顾虑就先 `readyToProceed=false` 说完，下一轮再干净拍板。确认裁决器保持「拿不准=false」的保守口径不变（避免误生成没人要的路径）。

**F18 教师图/白板进入学习者可见上下文（P1，代码）**

- `teaching-turn-engine.ts` 返回值补 `figures?: TeachingFigure[]`；
- `NormalizedTeachingTurn` 补 `diagrams/figures` 并在 `normalizeProcessTeachingTurn` 透传；
- `simulation.learn.steps.ts` 新增 `buildTeacherWhiteboardText` / `buildTeacherVisibleContent`：把 `figure.spec/axis/marks/spans/guides` 与 `diagram.code` 压成 `【课堂白板】…` 文本块（最多 4 图，单图 ≤1200 字）；
- `simulation.learn-phase.ts` 在 5 处教师消息写入 `conversationHistory` 时统一追加白板块（普通回合 / 卡死收课 / 复习收束 / 延伸段 / 检查点结课）；下一轮判决器与模拟器都能从 `lastTeacherMessage` 看到图面内容；
- 两个模拟器 prompt 的 `visibleContext` 说明补「【课堂白板】块是你屏幕上能看到的图，不要问图在哪」。

**F19 memoryRecall 对齐间隔迁移（P2，行为）**

`virtual-learner-learn-turn-simulator.yaml` rule 18 的 CLEAR/VAGUE/CONFUSED/FAILED 话术从「概念名复述」改为「新情境里用旧框架/卡在判据/规则混用/想不起上次怎么处理」，与 1d 间隔迁移微挑战同口径。

**F20 recurrence 词表统一（P2，字段）**

- scenario-designer `RECURRENCE_TYPES` 改 `oneoff|recurring`，`normalizeRecurrence` 把历史 `once` 归一成 `oneoff`；
- core yaml 明确「必须写 oneoff，不要写 once」；
- 回归测试钉住旧 `once` 仍能被收下并归一。

**F21 referee 认识 R1/R2/R4（P2，评分口径）**

`virtual-learner-referee.yaml` 新增：

- R1：oneoff_operation / environment_tooling 直接 answer-only 结束、未进 Path/Teaching 属于正确拦截，不得扣分（最多 info 留 `expectedNoPath=true`）；
- R2：Path 把实务拆成无翻车场景的 SOP 或知识目录 → 扣 `pathExperience`；
- R4：Teaching 对零基础学习者在没给场景/机制前直接开放问 → 扣 `teachingExperience`。

### 8.2 验证

- `prompts:compile-all` 32/32；`prompts:sync` 更新 6 个虚拟学习者 skill；
- `prompts:check:all` 全绿（只余 actor-auditor 原有 2 条 W5a DB 声明 advisory）；
- `prompts:core:check` 32/32 in-sync；`typecheck` 通过；
- 新增回归：`simulation.teacher-whiteboard.test.ts`（6 tests：无图空串 / figure spec / Mermaid / 上限 / 原文保留 / 归一化透传）、`prompt-realism-guards.test.ts` 新增 6 条管线对齐断言；
- 定向 jest：4 suites / 35 tests 通过；全量 jest 见 §9。

> 说明：受控错误（forcedCorrectness）仍按 `turnIndex` 独立采样，是测试教师「接错能力」的仪器；首轮冷启动不注入。它不再与「首轮支架判决」冲突；后续轮次若观察到它对 Meno A/B 有噪声，再单独评估是否在「完整支架轮」抑制注入。

## 9. 第二轮全量验证

```text
prompts:compile-all   → 32/32
prompts:sync          → 6 个虚拟学习者 skill 已更新
prompts:check:all     → 全绿（仅余 actor-auditor 原有 2 条 W5a DB 声明 advisory）
prompts:core:check    → 32/32 in-sync, hasErrors=false
typecheck             → 通过
定向 jest             → 4 suites / 35 tests（白板 6 + 管线对齐 6 + recurrence 13 + goal 模拟器 10）
全量 jest             → 773 suites / 7158 tests 通过（3 suites / 9 tests 跳过，与本次无关）
```

新增测试文件：`backend/src/coordinators/__tests__/simulation.teacher-whiteboard.test.ts`；`prompt-realism-guards.test.ts` 扩了 6 条管线对齐断言；`virtual-learner-scenario-block-annotation.test.ts` 更新 recurrence 口径并保留 `once → oneoff` 历史别名用例。
