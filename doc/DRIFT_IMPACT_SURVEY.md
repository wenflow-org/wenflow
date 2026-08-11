# 偏移→运行时影响映射调查（DRIFT IMPACT SURVEY）

> 只读调查（不改代码）。回答一个问题：每类偏移在什么条件下**真正影响平台功能**、影响什么、影响多大。
> 供健康中心加"运行时影响"（impact）标注使用。
> 证据基准：2026-08-11 源码审计，全部精确到 file:line。

---

## 0. 根因总览：运行时消费路径的"同源不对称"

运行时实际读五类数据，**每一类的真源不同**：

| # | 运行时消费点 | 读什么 | 真源 | 证据 |
|---|---|---|---|---|
| R1 | ACTIVE prompt（systemPrompt 文本 + temperature/maxTokens 列） | DB `agent_prompts`（30s 缓存） | **台账** | `agentConfig.service.ts:216-257`；`prompt-composer.ts:126`；`seed-core-agent-prompts.ts:250-251`（参数列随 sync 固化） |
| R2 | runtimeContract / promptContract | ACTIVE `metadata.promptLab` 嵌套契约 → 回退 manifest → 回退 default | **台账 → 文件** | `resolve-runtime-contract.ts:58-81`；`resolve-prompt-contract.ts:66-89` |
| R3 | 字段路由（handoff/render/promptRole/pathInRawOutput） | DB 三表 `agent_field_routings`/`field_definitions`（30s 缓存） | **台账** | `field-dispatcher/index.ts:85-135` |
| R4 | 输出字段校验（P3） | **core 文件**（File-as-Truth，60s 缓存） | **声明** | `skill-output-validator.ts:191-212, 224-251`；`prompt-composer.ts:506-523` |
| R5 | 生成参数（temperature/maxTokens/failurePolicy） | ACTIVE prompt（override → ACTIVE → codeDefaults → route） | **台账** | `resolve-llm-call-params.ts:112-140`；`v4-aux-skills/index.ts:145-154` |

**核心不对称**：R1/R2/R3/R5 全部读**台账（DB）**，唯独 R4（输出校验）读**声明（core 文件）**。
这意味着：

- "声明新、台账旧"（W4、字段路由漂移、契约 mismatch）→ 运行时整体按**旧值自洽运行**，唯一"新"的东西是 R4 校验器 → **校验器会拿新规则拦截旧行为**（误报链）。
- "声明旧、台账新"（手改产物、admin 覆盖、DB 孤儿残留）→ 运行时按**新值跑，但任何文件声明都无法对账** → 不可观测。

所有偏移的影响分析都从这两个方向展开。

---

## 1. 逐类影响分析

### 1.1 W4 coreHash 漂移（core.yaml ↔ 产物 frontmatter ↔ DB ACTIVE 锚点）

**运行时读哪份**：DB ACTIVE（R1/R2/R5 全读旧值）；R4 读新 core 文件。

**行为分叉（按变更内容分类）**：

| 变更内容 | 运行时实际行为 | 影响 |
|---|---|---|
| prompt 文本措辞 | 新文案未上线，模型按旧 prompt 跑 | 无（变更静默未生效） |
| temperature / maxTokens | R5 按 ACTIVE 旧值（`resolve-llm-call-params.ts:112-140`，ACTIVE 优先） | 无（旧参数自洽） |
| failurePolicy | aux 失败策略按 ACTIVE metadata 旧值解析（`v4-aux-skills/index.ts:145-154`） | 低（旧策略自洽） |
| deltaOutput 开关 | goal-conversation delta 模式按 ACTIVE metadata 旧值（`goal-conversation/index.ts:560-568`） | 低-中（新旧轮次语义混跑风险） |
| **字段类型 / enum 词表 / 必填性** | **R4 校验器按新 core 声明**（`skill-output-validator.ts:98-121`）**校验按旧 prompt 产出的模型输出**（`prompt-composer.ts:506-523`）→ `type-mismatch`/`enum-out-of-range`/`missing-required` → 重试循环 → 超限硬失败（`prompt-composer.ts:510-523, 579-610`，errorCode=`_FAILED`） | **中-高**（详见下） |
| runtimeContract/promptContract 内容 | R2 按 ACTIVE metadata 旧契约：envelope/media/executionMode/contextMode 全按旧值（`resolve-runtime-contract.ts:58-81`） | 低-中（旧契约自洽） |

**"类型/词表变更未上线"的误报/漏报机制**（用户最关心的问题）：

- **误报方向**：新声明比旧声明严格（`array`→`object[]`/`string[]`、新增必填字段、enum 词表收窄）→ 旧 prompt 没告诉模型新形态，模型输出旧形态 → 校验器按新规则拦截 → 每轮重试都失败 → `maxAttempts` 后整次调用 FAIL（`prompt-composer.ts:579-610`）。**这是唯一一种"声明新运行旧"导致功能硬失败的情形**。
- **漏报方向**：新声明比旧声明宽松（删必填、类型放宽、词表扩宽）→ 旧输出必然通过 → 无影响（校验不产生收益，但也不破坏功能）。
- **实际案例**：2026-08-10 commit `276ff8d` 词表统一（10 个 core 文件 22 处 `array`→`object[]`/`string[]` + path-planning maxTokens 对齐）未跑 compile+sync → 2026-08-11 实测 W4 drift=10。若当时有生产调用，10 个 skill 的输出会被新校验器按新类型拦截（重试后失败）；实际因编译产物与 DB 一致（旧），P3 校验器是唯一"新"消费点。**该实例已被 `b928fb3`（2026-08-11）修复清零**。

**影响程度**：默认 **低**（多数 W4 只是"变更未上线"，运行时旧值自洽）；字段类型/词表/必填性变更 → **中**；变更字段位于核心交付路径（goal→path 交付字段、teaching 回合字段）→ **高**。

**影响对象**：全部 25 个 v4 skill 的 R1/R2/R4/R5 消费点；具体为 prompt 文本、生成参数、P3 校验、契约。

**症状（用户/运营可见）**：功能"莫名失败"（`_FAILED` 错误码、validation stage 失败、重试消耗）；admin 编排页顶部 "W4 漂移 N"；prompt_call_logs 中 validation_failed 堆积。

---

### 1.2 字段路由漂移（编排文件 ↔ DB 三表）

**运行时读哪份**：DB 三表（R3，`field-dispatcher/index.ts:85-135`，30s TTL）。

**逐字段运行时分叉**：

| 漂移字段 | 运行时后果 | 影响 |
|---|---|---|
| `pathInRawOutput` | 值抽取按 DB 旧路径（`field-dispatcher/index.ts:161-174` 路径不存在→跳过→skipped 记日志）；`field-routing-bootstrap.service.ts:475-477` 注释自述"会导致 assemble* 抽取静默跑偏" | 低-中（有回退链，见下） |
| `handoff` | 装配行集合按 DB 旧值（`assembleGoalHandoff` 只处理 handoff 含目标的行，`field-dispatcher/index.ts:190`；同理 stage-designer `:211`、teaching `:225`）→ 新目标（如新下游 skill）不装配 | 低-中 |
| `render`（visible/hidden） | supplement 文本按 DB 旧值渲染（`prompt-composer/index.ts:117-127` hidden 标签、`:176-192`）→ 模型被旧可见性契约约束 | 中 |
| `promptRole`（hard-required） | goal-conversation 压回判定按 DB 旧清单（`goal-conversation/index.ts:519-555` 缓存、`:663-671` 压回）→ 新必填字段不参与"thin 判定"，数据不齐也推进 proposing | 中 |
| `visibilityPreset` | 当前无独立运行时消费者（seed 语义校验 `field-routing-bootstrap.service.ts:100-105` 与 supplement 标签） | 低 |
| `displayName`/`description`（contract 维度，P4） | 运行时无消费者；仅 admin UI（`agent-contract-view.ts`）与展示 | 无-低 |

**回退链**（决定默认影响为低的机制）：
- goal→path：`assembleGoalHandoff` 失败/缺字段 → 回退 `visibleSummary`（`path.coordinator.ts:169-178` 逐字段 pick-fallback；`goal-conversation.service.ts:849-855` catch 兜底）→ 字段级回退，功能不炸。
- stage-designer：`learning.service.ts:2934-2940` 缺通道回退手拼 previousMilestone。
- teaching：`AITeachingCoordinator.ts:929-956` 缺通道回退既有组装。

**升级条件**（默认低 → 中/高）：
1. 新增字段/新增 handoff 目标未同步 → 该字段**完全**不进装配（回退链也没有它）→ 依赖新字段的下游功能静默缺失（中-高）；
2. `pathInRawOutput` 指向变更 → 抽到旧位置的值（错值，不是缺值）→ 回退链不会触发（值非 null），错数据进下游（中）；
3. `render`/`promptRole` 变更 → 模型契约/压回逻辑与声明背离（中）。

**影响对象**：goal→path 交付链（`field-dispatcher/index.ts:183-196` → `goal-conversation.service.ts:849-861` → `path.coordinator.ts:164-227`）、path 跨轮链（`learning.service.ts:2910-2943`）、teaching 回合链（`AITeachingCoordinator.ts:922-956`）、supplement（`prompt-composer/index.ts`）、hard-required（`goal-conversation/index.ts:519-555`）。

**已发生实例**：当前 0（2026-08-11 实测）；历史 2026-08-09 清理孤儿 24 字段 + 14 路由行（声明已删、DB 残留，清理前 grep 零消费）。

---

### 1.3 fields-sync 孤儿 / 缺项（core fields ↔ 编排产出行首段）

**运行时读哪份**：R3 读 DB 路由行；R4 读 core 文件。

**孤儿**（core 声明了、编排无路由 → DB 也不会有该行）：
- **运行时后果**：field-dispatcher 按 DB 行装配，该字段永远不在任何 handoff/抽取清单里 → **模型输出了该字段，但系统从不抽取、不落状态、不传给下游**（`field-dispatcher/index.ts:161-174` 只抽 pathInRawOutput 命中行；`:190/:211/:225` 只处理 handoff 命中行）。
- **数据静默丢失**：无报错、无用户可见症状，仅当字段恰好属于 handoff 命中行时才有 skipped 日志（`goal-conversation.service.ts:856-861`）。
- **影响**：**中**（数据缺失无声）；若该孤儿字段被 core `inputs ref` 引用为下游依赖 → **高**。
- **已发生实例（5 条 warn）**：path-planning `estimatedHours`/`estimatedWeeks`/`cognitiveDesign`（兼容镜像字段未路由，`check-core-fields-sync.ts:28-29`）；virtual-learner-scenario-designer `personaSeed`/`story`（core 输出未路由，仅 consistencyNotes 进路由）。**这些字段当前确实"模型产出了但平台丢弃"**——warn 级但属真实数据丢失。

**缺项**（编排有路由、core 无声明）：
- **运行时后果**：R4 校验器按 core fields 遍历（`skill-output-validator.ts:98-121`），该字段不在声明里 → **无类型/必填契约**，输出自由（校验盲区，`valueTypeMatches` 对未声明字段不检查）→ 低-中。
- **管理面**：skill-completion 的 `fields-synced` 档被阻断（`skill-completion.service.ts:164-166`，缺项>0 即不通过）→ workbench 状态降级（低，展示层）。

**类型不一致**（顶层直配字段）：同 W4 误报链——R4 按 core type 校验（`skill-output-validator.ts:45-64`），模型按旧产物行为 → 中（条件同 1.1 类型变更）。

**影响程度**：孤儿默认 **中**；缺项默认 **低**（校验盲区）；类型不一致 **中**（有条件）。

---

### 1.4 W1 ACTIVE 缺失

**运行时读哪份**：R1 读 DB ACTIVE；无 ACTIVE 行 → `agentConfigService.getActivePrompt` 返回 null（`agentConfig.service.ts:222-226`）。

**行为**：`requireActivePrompt=true` 且无 override 且 ACTIVE 无 systemPrompt → 硬失败 `<AGENT>_PROMPT_MISSING`（`prompt-composer.ts:228-266`，遥测 success=false，failureStage='prompt_resolution'）。`defaultSystemPrompt` 不救场（条件不看它）。涉及 20+ 个 LLM skill（`goal-conversation/index.ts:796`、`path-planning/index.ts:588`、`teaching-turn/index.ts:539,580`、`stage-designer/index.ts:172`、v4-aux 全部等）。

**影响程度**：**高**（调用即失败，用户可见）——但触发条件是"该 skill 被调用"，未被调用的缺 ACTIVE 无运行时影响。

**僵尸方向**（DB ACTIVE 有、户口簿无 / 僵尸技能残留）：
- 运行时照常执行（DB ACTIVE 存在，调用链完整）→ 无运行时影响；
- 僵尸技能（basic-evaluator/goal-alignment-checker/course-design，零调用）ACTIVE 残留 → 无影响（`skills-readiness.service.ts:43-44` 自述零调用）。

**已发生实例**：missingActive=0；zombieSkillActive=3（当前）。

---

### 1.5 W2 注册对账（户口簿 ↔ skill_registrations）

**运行时读哪份**：代码注册表 `skillHandlers`（`skills/index.ts:179-198` 静态对象，启动即定）+ gateway `SkillRegistry`（`gateway/registries/skill-registry.ts:66-103` register 内存注册 + `:224-241` loadFromDatabase 从 DB 重载）。

**missingRegistration**（户口簿有、DB 无）：
- 内存注册已生效（handler 在代码里），调用正常；
- DB 缺行只影响：gateway 侧匹配/统计、重启后 loadFromDatabase 不会补建（不覆盖已注册，`:228-235`）→ **低**（数据面缺，功能面正常）。`skills-readiness.service.ts:215` 自述"启动注册静默跳过"。

**zombieRegistration**（DB 有、户口簿无）：
- loadFromDatabase 把幽灵行**重新加载进内存**（`skill-registry.ts:224-241`）；
- 若代码 handler 已删 → 调用路径抛错：`Skill ${name} not found`（`gateway/index.ts:124-129`）或 `Skill handler not found`（`skills/index.ts:220-223`）→ **中**（调用才炸，平时静默）。

**影响程度**：missingRegistration **低**；zombieRegistration **中**（条件=该幽灵 skill 被调用）。

**已发生实例**：当前 0。

---

### 1.6 W3 接线（户口簿 coordinator 块 ↔ definition.ts steps）

**运行时读哪份**：coordinator `definition.ts` steps 是**运行时真相**（`coordinators/definitions-registry.ts`、goal/path/ai-teaching/simulation.definition.ts），W3 只是两处手写文档对账。

**bookWithoutStep**（户口簿登记未进 steps）：
- 若该 skill 真无其他调用点 → **coordinator 从不调用 → 功能缺失但无声**（中-高：平台"声称存在"的能力实际不存在）；
- 若 service 侧接线（W3_STEPS_EMPTY_EXEMPT 三例：adaptive-guidance-copy dashboard 调用、virtual-learner-persona/scenario-designer 前置配置阶段，`skills-readiness.service.ts:47-51`）→ 无影响。

**stepWithoutBook**（steps 引用不在户口簿）：
- 运行时照常调用（steps 是代码）→ 户口簿缺失只影响对账/统计 → **低**。

**影响程度**：bookWithoutStep **中**（功能静默缺失）；stepWithoutBook **低**。

**已发生实例**：当前 0。

---

### 1.7 契约 parity（manifest ↔ DB ACTIVE metadata.promptLab）

**运行时读哪份**：R2 优先 ACTIVE metadata（`resolve-runtime-contract.ts:58-81`；`resolve-prompt-contract.ts:66-89`）→ mismatch 时运行时按 **ACTIVE 旧契约**跑（声明新运行旧）。

**检查器与运行时的不对称（重要）**：检查器语义是"缺失即失败，不回退默认值"（`check-prompt-runtime-contract-metadata-parity.ts:390`）；而运行时 resolve 链有 manifest→default 回退（`resolve-runtime-contract.ts:88-122`；`resolve-prompt-contract.ts:96-135`）→ **检查失败 ≠ 运行时必然失败**：ACTIVE metadata 缺嵌套契约时，运行时静默回退 manifest 值（若 manifest 也是旧的，则按 manifest 旧值跑；检查器报 missing-metadata）。

**mismatch 时受影响的运行时维度**：

| 契约维度 | 运行时消费点 | 影响 |
|---|---|---|
| `output.media` | `defaultParseRawOutput` 按 media 决定 JSON 提取还是文本透传（`prompt-composer.ts:40-56`） | 中（解析行为按旧值） |
| `executionMode=code-only` | 运行时防线：拒绝进 LLM 链（`prompt-composer.ts:135-174`） | 中（防线按旧值） |
| `output.envelope` 不一致 | 运行时降级 warn、以 runtimeContract 为准（`prompt-composer.ts:177-181`） | 低 |
| `failurePolicy` | aux 失败策略（`v4-aux-skills/index.ts:145-154`） | 低-中 |
| `contextMode`/`terminalPhases`/`defaultPhase` | `buildDefaultEnvelope` 状态机映射（`prompt-composer.ts:87-106`） | 低-中 |

**影响程度**：默认 **低**（旧契约自洽）；media/executionMode/envelope 类变更 → **中**。

**已发生实例**：当前 25/25 in-sync。

---

### 1.8 快照漂移（agent-snapshots.md）

**运行时读哪份**：无——`generate-agent-snapshots.ts` 是纯文档产物，无任何运行时消费者。

**影响**：**none**（仅开发参考 + CI `prompts:snapshots:check` 门禁）；快照误导写 prompt 的人 = 间接影响（低）。

**已发生实例**：当前一致。

---

### 1.9 YAML 交叉校验 C1/C2（core params ↔ manifest runtimeDefaults/promptContract 双写）

**运行时读哪份**：R5 读 ACTIVE 编译值（`resolve-llm-call-params.ts:112-140` 的 temperature/maxTokens 来自 ACTIVE 行；failurePolicy 来自 ACTIVE metadata，`v4-aux-skills/index.ts:145-154`）。**manifest 不是运行时主源**，只在两种场景被读：
1. ACTIVE metadata 缺嵌套契约时作回退（`resolve-runtime-contract.ts:88-122`）——异常态；
2. prompt-lab 预览/发布 UI 展示（管理面）。

**C1/C2 不一致时**：
- 已 sync 场景（core 改、manifest 忘改）：运行时按**新 core 编译值**（正确），manifest 旧 → **UI/预览显示旧值**（低，展示错）；
- 未 sync 场景（W4 叠加）：运行时按旧 ACTIVE + manifest 旧 → 全链旧（低，同 1.1）；
- 异常态（ACTIVE metadata 缺契约）：运行时回退 manifest 旧值 → 用错值（低-中，罕见）。

**影响程度**：默认 **低**（展示层/回退链）；无运行时主路径影响。

**已发生实例**：当前 C1-C5 全过。

---

### 1.10 覆盖行（managedByCode=false）

**运行时读哪份**：R3 读 DB **全部行（含覆盖行）**（`field-dispatcher/index.ts:90-93` 无过滤）；漂移检测对覆盖行跳过（`field-routing-bootstrap.service.ts:450/:467/:494`）。

**影响**：admin 意图**运行时生效**（预期行为）。风险点：覆盖行无 owner/reason 元数据（`health-center.service.ts:548` 自述"覆盖是隐式的"）→ 代码升级后覆盖行旧值残留，与新版声明背离且**对账有意跳过** → 运行旧行为且声明看不到（中，条件=覆盖行内容已过时）。

**已发生实例**：当前 0 条。

---

## 2. 影响程度分级表

| 检查项（健康中心 id） | 默认影响 | 升级触发条件（→中/高） | 影响对象（file:line） | 症状（用户/运营可见） |
|---|---|---|---|---|
| `w4-corehash` | **低**（变更未上线，旧值自洽） | 字段类型/enum 词表/必填性变更 → 中；变更字段在核心交付路径 → 高 | R1/R2/R5 全部 skill（`agentConfig.service.ts:216-257`、`resolve-llm-call-params.ts:112-140`）；R4 校验（`skill-output-validator.ts:224-251`、`prompt-composer.ts:506-523`） | `_FAILED` 重试失败、validation_failed 堆积、页面 "W4 漂移 N" |
| `field-routing` | **低**（三条装配链都有回退：`path.coordinator.ts:169-178`、`learning.service.ts:2934-2940`、`AITeachingCoordinator.ts:929-956`） | 新增字段/handoff 目标未同步 → 中-高；pathInRawOutput 指向错 → 中；render/hard-required 变更 → 中 | goal→path（`field-dispatcher:183-196`→`goal-conversation.service.ts:849`→`path.coordinator.ts:164-227`）、stage-designer（`learning.service.ts:2910`）、teaching（`AITeachingCoordinator.ts:922`）、supplement（`prompt-composer/index.ts:117-127`）、hard-required（`goal-conversation/index.ts:519-555`） | 下游拿不到新字段、错值进下游、模型契约提示旧、proposing 提前推进 |
| `field-routing-contract`（P4） | **无-低**（displayName/description 无运行时消费者） | — | admin UI（`agent-contract-view.ts`） | 列表展示旧名/旧描述 |
| `fields-sync` 孤儿 | **中**（数据静默丢失，无报错） | 孤儿字段被 core `inputs ref` 引用为下游依赖 → 高 | 装配链全部（`field-dispatcher/index.ts:161-174` 只抽命中行） | 模型产出的字段不进状态/下游，无任何报错 |
| `fields-sync` 缺项 | **低**（R4 校验盲区） | — | R4（`skill-output-validator.ts:98-121`） | 无（校验缺失不可见）；workbench 完成度停在 core-ready（`skill-completion.service.ts:164-166`） |
| `w1-active` missingActive | **高**（调用即 `_PROMPT_MISSING` 硬失败，`prompt-composer.ts:228-266`） | 触发条件=该 skill 被调用 | 20+ 个 requireActivePrompt skill（goal-conversation/path-planning/teaching-turn/stage-designer/v4-aux…） | 用户对话直接报错，prompt_call_logs failureStage='prompt_resolution' |
| `w1-active` zombie | **无-低**（DB ACTIVE 照常执行；僵尸技能零调用） | — | 无 | 无 |
| `w2-registration` missingRegistration | **低**（内存注册生效，DB 缺行只影响统计/重启重载） | — | gateway registry（`skill-registry.ts:66-103`、`:224-241`） | 无 |
| `w2-registration` zombie | **中**（loadFromDatabase 重载幽灵行，调用才炸） | 触发条件=该幽灵 skill 被调用 | `gateway/index.ts:124-129`、`skills/index.ts:220-223` | 调用报 `Skill not found` |
| `w3-wiring` bookWithoutStep | **中**（coordinator 从不调 → 功能静默缺失） | 该 skill 无 service 侧接线 → 高 | coordinator definition steps（`coordinators/definitions-registry.ts`）；豁免三例 `skills-readiness.service.ts:47-51` | 平台声称有、实际无此能力，无任何日志 |
| `w3-wiring` stepWithoutBook | **低**（运行时照常调用，户口簿缺登记） | — | 无 | 无 |
| `contract-parity` | **低**（运行时按 ACTIVE 旧契约自洽） | media/executionMode/envelope 类变更 → 中；ACTIVE metadata 缺失时运行时静默回退 manifest（异常态）→ 中 | `prompt-composer.ts:40-56, 87-106, 135-174, 177-181`、`v4-aux-skills/index.ts:145-154`、`resolve-runtime-contract.ts:58-122` | 解析/防线/状态机按旧契约跑 |
| `snapshots` | **无**（纯文档） | — | 无运行时消费者（`generate-agent-snapshots.ts`） | CI 失败、文档过期 |
| `yaml-crosscheck` | **低**（UI/预览展示错；运行时回退链异常态才用 manifest 值） | — | prompt-lab 预览层、`resolve-runtime-contract.ts:88-122` 回退链 | UI 显示旧参数/旧失败策略 |
| `params-consistency`（P1 三写） | **低**（definition.ts 是展示权威；运行时参数源是 ACTIVE，不受 definition.ts 影响） | — | workbench 展示（`coordinators/definitions-registry.ts`） | UI 参数与 core 不一致 |
| `override-record` | **info**（admin 意图生效） | 覆盖行内容过时（代码升级后残留）→ 中 | R3 全消费链（`field-dispatcher/index.ts:90-93`） | 运行旧行为且声明看不到 |
| `runtime-prompt` | **观测项**（遥测） | promptDrift=true 出现 = W4 的运行时证据 → 跟随 W4 影响 | `prompt-composer.ts:272/:433/:545` 遥测写入 | 调用记录标注漂移 |

---

## 3. 两向对比："声明新运行旧" vs "声明旧运行新"

### 声明新运行旧（保守方向）——W4、字段路由（文件改 DB 未同步）、契约 mismatch、yaml、快照

- **共同机制**：运行时五条消费链全部读**旧台账**，行为整体自洽；"新"只出现在两处：文件本身（不被读）和 **R4 校验器**（被读）。
- **后果**：
  1. 变更未生效（静默）——占绝大多数，无用户影响；
  2. **R4 校验误报**——唯一硬失败路径（新类型/词表/必填规则拦旧行为输出）；
  3. 不可观测性低——文件 diff 可对、健康中心可查、可一键修复。
- **危险度**：**中**。大部分无害，但"类型/词表变更未上线"叠加"核心交付路径"时会导致功能失败，且失败形态（validation retry 耗尽）容易误导排障方向。

### 声明旧运行新（激进方向）——手改产物（frontmatter coreHash drift 反方向）、admin 覆盖行、DB 残留孤儿行、zombie registration、手改 DB

- **共同机制**：运行时按**新台账**跑，而任何文件声明都无法对账；检测器要么跳过（覆盖行），要么只报 warn（zombie），要么被豁免语义掩盖。
- **后果**：
  1. 手改产物 + sync DB → 新 prompt 上线但 core 声明旧 → R4 按旧 core 拦新输出（误报）或对新增字段不校验（盲区）——**校验/对账双向失灵**；
  2. admin 覆盖行 → 永久背离且对账有意跳过 → 无法区分"有意覆盖"与"意外残留"；
  3. 幽灵注册 → 调用才炸，平时不可见。
- **危险度**：**高**。不可观测、无回退、检测语义（豁免）反而掩盖问题。

### 结论

> **"声明旧运行新"更危险**：它让系统处于"任何声明都不是运行真相"的状态，检测器全部失明，只能靠运行时遥测事后发现。
> "声明新运行旧"是**可观测、可修复**的保守态，唯一真正危险的是 R4 校验器与新声明的错配——健康中心应针对这一条做自动影响计算（见 §5）。

---

## 4. 健康中心 impact schema 草案

在 `HealthCenterItem`（`health-center.service.ts:75-90`）上追加：

```ts
export interface HealthCenterImpact {
  /** 影响等级：none=无运行时影响 / low=自洽但变更未生效 / medium=功能偏差或数据丢失 / high=硬失败或功能整体缺失 */
  level: 'none' | 'low' | 'medium' | 'high';
  /** 触发升级的条件（静态可列，逐条命中即升级） */
  conditions: string[];
  /** 受影响对象（skill/阶段/数据流 + file:line） */
  affected: string[];
  /** 用户/运营可观察症状 */
  symptom: string;
  /** true=可自动计算（diff 可得）；false=静态标注 */
  auto: boolean;
}

export interface HealthCenterItem {
  // ...现有字段
  impact: HealthCenterImpact;
}
```

### 各检查项的 impact 取值与可自动性

| id | level（默认） | auto | 自动计算逻辑（diff 什么） |
|---|---|---|---|
| `w4-corehash` | low | **true** | diff core 文件 fields/params vs ACTIVE metadata.promptLab（或产物 frontmatter）：有**字段类型/enum 词表/必填性**差异 → medium；差异字段在核心 stage（goal/path/teaching 的 hard-required/pathInRawOutput 行）→ high；仅文本/temperature/maxTokens → low |
| `field-routing` | low | **true** | 按 drift item 的 field 分类：`displayName`/`description` → none；`pathInRawOutput` → medium（含错值风险）；`handoff` → medium（新增目标且目标字段无 DB 行 → high）；`render`/`promptRole` → medium；`valueType` → medium（同 W4 校验链） |
| `field-routing-contract` | none | 静态 | — |
| `fields-sync` 孤儿 | medium | **true** | 孤儿字段若被任一 core `inputs ref: skill:Y.F` 引用 → high（`input-handoff-check.ts` 逻辑可复用） |
| `fields-sync` 缺项 | low | 静态 | — |
| `w1-active` missingActive | high | 静态 | — |
| `w1-active` zombie | none | 静态 | — |
| `w2-registration` missingRegistration | low | 静态 | — |
| `w2-registration` zombie | medium | 静态 | — |
| `w3-wiring` bookWithoutStep | medium | 静态（豁免清单已知） | — |
| `w3-wiring` stepWithoutBook | low | 静态 | — |
| `contract-parity` | low | **true** | diff manifest vs ACTIVE metadata：media/executionMode/envelope/contextMode 差异 → medium；仅 description 类 → low |
| `snapshots` | none | 静态 | — |
| `yaml-crosscheck` | low | 静态 | — |
| `params-consistency` | low | 静态 | — |
| `override-record` | none（info） | 静态 | — |
| `runtime-prompt` | 观测项 | **true** | 遥测驱动：出现 promptDrift 记录时 impact 跟随对应 agent 的 W4 计算结果 |

**实现位置建议**：`health-center.service.ts` 的 `buildHealthCenterReport`（`:261-585`）中，w4 的 auto 计算可在 `w4Detail` 组装处（`:343-347`）增加 diff 逻辑（parityReport 已有 status；需补充"哪些字段变了"——可在 `analyzeCoreHashParity` 的 detail 中带出，或 health-center 内对 drifted agent 做一次 `loadCoreFile` vs ACTIVE metadata 比对）。

---

## 5. 健康中心分级修正建议

**核心原则**：severity 回答"**是否一致**"（现状已做），impact 回答"**不一致破坏什么**"（本次新增）。两者正交、合并展示：`severity` 决定红黄绿与修复按钮，`impact` 决定列表内排序与高亮。

1. **fields-sync 孤儿：severity=warn 但 impact=medium（数据静默丢失）——应提升展示优先级**。当前 `health-center.service.ts:471-497` 孤儿仅 warn，但 §1.3 证明它是"模型产出→系统丢弃"的真实数据丢失，且无任何日志。建议：孤儿条目前端加 impact 高亮，fixHint 从"可接受"改为"补路由或登记豁免，否则数据持续丢失"。

2. **W1 missingActive：severity=warn 但 impact=high（调用即 `_PROMPT_MISSING` 硬失败）**。当前 `health-center.service.ts:498-510` 是 warn；建议至少按 impact=high 排序置顶，并提示"该 skill 一被调用即失败"（区别于 zombie 方向的无影响 warn）。

3. **W4：severity=error 保留（一致性事实），但 impact 分级**——避免"W4 漂移 10"一律红色吓人。字段类型/词表变更（§1.1 误报链）→ impact=medium/high；纯文本/参数变更 → impact=low。**一键修复（`runHealthCenterFix` w4 分支，`:755-763`）前给出 impact 预览**："本次修复将上线：N 个字段类型变更 / M 个参数变更"，让运营判断修复时机（类型变更涉及模型行为，建议避开业务高峰；参数变更可立即修）。

4. **W2 zombieRegistration：impact=medium（loadFromDatabase 重载幽灵行，调用才炸）**——fixHint 补充"如该 skill 已无调用点可忽略"。

5. **W3 bookWithoutStep：impact=medium（功能静默缺失）**——这是最"无声"的一类：平台声称有、实际无。建议在 skill 目录页把 completion 的 `wired` 展示项（`skill-completion.service.ts:225`）与 impact 关联。

6. **snapshots / field-routing-contract：impact=none，UI 可折叠或灰色弱化**，避免与高影响项抢注意力。

7. **runtime-prompt（遥测）与 W4 打通**：出现 `promptDrift=true` 记录（`prompt-composer.ts:433/:545`）即"运行时证据"，impact 应自动跟随该 agent 的 W4 计算值——让健康中心"一致性检查"与"运行时观测"互相印证。

8. **contract-parity 的"检查失败 ≠ 运行时失败"差异要在文案中说明**（§1.7）：检查器不回退（`check-prompt-runtime-contract-metadata-parity.ts:390`），但运行时 resolve 链回退 manifest（`resolve-runtime-contract.ts:88-122`）——否则运营看到 contract-parity error 会误以为调用必然失败。

---

## 附录：证据索引（本调查引用的核心代码位置）

| 消费点/检查 | 文件:行 |
|---|---|
| ACTIVE prompt 读取 | `backend/src/services/agentConfig.service.ts:216-257` |
| runtimeContract 解析链 | `backend/src/services/prompt-lab/resolve-runtime-contract.ts:58-122` |
| promptContract 解析链 | `backend/src/services/prompt-lab/resolve-prompt-contract.ts:66-135` |
| 生成参数解析 | `backend/src/services/resolve-llm-call-params.ts:104-157` |
| 输出字段校验（P3） | `backend/src/services/skill-output-validator.ts:191-212, 224-251`；`prompt-composer.ts:504-523` |
| 路由表加载（DB，30s） | `backend/src/services/field-dispatcher/index.ts:85-135` |
| 值抽取/装配 | `field-dispatcher/index.ts:161-231` |
| supplement 渲染 | `backend/src/services/prompt-composer/index.ts:117-127, 176-192` |
| hard-required 压回 | `backend/src/skills/goal-conversation/index.ts:519-555, 663-671` |
| goal→path 装配 | `backend/src/services/learning/goal-conversation.service.ts:849-861`；`backend/src/coordinators/path.coordinator.ts:164-227, 276-280` |
| stage-designer 通道 | `backend/src/services/learning/learning.service.ts:2908-2943` |
| teaching 通道 | `backend/src/services/ai-teaching/AITeachingCoordinator.ts:920-956` |
| W1 硬失败 | `prompt-composer.ts:228-266` |
| W2 运行时注册 | `backend/src/gateway/registries/skill-registry.ts:66-103, 224-241`；`gateway/index.ts:124-129`；`skills/index.ts:220-223` |
| 失败策略运行时解析 | `backend/src/skills/v4-aux-skills/index.ts:127-154` |
| W4 对账 | `backend/src/scripts/check-core-hash-parity.ts:84-175` |
| 字段路由漂移检测 | `backend/src/services/field-routing-bootstrap.service.ts:433-514` |
| fields-sync | `backend/src/scripts/check-core-fields-sync.ts:144-249` |
| 契约 parity | `backend/src/scripts/check-prompt-runtime-contract-metadata-parity.ts:455-685` |
| yaml 交叉 | `backend/src/scripts/check-yaml-vocabulary.ts:68-192` |
| 健康中心聚合 | `backend/src/services/health-center.service.ts:261-585` |
| 完成度状态机 | `backend/src/services/skill-registry/skill-completion.service.ts:153-194` |
