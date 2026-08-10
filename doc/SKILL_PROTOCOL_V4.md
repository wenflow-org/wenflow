# 统一 Skill 协议 v4（规则文档）

> 版本：v4.0-draft
> v4.1-draft：新增数据面配置章节（§2.6 编排文件）
> 性质：规范性协议。本文件定义"什么是合法的"，不含迁移计划。实施顺序见附录 C。
> 取代关系：落地后取代 PROMPT_AUTHORING_PROTOCOL v2 中 LLM skill 部分；v2 继续约束 code-only skill 直至退役。
> 配套：archive/PROMPT_PROTOCOL_V4_DESIGN.md（设计推导，已归档）、PROMPT_PROTOCOL_V4_PREWORK_SURVEY.md（现状盘点）

## 1. 总则

### 1.1 四条基本原则

1. **核心文件是源代码，prompt 是编译产物。** 业务逻辑的唯一真相源（SSOT）是每个 skill 一份的 `core.yaml`；运行时 prompt 由编译链生成，人工不直接编辑线上 prompt。
2. **大模型是状态归约器（Reducer）。** 每次请求无状态：平台注入全量旧状态与新输入，模型计算当轮输出。模型不依赖历史消息维持状态；历史对话经 dialogue 池注入，仅用于语境理解。
3. **控制面与数据面分离。** 控制面 = 核心文件（运营编辑业务要素）；数据面 = 材料池组装、状态机流转、解析校验、状态合并（平台代码）。两面之间只经编译链连接。
4. **字段数据通过功能描述实现。** 字段表的功能描述列不是注释，是模型产出该字段内容的指令本身。

### 1.2 范围

- 本协议约束 **25 个 core skill**（15 个首批 + 9 个辅助 Skill（§5.6，v4-aux-skills 实际 handler 数）+ semantic-freeze-judge；清单见附录 A。**以 `prompts/core/` 实际文件数为准**（2026-08-09 复核：25 个 yaml 文件；此前 27 含 2 个已退役条目）。
- code-only skill（acceptance-evidence-evaluator、goal-understanding-composer、teaching-strategy-selector）豁免，不进入核心文件体系（handler-only 确定性组件，无 LLM prompt）。
- 无生产调用点的注册 skill（label-generator 等 11 个）维持现状，接入生产时必须先满足本协议。

## 2. 核心文件（core.yaml）

### 2.1 定位与存放

- 每个 LLM skill 一份，存放于 `prompts/core/<skillId>.yaml`，进 git，File-as-Truth。
- 核心文件只含**业务要素**。JSON 输出格式等包装指令由编译器全局注入（见 §4.3），禁止写入核心文件。

### 2.2 Schema（规范性定义）

```yaml
skillId: string              # 必填，与注册表一致
baseVersion: integer         # 必填，反向提取自哪个 prompt 版本；编译产物登记为 baseVersion+1 起
identity: string             # 必填，角色定位与能力边界，纯文本
channels: [池名, ...]        # 必填，§3 六池子集，至少一个
stateAdvance: boolean        # 可选，默认 false；为 true 表示执行规则中含 stage 推进时机描述
inputs:                      # 可选，输入契约声明（§2.5）；ref 前缀 = 来源分类（skill 上游产物 / sandbox 编排注入 / user 用户平台）
  - name: string             #   可选，输入别名（写 Prompt 时可引用的名字，全表唯一）
    type: string             #   可选，复用 §2.3 受控词表（+ `?` 可缺省）
    ref: string              #   必填，skill:<skillId>.<fieldPath> | sandbox:<agentId>.<key> | user:<path>
    desc: string             #   可选，用途说明（自文档化，编译进产物）
    note: string             #   可选，旧版用途说明（保留兼容）
rules: [string, ...]         # 必填，业务执行规则，有序数组，至少一条
fields:                      # 必填，输出字段表，至少一行
  - name: string             #   必填，camelCase 或 snake_case，全表唯一
    type: 受控类型           #   必填，见 §2.3
    desc: string             #   必填，功能描述（生成指令）
    turn: boolean            #   可选，默认 false；true = 当轮消费即弃
constraints: [string, ...]   # 必填，业务边界约束，可为空数组
params:                      # 必填，执行参数
  temperature: number        #   必填
  maxTokens: integer         #   必填
  failurePolicy: enum        #   必填，retry | fallback | propagate
examples: [string, ...]      # 可选，编译参考用例，不进字段表
outputMedia: enum            # 可选，json（默认）| markdown | text；决定 §4.3 注入条款分支
deltaOutput: boolean         # 可选，默认 false；试验性条款，见 §5.4（仅 outputMedia=json 时生效）
```

### 2.3 字段类型受控词表

`string | number | boolean | enum | object | object[] | string[]`

- `enum` 的可选值必须在 `desc` 中列明（如"holistic | detail | balanced"）。
- 后缀 `?` 表示可缺省（如 `object?`）；未标 `?` 的字段模型必须产出。
- 扩展新类型属结构变更，按 §7.2 受限级处理。
- YAML flow 写法（`{ ... }` 单行）中含方括号的类型必须加引号：`type: "string[]"`、`type: "object[]"`。

### 2.4 字段语义规则

1. **平铺命名**：字段名在 prompt 内部平铺使用（如 `surface_goal`）；组装成嵌套结构（如 `state.understanding.surface_goal`）是平台数据面的事，核心文件不声明嵌套。
2. **turn 标记**：`turn: true` 字段当轮消费后丢弃（reply/questions/quickReplies 类）；未标记字段默认由平台取走（累积进 state 或持久化）。
3. **平台字段禁出**：`success`、`quality`、`stage`、`raw` 等与 SkillResult/meta 碰撞的平台包装字段禁止出现在 fields 表（stage 推进以规则文字描述，由平台状态机仲裁）。注意：`debug` 不在禁出名单——部分 skill（如 virtual-learner 模拟器）的 debug 对象本身就是模型产出的业务字段，由字段表正常声明。
4. **残留输入注记**：skill 特有输入（放不进六池的配置物料，如 prompt-compiler 的 yaml 配置）在 rules 首条以"输入："前缀注记，不开输入侧字段表。

### 2.5 输入契约声明（inputs）

`inputs` 声明本 Skill 消费的输入。**ref 前缀 = 来源分类（kind）**，三分类正交于 §3 六池（内容轴）：

| 前缀 | 含义 | 运行时承载 | 对账 |
|---|---|---|---|
| `skill:<skillId>.<fieldPath>` | 上游 Skill 的**模型输出字段** | 编排层装配（handoff 交付） | 路由表 handoff 校验 |
| `sandbox:<agentId>.<key>` | **编排层注入**：确定性定帧/loopOver 上下文/状态池 | 编排代码（assemble 装配器） | 沙盘路径注册表（`prompts/agent-snapshots.md`） |
| `user:<path>` | **用户/平台注入**：对话消息、principal、运行时控制 | 执行信封（§3.2.4） | 绿灯（自文档化） |

- **编译**：确定性编译器把声明渲染进产物「使用通道」块的「输入契约声明」小节（含 name/type/desc 与来源标注；无声明则不渲染）。
- **对账（advisory→strict）**：保存/编译预览/发布时按 kind 分叉核对——`skill:` 与字段路由表（`agent_field_routings`）核对（上游路由行 fieldId 前缀匹配且 handoff 包含本 skill）；`sandbox:` 与沙盘路径注册表核对（`sandbox-path-unregistered`）；`user:` 直接通过。`prompts:check-handoff --strict` 提供 fail-fast 模式。
- **血缘**：`/core/:skillId/lineage` 返回静态注册表 ∪ 全仓 inputs 声明推导；血缘只推导 `skill:` 引用（sandbox/user 不参与 skill 血缘）。
- **沙盘说明书**：`prompts/agent-snapshots.md`（`npm run prompts:snapshots` 生成，纳入版本控制，CI 校验漂移）——写 Prompt 的人据此查阅各 Agent 的输入通道与合法沙盘键。
- **边界**：声明目前是文档化与对账用途，不改变运行时装配（orchestrator 仍按代码装配输入）；运行时装配声明化是后续 L2 议题。

**L2 落地注记（2026-08，配置式值流转）**：运行时装配声明化已开始落地——
- `field_definitions.pathInRawOutput`：字段值在产出方原始输出的物理抽取路径（goal 阶段 28 字段已登记）。
- `assembleGoalHandoff`（field-dispatcher）：按 routings 表 goal-agent 交付行 + pathInRawOutput 从 skill 输出抽取 goal→path 字段；`buildNormalizedInputV1`（path.coordinator）已正式切换为"handoff 字段优先 + visibleSummary 回退"（golden 等价验证）。
- 输入通道：teaching 回合 5 通道（learner.learnerProjection/knowledge.state/controls.teachingControlContext/classroomContext/visibleDialogueContext）已登记（teaching-agent 注入行）；stage-designer 的 milestones/previousMilestone/normalizedInput 通道已有等价验证。
- 治理：`prompts:check-handoff --strict`（inputs↔routings 双向对账）、`detectFieldRoutingDrift`（声明 vs DB 漂移启动 warn）、`validateFieldRoutingSeedSemantics`（handoff 白名单/组合语义 fail-fast）。

### 2.6 数据面配置（编排文件）

字段路由域（字段定义、agent 契约、路由矩阵）的**声明源**为 `prompts/orchestration/<stage>.yaml`（goal/path/teaching/profile/simulation 各一份，进 git，File-as-Truth）。本域属于 §1.1 原则 3 的**数据面**（运行时管线配置），与控制面（`prompts/core/*.yaml`，prompt 内容）经 bootstrap 编译链连接；编排文件**不修改 core.yaml 任何条款**，也不承载 prompt 文本。

#### Schema（规范性定义）

```yaml
stage: string                # 必填（loader 硬性），阶段名（goal/path/teaching/profile/simulation）
displayName: string          # 可选，阶段显示名
description: string          # 可选，阶段说明
contracts:                   # 约定必填（loader 对缺失宽容为 []），agent 契约清单
  - agentId: string          #   必填；displayName/description 由 agent-manifest 派生
fields:                      # 约定必填（loader 对缺失宽容为 []），字段定义表（fieldId 全 stage 唯一）
  - fieldId: string          #   必填
    promptRole: enum         #   必填，7 类：hard-required/soft-info/hidden-inference/public-reply/proposal-output/derived-presentation/control-signal
    valueType: string        #   必填，string/number/boolean/object/array<string> 等
    pathInRawOutput: string  #   可选，字段值在产出方原始输出中的物理抽取路径（点分）
    description: string      #   必填，字段含义
    systemLocked: boolean    #   可选，默认 false；系统锁（平台派生/需代码消费的字段，admin 创建与修改受限）
    structureLocked: boolean #   可选，默认 false；结构锁
routings:                    # 约定必填（loader 对缺失宽容为 []），路由矩阵（agentId × fieldId，键唯一）
  - agentId: string          #   必填，产出方 agent
    fieldId: string          #   必填，必须已在 fields 声明
    render: visible|hidden   #   必填
    handoff: [agentId, ...]  #   可选，默认 []=不转交；合法目标=阶段名或 manifest 中存在的 agent（skill:<id>/<stage>-agent），禁止自环
    internal: boolean        #   可选，默认 false；true=仅供 UI 消费（visible+internal 仅允许 control-signal 字段）
    accumulate: boolean      #   可选，默认 false；true=累积进 learner/state
    visibilityPreset: string #   可选，可见性预设
    notes: string            #   可选，备注
```

`promptRole` 7 类语义与字段表一致：hard-required（必出，代码消费）、soft-info（可选补充）、hidden-inference（隐式推断，prompt 不展示给前端）、public-reply（面向用户的当轮回复类）、proposal-output（收敛方案产出）、derived-presentation（派生展示，非模型直接产出）、control-signal（平台控制信号）。

#### 示例（goal.yaml 节选）

```yaml
stage: goal
displayName: Goal 阶段
description: 目标对话：澄清目标、收集背景、收敛到方向方案

contracts:
  - agentId: skill:goal-conversation
  - agentId: goal-agent

fields:
  - fieldId: understanding.surface_goal
    promptRole: hard-required
    valueType: string
    pathInRawOutput: internal.ext.goalConversation.understanding.surface_goal
    description: 用户最初表述的"想学什么"原话
    systemLocked: true
  - fieldId: userVisible
    promptRole: public-reply
    valueType: string
    pathInRawOutput: userVisible
    description: 给用户看的内容（适合 LLM 聊天 UI）

routings:
  - agentId: skill:goal-conversation
    fieldId: understanding.surface_goal
    render: visible
    handoff: [goal-agent]
    internal: false
    accumulate: true
    visibilityPreset: user-clarification
```

#### 派生链与校验

```text
prompts/orchestration/<stage>.yaml
  → loader（services/field-routing/orchestration-file.ts：解析 + 校验 promptRole/render 值域、fieldId 唯一、routing 引用字段必须在 fields 声明，fail-fast）
  → bootstrap 生成器（services/field-routing-bootstrap.service.ts：handoff 白名单/自环拒绝、组合语义校验）
  → DB 三表 field_definitions / agent_contracts / agent_field_routings
```

- **单源化**：seed-*-field-routings.ts 已退役（2026-08 单源化收尾），编排文件成为字段路由唯一声明源与唯一编辑入口；原 orchestration-parity 守护测试随 seed 一并退役。
- **变更流程**：改字段/路由 = 改编排文件 + 跑 bootstrap（`npm run prompts:bootstrap`，或等启动灌入）；admin 在线编辑后续收敛为同一链路。

## 3. 输入材料池（channels）

### 3.1 六池定义（平台统一定义一次，全 skill 共享同一 Schema）

| 池 | 内容 | 语义边界 |
|---|---|---|
| `dialogue` | 当前输入 userInput + 近期对话切片 [{role, text}] | 语境理解，不充当状态载体 |
| `state` | 平台维护的主记忆快照（上一轮合并结果，含 stage） | **当前值** |
| `task` | 当前任务/场景/控制指令 | 本轮要做什么 |
| `evidence` | 客观事实轨迹：课堂证据、知识变化、课后总结、运行统计 | **历史轨迹/事件**，只读追加 |
| `learner` | 学习者画像投影 | 长期特征 |
| `path` | 路径与确认方案上下文 | 目标结构 |

state 与 evidence 的分界：**当前值归 state，历史轨迹归 evidence**（知识看板当前掌握度=state，掌握度变化记录=evidence）。

### 3.2 注入规则

1. 核心文件 `channels` 声明哪个池，平台按标准 Schema 注入哪个；未声明不注入。
2. 嵌套输入对象按**子键**拆分入池（如 teaching-turn 的 `scenario.subject`→task、`scenario.pathTitle`→path），禁止整体挂入单一池。
3. 上游 skill 的 artifact 可作为下游 skill 的 evidence 材料（如 wrapup.progress → session-knowledge-distiller），evidence Schema 显式支持该形态。
4. 以下三类**不属于材料池**，由执行信封（options/context）承载：principal（userId/sessionId）、运行时控制（maxFormatRetries/frictionBudget/confirmProposal）、prompt 调试覆盖（systemPromptOverride）。
5. stage 的枚举、推进条件、terminal 判定由平台状态机（runtimeContract.businessState 的后继者）统一定义；核心文件 rules 只描述"何时该推进"的时机判断。

## 4. 编译链

### 4.1 编译产物结构（五块模板，唯一合法结构）

```markdown
---
agentId: skill:<skillId>
coreHash: <sha256>           # 核心文件内容哈希，漂移检测锚点
coreVersion: <integer>       # 编译自核心文件的版本号
temperature: <params.temperature>
maxTokens: <params.maxTokens>
---

## 身份
<identity>

## 使用通道
<channels 点名；stateAdvance=true 时 state 标注"（可推进）">

## 执行规则
<rules 按编号平铺>

## 输出字段
<fields 展开，每行：- name · type — desc（turn 字段尾部加"（当轮）"）>

## 边界约束
<constraints 逐条> + 编译器注入条款（见 §4.3）
```

frontmatter 只含执行参数与溯源锚点（agentId/coreHash/coreVersion/温度/maxTokens/failurePolicy），不再携带 promptContract.fields；字段唯一声明处 = 核心文件。

### 4.2 守门三查（编译产物发布前必须全过）

1. **结构合法（Lint）**：产物符合五块模板，字段表可解析，类型在受控词表内。
2. **字段冻结（Field Freeze）**：产物字段表与核心文件 fields 名/型逐一相等，编译器无权增删改。
3. **含义冻结（Semantic Freeze）**：功能描述与执行规则的业务语义与核心文件等价——规则检查 + LLM judge 双查。judge 判"等价"自动通过；判"不确定"转人工复核；判"不等价"拒绝发布。

LLM 编译器的权限被压至最低：只允许改写 prose 表达与排版，字段集合和字段含义只读。

### 4.3 编译器全局注入条款（写入产物的边界约束块）

- `outputMedia=json`（默认）："只输出一个 JSON 对象，字段名与输出字段表完全一致，不输出表外字段与解释文字。"
- `outputMedia=markdown|text`："直接输出最终交付内容本身，不要用 JSON 包装，不要附加解释、过程说明或多余标记。"
- 核心文件 `deltaOutput: true` 且为 JSON 输出时追加："仅输出本轮新增或需要修改的字段，未变化的字段请勿输出；需要清空某字段时输出 null。"

## 5. 运行时数据链路

### 5.1 标准链路

```text
routes/services/orchestrators
  → executeSkill（统一信封，见 §5.2）
  → 材料池组装（按 channels 注入，子键拆分）
  → callPrompt（LLM 调用 + format 重试）
  → 解析 → 按字段表校验 → 归一化
  → 平台组装：turn 字段→当次消费；非 turn 字段→Merge 进 state；平台仲裁 stage/meta
  → SkillResult 返回
```

### 5.2 统一调用信封

所有 skill 调用统一为：

```ts
executeSkill(definition, {
  input: { ...材料 },                    // 按 channels 归池后的业务输入
  context: { userId, sessionId },        // principal
  options: { maxFormatRetries?, systemPromptOverride?, ... }  // 运行时控制与调试
})
```

历史三种并存约定（扁平传参、`{input, context}` 包装、goal-conversation 以 `input` 键当用户输入字符串）在链路改造期统一收敛到本信封；skill 全部收敛回 executeSkill 入口，禁止绕过（adaptive-guidance-copy 的直连 handler 调用属违规存量，须整改）。

### 5.3 标准输出包裹（SkillResult）

模型只按字段表平铺产出 JSON；平台统一包装：

```ts
type SkillResult = {
  skillId: string
  quality: 'model' | 'fallback' | 'partial' | 'failed'
  raw: string                 // LLM 原始返回，仅调试可见
  artifact: { ... }           // 模型产出字段（turn 与 state 字段平铺于此）
  meta: {                     // 平台附加，模型不可见
    phase?: string            // 平台状态机仲裁后的当前阶段
    isTerminal?: boolean
    generatedAt: string
  }
}
```

### 5.4 状态合并与 Delta 试验条款

- **默认（全量写）**：模型每轮产出字段表声明的全部非 turn 字段，平台以产出整体覆盖旧 state 对应键。
- **试验（Delta 写，`deltaOutput: true`）**：模型仅产出变动字段；平台语义为"缺席=不变，null=清空，输出=覆盖（对象深合并、数组替换）"。该条款为**逐 skill 开启的试验性能力**。试点状态：goal-conversation 已开启并通过两轮真实模型验证（增量生效、合并正确、无格式重试）；当轮字段义务已在注入条款中显式豁免（"标注（当轮）的字段每轮必须输出"）。推广前须继续量测漏报变更率；数组当前一律替换，append 语义待证据后再议。

### 5.5 校验分级

- turn 字段：每轮必出，缺失即校验失败（驱动 format 重试）。
- 非 turn 字段（全量写模式）：按 `?` 标记校验必出性。
- 非 turn 字段（Delta 模式）：缺席合法，不驱动重试；类型错误仍失败。

**落地注记（2026-08，P3）**：字段声明契约校验已默认全量启用（`services/skill-output-validator.ts`，经 callPrompt 在 skill 领域校验后追加）：
- 规则：按核心文件 fields 声明校验——必填缺失（`missing-required`）/类型不匹配（`type-mismatch`，受控词表）/enum 越界（`enum-out-of-range`）；`?` 可缺省；delta 模式仅验类型（缺席合法）。
- 排除名单（14 个，与 `services/skill-output-validator.ts` 实际名单一致）：非 JSON 输出（generic-chat / skill-author；prompt-compiler 已退役不在名单）、平台守门（semantic-freeze-judge）、模拟器家族（virtual-learner-*，fallback/旁路特殊）、零调用或不可达（basic-evaluator / goal-alignment-checker 注册中零调用、concept-priority 已退役仅 manifest 残留、course-design 注册但生产不可达）。
- fields 声明即运行时校验契约：新增字段须标 `?` 或保证模型必出，否则会驱动重试（编辑分级 §7.1 的"新增字段受限级"同步生效）。

### 5.6 辅助 Skill（v4-aux-skills）调用约定与失败策略执行语义

遗留插件/旁路能力迁入的 9 个辅助 LLM Skill（`backend/src/skills/v4-aux-skills/index.ts`，AuxSkillId 枚举，2026-08-09 复核）与主 Skill 共用同一链路：`调用点 → executeSkill / executeSkillWithResult → aux handler → callPrompt → APIGateway`。handler 必须 `requireActivePrompt: true`。

1. **入口选择**：只要输出用 `executeSkill`；需要 `quality`/`debug`/`runtimeEnvelope`（区分 model/fallback、取 tokenUsage/model）用 `executeSkillWithResult`。
2. **保留字段**（handler 从输入对象剥离，不进入 user payload）：
   - `__prompt`：PromptCallContext 透传（`requestPath`/`userId`/`retryBudget`/`assistantMessages`/...），另支持 `callerAgentId`/`callerAction` 写入 gateway caller。
   - `__fallback`：LLM 失败时返回的降级输出；优先级高于 handler 内置降级。
   - `__onFailure`：`'throw' | 'fallback'`，覆盖 core 声明的默认策略（仅用于必须保持既有抛出契约的调用点，如 path-planning 的 goal-analysis）。
3. **失败策略执行语义**（handler 行为必须与 core `params.failurePolicy` 一致）：
   - `propagate`：失败抛错（经 executor 记录 failed span 后重抛），由调用方 try/catch 决定降级。
   - `fallback`：返回 `__fallback` 或内置确定性降级，结果标 `quality: 'fallback'`，不抛错。
   - `retry`：由 callPrompt 的 retryStrategy 与逻辑重试预算承载，handler 不重复实现。
4. **failurePolicy 双词表映射**（历史存量，唯一合法映射）：core 词表 → manifest 词表为 `propagate → blocking`、`fallback → deterministic`、`retry → retry`；两边一一对应，lint/parity 检查已硬约束。新文件不得创造第四种取值。
5. **平台层例外**：`semantic-freeze-judge` 是发布流水线的 Gate #3，由 `services/prompt-lab/semantic-freeze-judge.ts` 直调 `callPrompt`，不注册进 `skillHandlers`；这是唯一合法的业务外直调例外，新增例外须先修改本节。

## 6. 版本、发布与漂移检测

### 6.1 版本模型

- 现行 25 个核心文件（含 semantic-freeze-judge；以 `prompts/core/` 实际文件数为准）登记为基准 v1（baseVersion=1）。
- 每次编译发布产生新版本（agent_prompts 同 agentId 多行，version 递增，单 ACTIVE）。
- 编译产物行必须携带 `coreHash` 与 `coreVersion`（新增列）。
- **回滚 = 目标历史版本置 ACTIVE、其余置 ARCHIVED**，不需要重新编译。

### 6.2 漂移检测（分级执法）

- **发布/同步时**：coreHash 不匹配 → 严格阻断，要求回补核心文件后重新编译。
- **服务启动时**：coreHash 不匹配 → warn 并记录漂移清单，不阻断启动。
- **运行时**：不逐请求校验（保留紧急 hotfix 通道；hotfix 后必须回补核心文件并重新同步，否则下次发布被阻断）。

### 6.3 落点约定

coreHash 写入侧 = 编译发布流程（与 sourceHash 同批落库）；判定侧 = seed 同步的 metadata 结构化比较 + parity 脚本独立 coreHash 维度；lint 只做存在性/格式校验，不做漂移判定。

## 7. 编辑分级与血缘

### 7.1 编辑分级（对核心文件的全部修改按三级处理）

| 级别 | 内容 | 处理 |
|---|---|---|
| 安全 | 功能描述措辞、rules、constraints、temperature | 守门三查通过即可发布 |
| 受限 | 新增字段、枚举扩展、stage 推进时机规则、类型受控词表扩展 | 提示"暂无消费者，开发接入后生效"，须开发确认 |
| 阻断 | 字段改名、改型、删除 | parity 失败，必须开发同步修改消费者后方可发布 |

### 7.2 字段血缘

平台维护字段→消费者注册表（前端组件/API/后端 service），编辑受限/阻断级内容时以运营语言展示爆炸半径（例："字段 `quickReplies` 正被 Goal 页面前端读取"）。

## 8. 术语表

| 术语 | 定义 |
|---|---|
| 核心文件 | `prompts/core/<skillId>.yaml`，业务逻辑 SSOT，唯一人工编辑入口 |
| 编排文件 | `prompts/orchestration/<stage>.yaml`，字段路由域的声明源（§2.6，数据面配置） |
| 编译产物 / Runtime Prompt | 编译链生成的五块结构 prompt，模型唯一读取文本 |
| 材料池 | §3 定义的六类标准化输入 |
| 字段表 | 核心文件 fields / 产物"输出字段"块，三要素：名称·类型·功能描述 |
| 当轮字段 | `turn: true` 字段，当次消费即弃 |
| 守门三查 | 结构合法 + 字段冻结 + 含义冻结 |
| Delta 写 | 缺席=不变、null=清空、输出=覆盖 的增量输出模式（试验） |
| 基准 v1 | 现行 prompt 在版本体系中的登记身份 |

## 附录 A. 受约束 skill 清单（25 core + 3 code-only）

> 2026-08-09 复核：以 `prompts/core/` 实际文件数为准（25 个 yaml；此前声称 36/27，差额为已退役 skill 未同步）。

首批（15）：
conversational：goal-conversation、teaching-turn、virtual-learner-goal-dialogue-simulator、virtual-learner-learn-turn-simulator
generator：path-planning、stage-designer、virtual-learner-persona-designer、virtual-learner-scenario-designer
extractor：virtual-learner-actor-auditor、virtual-learner-path-evaluator、virtual-learner-referee
distiller：lesson-knowledge-enricher、session-wrapup
copywriter：adaptive-guidance-copy、peer-reinforcement

辅助 Skill（9，§5.6，v4-aux-skills index.ts 实际 handler 数；另有 concept-priority / path-adjustment-generator **已退役，仅 manifest 残留（2026-08）**，无 core.yaml，不计数）：
conversational：generic-chat
generator：course-design、teaching-opening-generator（~~concept-priority~~、~~path-adjustment-generator~~ 已退役，仅 manifest 残留（2026-08））
extractor：basic-evaluator、goal-alignment-checker、session-evaluation-fallback、skill-compiler
copywriter：learner-progress-report、skill-author

平台守门（1）：semantic-freeze-judge（extractor，thinkingMode=disabled；调用方式见 §5.6 平台层例外）

code-only（3，无 LLM prompt，handler-only 确定性组件）：
acceptance-evidence-evaluator、goal-understanding-composer、teaching-strategy-selector

> 退役注记（2026-07 调用调查）：label-generator、state-assessment、confidence-handler 因生产零调用/事件无发射者退役；text-structure-analyzer、retrieval、web-extractor、image-analyzer、memory-search、smart-search 六个无调用点组件一并退役。
> 退役注记（2026-07 调用碎片化治理）：session-knowledge-distiller 与 dialogue-concept-extractor 合并为 lesson-knowledge-enricher（同一事件消费者、输入高度重叠，单次 LLM 调用产出全部 5 个字段）。
> 退役注记（2026-08 清单收敛）：goal-profile-inference、learning-pattern-distiller、path-scene-framing、prompt-compiler、goal-analysis、basic-generator、generic-planner、basic-extractor、data-mapping、structured-output-parser 随 RETIRED_SKILLS 退役，附录 A 同步移除。
> 退役注记（2026-08-09 复核）：concept-priority、path-adjustment-generator 无 core.yaml、无 handler，仅 manifest 残留，一并退役。
> 退役注记（2026-08-10 名单单源化）：退役名单收敛至 `backend/src/skills/retired-skills.ts`（`PURGED_SKILLS` 35 项 = 启动 purge 语义；`ALL_RETIRED_SKILLS` 40 项 = 追加仅残留清理项 5 项），index.ts 与 `scripts/cleanup-retired-field-data.ts` 均自此派生，`retired:check` 门禁（`scripts/check-retired-skill-lists.ts`，已挂入 `prompts:check:all`）守卫"PURGED ⊆ ALL、名单 ∩ 注册集 = ∅、无 core/manifest 残留"三项不变量；basic-evaluator / goal-alignment-checker 为注册中零调用项（§5.6 aux），保留注册并移出清理名单（其 skill_model_configs 不可自愈），由门禁活跃守卫保护；goal-analysis 的 manifest 残留随本次单源化删除。

## 附录 B. goal-conversation 核心文件（参照样例）

```yaml
skillId: goal-conversation
baseVersion: 1
identity: |
  学习目标澄清助手。通过对话澄清学习目标，信息足够时收敛到第一版学习方向。
  不讲课，不展开路径正文。
channels: [dialogue, state]
stateAdvance: true
rules:
  - 依据 state 找缺口，每轮只补最必要的一条信息
  - userInput 与 state 冲突时以 userInput 为准
  - 用户连续补充同类细节时优先收敛，不细分追问
  - 真实问题、动机、背景、约束四类信息基本齐备 → 推进 proposing；用户确认方案 → ready
fields:
  - { name: reply, type: string, desc: 本轮回复，口语化，一次只问一个问题, turn: true }
  - { name: nextQuestions, type: "string[]", desc: 追问候选，不超过 3 条, turn: true }
  - { name: quickReplies, type: "object[]", desc: 快捷选项 {text, icon?}，不超过 4 个, turn: true }
  - { name: surface_goal, type: string, desc: 用户声称的目标，保留原话 }
  - { name: real_problem, type: string, desc: 穿透后的真实问题：为什么卡住、什么在阻塞进展 }
  - { name: motivation, type: string, desc: 为什么学、压力与具体痛点，联系真实场景，禁空话 }
  - { name: background_experience, type: "string[]", desc: 做过/试过/卡住的实际经历，禁抽象标签 }
  - { name: available_time, type: string, desc: 可投入时间，如"每周5小时" }
  - { name: current_level, type: string, desc: 自述水平与能力边界，禁"基础较弱"式标签 }
  - { name: thinking_style, type: enum, desc: holistic | detail | balanced }
  - { name: theory_vs_practice, type: enum, desc: theory-first | practice-first | balanced }
  - { name: confusion_pattern, type: string, desc: 易混淆的模式，无证据留空 }
  - { name: motivation_trigger, type: string, desc: 什么能维持其投入 }
  - { name: confirmedProposal, type: object?, desc: 确认后的方向 {learningDirection, firstDeliverable, keyStages[], outOfScope[]}；未确认不出现 }
constraints:
  - 无证据的字段留空，不编造、不夸大
params: { temperature: 0.7, maxTokens: 8000, failurePolicy: retry }
deltaOutput: true   # 试点
```

## 附录 C. 实施顺序（非规范性说明）

先数据链路，后逐 skill 跑通：

1. **链路改造（skill 无关）**：core 文件 loader、五块 lint、统一调用信封（§5.2）、SkillResult 包装收敛、coreHash/coreVersion 列与漂移检测、编译链（确定性模板渲染先行，LLM 润色后置）、字段血缘注册表。
2. **逐 skill 接入**（每个 skill 走同一流程：反向提取核心文件 → 编译 → 守门三查 → 影子运行对比 → 切流 → 验证消费者）：
    试点 goal-conversation（含 Delta 试验）→ teaching-turn → session-wrapup / peer-reinforcement → extractor/distiller/copywriter 家族 → virtual-learner 家族 → prompt-compiler 最后（它自身即编译器）。
