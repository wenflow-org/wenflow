# skills.yaml 技能户口簿 —— 可实施规格（SKILLS_YAML_SPEC）

> 版本：v1.0-draft（2026-08-10）
> 性质：**可实施规格**。把 `doc/SKILL_EXPANSION_DESIGN.md`（目标架构）细化为实现级约束：schema 规范性定义、生成器/校验器接口签名、迁移映射、admin 向导契约、风险与回滚。**本文件不含代码改动。**
> 前置证据：`SKILL_DIAGNOSTICS_SURVEY.md`（错误分层）、`SKILL_LIFECYCLE_SURVEY.md`（注册链 7+ 处）、`RETIRED_SKILLS_FIX_PLAN.md`（退役名单单源）、`SKILL_PROTOCOL_V4.md`（协议 v4.1 §2.6 编排文件风格参照）。
> 已确认决策（前置）：① 独立 `prompts/skills.yaml` 为跨阶段技能注册唯一声明源；② manifest `agentMembers` 改由 `parentAgent` 派生；③ coordinator steps 只做挂接点校验（不全量声明化）；④ 错误语义分层：声明类 fail-fast / 注册类 readiness warn / 接线缺失 warn / 完成度进 workbench-meta；⑤ 退役名单单源化 `retired-skills.ts`（PURGE=35 / ALL=42）。

---

## 1. skills.yaml Schema（规范性）

### 1.1 顶层结构决策：平铺 `skills:` 列表 + `kind` 字段（否决分节）

| 候选 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **平铺 + kind 字段** | schema 校验逻辑只有一份；新增 kind 不需改顶层结构；向导追加一行自然；与 core.yaml 提取脚本（按文件遍历）对齐 | 视觉上三类混排 | **采纳**（与 SKILL_EXPANSION_DESIGN §3.2 草案一致） |
| 分节（`mainline:` / `aux:` / `handler-only:` 三段） | 视觉分组 | kind 已内嵌 → 双重复述，两处都可能错；跨类唯一性/互斥校验需先合并列表；新增第四种 kind 要改顶层 schema | 否决 |

分组视觉由文件内注释段承担（§1.5 示例），校验一律作用在平铺后的单一 `skills[]` 上。

### 1.2 顶层结构（规范性定义）

```yaml
version: integer        # 必填（loader 硬性），当前=1；schema 变更时递增
skills:                 # 必填，活跃 skill 条目（平铺列表；retired 条目不在此处）
  - skillId: string
    kind: enum          # mainline | aux | handler-only
    # ...（条目字段见 §1.3）
retired:                # 可选，退役镜像段（§1.4；仅展示用，与 retired-skills.ts 强一致校验）
  - skillId: string
    reason: string
    scope: enum         # purge | residue   （对应 RETIRED_SKILLS_PURGE / RETIRED_SKILLS_ALL 之差集）
```

### 1.3 条目字段（逐字段：必填/可选、值域、来源）

| 字段 | 必填 | 值域 / 格式 | 来源 | 说明 |
|---|---|---|---|---|
| `skillId` | 必填 | kebab-case，与 `prompts/core/<id>.yaml` 头部一致；全表唯一 | **手写** | 身份主键；校验器查唯一性 + 与 core.yaml 一致性 |
| `kind` | 必填 | `mainline` \| `aux` \| `handler-only` | **手写** | 三分类语义见 SKILL_EXPANSION_DESIGN §1.1 |
| `stage` | mainline 必填；aux/handler-only 可省 | ∈ {goal, path, teaching, profile, simulation}（与 `prompts/orchestration/<stage>.yaml` 文件名一一对应） | **手写** | 主链归属阶段；`fields:sync` 据此定位编排文件 |
| `parentAgent` | 可选 | ∈ manifest kind=agent 条目 id（goal-agent / path-agent / teaching-agent / profile-agent / simulation-agent） | **手写** | **派生 manifest `agentMembers` 的唯一来源**；省略 = 独立 skill（如 mcp-tool）；校验器查存在性（F4） |
| `handlerRef` | 必填 | 仓库相对路径；约定 `backend/src/skills/<id>/index.ts`（显式声明路径，不依赖约定） | **手写** | 加载时 fs 检查存在 + 导出存在（F5）；handler-only 亦必填（纯函数模块） |
| `registrationPoint` | 可选 | `skillHandlers`（默认，按 kind 推导）\| `agents`（learner-model 例外）\| `platform-direct`（semantic-freeze-judge 例外）\| `none` | 手写（仅例外显式） | 注册存在性校验（F12）的查表分派；默认规则：mainline/aux/handler-only → `skillHandlers` |
| `coreFile` | mainline/aux 必填；handler-only **禁填** | 相对路径 `prompts/core/<skillId>.yaml` | 手写（约定可推导） | 存在性 + 文件内 skillId 一致性（F6）；禁填语义冲突（F7） |
| `noPromptFile` | 可选 | boolean；默认 false | **派生**（handler-only 强制 true；mainline/aux 显式 true = 语义冲突 fail-fast F7） | 与 manifest 同名豁免标志同步（manifest 侧可删除该标志，改由派生携带） |
| `platformGate` | 可选 | boolean；默认 false | 手写（仅 semantic-freeze-judge） | true = 平台守门直调（协议 v4 §5.6 平台层例外），豁免 handler 注册检查；新增例外须先改协议 §5.6 |
| `displayName` | 可选 | 非空字符串；缺省 = skillId | **手写** | 派生 manifest `name`（skill 条目）；aux/handler-only 首次获得统一展示元数据 |
| `description` | 可选 | 非空字符串；缺省 = displayName | **手写** | 派生 manifest `description`（skill 条目） |
| `aliases` | 可选 | string[]；全表唯一且不与任何 canonical id 冲突 | **手写** | 派生 manifest `aliases`（skill 条目）；**agent 级 aliases 仍在 manifest 手写**（不迁移） |
| `dataSource` | 可选 | `{ db: [模型名], api: [端点] }` | 手写（P4 扫描器出初稿） | 代码直读声明（SKILL_EXPANSION_DESIGN §5.2）；warn 级校验 W5 |
| `mcpTools` | 可选 | string[]；平台工具 id | 手写（P4） | 交叉校验（F13 平台工具 fail-fast；`source: user` 跳过） |
| `coordinator` | 可选 | 见下 | **手写（挂接点登记）** | 挂接点声明，三个用途：校验 / 向导生成 steps 片段 / admin 血缘 |
| `notes` | 可选 | 自由文本 | 手写 | 自文档化 |

`coordinator` 子结构：

```yaml
coordinator:              # 可选；主链/旁挂挂接点登记
  agentId: teaching-agent #   必填（声明时）；挂接的协调器 id（通常 = parentAgent；aux 旁挂显式填，如 teaching-opening-generator）
  steps:                  #   必填（声明时），挂接点登记
    - step: 2             #     与 definition.ts steps 的 step 号对应
      role: opening-generation   #     角色（与 definition.ts role 对应）
      loopOver: messages  #     可选
      condition: on session start # 可选
```

### 1.4 retired 的表示：与 retired-skills.ts 的单源关系

**决策：`retired-skills.ts` 保持执行权威，skills.yaml 不设条目级 retired 字段。**

- 执行语义（启动 purge、cleanup 脚本）读 `RETIRED_SKILLS_PURGE` / `RETIRED_SKILLS_ALL`（`backend/src/skills/retired-skills.ts`，按 RETIRED_SKILLS_FIX_PLAN §4.1 落地，PURGE=35 / ALL=42）。
- 退役在户口簿中的表达 = **从 `skills[]` 移除该条目**；活跃/退役互斥由校验器保证（F9：`RETIRED_SKILLS_ALL ∩ 活跃集 = ∅`，fail-fast）。
- 顶层可选 `retired:` 镜像段：**仅 admin 展示用**（workbench 需要展示退役原因/范围），内容须与 retired-skills.ts 双向一致（F9），不一致 fail-fast。不迁移镜像段 = 合法（该段可整体缺席）。
- 否决「skills.yaml retired 字段为执行源」：purge 与 residue 是执行语义（TS 常量更贴切），且迁移成本高（与 RETIRED_SKILLS_FIX_PLAN 结论一致）。

### 1.5 文件骨架示例（规范形态，非全量内容）

```yaml
# prompts/skills.yaml —— skill 户口簿（注册链唯一声明源，File-as-Truth）
# 消费方：agent-manifest.service.ts（归属/身份派生）、skills:check 校验器、
#         coordinator 挂接点校验器、admin 向导、readiness/面板完成度
# 铁律：kind=mainline 必须同时出现在对应 stage 编排文件 contracts（双向校验 F10）；
#       活跃集 ∩ RETIRED_SKILLS_ALL = ∅（F9）
version: 1

# ============ mainline（进字段路由，17 条） ============
skills:
  - skillId: goal-conversation
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/goal-conversation/index.ts
    coreFile: prompts/core/goal-conversation.yaml
    displayName: 目标对话 Skill
    description: 与学习者多轮对话，收集学习目标
    aliases: [goal-conversation-agent, goal-conversation]
    coordinator:
      agentId: goal-agent
      steps:
        - { step: 1, role: goal-clarification, loopOver: conversation-rounds, condition: until goal confirmed }
    notes: deltaOutput 试点

  # ...（path-planning / stage-designer / teaching-turn / peer-reinforcement /
  #      session-wrapup / adaptive-guidance-copy / lesson-knowledge-enricher /
  #      virtual-learner-×7 = mainline，stage=simulation 组 parentAgent=simulation-agent）

  # ============ handler-only（2 条：learner-model / mcp-tool） ============
  - skillId: learner-model
    kind: handler-only
    stage: profile
    parentAgent: profile-agent
    handlerRef: backend/src/agents/learner-model-agent/index.ts
    registrationPoint: agents
    noPromptFile: true
  - skillId: mcp-tool
    kind: handler-only
    handlerRef: backend/src/skills/mcp-tool/index.ts
    noPromptFile: true

  # ============ aux（9 条，不进字段路由；teaching-opening-generator 旁挂 teaching） ============
  - skillId: teaching-opening-generator
    kind: aux
    coreFile: prompts/core/teaching-opening-generator.yaml
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coordinator:
      agentId: teaching-agent
      steps:
        - { step: 2, role: opening-generation, condition: on session start }
  # ...（session-evaluation-fallback / learner-progress-report / generic-chat /
  #      course-design / skill-author / skill-compiler / basic-evaluator / goal-alignment-checker）

  # ============ 平台守门（1 条） ============
  - skillId: semantic-freeze-judge
    kind: aux
    coreFile: prompts/core/semantic-freeze-judge.yaml
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    registrationPoint: platform-direct
    platformGate: true
    notes: 发布流水线 Gate#3，services/prompt-lab/semantic-freeze-judge.ts 直调 callPrompt

# ============ 退役镜像（可选，仅展示；与 retired-skills.ts 强一致） ============
retired:
  - { skillId: prompt-compiler, scope: purge, reason: 与确定性编译器同名且无生产调用 }
  - { skillId: goal-understanding-composer, scope: residue, reason: LLM 本体注销，模块保留为纯函数库 }
```

> 初始填充共 **27 条活跃** = manifest 17（15 mainline + learner-model + mcp-tool）+ aux 9 + platformGate 1。僵尸项 basic-evaluator / goal-alignment-checker 按 RETIRED_SKILLS_FIX_PLAN §4.3 保留注册 → 计入 aux 9；若产品裁定退役则从本表移除并加入 retired-skills.ts（四同步）。

---

## 2. 生成器与校验器接口

### 2.1 文件位置与配置

- 新文件：`backend/src/services/skill-book/skills-file.ts`（对标 `services/field-routing/orchestration-file.ts` 的 loader 模式：同一份解析/校验核心函数，文件读与内存校验共用）。
- 路径解析（对齐 ORCHESTRATION_DIR 模式）：

```ts
export const SKILLS_FILE_PATH = process.env.SKILLS_FILE
  ? path.resolve(process.env.SKILLS_FILE)
  : path.resolve(__dirname, '../../../../prompts/skills.yaml');
```

### 2.2 `loadSkillsFile()` 接口（解析 + 校验，fail-fast）

```ts
export interface SkillEntry {
  skillId: string;
  kind: 'mainline' | 'aux' | 'handler-only';
  stage?: string;                       // mainline 必填
  parentAgent?: string;
  handlerRef: string;                   // 仓库相对路径
  registrationPoint?: 'skillHandlers' | 'agents' | 'platform-direct' | 'none';
  coreFile?: string;                    // mainline/aux 必填；handler-only 禁填
  noPromptFile?: boolean;               // 派生：handler-only=true
  platformGate?: boolean;               // 默认 false
  displayName?: string;
  description?: string;
  aliases?: string[];
  dataSource?: { db?: string[]; api?: string[] };
  mcpTools?: string[];
  coordinator?: { agentId: string; steps: Array<{ step: number; role: string; loopOver?: string; condition?: string }> };
  notes?: string;
}

export interface SkillsBook { version: number; skills: SkillEntry[]; retired?: Array<{ skillId: string; reason?: string; scope: 'purge' | 'residue' }>; }

export function parseSkillsFile(filePath: string): SkillsBook;      // 读 + 解析 + §1.3/F1~F4 校验，抛错即 fail-fast（[skills.yaml] 前缀）
export function validateSkillsContent(content: string): SkillsBook; // 内存校验（admin 编辑保存前预检，同 parse 核心）
export function loadSkillsFile(): SkillsBook;                       // 启动入口：parseSkillsFile(SKILLS_FILE_PATH)

// 派生视图（供 manifest / 校验器 / 面板消费）
export function getSkillEntry(skillId: string): SkillEntry | undefined;
export function getActiveSkillIds(): Set<string>;                    // 活跃集（F8/F9 对账基准）
export function getParentAgentMembers(): Map<string, string[]>;      // parentAgent → skillIds（agentMembers 派生源）
export function resolveRegistrationPoint(entry: SkillEntry): 'skillHandlers' | 'agents' | 'platform-direct' | 'none'; // 缺省推导
```

错误文案风格对齐编排文件：`[skills.yaml] skills[2].stage=xxx 非法（须在 goal,path,teaching,profile,simulation 中）`。

### 2.3 派生链

**① manifest `agentMembers`：运行时派生（不做代码生成）——评估与决策**

- 实现：`agent-manifest.service.ts` 模块加载时调用 `loadSkillsFile()` 并构建 `parentAgent → skillIds` 映射；`AGENT_MANIFEST` 中 agent 条目**删除手写 `agentMembers`**（或保留为 deprecated 注释），`listSkillsOfAgent` / `getAgentOfSkill` / `getAgentRelations` 改读派生映射；skill 条目的 `displayName/description/aliases` 改由 skills.yaml 派生合并，执行参数（`defaultModelConfig`）、`monitoringGroup`、`category`、`ioContractVersion` 保留 manifest 手写。
- 评估（vs `skills:sync` 生成器重写 TS）：**否决 TS 重写**。理由与 SKILL_EXPANSION_DESIGN §3.1c 一致——重写 manifest 源码需解析/保持其结构，脆弱且不可幂等；运行时派生零改写、天然幂等、回滚只需切回手写模式（§5.3）。
- 新故障面：skills.yaml 缺失时派生失效 → 由 `loadSkillsFile()` fail-fast + 文件进 git 管控 + `SKILLS_FILE_DISABLED=1` 过渡开关（§5.3）兜底。

**② `skills/index.ts` 定义数组：保持手写 + 一致性校验（fail-fast）——评估与决策**

- 候选 A（生成器维护 `// ===== GENERATED from prompts/skills.yaml =====` 标记区，生成 import + 注册行）：技术上可行（文本区间替换），但：a) definition/handler 是**模块级静态符号**，生成器重写 import 区与 tsc 解析、tree-shaking、lint 相互干扰；b) definition 对象含大量手写业务信息（capabilities / inputSchema / outputSchema / stats），生成器只能产出 `name` 一行 → 生成价值极低；c) handler 函数名各异（`stageDesignerFn` / `runGoalConversationAgent` / `executeMcpToolFn`…），生成需强制命名约定，破坏现状。
- 候选 B（**手写 + 一致性校验**）：`skills:check` 对 `allSkillDefinitions` 的 name 集合 ∪ `skillHandlers` 键集合（按 `registrationPoint` 分派）与 `getActiveSkillIds()` 做**双向 diff**，漂移即 fail-fast。零改写风险，且校验器同时覆盖"新增忘注册"与"注册未登记"两个方向。
- **决策：候选 B**。`skills/index.ts` 保持唯一手写注册点（与 handler 本体相邻，天然易维护）；生成的注册片段仅由 admin 向导作为**粘贴模板**返回（§4.3）。
- 例外账：`learner-model`（registrationPoint=agents，查 `agents/index.ts:79-87` 的 agentHandlers 键）、`semantic-freeze-judge`（platform-direct，豁免注册检查）不在 `skillHandlers` 键集内，校验按 `resolveRegistrationPoint` 分派，不误报。

**③ coordinator steps：只做挂接点校验（不全量声明化）**

- `definition.ts` 保持代码手写（loopOver/condition/variableGraph 含编排语义，声明化会迫使平台复刻编排语言——SKILL_EXPANSION_DESIGN §3.4 已决策）。
- skills.yaml `coordinator` 登记的三个用途：F10 双向校验、向导生成 steps 粘贴片段、admin 拓扑血缘绘制（不解析 definition.ts）。

### 2.4 校验清单（按级别）

#### 表 A：fail-fast（启动 throw，与 validateManifest 同档）

| # | 检查项 | 实现位置 | 证据（现状盲区） |
|---|---|---|---|
| F1 | skills.yaml 解析/schema（§1.3 全部字段约束） | `loadSkillsFile()` 内部 | 新面 |
| F2 | skillId 唯一 + kebab-case | 同上 | 新面 |
| F3 | kind 值域；stage 合法性（mainline 必填 ∈ 5 阶段） | 同上 | 新面 |
| F4 | parentAgent ∈ manifest kind=agent 条目（校验时须先过 manifest 自洽） | `loadSkillsFile()` 交叉 | 新面 |
| F5 | handlerRef 文件存在（fs）+ 导出存在（轻量扫描 `export` 声明；platform-direct 豁免） | 启动校验器 | `index.ts:481-486` 静默跳过（诊断调查 §3.1-1） |
| F6 | coreFile 存在（mainline/aux）+ core.yaml 头部 skillId 一致 | 启动校验器 | `seed-core-agent-prompts.ts:273` 仅 console.warn |
| F7 | noPromptFile 冲突：handler-only → true 强制；mainline/aux 显式 true 报错 | `loadSkillsFile()` | manifest 校验仅查"二选一"（`agent-manifest.service.ts:521-523`） |
| F8 | manifest skill 条目集 ↔ 活跃集**双向一致**（孤儿登记/缺失登记均 fail-fast） | `validateManifest` 扩展 | 诊断调查 §4：manifest 条目存在性双向对账 |
| F9 | retired 互斥：`RETIRED_SKILLS_ALL ∩ 活跃集 = ∅`；`retired:` 镜像段与 retired-skills.ts 双向 diff | `validateManifest` 扩展 + `check-retired-skill-lists.ts` 守卫 | 名单漂移审计（RETIRED_SKILLS_FIX_PLAN §1） |
| F10 | coordinator 挂接点双向校验：definition.ts 每个 kind=skill 步骤的 agentId 必须在 skills.yaml 登记（复用 `runtime-definitions.ts:209-232` 逻辑，**启动即跑**）；反向：skills.yaml 登记的挂接点在 definition.ts 不存在 → **warn 不阻断**（§3.4 语义） | 新 `coordinator-hooks-check`（启动 + CI） | `runtime-definitions.ts` 目前仅 admin 端点 |
| F11 | aliases 全局唯一 + 不与任何 canonical id 冲突（含 agent 条目与 skill 条目） | `validateManifest` 扩展 | 现状只查 manifest 内部（`agent-manifest.service.ts:526-530`） |
| F12 | 注册存在性：按 `resolveRegistrationPoint` 查 `skillHandlers` 键 / `agentHandlers` 键；缺失即**throw**（替代静默跳过） | `initializeGateway` 注册循环改（`index.ts:481-486` → 先校验后注册） | 诊断调查 §1：最大盲区 |
| F13 | mcpTools 平台工具存在性（P4 启用；`config/mcp.json`） | skills:check | SKILL_EXPANSION_DESIGN §5.3 |

启动接入点：`initializeGateway` 内、`validateManifest()` 通过（`index.ts:463-470`）之后、注册循环（`index.ts:481`）之前，执行 `F5/F6/F10/F12`；`F8/F9/F11` 并入 `validateManifest` 本身。任一失败 `throw new Error('skills.yaml 校验失败')`，终止启动。

#### 表 B：readiness warn（不阻断，新 skill 不拖垮老链路）

| # | 检查项 | 实现位置 | 语义 |
|---|---|---|---|
| W1 | 全量 ACTIVE prompt 覆盖：noPromptFile/platformGate 豁免；`CRITICAL_PROMPT_IDS` 5 个保留 failed 硬闸门，其余缺失 → warn | `readiness.service.ts`：`CRITICAL_PROMPT_IDS`（:33-39）改为「5 硬闸门 + 活跃集动态全查」双通道 | 诊断调查 §4：硬编码只盖 5 id |
| W2 | 注册对账：`skill_registrations` ↔ 活跃集双向 diff | `readiness.service.ts` 新 check（照抄 `detectFieldRoutingDriftWarnings` 模式 :124,130-149）；同步把 skill_registrations 纳入 `manifest/diagnostics`（`platform.ts:240-269`） | 诊断调查 §1：skill 残留无对账出口 |
| W3 | 接线覆盖率：活跃集是否被 ≥1 处引用（coordinator steps ∪ `executeSkill(` 静态扫描 ∪ `wiredBy` 白名单） | 新服务（`scripts/` 静态扫描，启动编译一次缓存）；白名单声明进 skills.yaml `notes.wiredBy: manual\|service\|aux\|platform` 或独立字段 | 诊断调查 §1：最安静的失败 |
| W4 | core.yaml 缺失/schema 错（F6 已 fail-fast 存在性；此处管 schema/漂移） | 复用 `lint-prompts.ts:25-51` 逻辑提升为 readiness warn | 诊断调查 §1：运行时仅 console.warn |
| W5 | dataSource/mcpTools 声明 vs handler 源码扫描（P4） | skills:check（warn 级） | SKILL_EXPANSION_DESIGN §5.2/§5.3 |

#### 表 C：admin 面板（完成度明细）

| # | 位置 | 内容 |
|---|---|---|
| P1 | `GET /admin/skills/:skillId/workbench-meta`（`skills.ts:426-570`）扩展 | 增加 `handler: {exists, registered}`、`registration`（skillHandlers/agents/platform-direct/none）、`wiredRefs: number`、`completion`（§4.4 状态机）字段 |
| P2 | 目录页 `Skills.vue` + `SkillDrawer.vue` | 完成度列；「未接线 / 无 handler / 未注册」红标 |
| P3 | 聚合健康视图 | `manifest/diagnostics`（补 skill_registrations 维度）接前端，或新增 `GET /admin/skills/health` 分桶（缺注册/缺 handler/未接线/无 ACTIVE） |

### 2.5 CLI 与 CI

- `npm run skills:check`：`ts-node src/scripts/check-skills-file.ts`——执行 F1~F13（除启动专用项外）全量 + W5；任一 F 项失败退出码 1。
- `npm run skills:sync`（可选，P1 用）：初始提取脚本（manifest + v4-aux META + core 文件 → 生成 skills.yaml 初稿），迁移完成后转为**只读校验**，不做代码生成。
- 挂入 `prompts:check:all` 链（`backend/package.json:35` 追加 `&& npm run skills:check`）；`check-retired-skill-lists.ts`（RETIRED_SKILLS_FIX_PLAN §4.2）保留并扩展 F9。

---

## 3. 迁移映射表（现状注册点 → 设计后来源）

| # | 现状位置（file:line） | 现状 | 设计后来源 | 迁移动作 |
|---|---|---|---|---|
| 1 | `agent-manifest.service.ts:54-356`（skill 条目 + agent 条目 agentMembers） | 手写双处 | agentMembers → **派生**（skills.yaml parentAgent）；条目身份字段（displayName/description/aliases）→ **派生**（skills.yaml）；执行参数/监控（defaultModelConfig/monitoringGroup/category/ioContractVersion）→ **保留手写** | 删 agent 条目 agentMembers（:67-69,80-83,95-100,111-114,125-133）；删 skill 条目 name/description/aliases（迁 skills.yaml）；保留 defaultModelConfig 等 |
| 2 | `agent-manifest.service.ts:498-534`（validateManifest） | 内部自洽 | 保留 + 扩展 | 加 F8（双向一致）/F9（互斥）/F11（跨源 alias 冲突） |
| 3 | `skills/index.ts:102-176`（allSkillDefinitions） | 手写 | **保持手写 + F12 一致性校验**（评估结论见 §2.3②） | 不改代码；skills:check 加双向 diff |
| 4 | `skills/index.ts:179-198`（skillHandlers） | 手写 | 同上（校验查键集） | 同上 |
| 5 | `skills/index.ts:221-223`（`Skill handler not found`） | 运行时兜底 | 保留（兜底不变） | 无 |
| 6 | `index.ts:481-486`（注册循环 `if (handler)` 静默跳过） | **静默** | **fail-fast（F12）** | 先全量校验 handler 存在，缺失即 throw；循环保持遍历 |
| 7 | `index.ts:45-92`（RETIRED_SKILLS=35）+ `cleanup-retired-field-data.ts:9-23`（=42） | 双名单漂移 | `retired-skills.ts` 单源（PURGE/ALL） | 按 RETIRED_SKILLS_FIX_PLAN §4.1 落地；skills.yaml 互斥校验 F9；`index.ts:497-516` purge 读新常量 |
| 8 | `readiness.service.ts:33-39`（CRITICAL_PROMPT_IDS） | 5 硬编码 | 5 硬闸门 + 全量动态 warn（W1） | 常量改派生自活跃集（noPromptFile 豁免）；corePrompts 判定拆两档 |
| 9 | `coordinators/definitions-registry.ts:32-47`（SKILL_RUNTIME_DEFINITIONS）+ `:49-55` | 手写双表 | **保持**（运行时定义层权威）+ 一致性明细 | `runtime-definitions.ts:234-247` 的 counts 升级为明细 diff（def.id ↔ 活跃集）；F10 启动即跑 |
| 10 | `coordinators/*.definition.ts` steps（goal/path/ai-teaching/learner/simulation） | 手写 | **保持手写** + skills.yaml coordinator 挂接点登记 + F10 双向校验 | 27 条登记写 coordinator 块（向导生成片段）；校验器上线 |
| 11 | `v4-aux-skills/index.ts:19-28`（AuxSkillId）、`:160-170`（META）、`:331/337-347`（definitions/handlers） | 手写 META | **保持**（runAux 构建细节）+ skillId 集合一致性 | skills.yaml aux 9 条 ↔ AuxSkillId 双向 diff（F12 的 aux 分支） |
| 12 | `prompts/orchestration/*.yaml` contracts（goal:10-12 / path:9-11 / teaching:10-15 / profile:13-15 / simulation:17-24） | 手写 | **保持手写**（数据面）+ 铁律双向校验 | mainline 条目必须出现在对应 stage contracts（F10 扩展）；缺失 fail-fast |
| 13 | `platform.ts:217-354`（manifest/diagnostics，`missingRegistrations` :278-280 / `catalogOnly` :316） | 无 UI 死端 | 补 skill_registrations 维度 + 前端接入（P3） | 后端补查；前端 Skills.vue/拓扑消费 |
| 14 | `seed-core-agent-prompts.ts:271-276`（core 漂移 console.warn） | console.warn | 保留 + W4 提升为 readiness warn | 无 |
| 15 | `agent-manifest.service.ts:371-432`（listSkillsOfAgent / getAgentOfSkill / getAgentRelations） | 读手写 agentMembers | 读派生映射 | 改函数体数据源（对外契约不变） |

**初始填充（P1）**：脚本从 manifest skill 条目（17）+ v4-aux META（9）+ core 文件（semantic-freeze-judge）提取 27 条生成 skills.yaml 初稿 → 人工补 kind/stage/parentAgent/coordinator 审阅 → 派生 agentMembers 与现有一致（diff 为空）后切换。

---

## 4. admin 向导规格（POST /api/admin/skills/scaffold）

### 4.1 入参

```
POST /api/admin/skills/scaffold
{
  skillId: string,              // 必填，kebab-case
  kind: 'mainline'|'aux'|'handler-only',   // 必填
  stage?: string,               // mainline 必填
  parentAgent?: string,
  displayName?: string,
  description?: string,
  aliases?: string[],
  dataSource?: { db: string[], api: string[] },
  mcpTools?: string[]
}
```

### 4.2 幂等语义

- **判定基准：skills.yaml 是否已存在该 skillId 条目**（唯一状态事实）。
- 已存在且请求的 `skillId/kind/stage/parentAgent` 与现存条目一致 → `200 { alreadyExists: true, completion }`（不重复写文件）。
- 已存在但上述关键字段冲突 → `409 { conflictFields: [...] }`。
- 不存在 → 创建，`201 { completion }`。
- 生成物写入策略：**存在即跳过**（core.yaml / handler 模板不覆盖已有文件）；skills.yaml 追加条目与编排文件 contracts 追加为 append-only，重放安全。
- 唯一性预检三处：skills.yaml + manifest（skillId 及 aliases）+ `backend/src/skills/<id>/` 目录存在性。

### 4.3 生成物清单

| # | 生成物 | 写入方式 | 说明 |
|---|---|---|---|
| 1 | `prompts/core/<skillId>.yaml` 骨架 | **真实落盘**（不存在才写） | 按协议 v4 §2.2：identity 占位 / `channels: [dialogue, state]` / rules 占位 / fields: reply 示例 / params 默认（temperature 0.7, maxTokens 4000, failurePolicy retry）/ children 注释模板 |
| 2 | `prompts/skills.yaml` 条目 | **真实落盘**（append-only） | §1.3 字段按表单；coordinator 空登记占位 |
| 3 | handler 骨架模板（主链 / aux / handler-only 三模板） | **返回文本**（不落盘） | 复用 runAux / PromptCallSpec 既有模板（SKILL_EXPANSION_DESIGN §9 风险表）；前端展示复制，人工确认后落盘——避免半成品代码自动进 git |
| 4 | mainline：编排文件 contracts 追加 `skill:<id>` | **真实落盘**（append-only） | 提示运行 `fields:sync` 回填字段（设计 B） |
| 5 | `skills/index.ts` 注册片段（allSkillDefinitions + skillHandlers 两段）；aux 追加 v4-aux META 模板 | **返回文本** | 粘贴模板（§2.3② 决策：不自动改写） |
| 6 | coordinator steps 片段（mainline；按 parentAgent 对应 definition.ts 风格） | **返回文本** | 粘贴到对应 coordinator 的 steps |
| 7 | 完成度清单（§4.4 初始状态） | 响应体 | `completion.items[]` 逐项 ok/hint |

### 4.4 完成度状态机（draft → live，全部派生不落库）

状态是文件系统/DB 状态的**投影**，由校验器现场计算（落库会引入漂移面，否决）；每次 workbench-meta / scaffold 响应时重算。

```
draft            scaffold 已生成（skills.yaml 有条目）
  → handler-ready    handlerRef 文件存在且导出 handler + F12 注册存在性过
  → core-ready       core.yaml 存在 + core:check 过（schema 合法）+ fields ≥ 1 且非占位文本
  → fields-synced    check-core-fields-sync 无 core 缺项（编排文件字段已回填）
  → live             skills:check + prompts:check:all 全绿
```

完成度分项（对照 SKILL_DIAGNOSTICS_SURVEY §4 行内分项）：manifest 条目 / handler 存在 / 注册存在 / prompt ACTIVE（noPromptFile 豁免）/ core 编译 / gateway 注册 / 接线引用数 / 最近调用。输出结构：

```jsonc
completion: {
  state: "draft" | "handler-ready" | "core-ready" | "fields-synced" | "live",
  items: [
    { id: "manifest",        label: "manifest 条目",       ok: true },
    { id: "handler",         label: "handler 存在",        ok: false, hint: "创建 backend/src/skills/<id>/index.ts" },
    { id: "registered",      label: "注册存在",            ok: false, hint: "skills/index.ts 注册片段" },
    { id: "promptActive",    label: "ACTIVE prompt",       ok: false, hint: "npm run prompts:compile-all && prompts:sync" },
    { id: "coreCompiled",    label: "core 编译",           ok: false },
    { id: "gatewayRegistered", label: "gateway 注册",      ok: false },
    { id: "wired",           label: "接线引用",            ok: false, hint: "coordinator steps 或业务调用点" },
    { id: "recentCalls",     label: "最近调用",            ok: null }
  ]
}
```

前端：SkillDesignPage 状态条复用现有 drift/health 语言逐项打勾；未完成项给跳转/命令提示（SKILL_EXPANSION_DESIGN §6.3）。

---

## 5. 风险与回滚

### 5.1 skills.yaml ↔ manifest 双源漂移的校验机制

| 机制 | 级别 | 位置 |
|---|---|---|
| `validateManifest` 扩展 F8/F9/F11（skill 条目集双向一致 + retired 互斥 + alias 冲突） | fail-fast | 启动（`index.ts:463-470` 既有调用链）+ CI |
| `skills:check`（F1~F13 全量 + W5）并入 `prompts:check:all` | fail-fast | `backend/package.json:35` 链 |
| `check-retired-skill-lists.ts` 守卫（PURGE ⊆ ALL；ALL ∩ 活跃 = ∅） | fail-fast | CI（RETIRED_SKILLS_FIX_PLAN §4.2 已有） |
| 生成器幂等 + 「只建不更新」 | 结构性 | 对齐 bootstrap `update:{}` 语义，防 admin 数据面编辑被覆盖 |

### 5.2 迁移顺序（每阶段独立可回滚，验证 diff 为空再进下一阶段）

| 阶段 | 内容 | 验证（通过条件） |
|---|---|---|
| P0 户口层 | 脚本提取 27 条生成 skills.yaml 初稿 + 人工审阅；loader + `skills:check` 上线（**只读，不切换派生**） | skills:check 全绿；不启动任何派生逻辑 |
| P1 派生切换 | agentMembers 运行时派生（§2.3①）+ validateManifest F8；agent 条目删手写 agentMembers | `getAgentRelations()` diff 与迁移前为空 |
| P2 校验升级 | F12 替代 `index.ts:481-486` 静默跳过；F10 启动即跑；W1/W2 上 readiness | 启动日志无异常；readiness 无新 warn |
| P3 退役单源 | `retired-skills.ts` 落地（按 RETIRED_SKILLS_FIX_PLAN §4.1）；F9 互斥 + 镜像段 | 守卫脚本绿；purge 语义不变（35/42） |
| P4 数据面 | dataSource/mcpTools 扫描器出初稿 → 人工确认写入 → W5/F13 上线 | 扫描报告人工复核；warn 清零或白名单 |
| P5 admin | scaffold 接口 + SkillDesignPage 完成度 + 面板 P1~P3 | 向导新建一个测试 aux skill 全流程走通 |

### 5.3 回滚点

- **每阶段一个独立提交**，`git revert` 即回滚；阶段间互不依赖。
- **派生是运行时计算**：回滚 P1 = 恢复手写 agentMembers 分支；保留一版过渡分支 `SKILLS_FILE_DISABLED=1`（跳过 loadSkillsFile，走旧手写模式），仅限一版发布窗口，避免长期双代码路径。
- **skills.yaml 缺失/损坏** = loader fail-fast（预期行为，文件进 git 管控）；损坏回滚 = 从 git 恢复文件，无需代码回滚。
- **scaffold 写操作**全部幂等且 append-only：重放不破坏；core.yaml/handler 不覆盖既有文件；唯一破坏面（编排文件 contracts 追加）可 git revert。
- **退役误判**：互斥校验 F9 保证活跃/退役清单不交叉；误退役只发生在 retired-skills.ts 显式改动 + 四同步缺失时——由守卫脚本 + 附录 A 注记（RETIRED_SKILLS_FIX_PLAN §4.5）兜底。

---

## 附：与既有单源化成果的关系

- **编排文件（协议 v4 §2.6）**：不动摇；skills.yaml 是其顶层补充（身份/归属层），字段路由链路（loader → bootstrap → DB → drift）零改动；mainline 铁律（contracts 双向）复用现有 loader。
- **agent-manifest 运行时权威**：保留（大量运行时 import `getAgentManifest` 不变）；仅归属与身份数据来源变化，`getAgentManifest` 等对外契约不变。
- **控制面/数据面分离**：skills.yaml 不承载 prompt 文本与字段路由语义；`children` 约定与 `fields:sync` 归设计 B（本规格不展开）。
- **漂移门禁**：detectFieldRoutingDrift / check-core-hash-parity / snapshots check 全部保留；skills:check 与之并列同级。
