# 漂移（Drift）完全解释

> 面向运营与开发：系统里"漂移"不是一个概念，有 7 类实现。本文逐一讲清：检测对象、检测实现（file:line）、检测时机、当前实际状态、成因、以及 admin 编排结构页顶部"W4 漂移 10"的确切含义。
>
> 证据基准：2026-08-11 实测（backend 探针 + SQLite 直查 + git 历史），全部证据精确到 file:line。

---

## 0. 一句话总览：三层模型

系统里同一份"事实"存在三层：

| 层 | 是什么 | 例子 |
|---|---|---|
| **说明书（声明）** | 文件里写的"应该是什么" | `prompts/core/*.yaml`、`prompts/orchestration/*.yaml`、`prompt-lab/manifests/*.yaml`、`prompts/agent-snapshots.md` |
| **台账（DB）** | 数据库里登记的"已批准是什么" | `agent_prompts`（ACTIVE 行 + coreHash + metadata）、`field_definitions`、`agent_field_routings`、`agent_contracts` |
| **现场（运行时）** | 实际执行时"用的是什么" | 运行时从 **DB ACTIVE** 取 prompt（`agentConfig.service.ts:216-223`），按路由表注入字段 |

**漂移 = 三层对不上**。一个字段/一段 prompt 在文件里改过了，但台账或现场还是旧的（或反过来：现场有文件里已经删了的东西）。

---

## 1. 漂移类型总表

| 类型 | 检测对象（谁 vs 谁） | 实现 | 检测时机 | 当前状态（2026-08-11 实测） |
|---|---|---|---|---|
| a. 字段路由漂移 | 编排文件 `prompts/orchestration/*.yaml` vs DB 三表（contracts/fields/routings） | `detectFieldRoutingDrift`（`backend/src/services/field-routing-bootstrap.service.ts:267-348`） | 启动 readiness warn（`readiness.service.ts:127-158`）+ admin「漂移与审计」tab（`field-routings.ts:468-511`）+ CI 门禁 `prompts:drift-check` | **0**（drift 0 / 孤儿 0 / admin 行 0） |
| b. coreHash 漂移 | 核心文件 `prompts/core/*.yaml` 哈希 vs 编译产物 `prompts/skill.*.md` frontmatter coreHash vs DB ACTIVE 行 coreHash（三向） | `check-core-hash-parity.ts:84-200`；W4 复用（`skills-readiness.service.ts:23-25, 299-323`） | CI `prompts:core:check`（exit 1）+ readiness W4（60s 缓存）+ 启动日志 | **10 drift / 15 in-sync / 0 db-mismatch**（即页面上的"W4 漂移 10"） |
| c. 快照漂移 | `prompts/agent-snapshots.md` 产物 vs 编排文件 + core fields 派生结果 | `generate-agent-snapshots.ts:155-170`（--check） | CI `prompts:snapshots:check`（已挂 `prompts:check:all` 链） | **一致** |
| d. 契约漂移 | manifest `prompt-lab/manifests/*.yaml`（runtimeContract/promptContract）vs DB ACTIVE `metadata.promptLab` 嵌套契约 | `check-prompt-runtime-contract-metadata-parity.ts:455-700` | CI `prompts:runtime-contract:check` | **25/25 in-sync，0 错误** |
| e. handoff 对账 | core 文件 inputs ref（`skill:Y.F`）vs 路由表 handoff | `check-input-handoffs.ts` + `services/prompt-lab/input-handoff-check.ts` | CI `prompts:check-handoff:strict`；默认模式 advisory（warn 退出 0） | **25/25 全部通过** |
| f. fields-sync 孤儿/缺项 | core fields vs 编排产出路由行首段（root）双向 | `check-core-fields-sync.ts:144-249`；状态机复用（`skill-completion.ts` fields-synced 档） | CI `prompts:fields-sync:check`（缺项/类型 >0 退出 1）+ 完成度状态机 | **缺项 0 / 类型 0 / 孤儿 5（warn 不阻断）** |
| g. yaml 交叉校验 | core ↔ manifest 双写一致性（temperature/maxTokens/failurePolicy）+ 词表闭包 | `check-yaml-vocabulary.ts`（C1-C5） | CI `prompts:yaml:check` | **C1 25/25、C2 50/50、C3 0 重复、C4 137 字段、C5 80 处 全过** |

---

## 2. 逐类详解

### a. 字段路由漂移（编排文件声明 vs DB 三表）

- **比较哪些字段**：
  - contract：`displayName`、`description`（`field-routing-bootstrap.service.ts:285-290`）
  - field：`promptRole`、`valueType`、`snakeName`、`camelName`、`systemLocked`、`structureLocked`、`pathInRawOutput`、`description`、`bindings`（`:302-314`；`pathInRawOutput` 是 2026-08 补强项，`:309-311` 注释：与 DB 不一致会导致 assemble* 抽取静默跑偏）
  - routing：`handoff`、`render`、`internalFlag`、`accumulate`、`visibilityPreset`（`:329-343`）
- **managedByCode=false 豁免语义**：admin 手动建/改过的行不参与 diff（`:284, :301, :328`），即"人工改过的以人工为准"；只对代码管理行做"声明 vs 台账"对账。
- **缺口不报 drift、由 readiness 数量检查兜底**：声明有、DB 无的行 `continue` 跳过（`:283, :300, :327`），由 `readiness.service.ts:100-124` 的 count 对比（`checks.fieldRouting`）判 failed。
- **当前实际状态**：probe 实测 `driftCount=0`，三表 `db=声明数`（21/137/197），孤儿 0、admin 行 0。

### b. coreHash 漂移（三向对账）—— 用户看到的"W4 漂移 10"

- **三向**：`computeCoreHash(core文件)`（`core-file-loader.ts:569-582`，键序无关稳定序列化）vs 编译产物 frontmatter `coreHash` vs DB ACTIVE 行 `coreHash`（列优先，`metadata.promptLab.coreHash` 快照兜底，`check-core-hash-parity.ts:72-82`）。
- **状态机**（`:22-29, :92-156`）：`in-sync` / `drift`（frontmatter ≠ 核心文件实际哈希）/ `db-mismatch`（DB 锚点 ≠ frontmatter）/ `core-file-missing` / `invalid-core-file` / `missing-active` / `not-declared`。
- **W4 薄壳**（`skills-readiness.service.ts:299-323`）：`missing-active` 归 W1、`not-declared`（v2 文件）跳过、不在户口簿活跃集的文件跳过；`drifted` 列表 = 户口簿活跃集内且状态 ∈ {drift, db-mismatch, core-file-missing, invalid-core-file} 的 agentId 去重。
- **页面数据流**：编排结构页顶部徽章 ← `Orchestrator.vue:15, 203-212` ← `GET /api/admin/skills/readiness`（`routes/admin/skills.ts:773-784`）← `checkSkillsReadiness`（60s 缓存，`skills-readiness.service.ts:356-376`）← `checkCoreHashParity`。
- **当前实际状态**：25 个文件全声明 coreHash；**10 drift、15 in-sync、0 db-mismatch、0 missing-active**（明细见 §4）。

### c. 快照漂移

- 生成器把编排文件 + core fields 声明渲染成 `prompts/agent-snapshots.md`（"自动生成，勿手改"，`:67-71`）；`--check` 模式比对现有文件与重新渲染内容，不一致即失败（`:159-166`）。CI 也以 `git diff --exit-code` 兜底。
- **当前实际状态**：一致。

### d. 契约漂移（manifest vs DB ACTIVE metadata）

- File-as-Truth：v4 文件契约唯一声明处为 `prompt-lab/manifests/<skillId>.yaml`（`check-prompt-runtime-contract-metadata-parity.ts:390-425`），v2 文件从 frontmatter 延迟解析；与 DB ACTIVE 行 `metadata.promptLab.runtimeContract / promptContract` 做**结构化比对**（键序无关，`structurallyEqualRuntimeContracts` `:320-335`）。
- 缺失即失败，不回退默认值（`:390` 注释）；alias/重复 canonical/ambiguous-active 等 13 种状态。
- **当前实际状态**：25/25 `in-sync`（注意：它只对账"契约"，不涉及 coreHash，因此不受 W4 影响）。

### e. handoff 对账（advisory）

- 每个 core 文件的 `inputs ref: skill:Y.F` 必须在 Y 的路由表中存在该字段且 handoff 包含本 skill（`check-input-handoffs.ts:3-8`）。
- 默认模式 warn 退出 0；`--strict` 失败退出 1（CI 用）。**当前**：25 个核心文件全部通过。

### f. fields-sync（core fields vs 编排产出路由）

- 只扫编排文件 `agentId === 'skill:<id>'` 的产出行（`check-core-fields-sync.ts:161`）；root = fieldId 首段（`:196`）。
- **缺项**（error 级）：root ∉ core fields ∪ 豁免清单（`:189-204`）→ 阻断 `fields-synced` 完成度档、CI 退出 1。
- **孤儿**（warn）：core 字段未出现在任何产出 root 且无豁免别名承载（`:227-236`）→ 不阻断。
- **类型不一致**（warn）：仅无点分直配字段做 core type ↔ 编排 valueType 比对（`:206-225`）。
- 豁免清单 `EXEMPT_PLATFORM_ROOTS`（`:56-99`，2026-08-10 定稿）覆盖 userVisible/core/goalConversation/debug/control/path 等平台包装根。
- **当前实际状态**：缺项 0、类型 0、**孤儿 5（warn）**：
  - `path-planning`：`estimatedHours` / `estimatedWeeks` / `cognitiveDesign`（兼容镜像字段未路由，文件头 `:28-29` 注释为"真实漂移保留报"）
  - `virtual-learner-scenario-designer`：`personaSeed` / `story`（core 输出未路由，仅 consistencyNotes 进路由）

### g. yaml 交叉校验（core ↔ manifest 双写）

- C1：core `params.failurePolicy` 经映射表必须等于 manifest `promptContract.failurePolicy`，映射闭包自洽（`check-yaml-vocabulary.ts:67-94`）
- C2：core `params.temperature/maxTokens`（真源）== manifest `runtimeDefaults`（镜像）（`:96-110`）
- C3：`acceptableAgentIds` 无字面重复（`:112-125`）
- C4：编排 valueType 全量 ∈ `CORE_VALUE_TYPES` 且映射闭环（`:127-151`）；C5：visibilityPreset 全量命中（`:153-165`）
- **当前实际状态**：全过。注意 C2 只查 core↔manifest 两份文件——它们同批改所以过；**第三份（编译产物/DB）不在它管界内**，这正是 W4 漏网的根本原因之一。

---

## 3. 为什么会产生漂移（成因分析，带代码证据）

### 成因 1：bootstrap 是"只建不更新"（最主要的系统级成因）
`ensureStageFieldRoutings` 的三张表 upsert 全部是 `update: {}`——**已存在的行永不更新**（`field-routing-bootstrap.service.ts:140-142, 163-165, 191-193`）。声明的属性改了，DB 旧行保持原样。这是**有意设计**（保留 admin 编辑），代价是"声明一套、库里另一套"只能靠检测可见：
- 代码注释自述：`field-routing-bootstrap.service.ts:228-233`（"bootstrap 的 upsert(update:{}) 语义是'只建不更新'……本检测对比编排文件声明与 DB 行内容，让漂移可见"）
- admin PUT 保存编排文件后也走 ensure：`routes/admin/field-routings.ts:288-299`，响应里明说"**新建字段/路由已生效；已有行属性修改需『强制同步 DB』或重启后由 bootstrap 覆盖生效**"

### 成因 2：同一信息多处落盘（多份存储）
一条信息被复制到多个载体，任何一个不同步就漂移：
- `coreHash` 存三份：核心文件内容（可重算）、编译产物 frontmatter（`core-compiler.ts:49, 101-107`）、DB ACTIVE 行（`coreHash` 列 + `metadata.promptLab.coreHash` 快照，`check-core-hash-parity.ts:72-82`）
- `temperature/maxTokens` 双写：core `params` + manifest `runtimeDefaults`（`check-yaml-vocabulary.ts:96-110` 专门对账）
- `failurePolicy` 双写：core `params` + manifest `promptContract`（C1）
- 字段类型四处写：core `fields[].type`、编排 `fields[].valueType`（需映射）、编译产物、DB `field_definitions`
- 字段路由三处写：编排文件、DB 三表、`prompts/agent-snapshots.md`（快照产物，CI 校验）
- 契约两处写：manifest + DB `metadata.promptLab`（契约漂移对账）

### 成因 3：人工编辑路径差异（三条互不联通的改法）
- **admin 直写 DB**：已退役——seed TS 脚本注释明示"seed-*-field-routings.ts 已退役（2026-08 单源化收尾），编排文件为唯一编辑入口"（`field-routing-bootstrap.service.ts:9-10`）
- **编排文件编辑（PUT）**：只建不更新（见成因 1），已有行改动不自动生效
- **core 发布管线**：改 `prompts/core/*.yaml` 后必须手动两步——`npm run prompts:compile-all`（`compile-core-files.ts`）生成产物 + `npm run prompts:sync`（`ensure-core-agent-prompts.ts --sync`）写 DB。**少跑任一步就是三向对账里的一个分叉**（W4 的 10 条正是少跑了这两步）。

### 成因 4：手改编译产物绕过核心文件
产物 frontmatter 带 coreHash 就是为了抓这个：任何人直接改 `prompts/skill.*.md` 而不动 core 文件，coreHash 立刻对不上（`check-core-hash-parity.ts:125` 的"手改痕迹"就是这条路径的检测文案；`core-prompt-metadata.ts:55-57` 的 coreSnapshot 写入也拒绝漂移版本）。

### 成因 5：词表/命名变更后未同步（当前 W4 10 条的实锤）
2026-08-10 commit `276ff8d`（"refactor: yaml 词表统一"）改了 10 个 core 文件的字段类型（`array` → `object[]`/`string[]`，共 22 处 type 归一）+ 2 个 manifest，但**没有重新编译产物、没有 sync DB**。编译产物最后改动停在 08-07（`5e48635`）或 08-09（`1bc7d96`/`75e4b83`）——产物与 DB 里是词表统一前的旧哈希。

### 成因 6：历史遗留孤儿（seed 时代声明已删、DB 行残留）
seed 时代声明过的字段后来从声明中移除，DB 行不自动删（bootstrap 只建不更新，删也需人工）。`cleanup-orphan-field-routings.ts:1-14` 记录了 2026-08 单源化收尾时的存量：**24 条孤儿 field_definitions（\*Narrative/Note/Pattern 系列、displayLabel 等）+ 14 条孤儿路由**，清理前逐一 grep 确认零消费后删除（备份 `prisma/system.db.backup-20260809-orphan-cleanup.bak`）。

---

## 4. 当前实例明细：W4 漂移 10 具体是哪些（用户最关心）

**实测**（2026-08-11，`npm run prompts:core:check` 即 `check-core-hash-parity.ts`）：

```
状态分布：drift=10, in-sync=15, db-mismatch=0, missing-active=0, 其余=0
```

| # | skill（agentId） | DB ACTIVE 版本 | frontmatter coreHash 前12位 | 核心文件实际哈希前12位 | 状态 |
|---|---|---|---|---|---|
| 1 | goal-conversation | v18 | 696963342a93 | 2c146fc41cd5 | drift |
| 2 | path-planning | v18 | 7f4bd4d53e38 | 5cda13e88a32 | drift |
| 3 | peer-reinforcement | v11 | b8bc21ae4764 | cd74d7eb0657 | drift |
| 4 | session-wrapup | v13 | 347a2aa997cd | 884453dfa211 | drift |
| 5 | teaching-turn | v3 | 1e0ff2581d07 | 0ad63257e408 | drift |
| 6 | virtual-learner-actor-auditor | v6 | a209a114b539 | 0b3399616062 | drift |
| 7 | virtual-learner-learn-turn-simulator | v9 | 99c0a748935c | 245a54930df1 | drift |
| 8 | virtual-learner-persona-designer | v7 | 74e8ea683b2f | aa562157e223 | drift |
| 9 | virtual-learner-referee | v7 | 646f95d94b3e | eea2d4d23251 | drift |
| 10 | virtual-learner-scenario-designer | v6 | cb92855b3b85 | 27ccd69c723a | drift |

**关键事实**（决定了"为什么"和"要不要慌"）：

1. **DB ACTIVE 的 coreHash 与产物 frontmatter 完全一致**（如 goal-conversation 两边都是 `696963342a93…`，DB 直查确认）。所以不是"现场和台账打架"，而是**说明书（core 文件）先改了，产物和台账还停在旧版**。三向里断的是"core 文件 ↔ 产物/DB"这一向。
2. **10 条恰好 = commit `276ff8d`（2026-08-10 13:59）改动的 10 个 core 文件**：字段类型 `array` → `object[]`/`string[]`（22 处）+ path-planning maxTokens 对齐。git 史实：产物最后一次提交早于该 commit（08-07/08-09）。
3. **运行时实际跑的是旧版**：运行时从 **DB ACTIVE 取 prompt**（`agentConfig.service.ts:216-223`），所以当前线上行为 = 词表统一**前**的旧 prompt。10 条 W4 漂移的真实含义是：**这批词表统一改动写了说明书但还没"上线"**（缺 `compile-all + sync`），不是有非法改动混进了现场。
4. 检测文案里的"手改痕迹"是泛化措辞（任何 frontmatter≠core 哈希都这么说），本案例方向是"core 改了没重编译"，不是"产物被手改"。

**修复动作**（运营不用做，开发一条命令）：`npm run prompts:compile-all`（重生成 25 个产物 + 新 coreHash）→ `npm run prompts:sync`（写 DB ACTIVE）→ `npm run prompts:core:check` 验证归零。

### 其余实例的当前值（同批实测）

- 字段路由漂移：**0**（drift 0，三表 db=声明=21/137/197，孤儿 0，admin 行 0）
- fields-sync 孤儿 **5 条（warn，不阻断）**：path-planning 的 `estimatedHours`/`estimatedWeeks`/`cognitiveDesign`（兼容镜像字段，有意未路由）+ virtual-learner-scenario-designer 的 `personaSeed`/`story`（core 输出未路由）
- 契约漂移：**25/25 in-sync**；handoff：**25/25 通过**；yaml C1-C5：**全过**；快照：**一致**

---

## 5. 通俗解释（给运营看）

> **说明书 vs 台账 vs 现场**：
> - **说明书** = 工程图/菜谱（`prompts/core/*.yaml`、编排文件、manifest），写的是"应该长什么样"
> - **台账** = 审批登记簿（数据库三表 + agent_prompts ACTIVE），写的是"已批准上线的是什么"
> - **现场** = 正在执行的车间（运行时），**只照台账干活**，说明书改得再新它也不看
>
> **漂移 = 三者对不上**。系统里 7 种"对账"就是 7 个方向天天抽查这三者有没有脱节。

每种漂移一句话：

| 漂移 | 一句话定义 | 一句话成因 | 一句话影响 | 在哪里看到 |
|---|---|---|---|---|
| 字段路由漂移 | 编排文件（说明书）与路由三表（台账）对不上 | 保存文件"只建不更新"，老行不自动跟着改 | 声明改了但线上路由还是旧的（或反过来） | admin 编排页「漂移与审计」tab、启动日志、CI |
| coreHash 漂移（W4） | 核心文件（说明书）与编译产物/DB（台账）哈希对不上 | 改了 core 文件忘了"编译+同步"两步 | 新 prompt 没上线，线上跑旧版 | **编排结构页顶部"W4 漂移 N"**、`prompts:core:check` |
| 快照漂移 | 沙盘说明书（agent-snapshots.md）与编排/core 声明脱节 | 改了声明没重新生成快照 | 文档误导写 Prompt 的人 | CI `prompts:snapshots:check` |
| 契约漂移 | manifest 与 DB 里登记的调用契约不一致 | 契约改了没同步 DB metadata | 契约校验/审计口径不一致 | CI `prompts:runtime-contract:check` |
| handoff 对账 | core 声明的"我要上游 X 的字段"在路由表里找不到 | 路由表改了没回改 inputs 声明 | 引用悬空，运行时拿不到数据 | CI（strict）/ 本地 advisory |
| fields-sync | core 字段与编排产出字段对不上（缺项/孤儿/类型不一致） | 两边分别维护、漏改一方 | 字段缺路由或类型跑偏 | 完成度状态机（fields-synced 档）、CI |
| yaml 交叉校验 | core 与 manifest 双写参数（温度/token/失败策略）不一致 | 同一参数写两份 | 同一 skill 两套运行参数 | CI `prompts:yaml:check` |

---

## 6. 治理现状与建议

### 现状分级

| 级别 | 覆盖项 |
|---|---|
| **CI 门禁（失败即阻断）** | `prompts:check:all` 链（lint、handoff strict、snapshots:check、drift-check、retired:check、skills:check、data-source:check、yaml:check、fields-sync 缺项）、`prompts:core:check`、`prompts:runtime-contract:check` |
| **只 warn 不阻断** | 字段路由漂移（启动日志 + admin 面板）、W1-W5（readiness warn 通道 + 页面徽章）、fields-sync 孤儿/类型（warn） |
| **advisory** | `check-input-handoffs` 默认模式（warn 退出 0） |
| **已消除（清零）** | 字段路由漂移/孤儿/admin 行 = 0（2026-08-09 孤儿清理 24+14 行，备份 `system.db.backup-20260809-orphan-cleanup.bak`；2026-08 单源化收尾后编排文件为唯一声明源）；契约 25/25；handoff 25/25；yaml 全过；快照一致 |

> 注：仓库内未找到"27→0 清零"的原始记录——文档中的 **27** 指 `skills.yaml` 初始 27 条技能注册（`doc/SKILLS_YAML_SPEC.md:148`），与漂移无关；孤儿清理实为 **24 字段 + 14 路由 = 38 行**。若"27"指某次漂移数量，证据已不可考，但"字段路由漂移清零"这一事实成立（当前 0）。

### 建议（按优先级）

1. **W4 漂移的机制性修复**：当前 `prompts:core:check` 存在但**未挂入 `prompts:check:all` 链**（package.json:40-43，因它需要 DB）。建议把 core 变更纳入 PR 门禁：凡 `prompts/core/*.yaml` 变更必须同时提交重新生成的 `prompts/skill.*.md`（git diff 校验），从源头杜绝"只改说明书不上线"。
2. **coreHash 失配的文案修正**：`check-core-hash-parity.ts:125` 把两种情况（手改产物 vs 改了 core 没重编译）都报"手改痕迹"，对运营有误导，建议区分方向。
3. **fields-sync 5 条孤儿处置**：path-planning 3 条（estimatedHours/estimatedWeeks/cognitiveDesign）与 scenario-designer 2 条（personaSeed/story）——要么补编排路由/豁免登记（`EXEMPT_PLATFORM_ROOTS`，`check-core-fields-sync.ts:56-99`），要么明确接受并保持 warn；当前是"真实漂移保留报"，建议排期定论。
4. **字段路由漂移建议保留 warn 而非转门禁**：admin 编辑行豁免语义下，drift 是"人工编辑"的正常痕迹，转门禁会误伤；可考虑对 `managedByCode=true` 行单独加"超期未同步"提醒。
5. **编排文件 PUT 后的已有行改动**：目前提示文案已说明需「强制同步 DB」（`field-routings.ts:298`），可进一步在「漂移与审计」tab 对该 stage 高亮"待同步"状态，减少运营困惑。

---

## 附录：探测/复现命令

```bash
# 字段路由漂移（无 --check 只报告；--check 为 CI 门禁）
cd backend && npx ts-node --transpile-only src/scripts/field-routing-drift-probe.ts

# coreHash 三向对账（W4 数据源）
cd backend && npm run prompts:core:check

# 契约漂移 / handoff / fields-sync / yaml / 快照
cd backend && npm run prompts:runtime-contract:check
cd backend && npx ts-node src/scripts/check-input-handoffs.ts --strict
cd backend && npx ts-node src/scripts/check-core-fields-sync.ts --report
cd backend && npx ts-node src/scripts/check-yaml-vocabulary.ts
cd backend && npx ts-node src/scripts/generate-agent-snapshots.ts --check

# admin 端点
GET /api/admin/skills/readiness?refresh=1     # W1-W5 全量（W4.drifted 即页面徽章数据）
GET /api/admin/field-routings/drift           # 字段路由漂移明细（kind/stage 可过滤）
```
