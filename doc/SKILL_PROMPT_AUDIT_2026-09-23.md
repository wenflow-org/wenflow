# Skill 提示词评审报告（goal → path → 任务/阶段 → 课堂）

- **日期**：2026-09-23
- **范围**：`goal-conversation` / `path-planning` / `stage-designer` / 课堂其余（`teaching-opening-generator`、`peer-reinforcement`、`concept-consolidator`、`adaptive-guidance-copy`、`goal-understanding-composer`）
- **方法**：4 个**只读评审子代理**通读「提示词 + 代码 + 接线 + 运行时真源」；本报告作者**逐条复核**关键结论——标「已核实」的为亲自验证，标「子代理报告」的未复核。
- **运行时真源**：DB `agent_prompts` 的 **ACTIVE 行**（与 `prompts/*.md` 编译产物一致；`yaml → md → DB` 三者同源，故对 yaml 的评审即对线上提示词的评审）。
- **纪律（重要）**：提示词改动一律**单点编译**
  `npx ts-node --transpile-only src/scripts/compile-core-file.ts --skill=<id> --write` + `npm --prefix backend run prompts:sync`。
  **禁用 `prompts:compile-all`**（子代理的建议里出现了这条，不要照做）。

---

## 0. 结论速览

| 节点 | P0 | P1（最实的几条） |
|---|---|---|
| **goal** | `prerequisiteCheckResults` 断链；规则 #25 引用未声明字段 | advisory 与「不宣布」冲突（需拍板）；探测题判分无回退 |
| **path** | `reviewerFeedback`/旧路径不进载荷 | `adjustments` 不可达；#30/#43 自相矛盾（撞 WIP）；投影白名单丢字段 |
| **stage** | `sandbox:path.materials` 未注册 | `loadTarget` 死链；无资料不核对 materialRefs；资料重复投递 |
| **课堂** | peer `followUpQuestions` 契约必填 vs 提示词说可选 | peer `loadIndex/emotionalState` 静默丢；peer JSON 合规失败 35 次；opening 规则 7/8 逐字重复；adaptive 声明与载荷键不符 |

**一句话**：真正的硬伤集中在**跨层契约**（产出了下游不读 / 下游要读但没产出 / 声明与载荷不一致），而不是"提示词写得好不好"。提示词主体（KV 序、资料缝、硬条件压回）是健康的。

---

## 1. P0（必须改）

### 1.1 goal · `prerequisiteCheckResults` 断链 —— 前置探测题实际失效 【已核实】

- **现象**：goal 层产出并落库 `collectedData.understanding.prerequisiteCheckResults`；`path-planning` 的规则与代码**都消费**它；但 `buildGoalPathRequest` **从未把它放进 `GoalPathRequest`** → 确认生成路径的主流程拿不到。
- **证据**：
  - `backend/src/services/learning/goal-conversation.service.ts` 全文件 `prerequisiteCheckResults` **0 命中**（`buildGoalPathRequest` 约 1127-1190 行）。
  - 下游已支持：`backend/src/coordinators/path.coordinator.ts:73,92-93,150,175`。
  - 提示词声明它生效：`prompts/core/goal-conversation.yaml:131-133,159-162`。
  - 仅旁路能捞回：`backend/src/routes/learning.ts:176-178,226-228`。
- **影响**：前置知识探测（"防自评虚高"的机制）在正常确认流程里**不生效**。
- **修法**：`buildGoalPathRequest` 的返回对象补一个字段（`understanding` 已是合并结果，两路都覆盖）：
  ```ts
  prerequisiteCheckResults: Array.isArray(understanding?.prerequisiteCheckResults)
    ? understanding.prerequisiteCheckResults
    : null,
  ```
- **文件干净度**：✅ `goal-conversation.service.ts` 不在他人 WIP 清单里。

### 1.2 goal · 规则 #25 引用了未声明的字段 【已核实】

- **现象**：执行规则 #25 要求「每轮在 `state.motivation_signal` 中维护 change_talk_score，并在 `state.mi_frames` 中维护四个动机帧」；但 `fields:` 里的 `state` **只声明了 `stage/confidence/done`**，而约束又要求"不输出表外字段" → **自相矛盾**，模型很可能不产出这两个字段，而代码与 `collectedData` 持久化都在等它。
- **证据**：`prompts/core/goal-conversation.yaml:51`（规则 #25）vs `:71-73`（`fields.state` 声明）。
- **修法**：
  1. 在 `fields.state.desc` 里声明 `motivation_signal` / `mi_frames`（hidden，不面向用户）；
  2. 防御性放行：`backend/src/skills/goal-conversation/structured-validator.ts` 的 `allowedTopLevelKeys` 加入两个键（模型可能写在顶层）；
  3. 命名对齐：载荷上一轮给的是 camelCase（`state.motivationSignal`），规则却要求 snake_case —— 解析侧已兼容两种，建议 `buildPreviousState` 同时输出两种键名。
- **文件干净度**：✅ `goal-conversation.yaml` 干净（他人 WIP 的是 `path-planning/stage-designer/session-wrapup` 的 yaml）。

### 1.3 path · `reviewerFeedback` 与旧路径不进载荷 —— 自动重规划退化成"盲重采样" 【已核实】

- **现象**：`path-reviewer` 判 `passed=false` 后把反馈写进 replan 对象，但**载荷不渲染**它；也没有旧路径可对照 → 重规划等于"同样输入的再次采样"，规则 #4（逐条修正评审反馈）完全失效。
- **证据**：
  - 反馈已写入：`backend/src/services/learning/generation/path-generation.core.ts:812`（`reviewerFeedback: pathReview.replanInstructions`）。
  - 载荷**只**渲染这些键（实测）：`replan.mode` / `triggerSource` / `sourcePathId` / `freezeCompletedTaskIds` / `learnerReplanProjection` —— 见 `backend/src/skills/path-planning/index.ts:783-798`。
- **修法**：
  1. `path-generation.core.ts` 的 replan 对象补 `previousPlan`（旧路径的 `name/cognitiveCore/milestones`）；
  2. `path-planning/index.ts` 的载荷渲染补【路径评审反馈】【被调整的原路径】两个分区（`previousPlan` 建议限长，避免爆预算）；
  3. 重调要求里补一句"若提供评审反馈必须逐条修正、不得无视原路径重新采样"。
- **文件干净度**：✅ 两个代码文件干净；⚠️ `prompts/core/path-planning.yaml` 是他人 WIP，**文案类修复要绕开**。

### 1.4 stage · `sandbox:path.materials` 未注册 —— 仓库自带门禁会失败 【已核实】

- **现象**：`prompts/core/stage-designer.yaml:29` 声明 `ref: sandbox:path.materials`，但该路径**从未注册**（`SANDBOX_EXTRA_KEYS['path-agent']` 里没有 `materials`；全仓仅此一处引用）→ `prompts:check-handoff:strict`（`prompts:check:all` 的一环）会判失败。
- **证据**：`backend/src/services/agent-contract-view.ts:63-76`（`path-agent` 的 extra keys 全量已看，无 `materials`）。
- **修法**：`SANDBOX_EXTRA_KEYS['path-agent']` 追加 `'materials'`（一行；推荐只补 extra key，不动 orchestration 路由，否则会引入 skip 噪声）。
- **文件干净度**：✅ 干净。

### 1.5 课堂 · peer `followUpQuestions` 契约必填 vs 提示词说"可选" —— 已造成真实失败 【已核实】

- **现象**：core `fields` 声明 `type: "string[]"`（**无 `?` = 必填**），提示词 desc 却写"可选的后续追问"，handler 也按可选处理 → 模型省略该字段时整轮 `missing-required` 失败（`maxAttempts:1` 不重试），**伴学消息整条丢失**。
- **证据**：
  - 契约：`prompts/core/peer-reinforcement.yaml:47-49`；提示词：`prompts/skill.peer-reinforcement.md:43`（"可选的后续追问"）。
  - **现网实证**（`backend/prisma/dev.db#prompt_call_logs`，只读）：
    - `35 × SKILL_PEER_REINFORCEMENT_FAILED — response does not contain valid JSON object`
    - `2 × SKILL_PEER_REINFORCEMENT_FAILED — fields contract violation: followUpQuestions(missing-required:string[])`
- **修法（两条一起，互为保险）**：
  1. 代码级（立即生效，无需重发布）：`peerPromptSpec` 加 `coerceParsedForContract`，把缺失的 `followUpQuestions` 收敛为 `[]`；
  2. 真源级：`peer-reinforcement.yaml` 的 `type` 改 `"string[]?"`，再单点编译 + sync。
- **文件干净度**：✅ 干净。

> 附：同一份日志里 **35 次 JSON 不合规**才是 peer 的主要失败源（见 2.4），与契约不匹配是两回事，需一并治。

---

## 2. P1（明显收益）

### 2.1 goal
- **advisory 出口与「不向用户宣布」反向冲突**（**需产品拍板**）：提示词明令 hidden 信号不得向用户宣布，但平台侧 deterministic 追加一行"系统判断：你卡住的主因更偏情绪/信心…"到 `userVisible` 并落库（默认生效）。要么 advisory 只落库/遥测，要么改提示词口径承认平台可能附一行。
- **探测题判分无回退**（子代理报告）：`applyPrerequisiteProbeAnswerKey` 只依赖本轮 `confirmedProposal`；模型若不重复输出 proposal，确定性判分（防"自己出题自己判"）失效。建议回退 `previousState.confirmedProposal` + 补单测。

### 2.2 path
- **`adjustments`（用户"补充说明重新生成"）端到端不可达** 【已核实】：coordinator 侧有（`path.coordinator.ts:91,169,400,422`），但载荷**不渲染**（`path-planning/index.ts` 无 `adjustments`）→ 用户可见功能实际无效。
- **#30 与 #43 自相矛盾**（子代理报告）：#30"必须且只能恰好 targetMilestones 个" vs #43"只是建议值"；代码站 #43（区间优先）。⚠️ 修 #30 属**提示词类**，撞他人 WIP。
- **投影白名单丢字段**（子代理报告）：`buildPromptFriendlyNormalizedInput` 逐字段重建、无透传 → `understanding` 等被静默丢（本仓高频坑）。

### 2.3 stage
- **`loadTarget` 死链** 【已核实】：`parsePathCognitiveDesign` 只返回 `{cognitiveDomain, coreConcepts}`（`backend/src/services/learning/learning.helpers.ts:478-480`），**丢掉 `loadProfile`** → stage-designer 规则 #13（343 字）与 CLT 负荷调整在生产与重规划两处**永不生效**。
- **无资料时不核对 `materialRefs`** 【已核实】：`withMaterialRefs` 在无资料时直接 `return list`（`backend/src/skills/stage-designer/index.ts:132`）→ 模型**编造的引用会落库给学习者看**，违反"宁缺勿编"，与 path-planning 口径不一致。
- **资料重复投递**（子代理报告）：`normalizedInput.resources.materials`（全量）与顶层 `materials`（投影）同进载荷 → token 浪费 + "模型看到投影外内容却被核对丢弃"的口径不一致。

### 2.4 课堂
- **peer `loadIndex/emotionalState` 静默丢弃**（子代理报告）：`inputSchema` 与两个 caller 都传了，`buildPeerUserPayload` 完全不转发 → 提示词"高负荷/受挫 → 先共情"分支不可达。
- **peer JSON 合规失败 35 次** 【已核实·日志】：需在提示词/解析侧收敛（抽第一个平衡 JSON 块一类）。
- **opening 规则 7/8 逐字重复**（子代理报告）：同一段"quickReplies 必须与 mode 匹配"出现两次（169 字），删一份即可。
- **opening 条件规则识别不到**（子代理报告）：规则 10-13 以「输入提供 X 时」开头，而 teaching-turn 的判定正则是「若输入提供…」→ 0 条命中；要复用需改措辞 + 扩正则（预期 631 字）。
- **concept-consolidator 失败率高**（子代理报告）：近 7 天 165 次调用 93 次失败（34 次纯散文、11 次 JSON 截断）；另有 41 次 `CALLER_ABORTED`（**建议单独排查调用点，不算提示词缺陷**）。
- **adaptive-guidance-copy 声明与载荷键名不符**（子代理报告）：`inputs` 声明 4 个键，实际载荷 6 个；规则 6/8 的 `tasks.*`、`learningSignal` 路径需写全。

---

## 3. P2（可选，收益明确但不急）

- **条件规则机制推广**：见 §6 —— **两个子代理独立结论：不能照搬**。
- **声明漂移**：`stage-designer` 的 `inputSchema`/`definition.variableBindings`/`prompts/orchestration/path.yaml` 字段、`PAYLOAD_STABILITY` 的 stable 列表、`lesson-knowledge-enricher` 的 `transferGoal`。
- **`cognitive_bandwidth` 死路由**（goal→path 声明了但 path 不读）：接上或去掉路由。
- **`estimatedMinutes` 下沿不一致**：规则说取下沿（10），代码抬到 15。
- **`materialRefsByTask` 事务重试累积**：变量在事务外声明，重试不重置。
- **`adaptive-guidance-copy`**：pretty JSON（多 15-30% token）、"必须 3 条"无兜底、`failurePolicy` 声明与行为不符。
- **`goal-understanding-composer` 死代码清理**：`goalUnderstandingComposer`/`checkThin` 零调用；两处未用 import。
- **审计/评估脚本锚点过期**：`scripts/check-data-source.ts` 指向旧行号；`routes/admin/prompt-ops.ts` 的 stage-designer 评估 payload 缺 materials/loadTarget。
- **测试缺口**：见各节点（path 的 `coercePathPlanningParsed`/`buildPathValidationRepairNotice` 零测试；stage 无 loadTarget 集成测试、无"无资料删除 refs"测试；peer 无字段契约集成测试）。

---

## 4. 明确不要改（避免过度改动）

- **goal**：不要把条件规则机制搬到 goal（3 个输入恒存在，无可门控键，收益 <100 字）；`proposalQuality` 的静默丢弃是**已登记豁免**（只驱动 reply）；**不要**删规则 #22/#23/#26 的"hidden/静默/不宣布"重复措辞（是对高泄漏风险字段的有意强化）；**不要**把 `understanding` 平铺化。
- **path**：载荷排序/KV 前缀（单次快照调用，无问题）；`normalizeOutput` 的 `{...milestone}` 展开；`coerce` 与 `normalizeOutput` 双重 materialRefs 核对（有意为之）；状态驱动 replan 的 `learnerReplanProjection`（链路正常）；material 投影与逐字核对实现。
- **stage**：`constraints: []` + 编译器注入 JSON 条款（**设计如此**，不要手动加第二条）；`normalizeSubtasks` 带 `materialRefs`（正确，只需修无资料分支）；`clampStageTasksToHints` 只裁上界（"给少可逆、给多荒谬"）；混合规则 #8/#10/#17 **不要整条当条件规则剥离**。
- **课堂**：`goal-understanding-composer` 的纯函数（被真实消费，`sanitizeUnderstanding` 透传未知键正确）；opening 的 `coerceTextOptions/coerceParse/validate` 容错；consolidator 的代码护栏（`canonical ⊆ candidates`、`MIN_CONFIDENCE=0.8`）；peer 的"失败抛错"契约（caller 已 try/catch 容错）；四个 skill 的 KV 首键接线。

---

## 5. 边界：不能碰的（他人 WIP）

工作区是**共享的**，以下正在被别人修改，**本轮不得触碰**：

- `prompts/core/path-planning.yaml`、`prompts/skill.path-planning.md`
- `prompts/core/stage-designer.yaml`、`prompts/skill.stage-designer.md`
- `prompts/core/session-wrapup.yaml`、`prompts/skill.session-wrapup.md`
- `backend/src/services/learning/path-planning-hints.ts`、`backend/src/services/learning/learning-state.service.ts`
- `backend/src/services/ai-teaching/TeachingContextBuilder.ts`、`backend/src/services/ai-teaching/ReplanAdvisoryService.ts`

⇒ path/stage 的**提示词类**修复（如 path 的 #30/#43、stage 的 #9/#13/#18 措辞）**要绕开**；代码类修复（`agent-contract-view.ts` / `learning.helpers.ts` / `stage-designer/index.ts` / `goal-conversation.service.ts`）都在干净文件里。

---

## 6. 待拍板

1. **goal 的 advisory 口径**：平台把"主因偏情绪/信心"写进用户可见文本，与提示词"不向用户宣布"反向冲突。**建议**：advisory 只落库/遥测，不进 `userVisible`（与 hidden 纪律一致，且不改提示词）。
2. **条件规则机制是否推广**：**不建议照搬**。两个子代理独立验证：LEAD 正则按 teaching-turn 措辞定制，硬套会「剥了却永不注入」（path 的 #8/#9/#38 抽不出 key；stage 的 #9 抽出错误 key）＝净丢规则。要推广必须先抽公共模块 + 规范化各 skill 的条件规则措辞 + 逐 skill 写 override，属独立工程。

---

## 7. 验证方式（改动后）

1. **门禁**：`prompts:core:check`（coreHash parity）、`prompts:fields-sync:check`、`prompts:check-handoff`（先 advisory 再 strict）、`prompts:check:all`。
2. **单测**：各 skill 的 `__tests__` + 新增用例（见各条修法）；快照类改动需人工核对 diff，**不要盲 `-u`**。
3. **端到端**：`probe-material-path-e2e.ts` / `replay-path-planning.ts` / 真实课堂探针；核对 `materialRefs` 命中数与载荷体积变化。
4. **观测**：`prompt_call_logs` 里 `SKILL_PEER_REINFORCEMENT_FAILED`、`PATH_PLANNING_*` 失败门比例。

---

## 8. 附：teaching-turn 已落地的同类修复（可作参照）

本轮之前已在 `teaching-turn` 完成、可复用的经验：

| 修复 | 内容 |
|---|---|
| **配图 P0/P1** | 生图请求合规（url 形态不发顶层 `response_format`；b64 仍走顶层——实测本网关忽略 `extra_body`/`return_base64`）；**精确尺寸代码裁决**（实测本网关忽略 `size:'1K'+ratio`，`1312x736` 在透传开/关都生效，冲突时 size 胜）；每任务**代码硬闸门** |
| **A 项 · 条件规则按需注入** | 13 条条件规则（3,078 字 = 执行规则段 21.7%）从 system 剥离，按输入存在性注入**载荷尾部**（`conditionalRules`）；system 保持稳定 → 不破坏 KV 前缀缓存；实测注入 9/13、省 858 字/回合 |
| **evidence 逐字校验** | 误解台账 `evidence` 必须是学生本轮原话的逐字片段，否则**整条丢弃**（照 `material-refs.ts#isQuoteVerbatim` 先例） |

**共同教训**：能落到代码的约束就不要只写在提示词里（模型会绕过）；逐字段白名单是静默丢字段的高发区；提示词改动必须走"单点编译 + sync"，否则运行时不变。
