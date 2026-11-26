# 模型 / 网关配置设计（以模型为中心）

> 📌 类型：活规范（网关 SSOT：模型注册表、路由解析、生成参数、可靠性与传输层的现行规则）｜索引见 [doc/README.md](./README.md)。

> 适用范围：`backend/src/gateway/**`、`backend/src/config/models.config.ts`、`backend/src/services/resolve-llm-call-params.ts`、平台/技能/Agent 三层模型配置
> 关联文档：`doc/SKILL_PROTOCOL_V4.md`（skill 运行时契约）、`prompts/manifests/README.md`（Prompt 元数据真相源）
> 口径：模型能力与限额以 `backend/config/llm-providers.json` 为准，表结构以 `backend/prisma/system/schema.prisma` 为准；代码入口见附录 A。

---

## 0. 结论（TL;DR）

1. **配置的原子单位是「模型」，不是「技能」也不是「平台」。** 每个模型声明自己的能力元数据与限额；技能 / Agent 只引用模型（或逻辑别名）并做最小覆盖。
2. **平台只有一个默认模型。** 平台默认只认 `platform_api_configs.defaultModel`（未配置时 `AI_MODEL` 兜底）；某个 Skill 要不要长思考由它的 `thinkingMode` / `reasoningEffort` 决定，而不是「推理档换一个模型」——`tier` 不参与模型选择。
3. **能力归注册表，意图归调用方。** 能力（能不能思考、认哪几档强度、输出上限、能不能读图）与限额（并发）在 `backend/config/llm-providers.json` 里逐模型声明一次；意图（要多少输出、要不要思考、温度）由提示词工件或 Skill 配置声明。请求 = 二者相乘，越界由能力 clamp（§4.3 / §4.4）。
4. **默认模型不物化到下游配置。** 注册表文件的 `defaults` 只做展示与自洽校验，运行时默认不读它；`seed-skill-model-configs` 不写 `model`（空 = 继承基础路由模型）；`agent_prompts.model` 是废弃副本，只作最后兜底（§4.9）。
5. **可靠性 = 错误分类 + 退避 + 重试预算，预算耗尽即终局失败。** 不做降级、冷却、熔断，也没有后台健康探针：失败就报错，由调用方决定是否重发（§4.5）。
6. **已知未收敛**：`agent_model_configs` 表保留但不在解析链上；`user_agent_model_configs` 无管理界面；别名成员的 DB 覆盖（`chatModels` / `reasoningModels` / `lightModels`）优先于文件，但管理台没有编辑入口。

---

## 1. 为什么是「以模型为中心」

模型是唯一同时具备**能力差异**（是否支持思考、上下文窗口、输出上限、是否支持工具/JSON）与**运维差异**（供应商、端点、密钥、限流、价格）的实体。

三种配置粒度对比：

| 粒度 | 代表字段 | 问题 |
|---|---|---|
| 平台级 | `platform_api_configs.defaultModel` | 一个值管全局，无法按能力分发；改它等于改所有技能行为 |
| 技能级 | `skill_model_configs.model/thinkingMode` | 每个技能都要重复声明"我这个模型支不支持思考/能出多少字"；换模型要改 N 行 |
| **模型级** | `模型.能力元数据 + 限额 + 接入` | 声明一次，所有引用方自动正确；换模型只改一处 |

**判定**：能力（capability）与限额（limits）属于模型；意图（要多少输出、要不要思考）属于调用方（技能/Agent）。二者相乘才是最终请求。

---

## 2. 配置数据模型与解析链

### 2.1 配置表：谁生效、谁不生效

| 表 | 现行作用 | 不参与运行时的列 |
|---|---|---|
| `platform_api_configs` | 平台默认端点 / 密钥 / 默认模型；生成默认（`defaultThinkingMode` / `defaultReasoningEffort` / `defaultResponseFormat` / `defaultTemperature` / `defaultMaxTokens`）；`chatModels` / `reasoningModels` / `lightModels` 是别名的 DB 覆盖来源（§4.2） | `defaultReasoningModel`、`defaultEvaluationModel`、`availableModels`；`reasoningEndpoint` / `lightEndpoint` 只参与密钥匹配、不选端点；`connectionStatus` / `lastCheckedAt` 只由管理台保存时的连接结果写入，没有后台探针 |
| `skill_model_configs` | `model` / `thinkingMode` / `reasoningEffort` / `endpoint` / `apiKey` / `requestTimeoutMs` / `maxLogicalRetries` / `enabled` / `paramOverrides` 生效 | `temperature` / `maxTokens` 列已废弃（由 `paramOverrides` 取代，写路径剥离）；`fallbackChain` 不读写；`tier` 不参与模型选择 |
| `agent_model_configs` | 不在解析链上；唯一写方是迁移脚本 `scripts/migrate-database-secrets.ts` | 整表 |
| `provider_secrets`（system 库） | 管理台填写的供应商密钥密文（AES-256-GCM，AAD=`system.provider_secrets.apiKey`） | — |
| `agent_lab_configs` | 复用为 path / simulation 输入配置的 JSON 容器 | `model` / `temperature` / `maxTokens` / `apiKey` 列无消费者 |

### 2.2 解析链总览

- **路由**（endpoint / key / model / timeout / thinking）：`user-agent-override → user-provider → platform 默认 → env 兜底`；skill 层在其上覆盖（§4.2）。
- **生成参数**（真正发给上游的 model / temperature / max_tokens）：`runtimeOverride → skill-override → ACTIVE prompt → codeDefaults → routeFallback`；其中 `model` 的层级不同（§4.3）。

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

**可迁移的两条硬经验**

1. **`maxOutput` 是能力上限，不是请求参数。** 请求参数由调用方声明，只在越界时 clamp。
2. **错误必须分类处理**：可重试的退避、不可重试的立即失败；且 provider SDK 自带重试要关掉，避免 `(1+N)²`。

冷却、降级与权重路由在本平台**不采用**（§4.5、§8）；上表保留作为术语与取舍的参照。

---

## 4. 架构

```
① 模型注册表     llm-providers.json：供应商 → 模型能力 + 限额 + 单价（File-as-Truth）   ← 本设计的中心
② 路由解析与别名  用户 / 技能 / 平台三层解析 → 别名展开 → 供应商端点
③ 参数解析       调用方声明意图 → 结合注册表 clamp → 最终请求
④ 请求构造       能力驱动（thinking / reasoning_effort / 预算分离 / system 折叠 / 视觉闸门）
⑤ 可靠性         错误分类 → 退避 → 预算耗尽即终局失败
⑥ 并发配额       per-model 并发闸门 + RPM 多通道
⑦ 可观测         attempt 级遥测 / 实际模型 / token / 成本
⑧ 切换与回滚     配置热生效 + 注册表热重载与写前备份 + 实验钉扎
```

### 4.1 ① 模型注册表（per-model）

**唯一真源**：`backend/config/llm-providers.json`；加载器 `backend/src/config/models.config.ts`。

```
providers.{providerId} = { name, enabled?, recommended?, baseUrl?, apiKeyEnv?, supportsSystemRole?, models: { modelId: 能力表 } }
aliases   逻辑别名 → 模型 id 列表
defaults  { chat, reasoning } —— 只做展示与自洽校验，运行时默认不读（§0）
$header / $rules  规则原文；管理台编辑不改动
```

```ts
export interface ModelDefinition {
  id: string;
  label: string;
  tier: 'chat' | 'reasoning';        // 仅分类展示，不参与模型选择
  providerId: string;
  providerEndpoint?: { baseUrl: string; apiKeyEnv: string }; // 供应商自带端点时存在
  supportsThinking?: boolean;        // 不声明 ⇒ thinking / reasoning_effort 一律不发
  reasoningEfforts?: string[];       // 这台模型认哪几档 reasoning_effort；空 = 不支持该字段
  vision?: boolean;                  // 能否读图（§4.1a）
  maxOutputTokens?: number;          // 输出硬上限（上游），请求参数的上界
  defaultMaxTokens?: number;         // 调用方未声明输出预算时的缺省值
  reasoningReserveTokens?: number;   // 开启思考时为推理额外预留的预算（与输出预算分离）
  maxParallelRequests?: number;      // 本地并发上限；不配置 = 不限
  pricing?: ModelPricing;            // USD / 1M tokens；只用于只读成本核算
  defaultThinkingMode?: 'default' | 'enabled' | 'disabled'; // 模型级生成默认
  defaultReasoningEffort?: string;   // 必须落在本模型 reasoningEfforts 里
  defaultResponseFormat?: 'default' | 'none' | 'json_object';
}
```

注册表不含 per-model 的上下文窗口、工具支持、超时与 rpm 字段。

**加载与失败语义**

- 启动时解析并校验，摊平进 `AVAILABLE_MODELS` / `MODEL_MAP` / `MODEL_ALIASES` / `MODELS_BY_TIER`（原地更新，引用不失效），下游消费方零改动看到自定义模型。
- 文件缺失 = 内置兜底目录（fresh clone 可启动）；文件存在但非法 = **fail-loud** 拒绝启动；运行期热重载失败 = 保留上一次好目录 + 日志 + 总览告警。
- 热重载：`APIRouter.resolve()` 每次解析前 `reloadLlmProvidersIfChanged()`（mtime 变更才重读；管理台写接口用 `force`）；路径可用 `LLM_PROVIDERS_CONFIG` 环境变量覆盖。

**校验规则（违反即拒绝加载）**

- 声明 `baseUrl` 必须带 `apiKeyEnv`，继承通道不得声明 `apiKeyEnv`；**密钥只走环境变量或 `provider_secrets`，严禁写进文件**。
- 声明了 `reasoningEfforts` 必须同时 `supportsThinking: true`；`defaultReasoningEffort` 必须在其 `reasoningEfforts` 内。
- 挡位词只校验形态（`/^[a-z0-9][a-z0-9._+-]{0,31}$/i`），落盘前 trim + 小写；**不按平台词表卡**——`COMMON_REASONING_EFFORTS` 只用于界面提示与旧数据折算。
- 数值字段（`maxOutputTokens` 等）与 `pricing` 费率出现即必须是正有限数；`pricing` 缺省 = 金额未知。
- 至少有一个 `enabled` 的 provider 提供模型。
- 已下线模型 id（`deepseek-v4-flash`、`deepseek-v4-pro`）不得回到兜底目录、回显与写入校验（`isRetiredModelId`）。

**模型引用**

- **裸 id**（`deepseek-v4.1-flash`）：历史 DB 配置全是这种。**多通道重名合法**（同一模型经平台聚合网关与用户自建供应商各服务一份）：裸 id 取声明在前的启用通道（first-wins），总览发歧义告警。
- **限定式** `providerId/modelId`：仅当命中已注册供应商 + 目录内模型才按限定式解析，否则整体按字面量处理（聚合网关自带 `/` 的模型 id 不误伤）。请求空间只认裸 id——限定式在路由层还原为上游字面 id。
- **未命中注册表 = 字面量透传**：未知 id 原样发给上游，等价于「无能力声明」。

**接入信息的归属**：平台继承通道（`endpointSource: 'inherit'`，无 `baseUrl`）的接入信息归 `platform_api_configs`；供应商自带端点用 `baseUrl` + `apiKeyEnv`（§4.2）。

#### 4.1a 视觉能力（`vision`）

网关端点**不提供能力声明**（`GET /v1/models` 只有 `supported_endpoint_types`），因此「这个模型能不能读图」由本注册表声明、由探针把关：

- **声明**：`llm-providers.json` 的模型条目加 `"vision": true`（当前：`deepseek-v4.1-flash`、`agnes-3.0-flash`；实测两者都能读图）。
- **把关**：`npm run vision:probe [-- --model=<id>] [--stream] [--history-image] [--image=<path>]`
  —— 内置确定性图案（左红最窄 / 中绿最宽 / 右蓝居中）+ 四项判据（颜色、顺序、最宽=绿、最窄=红），
  颜色顺序说反或宽度归属读错都会 FAIL，避免"配了但读不了图"静默上线。
- **硬闸门**：请求含图片块而**最终生效模型**未声明 `vision` → 网关在发上游前直接拒绝
  （`MODEL_VISION_UNSUPPORTED`，可执行提示：声明 + 探针命令），不静默丢图、不让上游 400 掩盖真因。
- **可选上下文的优雅降级**：prompt-composer 知道生效模型，未声明 vision 时把消息里的图片块摘掉
  （文本保留）并告警——课堂配图随历史回流属可选上下文，模型无视觉时应退成无图课堂继续跑，
  而不是把教学链路打挂。保存技能模型绑定时（`admin/skill-model-configs`）同口径给可见 warning。
- **上游形态约束（实测）**：把 `image_url` 内容块挂在 **`role:'assistant'` 消息**上会被上游拒收
  （先挂起 100+s 再 400 `invalid_request`，`vision:probe -- --history-image` 可复现）；
  **挂在 user 消息**上正常。因此上下文通道（teaching-turn 历史配图、VL 可见上下文配图）
  一律把图片附加到 **user 消息**尾部。
- **计费/体积**：data URL 很大，视觉输入按图片块折算（上下文压缩按 ~1000 token/张估算，
  **不按 base64 字符数**，否则每节课都会被顶进压缩路径）；请求日志只记类型与体积，base64 明文不进日志。

### 4.2 ② 路由解析与别名

**基础路由**（`router.ts#resolveBaseRoute`）：`user-agent-override → user-provider → platform 默认`；平台行不存在时落 env 兜底（`AI_API_URL` / `AI_API_KEY` / `AI_MODEL`）。

**skill 层覆盖**（`router.ts#getSkillConfig`，仅当 `skill_model_configs` 有 `enabled` 行时生效）

- **模型**：Skill 写了 `model` 就用（经别名展开）；没写就沿用基础路由的模型。例外：调用链从用户自有端点起步、且 Skill 属于学习对话链（`LEARN_DIALOGUE_SKILLS`）时**用户模型优先**，Skill 行的模型绑定不生效；其余技能（goal / path / 评估 / 收尾链）的 Skill 绑定照常生效。
- **生成默认**：Skill 显式配置 > 最终模型的模型默认（`defaultThinkingMode` 等）> 平台默认。
- **端点 / 密钥**：Skill 自带 `endpoint` 时整体切换（`source='platform'`）；用户自带端点上，学习对话链沿用用户的端点与密钥。
- **超时**：`requestTimeoutMs` 钳制在 10s–600s；未配置则沿用上层（agent 覆盖或环境默认）。
- `vision` 跟随**最终生效模型**，不沿用父级路线的声明。
- 例外：`semantic-freeze-judge` 强制关闭思考（守门审查不应因推理变慢）。
- **模型不分档**：`tier` 不决定模型；是否长思考只看 `thinkingMode` / `reasoningEffort`。

**供应商自带端点**（`router.ts#applyProviderEndpoint`）：解析后的模型命中自带 `baseUrl` 的供应商 ⇒ `endpoint` / `apiKey` 整体切到该供应商（`source='provider-endpoint'`，`privateNetworkPolicy='runtime'`）；密钥解析顺序 **`provider_secrets` 密文 → `apiKeyEnv` 环境变量**（60s 缓存 + 写接口失效），两处都没有 = 明确报错、不带病调用。**用户自带 provider（source `user-*`）不受覆盖**。

**别名**（`model-alias.ts#selectModelForAlias`）

- 业务侧可以写别名（`chat` / `reasoning` / `light`）或具体模型 id。别名成员来自注册表文件，`platform_api_configs.chatModels/reasoningModels/lightModels` 是 DB 覆盖（**DB 优先于文件**）；`getModelAliasMembers` 过滤未注册与重复成员、保留声明顺序。用户自有 provider 不套平台别名覆盖。
- **能力过滤**：要求思考能力时只选 `supportsThinking` 的成员；没有成员满足则取第一位并标记 `degraded`（请求侧由 `thinking-policy` 裁剪字段，不会发错参数）。
- 具体模型 id / 未注册值原样返回。
- 别名只做「取第一个满足能力的成员」，不做权重、负载均衡或健康感知选路。

#### 4.2a 供应商注册表的管理台编辑器（BYOK）

文件仍是唯一真源，管理台只是它的**编辑器**——两者不是两个写源。

- 页面：`模型与接入 → 接入与模型`（左供应商列表 / 右详情）。供应商与模型的增删改走 `services/admin/model-providers.service.ts`：读**原始 JSON**（`$header`/`$rules` 原文不动）→ 打补丁 → 复解析校验（报错文案即运行时那条）+ 自洽检查（`defaults` 必须解析到已启用供应商的模型）→ 备份 `config/backups/llm-providers.<ts>.json`（留 10 份）→ 原子写（tmp + rename）→ 立即热重载，重载失败回滚。文件或目录不可写 ⇒ 409 只读降级，页面整体只读。
- 写回的格式与原文对齐（短数组单行、沿袭原换行风格）：一次编辑不应带出满屏与本次改动无关的 diff。
- **密钥不进文件**：页面里填的密钥落 system.db 密文表 `provider_secrets`，文件里只同步一个 `apiKeyEnv` 名。
- **平台通道例外**：`id=platform`（无 baseUrl 的继承通道）的服务地址与密钥仍归 `platform_api_configs`（`PUT /api/admin/api-config`，UI 里嵌在「平台」这条通道的详情内、走脏位保存）；它的 `PATCH`/`DELETE` 在注册表侧被拒绝。
- **不在这里编辑**：模型编辑器只写模型自身字段（档位 / 能力 / 限额 / 单价）。别名成员与 `defaults` 没有控制台编辑入口（文件是唯一写源）；按 agent / skill 的模型绑定另在「Skill 模型覆盖 / Skill 运行时」页编辑。

### 4.3 ③ 参数解析策略

**语义**：`maxOutputTokens` = 硬上限（能力）；`defaultMaxTokens` = 缺省值；声明值 = 权威意图。

```
model：     runtimeOverride > route > codeDefaults > prompt.model（废弃副本，仅最后兜底）
temperature / topP / maxTokens：
            runtimeOverride > skill-override(paramOverrides) > ACTIVE prompt > codeDefaults > routeFallback
```

```
declared = 上式合并结果（另有 codeDefaults.minMaxTokens 作截断保护下限）
if (declared == null)  out = model.defaultMaxTokens ?? GLOBAL_DEFAULT_MAX_TOKENS (8192)
else                   out = clamp(declared, MIN_OUTPUT_TOKENS (256), model.maxOutputTokens)
runtimeOverride 仍享豁免（调试/低耗可显式调小，越界由调用方负责）
```

- `prompts/core/*.yaml` 的 `params.maxTokens` 是权威意图（当前所有 core 统一声明 64000，由 `pipeline-coherence` 测试锁定）：某技能被截断，应显式提高它的声明值，而不是退回「抬到模型硬上限」的全局 floor。
- `responseFormat`：`skill-override > 通道默认`（`platform_api_configs.defaultResponseFormat`）；层内显式声明即停——skill 填 `'none'` 是有意关闭通道默认。仅 `'json_object'` 生效，且只对 JSON 媒介技能由 composer 把关。
- `maxAttempts`：`paramOverrides.maxAttempts`，钳制 1–5。

### 4.4 ④ 请求构造（能力驱动）

- `thinking` / `reasoning_effort` **只在模型声明支持时发送**（`thinking-policy.ts#buildThinkingPolicy`）：
  - 模型未声明 `supportsThinking` ⇒ 两个字段都不发；
  - `thinkingMode ∈ {enabled, disabled}` ⇒ `thinking: { type }`；
  - `reasoning_effort` 仅当 `thinkingMode !== 'disabled'` 且该档在模型的 `reasoningEfforts` 里才发。
- **挡位词由运营逐模型填写**：注册表里写什么词，请求体里就发什么词，平台不翻译、不改写、不按自己的词表收窄，只拦形态。上游各家强度词表不一致（minimal/low/medium/high、只认 low/high、没有这个字段），「认哪些词」只能在注册表里逐模型声明。
- **预算分离**：`thinking=enabled` 时 `max_tokens = min(声明输出 + reasoningReserveTokens, maxOutputTokens)`，避免推理吃光输出预算导致 `content` 为空。
- **调用方显式 `thinking` 优先**（定向重试用，见 §4.5）。
- **system 角色折叠**（`wire-format.ts`）：部分聚合网关会**静默丢弃** `role:'system'`。折不折叠由**通道能力声明** `provider.supportsSystemRole` 决定，不是全局开关：显式声明优先；未声明时 `inherit`（平台继承通道）默认折叠、`own`（供应商自带 baseUrl）与未登记 provider 默认保留。紧急开关 `LLM_SYSTEM_PROMPT_FOLD`（`0` 全局禁用 / `1` 全局强制，排查用）。

### 4.5 ⑤ 可靠性

```
错误分类
 ├─ 不可重试（400/401/402/403/内容策略）→ 立即失败
 ├─ 可重试（429/5xx/408/425/网络/超时）
 │     └─ 指数退避 + 全抖动 + Retry-After 下限
 └─ 预算耗尽 → 终局失败（RETRY_BUDGET_EXHAUSTED）
```

- **预算硬上限**（`retry-budget.ts#RETRY_BUDGET_HARD_LIMITS`）：`maxUpstreamAttempts=10` / `maxTransportRetries=5` / `maxLogicalRetries=5` / `maxRequestTimeoutMs=600s` / `maxRetryAfterMs=10s`；skill 可通过 `maxLogicalRetries` 在上限内收紧。
- **退避**：`min(10s, base · 2^(n−1))` 内全抖动，以 `Retry-After` 为下限；`Retry-After` 超过 `maxRetryAfterMs` 的错误不再重试。
- **两层重试**：传输层重试在 `executor.execute` 的 attempt 循环内；逻辑层重试在 `callPrompt`（解析 / 校验 / 空内容失败触发）。
- **语义失败定向重试**：`TRUNCATED_EMPTY_OUTPUT`（`content` 空且 `finish_reason=length`）判可重试，重试时**关闭思考**（不是整包翻倍 maxTokens）。
- **不做降级 / 冷却 / 熔断**：重试预算耗尽即终局失败，不换模型、不进冷却。单聚合端点前提下，换模型会把「失败」变成「静默换型」；现在失败就报错，由调用方决定是否重发。
- **遗留**：`skill_model_configs.fallbackChain` 列保留但不读写；`/admin/model-registry` 不返回 `fallbackChains` / `cooldowns`。

### 4.6 ⑥ 并发配额

**per-model 并发闸门**（`model-concurrency.ts`）

- 键 = `providerId|endpoint|model`，计数进程内。
- **默认不限**：未配置 `maxParallelRequests` 即完全不生效。限值是运维决策，不靠猜（成熟参照：LiteLLM `max_parallel_requests`）。
- 超限抛 `LOCAL_CONCURRENCY_LIMIT`（`rate_limit` / 429 / 可重试），与上游 429 **同构** ⇒ 复用统一退避链路。
- 槽位在 `finally` 中释放，异常路径不泄漏。

**RPM 多通道与等待语义**（`index.ts#execute` + `rpm-limiter.ts`）——与并发闸门**刻意相反**：

| 机制 | 超限行为 | 粒度 | 意图 |
|---|---|---|---|
| RPM 令牌桶 | **排队等待**（令牌按 rpm 速率滴灌，不报错）。护栏 `RPM_QUEUE_WAIT_MS`：默认 0 = 不设限；设了则排队超时按 `RPM_QUEUE_TIMEOUT` 快速失败，防止饱和时「调用方重试 → 队列更长」的无界放大 | 逻辑调用（内部重试不加计） | 让自动驾驶自然变慢 |
| per-model 并发闸门 | **立即拒绝**（`rate_limit`/429 同构，进统一退避链路） | 单次上游 attempt | 防我方突发触发上游 429 |

通道划分：平台自身与真实用户走 `platformRpmLimiter`；`sourceEntry=simulation` 走虚拟学习者通道——其中平台来源的调用共用主桶 `virtualLearnerRpmLimiter`，其它来源（如用户 provider 绑定的模型）按模型各开独立子桶（`getSimulationModelLimiter`），互不挤占。限额由 `rpm-limit-config.service` 读 DB 配置并定时同步。

### 4.7 ⑦ 可观测

- 三张遥测表：`agent_call_logs`（每逻辑调用：token / status / attempt / 错误类 / 实际模型）、`prompt_call_logs`（tokenUsage / attemptTrace / failureStage）、`llm_execution_attempts`（**最细粒度**：transportAttemptNo / http / 错误类 / backoff / Retry-After / 超时 / TTFT / 缓存命中）。
- **只读总览**：`GET /api/admin/model-registry`（`services/model-registry.service.ts`）——汇聚 ①每个模型的能力与限额、②别名映射（成员、DB 覆盖、默认选中、`requireThinking` 下的选中与降级标记；这里的「降级」指别名成员能力不足时的回退选人）、③平台默认模型的解析结果与 `runtimeDefaults`（实际默认值及来源 `ui` / `env` / `none`）、④近 1 小时上游 429 读数、⑤配置漂移告警（未注册模型、别名为空、废弃 `prompt.model` 副本数）。该接口**不做写操作**。
- **成本金额**：`services/cost/call-cost-aggregation.ts`（纯函数）按模型 / 会话 / 技能 / 节点聚合；管理端 `routes/admin/token-cost.ts` 的排行条目与 `totals` 带 `usd / pricingKnown / callsMissingPricing / pricedCalls`，顶层 `pricingStatus` 列出已配置 / 待补单价的模型。**单价未配置时 `usd: null` 且显示「单价未配置」，绝不用 0 冒充**。
- **遥测写路径分流**（`telemetry-writer.service`）：`createAgentCall` / `createPromptCall` 为**后台写**（调用方不等待，失败仅 warn，业务语义不变）——两表携带大文本，内联 await 会被 SQLite 单写者竞争放大 SSE 完成延迟。`createLlmAttempt` 保持 **await**：其成败汇总进 `agent_call_logs.metadata`，管理端执行日志据此标注 dataCompleteness，不能乐观化。`flush()` 供优雅关闭 / 测试等待在途写落盘。

### 4.8 ⑧ 切换与回滚

| 需求 | 手段 |
|---|---|
| 切平台默认模型 | 管理台改 `platform_api_configs.defaultModel`。只对未显式绑定模型的 Skill 生效；显式绑定的 Skill 需各自改，或用「批量模型配置 → 跟随平台默认」清掉绑定 |
| 切某 Skill 的模型 | Skill 模型覆盖页改绑定；`POST /admin/skill-model-configs/bulk-apply` 支持批量，`{ clearModel: true }` 只清 `model`（通道 / 思考 / 参数保持不变） |
| 热生效 | 路由缓存 60s TTL + 写入主动失效；注册表文件按 mtime 热重载（§4.1） |
| 回滚 | 改回配置即可；注册表文件每次管理台写入前自动备份（§4.2a） |
| 灰度 | 不做（别名无权重与会话粘性）；实验对照走 prompt-lab 的路由钉扎 |
| 验证 | 无健康探针。按能力用确定性探针（视觉 `vision:probe`），运行结果看执行日志 |

**实验钉扎（prompt-lab）**：`promptRuntimeOverride.routeOverride` 支持 `expectedProviderId` + `expectedCredentialFingerprint`（route.apiKey 的 SHA-256）双校验——实验期间路由漂移或换钥即拒绝执行，防实验结果串线；`privateNetworkPolicy` 只能收紧不能放宽。

### 4.9 提示词工件（prompt artifact）vs 模型绑定的边界

**原则**：**文本 + 意图（intent）归提示词工件；绑定 + 能力（binding / capability）归模型层；提示词工件永远不承载 `model`。**

两种流派都存在且都成熟：

| 流派 | 代表 | 做法 | 成立条件 |
|---|---|---|---|
| **Prompt-Ops（捆绑派）** | LangSmith Prompt Hub、Humanloop、PromptLayer、Langfuse、Braintrust | prompt 版本**捆绑** model + 参数 | 发布单元＝"这条 prompt 配这套设置"，A/B 与回滚需要整体一致 |
| **SDK / Gateway（分离派）** | Vercel AI SDK（`generateText({model, prompt})`）、OpenCode（agent config 指定 model）、LiteLLM、LangChain `init_chat_model` | 模型独立成注册表，prompt 只是文本 | 换模型不动 N 条 prompt；能力/限额集中一处 |

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

**本仓库的对应规则**

1. `model` 禁止出现在提示词工件：seed 写入的 `agent_prompts.model` 恒为 `null`，`matchesSeedConfig` 不把 `model` 纳入漂移比较。
2. 解析顺序 `runtimeOverride > route > codeDefaults > prompt.model`；`prompt.model` 降为**最后兜底**。
3. prompt-ops 预览解析器不回读 `row.model` / `active.model`（预览用显式指定或平台默认模型）。
4. `skill-runtime-contract.service` 的 `llmRequest` 暴露 `deprecatedPromptModel`，管理端据此提示清理历史副本；只读总览回报 `deprecatedPromptModelCount`。
5. 历史副本清理工具：`scripts/clear-deprecated-prompt-model.ts`（默认 dry-run，`--apply` 才写库；幂等；先备份 `system.db`）。

**不做**：不删 `agent_prompts.model` 列（保留兼容与审计）；不把提示词工件的 `temperature/maxTokens` 默认值搬走（保留审查局部性与回滚粒度）。

**参数覆盖层**：`skill_model_configs.paramOverrides`（JSON：temperature / topP / maxTokens / maxAttempts / responseFormat，缺字段 = 不覆盖）作为**运行时可调层**加在 ACTIVE prompt 之上（§4.3）。File-as-Truth 仍是**默认值与 Git 审查单元**，覆盖走管理端（保存即生效，逐字段三选继承 / 覆盖，GET 投影返回生效值 + 来源徽标）。理由：模型输出量级会漂移，需要不改 prompt、不动发布即可调预算。

### 4.10 传输层（safe-http）

`utils/safe-http.ts`，缓冲与流式共用同一安全基线：

- **SSRF 基线**：所有外呼经 `validateExternalUrl`——协议白名单（生产强制 HTTPS；非生产允许 HTTP 以兼容明文部署的第三方网关，私网仍由 IP 校验拦截）、禁 URL 内嵌凭证、`localhost/.localhost` 与 IP 字面量直接校验、域名解析后**逐地址**校验（`isAlwaysBlockedAddress` 黑名单 + `isLocalOrPrivateAddress` 私网段）、NAT64/ISATAP/IPv4 映射等内嵌 IPv4 提取防绕过。
- **DNS pinning**：校验通过的地址钉死进 Agent 自定义 lookup——连接只会拨向已校验地址，杜绝「校验时公网、连接时重绑定」的 TOCTOU 窗口。代价是每次调用一次纯验证用 DNS 查询。
- **私网策略**：`privateNetworkPolicy: 'runtime' | 'public-only'`。`runtime` = 跟随管理员网络策略（`allowPrivateNetwork` 开关或 `privateNetworkHosts` 白名单，`runtime-network-policy.service`）；`public-only` = 一律拒绝。平台路由与用户在个人设置里配置的 provider 走 `runtime`；按请求的 route override 若改了端点则强制 `public-only`，且只能收紧不能放宽（§4.8）。
- **重定向**：跨源重定向禁止携带敏感头（authorization / cookie / api-key 等）；每跳重新过 `validateExternalUrl`。
- **keep-alive 连接池**：按「已校验地址」（`family:address`）复用 http/https Agent（`keepAliveMsecs=15s`、`maxSockets=64`、`maxFreeSockets=8`，池上限 128）——同源重试 / 高频对话复用 TCP+TLS，TTFT 直接受益；池满整体重建是防御性降级。
- **超时模型**：缓冲请求 = 单一总死线（含 DNS 与重定向）；流式请求 = TTFT 预算（响应头就绪）+ 空闲超时（chunk 间隔）+ 累计字节上限。两者均受 `SAFE_HTTP_MAX_TIMEOUT_MS` 钳制——**必须与 `RETRY_BUDGET_HARD_LIMITS.maxRequestTimeoutMs` 一致**（600s），由 parity 测试锁死（utils 层不反向 import gateway，口径一致性靠用例）。
- **响应体上限**：缓冲 10MB、流式 20MB（safe-http 自身缺省 2MB，由网关按路径传入），超限抛 `SafeHttpBodyLimitError`（不可重试 protocol 类）。

### 4.11 全流式执行模型

**所有 LLM 调用默认以流式发出**（`callPrompt` 的 `streamRequested = context.stream !== false`，探测等场景可显式关闭）。

- **请求形态层与透传层解耦**：默认全部走上游 SSE（更早收到首字节、TTFT 可观测）；但「逐字透传给客户端」仅当调用方注入流式意向（`context.stream === true` 或 `streamRequest.enabled`）且输出 media 为 markdown/text 时启用。同请求首个透传调用消费 `streamRequest.consumed`，后续调用自动降级为整包（JSON 契约类输出不受影响）。
- **重试门闩**：流式路径仅「首字节（首个内容增量）之前」可重试；`streamStarted` 置位后，传输重试全部停用——否则客户端收到两段拼接内容，且 HTTP 200 已提交无法改状态码。
- **provider 兼容**：不识别 `stream_options` 报 400 的 provider 自动去参重试一次（不消耗重试预算）；声明流式但 provider 返回完整 JSON 的回退缓冲解析；返回 event-stream 头却无 SSE 事件判 `INVALID_STREAM_RESPONSE`。
- **逻辑重试 restart**：校验失败触发生成重试时，已透传场景先发 `restart` 事件清空客户端已显示内容，防新旧拼接。
- **遥测复用**：流结束时合成与缓冲路径一致的 ChatResponse（id/model/usage/finish_reason），attempt 级遥测原样复用；TTFT 与 KV 前缀缓存命中随 attempt 落库。

---

## 5. 关键决策与取舍

| 决策 | 取舍 |
|---|---|
| 能力元数据放配置文件而非 DB | 可 review、可 diff、可热重载；管理台编辑器只是文件的编辑器，不引入第二个写源 |
| `maxTokens` 改为"声明优先" | 实际输出预算从模型硬上限降到各技能声明值。**这是修正而非回归**；截断应提高声明值，而不是退回全局 floor |
| `runtime-override` 保持豁免 | 调试链路不受 clamp 影响；代价是越界由调用方负责 |
| 平台只有一个默认模型 | 长思考与否由 `thinkingMode` / `reasoningEffort` 表达；代价是 `tier` 与 `defaultReasoningModel` 成了展示性字段 |
| 不做降级 / 冷却 | 现在不换模型，失败就报错，由调用方决定是否重发 |
| 不做多租户预算/计费 | `pricing` 仅只读核算；金额未知时留空，不用 0 冒充 |

---

## 6. 已知边界

- `agent_model_configs` 保留表但不在解析链上；`user_agent_model_configs` 无管理界面；别名 DB 覆盖无管理台入口（§0）。
- RPM `acquire()` 不感知调用方 `abortSignal`，已取消的请求仍占排队位（低 rpm 配置下轻微延迟后来者）。
- 路由冷路径串行查询（有 60s 缓存兜底）；验证用 DNS 解析每次调用一次（未按 hostname 缓存，防线不受影响）。
- `llm_execution_attempts` 没有 `deploymentId` 真列；成本金额条与内嵌组件的时间窗口未对齐；`bySession` 没有会话维度端点。
- 遥测对「流式被 provider 回退 JSON」仍记 `executionMode=stream`。

---

## 7. 回归验证

参数解析与网关的单测：

```bash
cd backend
npx jest src/services/__tests__/resolve-llm-call-params.test.ts src/gateway --runInBand
```

断言要点：声明值 800 最终 `max_tokens=800`（不被抬到模型硬上限）；未声明时取 `defaultMaxTokens`；超过模型上限被压回；`runtime-override` 仍豁免。

改可靠性 / 参数构造后，用虚拟学习者基准做同语料、同口径的对照：

```bash
node scripts/vl-preset-run.mjs --concurrency=1 --retries=3 --backoff=60
node scripts/vl-ai-audit.mjs --tag=builtin --story=first --phase=both --runs=3 --concurrency=2
```

关注指标：**空内容率、429 失败率、截断（`finish_reason=length`）导致的解析失败率、单位调用 token 消耗**。

---

## 8. 明确不做

- 不做多租户预算/计费系统（`pricing` 仅只读核算）。
- 不引入 Redis（并发计数与 RPM 令牌桶都在进程内；多实例时再评估）。
- 不改 skill 的业务重试语义（`retryStrategy` 归 skill 契约，网关只管传输可靠性）。
- 不做降级 / 冷却 / 熔断，不做后台健康 / 能力探针（§4.5、§4.8）。
- `agent_model_configs` 的优先级不进解析链。理由：全库无业务写入方（仅历史迁移脚本），该优先级让路由冷路径多一次查询且语义误导。表与迁移脚本保留；`model-registry.service` 对遗留行保留清理提示。
- 不把模型注册表改成 DB 表（保持配置文件单写源）。

---

## 附录 A · 代码索引

用符号引用，不用行号（行号随改动腐烂）。

| 主题 | 入口 |
|---|---|
| 平台配置字段消费 | `api-gateway/router.ts#getPlatformConfigRecord / getPlatformDefault / resolvePlatformApiKey`；`services/apiConfig.service.ts` |
| skill 配置读写 | `api-gateway/router.ts#getSkillConfig`；`services/skillModelConfig.service.ts` |
| 解析链（含 `agent_model_configs` 不入链） | `api-gateway/router.ts#resolveBaseRoute`；`services/model-registry.service.ts`（遗留行清理提示） |
| 模型注册表 | `config/models.config.ts#parseLlmProvidersConfig / reloadLlmProvidersIfChanged / resolveModelRef / getModelAliasMembers`；`config/llm-providers.json` |
| 生成参数优先级 | `services/resolve-llm-call-params.ts#resolveLlmGenerationParams` |
| thinking 映射 | `api-gateway/thinking-policy.ts#buildThinkingPolicy`；`config/models.config.ts#ModelDefinition` |
| 重试/退避/预算 | `api-gateway/executor.ts#execute / resolveBackoffMs`；`api-gateway/retry-budget.ts#RETRY_BUDGET_HARD_LIMITS / consumeUpstreamAttempt` |
| 错误分类 | `api-gateway/failure-classification.ts#GatewayExecutionError / parseRetryAfterMs`；`executor.ts#classifyTransportError` |
| 语义失败 | `executor.ts#parseChatResponseBody`（TRUNCATED_EMPTY_OUTPUT）；`composers/prompt-composer.ts#callPrompt` validation_failed 分支 |
| 视觉闸门 | `executor.ts#assertVisionAllowed`；`composers/prompt-composer.ts`（`enforceVisionCapability`）；`scripts/vision-probe.ts` |
| system 折叠 | `api-gateway/wire-format.ts#resolveSystemPromptFoldPolicy / renderWireMessages`；`executor.ts`（请求体构造） |
| 超时口径 | `api-gateway/retry-budget.ts#RETRY_BUDGET_HARD_LIMITS.maxRequestTimeoutMs`；`utils/safe-http.ts#SAFE_HTTP_MAX_TIMEOUT_MS`；`utils/__tests__/safe-http.test.ts` parity 用例（两处必须一致） |
| 传输层 / SSRF | `utils/safe-http.ts#validateExternalUrl / getPinnedAgentPair / safeHttpRequest / safeHttpStreamRequest`；`services/runtime-network-policy.service.ts`；`utils/__tests__/safe-http*.test.ts` |
| 全流式执行 | `composers/prompt-composer.ts#callPrompt`（streamRequested / streamDeltaEligible）；`executor.ts#executeStreamRequest`；`utils/sse-parser.ts` |
| RPM 多通道 | `api-gateway/rpm-limiter.ts`；`services/rpm-limit-config.service.ts`；`api-gateway/index.ts#execute`（通道选择） |
| 并发闸门 | `api-gateway/model-concurrency.ts`；`config/models.config.ts#maxParallelRequests` |
| 注册表编辑器 / 密钥 | `services/admin/model-providers.service.ts`；`services/provider-secrets.service.ts`；`routes/admin/model-providers.ts` |
| 只读总览 | `services/model-registry.service.ts`；`routes/admin/model-registry.ts` |
| 成本金额 | `services/cost/call-cost-aggregation.ts`；`routes/admin/token-cost.ts` |
| 可观测表 | `prisma/schema.prisma`（agent_call_logs / prompt_call_logs / llm_execution_attempts） |
| 遥测写路径分流 | `services/telemetry-writer.service.ts`（后台写 vs await 语义 + flush） |
| 缓存热生效 | `api-gateway/cache.ts`（TTL + 惰性清扫）；`gateway/api-gateway/index.ts#invalidateCache` |
| 路由钉扎（实验） | `gateway/api-gateway/index.ts#applyRouteOverride`；`api-gateway/types.ts#RouteExecutionOverride` |
| 管理台页面 | `frontend/src/views/admin-redesign/{ApiConfig.vue,ModelRegistryOverview.vue,ExecLogs.vue}`；`frontend/src/api/adminApi.ts` |

## 附录 B · 参考

- LiteLLM Router / Fallbacks / Cooldowns：<https://docs.litellm.ai/docs/routing>、<https://docs.litellm.ai/docs/proxy/reliability>
- OpenRouter Provider Routing / Model Fallbacks：<https://openrouter.ai/docs/features/provider-routing>、<https://openrouter.ai/docs/guides/routing/model-fallbacks>
- Vercel AI SDK Provider & Model Management / Error Handling：<https://ai-sdk.dev/docs/ai-sdk-core/provider-management>、<https://ai-sdk.dev/docs/ai-sdk-core/error-handling>
- OpenCode Models（provider / variants / 加载优先级）：<https://opencode.ai/docs/models/>
