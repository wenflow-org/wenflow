# 业务断链修复（P0） - 改动记录

**日期**: 2026-08-30
**改动目标**: 顺着业务流审计（用户旅程 × 数据流双视角）发现 6 处业务断链，修复其中 5 处 P0 断链 + 1 处文档过时；复习调度（FSRS）与掌握度（BKT）所需的信号基础设施随之就位。

---

## 🔍 审计背景

两个子代理分别从"用户旅程"与"数据流/状态机"视角交叉审计业务流程，确认 WenFlow 一节课 = **纯对话式苏格拉底教学**（LLM 产生全部语义判定：understanding/知识点状态/检查点对错/复习推进/完成判定；确定性规则只做加工）。核心问题不在"信号缺失"，而在**主观判定产生后大部分只留在会话 JSON 里，没有沉淀为可追溯、可重放、可支撑调度的业务数据**。

发现 6 处断链：

| # | 断链 | 业务影响 |
|---|---|---|
| 1 | 复习结果无领域事件（只旁路直写 memory_traces） | 复习闭环不可追溯、不可重放 |
| 2 | memory_traces 写入 fire-and-forget，失败静默丢失 | 复习调度数据源不可靠，写失败=复习点永久消失 |
| 3 | knowledgeState merge "只升不降" | 复习失败在掌握度数据上被抹平，重规划信号漏报 |
| 4 | replan 流不写 replanMode/replanReason | 决策 feed 的 path-replanned 卡不出现 |
| 5 | transferGoal 字段空转（teaching-turn 消费、下游不采集） | 迁移学习信号从未闭环 |
| 6 | 无 dueAt 物化列，getDueTraces 全表扫 | 到期查询 O(N)，FSRS 化需迁移 |

---

## ✅ 修复清单（5 处断链 + 1 处文档）

### 断链 1+2：复习结果事件化 + 写入可靠性

新增 `review:completed` 领域事件，复习结果走 outbox 事件链（可追溯、可重放、幂等）：

- `backend/src/events/contracts.ts`：`DurableEventType` 增加 `'review:completed'`；aggregateType 增加 `'review'`
- `backend/src/services/learner/ReviewCompletedConsumer.ts`（**新建**）：消费 review:completed，幂等（inbox）写：
  - `learner_evidence`（复习观测，evidenceType='review:completed'，供画像/BKT）
  - `memory_traces`（rating 语义：mastered→good/easy、learning→hard、未推进→again；again 不放大间隔）
- `backend/src/services/ai-teaching/SessionFinalizationService.ts`：`applyReviewExtraction` 返回 items；新增 `enqueueReviewCompletedEvent` 在复习课收束后发事件
- `backend/src/index.ts`：注册 review:completed 消费者

### 断链 3：knowledgeState 允许降级（复习课）

- `backend/src/services/ai-teaching/KnowledgeStateService.ts`：`merge` 加 `allowDegrade` 参数——允许 mastered 降级为 review/learning
- `backend/src/services/ai-teaching/AITeachingCoordinator.ts`：merge 调用传 `session.mode === 'review'`（复习课才降级，普通课保持只升不降，防 LLM 单轮误判）
- **语义**：复习失败（LLM 判定回退）在掌握度数据上真实可见，重规划信号不再漏报

### 断链 4：replan 元数据补写

- `backend/src/services/learning/learning.service.ts`：`redesignMilestoneTasks` 的 learning_paths.update 补写 `replanMode / replanTriggerSource / replanReason`（此前 LearningDecisionFeedService 依赖 replanReason 非空而真实 replan 从不写 → 决策卡不出现）

### 断链 5：transferGoal 闭环

- `backend/src/services/ai-teaching/AITeachingCoordinator.ts`：`lesson:completed` 事件 payload 增加 `transferGoal`（复用 endSession 已构建的 `context.cognitiveFrame.transferGoal`）
- `backend/src/services/learner/LessonKnowledgeEnrichmentConsumer.ts`：读 `data.transferGoal` 传入 enricher skill（缺失传 null，老事件兼容）
- `backend/src/skills/lesson-knowledge-enricher/index.ts`：输入接口 + inputSchema 加 `transferGoal`
- `prompts/core/lesson-knowledge-enricher.yaml`：identity + rules 增加 transferGoal 消费规则（transferSignals 优先覆盖迁移目标相关概念，证据不足不虚报 high）
- `prompts/skill.lesson-knowledge-enricher.md`：确定性编译产物
- **闭环**：任务 transferable → 教学回合 LLM 看到迁移意图 → 课后蒸馏判断迁移是否达成 → learner_evidence → 画像 transferSignals → 下一节课/新目标消费

### 断链 6：dueAt 物化列

- `backend/prisma/schema.prisma`：memory_traces 增加 `dueAt DateTime?` + `@@index([userId, dueAt])`
- `backend/prisma/migrations/20260830100000_add_memory_traces_due_at/migration.sql`（**新建**）
- `backend/src/services/memory/memory-trace.service.ts`：`recordExtraction` 写 dueAt（ACT-R 间隔规则计算）；`getDueTraces` 优先 SQL 直查 dueAt（消灭全表扫），老数据（dueAt=null）走惰性 isReviewDue 兜底合并

### 文档过时修复（A 阶段，README/协议对齐代码）

- `README.md`：DB 表数 36/16 → 43/14
- `README_EN.md`：KTL/LF 半衰期口径（42-day/7-day → 13.5/1.9 天）、DB 表数、"7 official Agents" → "5 top-level Agents"
- `doc/README.md`：3 份已归档文档死链修复（指向 archive/ + 标注）；PROMPT_AUTHORING_PROTOCOL 链接文本对齐
- `doc/SKILL_PROTOCOL_V4.md`：core skill 数量 24/25 → 26（补 learning-predictor + virtual-learner-memory-curator）
- `doc/SKILL_RUNTIME_MAP_SIM.md`：3 个模拟器 failurePolicy 描述 fallback → propagate（2026-08-11 改造后未同步）
- `doc/LEARNER_MODEL_ARCHITECTURE.md`：旧 agent 名单（summary/session-evaluation → session-wrapup）；页面名（LearnerModels → LearnerCenter）标注
- `backend/src/services/agent-manifest.service.ts`：注释 learner → profile
- `backend/src/services/prompt-schema/index.ts`：死引用 → archive v2 路径

---

## 🧪 验证

| 检查 | 结果 |
|---|---|
| `tsc --noEmit`（backend） | ✅ 通过 |
| 新增测试 | ✅ KnowledgeStateService（allowDegrade 6 例）+ ReviewCompletedConsumer（rating 映射 4 例）+ LessonKnowledgeEnrichmentConsumer（transferGoal 2 例） |
| 回归（learner/ai-teaching/events/learning/memory） | ✅ 16+13+6+4 套件全通过 |
| `prisma validate` | ✅ schema 有效 |
| `prisma migrate diff`（迁移 vs schema） | ✅ dueAt 无漂移（仅仓库既有 virtual_batch_jobs 缺迁移，非本次引入） |
| `prompts:compile-all` | ✅ 26 个 md 确定性编译，git diff 仅 lesson-knowledge-enricher 变化 |
| `prompts:core:check` | ✅ 26/26 in-sync |
| `prompts:fields-sync:check` | ✅ 16 mainline skill 零缺失 |
| 全量后端测试 | ⚠️ 5 套件失败均为仓库既有（terminology-guard/check-yaml-vocabulary/skills-file/health-center/full-session-honesty，不引用本次改动模块，数据/环境问题） |

---

## ⚠️ 已知遗留

1. **`virtual_batch_jobs` 缺迁移**（仓库既有）：schema.prisma 有 model 但迁移历史无对应，导致 `prisma:migrate:verify-clean` 报 main drift。需补一个迁移。
2. **`virtual-learner-memory-curator` 缺 manifest**（仓库既有）：`yaml:check`/`skills:check`/`prompts:runtime-contract:check` 基线既有 FAIL；且其 core failurePolicy=fallback 是 26 个 core 中唯一残留，与 2026-08-11 纯重试原则冲突。
3. **replan `new_version` 模式未实现**（契约承诺、代码抛错）：已核实为"契约承诺但从未实现、无真实调用方"，按用户决策**不实现版本化/回退**；契约文档（PATH_PRODUCTION_REPLAN_CONTRACT.md 中英版）已修正为与实现一致（overwrite 现行唯一模式），ReplanAdvisoryService / LearningDecisionFeedService / path-planning 运行时段的"新版本"文案已全部改为"调整后续阶段"。
4. **文档 vs 代码方向性结论**：无"文档承诺了、代码完全没有"的核心功能；差异均为"文档没跟上代码演化"（命名/数量/半衰期口径/归档位置）。

---

## ✅ 后续：path 阶段"补充说明重新生成"（方案 Y，2026-08-31）

**背景**：replan 业务调研确认两个场景——① 用户侧"补充说明重新生成"（goal 阶段已有 `/goal-conversation/:id/regenerate`，path 阶段缺失）；② 学习者侧课后建议调整（已有 `/replan` overwrite）。契约文档承诺的 `new_version`（路径版本化）确认**从未实现且无真实调用方**，按用户决策**不实现版本化/回退**。

**方案 Y**：path 页面补充说明重新生成，无进度重建 + 有进度收敛为 replan-stage：

| 分支 | 行为 |
|---|---|
| 无学习进度（全 todo） | 整路径重建（replace-path），补充说明注入 goal 请求供 path-agent 重规划 |
| 有已完成任务（无 in_progress） | 转调 requestPathReplan（overwrite），补充说明作为 reason 重设计当前活动阶段，已完成保留冻结 |
| 有 in_progress / 未结束课堂 | 复用 replan-stage 的 mutation 保护（409 提示先结束课堂） |

**改动**：
- `backend/src/routes/learning.ts`：`/paths/:pathId/regenerate` 支持 `adjustments`，进度判断三分支
- `backend/src/coordinators/path.coordinator.ts`：`GoalPathRequest` + `GoalFinalPayload` 加 `adjustments`，注入 `normalizedInput.understanding.adjustments`
- `prompts/core/path-planning.yaml` + 编译产物：新增"用户补充说明"输入段（重规划时最高优先级输入，与已确认方案冲突时以补充说明为准）
- `frontend/src/api/learning.ts`：`regeneratePath` 支持 adjustments
- `frontend/src/views/v2/V2LearningPathDetail.vue`：hero 区加"补充说明调整"入口 + 弹窗（textarea + 确认），处理 regenerating/redesigned-stage 分支
- 新增测试：`learning.regenerate.contract.test.ts`（5 例：无进度重建+透传、有 completed 转 replan、有 in_progress 转 replan、无 adjustments、404）

**验证**：后端 typecheck ✅、37 套件 295 测试 ✅（含新增 5 例）、prompts:core:check 26/26 ✅、前端 vue-tsc 我的文件零错误（2 个既有错误在未改动文件）✅

**明确不做**：`new_version` 版本化/回退。契约文档 PATH_PRODUCTION_REPLAN_CONTRACT.md（中英版）已同步修正为现行实现（overwrite 为唯一模式；`new_version` 标注"未实现、按决策不落地"）；用户可见文案（ReplanAdvisoryService 建议卡、LearningDecisionFeedService 决策卡、前端"路径版本"标签、管理端 regenerate 确认弹窗）已全部改为"调整后续阶段/覆盖当前路径"表述。

---

## 🔮 后续（FSRS/BKT 前提已就位）

本次修复为复习调度升级铺路：
- `review:completed` 事件 + learner_evidence 复习观测 = FSRS 的评分输入底座（对话软信号→rating 映射已实现）
- `dueAt` 物化列 = FSRS 到期查询的存储载体
- knowledgeState 可降级 = 掌握度真实反映
- 下一步：actr.ts 换 FSRS 内核（或叠加 BKT P(L)），复用现有 `/review/due` + 复习课注入链路
