# WenFlow 非功能治理与统一计划

> 审计日期：2026-07-17  
> 架构基线：[`ARCHITECTURE_BASELINE_2026-07.md`](./ARCHITECTURE_BASELINE_2026-07.md)  
> 架构对齐计划：[`ARCHITECTURE_ALIGNMENT_AND_REMEDIATION_PLAN.md`](./ARCHITECTURE_ALIGNMENT_AND_REMEDIATION_PLAN.md)  
> 本文只覆盖非功能治理，不规划新的学习产品功能。

## 1. 结论

平台的核心功能链已经形成，但非功能能力仍处于“有局部实现、缺统一边界和统一门禁”的阶段。

当前最需要统一的不是再增加工具，而是为每个非功能领域建立唯一入口、唯一事实源和统一验收标准：

| 领域 | 应统一为 |
| --- | --- |
| 权限 | 单一认证边界 + 数据库态授权 |
| Projection | 默认拒绝 + 显式路由白名单 |
| Secret | 加密存储 + 统一脱敏 + 轮换 |
| 外部 URL | 统一 `safeFetch` 与 SSRF Policy |
| Prompt | File-as-Truth + 单一 Provenance/Drift 定义 |
| AI 执行 | 唯一 `executeSkill` 入口 |
| 事件 | Durable Outbox 为业务事件主干 |
| Trace/统计 | 单一 Span 模型和不可变调用事实表 |
| API | 单一 Envelope、错误 DTO、Axios Factory |
| 配置 | 可校验的环境 Schema + 一致的文档和单位 |
| 发布 | 根级 `check` + CI + Migration Job |
| 健康 | `/livez`、`/readyz`、Graceful Drain |
| 指标 | Prometheus 或 OpenTelemetry |
| 数据治理 | 分类、保留、删除、备份和恢复策略 |
| 可访问性 | 语义化交互 + axe/键盘门禁 |

在以下发布阻断项完成前，不建议把当前部署定义为“生产安全、可横向扩展或治理达标”：

1. Admin 和 Projection 权限边界。
2. SSRF 防护。
3. API Key 加密、明文响应和示例密钥清理。
4. 生产 Migration 改造。
5. Prompt 多写入口关闭。
6. 根级质量门禁和 CI。
7. 后端构建禁止带类型错误产物。
8. 真实 Readiness 和关键可靠性缺陷修复。

## 2. 分级定义

| 等级 | 定义 |
| --- | --- |
| P0 | 发布阻断；可能导致越权、密钥泄露、内网访问、数据丢失或运行真相源失控 |
| P1 | 短期必须；影响可靠性、审计、故障恢复、调用一致性和质量门禁 |
| P2 | 中期治理；影响性能、可维护性、可访问性、多实例和长期运营 |

状态采用：

- 未修复
- 部分修复
- 已有基础，需统一
- 需决策

## 3. P0 发布阻断项

### NF-P0-1 统一 Admin 权限边界

**状态：第一阶段完成（2026-07-17）**

当前多数 `/api/admin/**` 只经过普通认证，没有统一数据库态管理员授权。部分子路由自行检查管理员，不能替代总边界。

统一方案：

```text
/api/admin/**
  -> authMiddleware
  -> rejectProjectionToken
  -> requireCurrentAdminFromDatabase
  -> acpContextMiddleware
  -> admin routes
```

要求：

1. 查询当前数据库用户，而不是只相信 JWT `isAdmin` claim。
2. 用户已禁用、删除或降权时，旧 Token 立即失去 Admin 权限。
3. Projection Token 默认禁止访问任何 Admin API。
4. 子路由只保留资源级授权，不重复做身份认证。
5. 自动枚举 Admin 路由做权限矩阵测试。

验收：

- 普通 JWT、Access Grant、Virtual Learner、Synthetic Projection 调用任意 Admin API 均为 403。
- Admin 降权后旧 Token 不能继续访问。
- GET、POST、PUT、PATCH、DELETE 均有自动化测试。

已完成：

- 所有 `/api/admin/**` 路由统一挂载 `authMiddleware + adminMiddleware`。
- `adminMiddleware` 明确拒绝 Projection 身份，并查询 `users.isAdmin` 作为当前权限事实源。
- `/api/admin-auth/me` 改用同一认证和授权链。
- 移除 Goal Conversation、Virtual Learner Admin Router 中重复的认证挂载。
- 中间件测试覆盖普通用户、Projection、已降权管理员和有效管理员。
- 后端 TypeScript Build 和完整 Jest 通过。

待增强：

- 增加自动枚举全部 Admin Endpoint 和 HTTP Method 的权限矩阵集成测试。
- 用户模型暂无 `disabledAt/status` 字段；后续账户状态治理时将禁用状态加入数据库态授权。

### NF-P0-2 Projection 默认拒绝与 Token 隔离

**状态：边界第一阶段完成（2026-07-17）**

Synthetic Projection 已有能力和资源白名单，但 Access Grant 和 Virtual Learner 仍可通过普通认证边界进入未显式设置 Policy 的接口。

统一方案：

1. Projection Token 只进入显式白名单，其他认证接口默认拒绝。
2. 禁止进入 Admin、API Key、MCP、开发者、账户授权和调试配置接口。
3. 用户 JWT、Admin JWT、Projection Token 使用不同密钥或至少不同 issuer/audience。
4. Projection Token 增加 `jti`、服务端绑定和撤销能力。
5. 前端优先存入内存或 `sessionStorage`，不长期放入 `localStorage`。

验收：

- 每类 Projection Token 都有路由白名单测试。
- Token 对应授权或实验撤销后立即失效。
- 用户、Admin、Projection Token 不能跨类型使用。

已完成：

- 新增与 Projection 来源无关的统一拒绝中间件。
- Agent/Skill 用户配置、API Key、模型覆盖、MCP 和开发者授权路由全部拒绝 Projection。
- 账户资料修改拒绝 Projection，同时保留 Dashboard、学习者中心和学习数据的受控读取。
- 移除相关用户 Router 内重复认证，避免 Access Grant 使用次数重复增加。
- 测试覆盖 Access Grant、Virtual Learner、Synthetic Projection 和普通 JWT。

待完成：

- 用户 JWT、Admin JWT、Projection Token 的密钥或 issuer/audience 隔离。
- Projection `jti`、服务端撤销和 Virtual Learner 会话绑定。
- 前端 Projection Token 从 `localStorage` 迁移到短生命周期存储。
- 自动枚举全部敏感 Endpoint 的拒绝矩阵测试。

### NF-P0-3 Secret 生命周期治理

**状态：数据库静态加密和 Git 扫描门禁完成（2026-07-17）**

当前主要缺口：

- 本机 `.env`、数据库和日志 ACL 过宽。
- 已知历史凭据仍需在 Provider 侧确认撤销、轮换并审计调用记录。

统一方案：

1. API Key 使用 AES-256-GCM 信封加密，保存 ciphertext、iv、authTag、keyVersion。
2. 主密钥来自环境、KMS 或系统凭据库，不能与密文同库。
3. 所有响应统一返回 `apiKeyConfigured` 和掩码，不返回原文。
4. 独立设计“替换密钥”和“删除密钥”操作，空字符串不能有歧义。
5. 迁移并轮换现有明文和疑似泄露密钥。
6. 删除默认管理员密码，未提供强密码时脚本拒绝执行。
7. 加入 Gitleaks 等 Secret Scan。
8. 收紧 `.env`、SQLite、日志和备份文件 ACL。

验收：

- SQLite 和数据库 Dump 中搜索不到 API Key 原文。
- API、日志、错误和 Trace 中不出现完整 Key。
- 缺失主密钥时安全失败，不回退明文。
- Git 当前内容和历史经 Secret Scan 后无有效密钥。
- 普通本机用户不能读取 `.env`、数据库和日志。

已完成：

- Admin Agent/Skill 模型配置、用户 Agent 覆盖和用户 MCP 响应统一隐藏嵌套 Secret，仅返回 `...Configured` 状态。
- 更新配置时空 Secret 表示保留现有值，MCP 按 Server/Tool ID 合并，避免保存掩码后误删密钥。
- Winston 文件和控制台日志增加统一递归脱敏，覆盖 API Key、Authorization、Cookie、密码、Token、Bearer、JWT 和常见 `sk-` 文本。
- 删除遗留 `apiKeyRaw` 明文响应。
- 清理受版本控制示例文件中的真实 Key 形态值。
- 初始管理员不再使用 `admin123`；未显式提供强密码时跳过创建，创建脚本不再输出密码。
- 新增 AES-256-GCM 版本化 Envelope `wfsec:v1`，随机 12 字节 IV、认证标签和 AAD 字段绑定。
- 平台、Agent、Skill、用户 Provider、用户 Agent 覆盖和用户 MCP JSON Secret 新写入均为密文，运行前统一解密。
- 生产缺少 Keyring 时拒绝启动；密文缺 Key、篡改或上下文不匹配时安全失败，不回退默认 Key。
- 支持多 Key ID 解密和当前 Key 写入，提供 `secrets:audit` / `secrets:migrate` 幂等明文迁移与轮换命令。
- API Executor 增加最终密文误用阻断，防止 Envelope 被作为 Bearer Key 发送。
- MCP `healthCheck` 和嵌套 `headers/auth/env` Secret 纳入加密、脱敏和空值保留。
- 新增零依赖 `security:scan:current/history`，当前树扫描覆盖 tracked 与未忽略的 untracked 文件，历史扫描覆盖所有可达 Git refs。
- 历史基线只保存两枚已知泄露凭据的 SHA-256 指纹，不保存原文，也不允许当前树豁免。
- 根级 `npm run check` 纳入当前树 Secret Scan；CI 使用完整 checkout 并额外扫描完整历史。
- 7 个 SQLite 备份、4 个 Vue 备份和 Prompt 临时备份目录已从 Git index 移除，本地恢复副本保持不变并被 `.gitignore` 隔离。
- 新增 `SECURITY.md`，明确凭据泄露响应、数据库和 Keyring 备份、Windows/Linux ACL 及恢复演练要求。
- 现行管理员文档和测试用户种子不再提供或打印弱默认密码。

待完成：

- 在 Provider 侧撤销/轮换已知历史 Key，并检查调用日志、来源 IP 和账单。
- 收紧 `.env`、SQLite、日志和备份文件 ACL。

### NF-P0-3.1 MCP 本地文件读取边界

**状态：完成（2026-07-17）**

- 移除 `filePath.startsWith(allowedPath)` 前缀校验，统一使用规范化路径和路径组件边界判断。
- 配置根目录与候选文件均通过 `realpath` 校验，拒绝 `..`、相邻前缀目录及符号链接/Junction 逃逸。
- 仅允许读取常规文件，读取前后执行字节上限检查，无效 `maxFileSize` 配置安全失败。
- 生产镜像显式复制 `backend/config/mcp.json`，避免容器启动后缺失 MCP 配置。

### NF-P0-3.2 双库正式备份与隔离验证

**状态：完成（2026-07-17）**

- 新增 SQLite Online Backup 双库备份，覆盖已提交但尚未 checkpoint 的 WAL 数据，禁止将运行中 `.db` 文件复制视为正式备份。
- 备份前后验证 `integrity_check`、`foreign_key_check`、主库/System DB 表归属及 Prisma migration checksum。
- 使用仓库外 staging 目录，双库和 manifest 完成后才原子发布；失败清理 `.partial-*`。
- Manifest 不包含源路径、数据库 URL 或 Keyring 原文，只保存数据库 SHA-256、migration 和 Keyring 指纹。
- 隔离验证先校验文件 SHA-256，再复制到 OS 临时目录以只读方式验证，不连接运行库。
- 明确两个 SQLite 文件不是跨库原子快照，创建命令要求停写并显式确认 `--confirm-quiesced`。
- Docker 提供独立 `docker-compose.operations.yml`，不影响常规 Compose 解析；它将主数据卷只读挂载并把备份写入独立宿主目录。

### NF-P0-4 统一 SSRF 防护

**状态：第一阶段完成（2026-07-17）**

Web Extractor、Image Analyzer、自定义模型 Endpoint、MCP 和平台模型测试均可访问外部 URL，目前没有统一的协议、DNS、内网和重定向防护。

统一方案：建立共享 `safeFetch`：

1. 生产默认只允许 `https:`。
2. DNS 解析后拒绝 loopback、link-local、RFC1918、IPv6 ULA 和云元数据地址。
3. 禁止自动重定向，或每次重定向重新校验目标。
4. 设置连接、响应、总时长和最大 Body。
5. 平台 Provider Endpoint 使用 Allowlist。
6. 对用户自定义 Endpoint，不自动向新 Host 发送已有 Secret，必须显式确认或重新输入。
7. 所有 URL 输入共用同一 Zod Schema 和 `safeFetch`。

验收：

- `localhost`、`127.0.0.1`、`169.254.169.254`、RFC1918、`::1` 和 DNS Rebinding 目标全部拒绝。
- 公网地址重定向到内网时被拒绝。
- 超大响应、慢响应和非 HTTPS 请求按 Policy 失败。

已完成：

- 新增共享 `safeHttpRequest`，所有可配置外部请求统一经过该边界。
- 生产环境仅允许 HTTPS；开发和测试允许 HTTP、本机和 RFC1918 局域网地址，支持本地模型与 LAN 调试。
- 所有环境始终拒绝 Link-local、云元数据、CGNAT、组播和文档保留地址。
- 生产环境默认拒绝本机和局域网目标，可通过 `SAFE_HTTP_PRIVATE_HOSTS` 精确放行私有模型 Host 或 IP。
- 域名请求先解析全部地址，任一地址落入受限网段即拒绝。
- DNS Lookup 固定到已校验 IP，降低校验后重新解析的 Rebinding 风险。
- 禁止 HTTP 客户端自动重定向，每一跳重新进行 URL 和 DNS 校验。
- 携带 Authorization/Cookie 等敏感凭证时禁止跨源重定向。
- 统一设置请求超时、响应体上限和重定向上限。
- Web Extractor、Image Analyzer、遗留 Basic Extractor、AI Gateway、平台/用户 Provider 测试、MCP Gateway 和 MCP 用户测试均已接入。
- 测试覆盖内网 IP、IPv6、DNS 解析到内网、重定向到内网、敏感凭证跨源重定向和生产 HTTP 拒绝。

待增强：

- 将 `SAFE_HTTP_PRIVATE_HOSTS` 后续迁入管理员维护的受控配置和审计流程。
- 增加网络层集成测试，验证真实 Socket 连接、超时取消和响应体超限。
- 对不同调用类型设置更细的协议、Host、端口和 Body Size Policy。

### NF-P0-5 Prompt 真相源和发布入口统一

**状态：HTTP 正式写入口已关闭（2026-07-17）**

当前至少存在：文件同步、DB Draft/Publish、DB ACTIVE 原地热改、Prompt Lab 写生产文件、遗留 JSON Prompt 等多条写路径。

统一方案采用 File-as-Truth：

1. 禁用 Prompt create/update/delete/publish 在线写 API。
2. 禁用 DB ACTIVE 原地热改。
3. Prompt Lab 只生成 Patch、导出文件或 PR，不直接写生产目录。
4. 下线遗留 JSON Prompt 写入口。
5. Admin 只保留预览、Diff、Lint、评测、Provenance 和同步状态。
6. Prompt 发布只允许文件变更、Git 审核和部署同步。

验收：

- 除同步服务外，无 HTTP API 能改写正式 Prompt 或 ACTIVE 内容。
- 生产进程不能通过 Admin 请求写 `prompts/*.md`。
- 每个 ACTIVE Prompt 可追溯到文件 SHA-256 和 Git Commit。
- 重启不会让运行 Prompt 回滚到另一条真相源。

已完成：

- `/api/admin/agent-prompts/**` 除 GET/HEAD 外统一返回 `409 PROMPT_FILE_AS_TRUTH_READ_ONLY`。
- 禁止 Admin HTTP 创建、更新、删除、发布 Prompt 版本及执行 seed/backfill。
- 禁止 Prompt Ops 手动 Sync、ACTIVE 原地 source/fields 热更换和手动重编译落库。
- 禁止 Prompt Lab 保存 source/manifest、创建模板和发布到 `prompts/*.md`/DB ACTIVE。
- Prompt Lab `compile-source` 改为纯内存 Dry Run，不再写 `prompt-lab/compiled`。
- 未挂载的遗留 Agent Lab JSON Prompt 更新端点也显式接入只读拒绝守卫。
- 保留 Prompt 只读查看、Diff、Lint、评测集 CRUD、评测运行、配置校验和内存编译预览。
- Admin Skill 详情改为只读 Prompt 检视，展示 DB ACTIVE、编译产物、Hash 和运行时解析结果。
- 原“Prompt 发布”入口改为“Prompt 检视与 Dry Run”，不再提供保存、热更换或发布按钮。
- 自动化拒绝矩阵覆盖 Prompt Method、正式写路径、允许的评测/Dry Run 和只读 GET。

待完成：

- 删除已不再挂载的旧 Prompt 编辑、字段表和发布组件及后端不可达 handler，减少维护噪声。
- 增加统一 Prompt Provenance，记录文件 Hash、DB 镜像 Hash、Git Commit 和部署 ID。
- 将启动同步移动到显式部署步骤，并增加同步审计记录。

### NF-P0-6 生产数据库迁移和备份基线

**状态：双库 Migration 基线和 clean replay 已完成（2026-07-17）**

主库已有部分 Migration，但开发和生产启动仍使用 `db push`，Docker 使用 `--accept-data-loss`；System DB 缺少同等受控的 Migration 流程。

统一方案：

1. 应用容器不执行 DDL。
2. 发布前独立 Migration Job 对主库和 System DB 执行受控迁移。
3. 所有 Migration 文件进入版本控制并评审。
4. 破坏性迁移前自动备份并进行恢复演练。
5. 清理源码目录和 Git 中的数据库备份副本。
6. 确认 RPO、RTO、加密和保留周期。

验收：

- 生产启动路径不存在 `db push` 和 `--accept-data-loss`。
- 空库可由 Migration 完整创建。
- 已有库执行迁移后无 Schema Drift。
- Git 不跟踪 `.db`、`.bak`、`.backup`。
- 备份可在隔离环境恢复并通过完整性检查。

已完成：

- Docker EntryPoint 已删除两库 `db push --accept-data-loss`。
- 后端生产 `npm start` 不再隐式执行 `prisma:prepare` 或修改数据库结构。
- 应用容器现在只启动服务，Schema 变更必须在部署前独立执行。

已完成：

- System Schema 移至 `prisma/system/schema.prisma`，主库和 System DB 分别拥有独立 `migrations/`。
- 原混合增量 SQL 移至 `prisma/legacy-migrations/` 审计归档，不再参与 Prisma deploy。
- 两库均建立从当前完整 Schema 生成的 clean-install baseline 和 `migration_lock.toml`。
- 新增临时空库 clean replay：双库 deploy 两次、status、无 drift、表归属、migration 记录、SQLite integrity 和 foreign key 检查。
- 根级 `npm run check` 和 CI 纳入双库 clean replay。
- 默认开发准备从 `db push` 改为双库 `migrate deploy`；生产 Compose 使用一次性 migration service，应用容器继续不执行 DDL。
- 新增 `prisma:baseline:audit/adopt`，仅允许结构完全一致且无旧/失败/分叉历史的现有库采纳 baseline。
- 本地 SQLite URL 统一为主库 `file:./dev.db`、System DB `file:../system.db`，启动脚本拒绝旧嵌套路径。

待完成：

- 在真实生产库副本上完成备份恢复和 baseline/旁路重建演练。
- 对存在旧或失败 `_prisma_migrations` 历史的长期库执行旁路新库重建和数据校验。

### NF-P0-7 最小质量与类型门禁

**状态：Required Baseline 已完成（2026-07-17）**

根 `npm test` 是占位失败命令；没有 CI；后端允许类型错误仍 Emit；前端 Build 不执行 `vue-tsc`。

统一方案：

```text
npm run check
  -> backend typecheck
  -> backend lint
  -> backend Jest
  -> frontend vue-tsc
  -> frontend lint check
  -> frontend unit tests
  -> critical Playwright smoke
  -> backend build
  -> frontend build
  -> Prisma migration validation
```

要求：

1. 后端立即设置 `noEmitOnError: true`。
2. 前端 Build 前运行 `vue-tsc --noEmit`。
3. CI 在干净环境、临时数据库中运行。
4. 关键检查成为 Required Status Checks。

验收：

- 人为加入 TypeScript 错误时，本地 Build、Docker Build 和 CI 都失败。
- 根目录一条命令能够完成主要质量检查。
- CI 不通过时不能发布同一 Commit。

已完成：

- 根级 `npm run check` 统一执行双 Prisma Schema 校验、后端 TypeScript `--noEmit`、完整 Jest、后端构建和前端构建。
- 根 `npm test` 不再是占位失败命令，统一运行后端 CI 测试。
- 后端启用 `noEmitOnError: true`，增加 `typecheck`、`test:ci` 和 `prisma:validate`。
- 前端 lint 拆分为无修改检查和 `lint:fix`，增加 `typecheck` 命令。
- 新增 `.github/workflows/quality-check.yml`，Node 20 干净环境执行 required baseline。

待完成：

- 前端全量 `vue-tsc` 和前后端 lint 仍有存量错误，暂未纳入 required `check`。
- 增加正式 Playwright Smoke。
- 仓库侧将 CI Job 配置为 Required Status Check。

### NF-P0-8 修复已确认的可靠性配置错误

**状态：部分完成（2026-07-17）**

需立即修复的确定性错误：

1. `LOGIN_LOCK_DURATION` 文档按秒，代码按毫秒，`900` 实际约为 0.9 秒。
2. AI Gateway `maxRetries = 1` 的循环只执行一次，总体没有 Retry。
3. 配置文档中的 DB 路径、前端 API 环境变量和时长单位互相冲突。

统一方案：

- 所有 Duration 环境变量带单位后缀，例如 `_MS` 或 `_SECONDS`。
- 建立环境变量 Zod Schema，启动时输出脱敏后的有效配置。
- AI Gateway 使用明确的 `maxAttempts`，并支持 Backoff、Jitter、`Retry-After` 和总 Deadline。
- README、DEPLOYMENT、`.env.example` 从同一配置定义维护或由 CI 校验。

验收：

- 900 秒配置确实锁定约 15 分钟。
- 第一次 503、第二次成功时实际发出两次请求。
- 认证失败、余额不足和非法请求不重试。
- 文档、代码和样例对变量名、路径、单位完全一致。

已完成：

- 登录锁定改为显式 `LOGIN_LOCK_DURATION_SECONDS`，默认 900 秒。
- 兼容已有 `LOGIN_LOCK_DURATION`：普通值按秒解释，旧启动脚本生成的 `900000` 按毫秒迁移为 900 秒。
- AI Gateway 改为 `maxAttempts = 2`，首次 503 后实际重试一次。
- 401 等不可重试错误只请求一次，失败日志记录实际 Attempts。
- 增加锁定窗口、旧变量兼容、503 重试和 401 不重试测试。

待完成：

- 建立完整环境变量 Zod Schema。
- 统一数据库路径、前端 API 环境变量及全部时长变量单位。
- 支持 Retry Backoff Jitter、`Retry-After` 和总 Deadline。

### Admin 入站网络范围补充（2026-07-17）

- Admin 登录和全部 Admin API 均执行网络来源限制。
- 新增 `ADMIN_ACCESS_MODE`：
  - `loopback`：仅服务器本机。
  - `private`：本机和 RFC1918 局域网，默认值，适合无域名的 LAN 开发调试。
  - `any`：不限制来源，不建议直接用于公网。
- `ADMIN_ALLOWED_IPS` 可精确放行额外客户端 IP。
- 默认 `private` 模式拒绝公网客户端，同时允许 `127.0.0.1`、`::1`、`10/8`、`172.16/12`、`192.168/16`。
- Admin 原“API 配置”页面已升级为“连接与安全”，统一管理模型连接、Admin 访问范围和外部私有网络策略。
- 网络策略保存到 System DB，并在当前服务实例热生效；未保存平台策略时继续采用环境变量默认值。
- 生产默认不信任 `X-Forwarded-For`，并拒绝 `TRUST_PROXY=true`；只允许明确代理 IP/CIDR 或固定跳数。
- Docker 后端不再发布宿主机 `3001`，仅通过固定代理网络接受 Nginx 流量；Nginx 覆盖客户端自带的 `X-Forwarded-For`。
- 页面支持：
  - Admin `loopback/private/any` 三档切换。
  - 额外客户端精确 IP Allowlist。
  - 本机/RFC1918 私有网络总开关。
  - 总开关关闭后的精确 Host/IP Allowlist。
- 从 LAN 地址切换为 `loopback` 时，页面会阻断式确认，提示当前浏览器保存后将失去后台访问。

## 4. P1 短期统一项

### NF-P1-1 认证只执行一次

**状态：未修复**

外层和子 Router 重复挂载认证。Access Grant 每次认证会更新使用次数，导致一次请求可能记录多次使用。

统一方案：

- 身份认证只在 Router 边界执行一次。
- 子 Router 只做资源授权。
- Token Verify 和 Grant Usage 更新具有 Request Scoped Guard。

验收：

- 单次请求只 Verify 一次 Token。
- Access Grant `useCount` 一次请求只增加 1。

### NF-P1-2 JWT 会话和浏览器存储统一

**状态：Readiness 和 Shutdown 第一阶段完成（2026-07-17）**

已有 JWT Secret 强度和主要路径 HS256 校验，但缺少 issuer、audience、撤销和数据库态状态校验；Admin Token 生命周期过长并保存在 `localStorage`。

统一方案：

1. 所有 Verify 使用统一服务，固定算法、issuer、audience。
2. Admin Access Token 缩短到 15–60 分钟。
3. 采用 HttpOnly Secure SameSite Cookie，或短 Access Token + Refresh Rotation。
4. 增加 `tokenVersion`、`passwordChangedAt`、`disabledAt`。
5. 降权、禁用和改密使旧 Token 失效。

### NF-P1-3 全路由输入校验

**状态：部分修复**

部分认证和学习路由已使用 Zod，但 Admin、模型、MCP 和 Goal 对话等接口仍存在原始 `req.body` 直传或缺少长度上限。

统一方案：

- 所有 Route 使用 `.strict()` Zod Schema。
- 限制字符串、数组、Prompt、历史消息、URL、分页和模型参数。
- 禁止原始 `req.body` Spread 到数据库。
- 超限统一返回 400/413 和 Trace ID。

### NF-P1-4 Prompt Provenance 和 Drift 单一定义

**状态：未修复**

当前 Drift 至少按 code-vs-DB、file-vs-DB、fallback-vs-DB 三种方式计算，算法也不同。

统一方案：建立 `PromptProvenanceService`：

```ts
type PromptProvenance = {
  canonicalSkillId: string
  fileHash?: string
  dbSourceHash?: string
  compiledHash?: string
  effectiveHash: string
  status:
    | 'in-sync'
    | 'file-db-drift'
    | 'compile-stale'
    | 'runtime-override'
    | 'file-missing'
    | 'db-missing'
}
```

统一 LF 归一化规则和 SHA-256，删除简易 Hash 和代码 fallback drift。

### NF-P1-5 所有 AI 能力进入唯一 Skill 执行链

**状态：部分修复**

`executeSkill()` 已存在，但 Goal、Path、测试路由和部分服务仍直接调用 Handler 或 Gateway；Gateway 还有另一套 `executeSkill`。

统一方案：

1. 只保留一个公开 `executeSkill(canonicalSkillId, input, context)`。
2. Route 和 Service 禁止直接导入 Skill Handler。
3. Gateway 的 Skill API 变成统一入口的薄代理。
4. Skill 内部允许调用模型 Gateway，但业务调用必须先进入 Skill Executor。
5. ESLint `no-restricted-imports` 防止回归。

### NF-P1-6 Agent、Skill、Manifest 和 Registry 统一

**状态：部分修复**

Manifest 已明确五个顶层 Agent，但 Skill 仍注册到 AgentRegistry，Admin 还从 Manifest、Registry、Runtime Definition 等多源组合拓扑。

统一职责：

| 组件 | 唯一职责 |
| --- | --- |
| Manifest | Canonical ID、Kind、Alias、隶属关系 |
| Runtime Definition | Manifest 派生的契约和步骤描述 |
| Registry | 当前进程 Handler 与健康状态 |
| Admin Topology | Manifest + Registry Health + 调用统计 |

验收：

- `skill:*` 不进入 AgentRegistry。
- Manifest、Registry 和 Runtime Definition 差异为零。
- Admin 不再通过 ID 后缀推断节点类型。

### NF-P1-7 Durable Event 唯一业务主干

**状态：部分修复**

Outbox 已有 Claim、Retry、Dead 和部分 Inbox 幂等，但内存 EventBus 与 Durable Event 双轨，LearnerCoordinator listener 未接线。

统一方案：

1. 业务状态变化只允许事务内写 Outbox。
2. 内存总线改名为 `ProcessSignalBus`，明确允许丢失。
3. 有价值的旧 Listener 迁为 Durable Consumer；无价值的删除。
4. `LearnerCoordinator.setupEventListeners()` 不直接补接线，先消除与 Durable Consumer 的重复逻辑。
5. 无 Consumer 的 Durable Event 启动告警或失败。

### NF-P1-8 Outbox 长任务续租和 Consumer 幂等

**状态：部分修复**

Outbox 锁固定五分钟，消费期间没有 Heartbeat。长消费可能被另一实例重新 Claim；Inbox 幂等依赖各 Consumer 自行实现。

统一方案：

1. 处理期间周期刷新 `lockedAt`，带 Owner/Fencing 条件。
2. Registry Wrapper 强制每个 Consumer 使用 Inbox 幂等。
3. 每个 Consumer 拥有独立 Delivery 状态，避免其中一个失败导致已成功 Consumer 重跑。
4. 暴露 Pending、Retry、Dead、Oldest Age、Claim Conflict 指标。

验收：

- 两个 Worker、消费超过锁周期时，业务副作用仍只发生一次。
- 单个 Consumer 失败不会重复执行已成功 Consumer。

### NF-P1-9 Health、Readiness 和 Shutdown

**状态：部分修复**

当前 `/health` 和 `/livez` 反映进程存活，`/readyz` 检查双库、ACTIVE Prompt、完整字段路由 seed 和 Gateway 注册；Nginx 代理真实健康状态。Shutdown 已具备 Drain、全局 Deadline 和主要组件停止，仍需把所有内部 fire-and-forget 任务纳入统一 Background Task Tracker。

统一方案：

- `/livez`：进程和事件循环存活。
- `/readyz`：主库、System DB、初始化、关键 Prompt 和 Worker 状态。
- Docker Compose 配置 Backend Healthcheck。
- 收到 SIGTERM 后立即将 Readiness 设为 503。
- 20–30 秒硬 Deadline，超时非零退出。
- 停止 HTTP、Worker、Collaboration、Timer、Gateway 和 Prisma。
- 处理 `uncaughtException`、`unhandledRejection` 的受控退出。

已完成：

- 收到 SIGTERM/SIGINT 后同步进入 draining，`/readyz` 立即返回 503 且不再查询数据库。
- 新增幂等 Application Lifecycle Coordinator，默认 25 秒全局 Deadline，配置范围为 1–120 秒。
- HTTP 先停止接收新连接并关闭 idle connection；Deadline 到期后调用 `closeAllConnections()` 强制结束。
- Teaching idle scan 保存 timer 和 in-flight Promise，停止时不再启动新扫描并等待当前扫描。
- Agent Collaboration 使用具名监听器，stop 时取消订阅并等待已触发 handler。
- Outbox、Gateway/EventBus 和双 Prisma 按顺序停止，数据库最后断开；清理错误进入报告并导致非零退出。
- 启动失败、监听端口错误、`uncaughtException` 和 `unhandledRejection` 进入同一受控关闭路径。
- Docker backend `stop_grace_period=35s`，大于应用默认 Deadline。

待完成：

- EventBus 已统一包装、捕获并跟踪异步 handler，Gateway close 会等待级联 handler 稳定归零。
- 新增全局 Background Task Tracker，使用 lazy factory 在 drain 后拒绝任务真正启动，并等待集合稳定归零。
- PathCoordinator 异步生成、核心恢复、正常/重试阶段补全、Dashboard refresh、任务完成 learner snapshot、启动回填和恢复轮询已接入 Tracker。
- PathCoordinator 在 drain 拒绝时调用原业务 `onError` hook，避免占位路径永久停留在 generating。
- 待继续接入低优先级异步工作：Skill span、Admin Arena pipeline、插件 warmup；路径 heartbeat 由已跟踪父任务生命周期覆盖。
- 为强制退出时的 Outbox processing lease 增加 best-effort 释放或更短的可配置接管窗口。

### NF-P1-10 统一 Trace、Span 和统计事实源

**状态：未修复**

Skill Registry、Prompt Log、Agent Call Log 和 Admin 启发式聚合形成多套统计口径。

统一层级：

```text
Agent / Coordinator Span
  -> Skill Invocation Span
  -> Prompt Assembly / Prompt Call Span
  -> Model Attempt Span 1..n
```

统一字段：

- `traceId`
- `spanId`
- `parentSpanId`
- `actorType`
- `actorId`
- `operation`
- `promptVersion/provenanceId`

不可变 Span 表作为事实源，Registry 只保存运行状态或异步物化汇总，不再通过 JSON contains 做主统计。

### NF-P1-11 日志脱敏、输出和保留

**状态：未修复**

生产日志可能记录用户文本、Prompt、模型响应预览和 Reasoning；Winston 没有统一递归脱敏；容器生产模式主要写文件且无轮转。

统一方案：

1. 生产默认 JSON 输出 stdout/stderr。
2. Logger 递归 Redact authorization、cookie、token、apiKey、password、secret、prompt、messages、content、reasoning。
3. 默认只记录 Hash、长度、状态、耗时、Token Usage 和错误分类。
4. 内容调试日志仅限本地、显式开关和短保留。
5. 标准化 requestId、traceId、route template、status、duration、instanceId。
6. 文件日志如保留，必须 Rotation、Size Limit 和 Retention。

验收：

- 输入唯一测试 Secret 和用户文本后，生产日志搜索不到原文。
- `docker logs` 可以看到结构化启动、请求和错误日志。

### NF-P1-12 Metrics、告警和故障可见性

**状态：未修复**

现有 Performance Monitor 未接线，也不是跨实例可抓取的指标系统。

接入 Prometheus 或 OpenTelemetry，至少包括：

- HTTP Count、Error Rate、Duration Histogram
- AI Provider Duration、Tokens、Timeout、Retry、Breaker State
- Outbox Pending、Dead、Oldest Age、Claim Conflict
- Path Lease Expired、Fenced、Generation Duration
- DB Latency、Transaction Error
- Cache Hit/Miss/Eviction
- CPU、Memory、Event Loop Lag

建立至少五类告警：5xx、AI Timeout、Dead Outbox、Readiness Failure、任务积压。

### NF-P1-13 API Envelope、错误 DTO 和 Axios Factory

**状态：未修复**

前端存在多个 Axios Client，超时从 10 秒到 300 秒，返回 AxiosResponse、Envelope 或 `data.data` 的行为不一致。

统一方案：

```ts
type ApiEnvelope<T> =
  | { success: true; data: T; meta?: ApiMeta }
  | { success: false; error: ApiError }
```

```ts
createApiClient({ authMode: 'user' | 'admin' | 'none' })
```

要求：

- API Helper 统一返回业务 DTO，不返回 AxiosResponse。
- 统一 `ApiClientError`：status、code、message、details、traceId。
- 删除裸 Axios 和旧 Request Client。
- URL 统一以 Base URL 为准，不重复 `/api`。
- Timeout 按普通请求、写操作、AI 长任务分类。

### NF-P1-14 可重复的自动化测试

**状态：部分修复**

后端有 Jest 基础，但 DB Integration 默认跳过；Playwright 不自动启动服务且部分失败只记录警告；前端没有单元、组件和可访问性测试。

统一方案：

1. DB Integration 在 CI 使用临时 SQLite 文件运行。
2. Playwright `webServer` 自动启动前后端。
3. 关键失败必须 Assert，不允许记录警告后通过。
4. 测试账户由 Global Setup 创建，不使用固定弱密码。
5. 前端加入 Vitest、Vue Test Utils。
6. 核心页面加入 axe Smoke 和键盘流程。
7. 设置初始覆盖率基线并逐步提高。

## 5. P2 中期治理项

### NF-P2-1 数据分类、保留、删除和导出

**状态：需决策**

用户学习数据分散在业务表、Outbox/Inbox、Evidence、Projection、调用日志、文件日志和备份中，目前没有统一保留和删除矩阵。

需要确认：

| 数据 | 需要的决策 |
| --- | --- |
| AI Prompt/Response | 是否落盘、保留时长、访问角色 |
| Outbox/Inbox | 已处理事件 TTL 或归档周期 |
| Learner Evidence | 产品用途、用户同意、保留期 |
| Projection | 可重建数据的 TTL |
| 调用日志 | 内容字段、审计期、脱敏规则 |
| 备份 | RPO、RTO、加密、保留和销毁 |
| API Key | 账户删除后的立即安全删除 |

验收：

- 用户删除流程覆盖所有在线派生记录。
- 已处理 Outbox/Inbox 有自动清理任务。
- 可重建 Projection 有 TTL。
- 备份和日志中的删除例外有明确期限和访问控制。

### NF-P2-2 Circuit Breaker 和 Provider 韧性

**状态：部分实现但未接线**

代码中存在 Retry/Circuit Breaker 工具，但没有接入主 AI Gateway，且现有 Helper 每次创建新 Breaker，无法跨请求累计状态。

统一方案：

- 按 Provider/Endpoint 建立长生命周期 Breaker Registry。
- Timeout 通过 AbortSignal 取消底层请求。
- Retry、Breaker、Provider Fallback 共用总 Deadline。
- 暴露 Breaker State 和 Transition Metrics。

### NF-P2-3 长任务异步化和 Timeout Policy

**状态：部分修复**

前端普通 Client 使用五分钟超时，Nginx 也允许五分钟读取，说明部分长 AI 工作仍通过同步 HTTP 承担。

统一方案：

- 普通查询 10–30 秒。
- 普通写操作 30–60 秒。
- 长 AI 任务采用 Job + Polling/SSE，支持恢复和取消。
- Retry 使用总 Deadline，不为每次 Attempt 重新分配完整超时。

### NF-P2-4 缓存边界和多实例一致性

**状态：部分修复**

缓存均为进程内 Map；Prompt 切换和用户缓存清理只影响当前实例，部分清理前缀可能误清其他用户 Session。

统一方案：

- 单实例继续使用内存缓存，但写入正式部署约束。
- 多实例前迁移 Redis 或建立 Durable Invalidation。
- Cache Key 强制包含 User/Tenant/Version。
- Prompt 使用版本化 Cache Key。
- 修复按通用 `session:` 前缀清理的问题。

### NF-P2-5 SQLite 单实例、Worker 和 PostgreSQL 路线

**状态：需决策**

短期明确：当前只支持单后端实例和本地 SQLite 文件。

进入多实例前必须：

1. 主库和 System DB 迁移到服务型数据库。
2. Worker 与 API 角色分离，或增加 Leader Election。
3. 所有定时任务具备 Lease/Fencing。
4. 缓存和 Rate Limit 使用共享 Store。
5. 做并发、幂等和故障恢复测试。

### NF-P2-6 巨型模块渐进拆分

**状态：未修复**

后端和前端存在多处 2000–5000 行文件。拆分必须在 Characterization Test 和 Contract Test 建立后进行。

优先拆分：

- `learning.service.ts`
- `AITeachingCoordinator.ts`
- Admin Virtual Learner/Platform Routes
- `GoalConversation.vue`
- `LearningPathDetail.vue`
- `LearningPaths.vue`
- `LearningPage.vue`
- `adminApi.ts`

新增文件建议采用 500–800 行软阈值，超出需评审说明。

### NF-P2-7 TypeScript 严格化

**状态：前端配置较好，后端未完成**

顺序：

1. `noEmitOnError: true`
2. `noImplicitAny: true`
3. `strictNullChecks: true`
4. 最终 `strict: true`

优先处理 LLM JSON、API DTO、Prisma JSON、Event Payload 和 Provider Config 边界。

### NF-P2-8 依赖、Node 和 Package 治理

**状态：未修复**

统一方案：

- 本地、CI、后端 Docker 和前端 Docker 使用同一 Node LTS。
- 增加 `engines`、`.nvmrc` 或 Volta 配置。
- Docker 使用 `npm ci`。
- 决定是否迁移 npm workspaces；若不迁移，明确三套 Package/Lockfile 策略。
- 配置 Dependabot/Renovate、OSV 或 `npm audit`。
- 高危运行时漏洞阻断发布或必须有时限豁免。

### NF-P2-9 可访问性统一

**状态：部分修复**

统一方案：

- 点击交互优先使用原生 `button`，不使用无键盘行为的 `div/span`。
- 折叠控件使用 `aria-expanded`、`aria-controls`。
- 通知、加载、错误和 AI 回复状态按需使用 `aria-live`。
- 提供可见焦点和 Skip Link。
- 接入 `eslint-plugin-vuejs-accessibility` 与 axe。
- Playwright 增加移动视口和键盘导航。

验收：

- 核心流程可仅用键盘完成。
- 核心页面 axe serious/critical 为零。
- 200% 缩放和窄屏下无关键内容丢失。

### NF-P2-10 Nginx 与请求边界

**状态：部分修复**

统一方案：

- Express 显式设置 JSON/URL Encoded Body Limit。
- Nginx `client_max_body_size` 与应用限制一致。
- 超限返回统一 413 JSON 和 Trace ID。
- 仅对带内容 Hash 的静态资源设置一年 `immutable`。
- `index.html` 使用 `no-cache`，固定名称资源采用短缓存或版本化名称。

## 6. 推荐实施波次

### Wave 0：决策冻结

1. File-as-Truth。
2. Durable Outbox 为业务事件主干。
3. SQLite 单实例边界。
4. Secret 主密钥来源。
5. 数据保留、RPO 和 RTO。

### Wave 1：安全止血

1. NF-P0-1 Admin 权限。
2. NF-P0-2 Projection 边界。
3. NF-P0-3 Secret 生命周期。
4. NF-P0-4 SSRF。
5. NF-P0-5 Prompt 写入口。

### Wave 2：发布安全

1. NF-P0-6 Migration 和备份。
2. NF-P0-7 根级 Check 和 CI。
3. NF-P0-8 配置错误、重试和文档一致性。
4. NF-P1-9 Readiness 和 Shutdown。

### Wave 3：运行时统一

1. NF-P1-4 Prompt Provenance。
2. NF-P1-5 Skill Executor。
3. NF-P1-6 Manifest/Registry。
4. NF-P1-7 Durable Event。
5. NF-P1-8 Outbox Reliability。
6. NF-P1-10 Trace/Span。

### Wave 4：接口、观测和测试

1. NF-P1-1/2/3 认证、JWT 和输入校验。
2. NF-P1-11/12 日志和 Metrics。
3. NF-P1-13 API/Axios。
4. NF-P1-14 自动化测试。

### Wave 5：长期治理

1. 数据保留与删除。
2. Provider 韧性和长任务异步化。
3. Cache、Worker 和 PostgreSQL。
4. 巨型模块和 TypeScript Strict。
5. 依赖、可访问性和 Nginx。

## 7. 第一批建议任务包

建议第一批控制为六个相互独立、可回滚的任务包：

1. **Admin/Projection 权限包**
   统一 Admin Boundary、Projection Deny-by-default 和权限测试。

2. **Prompt 发布治理包**
   关闭 DB/文件在线写入口，Admin 改为只读和 Patch/PR 输出。

3. **Secret/SSRF 安全包**
   先修明文响应、示例密钥、默认密码和 `safeFetch`；数据库加密迁移可单独后续提交。

4. **Migration/Readiness 包**
   移除生产 `db push`，增加 Migration Job、`/livez`、`/readyz` 和 Docker Healthcheck。

5. **质量门禁包**
   根级 `check`、后端 `noEmitOnError`、前端 `vue-tsc` 和最小 CI。

6. **确定性可靠性修复包**
   修复登录锁定单位、AI Retry、配置变量和文档冲突。

第一批完成后，再进入 Event、Skill、Trace 和 API 的大范围统一。

## 8. 发布验收清单

候选版本至少满足：

- [ ] 普通 JWT 和所有 Projection Token 无法访问 Admin API。
- [ ] 外部 URL 统一经过 SSRF Policy。
- [ ] API、日志、数据库 Dump 不包含明文 Secret。
- [ ] 正式 Prompt 只有一个发布入口和一个 Drift 定义。
- [ ] 生产启动不执行 `db push` 或任何破坏性 DDL。
- [ ] 根目录 `npm run check` 和 CI 全部通过。
- [ ] TypeScript 错误能阻止前后端构建。
- [ ] `/readyz` 能反映双数据库和初始化状态。
- [ ] SIGTERM 后立即停止接流，并在 Deadline 内退出。
- [ ] AI 503 重试和登录锁定时长测试通过。
- [ ] Outbox 重启恢复和幂等测试通过。
- [ ] 生产日志经过脱敏且可由容器平台采集。
- [ ] 关键 HTTP、AI、Worker 和 Outbox 指标可监控。
- [ ] Playwright 可自动启动服务，关键失败会使测试失败。
- [ ] 核心页面可键盘操作且 axe serious/critical 为零。

## 9. 状态表

| ID | 状态 | Owner | 目标波次 | 备注 |
| --- | --- | --- | --- | --- |
| NF-P0-1 | 第一阶段完成 | 待定 | Wave 1 | 已统一边界；待全路由矩阵测试和账户禁用状态 |
| NF-P0-2 | 边界第一阶段完成 | 待定 | Wave 1 | 敏感路由已拒绝；待 Token 隔离和撤销 |
| NF-P0-3 | 加密和扫描门禁完成 | 待定 | Wave 1 | 待 Provider 轮换和真实 ACL 修复 |
| NF-P0-4 | 第一阶段完成 | 待定 | Wave 1 | 可配置外部请求已统一；待私有 Host Allowlist |
| NF-P0-5 | 第一阶段完成 | 待定 | Wave 1 | File-as-Truth 已落地；待清理不可达旧代码和部署同步审计 |
| NF-P0-6 | 基线完成 | 待定 | Wave 2 | 双库 Migration、clean replay 和正式备份已完成；待长期库旁路重建演练 |
| NF-P0-7 | Required Baseline 完成 | 待定 | Wave 2 | 根级 Check/CI 已完成；待 lint、全量 vue-tsc 和 Playwright |
| NF-P0-8 | 部分完成 | 待定 | Wave 2 | 登录锁定和 AI Retry 已修复；待配置 Schema |
| NF-P1-1 | 未开始 | 待定 | Wave 4 | 重复认证 |
| NF-P1-2 | 未开始 | 待定 | Wave 4 | JWT 生命周期 |
| NF-P1-3 | 未开始 | 待定 | Wave 4 | Zod 全覆盖 |
| NF-P1-4 | 未开始 | 待定 | Wave 3 | Prompt Provenance |
| NF-P1-5 | 未开始 | 待定 | Wave 3 | Skill Executor |
| NF-P1-6 | 未开始 | 待定 | Wave 3 | Manifest/Registry |
| NF-P1-7 | 未开始 | 待定 | Wave 3 | Event 主干 |
| NF-P1-8 | 未开始 | 待定 | Wave 3 | Outbox Reliability |
| NF-P1-9 | 第一阶段完成 | 待定 | Wave 2 | Readiness、Drain、Deadline、EventBus 和关键后台任务跟踪已完成；待低优先级异步工作 |
| NF-P1-10 | 未开始 | 待定 | Wave 3 | Trace/Span |
| NF-P1-11 | 第一阶段完成 | 待定 | Wave 4 | 已统一脱敏、stdout 和持久化目录；待轮转保留策略 |
| NF-P1-12 | 未开始 | 待定 | Wave 4 | Metrics/Alert |
| NF-P1-13 | 未开始 | 待定 | Wave 4 | API/Axios |
| NF-P1-14 | 未开始 | 待定 | Wave 4 | 自动化测试 |
| NF-P2-1 | 待决策 | 待定 | Wave 5 | 数据保留 |
| NF-P2-2 | 未开始 | 待定 | Wave 5 | Circuit Breaker |
| NF-P2-3 | 未开始 | 待定 | Wave 5 | 长任务异步化 |
| NF-P2-4 | 未开始 | 待定 | Wave 5 | Cache |
| NF-P2-5 | 待决策 | 待定 | Wave 5 | PostgreSQL/Worker |
| NF-P2-6 | 未开始 | 待定 | Wave 5 | 巨型模块 |
| NF-P2-7 | 未开始 | 待定 | Wave 5 | TypeScript Strict |
| NF-P2-8 | 未开始 | 待定 | Wave 5 | 依赖治理 |
| NF-P2-9 | 未开始 | 待定 | Wave 5 | 可访问性 |
| NF-P2-10 | 未开始 | 待定 | Wave 5 | 请求和缓存边界 |
