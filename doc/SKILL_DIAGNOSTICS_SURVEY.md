# Skill 注册/接线错误诊断面全景调查

> 只读审计（2026-08-10）。前置：`doc/SKILL_LIFECYCLE_SURVEY.md`（注册链全景）。本篇回答：**"一个新增/配置错误的 skill，管理员能在哪里看到问题？"** 产出错误类型 × 可见性矩阵、现有诊断工具清单、诊断盲区清单、设计建议。所有证据精确到 `file:line`。

---

## 1. 错误类型 × 可见性矩阵

| 错误类型 | 启动 | readiness | admin 面板 | 调用时 | 完全不可见点 |
|---|---|---|---|---|---|
| **core.yaml 缺失 / schema 错** | 仅 `console.warn`「跳过漂移 v4 prompt」`backend/src/scripts/seed-core-agent-prompts.ts:273`，不阻断；旧 ACTIVE 继续生效 | 无信号（corePrompts 只查 5 个 ACTIVE id，`services/readiness.service.ts:33-39,113`） | 有：编译预览 `GET /prompt-ops/:agentId/compile-info` 返回 error/status（`routes/admin/prompt-ops.ts:1516-1539`）；SkillDesignPage 展示 `coreDiagnostics`（`frontend/src/views/admin-redesign/SkillDesignPage.vue:1557,1624`）；CLI `prompts:lint` 报 `core-file-missing`（`scripts/lint-prompts.ts:33-46`） | 无（用旧 ACTIVE 静默运行） | 无人打开具体 skill 设计页就看不到 |
| **无 ACTIVE prompt（声明类）** | 静默。`validateManifest` 不查 prompt 存在性（`services/agent-manifest.service.ts:498-534`，只查 defaultModelConfig/noPromptFile）；prompt sync 只 seed **存在的文件**（`seed-core-agent-prompts.ts:395,512`）→ manifest 有、文件无 → 无 ACTIVE，全程无日志 | 无信号（新 skill 不在 5 个 `CRITICAL_PROMPT_IDS` 内，`readiness.service.ts:33-39`） | **部分**：`agent-overview` 的 agent 列表 = files ∪ dbActives 并集 → 无文件无 DB 的 skill **根本不出现**（`prompt-ops.ts:148-151`）；`skill-catalog` 显 `hasPrompt:false`（`prompt-ops.ts:1799-1821`）；`runtime-definitions/agents` 显 `activePrompt:null`（`runtime-definitions.ts:97`）；`compile-info` 404「未找到 agentId=xxx 的 ACTIVE prompt」（`prompt-ops.ts:1505-1510`） | `Missing active prompt for <agentId>`，code=`*_PROMPT_MISSING`（`composers/prompt-composer.ts:229-258`）→ prompt_call_logs 记失败，exec-logs 可见 | 无文件+无 DB 的 skill 在 agent-overview 缺席 |
| **manifest 无条目** | 静默。注册以代码列表为准：`registerOfficialAgents`（`agents/index.ts:103-115`）+ allSkillDefinitions 遍历（`index.ts:481-486`）；DB 残留会被无 handler 重载（`skill-registry.ts:224-267`、`agent-registry.ts:266-313`） | 无信号（gatewayRegistry 只查 `count()>0`，`readiness.service.ts:119`） | 有但**无 UI 消费**：`GET /admin/manifest/diagnostics` 的 `missingRegistrations/unknownRegistrations/catalogOnly/unknownLogAgents`（`routes/admin/platform.ts:278-316`）；workbench-meta 404「不在 manifest 中」（`routes/admin/skills.ts:434-439`）；`GET /admin/skills` 仍列出 gateway 注册残留（`skills.ts:110-147`） | 视 handler 而定：无 handler → `Skill handler not found`（`skills/index.ts:221-223`）；有 handler 但未注册 manifest 的 skill 无 agent 归属（`getAgentOfSkill` undefined） | manifest/diagnostics 端点是死端（前端/文档零引用） |
| **handler 缺失（skills/index.ts 无定义）** | **完全静默**：`if (handler) { await instance.registerSkill(...) }`，无 else 无日志（`index.ts:481-486`） | 无信号 | 无「无 handler」指示：`GET /admin/skills` 不暴露 handler 存在性（`skills.ts:118-135`）；DB 残留可列出（无 handler 重载，`skill-registry.ts:253-258`）；`POST /:name/test` → 500「Skill has no handler」（`skills.ts:201` + `gateway/index.ts:131-133`） | `Skill handler not found: <id>`（`skills/index.ts:221-223`）；gateway 路径「Skill has no handler」（`gateway/index.ts:131-133`） | 启动日志、readiness、目录页全无信号 |
| **未注册 gateway（agent_registrations）** | 启动自愈：首次 `registerAgent` 前 `deleteMany()` 全清（`agent-registry.ts:81-84`），再按代码重注册——未注册者被 purge，**无日志**；skill_registrations 无清库循环（仅 `RETIRED_SKILLS` 显式 purge，`index.ts:497-516`） | 无信号（count>0 粒度） | 有但无 UI：manifest/diagnostics `missingRegistrations`（`platform.ts:278-280`）；`GET /admin/skills` 会列出 skill_registrations 残留（含无 handler 的，无标注） | 残留无 handler → 500 | purge 是「静默擦除」，诊断只能靠反向比对（还无人做） |
| **接线缺失（coordinator steps / 业务调用点未含）** | 静默 | 静默 | **无任何专项检查**；唯一间接症状：拓扑 `idleCount`（`platform.ts:987`，「0 调用」≠「没接线」）、exec-logs 无该 skill 记录 | 不报错，skill 永远不被调用 | **完全无声**——最安静的失败 |

补充：**启动金丝雀** `aiCapabilityHealthService.refresh()`（`index.ts:607-611`，`STARTUP_CANARY=0` 可关）只探测 5 个**硬编码** LLM 能力的路由连通性（`ai-capability-health.service.ts:27-33`），与 skill 注册/接线无关。

---

## 2. 现有诊断工具盘点

### 2.1 后端校验/探测

| 端点/服务 | 检查项 | 覆盖面 | 关键缺口 |
|---|---|---|---|
| `validateManifest()` 启动 fail-fast（`services/agent-manifest.service.ts:498-534`，调用于 `index.ts:463-470`，报错即 `throw new Error('Agent manifest 校验失败')`） | kind=agent 无 defaultModelConfig/有 agentMembers/成员可解析；kind=skill 前缀 `skill:`、有 defaultModelConfig 或 noPromptFile；alias 与 canonical 冲突 | manifest 内部自洽 | **不查** prompt 文件/ACTIVE 存在性、handler 存在性、接线 |
| readiness `/readyz`（`services/readiness.service.ts`，挂载 `index.ts:293`） | `corePrompts`：仅 5 个 `CRITICAL_PROMPT_IDS` 有 ACTIVE（L33-39,113）；`fieldRouting`：contract/field/routing 三表数量对齐 seed（L115-118）；`aiConfiguration`：apiUrl/key/model 有效（L151-172）；`gatewayRegistry`：agent/skill 注册数 >0（L119）；另启动时异步 warn 字段路由漂移（L124,130-149） | 核心链路五要素 | corePrompts 硬编码 5 id；新 skill 无覆盖；不查 skill_registrations 与 manifest 对账 |
| `GET /admin/manifest/diagnostics`（`routes/admin/platform.ts:217-354`） | `missingRegistrations`（manifest 有、agent_registrations 无，L278-280）、`unknownRegistrations`/`aliasRegistrations`（L282-289）、`unknownModelConfigs`/`aliasModelConfigs`（L291-298）、`unknownLogAgents`/`aliasLogAgents`（L300-314）、`catalogOnly`（L316）、`driftCount` 汇总（L328-334）、outputContracts 汇总（L335-337） | agent_registrations + agent_model_configs + agent_call_logs + agent-catalog.json | **不查 skill_registrations**；**前端零消费者**（frontend/src 无任何引用，docs 亦无） |
| `GET /admin/runtime-definitions/consistency`（`routes/admin/runtime-definitions.ts:206-250`） | 复跑 validateManifest（L207,240-241）；编排 steps 的 agentId 可解析性 `missing`/`aliasResolved`（L209-232）；manifestSkills vs registeredSkills 计数（L234-236,243-247） | **steps → manifest 方向**（步骤引用的成员必须存在） | **不查反向**（manifest 的 skill 是否被 steps 引用 = 接线）；counts 只给数量不给明细 |
| `GET /admin/runtime-definitions/agents`（`runtime-definitions.ts:68-115`） | manifest skill 条目 + `activePrompt`（可能 null）+ 是否在 `SKILL_RUNTIME_DEFINITIONS`（skillDefMap，L27,95-112） | manifest 为源 | def 缺失只表现为字段 null，无「缺运行时定义」显式标记 |
| `GET /admin/prompt-ops/agent-overview`（`prompt-ops.ts:109-285`） | 每 agent：file/db 双源、hash drift（L171-174）、health good/warn/risk（L183-186）、schemaLint（L237-258）；summary 聚合（L263-275） | prompt 文件↔DB 一致性 | **列表 = files ∪ dbActives**（L148-151）→ 「无文件无 DB」的 manifest skill 缺席，健康度无从谈起 |
| `GET /admin/prompt-ops/skill-catalog`（`prompt-ops.ts:1759-1856`） | manifest 树（listTopLevelAgents + listSkillsOfAgent）+ `hasPrompt`/promptVersion + 字段抽取（L1786-1833） | 字段选择器输入 | 以 manifest 为源 → manifest 缺失的 skill 缺席；无注册/接线维度 |
| `GET /admin/prompt-ops/:agentId/compile-info` + `POST /:agentId/recompile`（`prompt-ops.ts:1489-1618`） | 无 ACTIVE → 404（L1505-1510）；编译 status/error/warnings/rewritten（L1516-1539） | 单 skill 编译预览 | 需逐个打开；不聚合 |
| `AICapabilityHealthService`（`services/ai-capability-health.service.ts`） | 5 个硬编码能力（L27-33）的 LLM 路由连通性探测（resolveRoute L214-218 + OK 探测 L242-258，10s 超时），状态机/streak（L289-338），写回 `platform_api_configs.connectionStatus`（L270-284）→ ApiConfig.vue 显示（`frontend/src/views/admin-redesign/ApiConfig.vue:390-523`） | **只测 LLM 可用性**，非 skill 健康 | 能力清单硬编码，新增 skill 不进探测；不测 prompt/handler/接线 |
| CLI `prompts:lint`（`scripts/lint-prompts.ts`，`npm run prompts:check`） | v4 五块结构、core 文件存在性（`core-file-missing` L33-40）、core schema 诊断（L41-46）、字段冻结、v2 八块校验、core.yaml 独立区（L112+） | 文件层声明校验 | CI 前置，非运行时/面板 |

### 2.2 前端面板（admin-redesign）

| 面板 | 数据源 | 展示 |
|---|---|---|
| Orchestrator.vue「定义 tab」（L159-166 tabs） | `getOrchestratorDefinitions`（L179）+ compileOrchestrator 的 `unresolved` 标记（`runtime-definitions.ts:33-50`） | 定义步骤 + 未解析节点 → warn 状态条（L371）；点 skill 节点开 SkillDrawer（L118） |
| SkillDrawer.vue | workbench-meta（`adminApi.ts:478-483`）+ effective-prompt + test + protocol-view | 未找到时「它可能未注册或 ID 有误」（L320-323）；成功率色阶（L391-397）；无「无 handler」标注 |
| SkillDesignPage.vue | compile-info/recompile（L1557,1624） | coreDiagnostics / COMPILE_FAILED 展示 |
| Skills.vue 目录 | `GET /admin/skills`（gateway 注册表，`skills.ts:110-147`） | health = error（有失败）/idle（0 调用）/ok（L183）；agent 归属 tag（L75） |
| Topology.vue | `GET /admin/topology`（`platform.ts:879-1002`，manifest 为源） | 节点/边 + `idleCount`/`unhealthyCount` summary（L982-989） |
| DriftAuditPanel.vue | `adminFieldRoutingsApi.getDrift`（L50,67） | 字段路由漂移（与 skill 注册无关） |

---

## 3. 诊断盲区清单与缺口判定

### 3.1 三个核心问题

1. **新增 skill 忘了接线（manifest/注册齐全、coordinator 没调）→ 否，完全不可发现。**
   一致性检查只有 steps→manifest 方向（`runtime-definitions.ts:209-232`）；没有任何「manifest skill 未被任何步骤/调用点引用」的反向检查。唯一症状是 0 调用（拓扑 `idleCount`，`platform.ts:987`；Skills.vue idle 态），管理员无法区分「没接线」与「没人用」。

2. **忘了注册 manifest（代码/注册齐全、manifest 无条目）→ 否（半可见）。**
   启动静默；所有以 manifest 为源的面板（topology、skill-catalog、runtime-definitions/agents、workbench-meta）缺席；`GET /admin/skills` 仍列 gateway 残留（无「孤儿」标记）；唯一能抓到的是 `manifest/diagnostics` 的 unknownRegistrations/catalogOnly/unknownLogAgents（`platform.ts:282-316`）——**但该端点前端零消费，是死端**。

3. **忘了写 handler（manifest 有、skills/index.ts 无）→ 否（半可见）。**
   启动静默跳过且无日志（`index.ts:481-486`）；readiness 无信号；目录页不暴露 handler 存在性；调用时才抛 `Skill handler not found`（`skills/index.ts:221-223`）→ 若业务链没人调它，错误永不触发（与「没接线」叠加 = 双盲）。

### 3.2 诊断盲区清单（全部场景）

1. **handler 缺失**：启动/readiness/面板三处无声（`index.ts:481-486` silent skip 是最大盲区）。
2. **接线缺失**：无任何检查维度（含调用点静态分析）。
3. **manifest 有、prompt 文件无**：agent-overview 缺席（并集构造 `prompt-ops.ts:148-151`）；readiness 5-id 硬编码不覆盖。
4. **manifest/diagnostics 无 UI**：最强诊断端点（missing/unknown/alias/catalogOnly）没有前端消费者，管理员不可达。
5. **skill_registrations 不在 manifest diagnostics 范围**（`platform.ts:240-269` 只查 agent_registrations）：skill 残留注册（含无 handler 幽灵行，`skill-registry.ts:253-258` 重载）无对账出口。
6. **agent_registrations 启动全清**（`agent-registry.ts:81-84`）：未注册即被静默抹除，无事前日志，只能靠事后反向比对（同盲区 4）。
7. **core.yaml 缺失/schema 错**：运行时仅 console.warn（`seed-core-agent-prompts.ts:273`），readiness 无项，admin 需逐个打开 design 页才可见。
8. **双定义表漂移**：`allSkillDefinitions`（`skills/index.ts:102-176`）与 `SKILL_RUNTIME_DEFINITIONS`（`coordinators/definitions-registry.ts:32-47`）是两个独立手写列表，无互相校验（consistency 只给 counts）。
9. **ai-capability 探测清单硬编码**（`ai-capability-health.service.ts:27-33`）：新增 skill 永不进探活；且探活只测 LLM 路由，不测「skill 管线完整性」。
10. **运行时静默跳过漂移 v4 prompt**（`seed-core-agent-prompts.ts:271-276`）：core 未 publish 时 ACTIVE 停更，只能靠 agent-overview 的 file-vs-db-mismatch（warn 级）间接发现。

---

## 4. 设计建议：skills.yaml 户口簿「完成度校验」

原则：**声明完整性 fail-fast（与现有 validateManifest 同档）→ 系统完整性 readiness warn（新 skill 不阻断老链路）→ 明细在 admin 面板按 skill 展示**。

| 检查项 | 级别 | 位置（建议） |
|---|---|---|
| manifest 条目存在（allSkillDefinitions 每个 name ↔ manifest `skill:` 条目双向对账） | fail-fast | `validateManifest`（`agent-manifest.service.ts:498-534`）扩一项；错误文案 `[manifest] Skill "x" 在代码定义但无 manifest 条目` |
| handler 存在（allSkillDefinitions 每个 name ∈ skillHandlers 键） | **fail-fast**（替代 `index.ts:481-486` 静默跳过；这是当前最大盲区） | `initializeGateway` 内、`index.ts:463` manifestCheck 之后；或并入 validateManifest 返回值 |
| prompt 文件存在（noPromptFile=false 的 manifest skill 必须存在 `prompts/<id>.md`） | fail-fast | validateManifest 扩展（需读文件系统，放 `index.ts:463` 附近单列函数） |
| core.yaml 存在且 schema 合法（对 coreHash 声明者） | fail-fast | 同上；或沿用 CLI lint 逻辑（`lint-prompts.ts:25-51`）提升到启动 |
| coordinator steps 引用的 agentId 可解析 | fail-fast | 复用 `runtime-definitions.ts:209-232` 逻辑，启动即跑（目前只在 admin 端点） |
| 每个 manifest skill 的 ACTIVE prompt 存在（noPromptFile 豁免） | **readiness warn**（不 fail-fast，避免新 skill 拖垮老链路） | `readiness.service.ts`：把 `CRITICAL_PROMPT_IDS`（L33-39）替换为「manifest 全部 skill」动态集，降级为 warn 通道；corePrompts 保留 5 id 的硬闸门 |
| 注册对账：skill_registrations/agent_registrations ↔ manifest 双向 diff | readiness warn | `readiness.service.ts` 新 check（照抄 `detectFieldRoutingDriftWarnings` 模式 L124,130-149）；同时把 skill_registrations 纳入 `manifest/diagnostics`（`platform.ts:240-269`） |
| 接线覆盖率：manifest skill 是否被 ≥1 处引用（coordinator steps ∪ `executeSkill(` 静态扫描 ∪ 白名单） | readiness warn | 新服务（静态扫描脚本可在 `scripts/` 实现后由 readiness 调用，或启动期编译一次缓存） |
| 户口簿行内完成度分项（manifest/prompt ACTIVE/handler/gateway 注册/core 编译/接线引用数/最近调用） | admin 面板 | 扩 `GET /admin/skills/:skillId/workbench-meta`（`skills.ts:426-563`）加 handler/注册/接线字段；目录页 Skills.vue 加「完成度」列；SkillDrawer 加「未接线/无 handler」红标 |
| 聚合健康视图（缺注册/缺 handler/未接线/无 ACTIVE 分桶） | admin 面板 | 把 `manifest/diagnostics` 结果接前端（现有端点补 skill_registrations 维度即可），或新增 `GET /admin/skills/health` 聚合端点 |
| 新 skill 探活 | admin/可选 | `ai-capability-health.service.ts:27-33` 的 CAPABILITIES 改为从 manifest 派生（kind=skill 且非 noPromptFile），避免硬编码失配 |

关键取舍说明：
- **fail-fast 只覆盖「声明完整性」**（manifest/handler/prompt 文件/core.yaml/步骤可解析），这些是纯静态、零误报的项；任何「运行时才可知」的项（接线是否真的被业务调用）一律 readiness warn + 面板展示，避免上线即挂。
- **「接线覆盖率」的静态扫描会有白名单噪音**（aux skills、MCP 工具、旁路直调如 `semantic-freeze-judge`），建议白名单放户口簿声明（如 `wiredBy: manual|service|aux`），未标注且 0 引用才报 warn。
- 与既有工具的关系：不新建「第 N 套注册表」，而是给户口簿做**完成度校验器**，复用 manifest/definitions-registry 双列表 + 上述 fail-fast 检查，输出一份可写入 admin 面板的结构化报告。
