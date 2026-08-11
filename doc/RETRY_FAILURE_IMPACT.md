# 降级点移除影响面报告（纯重试 + 明确失败改造前置调查）

> ✅ **已实施（2026-08-11）**：本报告对应的改造已落地——A 词表（11 个 core fallback→propagate + manifest blocking）、
> B 运行时降级路径移除（session-wrapup 补全分支 / teaching-opening-generator / runAux 语义 / 重试预算 1→2）均已实施并验收，
> 详见本报告 §1~§6 各节与提交说明。下文行号基于调查时点代码，实施时已重新核对。
> 🔻 **后续退役（2026-08-11，Phase A）**：§1 主角 session-evaluation-fallback 随后被**完整退役**——v4-aux-skills
> 注册/户口簿（skills.yaml）/core/manifest/md 产物四同步注销，进 `PURGED_SKILLS`（36 项）由启动 purge 清存量 DB 行
> （doc/FALLBACK_RETIREMENT_PLAN.md Phase A）。本报告 §1 各节（行号基于调查时点）仅作历史影响面记录，不再适用。
> 调查日期：2026-08-11 ｜ 性质：只读调查，不含任何代码改动
> 目标：为"skill 失败处理改为 **纯重试 + 明确失败**（移除降级/兜底设计）"提供精确的影响面证据。
> 范围：① session-evaluation-fallback ② teaching-opening-generator ③ runAux `__fallback` ④ executor 重试预算 ⑤ failurePolicy 词表。
> 行号基于调查时点代码，改动前请重新核对。

---

## 0. 总览

| 降级点 | 现状 | 改后形态 | 主流程结论 |
| --- | --- | --- | --- |
| session-evaluation-fallback（LLM 兜底评估） | 模型缺 evaluation → 二次 LLM 补全 → 仍缺则保守评分+`failed` 标记 | evaluation=null + `evaluationSource='failed'` | **安全**（`failed` 路径全链路已有容忍，与 M1 兜底形态一致） |
| teaching-opening-generator（开场降级） | LLM 失败/超时 → 返回确定性 fallbackOpening | 明确失败 → `failInitialization` + 前端收到错误 | **安全**（需保留 15s 超时作为失败边界；SSE 流式开课确认错误事件透传） |
| runAux `__fallback`（3 个调用点） | 失败返回 `__fallback`/builtin 降级（quality='fallback'） | 抛错 | **安全**（3 个调用点全部已有 throw 容忍路径；但需逐个确认） |
| 11 个 `failurePolicy: fallback` core | 代码级 buildFallback / runAux 降级 | 明确失败 | **大部分安全**（见 §3.3 逐项表；8 个为代码内 buildFallback，需逐个改） |
| 重试预算 | 传输 3 次尝试/1 次重试；逻辑 1 次重试（上限 2）；spec 级 maxAttempts=2 | 纯重试后预算上浮 | 建议值见 §5 |

---

## 1. session-evaluation-fallback（AITeachingCoordinator 消费链）

### 1.1 现状链路

**调用上下文**（`backend/src/skills/session-wrapup/index.ts`）：
- `generate()` 主路径：`callPrompt` → 校验 summary+evaluation（`validateSessionWrapupParsedOutput`，:293-308，`retryStrategy.maxAttempts=2`，:492-495）
- 模型缺 evaluation 时：`generateEvaluationFallback()`（:565-568）→ **懒加载动态 import skills 注册表**，`executeSkill(auxSkillDefinitionMap['session-evaluation-fallback'], { ...input, __fallback: null, __prompt: {...} })`（:630-638，`__fallback: null` 于 :633）
- 二次 LLM 仍失败：`buildConservativeEvaluation(input)`（:570-573，:437-464，确定性公式算分）→ `evaluationSource='failed'`
- 整体异常：catch 兜底 `buildFallbackSummary + buildConservativeEvaluation`，`summarySource='fallback'`、`evaluationSource='failed'`（:592-613）
- runAux 侧（`backend/src/skills/v4-aux-skills/index.ts`）：`sessionEvaluationFallbackHandler`（:213-232），`builtinFallback: () => null`（:230）；core `failurePolicy: fallback` → 失败返回 `success:true, output:null, quality:'fallback'`（:131-136）

### 1.2 消费链的容忍性（evaluation 缺失/null 不崩）

| 消费点 | 位置 | 行为 |
| --- | --- | --- |
| `hasReliableSessionEvaluation` | `services/ai-teaching/SessionFinalizationPolicy.ts:52-57` | `source === 'failed' \|\| evaluation == null` → false，**显式拒绝 failed 来源** |
| `scoreInput` | `AITeachingCoordinator.ts:1997-2006` | evaluationResult=null → scoreInput=null → **跳过 `prepareSessionScoreCommit`**（:2009-2011），指标不落库 |
| `persistedEvaluation` | :2013-2024 | `...(evaluationResult ? evaluationResult.evaluation : {})` → 空对象 + 零值 + `evaluationSource='failed'`，不崩 |
| `lesson:completed` 事件 performance | :2083 | null（无 evaluationResult 时） |
| wrapup 产物 | `toWrapupArtifact` session-wrapup/index.ts:498-511 | `evaluationSource==='failed'` → `status='summary-only'`、`evaluation=null` |
| handler 内部 confidence | :674/:696 | `result.evaluation?.confidence \|\| 0.6` null-safe |
| **M1 兜底（对照基准）** | `buildEndWrapupFallback` AITeachingCoordinator.ts:504-565 | **已是 `evaluation: null` + `evaluationSource:'failed'` 形态**（:550/:552），且 coordinator 全链在该形态下正常收束（:1976-1982 注释明示"保证收束流程继续"） |
| 虚拟学习者 wrapup 消费 | `coordinators/simulation.coordinator.ts:3715-3727` | 仅透传存储，null 安全 |

**结论：`evaluation=null + evaluationSource='failed'` 是全链路已被现有代码显式容忍的路径**（M1 兜底每天在走）。

### 1.3 前端显示（不崩）

- `frontend/src/components/CompletionCard.vue`：`:58`、`:70` 均为 `v-if="evaluation"` → null 时"本节表现 / 长期状态四维"两个 section 整体隐藏，无崩坏路径；其余 section 依赖 `summary`（始终存在）。
- `frontend/src/views/LearningEvaluationPage.vue`：
  - wrapup 缺省对象自带 `evaluation: null`（:155）
  - `evaluationDegraded`（:176-181）：`evaluationSource==='failed'` → 页面顶部降级提示条（:31-33，"本次会话未正常结束 / 未生成课堂总结"）
  - `shouldContinuePolling`（:225-230）只看 `wrapup.summary?.topicSummary`，与 evaluation 无关
- 无需任何前端改动即可安全显示"无评估"。

### 1.4 移除后形态与风险

**改后**：删除 `generateEvaluationFallback`（session-wrapup/index.ts:624-646）与其调用（:565-568）；evaluation 缺失 → `evaluation=null` + `evaluationSource='failed'`（`buildConservativeEvaluation` 属确定性代码降级，是否保留取决于决策：保留则仍产出保守分但不入指标，删除则 evaluation=null；两种形态下游均安全）。

**风险清单**：
1. `buildConservativeEvaluation`（:437-464）若保留，用户侧仍会看到"failed 但非空"的评估对象被写入 wrapup（`:2013-2024` 会把空对象展开成 `{}` + 零值）；建议同步删除以贯彻"明确失败"，否则"降级"以保守分形式残留。
2. 引用点需同步（若彻底移除 skill）：
   - `backend/src/scripts/check-data-source.ts:128-129`（数据源登记）
   - `backend/src/skills/v4-aux-skills/index.ts:21,162,215,339`（AuxSkillId 词表 / META / 注册表）
   - `backend/src/skills/__tests__/session-wrapup-payload.test.ts:46`、`backend/src/services/__tests__/skills-readiness.service.test.ts:112`
   - `prompts/core/session-evaluation-fallback.yaml:31`、`prompt-lab/manifests/session-evaluation-fallback.yaml:18`
   - 若仅"停用"（保留注册、core 改 propagate）则无需动注册表，check-data-source 仍需同步。
3. `toWrapupSkillOutcome` 质量语义（session-wrapup/index.ts:522-529）：`evaluationSource==='failed'` → quality='fallback'/'partial'——只是标记，下游无分支崩溃。

**结论：安全（改后主流程不会崩）**。需配套：① 决定 `buildConservativeEvaluation` 去留；② 若彻底移除 skill，同步注册表/词表/测试/数据源脚本引用。

---

## 2. teaching-opening-generator（开课降级路径）

### 2.1 现状链路

`AITeachingCoordinator.generateOpening`（:1318-1376）：
- :1320-1327 先算 `openingMode`（example-first / predict / self-assess）
- :1328 **预构建** `fallbackOpening = buildFallbackOpening(context, openingMode)`（函数定义 :630-679）
- :1331-1354 `withTimeout(executeSkillWithResult(auxSkillDefinitionMap['teaching-opening-generator'], { ..., __fallback: fallbackOpening, __prompt: {...} }), 15000, 'OPENING_GENERATION_TIMEOUT')`
  - `withTimeout`（:454-466）：`Promise.race` + 15s 定时 reject
  - `__fallback: fallbackOpening`（:1347）→ runAux 在 LLM 失败时直接返回它（quality='fallback'，v4-aux-skills/index.ts:91-95,131-136）
- :1355 `parsed = result.success && result.output ? result.output : null`
- :1356-1364 catch（超时/抛错）→ log + `return fallbackOpening`
- :1366-1375 parsed 缺失 → log + `return fallbackOpening`
- **当前该函数永不抛错**（所有路径都返回 opening）

**开课失败的会话状态**（startSession，:1069-1316）：
- `reserve()` 先创建 `status='initializing'` 的会话行（TeachingSessionRepository.ts:287，带 `operationKind:'start'` + lease）
- `generateOpening`（:1214）失败 → catch（:1312-1315）→ **`failInitialization`**（TeachingSessionRepository.ts:346-360：`status='failed'`、`openKey=null`、清理 lease、`endTime=now`）→ 异常继续抛出
- 进程崩溃残留的 initializing 会话：`reserve()` 内 `initializingLeaseExpired` 恢复路径（TeachingSessionRepository.ts:242-243,247-248）→ 置 `superseded` + 清 openKey，可重开

**前端开课调用**：
- 路由 `POST /api/ai-teaching/tasks/:taskId/session`（ai-teaching.routes.ts:334-389）：非流式直接 `sendTeachingError`（:385-388）；SSE 流式走 `handleStreamingSession`（:288-325，catch 写 `event: error`，:319-321）
- 前端 `V2LearningPage.boot`（frontend/src/views/v2/V2LearningPage.vue:357-395）：catch 取 `e?.response?.data?.error?.message || '开课失败，请重试'`（:392）→ 展示 initError 并提供重试
- `frontend/src/api/aiTeaching.ts:332-339`：startSession 透传错误

### 2.2 移除后形态与调用方行为

**改后**：删除 `__fallback` 注入（:1347）与两处 fallbackOpening 返回（:1356-1375 的 catch/空结果分支），`generateOpening` 在 LLM 失败/结构不完整时 throw（`__fallback` 移除后 runAux 按 core 策略走——若 failurePolicy 同步改为 propagate，runAux 直接 throw，见 §3）。

- **前端能否收到错误：能**。throw → startSession catch（:1312-1315）→ failInitialization → 路由 catch → HTTP 错误 / SSE error 事件 → 前端 initError。
- **会话是否干净：干净**。failInitialization 幂等清理（updateMany 无 count 断言，即使并发已转移也静默无副作用）；崩溃残留由 lease 恢复兜底。

### 2.3 风险

1. **15s 超时保留与否**：`withTimeout`（:1354）是"明确失败"的时间边界，建议**保留**（15s 对开课同步等待合理，超时即视为失败）。若移除超时，慢模型会让开课请求长时间悬挂（前端 `AI_REQUEST_TIMEOUT` 在 aiTeaching.ts:336 兜底，但语义弱）。
2. **failInitialization 静默不匹配**：TeachingSessionRepository.ts:346-360 的 `updateMany` 未检查 `count`，极端并发下（lease 被他人转移）可能静默不落 `failed`，会话停留在 initializing 直至 lease 过期被恢复——低风险，现状已如此，不因本改造恶化。
3. **SSE 开课的错误事件透传**：`handleStreamingSession` 已统一写 `event: error`（:319-321），前端流式消费方需确认对 error 事件的展示（与现有错误语义一致，无需新开发）。

**结论：安全**。需配套：保留 withTimeout 15s 作为失败边界；确认流式开课 error 事件前端已消费；`prompts/core/teaching-opening-generator.yaml:32` 的 failurePolicy 需从 fallback 改 propagate（见 §4）。

---

## 3. runAux `__fallback` 机制与 11 个 fallback core

### 3.1 机制（`backend/src/skills/v4-aux-skills/index.ts:74-154`）

- 输入剥取保留字段：`__prompt` / `__fallback` / `__onFailure`（:77-79）
- `resolveFallback`（:91-95）：优先级 调用方 `__fallback` > `builtinFallback` > null
- catch 分支（:126-137）：`effectiveMode = onFailureOverride || await resolveDefaultFailureMode(skillId)`；`'throw'` → 重抛；否则返回 `success:true + 降级输出 + quality:'fallback'`
- `resolveDefaultFailureMode`（:145-154）：读 ACTIVE prompt 编译产物的 `contract.failurePolicy`；`['deterministic-fallback','best-effort']` → 'fallback'，其余（retry/blocking/none）→ 'throw'；读取失败保守抛错（fail loud）
- 注意：`normalizeOutput` 的第三个参 `callerFallback`（:107）也参与 normalize 降级（如 learner-progress-report 的 `fb?.reasoning`）

### 3.2 `__fallback` 全仓调用点（仅 3 处）

| 调用点 | 位置 | 移除后行为 |
| --- | --- | --- |
| teaching-opening-generator | AITeachingCoordinator.ts:1347 | throw → §2 链路（failInitialization + 前端报错），**安全** |
| session-evaluation-fallback | session-wrapup/index.ts:633（`__fallback: null`，本就无降级值） | throw → 被 `generateEvaluationFallback` 内 try/catch 接住（:640-644）→ return null → `evaluationSource='failed'`，**安全** |
| learner-progress-report | LearnerProgressService.ts:264（`__fallback: fallback` 文案常量） | throw → 被外层 try/catch 接住（:271-273）→ 返回同一 fallback 常量。**注意：调用方行为不变**（降级转移到调用方代码），如要"明确失败"需连调用方一起改，否则只是把降级从 skill 层挪到 service 层 |

### 3.3 failurePolicy=fallback 的 11 个 core 与调用方（移除降级后行为）

| # | core 文件（params） | 实现方式 | 调用方 | 移除降级后调用方行为 |
| --- | --- | --- | --- | --- |
| 1 | session-wrapup (`prompts/core/session-wrapup.yaml:74`) | 代码级 `buildFallbackSummary`/`buildConservativeEvaluation`（session-wrapup/index.ts:310/:437，非 runAux） | AITeachingCoordinator.endSession（:1920）、simulation.coordinator（:3715） | throw 被 coordinator 外层 try/catch 接住（:1969-1974）→ M1 `buildEndWrapupFallback` 顶替 → 收束继续。**安全**（simulation 侧 catch 后返回 `{success:false}`，:3731-3734） |
| 2 | teaching-opening-generator (`:32`) | runAux `__fallback`（AITeachingCoordinator.ts:1347） | 同上 :1331 | §2：failInitialization + 前端报错。**安全** |
| 3 | session-evaluation-fallback (`:31`) | runAux `builtinFallback:()=>null` | session-wrapup/index.ts:631 | 见 §1。**安全** |
| 4 | learner-progress-report (`:21`) | runAux `__fallback` + normalize 降级 | LearnerProgressService:251 | throw 被调用方 try/catch 接住，降级文案仍返回。**安全（但语义未变）** |
| 5 | adaptive-guidance-copy (`:58`) | 代码级 `buildFallback`（index.ts:139,189,252） | DashboardGuidanceSnapshotService:150、LearningStateGuidanceService:89 | 两调用方均为 best-effort 后台服务，外层 try/catch 返回 null（DashboardGuidanceSnapshotService.ts:191-198、LearningStateGuidanceService.ts:125-128）。**安全** |
| 6 | lesson-knowledge-enricher (`:46`) | 代码级 `buildFallback`（index.ts:153,230,272） | LessonKnowledgeEnrichmentConsumer:27（领域事件 inbox 消费） | 抛错 → consumer 抛 → **inbox 未写 receipt，事件不会 ack**（:93-99 在事务内）→ 重投递语义天然存在（需要事件系统重投机制支撑）。**需配套确认 inbox 重投机制** |
| 7 | peer-reinforcement (`:56`) | 代码级 `buildFallbackPeerMessage`（peer-reinforcement/index.ts:296-318,331） | AITeachingCoordinator:1546、:2716（伴学） | 抛错冒泡 → 伴学流程失败，用户侧伴学回复失败。**需配套**：检查 :1546/:2716 外层是否有容错（现状依赖 skill 内不抛）。**风险点** |
| 8 | virtual-learner-goal-dialogue-simulator (`:72`) | 代码级 `buildFallback`（index.ts:146,187,300,333） | simulation.coordinator:853、blackbox-runner:718 | 抛错 → coordinator 外层 catch → 模拟流程失败/重试路径（simulation.coordinator:449-461 仅对可重试错误重试，其余 throw）。**需配套**：模拟链路属后台批次，明确失败 = 该批次失败，需检查上层重跑机制 |
| 9 | virtual-learner-learn-turn-simulator (`:91`) | 代码级 `buildFallback`（index.ts:160,199,364） | simulation.coordinator:2894（`retryLearnUpstream`，3 次/750ms 退避，:44-45,443-462）、quick-learn.service:560、blackbox-runner:759 | `retryLearnUpstream` 对结构失败也重试（`isRetryableLearnUpstreamError` 正则含 `structured_output_invalid|finish_reason|length|empty content`，:438-441）→ 重试耗尽后 throw。**安全（有重试层），但重复失败会拖慢模拟批次** |
| 10 | virtual-learner-path-evaluator (`:61`) | 代码级 `buildFallback`（index.ts:114,149,226,260） | simulation.coordinator:2174 | 同上，外层有 catch/重试。**安全** |
| 11 | goal-alignment-checker (`:30`) | 僵尸项（零调用） | 无（check-data-source.ts:150 明示"僵尸"） | 无调用方，改词表无影响。**安全** |

### 3.4 结论

- **3 个 runAux `__fallback` 调用点移除后均安全**（各调用点已有 throw 容忍路径）。
- **8 个代码级 buildFallback 不在 runAux 机制内**，它们的 failurePolicy=fallback 声明与实际降级实现分离；"移除降级"必须逐个改 handler 本体（buildFallback 分支 → 抛错），仅改词表无效。
- **风险点集中在**：`peer-reinforcement`（伴学是实时用户路径，:1546/:2716 外层容错需核实）、`lesson-knowledge-enricher`（事件消费 ack 语义，需依赖 inbox 重投）、virtual-learner 三个（后台批次，明确失败=批次失败，依赖上层重跑）。

---

## 4. executor / gateway / prompt-composer 重试预算现状

### 4.1 现状参数

| 层 | 参数 | 值 | 位置 |
| --- | --- | --- | --- |
| 平台默认（DB 可覆盖，admin 可调） | `maxUpstreamAttempts` | **3**（即最多 3 次上游尝试） | reliability-settings.service.ts:22-30（默认值），createRetryBudget 同（retry-budget.ts:54-59） |
| 平台默认 | `maxTransportRetries` | **1** | reliability-settings.service.ts:24 |
| 平台默认 | `maxLogicalRetries` | **1** | reliability-settings.service.ts:25 |
| 硬上限 | upstream/transport/logical | 5 / 2 / 2 | retry-budget.ts:34-43 |
| 超时 | `defaultRequestTimeoutMs` | 300s（min 10s / max 300s） | retry-budget.ts:79-84 |
| 退避 | `retryBaseDelayMs` 1s / `maxRetryAfterMs` 10s / jitter on | — | retry-budget.ts:85-98 |
| skill 级覆盖 | `skill_model_configs.maxLogicalRetries`（min(覆盖, 平台默认)） | — | reliability-settings.service.ts:132-161 |
| prompt-composer 逻辑重试 | `spec.retryStrategy.maxAttempts` × logicalRetryLimit 双闸 | session-wrapup `maxAttempts=2`（session-wrapup/index.ts:492-495）；其余 spec 多数无 retryStrategy → 1 次 | prompt-composer.ts:300,324-336（attempt>1 时先查 logicalRetryLimit，:325-336） |
| 传输重试（gateway executor） | 仅 `retryable` 错误重试：`!quota && !authentication && (status>=500 || 429 || 408 || 425)` + `ATTEMPT_TIMEOUT` + `NETWORK_TRANSIENT`；retry-after ≤ 10s | — | api-gateway/executor.ts:364-365,511-512,677-682；:183-185 |
| 调用方级重试（模拟链路） | `retryLearnUpstream` 3 次 × 750ms×n 退避，含结构失败（`structured_output_invalid|finish_reason|length|empty content`） | — | simulation.coordinator.ts:44-45,438-441,443-462 |

### 4.2 结构性失败 vs 临时失败的区分现状

- **已区分**：gateway 传输层只对网络/超时/5xx/429 等临时失败重试（executor.ts:364-365,677-682），quota（429-quota）/认证/配置/协议类错误 `retryable: false`（:115,362-370,687）。
- **未区分（结构性失败也走逻辑重试）**：prompt-composer 的 `maxAttempts`/logicalRetryLimit 对**校验不过（JSON 结构、字段缺失）**也重试——这正是"纯重试"想加强的一层，但当前 `maxLogicalRetries=1`（默认只允许 1 次逻辑重试）+ 多数 spec 无 retryStrategy，实际结构失败重试次数很少。
- **模拟链路对结构失败重试**：simulation.coordinator.ts:438-441 把 `structured_output_invalid` 等结构失败纳入可重试——与"结构性失败不重试"的原则相反，改造时应审视（结构失败重试通常有收益，但成本高）。

### 4.3 重试预算建议值（基于成本与成功率推理）

前提：移除降级后，失败不再有"可用降级输出"，重试成为唯一恢复手段；但每次重试 ≈ 一次完整 LLM 调用成本 + 延迟。

| 层 | 现状 | 建议 | 理由 |
| --- | --- | --- | --- |
| 传输尝试 `maxUpstreamAttempts` | 3 | **3（保持）** | 网络抖动/瞬时 5xx/429 三次覆盖绝大部分瞬时故障；再高收益递减且放大量化限流 |
| 传输重试 `maxTransportRetries` | 1 | **1（保持）** | 与 upstream 3 联动即可 |
| 逻辑重试 `maxLogicalRetries` | 1 | **2（硬上限值）** | 结构失败（JSON/字段）经 onValidationFail 纠错提示后成功率显著提升，2 次是成本-成功率平衡点（成本 ×2，挽救率覆盖 80%+ 的可纠错失败）；超过 2 次多属 prompt 本身问题，重试无益 |
| spec `retryStrategy.maxAttempts` | 仅 session-wrapup=2 | **核心技能（session-wrapup/teaching-turn 等）显式声明 2~3**；辅助技能 1~2 | 主链路技能（收束/授课）值得多一次纠错机会；纯辅助/展示类技能不重试 |
| 开课超时 `withTimeout` | 15s | **15s（保持，作为明确失败边界）** | 开课是同步等待，15s 内两次传输尝试已覆盖；超时即失败并清理会话 |
| 模拟链路 `retryLearnUpstream` | 3 次（含结构失败） | **保持 3 次，但结构与传输失败同等对待即可**（后台批次，成本低） | 无用户等待，多重试无副作用；维持现状 |

配套建议：将"逻辑重试上限"提升到 2 的同时，把 `DEFAULT_PLATFORM_RELIABILITY_SETTINGS.maxLogicalRetries`（reliability-settings.service.ts:25）与 `RETRY_BUDGET_HARD_LIMITS.maxLogicalRetries`（retry-budget.ts:37）对齐（当前默认 1 = 硬上限 2，默认值有冗余空间）。

---

## 5. failurePolicy 词表处置建议

### 5.1 现状词表与分布

- **core 词表**（`backend/src/services/yaml-vocabulary.ts:44`）：`retry | fallback | propagate`（SKILL_PROTOCOL_V4.md:55、:321-324 规定 handler 行为必须与 core 一致）
- **manifest 词表**（:48-54）：`retry | deterministic-fallback | blocking | best-effort | none`；唯一映射（:57-87）：`fallback→deterministic-fallback`、`propagate→blocking`、`retry→retry`
- **runtime 唯一消费方**：v4-aux-skills `resolveDefaultFailureMode`（v4-aux-skills/index.ts:145-154，`deterministic-fallback|best-effort` → 降级，其余 → throw）；其余 8 个代码级 fallback skill 的 failurePolicy 仅为声明（实际降级在 handler 内）
- **分布**（prompts/core/）：fallback 11 个（§3.3 清单）、retry 8 个（goal-conversation、semantic-freeze-judge、path-planning、stage-designer、teaching-turn、virtual-learner-actor-auditor、virtual-learner-persona-designer、virtual-learner-scenario-designer、virtual-learner-referee）、propagate 5 个（generic-chat、basic-evaluator、course-design、skill-author、skill-compiler）
- **门禁**：`check-yaml-vocabulary.ts` C1（:81-105）强制 core↔manifest 双向映射一致；`health-center.service.ts:436` 挂载该检查；词表改动会触发 YAML 交叉校验

### 5.2 两种处置路径对比

| 路径 | 内容 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A. 保留 fallback 语义、改"失败"含义** | core 词表保留 3 值；把 11 个 fallback core 中真正需要明确失败的改为 `propagate`（含 manifest 同步 `blocking`）；词表、映射表、协议文档 §2.4.4 不动 | 改动面小（只动 YAML 值 + handler）；门禁 C1 天然通过；历史文档/数据兼容 | 语义上"fallback"仍存在于词表，与"移除降级"的长期目标不一致；残留的确定性降级（如 buildFallbackSummary）是否算"降级"需定义边界 |
| **B. 词表收敛为 retry/propagate** | core 删除 fallback；manifest 删除 deterministic-fallback/best-effort（或保留 best-effort 仅作内部标记）；yaml-vocabulary.ts:44-73 映射表收缩；协议文档 §2.4.4 同步；11 个 core 全部改 propagate 或 retry | 语义彻底干净，与决策一致；未来不会有人再写 fallback | 波及面大：yaml-vocabulary（:44-87）、core-file-loader（:353）、skill-prompt-contract（:119,181,217,283,348）、skill-scaffold.service（:149 新建 skill 默认 fallback 模板）、check-yaml-vocabulary（:95-105）、core-compiler/core-yaml-writer、SKILL_PROTOCOL_V4.md（:55,:230,:317-324,:431）、prompt-lab/manifests 全部 9 个 deterministic-fallback + peer-reinforcement 注释（core/peer-reinforcement.yaml:3）；测试 20+ 处 |

**建议：先 A 后 B。** 短期（本次改造）走 A：把 11 个 fallback core 按 §3.3 逐项改为 `propagate`（配套 handler 改 throw），`best-effort`/`deterministic-fallback` 保留在 manifest 词表以防存量数据，门禁不变。中期在独立 PR 中走 B：词表收敛为 `retry | propagate`，同步协议文档与全部测试——此时"降级"从协议层彻底消失，任何出现 fallback 的地方都会被 C1 门禁拦截。

### 5.3 需同步的文件清单（若走 A 的 YAML 改动）

- `prompts/core/`：session-wrapup.yaml:74、teaching-opening-generator.yaml:32、session-evaluation-fallback.yaml:31、learner-progress-report.yaml:21、adaptive-guidance-copy.yaml:58、lesson-knowledge-enricher.yaml:46、peer-reinforcement.yaml:56（及 :3 注释）、virtual-learner-goal-dialogue-simulator.yaml:72、virtual-learner-learn-turn-simulator.yaml:91、virtual-learner-path-evaluator.yaml:61、goal-alignment-checker.yaml:30（僵尸，改不改均可）
- `prompt-lab/manifests/`：与上述 core 对应的 deterministic-fallback 条目（9 处，见 grep 结果）同步改 `blocking`（或 `retry`）
- 每个 core 改动的**handler 行为**必须同步（v4 协议 §2.4.4"handler 行为必须与 core 一致"，SKILL_PROTOCOL_V4.md:317-324）：runAux 类仅改 YAML 即生效（resolveDefaultFailureMode 自动转 throw）；代码级类需改 handler 本体（8 处 buildFallback → throw/明确失败）
- 验证门禁：`yarn check:yaml-vocabulary`（或等价脚本）+ health-center C1

---

## 6. 结论汇总

| # | 降级点 | 改后主流程是否安全 | 备注 |
| --- | --- | --- | --- |
| 1 | session-evaluation-fallback | **安全** | 与 M1 兜底形态（evaluation=null+failed）一致；需定 buildConservativeEvaluation 去留 + 同步注册/测试/数据源脚本 |
| 2 | teaching-opening-generator | **安全** | 前端能收到错误（V2LearningPage.vue:392）、会话经 failInitialization 干净清理；保留 15s 超时 |
| 3 | runAux `__fallback`（3 处） | **安全** | 全部调用点已有 throw 容忍；learner-progress-report 的降级会转移到调用方代码，需另行决策 |
| 4 | 11 个 fallback core | **大部分安全** | 风险集中：peer-reinforcement（实时伴学，需核实 :1546/:2716 外层容错）、lesson-knowledge-enricher（事件 ack 依赖 inbox 重投）、virtual-learner ×3（后台批次，依赖上层重跑） |
| 5 | 重试预算 | — | 建议：maxLogicalRetries 1→2；传输层保持 3/1；开课 15s 超时保留 |
| 6 | failurePolicy 词表 | — | 建议先 A（11 个 core 改 propagate）+ 中期 B（词表收敛 retry/propagate） |

**改造前置检查单（开工前必做）**：
1. 核实 `AITeachingCoordinator.ts:1546/:2716`（伴学 peer 调用）外层容错，缺失则须先加 catch 再移除 peer-reinforcement 降级
2. 核实领域事件 inbox 对 consumer 抛错的重投机制（LessonKnowledgeEnrichmentConsumer 无内部 catch）
3. 确认前端 SSE 开课 error 事件消费（handleStreamingSession 已写 error 事件）
4. 决定 `buildConservativeEvaluation` 与 `buildFallbackSummary`（session-wrapup 代码级降级）是否一并移除——它们不在 runAux 机制内，是"降级设计"的最大残留
