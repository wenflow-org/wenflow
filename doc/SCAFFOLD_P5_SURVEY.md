# Scaffold（admin 新建 Skill 向导）P5 调查 —— 决策证据

> 版本：2026-08-10 · 审计员只读调查，不改代码
> 任务：为 `POST /api/admin/skills/scaffold`（技能扩充 P5，SKILLS_YAML_SPEC §4）确定设计细节。
> 前置规格：`doc/SKILLS_YAML_SPEC.md`（§4 admin 向导规格）、`doc/SKILL_EXPANSION_DESIGN.md`（§6 设计 D、§9 风险表）。
> 本文件补充规格未覆盖的现状证据与判定结论，含一处对规格 §4.3 的**修正建议**（handler 写盘策略，见 §5.3）。

---

## 1. 现有新建能力盘点

### 1.1 skill-author / skill-compiler（AI 起草管道，已上线，无 UI）

**路由**：`backend/src/routes/admin/skill-author.ts`

| 端点 | 入参 | 产物 | 落盘 |
|---|---|---|---|
| `POST /api/admin/skill-author/draft`（:41-86） | `skillId`、`displayName`、`description?`、`requiredFields[]`（每项 `{fieldId, valueType, description?, enumValues?}`）、`sampleInput?`、`authorNote?` | `{systemPrompt, outputSchemaSummary, durationMs, modelUsed?, metaRulesVersion}` | **不落盘** |
| `POST /api/admin/skill-author/compile`（:96-130） | `systemPrompt`、`requiredFieldIds[]`（dot path）、`testUserPrompt?`、model/temperature/maxTokens 覆盖 | `{pass, rawOutput, parsedJson, fieldHits[], missingFields[], suggestions[]}` | **不落盘** |

**服务**：`backend/src/services/skill-author/index.ts`

- `draftSkillPrompt`（:42-67）：经 `executeSkillWithResult(auxSkillDefinitionMap['skill-author'], ...)`（:47）调 v4 aux skill；产物是**全文 system prompt 文本**（:51），outputSchemaSummary 由 requiredFields 拼接（:56-58）。**不写 core.yaml、不写 skills.yaml、不写 DB。**
- `compileSkill`（:121-180）：经 `auxSkillDefinitionMap['skill-compiler']`（:145）跑单轮验收，`getByPath`（:107-119）按 dot path 检查字段命中；`suggestions` 是规则推导的可读建议（:123,160-162）。
- 关键约束：draft 的 `requiredFields` **至少 1 个**（路由 :53-58），否则 400——"AI 无从起草"。
- `GET /api/admin/skill-author/meta`（:20-30）：返回 `adminAllowedPromptRoles`（soft-info/hidden-inference/derived-presentation）与元规则版本，供前端表单用。

**前端现状**：`frontend/src` 全量 grep `skill-author|draftSkill|compileSkill` **零命中** —— 该管道目前**没有 UI**，是纯 API 能力。

### 1.2 与 core.yaml 的关系（一条龙的关键矛盾点）

core.yaml 是五块 Prompt 的确定性编译 SSOT：`core-compiler.ts:100 compileCoreFile()` 从 identity/channels/rules/fields/constraints/params 编译出五块 system prompt，`checkFiveBlockBody`（:187）校验结构。因此：

- skill-author 产出的**全文 system prompt 不能直接作为 core.yaml**（格式不同：一个是成品文本，一个是结构化要素）。
- 可行衔接：AI 草稿作为**参考文本**，admin 在 SkillDesignPage 表单里把草稿拆解进 identity/rules/fields/constraints 后「保存并校验 → 编译预览 → 发布」（SkillDesignPage.vue:206-214 按钮链）。
- compile 的 `requiredFieldIds` 是 dot path（如 `understanding.real_problem`），core fields 是平铺 `name` —— 直接对接需做字段名映射或仅用 compile 验收草稿本身（草稿阶段）。

### 1.3 SkillDesignPage / PromptWorkbench：无「新建」入口

- `PromptWorkbench.vue`（核心文件目录，manifest.ts:31「核心文件同步」，配置组）：状态条只有「刷新」（:12-14）；每行跳 `openDesign` → `/admin/skills/<id>?tab=protocol`（:111-113）。**无新建按钮。**
- `SkillDesignPage.vue`：单 skill 设计页（路由 `/admin/skills/:agentId+`，router/index.ts:216-220）。页签：协议/试跑/版本/运行时/工程（:892-901）。协议页签即 core 编辑器：表单模式（:252-402）+ 源码模式（:407-420）+ 「保存并校验/编译预览/发布」（:206-214）。**无新建入口**（该页强绑定既有 skillId）。
- `Skills.vue`（admin-redesign，运行组「Skill 目录」）：纯运行时健康视图（调用/失败/成功率），状态条（:3-27）只有筛选与统计窗口。**无新建按钮**。
- `SkillDrawer.vue`：只读速览 + 「打开 Prompt 设计页 →」（:285），无新建。

**结论：全前端没有一处「新建 Skill」入口** —— P5 需从零加。

### 1.4 编排文件编辑弹窗（现成交互范式）

`FieldRoutingTable.vue`（挂在 Orchestrator.vue「字段路由」页签，:133-136）：
- 「编排文件」按钮（:4）→ `openOrchestration`（:171-182）拉 `GET /admin/field-routings/orchestration/:stage` 原文 + parsed 摘要 → 模态（:54-82）内 textarea 编辑 → 「保存到编排文件」（:184-208，PUT 后 toast + 重载列表 + emit changed）。
- **这是 skills.yaml 编辑 UI 应复用的现成范式**：YAML 原文 + 行内校验消息 + 摘要统计 + 保存后刷新。skills.yaml 现状**无 UI、直接改文件**（skills.yaml 头注释 :8-20 维护规则即手写约定）。
- 后端对应：`orchestration-file.ts` loader + `field-routing-orchestration-sync.ts`（= 规格中的 `fields:sync`，三表 upsert，:27+）+ 保存端点。

---

## 2. 最小合法 core.yaml 骨架

### 2.1 必填键清单（validateCoreFileShape 权威，core-file-loader.ts:178-375）

| 键 | 约束 | 依据 |
|---|---|---|
| `skillId` | 非空字符串 | :190-192 |
| `baseVersion` | ≥1 整数 | :194-196 |
| `identity` | 非空字符串 | :198-200 |
| `channels` | ≥1 个，∈ {dialogue, state, task, evidence, learner, path}（:26） | :203-214 |
| `rules` | ≥1 条非空字符串 | :275-278 |
| `fields` | ≥1 行 `{name, type, desc}`；name 小写字母开头仅含字母/数字/下划线（:295-299）；禁 platform 包装字段 `success/quality/stage/raw`（:34,301-306）；type ∈ 受控词表可带 `?`（:312-323） | :281-331 |
| `constraints` | 字符串数组，**可为空 []**（仅键必须存在） | :334-338 |
| `params` | `{temperature: 有限数, maxTokens: 正整数, failurePolicy ∈ CORE_FAILURE_POLICIES}` | :341-356 |

可选键（KNOWN_TOP_LEVEL_KEYS，:154-168）：`inputs`、`examples`、`stateAdvance`、`deltaOutput`、`outputMedia`（json/markdown/text，默认 json，:171）。

### 2.2 25 个存量 core.yaml 的键使用率（实测）

| 键 | 使用率 | 备注 |
|---|---|---|
| `stateAdvance` | 25/25 | 全量显式声明（schema 可选，事实必填） |
| `deltaOutput` | 25/25 | 全量显式声明 |
| `constraints` | 25/25 | schema 必填 |
| `inputs` | 13/25 | mainline 几乎全有（7/8 个 mainline 带 inputs）；aux 除 skill-author 外基本没有 |
| `outputMedia` | 3/25 | 仅 generic-chat / path-planning / skill-author |
| `examples` | 0/25 | **零使用**，骨架可不含 |

### 2.3 最小合法骨架（实际示例 = generic-chat.yaml，全文件 20 行）

```yaml
# v4 核心文件：generic-chat（SKILL_PROTOCOL_V4 §2）
skillId: generic-chat
baseVersion: 1
identity: |
  你是平台通用文本能力处理器。仅在没有更专门 Skill 的通用对话、评估、测试或后台辅助场景中使用；正式业务应优先使用专用 Skill。
channels: [dialogue, task, learner]
stateAdvance: false
rules:
  - 完整接收调用方给出的系统指令和消息上下文，按系统指令完成回答
  - 不把平台内部路由、调用名或调试元数据写入输出
  - 如果调用方要求 JSON，只输出 JSON
fields:
  - name: reply
    type: string
    desc: 根据输入系统指令与消息上下文生成的最终文本
constraints:
  - 不补充调用方未提供的事实或后台数据
params: { temperature: 0.7, maxTokens: 4000, failurePolicy: propagate }
deltaOutput: false
outputMedia: text
```

要点：aux 最小形态可无 `inputs`；`params.failurePolicy` 三值 `propagate|retry|deterministic`（yaml-vocabulary 单源）；`serializeCoreFile`（core-yaml-writer.ts:160-209）固定键序，可复用来生成骨架。

---

## 3. 三类 handler 模板模式

**协议层**：`SkillHandler = (input: any) => Promise<any>`（executor.ts:19）；注册表 `skillHandlers: Record<string, (input) => Promise<any>>`（skills/index.ts:179-198）。agent 注册点例外：`agentHandlers: Record<string, (input, context) => Promise<any>>`，键带 `skill:` 前缀（agents/index.ts:79-81，如 `'skill:learner-model'`）。

### 3.1 aux（推荐新手路径：runAux 模板）

`v4-aux-skills/index.ts` 是 9 个 aux 的**共享宿主**。新增 aux 需改 **4 处**（skills:check F11 强制，check-skills-file.ts:84-89 aux 双向差集）：
1. `AuxSkillId` 联合类型（:19-28）
2. `META` 表条目（:160-170）
3. handler 函数 `async function xxxHandler(input) { return runAux({meta, input, buildUserPayload, normalize, validate}) }`（范式 :176-211）
4. `auxSkillHandlers` 映射（:337-347）+ `auxSkillDefinitions` 自动由 META 派生（:331-335）

`runAux` 骨架（:74-138）已封装：`callPrompt(requireActivePrompt: true)`、失败策略从 ACTIVE prompt 运行时解析（:145-154）、`__fallback/__onFailure` 调用方覆盖、generationOverride。最小 handler 示例（genericChatHandler，:249-262）：

```ts
async function genericChatHandler(input: any) {
  return runAux<string>({
    meta: META['generic-chat'],
    input,
    buildUserPayload: (d) => d.message ?? '',
    normalize: (parsed) => (typeof parsed === 'string' ? parsed : String(parsed || '')),
    validate: (parsed) => typeof parsed === 'string' && parsed.length > 0
      ? { valid: true }
      : { valid: false, failureReason: 'GENERIC_CHAT_OUTPUT_EMPTY' },
  });
}
```

**aux 的 skills.yaml handlerRef 恒指向既有文件** `backend/src/skills/v4-aux-skills/index.ts`（skills.yaml:257,269,283 等）→ F5 文件存在性天然通过，**无需占位文件**。

### 3.2 mainline（完整 PromptCallSpec + definition + handler）

`goal-conversation/index.ts` 是主链范式：
- `AgentDefinition`（:206-270）：`id: 'skill:<id>'` + name/version/capabilities/inputSchema/outputSchema/stats。
- `buildGoalPromptSpec`（:789-852）：`{agentId: 'skill:<id>', defaultSystemPrompt: '', requireActivePrompt: true, caller, buildUserPayload, parseRawOutput, validateParsedOutput, normalizeOutput, mapEnvelope?, retryStrategy}`。
- `goalConversationAgentHandler(input: AgentInput, context: AgentContext)`（:871-1149）：callPrompt → normalize → 返回 `{success, userVisible, internal, runtimeEnvelope, renderHints, schemaVersion: 'agent-output-v1', metadata, debug}`。
- 每个 mainline 还有 `runXxx` 便捷入口（:1151-1250）。
- 注册：skills/index.ts 两处手写（定义数组 :102-176 中一项 + skillHandlers :179-198 一行，如 :193-197 的包装 `(input) => runGoalConversationAgent(input)`）。

**mainline 的 skills.yaml handlerRef 指向新文件** `backend/src/skills/<id>/index.ts` → **F5 存在性校验对新 skill 生效**（见 §5.3 写盘策略）。

### 3.3 handler-only（无 LLM 纯函数模块）

`mcp-tool/index.ts:57` `executeMcpTool(input): Promise<SkillExecutionResult>`：definition（:18-42）+ 纯函数 handler（无 callPrompt）。注册在 skillHandlers（skills/index.ts:190）。`registrationPoint: agents` 变体见 `learner-model-agent/index.ts`（definition :26-75 + handler class :77+），注册在 agentHandlers（agents/index.ts:81）。

**最小可编译模板的通用形态**：导出 `xxxDefinition: SkillDefinition`（protocol.ts:23-67 的 shape）+ 导出 handler 函数；mainline/aux 的 handler 内部以 `callPrompt({agentId: 'skill:<id>', requireActivePrompt: true, ...})` 为核心，handler-only 无 LLM 调用。

---

## 4. skill-author 与 scaffold 的分工结论

| 能力 | 确定性 | 产物 | 落盘 | 用途 |
|---|---|---|---|---|
| **scaffold**（本次设计） | 确定性（纯模板拼装，无 LLM） | core.yaml 骨架 + skills.yaml 条目 + handler 占位 + 注册/coordinator 片段文本 + completion | 部分落盘（§5.3） | 把"6~7 处手写动作"收敛为 1 次请求；保证 skills.yaml 校验（F1~F12）不挂 |
| **skill-author**（已有） | AI 起草 | system prompt 全文文本 + outputSchemaSummary | 不落盘 | 可选增强：admin 在向导第 2 步填 requiredFields → draft 出草稿 → 作为 core.yaml 表单的参考文本 |
| **skill-compiler**（已有） | AI 单轮验收 | pass/fieldHits/missingFields/suggestions | 不落盘 | 草稿字段覆盖验收；或对 core.yaml 编译产物反验 |

**一条龙流程**（建议）：
```
scaffold（骨架，确定性）
  → [可选] skill-author draft（requiredFields → 草稿文本，参考用）
  → admin 在 SkillDesignPage 协议页签用表单填 identity/rules/fields/constraints（草稿为参考）
  → [可选] skill-compiler 验 requiredFieldIds 覆盖
  → 保存并校验 → 编译预览 → 发布（ACTIVE prompt 落 DB）
  → fields:sync（mainline 字段回填）→ 完成度 live
```
分工本质：**scaffold 保证系统不挂（注册面合法），skill-author 降低 content 编写成本（提示面），skill-compiler 做验收门（质量面）**。三者无互相依赖，可各自独立调用。

---

## 5. scaffold 设计规格（基于现状证据的判定）

### 5.1 输入

基础入参（对齐 SKILLS_YAML_SPEC §4.1，skills-file.ts:61-81 字段全集）：
`skillId`（kebab-case，KEBAB_CASE 正则 :116）/ `kind`（mainline|aux|handler-only）/ `stage`（mainline 必填，∈ SKILL_STAGES :42）/ `parentAgent?`（∈ manifest kind=agent 条目）/ `displayName?` / `description?` / `aliases?` / `dataSource?` / `mcpTools?`。

可选增强输入（建议）：
- `requiredFields[]`（{fieldId, valueType, description?, enumValues?}）：直接转投 skill-author draft 的入参（draft 路由 :71-78 同构），一步到位。
- `writeHandler?: boolean`（默认 true）：是否落盘占位 handler（§5.3）。
- `skipOrchestrationContract?: boolean`（mainline 排障用，默认 false）——不建议暴露，F3 铁律（skills-file.ts:425-431）要求 contracts 必须有，跳过会让 skills.yaml 校验挂。

**够用判定**：以上覆盖 skills.yaml 全部可手写字段（§1.3 表）；`coordinator` 子结构**不需要输入**——scaffold 生成空登记占位（`agentId: <parentAgent>, steps: []`，参考 skills.yaml:119-121 adaptive-guidance-copy 的空 steps 形态），真实 steps 由人工粘贴片段。

### 5.2 生成物（按 kind 差异）

| # | 生成物 | mainline | aux | handler-only | 写入方式 |
|---|---|---|---|---|---|
| 1 | `prompts/core/<id>.yaml` 骨架 | ✅ | ✅ | ❌（F7 禁填，skills-file.ts:277-279） | 落盘，存在即跳过 |
| 2 | `prompts/skills.yaml` 条目 | ✅ | ✅ | ✅ | 落盘，append-only |
| 3 | 编排文件 `<stage>.yaml` contracts 追加 `skill:<id>` | ✅ | ❌ | ❌ | 落盘，append-only（F3 铁律必需，skills-file.ts:425-431） |
| 4 | `backend/src/skills/<id>/index.ts` 占位 | ✅ | ❌（宿主已有） | ✅ | 落盘（§5.3）；aux 改为返回 v4-aux 4 处修改模板文本 |
| 5 | skills/index.ts 注册片段（两段） | ✅ 文本 | ✅ 文本（改 v4-aux） | ✅ 文本 | 返回文本（§2.3② 决策：不自动改写 TS，SKILLS_YAML_SPEC:210-215） |
| 6 | coordinator steps 片段 | ✅ 文本 | 空登记即可 | ❌ | 返回文本 |
| 7 | completion 清单（§5.5） | ✅ | ✅ | ✅ | 响应体 |

core.yaml 骨架按 kind 差异：aux/mainline 同一模板基线（§2.3），mainline 建议 `channels: [dialogue, state]` + `stateAdvance: false` + `inputs: []` 空段注释（SKILL_EXPANSION_DESIGN:314 已定）；identity/rules/fields 用**带 TODO 标记的占位文本**（供 core-ready 判定识别）。

### 5.3 写盘策略：handler 占位**必须落盘**（对规格 §4.3 的修正建议）

现状证据链：
1. `loadSkillsFile()` 启动 fail-fast（index.ts:431-440），其中 `validateFileExistence`（skills-file.ts:463-484）检查 `handlerRef` 文件存在（F5）——**skills.yaml 条目一旦落盘，handlerRef 指向的文件不存在 = 下次重启直接挂**。
2. mainline/handler-only 的 handlerRef 指向**新文件**（约定 `backend/src/skills/<id>/index.ts`，SKILLS_YAML_SPEC:43）；aux 的 handlerRef 指向既有 `v4-aux-skills/index.ts`（§3.1），F5 天然通过。
3. 启动注册循环是静默跳过（index.ts:449-454 `if (handler)`）；未注册的 skill 在调用时于 `executeSkillWithResult` 抛 `Skill handler not found`（skills/index.ts:221-223），**失败面收敛在该 skill 的调用点**，不拖垮平台。
4. F11 注册存在性目前只在脚本侧 fail-fast（check-skills-file.ts:51-82），启动侧 F12 强化是 P2 待办（SKILLS_YAML_SPEC:239,279）。

判定结论：
- **规格 §4.3「handler 返回文本不落盘」在 mainline/handler-only 下会导致"scaffold 后重启即挂"**（F5 fail-fast 与 draft 中间态直接冲突）。必须修正为：**落盘一个可编译的占位 handler**。
- 占位 handler 安全性论证：
  - 编译安全：模板即最小合法 TS（definition + handler），无外部依赖。
  - 启动安全：占位文件**不注册**进 skills/index.ts（注册片段只作为文本返回）→ 启动注册循环静默跳过（index.ts:449-454），executor 不可达。
  - 调用安全：若用户提前粘贴注册片段但未实现，调用进入占位函数 → `throw new Error('SC_NOT_IMPLEMENTED: <id> 尚未实现')`，skill 级失败，`executeSkillHandler` catch 记录 span 后抛出（executor.ts:242-269），不炸平台。
  - 覆盖安全：用户实现真实 handler 时直接覆盖文件（scaffold 存在即跳过，幂等）。
- **aux 例外**：无需占位文件（F5 天然过），返回 v4-aux 4 处修改模板文本即可；但 skills:check F11 aux 双向差集（check-skills-file.ts:84-89）在未改代码前是红的——这是 draft 中间态的预期成本，由完成度状态机标注（见 §5.5 live 才要求 skills:check 全绿）。

### 5.4 幂等与冲突

- 判定基准：**skills.yaml 是否已含该 skillId**（SKILLS_YAML_SPEC §4.2，唯一状态事实）。
- 已存在且 `skillId/kind/stage/parentAgent` 一致 → `200 {alreadyExists: true, completion}`（零写入）。
- 已存在但关键字段冲突 → `409 {conflictFields}`。
- 不存在 → `201 {completion}`。
- 唯一性预检三处（SKILLS_YAML_SPEC:320）：skills.yaml 活跃集 + manifest（skillId 及 aliases，F9 全表唯一 :337-369）+ `backend/src/skills/<id>/` 目录存在性。
- 生成物「存在即跳过」+ append-only：core.yaml 不覆盖、编排文件 contracts 追加安全（可 git revert）、skills.yaml 条目追加安全。**注意编排文件 contracts 追加后若未回填字段，`field-routing` 对账会 warn（不 fail）**——由 fields-synced 状态承接。
- SKILLS_FILE_DISABLED=1 过渡开关（skills-file.ts:20-21, index.ts:431-432）：scaffold 写盘在开关打开时**应拒绝**（户口簿未加载，写盘无人校验）或显式警告——建议直接 503。

### 5.5 完成度状态机（判定数据源，全部派生不落库）

对照 SKILLS_YAML_SPEC §4.4 与 SKILL_EXPANSION_DESIGN §6.3，补充现状数据源：

```
draft            skills.yaml 含条目（append-only 落盘即达）
  → handler-ready    F5（handlerRef 文件存在，skills-file.ts:463-484）+ 导出扫描 + F11 注册存在
                     （resolveRegistrationPoint 分派，check-skills-file.ts:57-67；agents 例外键 'skill:<id>'，agents/index.ts:81）
  → core-ready       core.yaml 存在（F6）+ validateCoreFileShape 通过（core-file-loader.ts:178）
                     + fields ≥1 且非 TODO 占位文本
  → fields-synced    编排文件 contracts 含 skill:<id>（mainline 铁律，skills-file.ts:425-431）
                     + 字段路由行已回填（field-routing-orchestration-sync.ts 对账）；aux 豁免（不进字段路由）
  → live             ACTIVE prompt 存在（agent_prompts status=ACTIVE for 'skill:<id>'，对应
                     workbench-meta 查询 skills.ts:480；noPromptFile 豁免）
                     + skills:check 全绿（check-skills-file.ts F1~F12 + P1）
```

判定数据源汇总（对应任务问题）：
| 状态 | 数据源 | 现状可计算性 |
|---|---|---|
| draft | `loadSkillsBookRaw()` 活跃集（skills-file.ts:536-547） | ✅ |
| handler-ready | fs 存在 + 导出关键词扫描 + `skillHandlers`/`agentHandlers` 键集（check-skills-file.ts:51-82） | ✅（F11 逻辑可复用为只读查询） |
| core-ready | `loadCoreFile(skillId)`（core-file-loader.ts:476-498）+ validateCoreFileShape | ✅ |
| fields-synced | 编排文件 contracts/routings（orchestration-file.ts loader） | ⚠️ `check-core-fields-sync` **未实现**（P2 待办，SKILL_EXPANSION_DESIGN:340）；降级判定 = contracts 含条目 + routings 行数 > 0 |
| live | `agentConfigService.getActivePrompt('skill:<id>')`（同 skill-author/index.ts:148,904 用法）+ skills:check 全绿 | ✅ |

状态条 UI 落点：`workbench-meta` 端点扩展 completion 字段（skills.ts:426-570，规格 P1 待办），SkillDesignPage 状态条复用 drift/health 语言逐项打勾（SKILLS_YAML_SPEC:364）。

---

## 6. 前端入口建议

**入口位置**（现状：全前端无任何新建入口，§1.3）：
- **主入口：PromptWorkbench.vue**（核心文件目录，`/admin/prompt-workbench`，配置组）。理由：新 skill 的第一个可见产物就是 core.yaml 骨架，目录页天然是"新建后会出现的地方"；且该页无参数、无既有实体绑定，加按钮语义干净（状态条 :11-15 旁加「新建 Skill」）。
- **次入口：Skills.vue 状态条**（admin-redesign，`/admin/skills` 运行组）：该页是 skill 生命周期视图（含健康/调用），P2 完成度列也落在这里（SKILLS_YAML_SPEC:259），新建入口与之并列合理。
- **否决**：SkillDesignPage 顶部（SKILL_EXPANSION_DESIGN §6.1 的候选）——该页路由强绑定既有 skillId（/admin/skills/:agentId+，router:216），新建按钮只能在"查看某 skill 时"出现，语义别扭。
- **表单承载**：独立 `SkillWizard.vue`（模态，复用 FieldRoutingTable 编排文件弹窗的交互范式：mk-modal 结构 :54-82 + YAML 原文 textarea + 行内校验消息 + 保存 toast）。

**表单字段**（步骤 1 身份）：skillId（kebab-case + 三处唯一性实时校验：skills.yaml/manifest/目录）、kind（三选一 + 语义说明）、stage（mainline 必选，下拉从 orchestration stages 派生）、parentAgent（下拉，manifest kind=agent 条目）、displayName、description、aliases（可选）、dataSource/mcpTools（可选，P4 预留）。
**步骤 2（可选增强）**：requiredFields 编辑器 → 「AI 起草」调 skill-author draft（首次接入该 API，需新建前端 API 封装，adminApi.ts 无此段）；草稿展示 + 复制。
**结果页**：completion 清单（§5.5）+ 三段可复制代码块（skills/index.ts 注册片段 / v4-aux 修改模板 / coordinator steps 片段）+ 「跳转 SkillDesignPage 协议页签继续」（router.push `/admin/skills/<id>?tab=protocol`，同 PromptWorkbench openDesign 模式 :111-113）。

---

## 附：关键证据索引

| 证据 | 位置 |
|---|---|
| scaffold 规格（入参/幂等/生成物/状态机） | doc/SKILLS_YAML_SPEC.md:294-364 |
| 向导设计 D + 风险表 | doc/SKILL_EXPANSION_DESIGN.md:300-329, 358-368 |
| skill-author 路由（draft/compile/meta） | backend/src/routes/admin/skill-author.ts:20-130 |
| skill-author 服务（executeSkillWithResult 调 aux） | backend/src/services/skill-author/index.ts:42-67, 121-180 |
| core schema 校验器 | backend/src/services/prompt-lab/core-file-loader.ts:178-375 |
| core 最小骨架实例 | prompts/core/generic-chat.yaml（20 行） |
| skills.yaml schema 校验（F1~F12） | backend/src/services/skill-registry/skills-file.ts:198-457, 463-484 |
| F5 handlerRef 存在性（写盘策略依据） | backend/src/services/skill-registry/skills-file.ts:463-484 |
| 启动 skills.yaml fail-fast + 静默注册 | backend/src/index.ts:431-440, 448-454 |
| F11 注册分派 + aux 双向差集 | backend/src/scripts/check-skills-file.ts:51-89 |
| handler 签名与注册表 | backend/src/skills/executor.ts:19；skills/index.ts:179-198, 221-223；agents/index.ts:79-81 |
| aux runAux 模板与 4 处修改点 | backend/src/skills/v4-aux-skills/index.ts:19-28, 74-138, 160-170, 337-347 |
| mainline PromptCallSpec 范式 | backend/src/skills/goal-conversation/index.ts:789-852, 871-916 |
| handler-only 范式 | backend/src/skills/mcp-tool/index.ts:18-57 |
| 编排文件 contracts 结构 | prompts/orchestration/goal.yaml:10-12 |
| fields:sync 对账脚本 | backend/src/scripts/field-routing-orchestration-sync.ts:27-60 |
| 编排文件编辑弹窗（UI 范式） | frontend/src/views/admin-redesign/FieldRoutingTable.vue:4, 54-82, 171-208 |
| 前端无 skill-author/scaffold 入口 | frontend/src 全量 grep 零命中 |
| PromptWorkbench / Skills / SkillDesignPage 现状 | frontend/src/views/admin-redesign/PromptWorkbench.vue:11-15；Skills.vue:3-27；SkillDesignPage.vue:892-901 |
| workbench-meta（completion 扩展点） | backend/src/routes/admin/skills.ts:426-570 |
