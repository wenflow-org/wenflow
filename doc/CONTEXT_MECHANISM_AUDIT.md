# 上下文机制审计与优化方向（Context Mechanism Audit）

> 状态：**现行**（2026-09-14）
> 范围：goal / path / teaching / profile / simulation 五阶段 skill + aux 的**上下文机制**
> 数据来源：`backend/prisma/dev.db` 真实调用遥测（`llm_execution_attempts` × `prompt_call_logs`）
> 关联：[`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)（§2.5 输入契约 / §3 材料池 / §5 运行时链路）、[`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)

---

## 0. 结论（TL;DR）

1. **输入体积不是瓶颈**。实测 12,537 次真实调用：平均 input **10,646** tokens、p50 6,886、p90 25,780、p99 59,016、max 89,086 —— 远低于当前模型 1M 上下文。
2. **40k 压缩窗口是"百轮级安全阀"，实际几乎不触发**（`TeachingContextCompressionService` 注释即写「此前 1M 实际永不触发」；实测 teaching-turn p90 仅 33k、max 41k ≈ 阈值）。
3. **真正的成本杠杆是前缀缓存命中率**：全局仅 **20.9%**；**前 4 个 skill 占全部 miss 的 87%**。
4. 优化应聚焦 **「稳定前缀前置 + 动态内容后置」**（复刻 goal/path 的做法），以及 `adaptive-guidance-copy` 的 **90KB 动态 payload** 缩减——它命中率只有 **1.8%**，缓存救不了，只能缩。

---

## 1. 实测数据

### 1.1 方法
- 口径：`llm_execution_attempts`（每次上游尝试，含 `promptTokens` / `promptCacheHitTokens` / `requestBytes` / `resolvedModel`）按 `promptCallId` join `prompt_call_logs`（含 `agentId`）。
- 样本：`promptTokens > 0` 的尝试，共 **12,537** 条；时间跨度约 2026-07 ~ 2026-09。
- 模型：`deepseek-v4-flash`（12,529）/ `deepseek-v4-pro`（8）。

### 1.2 输入体积（per skill，tokens）

| agent | 调用 | avg | p50 | p90 | max | avg user |
|---|---:|---:|---:|---:|---:|---:|
| skill:adaptive-guidance-copy | 639 | 41,013 | 41,537 | 67,445 | **89,086** | 90KB |
| skill:teaching-turn | 2,400 | 22,040 | 21,374 | 33,150 | 40,975 | 37KB |
| skill:virtual-learner-learn-turn-simulator | 2,570 | 9,801 | 10,005 | 13,059 | 16,949 | 18KB |
| skill:lesson-knowledge-enricher | 158 | 9,101 | 8,163 | 14,957 | 17,927 | 20KB |
| skill:virtual-learner-memory-curator | 54 | 8,802 | 8,587 | 10,680 | 11,922 | 15KB |
| skill:path-planning | 204 | 7,494 | 7,960 | 9,108 | 9,108 | 6KB |
| skill:virtual-learner-epistemic-grounding | 1,691 | 6,489 | 6,265 | 8,748 | 10,105 | 13KB |
| skill:session-wrapup | 80 | 6,350 | 6,227 | 9,363 | 12,374 | 9KB |
| skill:goal-conversation | 483 | 4,715 | 5,093 | 6,788 | 9,106 | 4KB |
| skill:stage-designer | 1,115 | 3,440 | 3,597 | 3,891 | 7,639 | 3KB |
| skill:path-reviewer / kc-mapper | ~190 | ~2.7k/3.4k | | | | 3-6KB |
| 其余（aux/工具） | — | <2.5k | | | | |
| **全局** | **12,537** | **10,646** | **6,886** | **25,780** | **89,086** | — |

### 1.3 前缀缓存（成本主导项）

| agent | 调用 | 总 miss tokens | 占全局 miss | 命中率 | avg user |
|---|---:|---:|---:|---:|---:|
| **teaching-turn** | 2,400 | 38,878k | **36.8%** | 26.5% | 37KB |
| **adaptive-guidance-copy** | 639 | 25,731k | **24.4%** | **1.8%** | **90KB** |
| **virtual-learner-learn-turn-simulator** | 2,570 | 19,390k | **18.4%** | 23.0% | 18KB |
| **virtual-learner-epistemic-grounding** | 1,691 | 8,226k | **7.8%** | 25.0% | 13KB |
| stage-designer | 1,115 | 2,499k | 2.4% | 34.8% | 3KB |
| goal-conversation | 484 | 1,314k | 1.2% | **42.4%** | 4KB |
| path-planning | 204 | 673k | 0.6% | **55.9%** | 6KB |
| lesson-knowledge-enricher | 158 | 1,398k | 1.3% | 2.8% | 20KB |
| session-wrapup | 80 | 465k | 0.4% | 8.3% | 9KB |
| **全局** | **12,537** | **105,540k** | 100% | **20.9%** | — |

> **前 4 个 skill 占全部 miss 的 87.4%。** 其中 `adaptive-guidance-copy` 单次最贵（≈40k miss/次）。

---

## 2. 机制现状

| 层 | 现状 | 证据 |
|---|---|---|
| **输入预算** | **无**。所有非 `runtime-override` 的 `maxTokens` 被 floor 到 **131072**；core 里写的 8k/12k 只是**输出**上限 | `backend/src/services/resolve-llm-call-params.ts:142-153` |
| **压缩** | 仅 teaching：40k 窗口 / 70% 触发 / 保留 12 条 + **规则式** recap；无跨 skill 摘要层 | `backend/src/services/ai-teaching/TeachingContextCompressionService.ts:3-7` |
| **六材料池（§3）** | 声明/编译期概念；运行时只有 3 个专用装配器（goal/path/teaching），**无通用池注入器**；10 个 aux core **无 `inputs:`** | `backend/src/services/field-dispatcher/index.ts:183-231`；`prompts/core/*.yaml` |
| **上下文投递** | `contextDelivery=sidecar` **已实现**；`modelExposure=projected` 全 manifest 声明、**零消费**（仅测试） | `backend/src/composers/prompt-composer.ts:200`；`prompts/manifests/*.yaml` |
| **前缀友好** | 逐 skill 手写约定（goal 稳定键序、teaching 动态子键后置）；无统一机制、无回归护栏 | `backend/src/skills/goal-conversation/index.ts:198-214`；`teaching-turn/index.ts:646-655` |
| **序列化** | 对象一律 `JSON.stringify(payload, null, 2)`（+15~30% token） | `backend/src/composers/prompt-composer.ts:58-60` |
| **缓存可观测** | `llm_execution_attempts.promptCacheHitTokens`（DeepSeek `prompt_tokens_details.cached_tokens` / OpenAI `prompt_cache_hit_tokens`） | `backend/src/gateway/api-gateway/executor.ts:770-792` |

---

## 3. 按阶段 / skill 的上下文问题

### goal
| skill | 问题 | 优化方向 |
|---|---|---|
| goal-conversation | `conversationContext` 全量历史（无窗口）；`state.collected` 是 `understanding` 的派生副本并列回灌；`understanding` 每轮全量（含 miFrames） | 历史「最近 N 条 + 摘要」；payload 去 `collected`；delta 语义只回灌非空字段 |
| kc-mapper | 单次喂全路径（N 里程碑 + M 任务）；`milestones[].coreConcept` 与 `coreCognitive` 重复 | milestones 精简为 `{stageNumber,title,coreConceptId}`；大路径分片 |

### goal→path 交接
- `visibleSummary` 与 `goalHandoffFields` **双路**并存；`conversationHistory` 在 `path.coordinator` 写 **4 处副本**。
- 方向：保留配置式 handoff 一路；history 单副本。

### path
| skill | 问题 | 优化方向 |
|---|---|---|
| path-planning | 全量对话历史拼文本；`confirmedProposal` 2 份、`realProblem` ≥3 次、`【强制要求】` 重复 5 次；`scenario` 算了不打印；`includeStructuredData`/`includeConfidenceScores` 死配置 | 历史截断；去重复文本块；补 `scenario`；接线或删死配置 |
| stage-designer | loopOver **每里程碑重传** `cognitiveCore`+`normalizedInput` 全量，只消费 3~7 字段 | 循环外裁剪；固定前缀 + 变体后置（吃缓存） |
| path-reviewer | **（正确性）** 装配键 `prerreqTree` ≠ skill 读的 `prerequisiteTree` → 恒 null；`learnerProfile`/`successCriteria` 未传 | 修 key；`goalContext` 透传 `normalizedInput` |

### teaching
| skill | 问题 | 优化方向 |
|---|---|---|
| teaching-turn | `visibleDialogueContext` 与 `recentDialogueContext` 同源双键；`interactionProfile` 顶层 + `scenario` 内双份；沙盘 `sessionMessages` 被挂 3 个池键；压缩 recap **无 rule 引用** | 对话单键；profile 去一份；池去重；recap 接线；**前缀稳定化** |
| teaching-opening-generator | **（正确性）** caller 传的 `priorLearningContext` 被丢弃；core rules 7/8 逐字重复；无 retryStrategy（QA 41.8%） | 补/删字段；删重复 rule；加 retry |
| session-wrapup / peer-reinforcement / adaptive-guidance-copy / lesson-knowledge-enricher | 与 wrapup 重复读同一批数据；adaptive-guidance 的 `sessionWrapup` 全量 JSON（实测该链 41k/次、1.8% 命中）；enricher `knowledgeDelta`/`knowledgeState`/事件与 wrapup 重复且零裁剪 | 共享一份"课后投影"（wrapup artifact）；**adaptive-guidance 专项缩 payload** |
| finalization | dashboard 与 state-review **各跑一次** `assembleLearningState` | 一次构建、两处共享 |

### profile
| skill | 问题 | 优化方向 |
|---|---|---|
| learner-model | 不调 LLM 却声明 `maxTokens`；`get` 触发全量聚合；profile.yaml 同字段双份 handoff | 去 maxTokens；短 TTL 缓存；单条终点路由 |
| learning-predictor | 每次建课堂额外查 evidence+prediction | 复用已加载摘要；无历史直返 null |
| learner-progress-report | **（正确性）** `getCurrentMetrics()` 恒返回 0 → 报告基于空输入 | 改读 `learning-state.service` 真实指标；空则不调 LLM |
| learner-state-review | `priorInsights` 恒空；与 dashboard 重复跑 `assembleLearningState` | 接通历史洞察；快照去重 |

### simulation（11 个 virtual-learner-*）
| 共性 | 证据 | 优化 |
|---|---|---|
| `actorProfile`（含 **`storyPool` 全部故事**）每回合整包重传 | `session-factory.ts:239-245`；`blackbox-runner.ts:2402-2408` | 发送前投影为 persona 白名单（剔 storyPool/runtimePrefs/simulationBudget） |
| 对话历史/轨迹无上限 | goal-dialogue `index.ts:239-244`；`visibleHistory` 跨全部 trace 累加 `blackbox-runner.ts:1964-1966` | 统一 `history.slice(-6~-10)` |
| 记忆重复计算 | `buildLearnerMemorySnapshot` 以 6/8/30 三种 limit 在 6+ 处独立调用 | 同 task 构建一次、按 limit 投影 |
| 预算双源漂移 | `index.ts` 常量 ≠ core/definition | 单一来源 + 删死常量 |
| **virtual-learner-referee** | **（正确性）** payload 丢 `storyMeta`/`metricCompleteness`（core 声明且 rule 依赖） | 补回 |
| virtual-learner-actor-auditor | 本阶段输入最大（profile+story+≤120 状态+≤120 trace），零裁剪 | trace 截尾 + 复用 referee 的 compact trace |

### aux
| skill | 问题 | 优化 |
|---|---|---|
| generic-chat | 调用方指令拼进 **system** → 前缀缓存不稳定；history 无界；QA 成功率 16%/34% | 指令改 user 前缀；接统一摘要；加 retry |
| course-design / basic-evaluator / goal-alignment-checker | 僵尸（零调用） | 下线 |
| skill-author / skill-compiler | 死代码（路由已删） | 删除 |
| semantic-freeze-judge | payload = 完整 YAML + 完整编译产物，**无长度上限**；声明 retry 但无实现 | 加字节上限/分块；补 retry |

---

## 4. 优化方向（按**实测成本**排序）

| 优先级 | 动作 | 依据 / 预期 |
|---|---|---|
| **P0** | **前缀稳定化**：system + 稳定指令 + 稳定场景/任务块前置，动态快照后置（复刻 goal 42%/path 56% 的做法） | teaching-turn / learn-turn-sim / epistemic-grounding 三个 skill 占 miss 的 63%，命中率仅 23–26%，缓存前缀远未吃满 |
| **P0** | **`adaptive-guidance-copy` 专项**：40k×**1.8%**、90KB 动态 payload 是单次最贵；裁到必要字段或造稳定前缀 | 单次成本第一，且缓存不可救 |
| **P1** | 给大 payload skill 加 **system-hash 稳定性回归**（防动态内容拼进 system，generic-chat 现即犯） | 保住 P0 收益 |
| **P1** | 修正 §3 的**正确性 bug**（path-reviewer key、referee 缺字段、progress-report 恒 0、opening 丢字段） | 影响功能正确性，成本极低 |
| **P2** | 去重复池/去副本（`sessionMessages` 三挂、payload 双键、envelope artifact/nextState 重复） | 体积已小，收益有限，顺手做 |
| **P2** | per-skill payload 预算护栏 + 紧凑 `JSON.stringify`（去 `null,2`） | 全链 +15~30% token（`null,2` → 紧凑） |
| **P2** | `modelExposure=projected` 要么实现要么删除；`output`/`runtimeEnvelope.artifact`/`debug` 三同一收敛，debug 改按需 | 声明与实现对齐 |
| ~~P0~~ | ~~全量历史截断~~ | 实测体积小 → **降级为 P2** |

---

## 5. 附录：复现查询

```sql
-- 输入体积 + 缓存（按 skill 聚合）
SELECT p.agentId,
       COUNT(*)                                              AS calls,
       AVG(a.promptTokens)                                   AS avg_prompt,
       MAX(a.promptTokens)                                   AS max_prompt,
       100.0 * SUM(COALESCE(a.promptCacheHitTokens,0))
             / SUM(a.promptTokens)                           AS cache_hit_pct,
       AVG(a.requestBytes)/1024.0                            AS avg_kb
FROM llm_execution_attempts a
JOIN prompt_call_logs p ON p.id = a.promptCallId
WHERE a.promptTokens > 0
GROUP BY p.agentId
ORDER BY avg_prompt DESC;
```

> 注：`llm_execution_attempts` 在**主库**（`backend/prisma/dev.db`）；`agent_call_logs` / `prompt_call_logs` 亦在主库。`promptCallId` 为关联键。

---

## 6. 变更记录

- 2026-09-14：首版（基于 12,537 次真实调用遥测；修正"体积是主要浪费"的早期判断——真正杠杆是**前缀缓存命中率**）。
- 2026-09-15：新增 §7 改造收益预估（基于真实 payload 的前缀模拟）与真业务实测基线。

## 7. 改造收益预估（2026-09-15）

### 7.1 方法
对每个 skill，取库中**真实 `userPayload`**（同会话、按时间排序），计算相邻两次调用的**公共前缀字符占比**（= 可缓存前缀的理论上界）；再用「按逐回合键稳定性递归重排键序」模拟改造后，重算公共前缀。

> 口径与 caveat：字符前缀是 token 前缀的代理；**不含 system prompt**（静态、另计）；provider 前缀缓存受路由影响（best-effort），故本表是**上界估计**，真值须以真业务 A/B 为准。

### 7.2 实测预估（真实 payload × 实际新键序，确定性）

方法升级：不再用「通用波动性重排」（低估），而是**施加各 skill 实际实现的新键序**，在真实 `userPayload` 上重算相邻回合公共前缀（可复现、无 LLM 调用）。

| skill | 相邻对数 | 当前可缓存前缀 | 改造后 | **提升** |
|---|---:|---:|---:|---:|
| **stage-designer** | 194 | 0.9% | 61.2% | **+60.4pp** |
| **learner-progress-report** | 62 | 11.5% | 50.4% | **+38.9pp** |
| **teaching-turn** | 199 | 16.8% | 36.1% | **+19.3pp** |
| **adaptive-guidance-copy** | 198 | 0.2% | 15.3% | **+15.0pp** |
| **teaching-opening-generator** | 109 | 10.3% | 24.8% | **+14.6pp** |
| **virtual-learner-path-evaluator** | 195 | 38.5% | 52.0% | **+13.5pp** |
| **virtual-learner-learn-turn-simulator** | 198 | 19.7% | 28.7% | **+9.0pp** |
| **path-reviewer** | 183 | 1.0% | 6.9% | **+5.9pp** |
| **virtual-learner-goal-dialogue-simulator** | 189 | 58.9% | 63.3% | **+4.4pp** |
| **virtual-learner-persona-designer** | 94 | 54.1% | 56.0% | **+1.9pp** |
| **learning-predictor** | 148 | 15.8% | 21.0% | **+5.2pp** |
| ~~goal-conversation~~ | 136 | 26.6% | 22.8% | **-3.8pp（已回退）** |

> `goal-conversation` 实测为**负收益**（`userInput` 前置反而变差），已按数据回退，不做无收益改动。

### 7.2.1 缓存 token 收益（估算）

| skill | 调用数 | 平均 prompt | +缓存/次 | +缓存总计 |
|---|---:|---:|---:|---:|
| teaching-turn | 2,531 | 21,730 | 4,193 | ~10.6M |
| adaptive-guidance-copy | 655 | 40,150 | 6,022 | ~3.9M |
| stage-designer | 1,138 | 3,446 | 2,081 | ~2.4M |
| learn-turn-sim | 2,714 | 9,590 | 863 | ~2.3M |
| virtual-learner-path-evaluator | 189 | 7,193 | 971 | ~0.18M |
| virtual-learner-goal-dialogue-simulator | 606 | 5,663 | 249 | ~0.15M |
| path-reviewer | 197 | 2,657 | 156 | ~0.03M |
| teaching-opening-generator | 124 | 1,590 | 232 | ~0.03M |
| learner-progress-report | 62 | 352 | 136 | ~0.01M |
| virtual-learner-persona-designer | 125 | 1,675 | 31 | ~0.003M |
| learning-predictor | 148 | 800 | 41 | ~0.006M |
| **合计** | | | | **≈ 19.7M tokens** |

> 说明：本表是**确定性**测量（真实 payload + 真实键序），但仍是**前缀上界**；实际命中受 provider 路由影响（best-effort），须以真 LLM A/B 佐证（见 §7.6）。

### 7.3 真业务实测基线（隔离会话，教学链）
- **同一新会话内**：`goal-conversation` 命中 62%/73%/84%/95%，`path-planning` 46%，`stage-designer` 48%；而 **`teaching-turn` 仅 0/1.0/0/0.9%** —— 直接印证前缀分析（goal 有稳定前缀、teaching 没有）。
- 全窗口合计命中 23.7%（n=33 次调用）。

### 7.4 已落地改造（flag 门控，默认关，`PAYLOAD_STABLE_PREFIX=1` 开启）
| skill | 改动 |
|---|---|
| `teaching-turn` | 稳定块（scenario 洁版 / promptDirectives / learner）前置，逐回合变化键全部后置；去 `recentDialogueContext` 重复 |
| `stage-designer` | `cognitiveCore`/`normalizedInput` 前置；`milestone`/`previousMilestone`/`repairHints` 后置 |
| `adaptive-guidance-copy` | `view`/`path` 前置；`learner`/`learningState`/`wrapup`/`advisory` 后置 |
| `virtual-learner-learn-turn-simulator` | `task`/`personaAnchorHint`/`story`/`learner` 前置，逐回合状态块后置 |
| `teaching-opening-generator` | `learner`/`openingMode` 前置 |
| `learner-progress-report` | `signals` 前置 |
| `virtual-learner-path-evaluator` | `task`/`personaAnchorHint`/`goalState` 前置，`pathProposal`/`previousReaction` 后置 |
| `path-reviewer` | `prerequisiteTree`（常量）前置 |
| `virtual-learner-goal-dialogue-simulator` | `personaAnchorHint`/`task` 前置，`visibleContext` 后置 |
| `virtual-learner-persona-designer` | `candidatePersonas`/`preferredLevels` 前置 |
| `learning-predictor` | 调用方改序：`fatigueSignal` 前置 |

另：`teaching-turn` 的 `interactionProfile` 输入 **ref 由 `teaching.scenario.interactionProfile` 对齐为 `teaching.interactionProfile`**（+ 沙盘注册/池），使声明与装配一致（§7.8）。

默认路径字节不变（`tsc` 0、payload 快照与单测全绿）。共 **10 个 skill**。

### 7.5 待落地改造（低收益 / 大改 / 已否）
- `adaptive-guidance-copy`：79k 动态 payload **裁剪**（`sessionWrapup` 只留必要字段）——前缀序已改，**体积**收益待做。
- `learn-turn-sim` / `virtual-learner-*`：`learner.profile.storyPool` 等无关大对象**投影剔除**（体积而非前缀）。
- `path-planning` / `kc-mapper`：**去重**（confirmedProposal ×2 / `【强制要求】`×5）——前缀收益≈0，属体积项。
- `goal-conversation`：试改**负收益（-3.8pp）已回退**；除非先去掉 `state.collected` 派生副本再评估。
- `epistemic-grounding` / `lesson-knowledge-enricher`：实测前缀≈0，不做序改。

### 7.6 真业务 A/B：尝试与阻塞（2026-09-15）

- 已起第二实例（端口 3011，`PAYLOAD_STABLE_PREFIX=1`）并用**非预设 profile**（批跑 runner 不扫，规避租约争用）驱动真实教学链（`start-session → run-full → accept-path → start-learning → teaching-step`）。
- 阻塞点：
  1. `run-full` 的 `autoAdvanceToLearning` 不可靠（只到 path，`learningSteps=0`）；
  2. path 的 **subtasks 由 stage-designer 异步生成**，过早 `start-learning` → "第一个里程碑没有可用任务" → 未产生 `teaching-turn` 调用；
  3. 后台第二实例被回收（`3011=000`），ON 段无数据。
- 已获得的真业务基线：同会话内 `goal-conversation` 命中 62–95%、`teaching-turn` 0–1%（与 §7.2 一致）。
- 结论：真 LLM A/B 受**基础设施**（实例持久性、path-ready 时序、租约争用）制约。

### 7.7 真 LLM 缓存实测（真实 payload，直连模型）

绕开实例/会话：直接取库里**真实 `teaching-turn` payload**，**直连真实 LLM**（同会话相邻两回合 A→B），记 B 的 `cached_tokens`（重复 4 轮；system = 真实编译产物）：

| 键序 | B 的 `cached_tokens`（4 轮） | 命中率 |
|---|---|---|
| OFF（当前键序） | 6912 / 0（另 2 次上游超时） | ≤38%，**多数 0** |
| **ON（新键序）** | 8960 / 17920 / 17920 / 17920 | 50% / **99% / 99% / 99%** |

> 真实模型下，新键序把**相邻回合缓存命中从「多数 0」拉到 99%**，直接证实改造收益。（payload 约 1.8万 tokens/回合）

**回答"为什么不能跑真实的"**：能跑。改造本身就只是**输入 payload 的键序**（+ 去一个重复键），不涉及 schema/逻辑/模型；此前没跑出来是**测试接线**问题（flag 在进程启动时读、第二实例被回收、VL 未走到 learn、preset 会话被抢租约）——本节的直连模型实测即绕开了这一切。

### 7.8 声明与装配对齐（teaching-turn）

稳定前缀改造把 `interactionProfile` 从 `scenario` 内移到顶层（`scenario` 内那份是重复），为使「声明↔装配」一致：
- `core/teaching-turn.yaml`：`inputs.interactionProfile.ref` 由 `sandbox:teaching.scenario.interactionProfile` → **`sandbox:teaching.interactionProfile`**
- `SANDBOX_EXTRA_KEYS['teaching-agent']` 注册 `interactionProfile`；`buildTeachingSandboxPool` 在 teaching 级补充该键（scenario 级保留兼容）
- 重编译 md + 快照；`check-handoff:strict`、`snapshots:check`、`fields-sync`、`yaml:check` 全绿

> 这是本轮**唯一**一处改动 skill「声明字段」的地方（其余 skill 仅改 payload 键序）。

