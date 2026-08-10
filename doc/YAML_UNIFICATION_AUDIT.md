# YAML 生态统一化审计

- 日期：2026-08-10
- 范围：`prompts/core/`、`prompts/orchestration/`、`prompt-lab/manifests/`、`prompt-lab/field-lineage.yaml` 及周边 json/md 声明、设计中的 `prompts/skills.yaml`
- 性质：只读调查，不改代码
- 方法：全量解析 25+5+28 个 yaml + 3 个校验器源码通读 + 运行时消费方 grep

---

## 1. YAML 家族地图

### 家族 A：prompts/core/<skillId>.yaml（控制面，25 个文件）

**顶层键**（25/25 恒定）：`skillId` `baseVersion` `identity` `channels` `stateAdvance` `rules` `fields` `constraints` `params` `deltaOutput`；可选：`inputs`（13 文件）、`outputMedia`（3 文件：generic-chat=text、path-planning=json、skill-author=markdown）。`examples` 词表存在但 0 文件使用。校验器白名单见 core-file-loader.ts:160-174。

**独有概念**：identity/rules/constraints（业务要素）、channels 六材料池、stateAdvance、deltaOutput、字段 turn 标记、inputs 三前缀引用（skill:/sandbox:/user:）、params{temperature,maxTokens,failurePolicy}。

**校验器**：`backend/src/services/prompt-lab/core-file-loader.ts` `validateCoreFileShape`（:184-371，收集全部问题不提前返回，kebab-case 错误码）、`parseCoreFile`（:430-469）、`scanCoreFiles`（:497-530）、`computeCoreHash`（:548-551，漂移锚点）。

**消费方**：
- `core-compiler.ts:100-160` —— 五块确定性编译 → `prompts/skill.<id>.md` + DB ACTIVE
- `skill-output-validator.ts:187-208` —— 运行时按 core fields 校验 LLM 输出（60s 缓存）
- `lint-prompts.ts:32-49`（core-file-missing/checkFieldFreeze）、`check-core-hash-parity.ts`、`core-prompt-metadata.ts:42-51`（coreSnapshot）
- `core-yaml-writer.ts`（admin 编辑侧）、`field-lineage.ts:76-80`（血缘推导）、`sandbox-resolver.service.ts:83`、`input-handoff-check.ts:28-91`（inputs↔routings 对账）
- `check-input-handoffs.ts`、`compile-core-files.ts`、`ensure-core-agent-prompts.ts`、`seed-core-agent-prompts.ts:13`

**词表**：字段类型 `string|number|boolean|enum|object|object[]|string[]`（core-file-loader.ts:26-34，可带 `?` 后缀）；failurePolicy `retry|fallback|propagate`（:36）；channels 六池（:22）；outputMedia 三值（:177）；平台禁出字段 success/quality/stage/raw（:40）。

**头注释**：`# v4 核心文件：<skillId>（SKILL_PROTOCOL_V4 §2）`（如 basic-evaluator.yaml:1）。

### 家族 B：prompts/orchestration/<stage>.yaml（数据面，5 个文件）

**顶层键**（5/5 恒定）：`stage` `displayName` `description` `contracts` `fields` `routings`。实测规模：21 contracts / 137 fields / 197 routings / 80 处 visibilityPreset（user-clarification 4 + agent-internal 76）。

**独有概念**：contracts（仅声明 agentId，displayName/description 由 `seed-contract-helper.ts:14-20` 从 agent-manifest 派生）、fields（fieldId/promptRole/valueType/pathInRawOutput/snakeName/camelName/enumValues/systemLocked/structureLocked/bindings）、routings（render/handoff/internal/accumulate/visibilityPreset/notes）。

**校验器**：`backend/src/services/field-routing/orchestration-file.ts` —— 解析即 fail-fast 抛错（:156-208），promptRole/render 白名单（:24-36, 112-113, 137-139），无 issue 收集模型；`validateOrchestrationContent`（:224-226）供编辑侧预检；`field-routing-bootstrap.service.ts` `validateFieldRoutingSeedSemantics`（:76-109，handoff 白名单/自环/组合语义，返回 string[] 带 `[field-routing]` 前缀）与 `detectFieldRoutingDrift`（:255-336，声明 vs DB 漂移）。

**消费方**：
- `field-routing-bootstrap.service.ts:11-15`（模块加载即灌 DB 三表 field_definitions/agent_contracts/agent_field_routings）
- `generate-agent-snapshots.ts:12`、`field-routing-orchestration-sync.ts`（编辑侧 YAML→DB）、`field-routing-drift-probe.ts`、`verify-orchestration-edit-side.ts`
- admin 路由 `field-routings.ts:17`；前端 `DriftAuditPanel.vue:10`、`FieldRoutingTable.vue:5`（仅展示）
- `prompt-compiler/rewrite-output-section.ts:22`（消费 PROMPT_ROLES 全集）
- `field-dispatcher`（运行时装配，间接经 DB）

**词表**：promptRole 7 值（orchestration-file.ts:24-32）；render visible/hidden（:35-36）；valueType **无白名单**（:122 仅非空字符串）；visibilityPreset **无白名单**（:150 仅字符串）；handoff = manifest agentId ∪ 阶段名（bootstrap:51-57 校验）。

**头注释**：`# <Stage> 阶段编排文件（字段路由单源化）` + 迁移/词汇批次说明（teaching.yaml:1-4、simulation.yaml:1-8）。

### 家族 C：prompt-lab/manifests/<skillId>.yaml（契约，28 个文件）

**顶层键**（28/28 恒定）：`version`(prompt-lab-manifest/v1) `skillId` `agentId` `name` `archetype` `description` `acceptableAgentIds` `publish` `runtimeDefaults` `promptContract` `runtimeContract` `ownership` `tags` `notes`。其中 `promptContract.fields` 仅 2 文件使用（goal-conversation.yaml:36、teaching-turn.yaml:37）。

**独有概念**：promptContract（executionMode/artifactKind/interactionMode/input/output/context/failurePolicy/fields）、runtimeContract（contextMode/businessState/contextUpdate/outputEnvelope）、runtimeDefaults（tier/temperature/maxTokens/model/thinkingMode/reasoningEffort）、ownership{tier,visibility}、publish、acceptableAgentIds、archetype。

**校验器**（三套逻辑叠加）：
- `runtime-contract.ts` `normalizeRuntimeContract`（:176-215）—— **静默回退**，非法值被默认值吞掉，无诊断输出
- `skill-prompt-contract.ts` `lintDeclaredSkillPromptContract`（:304-435）—— {level,code,field,message}，SCREAMING_SNAKE 错误码
- `seed-core-agent-prompts.ts` `validateDeclaredRuntimeContract`（:98-160）—— throw-first

**消费方**：
- `core-prompt-metadata.ts:52`（发布时契约快照进 DB metadata，runtimeContractSource:'manifest'）
- `check-prompt-runtime-contract-metadata-parity.ts:391-425`（manifest ↔ DB ACTIVE 对账）、`lint-prompts.ts:67-75`
- `routes/prompt-lab.ts:172-280`（admin 编辑 + runtimeDefaults 净化）、`v4-aux-skills/index.ts:141-150`（**运行时** failurePolicy 语义：deterministic-fallback/best-effort→fallback，其余→throw）
- `skill-runtime-contract.service.ts`、`resolve-runtime-contract.ts`、`resolve-prompt-contract.ts`

**词表**：failurePolicy 5 值 blocking/retry/best-effort/deterministic-fallback/none（skill-prompt-contract.ts:28-33）；contextMode 4 / contextUpdateMode 4 / stateOwner 4 / envelope 2 / statusValues 4（runtime-contract.ts:1-15）；archetype 6 / artifactKind 8 / interactionMode 4 / transport 5 / media 4 / schemaSource 5 / delivery 2 / modelExposure 2（skill-prompt-contract.ts:4-33）；字段角色 direction×visibility×owner×export（:42-45）。

**头注释**：无（文件直接以 `version:` 开头，如 basic-evaluator.yaml:1）。

**成员差异**：28 = 25 个有 core 文件 + 3 个无 core（concept-priority、goal-analysis、path-adjustment-generator，均属退役/无生产调用，见 index.ts:83-84、cleanup-retired-field-data.ts:17-22）。

### 家族 D：prompt-lab/field-lineage.yaml（血缘静态表，1 个文件）

`version: field-lineage/v1` + `entries: [{skillId, field, consumers}]`（27 条）。**无校验器**（field-lineage.ts:61-64 仅加载 + mtime 缓存），文件失败时后端静态表兜底（field-lineage.ts:23-59）。消费方：admin `/core/:skillId/lineage` 与编辑分级（§7.1）。核心文件 inputs 声明自动推导血缘（field-lineage.ts:70-80）。

### 家族 E：json/md 形态声明（3 类）

| 文件 | 内容 | 消费方 |
|---|---|---|
| `backend/config/mcp.json` | MCP 服务器/tools 配置 | MCP 基础设施（独立体系，SKILL_EXPANSION_DESIGN.md:76） |
| `backend/config/agent-catalog.json` | agentId → {status, updatedAt, updatedBy} 发布状态注册 | 发布/目录管理（与 yaml 家族无校验交集） |
| `prompts/agent-snapshots.md` | 自动生成的沙盘说明书（`npm run prompts:snapshots`），由编排路由 + core inputs 推导，CI 校验漂移 | SKILL_PROTOCOL_V4.md:90；input-handoff-check 的沙盘路径对账基准 |

另：`prompts/skill.<skillId>.md` ×25 为编译产物（frontmatter：agentId/coreHash/coreVersion/temperature/maxTokens/failurePolicy/deltaOutput，见 core-compiler.ts:104-116），不属于人工声明源。

---

## 2. 词表统一候选表

### 2.1 类型词表（三处不一致 + 一处重复白名单）

| 项 | 现状 | 统一方案 | 收益/成本 | 风险 |
|---|---|---|---|---|
| 字段类型 | core fields：`string/number/boolean/enum/object/object[]/string[]` + `?`（core-file-loader.ts:26-34）；**inputs 段实际还用了 `array`**（73 个 ref 中约 20 处 type=array，validator 只查 typeof string 不查词表，core-file-loader.ts:257-259） | 单一规范词表：`primitive(7) ∪ array<T> 泛型`；core 侧保留 `T[]` 拼写（已编译进产物与运行时校验器），编排侧 `array<T>`（agent-snapshots.md 亦渲染为 `array<string>`），新增**拼写归一映射** `string[]⇔array<string>`、`object[]⇔array<object>`、`enum` 只允许 core 侧；inputs 的 `array` 显式登记为 `array<object>` 的缩写或纳入词表 | 收益：一处定义、四处消费（loader/输出校验器/编排 loader/快照生成）不再各写各的白名单；成本：低——抽 `yaml-vocabulary.ts` 导出类型常量+归一函数，5 处引用替换 | 低。运行时校验器（skill-output-validator.ts:34 `VALID_TYPES`）语义不变，仅换常量来源 |
| valueType | 编排 137 字段 valueType **无白名单**（orchestration-file.ts:122 仅非空串），实测值域：string/number/boolean/object/array\<string\>/array\<object\>/**裸 `array`**（simulation.yaml consistencyNotes/visibleRequestedChanges/findings/recommendations/evidence 5 处） | 接入统一词表；裸 `array` 归一为 `array<object>`（这些字段的 promptRole 均为 proposal-output，运行期为数组） | 收益：编排文件不再容忍拼写漂移；成本：低 | 低。归一后 DB 值变化一次，drift 检测会报一次差异，需先改文件再 bootstrap |
| enum 缺位 | core 有 `enum` 类型（grade/verdict/emotion/mode 6 处），编排 valueType 无 enum，对应字段降级为 string（simulation verdict/emotion） | 词表声明 enum 为 core-only（值域在 desc 中列明，SKILL_PROTOCOL_V4.md:65）；编排侧如需展示枚举用 `enumValues` 键（已有，goal.yaml 未用、teaching 未用） | 成本：0；文档化即可 | 低 |

### 2.2 failurePolicy（双词表，实测 25/25 已一致映射，但无守门）

| 项 | 现状 | 统一方案 | 收益/成本 | 风险 |
|---|---|---|---|---|
| 词表 | core：`retry/fallback/propagate`（core-file-loader.ts:36）；manifest promptContract：`blocking/retry/best-effort/deterministic-fallback/none`（skill-prompt-contract.ts:28-33） | **不合并词表**（两层语义不同：core=业务意图，manifest=运行时契约；runtime 从 ACTIVE metadata 读 manifest 值，v4-aux-skills/index.ts:141-150），在共享模块定义**双向映射表**：`retry⇔retry`、`fallback⇔deterministic-fallback`、`propagate⇔blocking`，`best-effort/none` 无 core 对应（core-only 侧无入口） | 收益：映射成为机器可查的单一事实；成本：低（一个常量 + 一个交叉校验） | 低 |
| 现状核查 | **任务描述中"13 个 skill 不一致"在 2026-08-10 全量核对下不成立**：25/25 一致（9 retry→retry、11 fallback→deterministic-fallback、5 propagate→blocking，见 params-diff 实测表）。peer-reinforcement.yaml:3 注释也印证映射已归一 | — | — | — |
| 缺守门 | **无任何校验器交叉核对 core params.failurePolicy 与 manifest promptContract.failurePolicy**（lint-prompts.ts 分别校验两家族但无 cross-check） | `lint-prompts.ts` 增加 cross-check：按映射表比对，warn 级（映射可演进，先不 fail-fast） | 收益：防止未来漂移回到"不一致"状态；成本：低 | 低 |

### 2.3 promptRole / render / visibilityPreset / handoff（词表引用情况）

| 项 | 现状 | 统一方案 | 收益/成本 | 风险 |
|---|---|---|---|---|
| promptRole | **已是单一词表**：orchestration-file.ts:24-32 定义 7 值，rewrite-output-section.ts:22 引用同一常量，137 字段全部命中白名单 | 保持不变；词表可迁入共享模块但不动语义 | 0 | 低 |
| render | 单一词表 visible/hidden（orchestration-file.ts:35-36），197 行全命中 | 不变 | 0 | 低 |
| visibilityPreset | **无白名单**（orchestration-file.ts:150 仅 asOptionalString）；实测仅 2 值：user-clarification（goal.yaml 4 处）、agent-internal（76 处）；DB 列为自由字符串 | 加白名单 `{agent-internal, user-clarification}`，后续新增值走词表扩展 | 收益：防拼写漂移（admin drift 页会因无词表静默接受错值）；成本：低 | 低。注意前端/DB 无其他值，扩展兼容 |
| handoff 目标 | 词表 = manifest agentId（`skill:<id>`、`<stage>-agent`）∪ 阶段名（goal/path/teaching/profile/simulation），bootstrap:51-57 已校验；**混用两类命名**：teaching.yaml:519 `handoff: [profile]`（阶段名）vs :216 `[teaching-agent]`（agentId） | 保持双类合法（阶段名=下游阶段入口是设计决策，orchestration/_README.md:52 已文档化），词表迁共享模块供编排 loader 与 bootstrap 共用 | 0 | 低 |

### 2.4 stage / agent 引用（一致性）

| 项 | 现状 | 发现 | 建议 |
|---|---|---|---|
| core sandbox: 引用 | 用**阶段简名**（`sandbox:teaching.session.messages`、`sandbox:path.normalizedInput`），经 SANDBOX_AGENT_ALIASES（agent-contract-view.ts:42-48）映射到 `<stage>-agent` | 13 文件 67 个 sandbox ref 全部命中别名表；agent-snapshots.md:12 文档写 `sandbox:<agentId>.<key>` 与 core 实际写法（阶段简名）不一致，属文档口径问题 | agent-snapshots.md 文档改口径为 `sandbox:<stageAlias>.<key>`；别名表保持单一事实 |
| acceptableAgentIds | manifest 家族自有历史别名，**与编排 agentId 两套命名**：teaching-turn.yaml:10-13 `[skill:teaching-turn, teaching-turn-agent, teaching-turn-agent]`——**含字面重复项**；另有 5 文件带裸别名（goal-conversation.yaml:10-11、path-planning.yaml:10-11 `path-agent`、peer-reinforcement.yaml:10-11 `peer-agent`、session-wrapup.yaml:10-11 `session-wrapup-agent`、stage-designer.yaml:10-11 裸 `stage-designer`） | 重复项为数据质量问题；别名（teaching-turn-agent/peer-agent 等）与编排文件 `teaching-agent` 不是同一词 | 去重 + 词表注明"历史别名"，新登记只允许 `skill:<id>` 与 `<stage>-agent` |
| ownership/domain | manifest ownership 28/28 恒为 `{tier: production, visibility: internal}`（0 信息量）；runtimeContract.businessState.domain 由 inferDomain 硬编码推导（runtime-contract.ts:95-104），与编排 stage 无校验关系 | domain 值域实际 = 编排 stage ∪ 业务域（teaching/path-generation/goal-conversation/virtual-learner/learner-model/guidance/prompt-compiler），**无白名单、无 cross-check** | domain 词表入共享模块；编排 stage ↔ domain 一致性留待 skills.yaml 阶段处理（见 §6） |

---

## 3. 结构统一候选表

### 3.1 字段声明三处并存

| 项 | 现状 | 统一方案 | 收益/成本 | 风险 |
|---|---|---|---|---|
| core fields | `name/type/desc/turn`（平铺，业务契约，25 文件 98 字段） | **保持 core 为字段语义唯一源**（SKILL_PROTOCOL_V4 §2.4.1 平铺命名是设计决策）；不合并 | — | — |
| 编排 fields | `fieldId/promptRole/valueType/pathInRawOutput/...`（数据面，137 字段，fieldId 点分嵌套） | **保持为路由/组装唯一源**；与 core 的关联靠"fieldId 前缀 ⊆ core name 前缀"约定（input-handoff-check.ts:13-19 已实现前缀匹配） | — | — |
| manifest promptContract.fields | 仅 2 文件用（goal-conversation.yaml:36、teaching-turn.yaml:37），direction/visibility/owner/export 三轴 | **降级为实验性，文档标注"信息与编排 promptRole 部分重叠"**；如继续用，只允许与编排字段无冲突的角色信息，禁止重复 desc/valueType | 收益：消除第三份字段声明；成本：低（2 文件） | 中。teaching-turn 的 control 字段 direction=output+handoff 与编排 control-signal 语义吻合，删除需确认无人消费（lint skill-prompt-contract.ts:378-417 有字段角色 lint，但非 fail-fast） |
| 缺 cross-check | **无任何脚本校验 core fields ↔ 编排 fields 一致性**（check-core-fields-sync 仅在设计文档 SKILL_EXPANSION_DESIGN.md:342） | 新增 `prompts:check-fields-sync`：core 顶层字段名 ⊆ 编排 fieldId 前缀集合；core type 与编排 valueType 按 §2.1 归一映射核对；desc 不比对（同字段两侧各写一份且文本已分歧：teaching.yaml:109 `伴学补强的对话回复` vs core peer-reinforcement.yaml:46 更长的生成指令，比对其价值低） | 收益：补上最大的漂移面（字段名/类型集合目前零机器核对）；成本：中（一个新脚本 + lint-prompts.ts 挂钩） | 低（warn 级起步） |
| 参数双写 | **core params{temperature,maxTokens} 与 manifest runtimeDefaults 重复**——实测 25/25 temperature 一致，**maxTokens 1 处漂移**：path-planning core=12000（path-planning.yaml:107）vs manifest=32000（path-planning.yaml:20） | 二选一收敛：runtimeDefaults 已有"frontmatter 优先"合并逻辑（routes/prompt-lab.ts:273-278），建议 **core 为源、manifest 为镜像**，加一致校验（与 failurePolicy cross-check 同批） | 收益：消除已发生的 1 处漂移与未来更多；成本：低 | 低。运行时实际取 ACTIVE prompt（resolve-llm-call-params.ts:119-131），core 编译产物 frontmatter 优先，漂移目前不影响运行但影响 admin 展示 |

### 3.2 元数据与版本行

| 项 | 现状 | 统一方案 | 收益/成本 | 风险 |
|---|---|---|---|---|
| stage/displayName/description | 编排 5/5 有（teaching.yaml:6-8）；manifest 有 name/description（从 agent-manifest 派生，seed-contract-helper.ts:14-20）；core 无 stage（设计使然 §2.4） | 不动；skills.yaml 落地后 mainline stage 与编排 stage 交叉校验（见 §6） | 0 | 低 |
| 版本行 | 三套：core `baseVersion`（25/25 = 1，整数）；manifest `version: prompt-lab-manifest/v1` + 嵌套 promptContract `skill-prompt-contract/v2` + runtimeContract `prompt-runtime-contract/v1`（版本号硬编码校验，lint 时不允许其他值）；编排**无版本**；lineage `field-lineage/v1` | 统一"文件头 `# 协议段` 约定"：每个家族头部 1 行注释声明所属协议 § 与版本锚点（core 已有，编排已有但措辞不一，manifest 缺失）；版本值不动（各自演进，避免牵动 DB metadata 兼容） | 成本：仅注释/文档 | 低 |
| 文件头 | 见 §5 | 见 §5 | | |

### 3.3 inputs / ref 引用规范

| 项 | 现状 | 统一方案 | 收益/成本 | 风险 |
|---|---|---|---|---|
| 三前缀 | core `skill:<skillId>.<field>` / `sandbox:<alias>.<key>` / `user:<path>`，parseInputRef 三正则（core-file-loader.ts:90-108） | 保持（SKILL_PROTOCOL_V4.md:79-91 已规范 + input-handoff-check 对账 + agent-snapshots.md 注册表，链路完整） | 0 | 低 |
| 编排 handoff | 目标词表见 §2.3 | 与 core skill: ref 的关系已有对账（input-handoff-check.ts:57-73 前缀匹配 + handoff 包含本 skill） | 0 | 低 |
| sandbox 简名 vs agentId | core 写阶段简名，注册表用 canonical agentId（SANDBOX_AGENT_ALIASES） | 别名表迁共享词表模块（与 §4 同批） | 低 | 低 |

---

## 4. 校验器统一方案

### 4.1 现状：四个校验器、三种诊断模型、五份重复白名单

| 校验器 | 文件:行 | 诊断模型 | 错误码风格 | 失败模式 |
|---|---|---|---|---|
| core-file-loader | core-file-loader.ts:184-371 | `CoreFileIssue{code,message}` + 三级诊断 read-error/yaml-parse-error/schema-error（:132-142） | kebab-case（`field-type-unknown`） | 收集全部问题，不阻断其他文件 |
| orchestration-file | orchestration-file.ts:156-208 | 无 issue 模型，throw Error 带 `[orchestration]` 前缀 | 自由文本 | fail-fast |
| bootstrap 语义 | field-routing-bootstrap.service.ts:76-109 | `string[]` + `[field-routing]` 前缀 | 自由文本 | fail-fast（模块加载即抛） |
| manifest 契约 | skill-prompt-contract.ts:304-435（lint）；runtime-contract.ts:176-215（normalize **静默回退**）；seed-core-agent-prompts.ts:98-160（throw-first） | `{level,code,field,message}`（lint）；无诊断（normalize）；throw（seed） | SCREAMING_SNAKE（`PROMPT_CONTRACT_ARCHETYPE_MISMATCH`） | 混合 |

重复白名单：CORE_FIELD_TYPES（core-file-loader.ts:26-34）与 skill-output-validator.ts:34 `VALID_TYPES`（同一词表两处）与编排 valueType 无表；failurePolicy 两表（§2.2）；PROMPT_ROLES 仅一处（好）；runtime 词表（CONTEXT_MODES/STATE_OWNERS/STATUS_VALUES，runtime-contract.ts:39-55）与 seed-core-agent-prompts.ts:103-159 硬编码三处重复；archetype 表在 skill-prompt-contract.ts:135-145 与 prompt-schema 侧另有一份。

### 4.2 统一方案（分两步，第一步低风险）

**第一步：共享词表模块 `backend/src/services/yaml-vocabulary.ts`（纯常量 + 纯函数，无 IO）**

导出（全部为现有值的迁移，不改任何值）：
- `FIELD_TYPES`（7 基元）、`typeSpellingNormalize()`（`T[]`⇔`array<T>` 归一 + `?` 后缀解析）——替换 core-file-loader.ts:26-34、skill-output-validator.ts:34、编排 valueType 校验（新增）
- `FAILURE_POLICY_CORE` / `FAILURE_POLICY_RUNTIME` + `coreToRuntimeFailurePolicy()` 映射——替换 core-file-loader.ts:36、skill-prompt-contract.ts:28-33，供新 cross-check
- `PROMPT_ROLES` / `RENDER_VALUES` / `VISIBILITY_PRESETS`——编排 loader 与 bootstrap 共用（orchestration-file.ts 保持 re-export 不破坏现有 import：rewrite-output-section.ts:22）
- `STAGE_NAMES` / `SANDBOX_AGENT_ALIASES`（从 agent-contract-view.ts:42-48 迁入，原文件 re-export）
- 通用助手 `asString/asBoolean/isRecord/pickOne`（现有 4 个文件各写一份）

**第二步：诊断模型统一（可选，成本中等）**

统一为 `{level: 'error'|'warning', code, field?, message}`（对齐 skill-prompt-contract.ts:84-89 已有模型）：
- orchestration-file 改为收集 issue 列表，fail-fast 仅保留在 bootstrap 装配层（现在 loader 抛错会连带 admin 编辑预检同一语义，validateOrchestrationContent:224-226 已是共用入口）
- `yaml-vocabulary.ts` 附带错误码常量（kebab-case 统一，逐步替换 SCREAMING_SNAKE 与 `[orchestration]` 前缀文本）
- 新 cross-check 脚本（failurePolicy 映射、fields-sync §3.1）直接产出同一诊断模型

---

## 5. 文件组织与头注释统一

### 5.1 现状差异

| 家族 | 头注释 | 版本锚点 | 说明 |
|---|---|---|---|
| core | `# v4 核心文件：<skillId>（SKILL_PROTOCOL_V4 §2）`（25/25 一致） | `baseVersion` | 头部最规范 |
| orchestration | `# <Stage> 阶段编排文件（字段路由单源化）` + 逐文件追加迁移/词汇批次注释（teaching.yaml:1-4 vs simulation.yaml:1-8 措辞不一） | 无 | 头部信息量大但格式自由 |
| manifest | **无头注释** | `version:` 首行 + 嵌套双版本 | 机器可读最好，人读性最差 |
| field-lineage | `# 字段血缘注册表（SKILL_PROTOCOL_V4 §7.2）` + 维护须知 | `version: field-lineage/v1` | 良好 |

### 5.2 统一"文件规范头"方案与成本收益

建议的规范头（三行，注释内，不参与解析）：
```
# <家族名>：<skillId|stage>（<协议> §<节>）——<一句话职责>
# 消费方：<加载器路径>；编辑入口：<谁改>；变更流程：<bootstrap/lint 命令>
# 词汇版本：<版本锚点>；漂移门禁：<检查命令>
```

- 收益：新成员（尤其 manifest 与未来 skills.yaml）一读即知"谁能改、改了去哪、谁守门"；与现有 SKILL_EXPANSION_DESIGN.md:96 对 skills.yaml 的消费方注释风格一致
- 成本：低——纯注释，28 个 manifest 文件机械加 3 行；**不做解析/校验**（避免头注释格式成为新的 fail-fast 面）
- 风险：低；建议本轮仅落 manifest + orchestration 两个家族（core 已达标），field-lineage 补消费方行

---

## 6. skills.yaml 落位（设计对照 SKILL_EXPANSION_DESIGN.md:61/80-171）

### 6.1 边界：哪些字段**应**进户口簿（现有 yaml 无承载）

| 字段 | 说明 | 现状承载 | 结论 |
|---|---|---|---|
| skillId | 全表唯一 + 跨家族一致性锚 | core/manifest/编排 contracts 三处重复 | **进入**，并做 4 方一致性校验（core + manifest + 编排 contracts + skills/index.ts），这是本文件最大增量价值 |
| kind | mainline/aux/handler-only | 无（v4-aux-skills META 有半套） | **进入** |
| handlerRef | 后端实现位置 | 无 | **进入** |
| coordinator.steps | definition.ts 挂接点登记 | 无（代码内） | **进入**（仅登记 + 校验，SKILL_EXPANSION_DESIGN.md:148-152） |
| dataSource / mcpTools / mcpToolBridges | 外部数据声明 | 无（mcp.json 是运行时资源，独立体系） | **进入**（mcpTools 与 config/mcp.json 交叉校验，:292） |
| stage | mainline 归属阶段 | 编排 stage（5 文件） | **进入**但**只做派生/交叉校验**：skills.yaml stage ∈ 编排文件 stage 集合（fail-fast），编排为真源 |

### 6.2 哪些**不应**迁移（避免第四份重复）

| 字段 | 留在哪 | 理由 |
|---|---|---|
| identity/rules/fields/params/constraints/channels/inputs | core | 业务要素，编译链唯一入口；SKILL_EXPANSION_DESIGN.md:69 已划界"户口簿不承载 prompt 文本" |
| temperature/maxTokens/failurePolicy | core params（真源）+ manifest runtimeDefaults（镜像，§3.1 补一致校验） | 已存在重复，**不得再加第三份** |
| promptContract/runtimeContract（含 failurePolicy 运行时词表） | manifest | 发布快照链路依赖（core-prompt-metadata.ts:52）；runtime 读 ACTIVE metadata |
| 字段路由语义（fields/routings/promptRole/handoff） | 编排文件 | 数据面唯一源，bootstrap 链路已成熟 |
| ownership{tier,visibility} | manifest | 契约层属性；**skills.yaml 不新增 ownership 段**（避免与 manifest 双写） |
| displayName/description（人设摘要） | manifest（派生自 agent-manifest） | 户口簿只记"在哪里"，不记"是什么" |
| aux META 表（displayName/category，v4-aux-skills/index.ts:160-169） | 代码内 META | 按 SKILL_EXPANSION_DESIGN.md:162 保留（承载 runAux 构建细节），户口簿只对 skillId 集合做一致性校验 |

### 6.3 风险提示（按 SKILL_EXPANSION_DESIGN.md:362 已有评估）

- skills.yaml ↔ manifest 归属双向 fail-fast（:141）会先暴露当前 acceptableAgentIds 的历史别名乱象（§2.4 发现），建议在户口簿上线前先清理重复项
- 户口簿与编排文件"mainline 必须同时出现在 contracts"铁律（:97/:169）与现状兼容度：编排 contracts 共 16 个 `skill:` 条目，其中 15 个有 core 文件（learner-model 无 core），即 25 个 core skill 中 10 个不在任何编排 contracts（generic-chat、skill-author、skill-compiler、basic-evaluator、course-design、goal-alignment-checker、semantic-freeze-judge、teaching-opening-generator、learner-progress-report、session-evaluation-fallback）——需在设计时确认"无 stage 的 mainline 不存在"这一不变量，否则铁律会误伤现状

---

## 7. 优先级推荐

### 本轮该做（低成本高确定性）

| # | 动作 | 成本 | 关联发现 |
|---|---|---|---|
| P0 | 抽 `yaml-vocabulary.ts` 共享词表模块（§4.2 第一步）：类型归一 + failurePolicy 映射 + PROMPT_ROLES/STAGE 别名 | 低 | 消除 3 份重复白名单 + 2 套类型拼写 + 2 套 failurePolicy 表 |
| P0 | lint-prompts.ts 增加 core↔manifest 交叉校验：failurePolicy 映射（warn）+ temperature/maxTokens 一致（warn） | 低 | path-planning maxTokens 1 处漂移（core 12000 vs manifest 32000）立即暴露 |
| P1 | 编排 valueType 接入词表白名单（裸 `array` 归一 `array<object>`，5 处） | 低 | simulation.yaml 5 处裸 array |
| P1 | visibilityPreset 白名单（2 值） | 低 | 80 处引用全部命中 |
| P1 | manifest acceptableAgentIds 去重（teaching-turn.yaml:10-13 等） | 低 | 字面重复项 |
| P1 | 头注释补齐：manifest 28 文件 + orchestration 统一措辞（§5.2，纯注释） | 低 | manifest 完全无头注释 |

### 下轮做（中等成本）

| # | 动作 | 成本 | 说明 |
|---|---|---|---|
| P2 | `prompts:check-fields-sync`：core fields ↔ 编排 fields 前缀/类型归一校验（warn 级） | 中 | 最大漂移面；与 SKILL_EXPANSION_DESIGN.md:342 check-core-fields-sync 设计重合，一并实现 |
| P2 | promptContract.fields 降级/清理（2 文件） | 中 | 需确认 goal-conversation/teaching-turn 运行时无人消费（lint 仅 warning） |
| P2 | 诊断模型统一第二步（编排 loader 改 issue 收集） | 中 | 纯内部重构，可再推后 |

### 保持独立合理（不做统一）

| 项 | 理由 |
|---|---|
| manifest promptContract/runtimeContract 词表 | 运行时契约语义自成体系，与业务词表正交；只做映射表不做合并 |
| 三家族"版本行"合并为单一版本 | 各自演化周期不同，合并会牵动 DB metadata 兼容（check-prompt-runtime-contract-metadata-parity.ts 对 version 值硬校验） |
| field-lineage 并入编排文件 | 血缘是运营视图（消费者/爆炸半径），与路由声明（字段流）受众不同；0 成本收益 |
| config/mcp.json / agent-catalog.json | 运行时资源与发布状态，独立体系（SKILL_EXPANSION_DESIGN.md:76 已决策）；仅 mcpTools 交叉校验待 skills.yaml 落地 |
| 编排文件与 core 文件合并 | 控制面/数据面分离是 SKILL_PROTOCOL_V4 §1.1 原则 3 的既有决策，动它 = 重做 bootstrap 与 drift 链路 |

---

## 附录：实测数据速查

- 词表实测：core 字段类型 98 处（含 7 种 + `?` 后缀 6 处）；inputs 73 ref（skill: 4 条——peer-reinforcement.yaml:25/29、stage-designer.yaml:13/21；sandbox: 67 条；user: 2 条——goal-conversation、peer-reinforcement.yaml:17）
- 编排：21 contracts / 137 fields / 197 routings；promptRole 7 值全覆盖；render 2 值；visibilityPreset 2 值；handoff 目标含阶段名（path/profile/teaching）与 agentId
- manifest：28 文件 14 顶层键恒定；promptContract.fields 仅 2 文件；failurePolicy 5 值中实际用 3 值（blocking/retry/deterministic-fallback），best-effort/none 零使用
- 跨家族一致性：25/25 failurePolicy 映射一致；25/25 temperature 一致；24/25 maxTokens 一致（path-planning 漂移）
