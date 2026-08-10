# Agent 技能扩充规范化方案设计（SKILL_EXPANSION_DESIGN）

> 版本：v1.0-draft（2026-08-10）
> 性质：设计文档。给出三条扩充路径（新增 skill / 字段拓展 / 外部数据引入）的目标设计，
> 以及 admin 可操作性的向导式入口。**本文件不含代码改动，落地按 §8 迁移路径分阶段进行。**
> 配套约束：不推翻既有单源化成果（编排文件 / 协议 v4.1 / 漂移门禁 / bootstrap 链路），新设计是其扩展；
> 保持控制面（`prompts/core/*.yaml`）与数据面（`prompts/orchestration/*.yaml`）分离原则。

---

## 1. 现状盘点（已确认事实）

### 1.1 新增 skill 的登记链（现状 6~7 处）

一个主链 LLM skill 从创建到可运行，需要同时触碰：

| # | 位置 | 内容 | 类型 |
|---|---|---|---|
| 1 | `prompts/core/<skillId>.yaml` | 人设 + 输出字段（控制面 SSOT） | 配置 |
| 2 | `backend/src/skills/<id>/index.ts` | handler（LLM 调用 + 解析 + 归一） | **代码（必写）** |
| 3 | `backend/src/skills/index.ts` | `allSkillDefinitions` + `skillHandlers` 手工注册 | 代码 |
| 4 | `backend/src/services/agent-manifest.service.ts` | `agentMembers`（父 Agent 归属）+ kind=skill 条目 | 代码 |
| 5 | `backend/src/coordinators/<stage>.definition.ts` | steps 引用 `skill:<id>`（managedByCode） | 代码 |
| 6 | `prompts/orchestration/<stage>.yaml` | contracts / fields / routings 三段 | 配置 |

主链 skill 无法纯配置新增——handler 必须写代码（现状成立，设计不改变这一边界，但把其余 5 处收敛为声明）。

skill 三分类现状：

- **主链**（进字段路由）：manifest 17 条中除 mcp-tool 外的 skill（goal-conversation、path-planning、teaching-turn、session-wrapup、peer-reinforcement、stage-designer、adaptive-guidance-copy、learner-model、lesson-knowledge-enricher、virtual-learner-×7）。
- **aux**（runAux 框架，不进路由）：`backend/src/skills/v4-aux-skills/index.ts` 的 META 表 9 个（generic-chat、course-design、skill-author、skill-compiler、basic-evaluator、goal-alignment-checker、teaching-opening-generator、session-evaluation-fallback、learner-progress-report），**不在 manifest 中**。
- **handler-only**（纯函数，无 LLM prompt）：acceptance-evidence-evaluator、goal-understanding-composer、teaching-strategy-selector、virtual-learner-shared 等，manifest 中仅 mcp-tool 带 `noPromptFile: true`，其余未登记。

### 1.2 字段拓展（现状双文件）

- 控制面：`core.yaml fields`（name/type/turn/desc）。
- 数据面：编排文件 `fields`（fieldId/promptRole/valueType/pathInRawOutput/锁）+ `routings`（render/handoff/internal/accumulate）。
- 流水线：`prompts:bootstrap` → `ensureStageFieldRoutings`（upsert `update:{}` 只建不更新）→ `detectFieldRoutingDrift`（只读 diff，managedByCode 行参与）。
- 痛点：core.yaml 加字段后，编排文件两段 + pathInRawOutput 需手工同步；无自动派生。

### 1.3 外部数据三通道（现状并存）

| 通道 | 现状 | 声明/注册 | 对账 |
|---|---|---|---|
| sandbox 注入 | 声明式：core.yaml `inputs[].ref: sandbox:<agentId>.<key>` | `SANDBOX_EXTRA_KEYS` 静态表（71 键，`backend/src/services/agent-contract-view.ts`）+ routings 推导键 | snapshots 生成 + `sandbox-path-unregistered` + `prompts:check-handoff --strict` |
| 代码直读 | handler 直接 `prisma.*` / `fetch` / axios 查库调 API | **无声明** | 无 |
| MCP 工具 | `config/mcp.json`（平台工具）+ `user_mcp_configs`（用户工具）+ `skills/mcp-tool`（handler-only 执行器） | 独立体系 | 工具级对账在 mcp 服务内部 |

### 1.4 admin 编辑入口（现状）

- `SkillDesignPage.vue`：core.yaml 编辑（试跑/调试闭环），按 skillId 进入。
- `FieldRoutingTable.vue`：「编排文件」弹窗，文本框直编 `<stage>.yaml`。
- 无"新增 skill"向导；无跨文件联动提示。

---

## 2. 目标架构：三层单源

```
┌─ 控制面  prompts/core/<skillId>.yaml        业务要素（人设/rules/fields）   [不变,扩展 children 约定]
├─ 户口层  prompts/skills.yaml   ★新增          skill 户口簿（身份/kind/归属/调用点/外部数据声明）
├─ 数据面  prompts/orchestration/<stage>.yaml  字段路由 + sandboxKeys(新增段)  [字段由生成器回填]
└─ 运行时  agent-manifest.service.ts / coordinators / skills/index.ts        [消费方;归属结构改为派生]
```

三层职责边界：

- **控制面**：只描述"这个 skill 是什么、产出什么"（业务要素）。
- **户口层**：只描述"这个 skill 在哪里"——kind / 归属 Agent / handler 位置 / 挂接的协调器步骤 / 外部数据声明。不承载 prompt 文本，不承载字段路由语义。
- **数据面**：只描述"字段怎么流"（路由矩阵、handoff、沙盘键）。不含 prompt 文本（现状已如此）。

三条原则（对齐协议 v4.1 §1.1 与现有单源化成果）：

1. **登记入口唯一**：新增 skill 的所有"非业务代码"登记动作，只在 `prompts/skills.yaml` 一处做；其余位置由生成器/派生机制保持同步，漂移由门禁拦截。
2. **控制面字段是数据面字段的唯一上游**：编排文件字段缺项时，由生成器从 core.yaml 回填默认值（§4），不回填已有行。
3. **运行时资源不伪声明**：MCP 工具是运行时资源（服务器/密钥/用户授权），保持独立体系；注册层只做交叉校验（§5.3），不把工具清单搬进编排文件。

---

## 3. 设计 A：注册链收敛——`prompts/skills.yaml`（skill 户口簿）

### 3.1 候选方案评估

| 候选 | 内容 | 评估 |
|---|---|---|
| a. 编排文件扩展 agents 段 | 每阶段文件登记下辖 skill（id/kind/handlerRef/aux 标记） | ✗ 否决。aux 与 handler-only 跨阶段（generic-chat 不属于任何 stage），5 个文件会出现"同 skill 多处登记或无处登记"，且字段路由文件承载身份登记违反"数据面只管字段流"的分层。 |
| b. 独立 `skills.yaml` 注册文件 | 跨阶段单一户口簿 | ✓ 采纳。天然容纳三种 kind；一处登记；与编排文件（数据面）正交。 |
| c. 维持 manifest + 生成器 | 注册信息留在 manifest，生成 definition.ts 步骤 | ✗ 否决为主案。manifest 是 TS 代码（非 admin 可编辑），生成器需解析/重写 TS 脆弱；且 manifest 只覆盖主链 skill（aux/handler-only 不在其中），收敛不彻底。 |

**决策：方案 b**——独立 `prompts/skills.yaml`，定位为"skill 户口簿"，进 git，File-as-Truth。

### 3.2 Schema（规范性定义）

```yaml
# prompts/skills.yaml —— skill 户口簿（注册链唯一声明源）
# 消费方：agent-manifest.service.ts（归属派生）、coordinator 校验器、skills:check 校验器、admin 向导
# 铁律：kind=mainline 的 skill 必须同时出现在对应 stage 编排文件 contracts 中（双向校验）
version: 1
skills:
  - skillId: goal-conversation                # 必填，kebab-case；与 core.yaml skillId 一致；全表唯一
    kind: mainline                            # 必填：mainline | aux | handler-only
    stage: goal                               # kind=mainline 必填；aux/handler-only 可省
    parentAgent: goal-agent                   # 可选；归属 Agent（派生 manifest agentMembers）
                                              #   省略 = 独立 skill（不挂任何 Agent 名下，如 mcp-tool）
    handlerRef: backend/src/skills/goal-conversation/index.ts   # 必填；加载时校验文件存在
    coreFile: prompts/core/goal-conversation.yaml              # mainline/aux 必填；handler-only 省略
    noPromptFile: false                       # 可选；handler-only 时自动为 true
    coordinator:                              # 可选；主链挂接点声明（§3.4）
      steps:
        - step: 1
          role: goal-clarification
          loopOver: conversation-rounds
          condition: until goal confirmed
    dataSource:                               # 可选；外部数据声明（§5.2）
      db: [ "learning_path", "user_mcp_configs" ]   # 直读的表/模型名
      api: [ "internal://learner-profile", "https://api.xxx.com/v1/..." ]  # 直调端点
    mcpTools: [ "web-search" ]                # 可选；声明引用的平台 MCP 工具（§5.3 交叉校验）
    mcpToolBridges:                           # 可选；工具结果 → 输出字段桥接（血缘/文档用途）
      - toolId: web-search
        outputFieldId: searchResult
```

校验规则（loader 硬性，fail-fast）：

- `skillId` 全表唯一；`kind` ∈ {mainline, aux, handler-only}。
- mainline：`stage` 必填且 ∈ {goal, path, teaching, profile, simulation}；`coreFile` 必填。
- handler-only：`coreFile` 禁填（语义冲突），自动置 `noPromptFile: true`。
- `parentAgent` 若填，必须存在于 agent-manifest 的 kind=agent 条目。
- `mcpTools` 校验见 §5.3。

### 3.3 与 agent-manifest.service.ts 的关系（Agent 层权威不变）

**维持"agent-manifest.service.ts 是运行时唯一真理源"不动摇**（大量运行时 import `getAgentManifest`），但归属结构（agentMembers 与 kind=skill 条目的存在性）改为**派生**：

- manifest 文件保留：agent 条目（name/description/监控组）、skill 条目的**属性数据**（name/description/defaultModelConfig/monitoringGroup/aliases/ioContractVersion）。
- manifest 文件移除：skill 条目的 `agentMembers` 手写列表（或保留但标注 deprecated 并接受一致性校验）。
- 派生规则（`skills:sync` 生成器 + 启动时幂等合并）：
  - `agentMembers[parentAgent] = skills.yaml 中 parentAgent 指向该 agent 的所有 skillId`；
  - skills.yaml 登记但 manifest 无属性条目的 skill：合成默认条目（name=skillId，告警级提示补属性）；
  - manifest 有条目但 skills.yaml 未登记的 skill：启动 fail-fast（孤儿登记不合法）。
- 门禁：`validateManifest` 扩展一项——`skills.yaml ↔ manifest 归属双向一致`，漂移 = fail-fast（与现有编排文件同档）。

> 此设计使新增主链/aux skill **不再需要手改 manifest**：归属从 `parentAgent` 字段自动派生。
> 代价是引入"skills.yaml 缺失时派生失效"的新故障面，用启动 fail-fast + 文件进 git 管控。

### 3.4 与 coordinators steps 的关系

- `definition.ts` 是代码（`managedByCode: true`），steps 的 loopOver/condition/variableGraph 含复杂编排语义，**不全量声明化**（声明化会迫使平台复刻编排语言，得不偿失）。
- skills.yaml 的 `coordinator.steps` 只做**挂接点登记**，三个用途：
  1. **一致性校验**（新 check）：`definitions-registry` 中每个步骤的 agentId 必须能在 skills.yaml 找到对应登记（含 kind=mainline 与 step/role 匹配）；反之 skills.yaml 登记的挂接点若在 definition.ts 不存在 → warn（可能已挂载到其他步骤，允许）。
  2. **向导生成骨架**：新增主链 skill 时，向导依据登记生成 definition.ts 的 steps 片段模板，人工粘贴到对应 coordinator（挂接逻辑仍是代码行为）。
  3. **admin 血缘展示**：编排拓扑图按 skills.yaml 登记绘制，不必解析 definition.ts。
- 新增主链 skill 的"挂接"动作 = 1 行登记 + 粘贴向导生成的 steps 片段（≤1 处代码改动，可被校验器兜底）。

### 3.5 与 `backend/src/skills/index.ts` 注册表的关系

- 现状：`allSkillDefinitions` 与 `skillHandlers` 是手工维护列表（两处）。
- 设计：`skills:sync` 生成器维护 `skills/index.ts` 中**结构化注册段**（`// ===== GENERATED from prompts/skills.yaml =====` 标记区）：
  - 生成 import 声明与注册行（definition/handler 的导入路径来自 `handlerRef` 同目录约定 `backend/src/skills/<id>/index.ts`）；
  - 生成器只替换标记区，不触碰业务代码；
  - 校验器（`skills:check`）检查标记区与 skills.yaml 一致性（skillId 集合 diff），漂移 = fail-fast。
- aux 同理：v4-aux-skills 的 META 表可保留（它承载 runAux 的构建细节），但 skillId 集合与 skills.yaml 的 aux 登记做一致性校验；向导生成 META 条目模板。

### 3.6 handler 存在性校验（加载时）

- `skills:check`（CI 与启动）逐条校验：
  1. `handlerRef` 文件存在（`backend/src/skills/<id>/index.ts`）；
  2. skills/index.ts 生成标记区含该 skillId（注册存在）；
  3. mainline：编排文件 contracts 含 `skill:<id>`（双向，见 §3.2 铁律）；
  4. coreFile 存在且 skillId 一致（`check-core-hash-parity` 现有链路继续生效）。
- 任一缺失 = fail-fast（新增 skill 未完成即被门禁拦截，而不是运行期 404）。

### 3.7 新增 skill 的最小动作集（纯配置 vs 写代码边界）

| kind | 必写代码 | 纯配置 | 生成器/向导产出 |
|---|---|---|---|
| mainline | 仅 `backend/src/skills/<id>/index.ts`（handler） | skills.yaml 1 条 + core.yaml | manifest 归属、skills/index.ts 注册段、coordinator steps 片段、编排文件 contracts + 字段回填（§4） |
| aux | 仅 handler（推荐 runAux 模板） | skills.yaml 1 条 + core.yaml | skills/index.ts 注册段、v4-aux META 模板 |
| handler-only | 仅 handler | skills.yaml 1 条 | skills/index.ts 注册段、noPromptFile 自动置位 |

边界结论：**代码边界 = handler 本体**；其余全部声明化 + 生成 + 校验。handler 的"必写"是本质约束（LLM 调用、解析、状态合并无法声明化），设计不试图消灭它，只保证它成为唯一手写点。

---

## 4. 设计 B：字段拓展生成器（core.yaml → 编排文件回填）

### 4.1 目标

core.yaml 加字段后，编排文件的 fields/routings 缺项由生成器自动回填；不改名、不删除、不覆盖已有行（与 bootstrap `update:{}` 语义一致，保护 admin 数据面编辑）。

### 4.2 控制面小扩展：object 字段 children 约定（可选，不迁移存量）

```yaml
fields:
  - name: understanding
    type: object
    desc: 累积的理解数据
    children:                      # 新增可选约定：object 字段的子字段声明
      - name: surface_goal
        type: string
        desc: 用户原始诉求锚点
      - name: real_problem
        type: string
        desc: 诊断结论
```

- 存量 core.yaml 不迁移（children 缺失 → 生成器只生成顶层 fieldId，子字段仍由人工在编排文件展开）。
- 新写 core.yaml 建议使用：children 使字段派生完全自动化（§4.4 路径规则依赖它）。
- 协议 v4.1 §2.4「平铺命名」不冲突：平铺是 prompt 内使用约定，children 是**数据面展开声明**，二者正交。

### 4.3 生成器行为（`npm run fields:sync -- --skill <skillId>`）

1. 读 core.yaml：展平字段树（含 children → 点分 fieldId）。
2. 从 skills.yaml 得 `stage` / `parentAgent` / `skillId`，定位编排文件。
3. 对比编排文件 fields（fieldId 集合）：
   - **缺失** → 追加 fields 条目（`# auto-synced from core.yaml` 注释标记）+ 默认 routings 条目；不回填已有行。
   - **存在但值不同** → 不动（数据面决策以编排文件为准），报告差异。
4. 默认值映射：

| 编排字段 | 默认 | 依据 |
|---|---|---|
| promptRole | `soft-info`（turn:true 的 string → `public-reply`） | core.yaml 可推导的最大信息；特殊语义由 admin 手改 |
| valueType | core.yaml type 直映（string/number/boolean/object/array<string>…） | 直映 |
| pathInRawOutput | §4.4 自动派生 | 派生 |
| description | core.yaml desc 首行 | 截断 ≤80 字 |
| routings.render | visible | 默认 |
| routings.handoff | [parentAgent] | 归属派生 |
| routings.accumulate / internal | false / false | 默认 |

5. 写回编排文件（稳定排序：按 core.yaml 顺序追加 + 注释分组），然后建议跑 `prompts:orchestration:sync` 灌入 DB。

### 4.4 pathInRawOutput 自动派生规则

- 现状：goal 阶段约定产出根 `internal.ext.<skillId>.<...>`（如 `internal.ext.goalConversation.understanding.surface_goal`）。
- 规则：`pathInRawOutput = internal.ext.<skillId>.<fieldId 点分>`；`userVisible`/`reply` 类（public-reply）→ 顶层 `userVisible`（若存在）或 `internal.core.*` 特例保持人工。
- 兜底：无 children 的 object 字段只生成顶层（`internal.ext.<skillId>.<name>`），其子路径不可自动推导，提示人工。

### 4.5 改名 / 删字段（blocked 级）

- **改名**：core.yaml 改名 → 生成器视为"旧字段缺失 + 新字段新增"，回填新字段、保留旧字段，并输出「疑似改名」提示；admin 需手动改编排文件（删旧 + 改 handoff 引用）。check 对"core 已删但编排仍存在"的字段给 warn（数据面字段删除影响历史数据，保持人工 + 显式确认）。
- **删字段**：core.yaml 删除后，编排文件字段成为孤儿 → check 报 warn；确需删除 = 手动改编排文件两段（routings 先行），生成器永不代删。
- 结构性变更（type 变更、children 树变化）同 blocked 级：只提示、不自动改。

### 4.6 双文件流程的最终形态（评估结论）

- **保留双文件**（不合并）：控制面/数据面分离是既有成果，合并会引入"同一字段两套语义"的耦合。
- **简化**：生成器回填（补缺项）+ 编排文件权威（定语义）+ 双向对账（新 check）三层替代现状的纯手工同步。
- 新增 check：`prompts:core:check` 扩展 `check-core-fields-sync`——core.yaml 展平字段集 vs 编排文件字段集 diff：缺 = warn（提示跑 fields:sync）、孤儿 = warn（提示人工删除）、命中 = 绿灯。

---

## 5. 设计 C：外部数据三通道统一

### 5.1 sandbox 注册表迁入编排文件（推荐路径落地）

- **决策**：`SANDBOX_EXTRA_KEYS` 静态表（71 键）迁入编排文件新增段 `sandboxKeys`（此前调查结论：stage 编排文件承载沙盘键注册——采纳）。

```yaml
# prompts/orchestration/goal.yaml 新增段（可选，缺失视为无额外键）
sandboxKeys:                    # 本 stage 编排状态池的合法 sandbox 键（agent-contract-view 数据源之一）
  - agentId: goal-agent
    key: collectedData.state
    type: object
    description: 当前理解状态、置信度与阶段
```

- 迁移：一次性脚本把静态表逐键写入 5 个编排文件对应 agentId 分组；agent-contract-view 改为"编排文件 sandboxKeys ∪ routings 推导键"（数据源切换，视图语义不变）；静态表退役（保留一个版本兼容读取后删除）。
- 对账链不变：snapshots 生成、`sandbox-path-unregistered`、`prompts:check-handoff --strict` 的沙盘侧校验自动指向新数据源。
- 收益：沙盘键注册从 TS 代码变为 admin 可编辑的声明文件（编排文件已有编辑弹窗）。

### 5.2 代码直读声明化（dataSource）

- **决策：文档化 + 校验（告警级），不做运行时强制**。理由：
  - handler 是任意代码，静态分析不可完备（间接层、动态 import），运行时强制会误杀合法调用；
  - 现有 20+ handler 全部无声明，一次性强制需全量迁移，成本不可接受；
  - 声明的核心价值是**可见性**（admin 知道 skill 用了哪些外部数据）与**审计**，不是阻断。
- 声明位置：skills.yaml `dataSource: { db: [...], api: [...] }`（§3.2）。
- 校验（`skills:check` 扩展，告警级）：
  - 扫描 handler 源码外部访问模式：`prisma\.[\w.]+\.(find|query|create|update|delete|aggregate)`、`.queryRaw`、`fetch(`、`axios`、`https?://`、`process.env.<KEY>`；
  - 未声明却被扫描到 → warn「handler 直读未声明」；
  - 已声明但扫描不到 → warn「声明无对应调用，疑似过期」。
- 可选演进（L2，不在本设计范围）：对声明 `strict: true` 的 skill 做运行时调用拦截（白名单校验），默认关闭。
- 迁移：扫描器先跑一遍产出声明初稿，人工确认后写入 skills.yaml。

### 5.3 MCP 桥接：保持独立体系 + 交叉校验

- **决策：不把 MCP 工具注册搬进编排文件/注册文件**。理由：
  - MCP 工具是**运行时资源**（服务器、密钥、用户授权），由 `config/mcp.json`（平台）+ `user_mcp_configs`（用户）承载；
  - 若搬进声明文件，会出现"声明 vs 运行时配置"双向漂移（工具启停、用户自定义工具不可静态枚举），违背 File-as-Truth 的可对账性；
  - `skills/mcp-tool` 已是 handler-only 执行器，保持"不产路由字段"的地位（工具输出任意结构，进不了字段路由）。
- 交叉校验（`skills:check` 新增，fail-fast 仅限平台工具）：
  - skills.yaml `mcpTools` 声明的 toolId 必须存在于 `config/mcp.json` tools（平台工具）——缺失 = fail-fast；
  - 用户自定义工具（user_mcp_configs）静态不可校验 → 声明中标注 `source: user` 时跳过存在性校验；
  - 扫描 handler 中 `executeMcpTool('toolId')` / `mcpGateway` 调用 vs 声明：未声明 → warn。
- 工具 → 输出字段桥接：运行时路径不变（宿主 skill 的 handler 归一工具结果为自身字段，经其字段表进路由）；skills.yaml `mcpToolBridges` 仅用于血缘展示与文档（§3.2），不改变运行时。
- 收益：三通道在注册层收敛为"一套声明 + 统一校验"，运行时各走各的管道（sandbox 装配 / 代码直读 / mcpGateway），互不干扰。

---

## 6. 设计 D：admin 向导式新增 skill

### 6.1 入口与表单

- 入口：SkillDesignPage 顶部「新建 Skill」按钮（或独立 `SkillWizard` 路由），复用现有编排文件弹窗的编辑组件。
- 表单（步骤 1：身份）：
  - skillId（kebab-case，实时校验唯一性：skills.yaml + manifest + `backend/src/skills/` 目录）；
  - kind（mainline / aux / handler-only，带语义说明）；
  - stage（mainline 时必选）；parentAgent（下拉，派生自 manifest kind=agent 条目）；
  - dataSource（可选，db/api 多行输入）；mcpTools（可选，从 mcp.json 平台工具下拉多选）。

### 6.2 后端脚手架（`POST /api/admin/skills/scaffold`，幂等）

1. 校验唯一性（上述三处）与 schema（§3.2 规则）；
2. 生成 `prompts/core/<skillId>.yaml` 骨架（skillId / identity 占位 / channels: [dialogue, state] / rules 占位 / fields: reply 示例 / params 默认 / 含 §4.2 children 注释模板）；
3. 追加 `prompts/skills.yaml` 条目（kind/stage/parentAgent/dataSource/mcpTools 按表单）；
4. mainline：追加编排文件 contracts（`skill:<id>`），提示运行 `fields:sync` 回填字段；
5. 返回：handler 骨架模板（index.ts：PromptCallSpec + handler 骨架，主链/aux/handler-only 三模板）+ skills/index.ts 注册片段 + v4-aux META 模板（aux）+ 完成度清单。

### 6.3 完成度状态机（admin 可见 checklist）

```
draft（scaffold 生成）
  → handler 就绪（index.ts 存在 + skills/index.ts 标记区含注册）          [校验器检测]
  → core 完善（core.yaml fields ≥ 1 且通过 core:check）                  [校验器检测]
  → 字段回填（fields:sync 已跑：编排文件无 core 缺项）                    [check-core-fields-sync]
  → live（进入漂移门禁：skills:check / prompts:check:all 全绿）
```

SkillDesignPage 状态条复用现有 drift/health 语言，逐项打勾，未完成项给出跳转/命令提示。

---

## 7. 文件/校验改动点清单（落地范围）

| 层 | 新增 | 修改 | 退役 |
|---|---|---|---|
| 户口层 | `prompts/skills.yaml`（首次由脚本从 manifest+skills/index.ts 提取生成） | — | — |
| 控制面 | — | core.yaml 协议 §2.2 增加可选 `children`（文档）；不迁移存量 | — |
| 数据面 | 编排文件 5 份新增 `sandboxKeys` 段（脚本迁入） | 编排文件 fields/routings 由生成器回填（带 auto-synced 注释） | — |
| 后端 | `skills:sync` 生成器；`fields:sync` 生成器；`skills:check` 校验器；`check-core-fields-sync`；admin `POST /scaffold` | agent-manifest.service.ts（agentMembers 派生 + validateManifest 扩展）；agent-contract-view.ts（数据源切编排文件）；skills/index.ts 标记区；v4-aux-skills（一致性校验） | `SANDBOX_EXTRA_KEYS`（兼容读取一版后删除） |
| 前端 | SkillWizard（或 SkillDesignPage 内嵌） | SkillDesignPage 完成度 checklist；FieldRoutingTable 弹窗支持 sandboxKeys 段 | — |
| 门禁 | `prompts:check:all` 并入 skills:check / check-core-fields-sync | validateManifest 增加 skills.yaml 双向一致性 | — |

---

## 8. 迁移路径（分阶段，每阶段独立可回滚）

| 阶段 | 内容 | 验证 |
|---|---|---|
| P1 户口层 | 脚本提取现有 30 个 skill（manifest 17 + aux 9 + handler-only/mcp-tool 4）生成 skills.yaml 初稿 → 手工补 parentAgent/kind 审阅 → skills:sync 生成器 + validateManifest 扩展上线 | skills:check 全绿；manifest 派生 agentMembers 与现有一致（diff 为空） |
| P2 字段生成器 | core.yaml children 约定文档化 → fields:sync + check-core-fields-sync 上线（只读阶段先跑 check，再开放写回） | 对 5 个 stage 全量 check：goal 28 字段零误报后开放写回 |
| P3 sandbox 迁移 | 71 键迁入编排文件 sandboxKeys → agent-contract-view 切换数据源 → 静态表兼容读取期（一版）后删除 | prompts:snapshots:check 与迁移前 diff 为空 |
| P4 外部数据声明 | dataSource/mcpTools 扫描器出初稿 → 人工确认写入 skills.yaml → 校验器上线（warn 级） | 扫描报告人工复核；warn 清零或白名单 |
| P5 admin 向导 | scaffold 接口 + SkillWizard + 完成度状态机 | 用向导新建一个测试 aux skill 全流程走通 |

---

## 9. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| skills.yaml 与 manifest 派生双源漂移（生成器未跑/人工误改） | 高 | validateManifest fail-fast + CI 门禁；skills.yaml 进 git；生成器幂等 |
| 生成器回填覆盖 admin 数据面编辑 | 中 | 严格"只建不更新"；已有行永不回填；漂移报告明示差异（复用 detectFieldRoutingDrift 机制） |
| children 约定不迁移存量，老 core.yaml 派生不完整 | 低 | 顶层字段兜底 + 提示人工；不阻断存量 |
| MCP 用户自定义工具静态不可校验 | 低 | 只对平台工具 fail-fast；`source: user` 跳过存在性校验 |
| 直读扫描器误报/漏报 | 低 | warn 级（不进 fail-fast）；人工确认清单；未来可选 strict 白名单 |
| handler 目录约定被破坏（<id>/index.ts 变异构） | 低 | handlerRef 显式声明路径，不依赖约定 |
| 向导生成的 handler 骨架与现有协议 v4.1 编译链脱节 | 中 | 骨架直接复用 runAux/PromptCallSpec 既有模板；scaffold 输出过 core:check |

---

## 10. 最小动作集对比表（现状 vs 设计后）

| 操作 | 现状 | 设计后 | 设计后仍需写代码 |
|---|---|---|---|
| 新增主链 skill | 6~7 处：core.yaml、handler、skills/index.ts×2、manifest（agentMembers+条目）、coordinator definition、编排文件 contracts/fields/routings | 3 步：skills.yaml 1 条 + core.yaml + handler；向导生成其余（manifest 归属、注册段、steps 片段、字段回填） | 仅 handler |
| 新增 aux skill | 4 处：core.yaml、handler、v4-aux-skills（META+handler）、manifest（视需要） | 2 步：skills.yaml 1 条 + core.yaml + handler（向导生成注册与 META 模板） | 仅 handler（runAux 模板） |
| 新增 handler-only | 3 处：handler、skills/index.ts、manifest（noPromptFile） | 2 步：skills.yaml 1 条 + handler（noPromptFile 自动） | 仅 handler |
| 加字段 | 2 文件 3 段手工：core.yaml fields + 编排 fields + routings + pathInRawOutput 手写 | core.yaml 1 行（children 可选）+ `fields:sync` 自动回填默认值/路径 | 0 |
| 改名/删字段 | 双文件手动，无门禁 | blocked 级：生成器拒绝代改；check 提示 + 人工显式处理 | 0 |
| 外部数据（sandbox 键注册） | 改 TS 静态表（非 admin） | 改编排文件 sandboxKeys（admin 弹窗可编辑） | 0 |
| 外部数据（代码直读/MCP） | 无声明、无对账 | skills.yaml dataSource/mcpTools 声明 + 校验（warn/fail-fast 分档） | 0 |

---

## 附：与现有成果的关系说明

- **编排文件单源化（§2.6 / 协议 v4.1）**：不动摇；skills.yaml 与 sandboxKeys 是其扩展（新增段与新增顶层文件），字段路由链路（loader → bootstrap → DB → drift）零改动。
- **控制面/数据面分离**：core.yaml 仍不承载路由语义；children 是控制面字段声明扩展，数据面语义（promptRole/handoff/accumulate）仍在编排文件。
- **漂移门禁（detectFieldRoutingDrift / check-core-hash-parity / snapshots check）**：全部保留；新增 skills:check 与 check-core-fields-sync 与之并列，同一等级（CI fail-fast，warn 分级按既有约定）。
- **agent-manifest.service.ts 运行时权威**：保留；归属结构改派生后，运行时行为不变（agentMembers 内容与现状一致），仅来源变化。
