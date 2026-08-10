# MCP 域机制全景与桥接评估

> 审计日期：2026-08-10 ｜ 只读调查，未改任何代码
> 范围：平台级 `backend/config/mcp.json` + 用户级 `user_mcp_configs` + `skills/mcp-tool` 执行链 + 与字段路由/编排域的桥接
> 前置结论引用：`doc/SKILL_LIFECYCLE_SURVEY.md:150/171-174/177/198`

---

## 1. MCP 声明层结构（平台/用户两级）

### 1.1 平台级 `backend/config/mcp.json`

| 段 | 位置 | 键 | 说明 |
|---|---|---|---|
| 头部 | L2-4 | `$schema` / `version` / `description` | 元信息，`updateConfig` 写回时保留（McpGateway.ts:113-117 只替换 servers/tools） |
| `servers` | L5-66 | 逐键：`id` `name` `type`(openai\|anthropic\|openai-compatible) `endpoint` `apiKey` `models[]` `defaultModel` `priority` `enabled` `config{temperature,maxTokens,timeout}` | 共 3 台：openai（priority 1，L5-25）、newapi（priority 2，L26-45）、anthropic（**enabled=false**，L46-65）。类型定义 `IMcpServerConfig` McpGateway.ts:11-26 |
| `tools` | L67-102 | 逐键：`id` `name` `description` `type` `endpoint` `apiKey?` `config?` `enabled` `userAccessible?` | 共 3 个：web-search（**disabled**，L68-77）、file-reader（endpoint=`local`，type=filesystem，L78-93）、code-interpreter（endpoint=`local`，type=code，L94-101）。类型定义 `IMcpToolConfig` McpGateway.ts:28-38 |
| `agents` | L103-122 | `agentId → {mcpServer, model, maxTokens, temperature}` | 3 条：`skill:path-planning`、`ai-teaching-agent`、`planner-agent`。类型定义 `IMcpAgentConfig` McpGateway.ts:40-45。**整体死配置**（见 §5） |
| `routing` | L123-130 | `strategy`(priority) `fallback`(true) `healthCheck{enabled:true, interval:30000}` | 仅被 McpGateway 内部消费（见 §5） |

**环境变量占位**：加载时递归替换 `${NAME}` / `${NAME:-default}`（`replaceEnvVars`，McpGateway.ts:148-159；调用点 L140）。如 `endpoint: "${OPENAI_API_URL:-https://api.openai.com/v1}"`（mcp.json:10）。

**谁读写（平台级）**：
- `McpGateway` 单例在**模块导入时**实例化（McpGateway.ts:418 `export const mcpGateway = new McpGateway()`），构造函数读文件 + 启动健康检查（L91-94）；配置路径 `path.join(__dirname, '../../../config/mcp.json')` → 即 `backend/config/mcp.json`（L91、L129）
- `updateConfig(next)`（McpGateway.ts:104-123）：重新读盘 → 合并 servers/tools → tmp+rename 原子写（L118-120）→ 重载 + 清 serverStatus（L121-122）
- 管理台 CRUD `routes/admin/mcp.ts`（挂载 `index.ts:372` `/api/admin/mcp`）：
  - `GET /` L10-35：工具列表（apiKey 脱敏为 `hasApiKey` 布尔）+ 服务器健康状态
  - `POST /tools` L38-71：校验 id 白名单 pattern（L41-43）、名称/endpoint 非空（L44-49）、id 去重（L51-53）；**apiKey 明文落盘 mcp.json**（L60）
  - `PUT /tools/:id` L74-102、`DELETE /tools/:id` L105-118、`POST /tools/:id/test` L121-152（`callTool(probe)` L129）

### 1.2 用户级 `user_mcp_configs` 表（schema.prisma:675-686）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | String @id | uuid |
| `userId` | String @unique | 与 users 级联删除（L685） |
| `servers` | String | JSON 文本，**加密存储**（encryptSecretTree，context `main.user_mcp_configs.servers`） |
| `tools` | String | JSON 文本，加密存储 |
| `routingStrategy` | String @default("priority") | 明文列 |
| `fallbackEnabled` | Boolean @default(true) | 明文列 |
| `healthCheck` | String | JSON 文本，加密存储 |

- 加密上下文三件套 `USER_MCP_SECRET_CONTEXTS`（user-mcp-config.service.ts:13-17）；加解密 `encryptSecretTree/decryptSecretTree`（L486-509）；存量迁移脚本 `scripts/migrate-database-secrets.ts:105-126`
- 运行期读取 `getUserMcpRuntimeConfig`（user-mcp-config.service.ts:511-541）：解密 + 容错归一（`parseRuntimeUserMcpTools` L401-433 产出 `invalidToolIds` / `toolsConfigInvalid` 标记）
- 路由 `routes/user-mcp.ts`（挂载 `index.ts:394` `/api/user/mcp`，auth + directUserSessionOnly）：
  - `GET /` L69-110；`PUT /` L113-186（部分更新 + `preserveNestedSecretsById` 保留已存密文 L131-141）
  - `GET/POST/DELETE /servers` L189-317（单条增删）
  - `POST /tools/:id/execute` L320-370（**唯一业务执行入口**，见 §2）
  - `POST /test-connection` L373-423、`GET /status` L426-486（均带 `privateNetworkPolicy:'public-only'` 探测 `/models`）

**用户级校验**（user-mcp-config.service.ts）：
- `createMcpEndpointSchema` L45-81：endpoint 必填、**仅 HTTPS**（L60-66）、禁用户名密码/查询串（L67-72）、禁 localhost/局域网/保留地址（L73-79）
- `mcpServerSchema` L83-128（id pattern `^[A-Za-z0-9][A-Za-z0-9._:-]*$` L43，`.strict()` 拒绝未知字段）
- `mcpToolSchema` L130-165：同样端点约束；**无 `userAccessible` 字段**（用户工具天然归用户所有）
- `userMcpConfigUpdateSchema` L244-252：`routingStrategy` 枚举 **`priority|latency|round-robin`**（L247-249）、`fallbackEnabled` bool、`healthCheck` 子 schema L217-242（支持 headers/auth/env，均加密存储）
- 数量上限：服务器 50（L40、L320-326）、工具 100（L41、L367-373）、超时 ≤300s（L42）
- 安全：拒绝提交密文 `assertNoEncryptedSecretInput` L286-290；`stripSecretConfiguredMarkers` L297-309；**禁止用户声明本地工具** `MCP_USER_LOCAL_TOOL_FORBIDDEN`（校验期 L360-365，执行期 mcp-tool/index.ts:89-93）

### 1.3 `platform_api_configs` 与 MCP 的关系

**无关系。** `platform_api_configs`（system/schema.prisma:97-120：apiUrl/apiKey/defaultModel/defaultReasoningModel/reasoningEndpoint/lightEndpoint/…）是**当前真实的 LLM 提供方配置**，由 `api-gateway/router.ts` 读取（`getPlatformConfigRecord` L297-311、`resolvePlatformApiKey` L313-336、平台默认路由 L396-419），与 mcp.json 完全独立。`McpGateway.chatCompletion`（McpGateway.ts:192-249）**无任何业务调用点**（grep 全仓仅自身递归 + 测试）——mcp.json 的 servers/agents/routing 三段的"模型路由"职责已被 platform_api_configs + agent_model_configs + user_api_configs 取代。

---

## 2. 调用链时序（file:line）

```
POST /api/user/mcp/tools/:id/execute          routes/user-mcp.ts:320-370
  └─ getGateway().executeSkill('mcp-tool', {toolId, params, signal})   user-mcp.ts:326-330
       └─ gateway.executeSkill                gateway/index.ts:124-145
            └─ executeSkillHandler            skills/executor.ts:149-271
                 ├─ 用户 Skill 门禁 assertSkillEnabledForUser（user_skill_configs）  executor.ts:136-147
                 ├─ 上下文 envelope（agentId/callerAgent/retryBudget/session…）       executor.ts:171-200
                 ├─ 统计/遥测（mcp-tool 输入参数与输出内容均脱敏）                     executor.ts:57-72, 221-233, 273-360
                 └─ handler = executeMcpToolFn（skillHandlers['mcp-tool']）           skills/index.ts:190
                      └─ executeMcpTool      skills/mcp-tool/index.ts:57-164
```

`executeMcpTool` 选择与执行语义（mcp-tool/index.ts）：
1. **入参校验**：toolId 非空（L59-66）、params 须为对象（L67-74）
2. **用户优先**：请求上下文有 userId 且非 `system` 时（L77-79）读 `getUserMcpRuntimeConfig`（L80）；命中用户工具 → 检查 `enabled`（L84-88）→ 拒绝本地工具（L89-93）→ `mcpGateway.callConfiguredTool(userTool, params, {allowLocal:false, privateNetworkPolicy:'public-only', signal})`（L95-99）→ 输出 `{toolId, source:'user', result}`（L100-104）
3. **无效/损坏配置拦截**：用户 `invalidToolIds` 命中 → `MCP_TOOL_CONFIG_INVALID`（L107-111）；`toolsConfigInvalid` → 同上（L113-117）——防"历史坏工具静默 fallback 到平台同名工具"（测试 index.test.ts:199-219）
4. **fallback 语义**：`fallbackEnabled===false` → `MCP_TOOL_NOT_FOUND`（L119-123）；否则进入平台工具（L126-150）
5. **平台工具**：`mcpGateway.getTool(toolId)` 按 id（trim+lowercase）查（McpGateway.ts:177-180）；特权调用者（`userRole==='admin' || userId==='system'`，L132）走 `callTool`（allowLocal=true，L139-140）；普通用户要求 `userAccessible===true` 且非本地（L133-137），走 `callConfiguredTool`（公网策略 L141-145）→ 输出 `{toolId, source:'platform', result}`（L146-150）
6. **错误归一**：`MCP_ERROR_MESSAGES` 映射（L44-55、L151-163）；`success:false` 会被 executor `normalizeHandlerResult` 转抛（executor.ts:74-115、214-218），user-mcp.ts:339-358 再映射 HTTP 状态（403/404/502/504/400/500）

底层执行 `McpGateway.callConfiguredTool`（McpGateway.ts:263-329）：
- `endpoint==='local'` → `allowLocal` 检查（L278-283）→ `executeLocalTool`（L334-345：type=code 返回占位"代码执行功能待实现" L338；type=filesystem → `executeFileTool` 走 `readFileWithinRoots`，路径受 `config.allowedPaths` 限制，L350-359）
- 远程 → `safeHttpRequest` POST `{endpoint}`，`Authorization: Bearer apiKey`，body=params 原样透传，timeout=`tool.config.timeout`，`privateNetworkPolicy` 按调用方（L293-303）
- 错误映射：HTTP 408/504→超时，`UnsafeUrlError`→`MCP_TOOL_ENDPOINT_FORBIDDEN`，连接超时→`MCP_UPSTREAM_TIMEOUT`，其余→`MCP_UPSTREAM_UNAVAILABLE`（L305-328）

**调用方盘点**：生产环境仅 `user-mcp.ts:326`（REST）与 `admin/skills.ts:201`（管理台测试执行任意 skill）两处；**没有任何 agent/编排 skill 引用 mcp-tool**（grep `executeSkill(` 全仓 32 处无一是 mcp-tool 的调用方；`skills/index.ts:190` 只做注册）。mcp.json `agents` 段的映射不产生任何调用（`getAgentMcpConfig` 零调用点）。

---

## 3. 工具结果流转机制结论（模型可见性）

**结果形态**：
- 远程工具：上游 HTTP 响应体 `response.data` **原样返回**（任意 JSON，McpGateway.ts:312）
- 本地 filesystem：`{content, path}`（McpGateway.ts:358）
- skill 层包装为 `SkillExecutionResult`：`{success, output:{toolId, source:'user'|'platform', result}, duration}`（mcp-tool/index.ts:100-104、146-150；outputSchema L32-39）

**模型可见性结论：「无自动回 AI 上下文」成立，且是全链路结构性缺失**：
1. mcp-tool 是 **handler-only skill**（`noPromptFile: true`，agent-manifest.service.ts:354）——没有 LLM prompt，不存在"模型读完工具结果再说话"的回合
2. 结果只通过 `executeSkill` **返回值**交给调用方（executor.ts:212 后直接 return；`skills/index.ts:233` 只取 `.output`）；调用方只有两个 REST 入口，均**直接回给 HTTP 客户端**（user-mcp.ts:332-336、admin/skills.ts:204-212），不经过任何模型
3. 遥测落库也是**摘要而非原文**：`summarizeSkillLogPayload` 对 mcp-tool 只记 `resultType`（executor.ts:64-69），输入 params 直接 `[REDACTED]`（L59-62）——即执行记录落库（agent_calls），但模型上下文永远看不到
4. 对比编排域 skill：编排代码（如 learning.service.ts:2509 `pathAgentDefinition`）把数据拼进 input → 模型 → rawOutput → 字段路由，链路完整；mcp-tool 是孤立端点，**结果要回模型只能由编排代码手动把 `result` 拼进下一个 LLM payload**（与 SKILL_LIFECYCLE_SURVEY.md:174 记载一致）

---

## 4. 与字段路由/编排的桥接评估

**现状：零桥接。**
- 字段路由只消费 **LLM rawOutput**：`field_definitions.pathInRawOutput`（field-routings.ts:379/399）取值于 `prompt-composer.ts:346 rawOutput: lastRaw`；字段/契约/路由三表由编排文件 `prompts/orchestration/*.yaml` 单源驱动（field-routings.ts:183-184 注释、bootstrap 服务）
- mcp-tool 不在任何 stage 的契约/字段/路由中（grep 编排 yaml 无 `mcp-tool` 匹配），也不在任何 agent 的 `agentMembers` 内（agent-manifest.service.ts:80-133 成员清单无）
- **MCP 工具输出无法直接进入字段路由**：字段路由的输入是"模型输出的 JSON 结构"，而工具输出是任意结构且无字段声明；设计文档也明确"mcp-tool 保持'不产路由字段'的地位（工具输出任意结构，进不了字段路由）"（SKILL_EXPANSION_DESIGN.md:290）

**桥接点与可行性**：
| 桥接方向 | 可行性 | 依据 |
|---|---|---|
| 工具结果 → 字段路由（直接） | **不可行（设计上亦不主张）** | 无 schema/字段声明；字段路由契约基于 LLM 输出（prompt-composer.ts:346；SKILL_EXPANSION_DESIGN.md:290） |
| 工具结果 → 下一 skill 输入（编排层手动） | **可行（现行唯一路径）** | 编排代码 `executeSkill('mcp-tool')` 拿 result 后拼入后续 payload——与现有手动桥接模式一致；但**无任何现成编排代码这样做** |
| 工具结果 → 模型上下文（自动） | **不可行（现状）；可行（需新增编排层注入）** | 无机制把 result 注入 prompt；需在调用方把 `result` 序列化塞进 messages（对照：executor.ts:57-72 的脱敏逻辑证明结果曾被设计为"不应进日志"，更未进 prompt） |
| skills.yaml `mcpTools` 声明 ↔ mcp.json tools 交叉校验 | **未实现（纯设计）** | SKILL_EXPANSION_DESIGN.md:117/288-292/309/315/350/382 为设计稿；仓库**无 skills.yaml 文件**，`mcpTools` 仅出现在前端 Addons.vue（L11/74/255 等，展示用）与设计文档 |
| mcp.json `agents` 段 ↔ agent 调用 | **失效/半失效** | `skill:path-planning`（mcp.json:104-109）与 manifest id 同名（agent-manifest.service.ts:154）；`ai-teaching-agent`（mcp.json:110-115）是 `teaching-agent` 的旧别名（agent-manifest.service.ts:94）；`planner-agent`（mcp.json:116-121）**manifest 中不存在**。且该段整体无人读取（getAgentMcpConfig 零调用） |

**结论**：MCP 域是"可执行的孤立资源层"——配置、校验、执行、遥测齐全，但既不在模型回合内，也不在字段路由契约内。桥接只能发生在**编排代码层**（手动取 result 拼 payload），且目前没有任何编排方这样做。

---

## 5. 新发现（死配置 / 旧 id / 安全缺口）

1. **mcp.json `servers`/`agents`/`routing` 三段整体死配置**：`chatCompletion`（McpGateway.ts:192-249）、`getAvailableServers`（L164-168）、`getAgentMcpConfig`（L185-187）零业务调用；LLM 实际路由走 `platform_api_configs`（api-gateway/router.ts:297-336）。`routing.healthCheck.enabled=true`（mcp.json:126-129）导致 **`initHealthCheck` 每 30s 用真实 apiKey 打 openai/newapi 两台服务器的 `/models`**（McpGateway.ts:364-385），纯浪费且持续对外暴露密钥请求
2. **旧 id 残留**：`planner-agent`（mcp.json:116-121）manifest 无此 id；`ai-teaching-agent`（mcp.json:110）为 teaching-agent 旧别名（agent-manifest.service.ts:94）；`skill:path-planning`（mcp.json:104）写法虽合法但该段本身无人消费。模型参数与 manifest `defaultModelConfig`/`agent_model_configs` **双轨并存**（SKILL_LIFECYCLE_SURVEY.md:177 已记）
3. **平台级 apiKey 明文落盘**：管理台 `POST /tools`（admin/mcp.ts:60）与 `PUT`（L91）把 apiKey 以明文写进 `backend/config/mcp.json`（McpGateway.ts:119），与用户级 secret-crypto 加密体系不对称；GET 接口虽脱敏（L25）但文件本身不设防
4. **code-interpreter 是假的**：enabled=true（mcp.json:94-101）但执行返回占位"代码执行功能待实现"（McpGateway.ts:338）
5. **平台对普通用户零可用工具**：web-search disabled、file-reader/code-interpreter 为 local 且非特权不可达（mcp-tool/index.ts:133-137）——普通用户 MCP 通道实际只能依赖自配 `user_mcp_configs`
6. **管理端权限不对称**：admin 工具创建校验仅"非空 + id pattern"（admin/mcp.ts:41-49），无 URL/HTTPS/私网约束（可写 `endpoint:'local'` 或任意地址）；admin 执行走 `callTool`（allowLocal=true，mcp-tool/index.ts:139-140），本地文件工具路径受 `allowedPaths` 白名单限制（mcp.json:86-89），但管理员可改配置扩大
7. **用户工具无 per-tool 白名单**：`POST /api/user/mcp/tools/:id/execute` 允许用户调用任意自己配置的工具（设计如此），fallback 语义=用户同名优先→平台；用户配置损坏时用 `invalidToolIds`/`toolsConfigInvalid` 阻断静默 fallback（mcp-tool/index.ts:107-117）
8. **执行日志双重脱敏**：mcp-tool 的 params 记为 `[REDACTED]`、输出只记类型（executor.ts:57-72）——意味着工具调用**既无审计价值也无调试价值**，与"无回 AI 上下文"叠加后，工具结果是"黑盒透传"

---

## 附：证据索引

- 平台配置：`backend/config/mcp.json`（L5-66 servers、L67-102 tools、L103-122 agents、L123-130 routing）
- 网关：`backend/src/core/mcp/McpGateway.ts`（L91-94 构造、L104-123 updateConfig、L128-159 加载+env、L192-249 chatCompletion、L263-329 callConfiguredTool、L334-359 本地工具、L364-385 健康检查、L418 单例）
- 管理台：`backend/src/routes/admin/mcp.ts`（挂载 index.ts:372）
- 用户级：`backend/src/routes/user-mcp.ts`（挂载 index.ts:394）、`backend/src/services/mcp/user-mcp-config.service.ts`、`backend/prisma/schema.prisma:675-686`
- 执行链：`backend/src/skills/mcp-tool/index.ts`、`backend/src/skills/executor.ts`、`backend/src/skills/index.ts:190`、`backend/src/gateway/index.ts:124-145`
- 桥接评估：`backend/src/routes/admin/field-routings.ts:379/399`、`backend/src/composers/prompt-composer.ts:346`、`backend/src/services/agent-manifest.service.ts:344-355/94/154`、`doc/SKILL_EXPANSION_DESIGN.md:117/288-292/350/382`、`doc/SKILL_LIFECYCLE_SURVEY.md:171-174`
