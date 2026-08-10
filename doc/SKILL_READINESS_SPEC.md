# Skill 完成度状态机与 Readiness 校验实施规格

> 版本：2026-08-10 · 产出方：架构设计（只读调查，未改任何代码）
> 前置：`doc/SKILL_DIAGNOSTICS_SURVEY.md`（诊断面全景）、`doc/SCAFFOLD_P5_SURVEY.md`（P5 证据）、`doc/SKILLS_YAML_SPEC.md`（§4 向导规格）、`doc/SKILL_EXPANSION_DESIGN.md`（§4.3/§6）、`doc/YAML_UNIFICATION_AUDIT.md`（§3.1 字段一致性）
> 定位：P5 scaffold 的前置依赖实施规格。本文只定义判定逻辑、数据源、实现位置与验收红线；不包含具体代码。

---

## 0. 总体架构

三条独立轨道，互不阻塞：

```
轨道 A：完成度状态机（派生投影，不落库）
  skill-completion.service.ts（纯函数，依赖注入）
    ├── workbench-meta 扩展（skills.ts:426）—— 单 skill 展示
    ├── scaffold 响应复用（P5）
    └── check-core-fields-sync.ts（fields-synced 判定，脚本与状态机共用）

轨道 B：W1-W5 readiness 校验（warn 级，不阻断启动/ready）
  skill-readiness-checks.ts（纯函数 + DB/fs 适配）
    ├── readiness.service.ts 启动异步 warn（60s 缓存，对齐 detectFieldRoutingDriftWarnings 模式）
    └── GET /api/admin/skills/readiness（按需重算，前端聚合视图）

轨道 C：manifest diagnostics 补维度 + 前端接线
  platform.ts:217 /manifest/diagnostics 增加 skill_registrations 检查项
  → Skills.vue 对账面板（唯一前端消费者）
```

**分层铁律**（沿用 SKILL_DIAGNOSTICS_SURVEY §4 关键取舍）：
- 声明完整性（F1~F12）继续 fail-fast，本文不动；**任何运行时才可知的项一律 warn**。
- 状态是文件系统/DB 状态的**投影**：每档条件独立判定，取最大连续满足前缀；条件回退即状态回退，不落库（SKILLS_YAML_SPEC §4.4 已定，本文细化判定源）。
- 新 skill 缺项不拖垮老链路：readiness 的 ready 布尔语义保持 6 项不变，W1-W5 只进 warn 通道与 admin 面板。

---

## 1. 完成度状态机细化

### 1.1 状态判定表（每档 = 该档及以下全部条件满足）

| 状态 | 判定条件（全部满足） | 判定数据源（精确） | 实现位置 |
|---|---|---|---|
| **draft** | skills.yaml 活跃集含该 skillId | `loadSkillsBookRaw()`（skills-file.ts:536-547；解析 F1/F2/F3-enum/F7/F8/F9，**不跑** fs 与交叉校验，draft 中间态不会抛全书） | skill-completion.service.ts |
| **handler-ready** | (a) handlerRef 文件存在（F5）；(b) 注册存在（F11 分派逻辑只读化） | (a) `validateFileExistence` 同款 fs 检查（skills-file.ts:463-484，handlerRef 从 `REPO_ROOT` 解析 :32）；(b) `resolveRegistrationPoint(entry)`（skills-file.ts:569-571）分派：`skillHandlers`/`allSkillDefinitions` 键集（skills/index.ts:102-198）或 `agentHandlers` 的 `skill:<id>` 键（agents/index.ts:79-81）；`platform-direct`/`none` 豁免（check-skills-file.ts:59-67 同款逻辑） | 同上 |
| **core-ready** | (a) coreFile 文件存在（F6）；(b) `validateCoreFileShape` 通过；(c) fields ≥ 1；(d) identity/rules/fields 无 scaffold TODO 占位标记 | (a) F6 同款检查（skills-file.ts:469-482）；(b) `loadCoreFile(skillId)`（core-file-loader.ts:476-498）+ `validateCoreFileShape`（core-file-loader.ts:178）；(c)/(d) core fields 的 name/desc 文本扫描 TODO 标记（scaffold 骨架占位约定，SCAFFOLD_P5_SURVEY §5.2） | 同上 |
| **fields-synced** | mainline：(a) stage contracts 含 `skill:<id>`；(b) check-core-fields-sync 无「缺项」（孤儿/类型 warn 不阻断）；aux/handler-only 豁免（不进字段路由） | (a) `loadOrchestrationFiles()` contracts（orchestration-file.ts:235-250；F3 铁律逻辑 skills-file.ts:416-432 只读化——注意 `loadSkillsBookRaw` 不跑 F3，需显式查）；(b) §2 check-core-fields-sync 规则 | check-core-fields-sync.ts（纯函数导出，状态机与门禁复用） |
| **live** | (a) `agent_prompts` 有 ACTIVE 行（`agentId='skill:<id>'`，noPromptFile=true 豁免）；(b) skills:check（F1~F12+P1）全绿 | (a) `systemPrisma.agent_prompts.findMany({where:{agentId, status:'ACTIVE'}})`（同 workbench-meta 查询 skills.ts:457-473，判定 :480）；noPromptFile 豁免字段（skills-file.ts:69-70）；(b) check-skills-file.ts 全量（脚本侧，仅 CLI/CI 权威；状态机做轻量等价：F5+F6+注册存在性已由前置档覆盖，补 P1 派生等价可跳过——**live 档只要求 ACTIVE 存在 + 前置档全绿**，skills:check 全绿作为 completion 展示项而非状态门槛，避免状态机与脚本重复执行） | skill-completion.service.ts |

**状态机语义**：
- `state` = 最大连续满足前缀（draft 恒满足）。例如 core.yaml 被删 → 直接回退到 handler-ready。
- 派生不落库：每次 workbench-meta / scaffold 响应时重算（SKILLS_YAML_SPEC §4.4）。
- aux 豁免链：fields-synced 档对 aux/handler-only 恒真（不进字段路由）；handler-only 的 core-ready/live(a) 恒真（无 coreFile / noPromptFile=true）。**注意 aux 不豁免 live**：runAux 走 `requireActivePrompt: true`（v4-aux-skills/index.ts:145-154），必须 ACTIVE。

### 1.2 实现位置与模块结构

新文件：`backend/src/services/skill-registry/skill-completion.ts`

```
computeCompletionState(input): CompletionReport        // 纯函数，零 IO（对标 analyzeCoreHashParity 模式，check-core-hash-parity.ts:84-175）
input = {
  entry: SkillEntry,                                   // book 条目
  handlerFileExists: boolean,                          // fs 注入
  registered: boolean,                                 // F11 键集注入
  core: { loaded: boolean, valid: boolean, fields: string[], hasTodo: boolean } | null,
  fieldsSync: FieldsSyncReport | null,                 // §2 纯函数输出（mainline 才注入）
  activePromptExists: boolean,                         // agent_prompts 注入
  checksGreen: boolean,                                // 脚本侧注入（仅 completion 展示）
}
```

调用方：
1. **workbench-meta**（skills.ts:426-570）：新增 `completion` 响应字段（§1.3）；**同时把 :434-439 的 404 分支降级**——不在 manifest 但户口簿有登记的 skill（scaffold 后、manifest 代码未合并前）返回 draft 态 completion（manifest 分项 false），否则才 404。这是「scaffold → 跳转 SkillDesignPage」链路的前置（P5 survey §6 的 router.push 依赖它）。
2. **scaffold 响应**（P5）：completion 复用同一纯函数，与 workbench-meta 口径一致。
3. **check-core-fields-sync.ts**（§2）：fields-synced 档复用其纯函数。

生产装配（`buildCompletionInput`）与纯函数分离，依赖注入点：book、core loader、orchestration loader、注册键集（`../skills` + `../agents`，check-skills-file.ts:32-34 已验证无循环问题）、systemPrisma 查询适配器。

### 1.3 workbench-meta 响应建议（completion 字段）

```jsonc
{
  "completion": {
    "state": "draft" | "handler-ready" | "core-ready" | "fields-synced" | "live",
    "items": [
      { "id": "manifest",      "label": "manifest 条目",       "ok": true },
      { "id": "handler",       "label": "handler 存在",        "ok": true,
        "hint": "创建 backend/src/skills/<id>/index.ts" },
      { "id": "registered",    "label": "注册存在",            "ok": true,
        "hint": "skills/index.ts 注册片段（两段）" },
      { "id": "core",          "label": "core.yaml 合法",      "ok": true,
        "hint": "SkillDesignPage 协议页签保存并校验" },
      { "id": "fieldsSynced",  "label": "字段路由回填",        "ok": true,
        "hint": "npm run prompts:fields-sync:check" },
      { "id": "promptActive",  "label": "ACTIVE prompt",       "ok": true,
        "hint": "npm run prompts:compile-all && prompts:sync" },
      { "id": "checksGreen",   "label": "skills:check 全绿",   "ok": true,
        "hint": "npm run prompts:skills:check" },
      { "id": "wired",         "label": "接线引用",            "ok": false,
        "hint": "coordinator steps 或业务调用点" },
      { "id": "recentCalls",   "label": "最近调用",            "ok": null }
    ],
    "warnings": [ "W3-wired 未接线（辅助展示，不进状态判定）" ]
  }
}
```

- `items[].ok` 与状态机逐档对应：state = 首个 ok=false 的档位之前的前缀（manifest/handler/registered → handler-ready 之前；core → core-ready；fieldsSynced → fields-synced；promptActive+checksGreen → live）。
- `wired`/`recentCalls` 是跨切面展示项（W3 结果 + stats.lastCalledAt），**不参与状态推进**。
- 前端：SkillDesignPage 状态条逐项打勾（SKILLS_YAML_SPEC:364 已定）；未完成项给跳转/命令提示。

---

## 2. fields-synced 判定设计（check-core-fields-sync.ts）

### 2.1 目标与定位

- 补 SKILL_EXPANSION_DESIGN:340「check-core-fields-sync 未实现」的缺：core.yaml 平铺字段 ↔ 编排文件嵌套 fieldId 的**首段前缀一致性**。
- 一个脚本两份消费：门禁（`prompts:check:all` 链，warn 起步不 fail）+ 状态机 fields-synced 档（缺项红、孤儿不阻断）。
- 文件：`backend/src/scripts/check-core-fields-sync.ts`；package.json 新增 `prompts:fields-sync:check`，并入 `prompts:check:all`（对齐 YAML_UNIFICATION_AUDIT:264 的 P2 计划）。

### 2.2 判定数据源

| 侧 | 数据源 |
|---|---|
| core 字段 | `loadCoreFile(skillId).fields[].name`（core-file-loader.ts:476-498；CoreFieldSpec :38-48，name 平铺小写下划线） |
| 编排字段 | `loadOrchestrationFiles()`（orchestration-file.ts:235-250）→ 该 skill stage 的 `routings` 中 **`agentId === 'skill:<id>'`** 的行（OrchestrationRouting :56-65）的 `fieldId` |
| stage 归属 | book 条目 `stage`（skills-file.ts:42，mainline 必填） |
| 参与范围 | **仅 mainline**；aux/handler-only 豁免（不进字段路由，skills.yaml:254 注释） |

### 2.3 比较规则（核心）

对 skill 的每条产出 routing 行（`agentId='skill:<id>'`）：

```
root = fieldId.split('.')[0]
if root ∈ coreFieldNames        → 命中（绿灯）
elif root ∈ EXEMPT_PLATFORM_ROOTS → 豁免（不检查）
else                            → 缺项 missing（warn / 门禁红 / 状态机红）
```

反向孤儿（warn，**不阻断** fields-synced 状态）：
```
coreField ∈ coreFieldNames 且未出现在任何产出 routing 行的 root → orphan
```

类型比对（可选增强，warn）：
```
仅当 fieldId 无点分且与 core name 精确相等时：
core type（去 '?' 后缀归一） vs 编排 valueType（typeSpellingNormalize，yaml-vocabulary）→ 不一致即 mismatch
（嵌套 fieldId 与 core object 子字段无一对一类型关系，跳过）
```

**EXEMPT_PLATFORM_ROOTS 初始清单**（平台/控制类字段，带证据；上线前用 `--report` 全量扫描复核，零误报后定稿）：

| 豁免 root | 证据 | 说明 |
|---|---|---|
| `userVisible` | goal.yaml:145 | 对话可见文本，执行信封注入，非 LLM 字段 |
| `core` | goal.yaml:161-176（core.conversationId/stage/confidence/isCompleted） | 平台状态机包装字段 |
| `goalConversation` | goal.yaml:150-155（nextQuestions/quickReplies 旧包装形态） | 历史包装类字段 |
| `debug` | simulation.yaml:54 | 调试旁路字段 |
| `control` | teaching.yaml:60-72（isCompletionCandidate/shouldTriggerPeer/checkpoint…） | 控制信号字段——**注意** teaching-turn core 有 `control`（teaching-turn.yaml:127），此条仅作兜底，如全量扫描确认已覆盖可移除 |

**边界说明**：`normalizedInput.*`/`previousMilestone`（path.yaml:15-83）、`snapshot.*`/`profile.*`（profile.yaml:41-65）等是编排层 agent（path-agent/profile-agent）的 routing 行或 sandbox 定帧字段，agentId 非 `skill:<id>`，**天然不在本检查范围**（只扫 skill 自己的产出行），豁免清单无需覆盖。

### 2.4 输出结构（纯函数 + CLI）

```jsonc
// 纯函数 analyzeFieldsSync({ stage, coreFieldNames, routingRows }) → 每 skill 一份
{
  "skillId": "goal-conversation",
  "stage": "goal",
  "state": "ok" | "missing" | "no-routings" | "no-core",
  "missing":   [{ "fieldId": "goalConversation.xxx", "root": "goalConversation", "detail": "编排字段首段不在 core fields，且不在豁免清单" }],
  "orphan":    [{ "coreField": "structuredData", "detail": "core 字段未出现在任何产出路由行首段" }],
  "typeMismatch": [{ "fieldId": "reply", "coreType": "string", "routingValueType": "string" }]
}
// CLI：--report（全量人审）/ --strict（任一 missing → exit 1）；缺项与孤儿分级输出
```

状态机取值：`fields-synced = (state === 'ok' 或 'no-routings' 豁免场景) 且 missing.length === 0`；orphan/typeMismatch 只进 warnings。

---

## 3. W1-W5 readiness 校验规格

### 3.1 公共设计

- 新文件：`backend/src/services/skill-registry/skill-readiness-checks.ts`，导出纯函数 `analyzeSkillReadiness(input)` + DB/fs 装配 `runSkillReadinessChecks(deps)`（对标 check-core-hash-parity 的 analyze/check 双层，check-core-hash-parity.ts:84-200）。
- 触发点：
  1. readiness.service.ts `check()` 尾部异步调用 + `logger.warn`（照抄 `detectFieldRoutingDriftWarnings` 模式，readiness.service.ts:124,130-149）；**带 60s 内存缓存**（防 /readyz 轮询反复 fs 扫描；W4 需 computeCoreHash，非零成本）。
  2. 新端点 `GET /api/admin/skills/readiness`（skills.ts 路由）：**总是重算**（按需正确性优先），返回完整报告。
- 级别：全部 warn；**不进 ReadinessResult.checks（:7-15），不改变 ready 语义**。
- 输出结构（两种消费同一份）：

```jsonc
{
  "generatedAt": "ISO",
  "summary": { "total": 3, "byCode": { "W1": 2, "W2": 1 } },
  "warnings": [
    { "code": "W1", "skillId": "foo", "message": "户口簿登记但无 ACTIVE prompt", "hint": "npm run prompts:sync" }
  ],
  "checks": {
    "W1": { "activeCount": 25, "missingActive": ["foo"], "zombieActive": [] },
    "W2": { "bookCount": 27, "missingRegistration": [], "zombieRegistration": [] },
    "W3": { "stepWithoutBook": [], "bookWithoutStep": ["bar"] },
    "W4": { "scanned": 25, "drifted": [] },
    "W5": { "status": "tbd", "note": "P4 未定，预留接口" }
  }
}
```

### 3.2 W1 —— ACTIVE 覆盖

| 项 | 规格 |
|---|---|
| 数据源 | book 活跃集（`getActiveSkillIds`，skills-file.ts:550-553）+ `agent_prompts` ACTIVE 行（schema.prisma:42-75，status 列 :62；查询同 skills.ts:457-473） |
| 方向 A | book 条目 `noPromptFile !== true` 且无 ACTIVE → `missingActive`（warn）。**aux 不豁免**（runAux requireActivePrompt:true，v4-aux-skills/index.ts:145-154；platform-direct 的 semantic-freeze-judge 走 callPrompt 同样需要） |
| 方向 B（僵尸） | `agent_prompts` ACTIVE 的 `agentId` 为 `skill:<x>` 且 x ∉ book 活跃集 → `zombieActive`（warn，hint：purgeRetiredSkills 或登记回户口簿；启动 purge 只清 PURGED 名单，index.ts:465-484，名单外残留是持久态） |
| 豁免 | 仅 `noPromptFile: true`（handler-only，skills-file.ts:69-70） |
| 实现 | skill-readiness-checks.ts 纯函数 + `agent_prompts` 适配器注入 |

### 3.3 W2 —— skill_registrations 对账

| 项 | 规格 |
|---|---|
| 数据源 | book 活跃集 vs `skill_registrations`（schema.prisma:149-162；**name 不带 `skill:` 前缀**，skill-registry.ts:196-217 以 `registration.name` 落库；findMany 同 platform.ts:241-249 模式） |
| 方向 A | book 有、注册表无 → `missingRegistration`（warn，hint：注册片段未落 skills/index.ts —— 启动注册静默跳过，index.ts:448-454） |
| 方向 B（残留） | 注册表有、book 无 → `zombieRegistration`（warn，hint：`loadFromDatabase` 会把无 handler 残留重载为注册，skill-registry.ts:224-267，幽灵行在 `/admin/skills` 可列出，需手工清理或进退役名单） |
| 实现 | 同上 |

### 3.4 W3 —— 接线覆盖率（双向）

| 项 | 规格 |
|---|---|
| 数据源 | book `coordinator` 块（skills.yaml:35-244 形态，SkillCoordinator skills-file.ts:56-59）+ `ORCHESTRATOR_RUNTIME_DEFINITIONS`（definitions-registry.ts:49-55 → goal.definition.ts:9、path.definition.ts:17,23、ai-teaching.definition.ts:16,23,30,45、learner.definition.ts:9,16、simulation.definition.ts:7-14） |
| 方向 A（steps 有户口无） | 协调器定义中 `kind='skill'` 或 `agentId` 前缀 `skill:` 的 step，其 skillId ∉ book 活跃集 → `stepWithoutBook`（warn；补 runtime-definitions.ts:209-232 只查 manifest 不查户口簿的洞） |
| 方向 B（户口有 steps 无） | book 条目 `coordinator.steps` 非空 且 `registrationPoint !== 'platform-direct'` 时，对应 `coordinator.agentId` 的 ORCHESTRATOR_RUNTIME_DEFINITIONS steps 无 `agentId === 'skill:<id>'` → `bookWithoutStep`（warn） |
| 豁免（方向 B） | `steps: []` 条目（adaptive-guidance-copy skills.yaml:119-121、virtual-learner-persona-designer :162-165、virtual-learner-scenario-designer :174-177——notes 注明 service 侧接线，**免检清单硬编码于脚本，含 notes 引用**）；`platform-direct`（semantic-freeze-judge :327-335）；无 coordinator 块的 aux/handler-only（service 直调，如 session-evaluation-fallback、skill-author、skill-compiler、mcp-tool） |
| 实现 | 纯函数输入（book + 协调器 steps 抽取器注入），零 IO；steps 抽取器从 definitions-registry 派生 |

### 3.5 W4 —— core 漂移（评估结论：复用 check-core-hash-parity）

| 项 | 规格 |
|---|---|
| 评估 | **复用** `analyzeCoreHashParity`/`checkCoreHashParity`（check-core-hash-parity.ts:84-200，已是依赖注入纯函数 + DB/fs 适配双层，scanPromptFiles + computeCoreHash 单一来源）。不独立实现。理由：同一漂移口径（文件 frontmatter coreHash vs DB ACTIVE 锚点 vs 核心文件哈希），双实现必分叉 |
| 过滤 | 只取 book 活跃集对应且声明 coreHash 的文件；status ∈ {drift, db-mismatch, core-file-missing, invalid-core-file} → warn。**`missing-active` 归 W1**（避免与 W1 重复报），`not-declared`（v2 文件）跳过 |
| 数据源 | prompts/*.md frontmatter + `loadCoreFile` + `agent_prompts`（check-core-hash-parity.ts:186-200 已有装配） |
| 缓存 | 60s（见 §3.1；computeCoreHash 为 25 文件级开销） |

### 3.6 W5 —— dataSource（P4 未定 → TBD 预留）

- 现状：`dataSource`/`mcpTools` 仅 schema 形状校验（skills-file.ts:75-78,299-309），零交叉校验；P4 结论未产出（SKILLS_YAML_SPEC:387 P4 行：扫描器出初稿 → 人工确认 → W5/F13 上线）。
- 预留接口：`analyzeSkillReadiness` 输出占位 `W5: { status: 'tbd', note }`；**不执行任何数据源存在性断言**，默认全绿不 warn。
- P4 落地后接续点（本文不展开）：`dataSource.db[]` ↔ main DB prisma model 名、`dataSource.api[]` ↔ backend 路由路径扫描，级别 warn + 白名单（与 W3 豁免同机制）。

### 3.7 readiness.service.ts 挂载点

- `check()` 内 `this.detectFieldRoutingDriftWarnings()`（:124）旁并列 `this.runSkillReadinessWarnings().catch(() => undefined)`；
- 缓存键：`lastSkillReadinessAt`（内存，60s TTL）；命中则跳过重算；
- 日志格式对齐 :133-143（`logger.warn('[readiness] 技能完成度诊断 N 项（W1..W5，不阻断就绪判定）', { items: ... })`）。

---

## 4. manifest diagnostics 补维度 + 前端接线

### 4.1 端点扩展（platform.ts:217-354）

新增检查项（对齐既有 drift 结构 :338-347）：

```jsonc
// GET /api/admin/manifest/diagnostics data 增补
"skillRegistrations": {
  "missingSkillRegistrations": ["foo"],   // manifest kind=skill（去 skill: 前缀）无注册行
  "unknownSkillRegistrations": ["ghost"], // 注册行 name 不在 manifest skill 集
  "aliasSkillRegistrations":   [{ "name": "teaching-turn-agent", "canonicalId": "skill:teaching-turn" }]
}
// summary 增补：skillRegistrationTotal + 计入 driftCount（:328-334 加一项）
```

- 数据源：`systemPrisma.skill_registrations.findMany({ select: { name: true, updatedAt: true } })`（schema.prisma:149-162）；manifest skill 集 = `canonicalManifestIds`（platform.ts:228-230）过滤 `skill:` 前缀。
- 对齐规则：注册 name（无前缀）↔ manifest id（`skill:x`）去前缀比对；别名行经 `getCanonicalAgentId` 归一判定（同 :287-289 模式）。

### 4.2 前端接线位置（三选一：**Skills.vue 目录页**）

理由：
1. **语义匹配**：manifest/diagnostics 是注册/上架对账（缺注册、残留、别名），Skills.vue 是 skill 生命周期目录（健康/调用/agent 归属，survey §2.2），是管理员找「skill 为什么不对」的默认落点；对账条目与该页既有 health 列并列自然。
2. **幽灵可见性**：Orchestrator「定义 tab」（Orchestrator.vue:159-165）只渲染有定义条目的 skill，对「manifest 无条目 / 注册残留」的幽灵无展示位；而 Skills.vue 数据源是 gateway 注册表（`GET /admin/skills`，skills.ts:110-147），残留行天然可见，差集标注是其自然扩展。
3. **下钻路径现成**：Skills.vue 行点击已开 SkillDrawer（Skills.vue:140 store 的 openSkillDrawer）→ 设计页；对账项挂行级标记即可下钻，无需新导航结构。workbench-meta 是单 skill 详情端点（且不在 manifest 的 skill 目前 404，skills.ts:434-439），**不适合承载聚合诊断**。

展示形态（Skills.vue 状态条 :3-27）：
- 状态条加「注册对账」徽标：`GET /api/admin/skills/readiness` + `GET /admin/manifest/diagnostics` 聚合 → warn 计数（缺注册/残留/未接线/无 ACTIVE 分桶）；
- 展开面板列出 warnings 明细（复用 §3.1 输出结构），每项跳 SkillDesignPage；
- 不新增「第 N 套注册表」：面板只消费既有端点，不落库。

---

## 5. scaffold → skill-author → skill-compiler → 发布一条龙衔接

| 步骤 | 输入 | 输出 | 写盘时机 | 完成度推进 |
|---|---|---|---|---|
| **1. scaffold**（P5，确定性） | §5.1 基础入参 + requiredFields?（SCAFFOLD_P5_SURVEY §5.1） | core.yaml 骨架 + skills.yaml 条目 + 编排 contracts 追加 + handler 占位 + 注册/coordinator 片段文本 + completion | 一次性落盘 3 处（core.yaml 存在即跳过 / skills.yaml append-only / contracts append-only）；handler 占位落盘（§5.3 修正结论，F5 防重启即挂）；注册片段与 coordinator 片段**仅返回文本** | **draft**（book 有条目即达；manifest 分项 false，completion 展示） |
| **2. skill-author draft**（可选，已有 API） | `requiredFields[]` + `authorNote?`（skill-author.ts:41-86） | system prompt 全文 + outputSchemaSummary | **不落盘**（skill-author/index.ts:42-67） | 不推进状态；草稿为 core 表单的**参考文本**（AI 草稿 ↔ core.yaml 是参考关系，SCAFFOLD_P5_SURVEY §1.2） |
| **3. admin 填 core**（SkillDesignPage 协议 tab） | 表单 identity/rules/fields/constraints（草稿为参考） | core.yaml 真实内容 | 保存并校验 → 落盘 prompts/core/<id>.yaml | 消除 TODO 占位 + schema 过 → **core-ready** |
| **4. skill-compiler 验收**（可选，已有 API） | `systemPrompt` + `requiredFieldIds[]`（dot path，skill-author.ts:96-130） | pass/fieldHits/missingFields/suggestions | 不落盘 | 不推进状态（质量门）；对编译产物反验 = live 的软前置 |
| **5. fields:sync 回填**（mainline） | core.yaml 字段（children 约定，SKILL_EXPANSION_DESIGN §4.3） | 编排文件 fields/routings 回填 | 生成器落盘（field-routing-orchestration-sync.ts:27-160 为 DB 侧对账；文件侧生成器按 P2 节奏） | check-core-fields-sync 无缺项 → **fields-synced** |
| **6. 编译 + 发布** | core.yaml → compile-core-files → publish | `agent_prompts` ACTIVE 行（schema.prisma:42-75） | compile 落盘 prompts/<id>.md（frontmatter coreHash）；publish 落 DB（seed-core-agent-prompts.ts:323,401,448,467,492） | ACTIVE 存在 + 前置档全绿 → **live** |
| **7. 注册与接线收尾**（人工粘贴） | scaffold 返回的注册片段 + coordinator steps 片段 | skills/index.ts 两段注册 + definition.ts steps + manifest 条目（代码） | 人工落盘（scaffold 不自动改写 TS，SKILLS_YAML_SPEC:210-215） | F11 注册存在 → handler-ready 前提；W3-B 接线 → wired 分项 true；manifest 条目 → manifest 分项 true |

**衔接要点**：
- 状态机在步骤 1 后即可被 workbench-meta 消费（需 §1.2 的 404 降级），步骤 3/5/6 每完成一步状态自动推进，无需任何「状态写入」动作。
- scaffold 与 skill-author 无依赖（P5 survey §4 分工：scaffold 保证注册面合法、skill-author 降 content 成本、skill-compiler 做质量门）；一条龙是「引导顺序」而非「强制管线」。
- 失败面收敛：占位 handler 不注册（启动静默跳过 index.ts:448-454），调用提前粘贴注册片段 → 占位函数抛 `SC_NOT_IMPLEMENTED`（skill 级失败，executor.ts:242-269 catch，不炸平台）。

---

## 6. 实施顺序与验收红线

每步独立提交、可 git revert；**每步验收不通过不进下一步**。

| 顺序 | 内容 | 验收红线 |
|---|---|---|
| **1. fields-sync 脚本** | check-core-fields-sync.ts（纯函数 + CLI --report/--strict + jest 单测）+ package.json 脚本 + 挂入 prompts:check:all（warn 级起步，不 fail） | (a) `--report` 对 5 个 stage 全量扫描：**缺项/孤儿明细人工复核后零误报**（对齐 SKILL_EXPANSION_DESIGN:351「goal 28 字段零误报」节奏；孤儿/类型 mismatch 若有存量先白名单化再定稿 EXEMPT_PLATFORM_ROOTS）；(b) 测试覆盖：嵌套首段命中/豁免/缺项/孤儿/类型 mismatch 五类用例 |
| **2. W1-W5** | skill-readiness-checks.ts + readiness 异步 warn（60s 缓存）+ `GET /api/admin/skills/readiness` | (a) 存量 27 条：启动日志 **W1-W5 零新增 warn**（W3-B 豁免清单覆盖全部 steps:[]/无 coordinator 条目；W4 过滤 missing-active 后零报）；(b) 端点返回完整结构（§3.1 JSON）；(c) /readyz 6 项语义与响应不变 |
| **3. 完成度状态机** | skill-completion.ts 纯函数 + workbench-meta completion 字段 + 404 降级 + scaffold 复用 | (a) 存量 27 条 completion.state 全为 **live**（handler-only 4 条按豁免链正确到 live）；(b) 手工构造 draft 样本（临时 book 条目 + 缺 handler）状态推进/回退正确；(c) 不在 manifest 的 book 条目返回 draft 态而非 404 |
| **4. diagnostics 前端** | platform.ts skill_registrations 维度 + Skills.vue 对账徽标/面板 | (a) 端点新增字段与 summary 计数正确（存量基线：缺失/残留/别名三项全 0 或与人工盘点一致）；(b) 面板渲染零漂移基线；Skills.vue 无新报错 |
| **5. 一条龙** | scaffold 端点 + skill-author 前端首次接入（adminApi.ts 新封装）+ 完成度联动 | P5 §5.2 验收红线：向导新建一个测试 aux skill 全流程走通（scaffold → draft 态可见 → 填 core → core-ready → 编译发布 → live），skills:check 全绿 |

**风险与回滚**：每步一个提交；scaffold 写盘幂等 + append-only（SKILLS_YAML_SPEC §5.3）；W1-W5 全 warn 无 fail 路径；check-core-fields-sync 若误报只影响 warn 与状态展示，不影响启动与运行时。

---

## 附：关键证据索引

| 证据 | 位置 |
|---|---|
| 户口簿加载（light，draft 判定源） | backend/src/services/skill-registry/skills-file.ts:536-547 |
| F5 handlerRef 存在性 | skills-file.ts:463-484 |
| F6 coreFile 存在性 | skills-file.ts:469-482 |
| F3 mainline contracts 铁律 | skills-file.ts:416-432 |
| F11 分派 + 注册键集 | check-skills-file.ts:51-82；skills/index.ts:102-198；agents/index.ts:79-81 |
| core schema 校验器 / 加载器 | core-file-loader.ts:178（validateCoreFileShape）、:476-498（loadCoreFile） |
| 编排文件加载器（contracts/fields/routings） | orchestration-file.ts:235-250、:36-74 |
| ACTIVE 判定（workbench-meta 同款查询） | routes/admin/skills.ts:457-480 |
| workbench-meta 扩展点 + 404 现状 | routes/admin/skills.ts:426-570、:434-439 |
| 启动注册静默跳过 / 户口簿校验 | index.ts:448-454、:431-440 |
| skill_registrations 落库与残留重载 | gateway/registries/skill-registry.ts:196-217、:224-267 |
| 协调器 steps 运行时定义 | coordinators/definitions-registry.ts:49-55；ai-teaching.definition.ts:6-58；goal.definition.ts:9；path.definition.ts:17,23；learner.definition.ts:9,16；simulation.definition.ts:7-14 |
| core 漂移对账（W4 复用源） | scripts/check-core-hash-parity.ts:84-200 |
| readiness 现状（6 项 + warn 模式） | services/readiness.service.ts:33-39、:124、:130-149 |
| manifest diagnostics 扩展点 | routes/admin/platform.ts:217-354（drift 结构 :338-347） |
| 字段一致性规则（前缀约定） | doc/YAML_UNIFICATION_AUDIT.md:133-135 |
| 状态机规格原型 | doc/SKILLS_YAML_SPEC.md:334-364；doc/SKILL_EXPANSION_DESIGN.md:316-351 |
| scaffold 生成物/写盘策略/分工 | doc/SCAFFOLD_P5_SURVEY.md §5.2-5.5、§4 |
| 豁免字段证据（userVisible/core/goalConversation/debug） | prompts/orchestration/goal.yaml:145,150-155,161-176；simulation.yaml:54 |
| dataSource schema（W5 预留） | skills-file.ts:75-78、:299-309 |
