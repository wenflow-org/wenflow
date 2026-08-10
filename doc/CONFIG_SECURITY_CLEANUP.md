# 配置安全与死代码清理面（审计报告）

> 审计日期：2026-08-10 | 范围：`backend/config/` 全盘点、明文密钥面、死代码/死配置、暴露面
> 只读调查，未改任何代码。证据均为 `file:line`。

---

## 一、backend/config/ 配置盘点表

| 文件 | 内容 | 读写方（file:line） | 运行时可达性 | 敏感性 |
|---|---|---|---|---|
| `mcp.json` | servers(3) / tools(3) / agents(3) / routing(healthCheck 30s) | 读：`McpGateway.ts:91,128-143`（loadConfig + env 替换 `:148-159`）；写：`McpGateway.updateConfig:104-123`（原子写回 `:118-120`）→ 唯一调用方 `routes/admin/mcp.ts:65,96,112`；模块加载即建单例 `McpGateway.ts:418` | **半活**：servers 段仅健康检查 + admin 状态展示用（`mcp.ts:13,27`）；tools 段 file-reader 活、code-interpreter 是占位（见 §三）；agents 段、routing.strategy/fallback、chatCompletion 全死（见 §三） | **高**：`servers[].apiKey`/`tools[].apiKey` 可落明文（admin 端点写入时）；当前磁盘为 `${ENV}` 占位符，无字面密钥 |
| `agent-catalog.json` | 6 个 agent 生命周期状态（published） | 读：`agent-catalog.service.ts:38-46`，消费方 `routes/admin/platform.ts:262`、`routes/user-agents.ts:36,63,105...`；写：`setAgentLifecycleStatus` `agent-catalog.service.ts:88-103` —— **零调用** | **半活**：读活写死；6 个 key 中 3 个是旧/幽灵 id（见 §三.7） | 无 |
| `agent-prompts.json` | 8 个旧 agent 的测试 prompt 文本 | 无任何引用（全仓 grep `agent-prompts.json` = 0 命中；`routes/admin/agent-prompts.ts` 是 DB 版 API，操作 `agent_prompts` 表，与该文件无关） | **死** | 无（仅旧测试文本） |
| `platform-settings.json` | `{ registrationEnabled: true }` | 读：`platform-settings.service.ts:20,29-38`（仅当 system DB `platform_settings` 无记录时读一次并迁移入库 `:64-68`） | **半活**：一次性迁移源，迁移后不再读 | 无 |

补充：`mcp.json:2` 的 `"$schema": "./mcp-schema.json"` —— 该文件**全仓不存在**（glob 与 grep 均无）。

---

## 二、明文密钥面

### 2.1 现状：mcp.json 是系统内唯一"明文落盘密钥"存储

**写入路径（明文，无加密）**
- `routes/admin/mcp.ts:40,60`：POST /tools 时 `apiKey: String(apiKey)` 原样进入 `next`，随 `updateConfig` 落盘
- `routes/admin/mcp.ts:82,91`：PUT /tools 时 `apiKey ? String(apiKey) : apiKey === '' ? undefined` 同样原样
- `McpGateway.updateConfig` `McpGateway.ts:118-120`：`fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2))` 明文写 `mcp.json`
- 响应**回显明文 key**：`mcp.ts:66`（POST `data: next`）、`mcp.ts:97`（PUT）——GET 列表有脱敏（`mcp.ts:17-26` 只回 `hasApiKey`，测试 `admin/__tests__/mcp.test.ts:42-51` 印证），但写接口不回显了 key 的副本

**读取路径（无解密）**
- `McpGateway.loadConfig` `McpGateway.ts:128-143`：只做 env 变量替换（`:148-159`），不做任何解密
- 使用点：`chatCompletion` 头部 `McpGateway.ts:211`（死链）、远程工具 `:297`、**健康检查 `:375`** —— 全部直接拿内存中字符串作 `Bearer`

### 2.2 系统内既有密钥规范（mcp.json 的偏离对照）

| 存储 | 规范实现 | 证据 |
|---|---|---|
| `user_api_configs.apiKey` | `encryptSecret(..., 'main.user_api_configs.apiKey')`，读取 `decryptSecret` | `routes/user-api-config.ts:116,129` / `:94,187` |
| `platform_api_configs.apiKey` | `encryptSecret(..., 'system.platform_api_configs.apiKey')` | `services/apiConfig.service.ts:102,119` / `:56` |
| `user_mcp_configs`（servers/tools/healthCheck 整树） | `encryptSecretTree` / `decryptSecretTree`，context `main.user_mcp_configs.servers|tools|healthCheck`（字段名命中 `isSecretFieldName` 才加密） | `services/mcp/user-mcp-config.service.ts:486-509`、`:14`；`utils/secret-crypto.ts:172-212` |
| 存量明文迁移 | `scripts/migrate-database-secrets.ts`（`reencryptSecret`/`reencryptSecretTree`，`--apply` 落盘；`package.json:18-19` 暴露 `secrets:audit`/`secrets:migrate`） | `scripts/migrate-database-secrets.ts:7-10,36,84` |

加密基础设施：`utils/secret-crypto.ts:3-4`（`wfsec:v1:` 信封 + aes-256-gcm + context AAD），密钥来自 `SECRET_ENCRYPTION_KEYS`/`SECRET_ENCRYPTION_CURRENT_KEY_ID`（`:45-72`），生产强制校验（`:74-79`）。**backend/.env 已配置这两个变量**（key 名核对，未读值）——即加密能力当前可用，mcp.json 未用属明显偏离。

> 附带事实：根目录 `.secret-scan-baseline.json` 已登记 2 个历史凭据指纹（须轮换），说明仓库有过明文凭据进 git 历史的先例；`mcp.json` 自 Initial commit（`7784e1f`）即存在，admin 写入端点从 `31a97e4` 起可落明文 key。

### 2.3 修复方案（复用 secret-crypto，零新依赖）

1. **加密落盘（写入侧）**
   - 新 context 常量：`system.mcp_config.apiKey`（或按 server/tool 粒度 `main.mcp_config.servers` / `main.mcp_config.tools`）。
   - `routes/admin/mcp.ts:40-65 / 82-97`：提交的 `apiKey` 在进 `next` 前调 `encryptSecret(apiKey, context)`；响应不再回显明文（沿用 GET 的 `hasApiKey` 模式）。
   - `McpGateway.updateConfig`（`McpGateway.ts:104-123`）内做兜底：对 `servers[].apiKey` / `tools[].apiKey` 统一 `encryptSecret`（对已是 `wfsec:v1:` 的值幂等——`secret-crypto.ts:121-124`）。

2. **读取侧解密**
   - `McpGateway.loadConfig`（`:128-143`）在 `replaceEnvVars` 之后对 apiKey 字段调 `decryptSecret`；`decryptSecret` 对非 `wfsec:` 前缀值**原样返回**（`secret-crypto.ts:145-146`）——天然兼容未加密旧值，健康检查 `:375` 与工具调用 `:297` 无需改动即用解密值。
   - env 占位符（`${AI_API_KEY}` 形态）保持不落盘不加密，运行时替换后已是明文内存值，`decryptSecret` 原样通过。

3. **存量迁移**
   - 仿 `migrate-database-secrets.ts` 新增 `scripts/migrate-mcp-config-secrets.ts`：读 `mcp.json`，对非占位符、非 `wfsec:` 前缀的 apiKey 用 `reencryptSecret`（`secret-crypto.ts:112-116`）加密后原子写回；提供 `--apply` 与 dry-run 审计，接入 `package.json` 的 `secrets:*` 脚本族。
   - **git 历史中的明文 key 无法靠代码修复，只能轮换**：继续沿用 `.secret-scan-baseline.json` 流程登记指纹并 rotate。

4. **健康检查用解密值**：见 §2.3-2，`initHealthCheck`（`McpGateway.ts:364-385`）无需改动即可拿到解密后的 `server.apiKey`。

---

## 三、死代码 / 死配置处置表（按优先级）

| # | 位置 | 现状 | 处置建议 | 优先级 |
|---|---|---|---|---|
| 1 | `McpGateway.chatCompletion` `McpGateway.ts:192-249` 及其私有链 `getAvailableServers:164-168`、`getServer:173-175`、fallback `:239-244` | 全仓零外部调用（grep `chatCompletion(` 仅定义与自身递归 `:242`）；真实 LLM 链路走 APIGateway：`gateway/api-gateway/router.ts:322-348`（platform/agent/skill/user 四级 DB 密钥解密）+ `apiConfig.service.ts` | **删**（连同接口类型 `IChatCompletionRequest/Response:63-82`）；如想留过渡则标 deprecated 并在下个大版本删 | P1 |
| 2 | `mcp.json` `agents` 段 `:103-122`（skill:path-planning / ai-teaching-agent / planner-agent） | 读取方 `getAgentMcpConfig` `McpGateway.ts:185-187` **零调用**；`planner-agent` 在 manifest（`agent-manifest.service.ts:54-356`）中不存在；`ai-teaching-agent` 只是 `teaching-agent` 的旧别名（`:94`） | **删**整段；`planner-agent` 为死 id 直接删；`ai-teaching-agent` 如需保留语义应写 `teaching-agent` | P1 |
| 3 | `mcp.json` `routing.strategy/fallback` `:124-125` | `strategy` 零读取；`fallback` 仅死链 chatCompletion 使用（`:239`） | 随 #1 一起删；保留 `healthCheck` 子段 | P1 |
| 4 | 健康检查 30s 轮询 `McpGateway.ts:364-385` + `mcp.json:126-129` | 模块加载即启动（单例 `:418`，`core/index.ts:9`、`gateway/index.ts:24` 任何 import 都触发）；每 30s 对 openai/newapi 两个 enabled server 用**真实 apiKey** 打外部 `GET /models`（`:374-377`）；仅 admin GET / 状态展示消费 `serverStatus`（`mcp.ts:13,27`）；生产环境 `http://localhost:3000`（newapi）会被 safe-http https-only 拒绝（`safe-http.ts:369-377`）静默标 false；`unref` 防挂进程（`:384`）；销毁仅定义于 `gateway/index.ts:184` 且**无人调用** | 保留则降频（如 5min）+ 失败退避；或改为按请求触发（对齐 user-mcp `/status` 模式 `routes/user-mcp.ts:426-486`）；同步补 shutdown 时 `destroy()` | P1 |
| 5 | `mcp.json` `code-interpreter` 工具 `:94-101` | 执行体是占位 `{ result: '代码执行功能待实现' }`（`McpGateway.ts:336-338`） | 删条目或置 `enabled:false`（占位实现不得对平台/用户暴露） | P2 |
| 6 | `mcp.json` `web-search` `:68-77` | `enabled:false`、`userAccessible:false`，未启用 | 保留（半配置）或删，二选一 | P3 |
| 7 | `agent-catalog.json` 旧 id 与 `isOfficialAgent` 精确匹配 | 文件 6 个 key：`ai-teaching-agent`、`progress-agent`（manifest 全无）、`learner-model-agent`（`skill:learner-model` 旧别名 `agent-manifest.service.ts:241`）为**旧/幽灵 id**；`skill:goal-conversation`、`skill:path-planning`、`skill:session-wrapup` 在 manifest 但 `userVisible=false` 非 official（`agent-manifest.service.ts:434-443` 只取 userVisible）。`isOfficialAgent` 是**精确匹配不归一**（`agent-catalog.service.ts:52-54`），而 `user-agents.ts:105,157,249,316,357,411` 多处用它校验 → 旧别名用户配置会被误判 404/400；`platform.ts:316` 会把旧 id 计为 `catalogOnly` drift（`:333`）。写函数 `setAgentLifecycleStatus:88-103` 零调用 | 清理文件旧 id；`isOfficialAgent` 内部先 `getCanonicalAgentId` 归一（`agent-manifest.service.ts:377-389`）；`users.ts:22` 的 `teaching: ['ai-teaching-agent']` 历史日志过滤按需保留 | P2 |
| 8 | `agent-prompts.json` | 全仓零引用（§一） | **删** | P2 |
| 9 | `mcp-schema.json` | `mcp.json:2` 引用但文件不存在 | 补 schema 或删 `$schema` 行 | P3 |
| 10 | `McpGateway` 单例生命周期 | 任何 import（`core/index.ts:9`、`gateway/index.ts:24`、`skills/mcp-tool/index.ts:1`、`routes/admin/mcp.ts:2`）即创建并启动健康检查；`destroy()` 无实际调用方 | 改为惰性初始化或随 #4 一并治理 | P2 |
| 11 | 平台对普通用户零可用工具 | `mcp.json` 全部工具 `userAccessible:false`（`:75,84`、code-interpreter 未声明）；`skills/mcp-tool/index.ts:132-137` 非 admin 且非 `userAccessible` 一律 `MCP_TOOL_NOT_FOUND` | 若平台工具确无对外需求，保持现状并在文档标注；否则为任一工具开放 `userAccessible`（本地工具会被 `isLocalMcpTool` 拒绝，`:133`） | P3 |
| 12 | admin MCP 管理端点无 UI 消费 | `frontend/src/api/adminApi.ts:669-681` 定义了 5 个函数，但全仓无 .vue 调用（grep `getMCPConfig|createMCPTool|...` = 0）；`doc/SKILL_LIFECYCLE_SURVEY.md:171` 声称"updateConfig 不回写 mcp.json"与代码不符（实际写，`McpGateway.ts:118-120`） | API-only 面保留需知悉；修正 doc 描述 | P3 |

---

## 四、暴露面评估

### 4.1 端点访问控制（现状良好）
- `/api/admin/mcp`：`index.ts:372`，挂 `adminRouteMiddleware`（`index.ts:362`）= 网络 IP 限制（`middleware/admin-access-restrict.middleware.ts:12-45`，loopback/private/any 三态）+ admin 认证 + 角色校验
- `/api/user/mcp`：`index.ts:394`，`authMiddleware + directUserSessionOnly`（本人会话，投影视角拒绝，`index.ts:342`）
- 敏感出参：admin GET 列表已脱敏（`mcp.ts:17-26`，只回 `hasApiKey`）；**POST/PUT 响应回显明文 key**（`mcp.ts:66,97`，见 §2.1）——在 admin 权限域内，但建议不回显

### 4.2 健康检查外部 `/models` 暴露
- 频率/目标：每 30s × 2 个 enabled server（`mcp.json:19,39,128`；`McpGateway.ts:369-383`），openai 为真实外呼 `https://api.openai.com/v1/models`，携带替换后的**真实 apiKey**（`:375`）
- 日志面：`safe-http.ts` 不打请求头，`logger` 有统一脱敏（`utils/logger.ts:31-39`，`redactLogValue/redactSecretText`）；健康检查自身无日志。**无日志泄漏**
- 网络面：key 会出现在上游（api.openai.com）的访问日志/代理链；若 `.env` 中 `OPENAI_API_KEY` 被误配到不可信 endpoint，等同主动投递密钥。生产下 newapi（`http://localhost:3000`）被 https-only 策略静默判 false（`safe-http.ts:369-377`），健康检查结果失真
- 附带：健康检查走 `safeHttpRequest` 默认 `privateNetworkPolicy: 'runtime'`（`McpGateway.ts:374` 未显式传）→ 生产环境可能放行已授权私网 host（与 user-mcp `/status` 的 `public-only` 不一致，`user-mcp.ts:398,454`）

### 4.3 文件面
- `mcp.json` 在 git 仓库内：一旦 admin 端点使用即明文进工作树 → 提交后进 git 历史（`.secret-scan-baseline.json` 已有 2 个历史凭据指纹先例）；当前磁盘内容为 env 占位符，工作树干净
- `backend/config/` 其余文件无敏感内容

### 4.4 处置优先级总览
- **P0**：admin MCP 写入路径 apiKey 加密落盘（§2.3-1/2）+ 存量迁移脚本（§2.3-3）；如已有明文 key 进过 git → 轮换并登记 baseline
- **P1**：删 chatCompletion 死链（#1）+ `agents` 段/`planner-agent`（#2）+ `routing.strategy/fallback`（#3）；健康检查降频或改按需（#4）
- **P2**：agent-catalog 旧 id 清理与 `isOfficialAgent` 归一（#7）；删 `agent-prompts.json`（#8）；`code-interpreter` 占位下线（#5）；单例生命周期（#10）
- **P3**：`mcp-schema.json`（#9）、`web-search`（#6）、admin 端点回显与无 UI（#12）、doc 修正
