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
