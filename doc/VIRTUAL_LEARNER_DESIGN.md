# 虚拟学习者设计文档（Virtual Learner Design）

> **定位**：`doc/VIRTUAL_LEARNER_CHAIN.md` 写的是**链路契约**（故事 → Goal → Path 的传递规则与硬约束）。本文补它没覆盖的部分：**人设与故事规范、扮演机制、记忆、生成流水线、评测跑批入口，以及"作为量具"的已知偏差**。
>
> **一句话结论**：虚拟学习者既是**产品功能**（黑盒实验对象），也是我们**唯一的评测语料**。它自带偏置——偏置会被误读成产品特性。本文把已实测的偏置全部量化列出（§11），并给出评测纪律（§12）。
>
> 快照时间：2026-09-21 · 数据来自本地 `backend/prisma/dev.db`

---

## 1. 顶层结构

```
虚拟学习者（一个虚拟用户账号）
├─ 人设 persona        33 字段（stable，跨故事不变）
├─ 故事池 storyPool[]  N 个故事（情境 → 当次学习需求）
└─ 记忆 learner-memory  已掌握 / 到期复习 / 易混淆 / 最近完成事项（跨会话累积、写入画像）

              ┌── assisted 链：选故事 → Goal（模拟器扮演学习者）→ Path → Learn
运行方式 ──────┼── blackbox-api 链：黑盒实验（step / observe / evaluate / checkpoint）
              └── quick-learn 支路：账号已有 Path，直接上课，不经故事与 Goal
```

- 模式开关：`backend/src/virtual-lab/session-mode.ts` → `'assisted' | 'blackbox-api'`（互斥，混用会抛 `VirtualSessionModeError`）
- 关键点：**学习者不是真人**。系统用 LLM **扮演**这个学习者，去和真实的 Goal / Path / 教学 agent 对话（§6）。

---

## 2. 数据模型

| 层 | 存储 | 说明 |
|---|---|---|
| 账号 | `users`（`isVirtualLearner = true`） | 生产统计（overview/stats）据此排除合成数据 |
| 人设 | `virtual_learner_profiles` + JSON `profile` | 33 字段人设 + `storyPool`；`source` = `builtin`(14) / `custom`(75)；`presetKey`+`presetVersion` 仅内置有 |
| 会话 | `virtual_sessions` | `status` / `currentStage`(goal/path/…)、`goalConversationId`、`learningPathId`、`stageResults`(JSON，含故事全文、实验配置、自动驾驶状态)、`logs` |
| 故事 | `profile.storyPool[]`（JSON，非独立表） | 见 §4；无硬 FK，故事↔Path 是软关联 |
| 记忆 | `memory_traces`（含 FSRS/ACT-R 状态）+ 画像 `knownConcepts` / `struggleConcepts` / `recentCompleted` | 见 §7 |
| 批量 | `batch_experiment_*` | **时间推演**（模拟日推进 / 记忆衰减 / 快照），不是 A/B 对照设施 |
| 快捷 | `virtual_quick_learn_runs` | 快捷支路运行记录 |

本地现状：**89 个虚拟学习者**（14 内置 + 75 custom）、**282 个虚拟会话**、102 个 Goal 会话带负荷画像。

---

## 3. 人设规范（33 字段，稳定身份）

来源：`virtual-learners/presets.yaml`（内置手写）+ `virtual-learner-persona-designer`（LLM 生成，而 prompt 是 `prompts/core/virtual-learner-persona-designer.yaml`）。

| 类别 | 字段 | 结构 |
|---|---|---|
| 身份 | `nameHint` / `age` / `occupation` / `education` / `background` | 文本 |
| 知识 | `knownConcepts` / `struggleConcepts` | string[]（各 2–4 项） |
| 学习偏好 | `learningStyle` | **enum** `reading\|watching\|doing\|listening` |
| 资源 | `availableTime` | **enum** `minimal\|moderate\|abundant` |
| 资源 | `techComfort` | **enum** `low\|medium\|high` |
| 动机 | `motivationType` / `motivationOrientation` / `personalityDrivers` | enum / 文本 / string[] |
| 人格 | `corePersonality` / `emotionalBaseline` / `emotionalTriggers` / `resiliencePattern` / `adversarialPattern` / `helpSeekingPattern` / `memoryRepairPattern` / `communicationStyle` | 文本 / string[] |
| 认知 | **`cognitiveLoadTolerance`** | **自由文本**（无枚举约束！） |
| 认知 | `metacognitiveProfile` / `selfRegulationStyle` / `digitalLiteracy` | 文本 |
| 边界 | `behaviorBoundaries` / `learningPreferences` / `failurePatterns` / `priorAttempts` | string[] / 文本 |
| 预算 | `simulationBudget` | 对象（LLM 重试预算，见 §8） |
| 记忆回写 | `recentCompleted` | string[]（由 `recordCompletedArtifact` 写入） |
| 行为参数 | `personalityTraits` | `{verbosity, enthusiasm, confusionStyle, patience, questionStyle, emotionalRange}`（enum 见 scenario-designer 约束） |

### 三个结构性问题（已实测）

1. **枚举 vs 自由文本不统一**：`availableTime` 是枚举（代码精确匹配），`cognitiveLoadTolerance` 是散文（代码只能正则猜）⇒ 这是"枚举/正则扯皮"的源头（§11-4）。
2. **字段重复**：新版人设有 `overloadReaction`（"信息一多或步骤太密时最典型的反应"），与 `cognitiveLoadTolerance` 描述同一件事。代码读的是后者（且靠正则）。
3. **人设字段缺失只出现在"测试账号"上**（2026-09-21 复核纠正）：本地 12 个 33 字段全空的人设是 **`[from-zero] <时间戳>` / `[e2e-probe]` 测试垃圾**（0 故事），**不是生成器失败**。真实生成样本（62 个）字段齐全。⇒ 语料统计必须排除测试账号（`name LIKE '[%]%'` 或 `notes` 标记）。

---

## 4. 故事规范

`storyPool[]` 每个故事的字段：

| 字段 | 作用 |
|---|---|
| `id` / `title` / `sourceType` | 标识；`sourceType` = work / study … |
| `storyOutline` / `triggerEvent` | 背景与触发事件 |
| `visibleOpening` | **学习者开口第一句**（Goal 的当次诉求，最高优先，见 chain 文档） |
| `hiddenDetails` / `misdiagnosis` | 只有学习者知道的信息 / 常见误判 |
| `pressurePoints` / `behaviorHooks` | 压力点与行为钩子 → 映射为模拟器隐性状态（`buildStoryBehaviorBias`） |
| `problemKnowledge` | `domainFamiliarity` / `knownConcepts` / `struggleConcepts` / `selfAssessment` / `hiddenGaps` |
| `goalSeed` | `domain / goalType / surfaceGoal / realProblem / motivation / urgencyHint / constraints / expectedOutcome`（**形状随生成器版本漂移**：新版本另含 `primaryBlockType` / `recurrence` / `block_type_evidence`） |
| `disclosurePlan` | 披露计划；随故事全文（`stageResults.story`）**整体**传给模拟器 |

> 故事全文持久化在 `virtual_sessions.stageResults.story`，`parseStoryContextFromStageResults()` 原样解析回来 ⇒ 没有"悄悄丢字段"的清洗层。

---

## 5. 生成流水线（四条创建路径）

| 路径 | 入口 | 产出 | 备注 |
|---|---|---|---|
| A. 内置 preset | 启动时 `builtin-learners/seeder.ts` 读 `virtual-learners/presets.yaml` | 人设 + 手写故事 | 有 `presetVersion` + drift 检测；本地 14 个 |
| B. 手动创建 | `POST /api/admin/virtual-learners` | 人设（必填 name） | `learningGoal` 可选 |
| C. LLM 生成人设 | `POST /generate-persona`、`POST /:id/draft-profile` | personaSeed | skill `virtual-learner-persona-designer`；**代码会为缺失字段填默认值**（保成功率，与 prompt"禁止兜底句"有意的契约差异） |
| D. LLM 生成故事 | `POST /:id/draft-stories` | 1 个故事（追加进 storyPool） | skill `virtual-learner-scenario-designer`；会注入"最近场景提示 + 该学习者记忆摘要"，`sampleType='student'` 时额外注入学生情境 |
| E. 批量 | `POST /api/admin/batch-experiments`，body `{name, description, learners[]}`，每项 `{name, learningGoal?, frictionBudget?}`（默认 `normal`，**每实验上限 20 人**） | 批量人设+故事 + 定时推演 | 人设/故事仍由 persona-designer + scenario-designer 生成；附带**模拟日推进 / 记忆衰减 / 快照**；**这不是 A/B 对照设施** |

故事可改：`PUT /:id/stories/:storyIndex`（可不改代码注入自定义故事）；`DELETE /:id/stories/:storyIndex`。

---

## 6. 扮演机制（模拟器）

主链 skill（`prompts/skills.yaml` simulation-agent 下辖）：

| skill | 角色 |
|---|---|
| `virtual-learner-goal-dialogue-simulator` | **Goal 阶段扮演学习者**（step 1，按 goal 轮次循环） |
| `virtual-learner-learn-turn-simulator` | 教学阶段扮演学习者（step 5，按教学回合循环） |
| `virtual-learner-memory-curator` | 课后记忆整理（step 9） |
| `virtual-learner-referee` / `actor-auditor` / `epistemic-grounding` | 黑盒链的裁判/审计/接地 |
| `virtual-learner-path-evaluator` | 仅 legacy assisted 调试 |

Goal 模拟器每轮的输入（`simulation.coordinator.ts`）：

```
learner: {profile, learningGoal, knownConcepts, struggleConcepts, personalityTraits}
story:   storyContext（故事全文）
visibleContext: 最近对话（只含学习者可见内容）
currentPhase: 'opening' | 'understanding' | 'proposal_evaluation'
previousLearnerState / goalState / frictionBudget
learnerMemory: ← 长期记忆注入（见 §7）
```

**摩擦预算 frictionBudget**（`virtual-learner-shared/schemas.ts`）：`none | low | normal | high | stress_test`，**默认 `normal`**（`triggerProbability = 0.30`，`none = 0`、`low = 0.15`）。它决定模拟器"是否/多强地"表现抗拒、追问、偏题、情绪——即**学习者给多少信息、制造多少阻力**。会话级标签存在 `stageResults.simulationConfig.frictionBudget`；TIR 反馈（角色审计分低）可上调一档。

---

## 7. 记忆（三链统一）

`backend/src/virtual-lab/learner-memory.ts`：

- **写**：课后把知识看板回写画像（`mastered → knownConcepts`；`review/learning → struggleConcepts`）；任务结算登记"做完的事"（`recentCompleted`）。
- **读**：`buildLearnerMemorySnapshot(userId)` → `{mastered, dueReview（memory_traces 到期点）, recentCompleted, …}`。
- **注入点（重要）**：
  1. **Goal 模拟器**：`simulation.coordinator.ts` —「长期记忆注入（目标澄清时学习者能提及过往学习经历）」；
  2. 教学阶段模拟器：`learnerMemoryForSimulator`；
  3. 故事生成：`buildLearnerMemoryStoryHints`（新故事可延续"他做过什么"）。
- **副作用**：⇒ **重复跑同一学习者的第 N 次 ≠ 独立测量**（本地最活跃者已跑 19 次会话）。做"改动前后"对照时必须配对或隔离。

---

## 8. 预算与闸门

| 层级 | 来源 | 字段 |
|---|---|---|
| 默认 | `presets.yaml · defaultBudget` | `turnChunkPerLesson=60`、`costCeiling=1500`、`maxRetriesPerStep=8`、`noProgressChunkLimit=3` |
| 角色级 | `profile.simulationBudget` | 覆盖默认 |
| 故事级 | `story.budget` | **优先于角色级** |
| 课时闸门 | `resolveLearnTurnBudget` | `max(LEARN_TASK_TURN_BUDGET=40, 驾驶舱回合上限, turnCapPerLesson)` |

---

## 9. 评测跑批入口

| 入口 | 用途 |
|---|---|
| `scripts/vl-preset-run.mjs` | **基准语料跑批**（14 内置 preset）。`--only=姓名,presetKey`、`--concurrency`(默认1)、`--retries`(3)、`--backoff`(60s 起翻倍)、`--gap`(5s)、`--dry-run`。**在"学习者粒度"退避重试**，专治网关 429 ⇒ 一次 429 不再变成 `Provider request retry budget exhausted` |
| `POST /:id/start-session` + `POST /sessions/:id/run-full` | 单例（`maxRounds` / `maxMilestones` / `autoAdvanceToPath`） |
| 黑盒 | `start-blackbox-session` / `blackbox-step` / `blackbox-observe` / `blackbox-evaluations` / `blackbox-rerun` |
| 落盘 | `backend/vlab-runs/preset-run-<ts>.json`（**已 gitignore**）+ DB 表 |

**网关硬限制（实测）**：`1 分钟最多 15 次请求`（超限 429）。批量跑批必须并发 1 + 退避；跑批期间**不要并行其它高并发活动**。

---

## 10. 与"体量链路"的接口（重点）

虚拟学习者的人设字段会**直接决定路径体量的上界**：

```
persona.availableTime / cognitiveLoadTolerance
   └─ simulation.path-phase.ts 组装 learnerLoadProfile
        └─ derivePlanningHints（path-planning-hints.ts）
             └─ 命中"紧/低" ⇒ milestoneRange 砍到 [≤2, ≤2] + targetMilestones ≤ 2
                  └─ validator 对 lo==hi 即精确校验 ⇒ 里程碑数被"卡死"
```

实测（§11-1/2）：`availableTime=minimal` ⇒ `milestoneRange=[2,2]` ⇒ 产出**恰好 2 段**，与模型意愿无关。

**同时**：真实用户链路**不构造** `learnerLoadProfile`（本地 116 个真实用户会话中 **0 个**带负荷画像）⇒ **这条收紧只影响虚拟学习者（评测语料）**。

**一处曾经的误判（2026-09-21 复核纠正）**：`pathAgentInput.metadata.normalizedInput` 里确实存着
`learnerLoadProfile.availableTime`，但它只是**落库审计副本**。真正进入 LLM 的是
`buildPromptFriendlyNormalizedInput()` 的**白名单投影**（`backend/src/skills/path-planning/index.ts:83`），
只含 `version / learnerProfile / problemSpace / resources / successCriteria / confirmedProposal / planningHints`
⇒ **负荷画像不会到达模型**。提示词里出现的「可用时间：…」来自 `input.metadata.availableTime`（= Goal 产出的 `timePerDay`），与本字段无关。

---

## 11. 已知问题清单（附实测数据）

### 影响"度量可信度"（最要紧）

| # | 问题 | 实测数据 | 后果 |
|---|---|---|---|
| ~~1~~ | ✅ **已修复（2026-09-21）**：负荷收紧把区间塌成单点 | 修复前重放 216 条真实历史输入：**88 条（41%）** 区间塌成 `[2,2]`；275 例重扫实测 **127/275（46%）`gated`，其中 100% 恰好 2 段**（自由那半均值 3.80）。修复：认知负荷**退出里程碑数**（只收紧资源）+ 出口不变量「区间永不为单点」 | 体量曾被代码拍死，被误读为"模型只会给 2 段" |
| 1b | 阶梯对照（同 4 学习者／同故事／同模型） | 现状 `2,2,2`(对照 3) → 上界压到 3：`3,3,3`(对照 4) → 完全不收：_跑批中_ | 定量出"放开的边际收益" |
| 2 | **只打虚拟学习者**（量具有偏） | 真实用户带画像 **0/116**；14 内置 preset 里 **7 个 `minimal`**；custom 人设 **46/75（61%）`minimal`**；另有 12 人字段缺失 | 评测语料系统性偏向"时间极少"的学习者 ⇒ 量具自己把体量压小 |
| 2b | ✅ **部分已修（2026-09-21）**：预设语料负荷轴失衡 | `virtual-learners/presets.yaml` **corpus v2**：林慧敏/陈默/周敏/刘芳 `minimal → moderate`（该 4 条 `presetVersion` 2→3），保留王婷/苏芮/孙浩三条真·时间极少 ⇒ 分布 **3/8/3** | 旧 v1 数据与这 4 条 v2 数据不可直接比；custom（LLM 生成）那 61% 仍待改生成提示词 |
| 3 | **同一学习者重复跑不独立** | 记忆注入 Goal 模拟器（§7）；最活跃者 19 次会话 | "改动前后"对照有顺序混淆 |
| 4 | **`cognitiveLoadTolerance` 靠正则猜** | 77 个有值者中 **62 个是散文**；用 LLM 当裁判审 64 条：**漏判 47%**、误判 10% | 该收紧的一半人没收紧（路径偏重） |
| 5 | **`pace`（上界 3/5/8）由正则拍** | 1162 次取值：枚举命中仅 9 次（0.8%）、正则 59%、默认 40%；裁判审计 991 次：一致 75%、**判错 16%**、**裁判判"无法判断"而代码照拍 34%** | 误判方向**偏松**（急事给上界 5）⇒ 与 1 方向相反，调参不收敛 |
| 6 | **急事被给松上界**（正则漏词） | `这周就要用`/`明早交`/`今天下班前`/`即时`/`不到二十小时` → 代码全判 `standard`(5)，裁判判 `compact`(3)；累计 ~77 次 | 膨胀 |
| 7 | **日期被读成月数** | `距离12月15日考试，尚有约7-8周…` → 代码 `extended`（51.6 周）| 上界 5→8 |
| 8 | **表与正则自相矛盾** | `3-7天` 映射表说 `standard`，正则算出 1 周=`compact` | 同一输入两种结论 |
| 9 | **动词前缀正则静默删阶段**（历史，已修） | 344 会话 / 11399 阶段：**652 个（6%）** 会被删（含"设计…""验证…""复盘…"） | 体量凭空变小且用户不可见；`6dc7e8bb` 已删函数，配置 `operationalStagePatterns` 仍残留（死配置） |
| ~~10~~ | ~~人设字段漏进 LLM 提示词~~ **已澄清，非缺陷** | 复核：进 LLM 的是 `buildPromptFriendlyNormalizedInput` 白名单（§10），`learnerLoadProfile` 不在其中；`pathAgentInput.metadata` 只是落库审计副本 | 无 |

### 影响"实现质量"（次要）

| # | 问题 | 数据 |
|---|---|---|
| 11 | **故事池很薄**（部分属设计如此） | `scenario-designer` 的输出契约就是**"生成 1 个故事"**、代码 `result.story` 只落 1 条 ⇒ 62 个学习者只有 1 条故事**是设计结果**（要更丰富需多次调用或改契约）。真正异常的是 13 个 0 故事者 —— 复核后**全是测试垃圾账号**（`[from-zero]`/`[e2e-probe]`）。另：日志 `requestedStoryCount: 3` 与契约不符，是误导性标签 |
| 12 | **人设字段重复** | `cognitiveLoadTolerance` ↔ `overloadReaction` 同义 |
| 13 | **生成器偏向"时间紧"** | §11-2；历史 prompt 示例 JSON 曾写死 `"availableTime": "minimal"` |
| 14 | **`goalSeed` 形状漂移** | 老故事 8 键，新故事另含 `primaryBlockType`/`recurrence`/`block_type_evidence`（消费方需兼容） |
| 15 | **紧预算分支会"放大" micro 路径** | `tightBudgetConfig.rangeReductionFloors.milestoneRange = [2,3]` ⇒ `micro` 的 `[1,2]` 被抬成 `[2,3]`（下调用了 `max(floor, x-1)`，floors 反而成了抬升地板） | 与"紧预算应更小"的意图相反 |

---

## 12. 评测纪律（跑批前必读）

1. **同一批语料、同一顺序**；改动前后必须**配对**（同学习者 / 同故事）。
2. **记录每例的 `resolvedModel`** 与 skill prompt 版本——降级链可能把调用换成别的模型（实测：近 6h 1208 flash / 49 agnes ≈ 4%，`light` 别名也会落到 agnes）。
3. **跑批期间不要改 `backend/src`**（ts-node-dev 会重启，打断全部在跑会话）。
4. **并发 1 + 退避**（网关 15 次/分钟）；不与其它高并发活动并行。
5. **警惕量具偏置**：先看这批语料的 `availableTime` 分布与故事数；`minimal` 占比高时，"2 段"多半是钳制的产物。
6. **重复跑要配对或隔离**（记忆会跨会话注入）；可用"新建学习者"隔离。
7. **不要只看里程碑数**：真正的判据是"路径能不能解决故事里的真实问题"（盲评：只喂"问题 + 路径"，不透露口径）。

---

## 13. 建议（按性价比）

| 优先 | 动作 | 依据 |
|---|---|---|
| 1 | ✅ **已实现**（2026-09-21）：负荷收紧不再塌成单点 —— `LOAD_MILESTONE_CAP = 3` + **保底宽度 1**（上界压到 3，但永不低于「下界+1」）；资源类收紧（单任务分钟/周期/任务密度）原样保留 | §11-1/2：46%（275 例实测）单点塌缩，且只影响评测语料 |
| 1b | ⏳ **下一步**：认知负荷**完全退出里程碑数**（只保留资源类收紧）——阶梯对照 `现状 2 / 压到 3 / 完全不收` 出数后定稿 | 用户判断 + §11-1：**结构归 LLM 与学习证据，强度归认知负荷** |
| 2 | **`cognitiveLoadTolerance` 枚举化**（`low\|normal\|high`）并与 `overloadReaction` 合并（实测 62 个人设**两个字段都填了**），**删掉那条 47% 漏判的正则** | §11-4 |
| 3 | **`time_horizon` 规格化**：让 Goal 直接产出周数/档位，正则只兜底；同时补齐截止词表（这周/今天/明早/即时…） | §11-5~8 |
| 4 | **语料治理**：拉均匀 `availableTime` 分布、补全缺失字段、每人补到 2–3 个故事 | §11-2/11 |
| 5 | **单点编译提示词后 `prompts:sync`**，并把本次口径写进 `prompts/core/*.yaml` 的契约说明 | 仓库约定 |
| 6 | 清理残留死配置 `operationalStagePatterns`（`pedagogy.config.ts`） | §11-9 |

### 13.1 拆开看的边界（2026-09-21 定）

| 维度 | 归谁 | 现状 |
|---|---|---|
| **分几步 / 走哪条路**（结构） | LLM（问题语义） + **学习证据**（fragile/struggling/前置缺口） | 认知负荷目前**越界**参与了（→ 建议 1b）；调整链本身已经是纯学习证据 ✅ |
| **一次能学多久 / 多密**（强度） | 认知负荷 / 可用时间（代码给上界） | 保留 |
| **窗口多长**（horizon） | 时间节点（deadline/考试）优先；无节点时兜底 | 现状 `maxWeeks` 硬上限 52 周、**超限无任何反馈** |

### 13.2 挂起：宏大目标（暂不做）

「特别宏大的目标」（如"一年内成为顶尖心理学家"）的分解方案属于**未来议题**，当前聚焦中小体量。届时需要一起考虑三件事：

1. **窗口上限**：有自然节点（考试/deadline）→ path 覆盖到节点；无节点 → 半年兜底。实测现状：275 例里 **>26 周仅 5 例（1.8%）**（27–32 周，且都是可验收的长周期目标，如考研/机器学习入门）。
2. **不可验收目标的显式反馈**：Goal 层挡下来并要求可观察结果 —— **判据给 LLM，代码只做形状校验；绝不做静默截断**。
3. **多路径（主线/辅助线）**：需要新增并列路径身份、共享前置、跨路径进度汇总与验收口径 —— 数据结构与前端投影都要动，风险最高，**明确暂不做**。

---

## 附录 A：复现本文数据

```bash
# 人设/语料分布（§2/§3/§11-2）
node -e "…"   # 见本次会话的 enum-audit.mjs（临时脚本，未入库）

# 重放历史输入量"单点塌缩"（§11-1）
# 用今天的 derivePlanningHints + learning_paths.sceneFraming.normalizedInput 重算

# 三臂单变量对照（§11-1 的在线验证）
# 同案/同模型/同提示词，只改 persona.availableTime 与「负荷收紧」那一个条件

# 基准语料跑批（§9）
node scripts/vl-preset-run.mjs --only=孙浩,苏芮,林慧敏,谭小雨 --concurrency=1 --retries=3
```

## 附录 B：关键代码位置

| 关注点 | 文件 |
|---|---|
| 人设/故事/会话 CRUD、生成、跑批入口 | `backend/src/routes/admin/virtual-learners.ts` |
| 模拟编排（Goal/Learn 扮演、记忆注入） | `backend/src/coordinators/simulation.{coordinator,execution,goal.steps,learn.steps,helpers}.ts` |
| 记忆三链统一 | `backend/src/virtual-lab/learner-memory.ts` |
| 摩擦预算/隐性状态 | `backend/src/skills/virtual-learner-shared/schemas.ts` |
| 故事→诉求传递 | `backend/src/virtual-lab/story-demand.ts`（另见 `doc/VIRTUAL_LEARNER_CHAIN.md`） |
| 会话模式/工厂/预算 | `backend/src/virtual-lab/session-{mode,factory,budget}.ts` |
| 黑盒实验 | `backend/src/virtual-lab/blackbox-{runner,checkpoint}.ts` |
| 批量（时间推演） | `backend/src/services/virtual-lab/batch-experiment.service.ts` |
| 体量收敛（受本页 §10 影响） | `backend/src/services/learning/path-planning-hints.ts` + `backend/src/skills/path-planning/index.ts` |
