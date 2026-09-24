# 模型 / 网关配置设计（以模型为中心）

> 状态：P0~P3 已落地；2026-09-24 完成一次全面对账修订（见文末「修订记录」）。
> §2「现状」为写作时点（2026-09-03 前后）快照，已解决项已就地标注——单读 §2 会低估现状。
> 适用范围：`backend/src/gateway/**`、`backend/src/config/models.config.ts`、`backend/src/services/resolve-llm-call-params.ts`、平台/技能/Agent 三层模型配置
> 关联文档：`doc/SKILL_PROTOCOL_V4.md`（skill 运行时契约）、`doc/NON_FUNCTIONAL_GOVERNANCE_PLAN.md`（非功能治理）、`prompts/manifests/README.md`（Prompt 元数据真相源）

---

## 0. 结论（TL;DR）

1. **配置的原子单位是「模型」，不是「技能」也不是「平台」。** 每个模型声明自己的接入信息 + 能力元数据 + 限额；技能/Agent 只引用**逻辑别名**并做最小覆盖。
2. 现状的骨架（多层解析、重试预算、错误分类、attempt 级遥测、健康探针、缓存热生效）**保留**，不推倒重来。
3. 三个真正的缺口：
   - **能力元数据没有闭环**：`models.config.ts` 有能力雏形，但只用来判 `supportsThinking`；思考/输出预算混在一个 `max_tokens` 里。
   - **`maxTokens` 语义错误**（P0 已修）：全局 floor 把每-skill 声明的输出预算**无条件抬到模型硬上限**（deepseek 131072），使 `prompts/core/*.yaml` 的 `params.maxTokens` 全部失效。
   - **没有降级/冷却**：429 进来耗尽重试预算即终局失败；无 fallback、无 circuit breaker（见 `doc/NON_FUNCTIONAL_GOVERNANCE_PLAN.md:760-771`）。
4. 目标形态＝**模型能力注册表 + 别名/部署 + 能力驱动参数构造 + 错误分类可靠性链路**。

> **2026-09-24 对账**：上述三个缺口已全部闭环（能力注册表 + 预算分离 = P0；maxTokens 语义 = P0；降级/冷却 = P1）。本节保留为写作时的动机记录。

---

## 1. 为什么是「以模型为中心」

模型是唯一同时具备**能力差异**（是否支持思考、上下文窗口、输出上限、是否支持工具/JSON）与**运维差异**（供应商、端点、密钥、限流、价格、健康状态）的实体。

三种配置粒度对比：

| 粒度 | 代表字段 | 问题 |
|---|---|---|
| 平台级 | `platform_api_configs.defaultModel` | 一个值管全局，无法按能力分发；改它等于改所有技能行为 |
| 技能级 | `skill_model_configs.model/thinkingMode` | 每个技能都要重复声明"我这个模型支不支持思考/能出多少字"；换模型要改 N 行 |
| **模型级** | `模型.能力元数据 + 限额 + 接入` | 声明一次，所有引用方自动正确；换模型只改一处 |

**判定**：能力（capability）与限额（limits）属于模型；意图（要多少输出、要不要思考）属于调用方（技能/Agent）。二者相乘才是最终请求。

---

## 2. 现状（事实 + 证据）

### 2.1 配置数据模型

| 表 | 真实状态 | 证据 |
|---|---|---|
| `platform_api_configs` | 平台默认端点/密钥/默认模型/思考档；`availableModels`（逗号串）、`chatModels`/`reasoningModels`/`lightModels`（JSON 数组）、`reasoningEndpoint`/`lightEndpoint` **路由层从不读**，仅 api-config 读写回显 | `schema.prisma:97-122`；`apiConfig.service.ts:69-83`；`router.ts:300-312` |
| `skill_model_configs` | 真实生效：`model`/`thinkingMode`/`reasoningEffort`/`endpoint`/`apiKey`/`requestTimeoutMs`/`maxLogicalRetries`；`temperature`/`maxTokens` 已 DEPRECATED（写路径剥离、运行时不再读） | `router.ts:123-189`；`skillModelConfig.service.ts:172-196`；`reliability-settings.service.ts:143-172` |
| `agent_model_configs` | **无任何写入方**，却占据解析第二优先级 → 幽灵优先级 | `router.ts:275-288`；全库无 create/upsert |
| `agent_lab_configs` | 整表被复用为 path/simulation 输入配置的 JSON 容器；`model`/`temperature`/`maxTokens`/`apiKey` 列**无消费者** | `agentConfig.service.ts:95-189` |

### 2.2 解析优先级（现状）

- **路由**（endpoint/key/model/timeout/thinking）：`user-agent-override → user-provider → agent-config → platform 默认 → env`；skill 层在其上做 endpoint/model/thinking/timeout 覆盖（`router.ts:70-121`）。
- **生成参数**（真正发给上游的 model/temperature/max_tokens）：`runtimeOverride → ACTIVE agent_prompts → codeDefaults → routeFallback`（`resolve-llm-call-params.ts:110-146`）。
- `tier` 在 skill 层是**装饰性**字段：`resolveModel` 与 `resolveReasoningModel` 对非空 model 返回同值 ⇒ chat/reasoning 分支等价，`light` 无代码（`router.ts:54-68,136-158`）。
  - **2026-09-24 注**：P2 别名层落地后此条仅在 model 为**具体 id** 时成立；model 为别名（`chat`/`reasoning`/`light`）时 tier 决定是否走 `requireThinking` 能力过滤（见 §4.2），不再是纯装饰。

### 2.3 请求构造与 thinking

```ts
// executor.ts:594-604
const requestBody = { ...request, model: hoisted.model || route.model,
  temperature: hoisted.temperature ?? route.temperature,
  max_tokens: hoisted.max_tokens ?? route.maxTokens };
this.applyThinkingMode(route, requestBody);

// executor.ts:905-915：仅当 supportsThinkingMode(modelId) 才发字段
//   thinkingMode ∈ {enabled,disabled} → thinking: { type }
//   thinkingMode !== 'disabled' 且 reasoningEffort ∈ {low,high,max} → reasoning_effort
```

**无预算概念**：思考消耗与输出消耗共用 `max_tokens`。上游一旦把预算花在 reasoning 上，就出现 `finish_reason=length` + `content` 空。

### 2.4 可靠性（现状）

| 项 | 现状 |
|---|---|
| 传输层重试 | `executor.execute` 内 attempt 循环；指数退避 + 全抖动 + `Retry-After` 下限，单次上限 10s（`executor.ts:183-219,962-971`） |
| 逻辑层重试 | `callPrompt`（解析/校验/空内容失败触发），受 `maxLogicalRetries` 约束（`prompt-composer.ts:227-231,330-342`） |
| 预算 | `maxUpstreamAttempts=10 / maxTransportRetries=5 / maxLogicalRetries=5`（`retry-budget.ts:34-44`） |
| 错误分类 | 11 类；429/5xx/408/425/网络/超时可重试；400/401/402/403 不可（`failure-classification.ts`；`executor.ts:357-373`） |
| **降级** | ~~无~~ → **已解决（P1）**：部署级 cooldown + 模型 fallback 链（见 §4.5） |
| **冷却/熔断** | ~~无~~ → **已解决（P1）**：`deployment-health.ts`（见 §4.5） |
| 超时 | 写作时点：宣称 600s、实际被 300s 截断 → P2② 统一了执行器口径；**2026-09-24 对账发现传输层 `SAFE_HTTP_MAX_TIMEOUT_MS=300_000` 二次钳制漏网**——覆盖 >300s 的 skill/path-planning 调用在 wire 层仍被静默砍半、遥测 `effectiveTimeoutMs` 虚记 600s。已对齐 600s 并加 parity 测试锁死口径（§4.10；根因是传输层整层缺席于本文档与证据索引） |
| 并发 | ~~只有全局 RPM 令牌桶~~ → **已补（P2④）**：per-model 并发闸门（`model-concurrency.ts`）；RPM 现为 platform / virtual-learner 双通道**等待**语义（见 §4.6） |
| 语义失败 | ~~缓冲路径空 `content` 不可重试~~ → **已解决（P1）**：`TRUNCATED_EMPTY_OUTPUT` 判可重试 + 重试时定向关闭思考（非整包翻倍 maxTokens） |

### 2.5 可观测（现状）

- `agent_call_logs`（每逻辑调用：token/status/attempt/maxAttempts/errorCategory/model/sessionId）
- `prompt_call_logs`（tokenUsage/attemptTrace/failureStage）
- `llm_execution_attempts`（**最细粒度**：transportAttemptNo/http/错误类/backoff/retryAfter/超时/TTFT/缓存命中）
- 健康探针：5 金丝雀 skill → `platform_api_configs.connectionStatus/lastCheckedAt`（默认关闭，间隔 120s）
- 成本：`computeCallCostUsd` 只被审计脚本引用；`pricing` 全空 ⇒ 无金额口径

### 2.6 切换模型（现状）

- 入口：`PUT /api/admin/api-config`、`PUT|DELETE /api/admin/skill-model-configs/:skillId`、`PUT /api/user/api-config`
- 热生效：已有（路由缓存 60s TTL + 写入主动失效；prompt 30s TTL）
- 覆盖：skill 级可覆盖模型；虚拟学习者会话可注入 `promptRuntimeOverride`（实验用）
- **缺**：别名层、per-request 覆盖（普通用户）、A/B、per-deployment 健康

---

## 3. 成熟参考

| 概念 | LiteLLM | OpenRouter | Vercel AI SDK | OpenCode |
|---|---|---|---|---|
| 逻辑名 → 物理部署 | `model_name` 组（同组多部署负载均衡） | model slug + provider slug | `customProvider` alias + `fallbackProvider` | `provider/model` + `variants` |
| 解析优先级 | 请求头 > 请求体 > 部署级 > 全局 | provider 偏好 per-request | agent options 覆盖 global options | CLI flag > 配置文件 > 上次使用 > 内部优先级 |
| 能力约束 | `enable_pre_call_checks`（上下文窗口预检） | `require_parameters`（只路由到支持该参数的 provider） | 官方 Model Capabilities 表 | 模型级 `options`（`thinking.budgetTokens` 等） |
| 重试 | `RetryPolicy` 按错误类；`num_retries` 四级覆盖；**SDK 自带重试被锁 0 防平方放大** | — | `maxRetries` + `streamRetries` + `isRetryable` 元数据 | — |
| 冷却 | 429/失败率/非可重试错误 → 部署级 cooldown（`allowed_fails`/`cooldown_time`，可按错误类配） | provider 30s 内故障降权 | — | — |
| 降级 | `fallbacks` / `context_window_fallbacks` / `content_policy_fallbacks` / `default_fallbacks`，`enable_weighted_failover` 先同组后跨组 | 请求体 `models: [...]` 任意错误触发 | `customProvider.fallbackProvider` | — |
| 并发 | per-deployment `max_parallel_requests`（由 rpm/tpm 推导），满了**立即 429 不排队** | — | — | — |
| 记账 | spend log 写 `attempted_fallbacks` / `original_model_group` | 响应 `model` 字段为实际模型 | telemetry hooks | — |

**可迁移的三条硬经验**

1. **`maxOutput` 是能力上限，不是请求参数。** 请求参数由调用方声明，只在越界时 clamp。
2. **错误必须分类处理**：可重试的退避、不可重试的立即失败、429 进冷却；且 provider SDK 自带重试要关掉，避免 `(1+N)²`。
3. **降级必须记账**，否则统计/成本会把降级结果算到主模型头上。

---

## 4. 目标架构

```
① 模型能力注册表   per-model：接入 + 能力 + 限额 + 价格      ← 本设计的中心
② 别名与部署       逻辑名(chat/reasoning/light) → [部署...] + 策略
③ 参数解析         调用方声明意图 → 结合注册表 clamp → 最终请求
④ 请求构造         能力驱动（是否发 thinking / reasoning_effort / 预算分离）
⑤ 可靠性           错误分类 → 退避 → 冷却 → 同别名换部署 → 跨别名降级
⑥ 并发配额         per-model/部署 并发 + rpm
⑦ 可观测           实际模型 / 降级次数 / token / 成本
⑧ 切换与回滚       别名映射热更新 + 变更审计 + 灰度权重
```

### 4.1 ① 模型能力注册表（per-model）

**唯一真源**：`backend/src/config/models.config.ts`（演进到 DB 表 `model_deployments` 时保持同构）。

```ts
export interface ModelDefinition {
  id: string;                      // 逻辑 id（同时是当前默认别名）
  label: string;
  tier: 'chat' | 'reasoning';
  provider: string;
  // —— 接入（单部署时内联；多部署时移到 deployments[]）——
  endpoint?: string;               // 覆盖平台 apiUrl
  apiKeyRef?: string;              // 密钥引用（不落明文）
  realModelId?: string;            // 上游真实模型名（默认 = id）
  // —— 能力 ——
  supportsThinking?: boolean;
  supportsReasoningEffort?: boolean;
  supportsTools?: boolean;
  supportsResponseFormat?: boolean;
  // —— 限额 ——
  contextWindow?: number;
  maxOutputTokens?: number;        // 硬上限（上游），请求参数的上界
  defaultMaxTokens?: number;       // 调用方未声明时的输出预算
  reasoningReserveTokens?: number; // 开启思考时为推理预留的额外预算（与输出预算分离）
  requestTimeoutMs?: number;
  rpm?: number;
  maxParallelRequests?: number;
  // —— 经济性（只读核算，不参与路由）——
  pricing?: ModelPricing;
  description?: string;
}
```

**裁剪记录（2026-09-24 对账）**：已实现的注册表是上述接口的**能力 + 限额 + 经济性半边**（`supportsThinking` / `supportsReasoningEffort` / `maxOutputTokens` / `defaultMaxTokens` / `reasoningReserveTokens` / `fallbacks` / `maxParallelRequests` / `pricing`）。接入半边（`endpoint` / `apiKeyRef` / `realModelId` / `contextWindow` / `supportsTools` / `supportsResponseFormat` / `requestTimeoutMs` / `rpm`）**有意识地未实现**：当前部署是单一聚合网关（所有模型同 endpoint/apiKey），接入信息归平台层（`platform_api_configs`）；引入 per-provider 端点时再按本接口补齐。P0 的「已实现」以本记录为准。

### 4.2 ② 别名与部署

- 业务侧只写**别名**（`chat` / `reasoning` / `light`，或未来的 `fast` / `quality`）。
- 别名 → 部署列表（带 `priority` / `weight` / `enabled`），策略：优先级优先、同级加权。
- **激活现有死字段**：`platform_api_configs.chatModels/reasoningModels/lightModels` 从"回显字段"升级为"别名映射来源"，比新造概念更省。

**已实现（P2 ①）**：
- 别名注册表：`config/models.config.ts` 的 `MODEL_ALIASES`（`chat` / `reasoning` / `light`）+ `getModelAliasMembers`（过滤未注册模型、去重、保序）。
- 纯函数解析：`api-gateway/model-alias.ts` 的 `selectModelForAlias(value, { overrides, requireThinking })`——**能力过滤**（`require_parameters` 思路）：`requireThinking` 时只选 `supportsThinking` 的成员；无成员满足则降级为第一位并标记 `degraded`（请求侧由 `thinking-policy` 自动裁剪字段，不会发错参数）。
- 路由接线：`APIRouter.resolveModel` / `resolveReasoningModel` 展开别名；`getPlatformDefault` 传入 `chatModels/reasoningModels/lightModels` 作为 DB 覆盖（DB 优先于代码注册表）。
- 向后兼容：具体模型 id / 未知值原样返回（非别名 ⇒ 行为与改动前完全一致）。
- **待做**：别名权重与健康感知选路（多部署负载均衡）、管理端可视化。

### 4.3 ③ 参数解析策略（P0 已实现）

**语义修正**：`maxOutputTokens` = 硬上限；`defaultMaxTokens` = 缺省值；声明值 = 权威意图。

```
declared = runtimeOverride ?? ACTIVE agent_prompts ?? codeDefaults ?? routeFallback
if (declared == null)  out = model.defaultMaxTokens ?? GLOBAL_DEFAULT_MAX_TOKENS
else                   out = clamp(declared, MIN_OUTPUT_TOKENS, model.maxOutputTokens)
runtimeOverride 仍享豁免（调试/低耗可显式调小）
```

- 删除了原「floored to model max」分支（`resolve-llm-call-params.ts:157-172`）。
- 效果：`prompts/core/*.yaml` 的 `params.maxTokens`（800 ~ 32000）**首次真正生效**。

### 4.4 ④ 请求构造（能力驱动）

- `thinking` / `reasoning_effort` 只在模型能力声明支持时发送（替代"白名单硬编码"）。
- **预算分离**：`thinking=enabled` 时 `max_tokens = min(声明输出 + reasoningReserveTokens, maxOutputTokens)`，避免推理吃光输出预算。
- 多部署时按 `require_parameters` 思路过滤：**只有支持本次所需参数的部署参与本轮路由**（这解释了历史上 `thinking:{type:"disabled"}` 偶发 400——不是抖动，是路由到了不支持的部署）。

### 4.5 ⑤ 可靠性

```
错误分类
 ├─ 不可重试（400/401/402/403/内容策略）→ 立即失败
 ├─ 可重试（429/5xx/408/425/网络/超时）
 │     └─ 指数退避 + 抖动 + Retry-After 下限（保留现状）
 │           └─ 仍失败 → 该部署进入 cooldown（按错误类配 allowed_fails）
 └─ 耗尽 → 同别名换部署 → 跨别名降级 → default 兜底
```

**已实现（P1）**：
- **部署级 cooldown**：`deployment-health.ts`，键 = `providerId|endpoint|model`；仅「可降级错误类」触发；进程内实现，不引入 Redis。
- **降级链**：模型声明 `fallbacks`（`models.config.ts`）。当前默认：`deepseek-v4-pro → deepseek-v4-flash`、`deepseek-v4-flash → agnes-3.0-flash`（同层互为备份；agnes 无思考能力，由 `thinking-policy` 自动裁剪字段）。限一跳，且仅在 `!streamStarted`（内容未透传）时生效。
- **单端点前提（2026-09-24 补记）**：降级只换 `model`、不换 `endpoint/apiKey`——`deepseek → agnes` 成立的前提是所有模型经由**同一聚合网关**。若将来 per-provider 端点落地，fallback 链必须随部署（endpoint+key）整体切换，否则跨 provider 直接 404。
- **可降级错误类**：`rate_limit` / `provider_http` / `network` / `provider_timeout`；**不含** `quota`（账号/余额级，换模型无效）、`authentication`、`configuration`、`protocol`。
- **降级记账**：失败候选与降级调用**各自成行**（`agent_call_logs`），降级请求上下文带 `ExecutionContext.fallbackFrom`（不发给上游）；冷却中候选会被跳过。
- **语义失败定向重试**：`TRUNCATED_EMPTY_OUTPUT`（`content` 空 且 `finish_reason=length`）判为可重试，重试时**关闭思考**（不是整包翻倍 maxTokens）。
- **未做（留 P2 ④）**：provider 级多部署负载均衡、per-model 并发上限。

### 4.6 ⑥ 并发配额

- 从"全局逻辑调用 RPM 桶"升级为 **per-model/部署** 并发 + rpm；缺省由 `rpm` 推导。
- 满额**立即拒绝**（不排队），拒绝本身不触发 cooldown。

**已实现（P2 ④）**：`api-gateway/model-concurrency.ts`
- 键 = 部署（`providerId|endpoint|model`），计数进程内。
- **默认不限**：未配置 `models.config.maxParallelRequests` 即完全不生效（零行为变化、零开销）。限值是运维决策，不靠猜（成熟参照：LiteLLM `max_parallel_requests`）。
- 超限抛 `LOCAL_CONCURRENCY_LIMIT`（`rate_limit` / 429 / 可重试），与上游 429**同构** ⇒ 直接复用统一的退避与降级链路（配合 §4.5，饱和的主模型可自动让位给 fallback）。
- 槽位在 `finally` 中释放，异常路径不泄漏。
- **待做**：由 `rpm`/`tpm` 自动推导上限、多实例共享计数（需 Redis）。

**RPM 双通道与等待语义（2026-09-24 补记）**：出站 RPM 实为两条独立令牌桶通道——`platformRpmLimiter`（真实用户/平台自身）与 `virtualLearnerRpmLimiter`（`sourceEntry=simulation` 专属），互不共享额度，由 `rpm-limit-config.service` 读 DB 配置并经 scheduler 定时同步。语义与上面的并发闸门**刻意相反**：

| 机制 | 超限行为 | 粒度 | 意图 |
|---|---|---|---|
| RPM 令牌桶 | **排队等待**（令牌按 rpm 速率滴灌，突发≈1 秒容量；不报错） | 逻辑调用（内部重试不加计） | 让自动驾驶自然变慢 |
| per-model 并发闸门 | **立即拒绝**（`rate_limit`/429 同构，进统一退避/降级链路） | 单次上游 attempt | 防我方突发触发上游 429 |

已知小缺口：RPM `acquire()` 不感知调用方 `abortSignal`，已取消的请求仍占排队位（低 rpm 配置下轻微延迟后来者）。

### 4.7 ⑦ 可观测

- `llm_execution_attempts` 增 `deploymentId` / `fallbackIndex`；`agent_call_logs` 增实际模型与原始请求模型。
- 接上 `model-cost.ts`（`pricing` 补齐后）产出金额。

**已实现（P2 ①③⑤）**：
- 降级记账：`agent_call_logs.metadata.fallbackFrom`（复用现有 JSON 列）。
- **只读总览**：`GET /api/admin/model-registry`（`services/model-registry.service.ts`）——读模型统一，汇聚
  ①每个模型的能力与限额（`supportsThinking` / `supportsReasoningEffort` / 输出上限 / 缺省 / 推理预留 / 并发上限）、
  ②别名映射（成员、DB 覆盖声明、默认选中、`requireThinking` 下的选中与降级标记）、
  ③平台默认模型的**解析结果与来源**（别名 / 具体 / 未配置）、
  ④降级链、⑤**当前冷却中的部署**（进程内快照）、⑥配置漂移告警（未注册模型、别名为空、模型未被引用、废弃 `prompt.model` 副本数）。
  该接口**不做写操作**（方案 B），模型能力仍以代码注册表为唯一写源。
- **成本金额已接线**：`services/cost/call-cost-aggregation.ts`（纯函数）提供按模型/会话/技能/节点的金额聚合，
  管理端 `routes/admin/token-cost.ts` 的排行条目与 `totals` 追加 `usd / pricingKnown / callsMissingPricing / pricedCalls`，
  响应顶层新增 `pricingStatus`（列出「已配置 / 待补单价」模型）；前端成本 tab 有金额条。
  **单价未配置时 `usd: null` 且显示「单价未配置」，绝不用 0 冒充**（`models.config.pricing` 仍为空，待财务权威单价）。
- **待做**：`llm_execution_attempts` 增 `deploymentId` / `fallbackIndex` 真列；补权威单价；成本金额条与内嵌组件的
  时间窗口对齐；`bySession` 增加会话维度端点。

**遥测写路径分流（2026-09 性能整改补记）**：`telemetry-writer.service` 中 `createAgentCall` / `createPromptCall` 为**后台写**——调用时同步发起底层 INSERT 但调用方不等待（失败仅 warn，业务语义不变）；两表携带 userPayload / rawModelOutput 大文本，await 内联在 LLM 响应关键路径上会被 SQLite 单写者竞争放大 SSE 完成延迟。`createLlmAttempt` 保持 **await**：其成败经 `attemptTelemetryComplete` 汇总写入 `agent_call_logs.metadata`，管理端执行日志据此标注 dataCompleteness，不能乐观化。`flush()` 供优雅关闭/测试等待在途后台写落盘。

### 4.8 ⑧ 切换与回滚

| 需求 | 手段 |
|---|---|
| 切模型 | 改别名的一个映射项（**已支持热生效**：60s TTL + 主动失效） |
| 回滚 | 改回映射；变更写 `node_config_changes` 审计 |
| 灰度 | 别名权重 + 会话粘性（复用现有 `sessionId`） |
| 验证 | per-deployment 健康探针（现有探针只到平台级，需下沉） |

**2026-09-24 补记**：
- **启动金丝雀已移除**：健康快照改由周期探测（开关开启时）或手动「立即探测」生成，进程启动不再向模型服务发真实请求（dev 热重载下尤其浪费）；见 `bootstrap/gateway.ts` 的 `syncCapabilityProbeSettings`。
- **实验钉扎（prompt-lab）**：`promptRuntimeOverride.routeOverride` 支持 `expectedProviderId` + `expectedCredentialFingerprint`（route.apiKey 的 SHA-256）双校验——实验期间路由漂移或换钥即拒绝执行，防实验结果串线；`privateNetworkPolicy` 只能收紧不能放宽。

---

### 4.9 提示词工件（prompt artifact）vs 模型绑定的边界

**原则**：**文本 + 意图（intent）归提示词工件；绑定 + 能力（binding / capability）归模型层；提示词工件永远不承载 `model`。**

两种流派都存在且都成熟：

| 流派 | 代表 | 做法 | 成立条件 |
|---|---|---|---|
| **Prompt-Ops（捆绑派）** | LangSmith Prompt Hub、Humanloop、PromptLayer、Langfuse、Braintrust | prompt 版本**捆绑** model + 参数 | 发布单元＝"这条 prompt 配这套设置"，A/B 与回滚需要整体一致 |
| **SDK / Gateway（分离派）** | Vercel AI SDK（`generateText({model, prompt})`）、OpenCode（agent config 指定 model）、LiteLLM、LangChain `init_chat_model` | 模型独立成注册表，prompt 只是文本 | 换模型不动 N 条 prompt；能力/限额/降级集中一处 |

两者在生产的**收敛点一致**：prompt 可以携带「意图」，但**不能携带「绑定」**；意图在构造请求时由模型能力 **clamp**（即 §4.3 / §4.4）。

字段归属：

| 参数 | 归属层 | 判定 |
|---|---|---|
| 正文 / rules / fields | 提示词工件 | 保留 |
| `temperature` | 提示词工件（意图） | **保留**（抽取类 0.2 vs 创作类 0.9，是真·prompt 属性） |
| `maxTokens` | 提示词工件（预算**请求**） | **保留**，由模型 `maxOutputTokens` clamp（§4.3） |
| `failurePolicy` / 输出契约 | 提示词工件（意图） | 保留 |
| **`model`** | **模型层（绑定）** | **禁止出现在提示词工件** |
| `thinkingMode` / `reasoningEffort` | 模型层（绑定，按能力推导） | 不在 prompt；由 `thinking-policy` 决定（§4.4） |
| `endpoint` / `apiKey` / `timeout` / `retries` | 模型 / 路由层 | 不在 prompt |

**本仓库实测到的反例（2026-09）**：

| 事实 | 数值 / 证据 |
|---|---|
| ACTIVE `agent_prompts` 带 `model` 副本 | **30 / 30** |
| `skill_model_configs` 显式指定 model | 18 / 23 |
| seed 写模型绑定 | `seed-core-agent-prompts.ts` → `model: defaultModel \|\| null`（发布路径写 `null` ✓，seed 写副本 ✗） |
| 解析顺序后果 | `routeModelExplicit ? [override, route, prompt, code] : [override, prompt, code, route]` ⇒ **无 skill 级绑定（model 为空）的 12 个技能被 `prompt.model` 副本压过平台默认** ⇒ 改平台 `defaultModel` 对这 12 个技能无效 |

**落地（本次已实现）**：

1. **解析顺序**收敛为 `runtimeOverride > route > codeDefaults > prompt.model`；`prompt.model` 降为**最后兜底**，`routeModelExplicit` 开关删除（不再需要）。
2. **seed 不再写模型绑定**：`agent_prompts.model` 恒为 `null`；`matchesSeedConfig` 不再把 `model` 纳入漂移比较（历史副本不会阻止/触发重新 seed）。
3. **prompt-ops 预览解析器**不再回读 `row.model` / `active.model`（预览用显式指定或平台默认模型）。
4. **读模型统一（单一视图）**：`skill-runtime-contract.service` 的 `llmRequest` 增加 `deprecatedPromptModel`，管理端可据此提示清理历史副本。
5. **无行为变化**：当前平台 `defaultModel` 与 30 条副本同为 `deepseek-v4-flash`，因此顺序调整**当天零差异**；但它解锁了"改一处即全量生效"。
6. **清理历史副本（已完成）**：`scripts/clear-deprecated-prompt-model.ts`（默认 dry-run，`--apply` 才写库；幂等；先备份 `system.db`）已于 2026-09-19 清理 **30 条** ACTIVE 行的 `model` 副本 ⇒ 只读总览的 `deprecatedPromptModelCount = 0`；`skill_model_configs.model`（18 条）未触碰。

**不做**：不删 `agent_prompts.model` 列（保留兼容与审计）；不把 `temperature/maxTokens` 搬出提示词工件（捆绑派理由成立：审查局部性、回滚粒度、作者上下文）。

### 4.10 传输层（safe-http）——2026-09-24 对账补册

传输层此前整层缺席于本文档（附录 A 证据索引也只指向 executor / reliability-settings），直接导致「超时口径统一」在 executor 层打勾而 `safe-http` 的二次钳制漏网（见 §2.4 超时行）。补册如下（`utils/safe-http.ts`，缓冲与流式共用同一安全基线）：

- **SSRF 基线**：所有外呼经 `validateExternalUrl`——协议白名单（生产强制 HTTPS；非生产允许 HTTP 以兼容明文部署的第三方网关，私网仍由 IP 校验拦截）、禁 URL 内嵌凭证、`localhost/.localhost` 与 IP 字面量直接校验、域名解析后**逐地址**校验（`isAlwaysBlockedAddress` 黑名单 + `isLocalOrPrivateAddress` 私网段）、NAT64/ISATAP/IPv4 映射等内嵌 IPv4 提取防绕过。
- **DNS pinning**：校验通过的地址钉死进 Agent 自定义 lookup——连接只会拨向已校验地址，杜绝「校验时公网、连接时重绑定」的 TOCTOU 窗口。代价是每次调用一次纯验证用 DNS 查询（已知调优点：可按 hostname 短 TTL 缓存，防线不受影响）。
- **私网策略**：`privateNetworkPolicy: 'runtime' | 'public-only'`。用户自带端点（`user-provider` / `user-agent-override`）**强制 `public-only`**，平台路由默认 `runtime`（可按主机白名单授权私网）；route override 只能收紧不能放宽。
- **重定向**：跨源重定向禁止携带敏感头（authorization / cookie / api-key 等）；每跳重新过 `validateExternalUrl`。
- **keep-alive 连接池**：按「已校验地址」（`family:address`）复用 http/https Agent（`keepAliveMsecs=15s`、`maxSockets=64`、`maxFreeSockets=8`，池上限 128）——同源重试 / fallback / 高频对话复用 TCP+TLS，省 1~2 个握手 RTT，TTFT 直接受益；池满整体重建是防御性降级（仅多上游场景可能触达）。
- **超时模型**：缓冲请求 = 单一总死线（含 DNS 与重定向）；流式请求 = TTFT 预算（响应头就绪）+ 空闲超时（chunk 间隔，默认 60s）+ 累计字节上限。两者均受 `SAFE_HTTP_MAX_TIMEOUT_MS` 钳制——**必须与 `RETRY_BUDGET_HARD_LIMITS.maxRequestTimeoutMs` 一致**，由 parity 测试锁死（utils 层不反向 import gateway，口径一致性靠用例）。
- **响应体上限**：缓冲 10MB（axios maxContentLength）、流式 20MB，超限抛 `SafeHttpBodyLimitError`（不可重试 protocol 类）。

### 4.11 全流式执行模型——2026-09 对账补册

文档成文后最大的执行模型变化：**所有 LLM 调用默认以流式发出**（`callPrompt` 的 `streamRequested = context.stream !== false`，探测等场景可显式关闭）。

- **请求形态层与透传层解耦**：默认全部走上游 SSE（更早收到首字节、TTFT 可观测）；但「逐字透传给客户端」仅当调用方注入流式意向（`streamRequest.enabled`）且输出 media 为 markdown/text 时启用。同请求首个透传调用消费 `streamRequest.consumed`，后续调用自动降级为整包（JSON 契约类输出不受影响）。
- **重试门闩**：流式路径仅「首字节（首个内容增量）之前」可重试；`streamStarted` 置位后，传输重试与模型降级全部停用——否则客户端收到两段拼接内容，且 HTTP 200 已提交无法改状态码。
- **provider 兼容**：不识别 `stream_options` 报 400 的 provider 自动去参重试一次（不消耗重试预算）；声明流式但 provider 返回完整 JSON 的回退缓冲解析；返回 event-stream 头却无 SSE 事件判 `INVALID_STREAM_RESPONSE`。
- **逻辑重试 restart**：校验失败触发生成重试时，已透传场景先发 `restart` 事件清空客户端已显示内容，防新旧拼接。
- **遥测复用**：流结束时合成与缓冲路径一致的 ChatResponse（id/model/usage/finish_reason），attempt 级遥测原样复用；TTFT 与 KV 前缀缓存命中随 attempt 落库。

---

## 5. 关键决策与取舍

| 决策 | 取舍 |
|---|---|
| 能力元数据放代码常量而非 DB | 起步快、可 review、可单测；DB 化留到需要管理端编辑时（保持同构，迁移成本低） |
| `maxTokens` 改为"声明优先" | 会显著降低实际输出预算（131072 → 800~32000）。**这是修正而非回归**；若某技能截断，应显式提高其 `prompts/core/*.yaml` 的 `maxTokens`，而不是退回全局 floor |
| `runtime-override` 保持豁免 | 调试链路不受 clamp 影响；代价是越界由调用方负责 |
| 降级链默认"同别名优先" | 先换部署（同模型不同区域/key）再换模型，避免质量漂移 |
| 不做多租户预算/计费 | 当前无此需求，`pricing` 留空即"金额未知"，不用 0 冒充 |

---

## 6. 分阶段实施

| 阶段 | 内容 | 状态 | 涉及文件 |
|---|---|---|---|
| **P0** | 能力注册表（per-model）+ `maxTokens` 语义修正 + thinking 预算分离 | **已实现** | `config/models.config.ts`、`services/resolve-llm-call-params.ts`、`gateway/api-gateway/executor.ts` |
| **P1** | 部署级 cooldown + fallback 链 + `TRUNCATED_EMPTY_OUTPUT` 分类与定向重试 | **已实现** | 新增 `api-gateway/deployment-health.ts`；`api-gateway/executor.ts`；`config/models.config.ts`（`fallbacks`） |
| **P2** | ①别名层（code 注册表 + DB 覆盖 + 能力过滤）✅ ②超时口径统一 ✅（**2026-09-24 复核补遗**：executor 层当时确已统一，但传输层 `SAFE_HTTP_MAX_TIMEOUT_MS=300s` 二次钳制漏网，覆盖 >300s 的调用仍被砍半且遥测虚记——已对齐 600s + parity 测试补锁，见 §2.4/§4.10） ③降级记账 ✅ ④per-model 并发闸门（默认不限）✅ ⑤只读总览 API（方案 B）✅ | **已完成** | `config/models.config.ts`、`gateway/api-gateway/{model-alias,model-concurrency}.ts`、`services/model-registry.service.ts`、`routes/admin/model-registry.ts` |
| — | **未采纳**：能力元数据 DB 化（方案 A：新建 system 表 + 迁移）——模型能力仍以代码注册表为唯一写源；`frontend` 展示待空窗期 | — | — |
| **P3** | 管理端可视化：**已做** —— ①`模型总览` tab（只读，消费 `/api/admin/model-registry`：默认解析 / 别名映射与降级标记 / 能力与限额 / 部署冷却 / 配置提示）②「路由默认」由 `<select>` 改为可输入的别名候选（`chat`/`reasoning`/`light`，候选来自后端注册表，未拉取清单也能填）③执行日志成本 tab 金额条（缺单价显示「未配置」）。**未做**：金额条与内嵌组件时间窗口对齐、`bySession` 端点、别名成员可视化编辑（方案 A 未采纳） | **基本完成** | `frontend/src/views/admin-redesign/{ApiConfig.vue,ModelRegistryOverview.vue,ExecLogs.vue}`、`frontend/src/api/adminApi.ts`、`services/cost/call-cost-aggregation.ts` |

**P0 验收**：
- `npx jest src/services/__tests__/resolve-llm-call-params.test.ts src/gateway --runInBand` 全绿
- 断言：声明值 800 最终 `max_tokens=800`（不再被抬到 131072）；未声明时取 `defaultMaxTokens`；超过模型上限被压回；`runtime-override` 仍豁免

---

## 7. 基准回归

P0 之后，用现有虚拟学习者基准做一次对照（同一语料、同一口径）：

```bash
node scripts/vl-preset-run.mjs --concurrency=1 --retries=3 --backoff=60
node scripts/vl-ai-audit.mjs --tag=builtin --story=first --phase=both --runs=3 --concurrency=2
```

关注指标：**空内容率、429 失败率、截断（`finish_reason=length`）导致的解析失败率、单位调用 token 消耗**。

---

## 8. 明确不做

- 不做多租户预算/计费系统（`pricing` 仅只读核算占位）。
- 不引入 Redis（cooldown 先进程内；多实例时再评估）。
- 不改 skill 的业务重试语义（`retryStrategy` 归 skill 契约，网关只管传输可靠性）。
- `agent_model_configs` 的"幽灵优先级"——**决定（2026-09-24 落笔，此前 P2 悬空未决）：从解析链摘除**。理由：全库无任何业务写入方（仅 Prisma 生成类型与历史手工行），该优先级使路由冷路径多一次查询且语义误导。执行挂后续网关批次（需同步调整 `router.test.ts` 优先级链用例与 `model-registry.service` 的漂移提示口径）；执行前该分支保持现状（表空时行为不变）。
- 不把 `models.config.ts` 直接改成 DB 表（P2 再迁，保持同构）。

---

## 附录 A · 现状证据索引

> 2026-09-24 起**废除行号引用**（行号随改动腐烂，且行号索引不全曾直接导致整改提前打勾——传输层缺席于本索引使「超时口径统一」漏检），统一使用符号引用。

| 主题 | 证据（符号引用） |
|---|---|
| 平台配置字段消费 | `api-gateway/router.ts#getPlatformConfigRecord / getPlatformDefault / resolvePlatformApiKey`；`services/apiConfig.service.ts` |
| skill 配置读写 | `api-gateway/router.ts#getSkillConfig`；`services/skillModelConfig.service.ts` |
| 幽灵表 | `api-gateway/router.ts#getAgentConfig`；`services/model-registry.service.ts`（漂移提示） |
| 生成参数优先级 | `services/resolve-llm-call-params.ts#resolveLlmGenerationParams` |
| maxTokens floor（已修） | 同上（「输出预算策略」分支） |
| thinking 映射 | `api-gateway/thinking-policy.ts#buildThinkingPolicy`；`config/models.config.ts#ModelDefinition` |
| 重试/退避/预算 | `api-gateway/executor.ts#execute / resolveBackoffMs`；`api-gateway/retry-budget.ts#RETRY_BUDGET_HARD_LIMITS / consumeUpstreamAttempt` |
| 错误分类 | `api-gateway/failure-classification.ts#GatewayExecutionError / parseRetryAfterMs`；`executor.ts#classifyTransportError` |
| 语义失败 | `executor.ts#parseChatResponseBody`（TRUNCATED_EMPTY_OUTPUT）；`composers/prompt-composer.ts#callPrompt` validation_failed 分支 |
| **超时口径** | `api-gateway/retry-budget.ts#RETRY_BUDGET_HARD_LIMITS.maxRequestTimeoutMs`；`utils/safe-http.ts#SAFE_HTTP_MAX_TIMEOUT_MS`；`utils/__tests__/safe-http.test.ts` parity 用例（三处必须一致） |
| **传输层 / SSRF** | `utils/safe-http.ts#validateExternalUrl / getPinnedAgentPair / safeHttpRequest / safeHttpStreamRequest`；`utils/__tests__/safe-http*.test.ts` |
| **全流式执行** | `composers/prompt-composer.ts#callPrompt`（streamRequested/streamDeltaEligible）；`executor.ts#executeStreamRequest`；`utils/sse-parser.ts` |
| **RPM 双通道** | `api-gateway/rpm-limiter.ts`；`services/rpm-limit-config.service.ts`；`api-gateway/index.ts#execute`（通道选择） |
| 并发闸门 | `api-gateway/model-concurrency.ts`；`config/models.config.ts#maxParallelRequests` |
| 降级/冷却 | `api-gateway/deployment-health.ts`；`executor.ts#execute`（fallback 段）；`config/models.config.ts#fallbacks` |
| 可观测表 | `prisma/schema.prisma`（agent_call_logs / prompt_call_logs / llm_execution_attempts） |
| **遥测写路径分流** | `services/telemetry-writer.service.ts`（后台写 vs await 语义注释 + flush） |
| 健康探针 | `services/ai-capability-health.service.ts`；`bootstrap/gateway.ts#syncCapabilityProbeSettings`（金丝雀移除说明） |
| 缓存热生效 | `api-gateway/cache.ts`（TTL + 惰性清扫）；`gateway/api-gateway/index.ts#invalidateCache` 的 16 个变更点接线 |
| 路由钉扎（实验） | `gateway/api-gateway/index.ts#applyRouteOverride`；`api-gateway/types.ts#RouteExecutionOverride` |

## 附录 B · 参考

- LiteLLM Router / Fallbacks / Cooldowns：<https://docs.litellm.ai/docs/routing>、<https://docs.litellm.ai/docs/proxy/reliability>
- OpenRouter Provider Routing / Model Fallbacks：<https://openrouter.ai/docs/features/provider-routing>、<https://openrouter.ai/docs/guides/routing/model-fallbacks>
- Vercel AI SDK Provider & Model Management / Error Handling：<https://ai-sdk.dev/docs/ai-sdk-core/provider-management>、<https://ai-sdk.dev/docs/ai-sdk-core/error-handling>
- OpenCode Models（provider / variants / 加载优先级）：<https://opencode.ai/docs/models/>

---

## 修订记录

- **初稿 ~ P2（2026-09-03 前后）**：设计定稿；P0（能力注册表 / maxTokens 语义 / 预算分离）、P1（cooldown / fallback 链 / 语义失败定向重试）、P2（别名层 / 超时口径 / 降级记账 / 并发闸门 / 只读总览）落地，P3 管理端基本完成。
- **2026-09-24（对账修订）**：逐环节通读网关实现（gateway 14 文件 + callPrompt + resolve-llm-call-params + safe-http + 遥测）后对账，四类动作：
  1. **修复**：传输层 `SAFE_HTTP_MAX_TIMEOUT_MS` 300s → 600s 对齐 `RETRY_BUDGET_HARD_LIMITS.maxRequestTimeoutMs`（P2② 打勾时漏网的二次钳制；覆盖 >300s 的 skill / path-planning 调用此前在 wire 层被静默截断、遥测 `effectiveTimeoutMs` 虚记），加 parity 测试锁死口径。
  2. **补册**：新增 §4.10 传输层（safe-http 整层此前缺席，即本次超时漏检的根因）与 §4.11 全流式执行模型；§4.6 补 RPM 双通道与「等待 vs 拒绝」分层语义；§4.7 补遥测写路径分流；§4.8 补启动金丝雀移除与 prompt-lab 实验钉扎；§4.5 补降级单端点前提；§4.1 补接入字段裁剪记录；§2.2 补 tier 装饰性失效注记。
  3. **落笔**：§8 幽灵优先级决定（**摘除**，执行挂后续网关批次）；§0 / §2.4 快照项就地标注已解决；§6 P2② 补复核补遗；头部状态行更新。
  4. **证据索引**：附录 A 全面符号化（行号引用废除，并写明行号索引不全曾是漏检根因），新增传输层 / 全流式 / RPM / 遥测分流 / 路由钉扎五行。
- **已知未做（有意保留，2026-09-24 评审确认）**：路由冷路径串行查询可并行化（有 60s 缓存兜底）；验证用 DNS 解析可按 hostname 短 TTL 缓存（连接已钉地址，防线不变）；RPM `acquire()` 不感知 abortSignal；`persistAttempt.requestBytes` 与 `sanitizeRequest` 的大字符串可先截再串；遥测对「流式被 provider 回退 JSON」仍记 executionMode=stream。
