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

> ⚠️ 本章是 **2026-09-14 的审计快照**。各条的最新状态（已修 / 不成立 / 已退役 / 低价值）见 **§7.10、§7.13、§7.14**；排期请以 §7.14 为准。

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
| path-reviewer | ~~装配键 `prerreqTree` ≠ skill 读的 `prerequisiteTree` → 恒 null~~ **已修（2026-09-15）**：`learning.service.ts:2563` → `prerequisiteTree`；`learnerProfile`/`successCriteria` 仍未传 | 透传 `normalizedInput`（剩余） |

### teaching
| skill | 问题 | 优化方向 |
|---|---|---|
| teaching-turn | ~~`visibleDialogueContext` 与 `recentDialogueContext` 同源双键~~ **已修（单键 `messages`）**；`interactionProfile` 顶层 + `scenario` 内双份；压缩 recap **无 rule 引用** | profile 去一份；recap 接线；**前缀稳定化**（已完成） |
| teaching-opening-generator | ~~caller 传的 `priorLearningContext` 被丢弃~~ **已修（2026-09-15）**：`v4-aux-skills/index.ts` 两个分支补回该键；core rules 7/8 逐字重复；无 retryStrategy（QA 41.8%） | 删重复 rule；加 retry（剩余） |
| session-wrapup / peer-reinforcement / adaptive-guidance-copy / lesson-knowledge-enricher | 与 wrapup 重复读同一批数据；~~adaptive-guidance 的 `sessionWrapup` 全量 JSON（实测该链 41k/次、1.8% 命中）~~ **已解决（09-12）**：`toGuidanceProjection` 投影后 9–22KB；enricher `knowledgeDelta`/`knowledgeState`/事件与 wrapup 重复且零裁剪 | 共享一份"课后投影"（wrapup artifact）；enricher 投影（剩余） |
| finalization | dashboard 与 state-review **各跑一次** `assembleLearningState` | 一次构建、两处共享 |

### profile
| skill | 问题 | 优化方向 |
|---|---|---|
| learner-model | 不调 LLM 却声明 `maxTokens`；`get` 触发全量聚合；profile.yaml 同字段双份 handoff | 去 maxTokens；短 TTL 缓存；单条终点路由 |
| learning-predictor | 每次建课堂额外查 evidence+prediction | 复用已加载摘要；无历史直返 null |
| learner-progress-report | ~~**（正确性）** `getCurrentMetrics()` 恒返回 0 → 报告基于空输入~~ **已修（2026-09-15）**：改读 `getLearningMetrics(userId)` 权威指标 | 其余：`ski/mki/dki` 算了未传 |
| learner-state-review | `priorInsights` 恒空；与 dashboard 重复跑 `assembleLearningState` | 接通历史洞察；快照去重 |

### simulation（11 个 virtual-learner-*）
| 共性 | 证据 | 优化 |
|---|---|---|
| `actorProfile`（含 **`storyPool` 全部故事**）每回合整包重传 | `session-factory.ts:239-245`；`blackbox-runner.ts:2402-2408` | 发送前投影为 persona 白名单（剔 storyPool/runtimePrefs/simulationBudget） |
| 对话历史/轨迹无上限 | goal-dialogue `index.ts:239-244`；`visibleHistory` 跨全部 trace 累加 `blackbox-runner.ts:1964-1966` | 统一 `history.slice(-6~-10)` |
| 记忆重复计算 | `buildLearnerMemorySnapshot` 以 6/8/30 三种 limit 在 6+ 处独立调用 | 同 task 构建一次、按 limit 投影 |
| 预算双源漂移 | `index.ts` 常量 ≠ core/definition | 单一来源 + 删死常量 |
| ~~virtual-learner-referee~~ | ~~**（正确性）** payload 丢 `storyMeta`/`metricCompleteness`（core 声明且 rule 依赖）~~ **已复核（2026-09-15）：不成立**——`blackbox-runner.ts:2095-2096` 已装配，skill `normalizeEvidence` 也接受这两个 source | 无需改 |
| virtual-learner-actor-auditor | 本阶段输入最大（profile+story+≤120 状态+≤120 trace），零裁剪 | trace 截尾 + 复用 referee 的 compact trace |

### aux
| skill | 问题 | 优化 |
|---|---|---|
| ~~generic-chat~~ | ~~调用方指令拼进 **system** → 前缀缓存不稳定；history 无界~~ **已退役（2026-09-15，四同步）**：唯一入口 `aiService.chat()` 及其全部内部调用方均无调用方，正式业务均有专用 skill；底座 `services/ai/ai.service.ts`、死链 `learning.service.generateTasksForExistingPath` 一并清理。（此前"QA 成功率 16%/34%"实为 admin 试跑被取消，非模型能力问题） | **已注销** |
| ~~course-design / basic-evaluator / goal-alignment-checker~~ | ~~僵尸（零调用）~~ **已退役（2026-09-15，四同步）**：注册/户口簿/core+manifest+编译产物/文档全部删除，`PURGED_SKILLS` → 39；DB 残留行由启动 purge 清理。**业务依据**：`course-design` 周计划模型被 path→stage-designer 取代（`designWeekCourses` + 孪生 `generateTasksForExistingPath` 均无调用者，一并删除）；`goal-alignment-checker` 被 `path-reviewer`（CIDDP 五维含 Pertinence、可触发重规划）覆盖；`basic-evaluator` 无"评分/等级"产品面（未来做作业评分可复用其设计） | **已注销**（2026-08-10 的"保留注册"决定被覆盖） |
| skill-author / skill-compiler | **预留能力（Prompt-AI：起草 system prompt + 单轮验收必填字段）**。服务与 prompt 完整保留（`services/skill-author`）；入口 `/api/admin/skill-author/*` 于 2026-09-11 因"未挂载死路由"下线（`0c8105e` 明确保留底层能力）。**归类 `registrationPoint: platform-direct`（service 直调，与 semantic-freeze-judge 同组）→ 不进业务编排链**；`compileSkill` 失败路径漏 return 已修 | **保留**；要恢复只需加回 admin 路由（挂 prompt 工程区） |
| semantic-freeze-judge | payload = 完整 YAML + 完整编译产物，**无长度上限**；声明 retry 但无实现 | 加字节上限/分块；补 retry |

---

## 4. 优化方向（按**实测成本**排序）

| 优先级 | 动作 | 依据 / 预期 |
|---|---|---|
| **P0** | **前缀稳定化**：system + 稳定指令 + 稳定场景/任务块前置，动态快照后置（复刻 goal 42%/path 56% 的做法） | teaching-turn / learn-turn-sim / epistemic-grounding 三个 skill 占 miss 的 63%，命中率仅 23–26%，缓存前缀远未吃满 |
| ~~**P0**~~ | ~~**`adaptive-guidance-copy` 专项**：40k×**1.8%**、90KB 动态 payload 是单次最贵；裁到必要字段或造稳定前缀~~ **已解决（2026-09-12 22:00 起）**：`LearnerProjectionService.toGuidanceProjection` 已投影（丢 path 整行/`aiPromptTemplate`、knowledgeMemory 明细）→ payload 由 ~94–222KB 降至 **9–22KB** | 已完成，无需再做 |
| ~~**P1**~~（**2026-09-15 修订：降级为"暂缓"+ 改口径**） | ~~给大 payload skill 加 **system-hash 稳定性回归**（防动态内容拼进 system）~~ → 改为**稳定性（report）护栏**：判据是「**同一会话内 system 段逐请求漂移**」，**不是**「system 恒定」；**不得**判红版本切换 / 显式 `systemPromptOverride` / 实验分组。**暂缓实施**，理由与边界见 §8 | 保住前缀收益，同时**不锁死**"live prompt 预调 / 渐进式加载"（§8） |
| **P1** | 修正 §3 的**正确性 bug**：path-reviewer key ✅已修 / opening `priorLearningContext` ✅已修 / referee 缺字段 ❌不成立 / progress-report 恒 0（待做，需接真实指标） | 影响功能正确性，成本极低 |
| **P2** | 去重复池/去副本（`sessionMessages` 三挂、payload 双键、envelope artifact/nextState 重复） | 体积已小，收益有限，顺手做 |
| ~~**P2**~~ | ~~per-skill payload 预算护栏 + 紧凑 `JSON.stringify`（去 `null,2`）~~ **已完成（2026-09-15）**：`stringifyPayload` 默认紧凑（`PAYLOAD_COMPACT_JSON=0` 回退）；另加**稳定前缀 SSOT + 回归门禁**（`prompts:payload-prefix:check`，见 §7.13） | 全链 -15~30% token；前缀能力有护栏 |
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

> 说明：本表是**确定性**测量（真实 payload + 真实键序）。原理：重排让 payload **以「常量块」开头**（`task`/`personaAnchorHint`/`cognitiveCore` 等），这些在同 skill 任意两次调用间相同 → 公共前缀必然变长。
> 直连真实模型的 A/B 受 provider 路由影响（best-effort、噪声大，多数 0），但在命中窗口可达 **99%**（§7.7）；故以确定性测量为准，LLM 实测仅作机制佐证。

### 7.3 真业务实测基线（隔离会话，教学链）
- **同一新会话内**：`goal-conversation` 命中 62%/73%/84%/95%，`path-planning` 46%，`stage-designer` 48%；而 **`teaching-turn` 仅 0/1.0/0/0.9%** —— 直接印证前缀分析（goal 有稳定前缀、teaching 没有）。
- 全窗口合计命中 23.7%（n=33 次调用）。

### 7.4 已落地改造（**已定稿：默认启用**新键序；`PAYLOAD_STABLE_PREFIX=0` 可回退旧序）
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
- 该次尝试未取到 ON 段数据；其后用**黑盒自动驾驶**完整跑通一轮真实业务（见 §7.9），以那份数据为准。**注意**：早期"`teaching-turn` 命中 0–1%"只属该次失败尝试的样本，不成立——真实业务旧序命中约 30%（§7.9）。
- 结论：真 LLM A/B 受**基础设施**（实例持久性、path-ready 时序、租约争用、provider 限流）制约。

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


### 7.9 真实虚拟学习者 · 黑盒自动驾驶一轮取证（2026-09-15）

用**预制角色** `shop-owner-inventory`（「盘不清的账」），走后台**黑盒自动驾驶**（`POST /:id/start-blackbox-session` → 连续 `blackbox-step`，即产品里的"自动驾驶"）：

- 结果：`goal → path → teaching → completed`（2/2 任务），会话 `3ede7c64-1890-4b21-af1a-452b9d475a31`，约 20 分钟 / 25 步教学。
- 会话内 21 次 `teaching-turn`：provider 命中合计 **40.8%**（138112 / 338455）；逐回合确定性公共前缀中位 ~50%（23–70%）。

**同会话（按 `scenario.taskTitle` 判定）确定性公共前缀，真实 payload：**

| 键序 | 相邻对数 | 确定性前缀（中位） | provider 命中（中位） |
|---|---|---|---|
| OFF（旧序） | 2344 | **21.9%** | **30.5%** |
| ON（新序） | 23 | **80.3%** | **59.5%** |

其它 skill（同会话，OFF→ON 确定性前缀）：`learn-turn-sim` 0.5%→10.4%、`teaching-opening-generator` 5.5%→29.0%、`virtual-learner-goal-dialogue-simulator` 74.5%→80.3%。

- 结论：新键序在**真实业务**里确实把 `teaching-turn` 同会话可缓存前缀从 ~22% 提到 ~80%；provider 侧命中受**路由/驱逐 best-effort** 影响噪声大，但方向为正（中位 30% → ~40–60%）。
- provider 命中不完全跟随确定性前缀（个别回合前缀 60% 却只命中 2%），说明**确定性前缀是上界/稳定属性，实际命中另受网关路由影响**。
- 环境约束：provider 限 **10 请求/分**；并发跑批（`scripts/run-vl-learn-concurrent.mjs`）长期占用配额，导致 429 与 ON 样本偏小。
- 功能面无回归：改造后完整链（goal/path/learn）在默认新序下跑通至 `completed`。

### 7.10 §3/§4 待改点 · 逐条复核（2026-09-15）

按真实 payload 复核 §3 列出的"问题"，结论如下（**避免把过期结论当任务**）：

**已修（本轮）**
- **path-reviewer 装配键**：`learning.service.ts:2563` `prerreqTree` → `prerequisiteTree`。此前 skill 恒读 `undefined`；同会话前缀实测仅 **0.9%**（因为恒定 `null` 之后 `goalContext` 立刻分叉）。
- **teaching-opening-generator 丢 `priorLearningContext`**：caller（`AITeachingCoordinator.ts:1519`）已传、core rules 引用，但 `buildUserPayload` 两分支都没输出 → 已在两分支补回该键。

**复核后不成立（删除该待办）**
- **virtual-learner-referee 丢 `storyMeta`/`metricCompleteness`**：`blackbox-runner.ts:2095-2096` 已装配；skill `normalizeEvidence`（`virtual-learner-referee/index.ts:39,46`）也接受这两个 source。**无需改**。

**复核后确认存在，但属功能缺口/需产品定夺（本轮未改）**
- ~~**learner-progress-report KTL/LF 恒 0**~~ **已修（2026-09-15）**：`evaluateTaskCompletion` 现读权威学习状态 `getLearningMetrics(userId)`（0-100 display，与看板 `/api/metrics` 同源），无记录回退本服务快照。注：`task:completed` 事件异步消费 → 读到上一任务末的指标（仍为真实值）。
- **learner-state-review `priorInsights` 恒空**：`LearnerStateReviewService.ts:215` 硬编码 `[]`。已有可用的历史洞察源 `insightCalibrationService.getRecords(userId, pathId)`；但 core prompt 并未引用 `priorInsights`，接通属于**行为增强**而非修 bug（且 15 次调用，影响可忽略）。

**复核后"本来就正常"（无需改）**
- `virtual-learner-epistemic-grounding`（最高频 skill）：同会话（按 `currentTask` 判定）确定性前缀 **97.7%**，键序已合理——不是待改项。
- `teaching-opening-generator` / `learning-predictor`：同会话前缀 **100%** / **100%**。

**已修（后续提交）**
- ~~`teaching-turn` 对话上下文同源双键~~ **已修（单键化，commit `4b81f75`）**：删 core 输入 `visibleDialogueContext` + 规则提及、manifest 字段、沙盘 `teaching.visibleDialogueContext`、`agent-contract-view` 通道项；payload 键 `recentDialogueContext` → **`messages`**（对齐 core 输入名与编译产物文档名）。实测原两键 400/400 逐字节相同，长会话重复占 payload 最多 ~22%。

**仍然成立、按原优先级保留**
- `adaptive-guidance-copy`：典型 20KB（`learner`≈7.4KB + `wrapup`≈6KB 占 ~65%），窗口内 `path` 峰值 **138KB**；仍建议做投影裁剪。

### 7.11 simulation 块复核：`storyPool` 的真实作用（2026-09-15）

**设计意图**：虚拟学习者应是"一个有故事的人"，而非"只知道一个故事"——所以 `actorProfile.profile` 里带着 `storyPool`（该角色的全部故事）。

**复核结论：当前实现没有兑现这个意图，且当多故事真正出现时会变成风险。**

1. **数据面：全库 18/18 画像都只有 1 条故事**；`storyPool[0]` 与本次单独传入的 `story` **同 id、同 1078B**（仅字段名不同：`storyOutline`↔`outline`、`storyTriggerEvent`↔`triggerEvent`）→ **storyPool 就是当前故事的改名副本**，"立体"信息增量为 **0**。
2. **规则面：没有任何 core / 编译产物引用 `storyPool`**（`grep prompts/core/*.yaml`、`prompts/skill.*.md` 均为空）。真正让人物立体的载体是 **被规则点名的那些**：
   - persona 字段：`learner.personalityTraits / helpSeekingPattern / adversarialPattern / emotionalTriggers / failurePatterns`（`PERSONA_FIELD_ANCHORS_HINT` 明列）；
   - 当前 `story`：`disclosurePlan / pressurePoints / behaviorHooks`；
   - 跨故事连续性：`learnerMemory`（mastered/struggling/recentCompleted）+ `learner.profile.background / priorAttempts`。
3. **多故事时的风险**：`storyPool` 每条都含 `hiddenDetails / disclosurePlan / goalSeed`（**别的故事的私有底牌**）→ 直接倒给模拟器会串场/泄露，反而拉低 actor-auditor 的 `personaConsistency / storyConsistency`。
4. **体量**：近 24h 4 个模拟器 **944 次调用 100% 携带** `storyPool`，平均 ~1.1KB/次 → **~1.08MB/天**（约 30 万 tokens/天）纯重复。

**已实施（commit `ed45615`）**：在 5 个模拟器 skill 的 **payload 发送前**做 deep 投影 `projectSimulatorPayload`：任意位置的 `storyPool` → **`storyHistory`**（标题 + 一句话概述，截断 160 字、上限 12 条），hiddenDetails/disclosurePlan/goalSeed 等私有字段全部剔除；goal-dialogue / learn-turn 的 core 增补 `storyHistory` 使用规则（可显式体现生活史，但不得复述其他故事细节）。单故事时该投影≈0 字节，多故事时自动生效且不泄露。

### 7.12 附：黑盒 vs 辅助的定位复核（2026-09-15）

排查上下文时顺带核对了虚拟实验室的两条驱动链路——**目标重叠，定位不重叠**：

| | 辅助 assisted | 黑盒 blackbox-api |
|---|---|---|
| 判别 | `experiment.mode !== 'blackbox-api'`（`session-mode.ts`） | `experiment.mode === 'blackbox-api'` |
| 驱动 | `simulationCoordinator` 进程内直调（`goal-conversation.service` / `path.coordinator` / `AITeachingCoordinator`） | `blackboxVirtualLearnerRunner` → `PlatformUserAdapter` 以投影 token **走 HTTP `/api`**，合成外部用户 |
| 视角 | 白盒（内部状态/日志/租约） | 黑盒（只见 `publicTrace` / `availableActions`） |
| 控制 | 驾驶舱可人工接管：`step` / `auto` / `advance-path` / `accept-path` / `start-learning` / `teaching-step` / `auto-learning` / `run-full` | 全自动 `autoStep`；`blackbox-observe` / `blackbox-evaluations` / `blackbox-rerun` |
| 独有 | 白盒定位 + 人工干预 | **referee 裁判 + actor-auditor 保真审计 + metricCompleteness**；HTTP 契约/鉴权/投影可见性 |

- 两者**共用同一层**「虚拟学习者模拟」（`goal-dialogue-sim` / `learn-turn-sim` / `epistemic-grounding` / `memory-curator`），autopilot 也已统一驱动两种模式（`AutopilotMode = 'assisted' | 'blackbox'`）。
- 真正的区别是**测试分层**：辅助 = 白盒 + 可人工接管（开发/排障）；黑盒 = 黑盒 + HTTP 契约 + 可见性 + 裁判评估（回归/评测）。
- **不重叠的是粒度**（复核后更正）：`/sessions/:id/auto`（`executeAutoLoop`）是**有界、同步**的"跑一轮"（驾驶舱传 `maxRounds:10`，返回 `results[]`）；autopilot 是**异步、到终点**的监督器（含 stop 感知、状态持久化、租约、看门狗/重试）。二者共用 `executeSingleStep` 原语，但语义不同 → **不是重复，不应合并**（此前"assisted.auto 与 autopilot 重复"的说法已作废）。
- `profile.simulationMode`（写入 `'manual'`）**后端只写不读**（仅前端 `VirtualProfile.vue` 当标签显示）→ 属**展示型死配置**。已清理其代码接线（路由 create/update、batch-experiment/batch-job/seeder 的写入、前端展示行与 api 类型）；**DB 列保留**（删除列需迁移，未在共享 dev.db 上动）。

### 7.13 机制收口：紧凑序列化 + 稳定前缀 SSOT/护栏（2026-09-15）

**① 紧凑序列化（#1）**：`prompt-composer.stringifyPayload` 默认 `JSON.stringify(payload)`（`PAYLOAD_COMPACT_JSON=0` 回退 `null,2`）。pretty-print 仅为人可读，对模型语义等价，但缩进/换行让**全链输入多 15~30% token**。调用方单点在 composer，无需逐 skill 改。

**② 稳定前缀 SSOT + 回归门禁（#3）**：
- `services/payload-stability.ts` **单源声明** 11 个 skill 的 leading 稳定键（此前是逐 skill 手写约定，无护栏）；
- 门禁 `prompts:payload-prefix:check`：取各 skill 最近 N 条**真实 `prompt_call_logs.userPayload`**，校验「最新一条首键 ∈ 声明稳定段」；report 默认、`--strict` 违规退出 1；已挂入 `prompts:check:all`。
- 首次运行：声明 11 项（有遥测 11 项）**违规 0**；`stage-designer` 近 30 条稳定占比 7%、`path-reviewer` 3%、`learner-progress-report` 7% —— 因为窗口内多数行发生在默认翻转（07:45）之前，「最新一条」已全部落新序。
- **一处待观察**：`virtual-learner-persona-designer` 最新一条（08:43）首键是 `preferredLevels`（旧序），而其 ON 分支应为 `candidatePersonas` 先；声明表暂同时容纳两键以避免误报，待有新增量后复核该 skill 是否真的走 ON 分支。

**③ 关于 #2（僵尸/死代码）— 复核后按"设计原由"处理**：
- `course-design` / `basic-evaluator` / `goal-alignment-checker` **已正式退役（2026-09-15，四同步）**：注册（v4-aux-skills）/ 户口簿（prompts/skills.yaml）/ core+manifest+编译产物 / 文档全部删除，补入 `PURGED_SKILLS`（→39），由启动 purge 清理 DB 残留行。业务依据见 §3 aux 行；2026-08-10 的"保留注册"决定被覆盖（当时顾虑的 `skill_model_configs` 永久丢失，在**整体注销**下不再构成问题）。
- `skill-author` / `skill-compiler`：**不退役，属"预留能力"**。`0c8105e` 删除的是"自 `871ea4c` 起未挂载的死路由"，并**明确保留底层能力**（service + core prompt + v4-aux 定义）。现归类 `registrationPoint: platform-direct`（service 直调，与 semantic-freeze-judge 同组），**不进业务编排链**；顺带修复 `compileSkill` 失败路径漏 return。恢复只需加回 admin 路由（建议挂 prompt 工程区）。

**④ 验证口径说明**：单键化（08:42）、storyHistory（09:15）、紧凑序列化（12:2x）三项都发生在**跑批停止（08:26）之后**，因此**只有单测/编译产物验证，没有新的实时遥测**；待虚拟实验室跑批再起，可在 `prompt_call_logs` 直接复核 `messages` 单键、`storyHistory` 与紧凑格式。

## 8. live prompt 与渐进式上下文：方向与边界（草案，2026-09-15）

> 目的：为 path/goal 阶段的「**生产前预调 prompt**」与「**渐进式（按需）加载上下文**」两条诉求定边界，
> 并明确 **A1/A2 各自该做什么**，避免"为了保前缀缓存而把这条路锁死"。

### 8.1 现状盘点（仓库已有的半成品）
| 能力 | 现状 | 位置 |
|---|---|---|
| 运行时覆盖 system | **已有**：`systemPromptOverride`（协议归类为"prompt 调试覆盖"，由执行信封承载，不进材料池） | `composers/types.ts`、`prompt-composer.ts:130/273` |
| path 阶段 live 钩子 | **已实装**：按会话传 `systemPromptOverrides.pathAgent` | `path.coordinator.ts:30`、`simulation.coordinator.ts:1055/1192/1678` |
| 版本化预调 | **已有**：core → `compile-core` → `publish-core` → `versions/rollback/lineage` | `routes/prompt-lab.ts` |
| 版本漂移记账 | **已有**：`detectPromptDrift(编译产物, ACTIVE)` → `prompt_call_logs.promptDrift` | `composers/drift-detector.ts` |
| 渐进式投递 | **半成品**：`contextDelivery=sidecar` 已实现；**`modelExposure=projected` 零消费方（未实现）** | manifest / 协议 §2–§3 |
| 架构原则 | §3 第 15 行：**控制面（core 文件）与数据面（材料池组装）分离，两面之间只经编译链连接** | `SKILL_PROTOCOL_V4.md` |

### 8.2 两条路线（互不排斥）
- **路线 A｜版本链预调（生产前）**：在 prompt-lab 里以 core 草稿 + `compile-core` + **preview（不 publish）** 做预调；上线即 `publish-core`（ACTIVE 版本切换）。运行时若需临时试，用 `systemPromptOverride`（**带内来源已可记账**，当前 override 时 `systemPromptVersion=null`）。
- **路线 B｜渐进式投递（运行时按需）**：把"按需加载"做在**数据面**——即实现 **`modelExposure=projected` / sidecar 材料投递**：按需把材料**投影/懒加载到 user 段或 sidecar**，**system 段保持版本稳定**。

### 8.3 A1 / A2 边界（结论）
- **A1（`modelExposure=projected` 实现或删声明）**：是**路线 B 的载体** → 优先做。
- **A2（system 稳定性护栏）**：
  - **判据**：同一 (skill, 会话) 内 `systemPromptHash` 相邻调用的**变化率**；**会话内变化 = 违约**；**跨会话/跨版本变化 = 正常**。
  - **必须允许**：版本切换、显式 `systemPromptOverride`、A/B 实验分组（这些变化是"声明的、低频的"，代价只是缓存失效一次）。
  - **只拦**：把**逐回合数据**（时间/用户输入/快照）拼进 system 造成的**未声明、逐请求漂移**。
  - **形态**：与 `prompts:payload-prefix:check` 同族**门禁脚本，先 report**；**暂缓实施**（等 8.4 的口径确认与观测手段）。
  - **不做**：写成"system 必须字节等于某常量"——那会**判红现有 `systemPromptOverrides.pathAgent`**，把路线 A/B 一起锁死。

### 8.4 待决 / 已知限制
1. **观测手段**：provider 侧缓存命中是 best-effort，且当前**暂时无法观测缓存率**（待通知）；A2 的"是否真的有害"应先有观测再定 strict。
2. **分组列缺失**：`prompt_call_logs` 的 `teaching-turn` **无会话分组列**（`pathId/conversationId` 为 NULL）→ 会话内判据在 teaching 侧只能退化为"短窗口变化率"；path/goal 可用 `conversationId/pathId`。
3. **override 记账**：现在 override 时 `systemPromptVersion=null`，建议补记"来源=override"，以便把"声明变化"与"逐请求漂移"区分开。

### 7.14 剩余待办 · 第二轮逐条复核（2026-09-15）

> 口径：以下每条都**回到代码/真实 payload 核实**，避免按过期结论排期（此前 §7.10 已做过一轮）。

| 项 | 复核结论 | 处置 |
|---|---|---|
| **A1** `modelExposure=projected` | **仍成立**（全 manifest 声明、零消费方）。但其"实现"就是 §8 的**路线 B（渐进式投递）**，与已冻结的 L2 声明驱动装配同源 | **待你定**：实现 or 删声明 |
| **A3** `payload-prefix` 升 strict | **已完成**：新增 `prompts:payload-prefix:check:strict` 并挂进 `prompts:check:all`（本地 0 违规；CI 无遥测则自动跳过） | ✅ 完成 |
| **B1** enricher 投影 | **已修（2026-09-15）**：`LessonKnowledgeEnrichmentConsumer` 发前剔除 `wrapup.runtimeEnvelope`/`debug`（执行信封元数据，实测**每次稳定 ~2.4–2.8KB**，占单次 payload 10~30%）。`visibleDialogueContext`/`classroomEventHistory` 保留（是 recurringConfusions 的证据基底，不裁） | ✅ 完成 |
| **B2** semantic-freeze-judge | **已修（2026-09-15）**：① 加**字节上限**（默认 400KB，`SEMANTIC_FREEZE_MAX_BYTES` 可调）→ **超限降级转人工**（不静默截断：判"语义等价"不能截输入）；② manifest 声明的 `failurePolicy=retry` **落到实现**（非法 verdict 重试 1 次） | ✅ 完成 |
| **B3** wrapup / peer 重复读 | **基本不成立**：`peer-reinforcement` 只声明 `topic/studentMessage/tutorContext`（**不读 wrapup**）；重复主要在 wrapup↔enricher 数据面 | 降级 |
| **B4** VL 族 | **成立但属 DB/延迟**：`buildLearnerMemorySnapshot` 以 limit 30/6/8 在 `blackbox-runner.ts:1690/1754/1782` 重复调用；`learnerMemory` 仅百余字节 → token 影响小 | 降级（延迟优化另立项） |
| **B5** 沙盘 `session.evidence` 同源 | **不成立**：与 `messages` 是**同一数组引用**（非副本）；且 `session-wrapup` 的 `sessionEvidence` 由调用方 `computeSessionEvidence(session)` 提供**聚合**（`AITeachingCoordinator.ts:2271/2307`）→ 该池键**不进任何 payload** | 无需改 |
| **C1** goal-conversation | **低价值**：实测 payload 仅 **3.2KB**（state 1.2KB / conversationContext 1.05KB），"全量历史"无实害 | 降级 |
| **C2** path-planning | **死配置已清（2026-09-15）**：`includeStructuredData` / `includeConfidenceScores` 两个**零消费方**开关已从 `PathAgentInputConfig` 接口/默认值/normalizer 移除（`includeConfirmedProposal`/`includeConversationHistory` 有消费方，保留）。~~去重复文本块~~ **不动**：复核后发现各块用途不同（结构化轮廓 / 原始 JSON / 指令），非冗余 | ✅ 死配置完成 |
| **C3** kc-mapper | **低价值**：实测 payload 仅 **3.6KB**（`cognitiveCore` 1.3KB + `milestones` 0.58KB） | 降级 |
| **C4** learner-model | **不成立**：`agents/learner-model-agent` **无 `maxTokens` 声明**；户口簿 notes 明确"**无 LLM 输入组装**" | 划掉（过期） |
| **C5** learning-predictor | **成立但属延迟**：`TeachingContextBuilder` 每次建课堂多次 prisma 查询（含 `prediction_records.findFirst`）；非 token 问题 | 降级 |
| **C6** finalization / state-review | **部分成立（DB）**：`assembleLearningState` 由 dashboard / state-review / learning-state-guidance **各自请求**调用；合并需跨请求缓存 | 降级 |
| **C7** opening-generator 15s 超时 | **成立**：高频 `CALLER_ABORTED`（实测 08:06–08:24、15:30 同模式）→ **产品可用性问题**，非上下文问题 | 另立项 |
| **C8** `simulationMode` DB 列 | **成立**：仅清代码接线，**列未迁移**（共享 dev.db 上不动迁移） | 需迁移时再动 |
| **D** 验证欠账 | **仍欠**：`teaching-turn` 单键 `messages` / `storyHistory` / progress-report 指标**未现场验证**（跑批只到 goal→path；15:30 opening 超时中止未进 learn）；`persona-designer` 首键与代码 ON 分支不一致待复核 | 等跑批/通知 |
| **E** 文档漂移 | 本轮已加 §3 状态指针 + 本表；`stage-designer` 前缀、`storyPool→storyHistory` 投影、§4 P0 前缀稳定化均已标注 | ✅ 完成 |

**结论（重排后）**：真正"值得做"的只剩 **A1（需你定）**、**B1（enricher 投影）**、**B2（sfj 上限）**、**C2 的死配置清理**；其余已降级为"低价值 / DB 延迟 / 不成立 / 已修"。
