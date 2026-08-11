# 漂移检测的基准（source of truth）体系调查

> 性质：架构审计（只读调查，未改任何代码）
> 日期：2026-08-11 · 基准：仓库 HEAD `365b5b2`
> 问题：漂移/偏移以什么为基准？有基准才有偏移，有偏移才有修复。本文逐项判定系统内 10 类对账/漂移检查的基准，盘点基准冲突（双层权威/覆盖例外/双向对等），给出健康中心设计所需的"基准元数据"schema 与分级修复语义。
> 配套文档：`doc/DRIFT_EXPLAINED.md`（7 类漂移的事实描述）、`doc/SKILL_PROTOCOL_V4.md`（§1.1/§2.5/§2.6）、`doc/SKILLS_YAML_SPEC.md`（户口簿）、`doc/SKILL_READINESS_SPEC.md`（W1-W5）、`doc/design/LEARN_AGENT_CENTRALIZATION_PLAN.md`（§2.1 三层权威）。

---

## 0. 核心结论（TL;DR）

1. **系统有 4 个根声明源**（`prompts/core/*.yaml`、`prompt-lab/manifests/*.yaml`、`prompts/orchestration/*.yaml`、`prompts/skills.yaml`），外加 2 个代码内声明（`agent-manifest.service.ts`、`coordinators/*.definition.ts`）。所有检查的"基准"都是这些根声明，但**有 5 处平行声明（无派生关系）、1 处隐式覆盖层、3 处双向对等检查**，导致"修复=向基准收敛"在多数检查上无法机械执行。
2. **绝大多数检查是单向文件基准**（core→产物→DB 链、manifest→DB 链、编排文件→DB 链），其中 3 项存在名实不符：字段路由 contract 维度的真实基准是 manifest（经 `deriveContract` 派生）而非编排文件；yaml C1/C2 的 manifest 是"手写镜像"；W3 是唯二真正的双向对等声明检查（definition.ts vs skills.yaml 两处手写）。
3. **覆盖例外是隐式的**：`managedByCode=false` 行"以人工为准"，但覆盖行不参与任何对账、也无覆盖元数据（谁/何时/为何），覆盖与文件长期背离时不可见。
4. **健康中心应引入三档语义**：基准漂移（error，可一键向基准收敛）／一致性偏差（warn，人工决策）／覆盖行（info，记录）。当前状态机的严重度不对称（fields-sync 缺项 error vs 孤儿 warn）已隐含此分级，但未显式声明。

---

## 1. 逐类基准判定表

判定维度：比较双方（A vs B）、谁是基准、方向、覆盖例外、代码证据、历史/设计依据。
"单向 A→B"表示 A 是基准、B 是镜像/派生，修复=向 A 收敛。

| # | 检查项 | 比较双方 | 基准判定 | 覆盖例外 | 代码证据 | 设计/历史依据 |
|---|---|---|---|---|---|---|
| 1 | **W4 coreHash（三向）** | core 文件实际哈希 vs 产物 frontmatter coreHash vs DB ACTIVE 行 coreHash | **单向，core.yaml 为基准**：core→产物→DB 链式派生 | 无（不适用）；`not-declared`（v2 文件）跳过对账 | `check-core-hash-parity.ts:119-128`（drift：`computeCoreHash(core) !== frontmatter`）、`:144-153`（db-mismatch：DB 锚点 ≠ frontmatter）、`:72-82`（DB 列优先、metadata 兜底）、`core-file-loader.ts:569-582`（computeCoreHash 键序无关）；W4 薄壳 `skills-readiness.service.ts:299-323` | SKILL_PROTOCOL_V4 §1.1 原则 1"核心文件是源代码，prompt 是编译产物"；§6.2/§6.3（文件头注释 `check-core-hash-parity.ts:2`）；实例：commit `276ff8d`（2026-08-10 词表统一）改了 10 个 core 未重编译 → 10 条 drift（DRIFT_EXPLAINED §4） |
| 2 | **字段路由漂移** | 编排文件声明 vs DB 三表（agent_contracts/field_definitions/agent_field_routings） | **单向，编排文件为基准**（`field-routing-bootstrap.service.ts:9-10`"编排文件为唯一声明源"） | **有，隐式**：`managedByCode=false` 行跳过 diff（`:284, :301, :328`）；声明有 DB 无的行不报 drift、由 readiness 数量检查兜底（readiness.service.ts:121-124） | `detectFieldRoutingDrift` `field-routing-bootstrap.service.ts:267-348`；bootstrap upsert `update:{}` 只建不更新 `:140-142, :163-165, :191-193`（成因 1）；admin PUT 写盘后 ensure `field-routings.ts:247-315`；POST /sync 全量对账"文件为准，跳过 admin 行" `:322-359` | SKILL_PROTOCOL_V4 §2.6（编排文件为数据面声明源，File-as-Truth）；commit `a1bb317`（2026-08-10"编排文件成为字段路由唯一声明源"） |
| 3 | **fields-sync** | core 平铺 fields vs 编排产出路由行 fieldId 首段（root） | **双向对等，无明确单方基准**，但严重度不对称：缺项（编排 root ∉ core）= **error 阻断**（隐含：编排向 core 收敛）；孤儿（core 字段未被路由）= **warn 不阻断**（隐含：core 向路由现实收敛）；类型不一致 = warn | **有，显式清单**：`EXEMPT_PLATFORM_ROOTS`（`:56-99`，每条含 coreAliases 与 evidence 注释） | `check-core-fields-sync.ts:144-249`：缺项 `:189-204`、类型比对 `:206-225`、孤儿 `:227-236`；状态机复用同一纯函数（SKILL_READINESS_SPEC §2）；豁免注释 `:15`"aux/handler-only 不进字段路由（skills.yaml:254 注释）" | SKILL_READINESS_SPEC §2（fields-synced 档：缺项红、孤儿不阻断）；commit `c80aa72`（2026-08-10 W1-W5/fields-sync 落地）；存量孤儿 5 条为"真实漂移保留报"（`:27-29`） |
| 4 | **快照漂移** | 编排文件 + core fields 声明（生成源）vs `prompts/agent-snapshots.md`（派生产物） | **单向，声明为基准**：产物必须与重新渲染结果逐字节一致 | 无 | `generate-agent-snapshots.ts:155-170`（--check 重渲染比对，不一致 exit 1）、`:67`"自动生成，勿手改"、文件头 `:1-7`（数据源：编排 + core fields） | SKILL_PROTOCOL_V4 §2.5（沙盘说明书条目）；P-A 固化产物（纳入 git + CI 校验） |
| 5 | **yaml 交叉校验（C1-C5）** | core params ↔ manifest（runtimeDefaults/promptContract）+ 编排词表 | **单向 core→manifest（带映射）**：C2 明确"core params（真源）== manifest runtimeDefaults（镜像）"（`:96-110`）；C1 failurePolicy 是 core 业务意图 → manifest 运行时契约的映射闭包（`yaml-vocabulary.ts:62-80` 唯一映射表）；C4 core type ↔ 编排 valueType 映射闭环（core 词表为基准，`yaml-vocabulary.ts:11-12`）；C3/C5 为 manifest/编排内部自洽 | 无 | `check-yaml-vocabulary.ts:67-110`（C1/C2）、`:112-125`（C3）、`:127-151`（C4）、`:153-165`（C5）；映射表 `yaml-vocabulary.ts:13-15`（core=业务意图，manifest=运行时契约） | YAML_UNIFICATION_AUDIT §2/§3.1；commit `276ff8d`（词表统一）；DRIFT_EXPLAINED §2.g 明确"C2 只查 core↔manifest 两份文件——第三份（编译产物/DB）不在管界内，这正是 W4 漏网的根本原因之一" |
| 6 | **W1（ACTIVE 覆盖）** | 户口簿活跃集 vs `agent_prompts` ACTIVE | **单向偏户口簿**：双向差集（missingActive + zombieActive），但语义上户口簿是基准（missing=DB 缺镜像、zombie=DB 残留）；zombie 技能（basic-evaluator 等 3 个）ACTIVE 残留单列 warn | noPromptFile=true（handler-only）豁免方向 A | `skills-readiness.service.ts:143-192`（analyzeW1）；ZOMBIE 清单 `:44`；文件头 `:11-15`（"双向差集"） | SKILLS_YAML_SPEC §1.5"skills.yaml —— skill 户口簿（注册链唯一声明源，File-as-Truth）"；RETIRED_SKILLS_FIX_PLAN §4.3 |
| 7 | **W2（注册对账）** | 户口簿 vs `skill_registrations` | **单向偏户口簿**：双向差集，户口簿为基准（missing=未注册、zombie=幽灵残留） | `registrationPoint=agents`（learner-model）与 `platform-direct`（semantic-freeze-judge）豁免方向 A（不落注册表是预期） | `skills-readiness.service.ts:194-233`；豁免 `:200-203` | SKILLS_YAML_SPEC §1.3 registrationPoint 字段；SKILL_READINESS_SPEC §3 |
| 8 | **W3（接线双向）** | `coordinators/*.definition.ts` steps vs 户口簿 coordinator 块 | **双向对等，无派生关系、两处手写**：方向 A steps 引用不在户口簿；方向 B 户口簿登记未进 steps——修复方向由人工决定（登记或移除引用） | `W3_STEPS_EMPTY_EXEMPT` 硬编码清单（`:47-51`）；platform-direct、无 coordinator 块的 aux/handler-only | `skills-readiness.service.ts:240-297`（analyzeW3 双向 `:249-277`） | SKILLS_YAML_SPEC §1.3"coordinator：手写（挂接点登记）"；LEARN_AGENT_CENTRALIZATION_PLAN §2.1"编排层权威 = coordinators/*.definition.ts"——两权威并存由 W3 弥合 |
| 9 | **W4（core 漂移）** | 同 #1 | 同 #1（复用同一实现，`skills-readiness.service.ts:23-25, :299-323`） | 不在户口簿活跃集的文件跳过（缺 ACTIVE 归 W1）；not-declared 跳过 | 同 #1 | 同 #1 |
| 10 | **W5（dataSource）** | （TBD 占位） | 未定：DATASOURCE_P4_SURVEY 建议"声明为基准、扫描器比对"（W5a 未声明 / W5b 过期 / W5c 例外账） | — | `skills-readiness.service.ts:102-105`（`ok: true, note: 'TBD dataSource'`） | DATASOURCE_P4_SURVEY §4.1（W5 三通道，warn 级） |
| 11 | **契约 parity** | manifest（runtimeContract/promptContract）vs DB ACTIVE `metadata.promptLab` 嵌套 | **单向，manifest 为基准**：v4 契约唯一声明处为 manifest；缺失/非法即失败，不回退默认值；v2 文件从 frontmatter 延迟解析（历史兼容路径） | 无 | `check-prompt-runtime-contract-metadata-parity.ts:390-425`（loadV4ManifestContracts，缺失即失败 `:399-406`）、`:455-700`（analyze，mismatch 判定 `:593-622`）、`:320-335`（structurallyEqual 键序无关比对） | DRIFT_EXPLAINED.md:64"v4 文件契约唯一声明处为 manifest"；LEARN_AGENT_CENTRALIZATION_PLAN §2.1"Agent 层权威 = manifest（运行时唯一真理源）" |
| 12 | **运行时 prompt 漂移**（7 类之外） | 代码 prompt（spec.defaultSystemPrompt，编译产物/文件侧）vs DB ACTIVE prompt（运行时实际使用） | **单向，文件为基准、DB 为现场镜像**：运行时传感器，每次 LLM 调用比对，结果记入 `prompt_call_logs.promptDrift`；修复语义=重新 sync | 无 | `prompt-composer.ts:272`（detectPromptDrift 调用点）、`composers/drift-detector.ts:8-20`（sha256 比对）、`prompt-composer.ts:433`（promptDrift 落库） | DRIFT_EXPLAINED §0 三层模型"运行时只照台账干活"；agentConfig.service.ts:216-223（运行时从 DB ACTIVE 取 prompt） |
| 13 | **handoff 对账**（7 类 e） | core inputs ref（`skill:Y.F`）vs 路由表（Y 有该字段 + handoff 含本 skill） | **方向性单向但无收敛基准**：core 声明是需求、路由表必须满足；但修复方向二义（补路由 or 删 inputs），默认 advisory、--strict 才阻断 | 无 | `check-input-handoffs.ts:1-37`；input-handoff-check.ts（GateIssue）；SKILL_PROTOCOL_V4 §2.5（advisory→strict） | SKILL_PROTOCOL_V4 §2.5"对账（advisory→strict）" |
| 14 | **runtime-definitions consistency**（admin） | definition.ts steps.agentId 可解析性 vs manifest 条目 | **单向，manifest 为基准**：steps 引用必须能解析到 manifest 条目（service 节点白名单豁免） | `step.kind === 'service'` 白名单（TeachingContextBuilder 等） | `routes/admin/runtime-definitions.ts:206-250`（consistency 端点） | LEARN_AGENT_CENTRALIZATION_PLAN §2.1/§2.3（phantom id 修正清单） |

**汇总**：10 类检查中 **7 类单向（文件为基准）**、**3 类双向对等（fields-sync、W1/W2 差集、W3）**；其中 W1/W2 语义上偏户口簿基准（差集两侧严重度不同），真正的"无基准"是 **fields-sync 孤儿/缺项** 与 **W3 接线**。

---

## 2. 基准冲突盘点

### 2.1 双层/三层权威：链式派生 vs 平行声明

LEARN_AGENT_CENTRALIZATION_PLAN §2.1 声明了三层权威：**Agent 层 = manifest、编排层 = coordinators/*.definition.ts、Skill 层 = prompts/core/*.yaml + skills/*/definition.ts**。叠加 SKILLS_YAML_SPEC 的户口簿，实际有 4 个文件根声明 + 2 个代码内声明。它们之间**大部分是链式派生，但有 5 处平行声明**：

| # | 重叠信息 | 各声明位置 | 关系 | 证据 |
|---|---|---|---|---|
| P1 | **temperature/maxTokens 三写** | ① core `params`（C2 真源）② manifest `runtimeDefaults`（C2 镜像，**手写**）③ `skills/*/definition.ts` defaultTemperature/defaultMaxTokens（bb7cdd1 称"展示权威"）；运行时实际读 ACTIVE prompt | **平行声明**（①→②是"要求相等"而非派生；③与①②是第三处）；bb7cdd1 自述"运行时权威仍为 ACTIVE prompt" | `check-yaml-vocabulary.ts:96-110`；commit `bb7cdd1`（2026-08-08 统一化 1c，修 11 处漂移：path-planning 0.4vs0.2、teaching-turn 0.5vs0.7…） |
| P2 | **agentMembers** | ① `prompts/skills.yaml` parentAgent（唯一来源，派生）② manifest 手写 legacy（`SKILLS_FILE_DISABLED=1` 回退） | **已收敛为派生**，但双源并存（回退路径仍是手写） | `agent-manifest.service.ts:15-20`；SKILLS_YAML_SPEC §2.3① |
| P3 | **字段类型四处写** | core `fields[].type`（基准词表）↔ 编排 `fields[].valueType`（映射镜像）↔ 编译产物 ↔ DB `field_definitions` | 链式 + 映射；C4 与 fields-sync 分别对账，但**无单一检查覆盖全链**（DRIFT_EXPLAINED 成因 2） | `yaml-vocabulary.ts:11-12`；DRIFT_EXPLAINED §3 成因 2 |
| P4 | **contracts displayName/description** | ① manifest（name/description）② 编排文件 contracts（**只声明 agentId**）③ DB agent_contracts | **派生链**：manifest → `deriveContract` → 编排加载器 → DB。⚠️ **检查 #2 名义上"编排文件 vs DB"，其 contract 维度的真实基准是 manifest**（declared 值来自 `deriveContract`）——检查命名与真实基准不符 | `orchestration-file.ts:182`（parse 时 deriveContract）、`seed-contract-helper.ts:14-21`、`field-routing-bootstrap.service.ts:285-290`；goal.yaml:4 注释"contracts.displayName/description 仍由 agent-manifest 派生" |
| P5 | **coordinator steps** | ① `coordinators/*.definition.ts`（编排层权威，手写）② skills.yaml `coordinator` 块（手写挂接点登记） | **平行声明、无派生**；W3 双向对账弥合，修复人工 | `skills-readiness.service.ts:240-297`；SKILLS_YAML_SPEC §1.3 |

**判定**：P1 是最大的平行声明（3 处"权威"表述并存），P4 是"派生却仍被当作独立声明对账"的名实不符，P5 是设计上有意的双写（挂接点登记 vs 执行链），由 W3 兜底。

### 2.2 覆盖例外：覆盖权 vs 基准

- **现状语义**：`managedByCode=false` 行"以人工为准"（DRIFT_EXPLAINED.md:45）。覆盖行不参与 diff（`field-routing-bootstrap.service.ts:284, :301, :328`）、强制同步时跳过（`field-routings.ts:338-341`）。
- **这是有意设计**：bootstrap `upsert(update:{})` 只建不更新 + admin 编辑豁免，为保留人工微调（`field-routing-bootstrap.service.ts:228-233` 自述）。DRIFT_EXPLAINED 建议 4 明确"drift 是人工编辑的正常痕迹，转门禁会误伤"。
- **但覆盖是隐式的**：① 无覆盖元数据（谁改的/何时/为何）；② 覆盖行与文件背离永远不可见（drift 页报 0 不代表覆盖行与文件一致，只代表"没查"）；③ `source:'code' + managedByCode:true` 与 `managedByCode:false` 的判定在 bootstrap 里各写一遍（`:204-205` 与 `:284`），语义散落三处（`:284/:301/:328` + `field-routings.ts:338`）。
- **结论**：这是"覆盖权高于基准"的合理妥协，但必须**显式化**（见 §5）：覆盖行从"跳过对账"升级为"info 记录 + 显示 + 可撤销"，并登记覆盖元数据，使"覆盖本身"成为可审计对象。

### 2.3 双向对等检查：无基准时"修复"语义

- **fields-sync**（#3）：缺项=error 已隐含"编排向 core 收敛"（core 是基准）；孤儿=warn 无方向（core 有字段未路由：补路由 or 登记豁免 or 接受）。存量 5 条孤儿即"真实漂移保留报"（`check-core-fields-sync.ts:27-29`）——**无基准的检查其"修复"只能是人工决策或显式豁免登记**。
- **W1/W2**（#6/#7）：双向差集但户口簿语义上为基准；修复=向户口簿收敛（登记或清理），hint 已给出双向命令（`skills-readiness.service.ts:168, :174, :216, :222`）。
- **W3**（#8）：真正无基准——definition.ts 与 skills.yaml 都是手写权威。修复二义（补 steps vs 删登记），且豁免清单本身是硬编码（`:47-51`）。
- **handoff**（#13）：方向性单向（core 需求必须被路由满足）但修复二义（补路由 vs 删 inputs）。

---

## 3. 基准链现状图（文字版）

```
【声明层（根基准，进 git，人工编辑）】          【派生层】                 【镜像层（DB/产物）】           【运行时】
┌─────────────────────────────────────┐
│ prompts/core/*.yaml                  │
│   ├─ identity/channels/rules/fields  │──compile──▶ prompts/skill.*.md ──sync──▶ agent_prompts ACTIVE ──▶ 运行时取 prompt
│   │   params (temperature/maxTokens/ │   (compile-core-files.ts:20)  (seed-core-  (agentConfig.service.ts:216-223)
│   │          failurePolicy)          │     └ frontmatter coreHash         agent-      │
│   └─ inputs refs ──┐                 │                                      prompts   └── runtime drift 传感器
│                     │                │                                      --sync)     (prompt-composer.ts:272)
│      W4① drift ◀───┼────────────────┘      W4② db-mismatch ◀───────────────────┘
│      (check-core-hash-parity.ts:119-128)    (…:144-153)
│
│  C2 temperature/maxTokens（真源）──对账──▶ manifest runtimeDefaults（手写镜像）
│  C1 failurePolicy（业务意图）──映射──▶ manifest promptContract（手写镜像）
│  C4 fields[].type（词表基准）──映射──▶ 编排 fields[].valueType
│
├─ prompt-lab/manifests/*.yaml（契约层）
│   ├─ runtimeContract/promptContract ──sync──▶ DB metadata.promptLab ◀──契约 parity 对账（#11）
│   ├─ defaultModelConfig ──(展示权威声明)──与 skills/*/definition.ts 平行（P1）
│   └─ name/description ──deriveContract──▶ 编排 contracts（P4 派生链）──ensure──▶ agent_contracts
│
├─ prompts/orchestration/*.yaml（数据面）
│   ├─ fields/routings ──ensure(只建不更新)──▶ field_definitions / agent_field_routings ◀──字段路由漂移（#2）
│   │                                             ▲ managedByCode=false 覆盖行豁免（隐式）
│   ├─ routings ──▶ prompts/agent-snapshots.md（派生产物）◀──快照漂移（#4）
│   ├─ routings/fields ──◀──▶ core fields（fields-sync #3，双向）
│   └─ routings.handoff ◀──core inputs refs 对账（#13，advisory）
│
├─ prompts/skills.yaml（户口簿）
│   ├─ parentAgent ──派生──▶ manifest agentMembers（P2）
│   ├─ 活跃集 ──◀──▶ agent_prompts ACTIVE（W1 双向差集）
│   ├─ 活跃集 ──◀──▶ skill_registrations（W2 双向差集）
│   └─ coordinator 块 ──◀──▶ coordinators/*.definition.ts steps（W3 双向，两处手写）
│
└─（代码内声明）backend/src/services/agent-manifest.service.ts（Agent 层权威，手写 5 agent + 20 skill）
                 backend/src/coordinators/*.definition.ts（编排层权威，手写 steps + variableGraph）
```

**链上断点（B1-B6）**：

| 断点 | 位置 | 性质 | 影响 |
|---|---|---|---|
| B1 | core → 产物/DB 链（W4） | **有检查但未入 check:all**：`prompts:core:check` 因需 DB 未挂链（backend/package.json:40 vs :42-43） | 2026-08-11 实测 10 条 drift 全部是"core 改了没编译+sync"（DRIFT_EXPLAINED §4） |
| B2 | 编排文件 → DB 三表 | **有意断点**：bootstrap 只建不更新（`update:{}`） | "声明一套、库里另一套"只能靠检测可见；这是覆盖层的结构性前提 |
| B3 | manifest runtimeDefaults / promptContract | **平行声明**：C2/C1 的 manifest 侧是手写镜像，同批修改才一致 | "两份文件同批改所以过；第三份不在管界内"（DRIFT_EXPLAINED §2.g） |
| B4 | definition.ts vs skills.yaml coordinator | **双向对等**（W3），无派生方向 | 修复需人工决策；豁免清单硬编码 |
| B5 | core fields vs 编排 routings | **双向对等**（fields-sync），缺项/孤儿方向不一致 | 孤儿无收敛方向，存量 5 条"保留报" |
| B6 | manifest defaultModelConfig vs definition.ts vs core params | **三写并存**（P1） | "展示权威"与"真源"与"运行时权威"三套表述 |

---

## 4. 健康中心基准元数据建议

### 4.1 schema 草案

每项检查声明一个"基准描述"（baseline descriptor），健康中心据此决定：偏移判定方向、可修复性、覆盖例外处理。

```ts
// 基准元数据：健康中心对每一项检查的声明式描述
interface DriftBaseline {
  /** 检查项唯一 id（对齐 DRIFT_EXPLAINED a-g 与 W1-W5） */
  id: 'field-routing' | 'core-hash' | 'snapshot' | 'contract-parity' | 'handoff'
     | 'fields-sync' | 'yaml-cross' | 'W1' | 'W2' | 'W3' | 'W4' | 'W5'
     | 'runtime-prompt' | 'runtime-definitions-consistency';

  /** 基准类型 */
  base:
    | 'file:core.yaml'        // 业务 SSOT：W4、yaml C1/C2/C4、handoff、fields-sync(缺项向)
    | 'file:manifest'         // 契约层：contract-parity、字段路由 contract 维度、runtime-definitions
    | 'file:orchestration'    // 数据面：字段路由(field/routing 维度)、快照
    | 'file:skills.yaml'      // 户口簿：W1、W2
    | 'file:definition.ts'    // 编排层（W3 方向 A 的引用侧）
    | 'db:managed'            // 覆盖层（managedByCode=false 行）
    | 'bidirectional'         // 无单方基准：fields-sync(孤儿向)、W3、W1/W2 差集反向
    | 'runtime';              // 运行时观测：runtime-prompt（DB 现场 vs 文件）

  /** 镜像侧（被对账方）：修复时向 base 收敛 */
  mirror: 'db:agent_prompts' | 'db:field-routing-tables' | 'file:skill.*.md'
        | 'file:agent-snapshots.md' | 'db:metadata.promptLab' | 'db:skill_registrations'
        | 'runtime:prompt-call-logs';

  /** 派生关系：镜像如何产生（决定修复命令） */
  derivation: 'compile' | 'sync' | 'render' | 'derive' | 'mapping' | 'handwrite-mirror' | 'none';

  /** 语义分级（见 §5） */
  semantics: 'baseline-drift' | 'consistency' | 'override-record';

  /** 一键修复（仅 baseline-drift 有）：向基准收敛的命令 */
  fix?: {
    command: string;          // 如 'npm run prompts:compile-all && prompts:sync'
    precheck?: string;        // 如 'npm run prompts:core:check'
  };

  /** 覆盖例外层（显式声明，替代隐式豁免） */
  overrides?: Array<{
    selector: string;         // 如 'managedByCode === false'
    semantics: 'skip-compare' | 'skip-fix' | 'record-only';
    declaredIn: string;       // 声明位置（file:line）
    metadata?: { owner?: string; reason?: string };  // 覆盖行应登记的元数据
  }>;
}
```

### 4.2 每项检查的基准元数据速查表

| 检查 | base | mirror | derivation | semantics | 修复 |
|---|---|---|---|---|---|
| W4/coreHash | `file:core.yaml` | 产物 frontmatter + DB ACTIVE | compile→sync | **baseline-drift** | ✅ `prompts:compile-all && prompts:sync` |
| 字段路由（field/routing 维度） | `file:orchestration` | DB 三表 | handwrite-mirror（只建不更新） | **baseline-drift** + overrides(`managedByCode=false`, skip) | ✅ `POST /orchestration/:stage/sync`（跳过覆盖行）；⚠️ contract 维度 base 实为 manifest（P4） |
| 字段路由（contract 维度） | `file:manifest`（经 deriveContract） | DB agent_contracts | derive | **baseline-drift** | ✅ 同上；建议检查命名修正（§5） |
| 契约 parity | `file:manifest` | DB metadata.promptLab | sync | **baseline-drift** | ✅ `prompts:runtime-contract:check` + `prompts:sync` |
| 快照 | `file:orchestration`+core | agent-snapshots.md | render | **baseline-drift** | ✅ `prompts:snapshots`（重新生成） |
| yaml C1/C2 | `file:core.yaml` | manifest（手写镜像） | mapping/handwrite-mirror | **baseline-drift**（但镜像需手写维护→建议消除，§5） | ✅ 改 core 后同步改 manifest（或改为派生） |
| fields-sync 缺项 | `file:core.yaml`（隐含） | 编排 routings | none | **baseline-drift** | ✅ 补 core fields 或登记豁免（EXEMPT_PLATFORM_ROOTS） |
| fields-sync 孤儿 | `bidirectional` | — | none | **consistency** | ⚠️ 人工：补路由 or 登记豁免 or 接受 |
| handoff | `file:core.yaml`（需求侧） | 路由表 | none | **consistency** | ⚠️ 人工：补路由 or 删 inputs |
| W1/W2 | `file:skills.yaml`（偏基准） | DB ACTIVE / skill_registrations | none | **baseline-drift**（缺侧）＋ **consistency**（残留侧） | 缺侧 ✅ 登记/同步；残留侧 ⚠️ 人工清理（hint 已给） |
| W3 | `bidirectional` | definition.ts ↔ skills.yaml | none | **consistency** | ⚠️ 人工：补 steps or 删登记（豁免清单硬编码） |
| W5 | TBD | — | — | TBD | — |
| runtime-prompt | `file`（代码侧） | DB ACTIVE（现场） | sync | **baseline-drift**（运行时观测版） | ✅ `prompts:sync` |
| runtime-definitions | `file:manifest` | definition.ts steps | none | **consistency** | ⚠️ 修 definition.ts phantom id（LEARN_AGENT_CENTRALIZATION_PLAN §2.3） |

### 4.3 修复语义三档

- **baseline-drift（基准漂移）**：镜像偏离声明 → **可一键修复**（执行 fix.command 向基准收敛）；健康中心 UI 给"一键修复"按钮 + 修复后复检。
- **consistency（一致性偏差）**：无单方基准 → **只提示不自动修**；UI 显示双方与差异方向，交由人工决策；可附加"登记豁免"动作（把人工决策落成显式记录，如 EXEMPT_PLATFORM_ROOTS 式清单）。
- **override-record（覆盖行）**：覆盖权高于基准 → **info 记录**；显示覆盖行与基准的背离、覆盖元数据（owner/reason），提供"撤销覆盖（向基准收敛）"动作。

---

## 5. 结论与理想体系

### 5.1 理想基准体系（一条声明链 + 显式覆盖层 + 双向降级）

**一条单向声明链**（每个镜像只有一个父声明，每步检查只对相邻两环）：

```
core.yaml ──编译──▶ skill.*.md ──sync──▶ agent_prompts ACTIVE（运行时现场）
    │                    └─▶ manifest（派生，不再手写镜像）──▶ metadata.promptLab
    └─fields──▶ 编排 routings/fields ──ensure──▶ DB 三表（覆盖层显式化）
                    └─▶ agent-snapshots.md
skills.yaml ──▶ agentMembers 派生 / 注册 / ACTIVE 覆盖（W1/W2 单向收敛）
definition.ts ◀──skills.yaml coordinator 改为派生登记（W3 单向化）
```

关键动作：

1. **消除手写镜像**（P1/B3）：manifest `runtimeDefaults` 与 `promptContract.failurePolicy` 改为编译派生（core → manifest 生成），C1/C2 从"对账"降级为"派生校验"；`skills/*/definition.ts` 参数改为从 core 派生或删除。
2. **W3 单向化**（P5/B4）：definition.ts 为基准，skills.yaml coordinator 块改为"登记 + 自动核对"（生成器从 definition.ts 回填），W3 只剩方向 A（引用必须在户口簿）。
3. **fields-sync 定方向**：明确 core 为基准——缺项保持 error；孤儿升级为"必须登记豁免（EXEMPT_PLATFORM_ROOTS）或补路由"，豁免登记即人工决策的显式化（从"保留报"到"登记在案"）。
4. **覆盖层显式化**（B2）：`managedByCode=false` 行写入覆盖元数据（owner/reason/at），健康中心以 info 显示"覆盖行 vs 基准"背离与撤销入口；覆盖行的存在不再使 drift 计数静默归零。
5. **门禁补链**（B1）：`prompts:core:check` 与 `prompts:runtime-contract:check` 需要 DB，无法进纯文件 `check:all`——建议改为"core 文件变更必须同 commit 产物"的 git diff 门禁（DRIFT_EXPLAINED 建议 1），或健康中心把它们列为"需手动触发的 DB 类检查"。
6. **检查命名与真实基准对齐**（P4）：字段路由 contract 维度在健康中心标注 base=`file:manifest`（经 deriveContract），避免"编排文件 vs DB"的误读。

### 5.2 健康中心分级模型

| 级别 | 语义 | 覆盖面 | 展示 | 动作 |
|---|---|---|---|---|
| **error：基准漂移** | 镜像偏离唯一声明源，方向确定 | W4、契约 parity、快照、字段路由（非覆盖行）、yaml C1/C2、fields-sync 缺项、W1/W2 缺侧 | 红 | 一键修复（向基准收敛）+ 修复后复检 |
| **warn：一致性偏差** | 无单方基准或双权威并存，需人工 | fields-sync 孤儿、W3、handoff、W1/W2 残留侧、W5 | 黄 | 提示双方与差异方向；提供"登记豁免/删除/补声明"动作 |
| **info：覆盖行** | 覆盖权高于基准，有意为之 | `managedByCode=false` 行及其背离 | 灰/蓝 | 展示覆盖元数据 + 撤销覆盖入口；不参与 error/warn 计数 |

**判定规则**：健康中心每项检查输出 `{ baseline, status: 'in-sync' | 'drift' | 'override', detail }`；`drift` 按 §4.2 表映射到 error/warn，`override` 恒为 info。当前 DRIFT_EXPLAINED §6 的"CI 门禁/只 warn/advisory"分级与之一致，本模型补上的是**方向性**（谁向谁收敛）与**覆盖可见性**。

---

## 附录：证据索引

- 7 类漂移事实：`doc/DRIFT_EXPLAINED.md`（2026-08-11 实测）
- File-as-Truth 原则：`doc/SKILL_PROTOCOL_V4.md:13`（§1.1 原则 1）、`:101`（§2.6 编排文件）
- 三层权威：`doc/design/LEARN_AGENT_CENTRALIZATION_PLAN.md:42-58`（§2.1）
- 户口簿声明：`doc/SKILLS_YAML_SPEC.md:80`（"注册链唯一声明源"）、`:15-20`（agentMembers 派生）
- W1-W5 规格：`doc/SKILL_READINESS_SPEC.md:20-33`（轨道 B + 分层铁律）
- 覆盖层语义：`field-routing-bootstrap.service.ts:228-233`（自述）、DRIFT_EXPLAINED.md:45
- 单源化历史：commit `a1bb317`（2026-08-10 编排文件唯一声明源）、`bb7cdd1`（2026-08-08 参数单源化）、`c80aa72`（2026-08-10 W1-W5/fields-sync）、`276ff8d`（2026-08-10 词表统一，W4 10 条 drift 根因）
