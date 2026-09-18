# 隐私 / 同意 / 未成年人 / 自述优先 数据治理基线（Q16）

> 日期：2026-09-19
> 性质：**文档基线（不含代码改动）**。本文是 `UPGRADE_DIRECTION_20Q.md` Q16 与
> `doc/20questions/EIGHT_ADDITIONAL_QUESTIONS_INVESTIGATION.md` §16 的落地设计稿。
> 方法：所有事实均回代码复核，结论带 `文件:行`；无法在代码中证实的，标注为"需产品/法务拍板"。
> 与既有治理的关系：本文**不重复** `NON_FUNCTIONAL_GOVERNANCE_PLAN.md` NF-P2-1（数据分类、保留、删除、导出的**工程删除矩阵**，状态"需决策"，见该文 `:735-758`、`:1009`）；
> 本文补的是 **NF-P2-1 未覆盖的伦理/同意层 + 自述优先仲裁 + "导出=删除同覆盖矩阵"** 三件事，并把分类矩阵按**真实代码**填实。
> 边界：本文只描述现状与建议基线，**不替产品/法务下结论**；§4 单列决策点。

---

## 0. 一句话结论

WenFlow 的差异化优势是精准学习者模型，但它同时是最大的合规暴露面：
**系统已经在存"心理画像级"推断（认知/情绪画像 + 自由文本叙事），却完全没有同意记录、没有未成年人门、没有数据主体自助导出、没有学习数据的保留 TTL；**
删除能力比"文档以为的"强（虚拟级联 + 真实 purge 覆盖派生数据），但**删除/导出两份覆盖清单彼此不一致、且都漏了 `prediction_records` / `misconception_ledger`**（见 §2-G6）。
"自述 vs 推断"在当前代码里**同权覆盖**：聚合器直接用 LLM 推断值盖默认值，没有来源标记、没有用户可查看/纠正入口、没有仲裁规则。

---

## 1. 数据分类矩阵

图例：
- **来源**：`自述` = 用户主动表达；`推断` = LLM/代码从行为或对话推断；`合成` = LLM 生成的虚拟人设（**非真实用户**）；`系统` = 系统运行记录。
- **敏感度**：高 = 心理/情绪/自由文本（等同特殊类别关注）；中 = 行为/学习状态；低 = 运行日志。
- **保留**：当前实际保留期（代码证据）。
- **删除**：当前删除流程是否覆盖（`purge` = `purge-soft-deleted-users.ts`；`cleanup` = `virtual-cleanup.service.ts`；`FK级联` = `users` 外键 onDelete）。
- **导出**：当前是否存在数据主体级导出。

| # | 数据类 | 存放位置（表.字段 / 代码:行） | 来源 | 敏感度 | 当前保留 | 当前删除覆盖 | 当前导出覆盖 |
|---|---|---|---|---|---|---|---|
| A1 | Agent 调用日志（可能含 userId、会话上下文 metadata） | `agent_call_logs.*` `schema.prisma:32-76` | 系统 | 中 | **90 天**（`log-retention.service.ts:8,29-31`） | purge + cleanup | `/me/agent-logs/export`（仅本表、上限 1000 行）`users.ts:586-625`；admin CSV `admin/export.ts:78-103` |
| A2 | Prompt 调用日志 | `prompt_call_logs.*` `schema.prisma:82-126` | 系统 | 中 | **90 天**（`log-retention.service.ts:29-33`） | purge + cleanup | 无 |
| A3 | LLM 执行尝试（token、错误、模型） | `llm_execution_attempts.*` `schema.prisma:128-189` | 系统 | 中 | **90 天**（`log-retention.service.ts:29-31`） | purge + cleanup | 无 |
| A4 | 登录尝试 | `login_attempts.*` `log-retention.service.ts:29-35` | 系统 | 中 | **90 天** | 未在 purge/cleanup 清单 | 无 |
| A5 | 领域事件 Outbox/Inbox | `domain_event_outbox.payload` `schema.prisma:541-567` | 系统 | 中 | **无 TTL** | purge（outbox 在 9 表内）+ cleanup | 无 |
| B1 | 学习状态指标（LSS/KTL/LF/LSB） | `learning_metrics.lss/ktl/lf/lsb` `schema.prisma:295-322` | 推断 | 中 | **无 TTL** | FK 级联 | 无 |
| B2 | 学习证据（含 `review:completed`、`goal:understanding:updated` 的 LLM 推断 payload） | `learner_evidence.payload` `schema.prisma:580-600` | 推断+系统 | 中-高 | **无 TTL** | purge + cleanup | 无 |
| B3 | 学习者投影（可重建） | `learner_projections.payload` `schema.prisma:627-646` | 推断 | 中 | **无 TTL** | purge + cleanup | 无 |
| B4 | 记忆痕迹（FSRS/ACT-R） | `memory_traces.*` `schema.prisma:677-705` | 推断 | 中 | **无 TTL** | purge + cleanup | 虚拟侧有 `GET /:id/memory`（`virtual-learners.ts:757-813`）；真实用户无 |
| B5 | 预测校准台账 | `prediction_records.*` `schema.prisma:650-672` | 推断 | 中 | **无 TTL** | ⚠️ **未覆盖**（无 users 外键、不在 purge 9 表、不在 cleanup 清单） | 无 |
| B6 | 误解台账 | `misconception_ledger.*` `schema.prisma:604-625` | 推断 | 中-高 | **无 TTL** | ⚠️ **未覆盖**（同上） | 无 |
| C1 | 目标对话原文 | `goal_conversations.messages` `schema.prisma:244` | 自述 | 高 | **无 TTL** | FK 级联 + purge | admin CSV 仅 `description`（`admin/export.ts:155-175`）；无主体导出 |
| C2 | 目标对话结构化理解（认知画像：元认知/思维风格/自评准确性…） | `goal_conversations.collectedData → understanding.cognitive_profile` `profile-aggregator.ts:218-224` | 推断 | **高** | **无 TTL** | FK 级联 | 无 |
| C3 | 目标理解证据（同上，冗余落证据表） | `learner_evidence` (`goal:understanding:updated`) `profile-aggregator.ts:200-211` | 推断 | **高** | **无 TTL** | purge + cleanup | 无 |
| C4 | 聚合后认知画像（内存缓存 5 分钟，**不落库**） | `LearnerModelProfile.cognitive` `types.ts:15-21`；`LearnerProfileService.ts:4-21`；`profile-aggregator.ts:160-176` | 推断 | **高** | 内存 5 分钟 | 随进程 | 无 |
| D1 | 情绪-心理推断（动机/紧迫感/自信） | `understanding.emotional_profile → LearnerModelProfile.emotional` `types.ts:49-55`；`profile-aggregator.ts:234-238` | 推断 | **高** | **无 TTL** | FK 级联 | 无 |
| D2 | `frustrationTolerance`（挫败耐受度） | `types.ts:53` + 默认 `0.5` `profile-aggregator.ts:72` | ⚠️ **死默认**（聚合只填 3 个情绪字段，从不赋值） | 高（若启用） | 常量 | — | 无 |
| D3 | `BehavioralBaseline`（响应时长/投入度/一致性） | `types.ts:23-29`；默认 `profile-aggregator.ts:42-48`；`fetchBaselineData` **恒返回 null** `:267-272` | ⚠️ **死模块**（EMA 基线已退役） | 中（若启用） | 常量 | — | 无 |
| D4 | 派生叙事 11 字段（目标/动机/挫败模式/有效教学…） | `LearnerNarrativeInsights` `types.ts:66-78`；确定性产出 `profile-aggregator.ts:130-132` | 推断 | **高** | 内存 5 分钟 | 随进程 | 无 |
| D5 | 课程控制（粒度/密度/复习频率/推进策略文本） | `LearnerCurriculumControls` `types.ts:80-85`；`profile-aggregator.ts:133` | 推断 | 中-高 | 内存 5 分钟 | 随进程 | 无 |
| E1 | 教学会话原文/状态（逐字记录） | `teaching_sessions.messages/knowledgeState/teachingState/wrapup` `schema.prisma:487-490` | 自述+推断 | **高** | **无 TTL** | FK 级联 + purge | admin CSV 仅元数据（`admin/export.ts:105-128`，**不含 messages**） |
| E2 | 内容反馈评论 | `content_feedback.comment/confusionPoint` `schema.prisma:211-213` | 自述 | 中-高 | **无 TTL** | FK 级联 + purge | admin CSV 含 comment（`admin/export.ts:130-153`） |
| F1 | 虚拟合成人设（可含 age、情绪触发、对抗/求助/失败模式） | `virtual_learner_profiles.profile/personalityTraits` `schema.prisma:872-899`；字段定义 `schemas.ts:30-69`（`age:33`、`emotionalTriggers:55`、`helpSeekingPattern:61`、`adversarialPattern:62`、`failurePatterns:66`） | **合成** | 非个人信息 | **无 TTL** | cleanup 全量级联 | admin `GET /:id/memory` |
| F2 | 虚拟会话轨迹 | `virtual_sessions.logs/stageResults` `schema.prisma:901-925` | 合成 | 非个人信息 | **24h 冷却窗 + 日志 90 天**（`log-retention.service.ts:14-19,293-345`） | cleanup 全量级联 | 虚拟侧端点 |

> 关键事实澄清（沿用并复核 `UPGRADE_DIRECTION_20Q.md` §3-5）：
> 密集心理特征（`helpSeekingPattern/adversarialPattern/emotionalTriggers/failurePatterns`）**只存在于虚拟 persona（F1，合成人设）**，
> **不是真实用户数据**；真实用户侧只有认知画像（C2/C4）+ 情绪画像（D1）+ 叙事（D4），且其中 `frustrationTolerance`（D2）与 `BehavioralBaseline`（D3）是**死默认**。
> 因此矩阵的真实高风险区是 **C2/C3/C4、D1/D4、E1**，不是文档原文列举的虚拟字段。

---

## 2. 差距清单（对照真实代码）

每条 = 缺口 + 已核验的代码证据。

### G1 无知情同意、无用途声明
- 全库检索：`users` 及 `schema.prisma` 中**无** `consent / agreement / purpose / 同意` 任何字段（`schema.prisma:810-856`）；注册/引导只有 `onboardingCompleted`（`users.ts:657-667`）。
- 结果：系统开始推断 C2/D1/D4 时，用户从未被明示"哪些数据被推断、用于什么"。

### G2 无未成年人策略（年龄门 / 家长同意 / 限制）
- `schema.prisma` 无 `age / birth / guardian / parental / minor` 字段（全库 grep 零命中）；`users` 无年龄。
- 虚拟 persona 有 `age`（`schemas.ts:33`），但**真实用户注册链路无年龄采集**，因此无法识别 K12 用户，也无法对未成年人关闭心理推断或实验。
- 对照 Q14/Q18：真实教学侧本就缺乏语义安全护栏，未成年人场景会被放大。

### G3 无数据主体自助导出 / 可携带
- 主体侧唯一导出：`GET /me/agent-logs/export`，**仅 `agent_call_logs`、上限 1000 行**（`users.ts:586-625`）；不含 C/D/E/B 任何一类画像或学习数据。
- admin 侧 CSV（`admin/export.ts:48-201`）是**管理员权限**、且限 20000 行、字段裁剪（profile/evidence/memory 都不导出）。
- 结果：用户无法取回"系统对我的画像与推断"。

### G4 学习数据无保留 TTL
- `log-retention.service.ts` 的保留对象只有 4 张日志表（`:29-35`）+ 虚拟会话轨迹裁剪（`:293-345`）；配置 `LOG_RETENTION_DAYS` 默认 90（`:8`）。
- **画像/证据/投影/记忆/会话/目标对话/反馈均无 TTL**（见 §1 矩阵"无 TTL"行）：`learner_evidence`、`learner_projections`、`memory_traces`、`goal_conversations`、`teaching_sessions`、`content_feedback`、`prediction_records`、`misconception_ledger` 全部长期保留。
- NF-P2-1 已把"Learner Evidence 保留期 / Projection TTL / Outbox TTL"列为**需决策**（`NON_FUNCTIONAL_GOVERNANCE_PLAN.md:747-757`）——本文承接，不重复。

### G5 无"自述 vs 推断"区分与仲裁（OLM 缺口）
- `LearnerModelProfile` 的认知/情绪/偏好字段是**单值**，无 `source/provenance` 字段（`types.ts:15-108`）。
- 聚合器逻辑：LLM 推断值**直接覆盖** `DEFAULT_*`（`profile-aggregator.ts:332-361` 的 merge 系列；`:120-124` 数据驱动校准直接改写 `selfAssessmentAccuracy`）。用户自述与系统推断在存储上**不可区分**。
- 无用户可查看/纠正入口：`/me/learner-center`（`users.ts:134-169`）只回快照只读，无"这是系统推断，我要纠正"的写回路径；写入只有 `updateProfile`（`index.ts:183-193`，内部聚合）。
- 无仲裁规则：无"冲突时以谁为准"的代码（全库无 `selfReported / self_report / provenance / arbitration` 命中）。

### G6 删除覆盖清单**彼此不一致且有漏**（已核验）
- 真实 purge 覆盖：9 张无 FK 表 + `users.deleteMany` 触发 FK 级联（`purge-soft-deleted-users.ts:30-41,144-152`）。
- 虚拟 cleanup 覆盖：显式 19 项清单（`virtual-cleanup.service.ts:21-42,164-194`）。
- **漏项**：`prediction_records`（`schema.prisma:650-672`）与 `misconception_ledger`（`:604-625`）均含 `userId`、**无 users 外键**，且**不在 purge 的 `FK_LESS_TABLES`（9 表）也不在 cleanup 清单**——删除用户后这两类会残留孤儿行（grep 两文件均零命中，已复核）。
- 两份清单还是**各写各的**，没有单一源；新增表容易再次漏。

### G7 导出与删除覆盖不一致
- G3 的导出只覆盖 `agent_call_logs` + admin 少量表；G6 的删除覆盖 9+ 张表与全量级联。二者**不是同一份覆盖矩阵**，用户会得到"删得比导得多"或反之的不一致承诺。

### G8 脱敏只覆盖密钥，不覆盖学习数据
- `secret-redaction.ts` / `logger.ts` 只对 API key/token 类值脱敏（`utils/secret-redaction.ts:20-24`、`logger.ts:35-36`、`admin-audit.middleware.ts:128-163`）；对 C/D/E 类画像与自由文本**无脱敏/掩码策略**。
- `agent_call_logs.metadata`（`users.ts:423-429` 前端可解析）与 LLM 日志可能携带会话上下文。

### G9 心理推断无"明示 + 可纠正"入口
- D1/D4 与 C4 从不向用户展示"这是推断"；`/me/learner-center` 返回 `LearnerSnapshot`（`types.ts:314-340`）但不区分来源。
- 与 G5 同源，但单独列为**伦理**问题：用户对"系统怎么看我"无知情权与更正权。

### G10 删除是手动的、且需停机
- 自助注销只做软删（`users.ts:254-262`：写 `deletedAt/deletedBy` + `tokenVersion`），历史数据保留（`schema.prisma:822-824` 注释明确）。
- 物理清除靠手动脚本 `purge-soft-deleted-users.ts`，其模块头注明"实际删除须在服务停机时执行"（`:25`）。NF-P2-1 验收项"用户删除流程覆盖所有在线派生记录"仍未闭环（`:753-758`）。

---

## 3. 建议基线（可执行）

> 原则：**不打断学习心流**、**只增不删（原始推断不覆盖）**、**删除与导出共用一份覆盖矩阵**、复用既有范式（`log-retention.service.ts` 定时清理、`virtual-cleanup.service.ts` 全量级联、`purge-soft-deleted-users.ts` 覆盖清单）。

### (a) 同意与用途透明的最小设计（不打断心流）

设计要点（建议，非结论）：
1. **分层同意**：首次进入产品时一屏"数据用途卡"（不是每一轮教学弹窗），列明实际存在的数据类与用途（对照 §1 矩阵 A–F）；将同意记录为事件。建议新增 `consent_records` 表（或 `users` 上的轻量字段），记录 `{userId, purposeCode, version, grantedAt, revokedAt, source}`，与 NF-P2-1 的"用户同意"对齐。
2. **用途与数据类一一映射**：用途码必须能映射到 §1 的类和实际消费代码（如"个性化难度"→ B1/B4；"教学画像"→ C2/C4/D1/D4）。
3. **持续可查**：设置页常驻"我同意的用途/我的数据"入口，复用 `users` 设置区，不改教学主链路。
4. **撤回同意的后果需明确**（属 §4 决策点，不在此下结论）。
5. 最小侵入实现顺序：先做**记录与展示**（同意台账 + 用途卡），再谈是否把同意作为数据处理的前置硬门。

### (b) 未成年人策略（年龄门 / 家长同意 / 内容与画像限制）

1. **年龄门**：注册或首次进入时采集**最小必要**年龄信息（年龄区间即可，避免存完整生日）；`users` 增加年龄区间字段（或独立表）。
2. **家长同意**：对低于阈值（阈值见 §4）的用户，走监护人同意流程；同意记录进 (a) 的 `consent_records`。
3. **内容与画像限制**（建议默认更保守）：
   - 对未成年人**默认关闭或限制心理推断类**（D1/D4 中"挫败模式/情绪触发"等）进入教学决策；只保留与学习直接相关的 B/C 类。
   - 未成年人**不参与** Q18 的真实用户分流/实验（呼应 `UPGRADE_DIRECTION_20Q.md` §2-Q18）。
   - 复用 Q14 建议的教学侧输入围栏/内容审核（安全层）作为前置。
4. 落地承载：注册/引导路由 + `consent_records` + 画像消费处的"是否未成年人"分支（消费点比存储点少，优先在消费侧加限制）。

### (c) 自述优先（Open Learner Model）——查看、纠正、并存与仲裁

目标：用户可**查看并纠正**系统推断；**不覆盖原始推断**，而是并存 + 可审计仲裁。这是对 G5/G9 的直接回应，也与 `UPGRADE_DIRECTION_20Q.md` §2-Q6（OLM 并入 Q16）一致。

设计要点（建议）：
1. **并存而非覆盖**：为可纠正字段增加 `selfReported*` 平行值 + `provenance`（`inferred | self_reported | reconciled`）与 `revision`。原始推断字段**保持不变**（审计/回滚/校准用）。
2. **面向用户的 OLM 视图**：在 `/me/learner-center`（`users.ts:134-169`）基础上，暴露"系统认为的你（推断）"与"你说的你（自述）"两栏，并提供纠正写入口；不进入教学主链路，纯用户侧。
3. **仲裁规则（建议草案，最终需拍板）**：
   - 事实/可观测类（如已掌握概念、任务状态）：以**代码裁决证据**（`learner_evidence`）优先。
   - 偏好/情绪/自评类（如学习偏好、动机、自信）：**自述优先**于 LLM 推断用于呈现与教学；推断值仅保留在后台与冲突台账。
   - 冲突不静默：写一条 `profile_conflict`（复用 `learner_evidence` 追加式事件范式，参考现有 `truth-discovery.ts` 代码裁决 > LLM 推断的思路）。
   - 仲裁结果可回滚（保留两值与时间线）。
4. **诚实的边界**：即使自述优先，也要在 UI 明示"系统仍会参考行为数据"，避免制造"完全由我说了算"的错觉。

### (d) 数据对外导出——"导出 = 删除的同一份覆盖矩阵"

1. **单一覆盖矩阵（single source of truth）**：抽出一份代码内可被**导出与删除共同消费**的表清单，来源即 §1 矩阵 + G6 漏项修复。建议在服务层定义 `LEARNER_DATA_COVERAGE`，删除脚本（`purge-soft-deleted-users.ts`）与虚拟级联（`virtual-cleanup.service.ts`）改为引用它，导出端点同样引用它。
2. **修复 G6 漏项**：把 `prediction_records`、`misconception_ledger` 纳入该矩阵（它们无 users 外键，必须显式按 `userId` 清理/导出）。
3. **主体自助导出**：新增数据主体导出端点（如 `GET /me/data-export`），按矩阵逐类打包 JSON/CSV（可复用现有 CSV 转义 `admin/export.ts:24-44`），覆盖 A–E 类真实用户数据（F 类合成人设不属于主体数据，应排除或单独标注）。导出格式/是否含原始 LLM prompt 属 §4 决策点。
4. **管理员导出对齐**：`admin/export.ts` 增加与矩阵一致的类目，避免"admin 能导、用户不能导"的不对称。
5. **可核验**：每次导出/删除产出一份 manifest（复用 `virtual-cleanup.service.ts:128-197` 的 before/after 审计范式），证明覆盖一致。

### (e) 保留期建议（引用并扩展现有 `log-retention.service.ts` 范式）

现状：仅 4 张日志表 + 虚拟会话轨迹有 TTL（`log-retention.service.ts:29-35,293-345`）。建议把同一套**定时清理 + dry-run + 批量删除 + 审计**范式扩展到学习数据，**按类给默认保留期**（具体天数属 §4 决策点）：

| 数据类 | 建议方向 | 依据/承载 |
|---|---|---|
| A 日志 | 维持 90 天默认，可配置 | `LOG_RETENTION_DAYS` `log-retention.service.ts:8,94-102` |
| B3 `learner_projections` | 短 TTL（**可重建**） | NF-P2-1 明确"可重建 Projection 有 TTL" `:748,757` |
| B5/B6 台账 | 随用户生命周期，纳入删除/导出矩阵 | G6 修复 |
| B1/B2/B4 学习证据/记忆 | 较长保留（产品/排期依赖），但需显式上限与配置 | 复用定时清理范式 |
| C/D 画像与叙事 | 与同意绑定；撤回同意/注销后按矩阵处理 | (a)(c)(d) |
| E 会话逐字记录 | 明确上限（最敏感），支持用户删除 | G8 脱敏 + (d) |
| F 虚拟合成 | 不适用真实用户保留；按虚拟管理策略 | `virtual-cleanup.service.ts` |

实现建议：扩展现有 `LOG_RETENTION_TABLES` 机制为"数据类 → 表/字段/时间列/保留期"的配置化清单，继续提供 `--dry-run`；**不新建第二套清理框架**。

---

## 4. 需产品/法务拍板的决策点（本文不下结论）

> 以下任一项都应**由产品/法务结合适用法域（GDPR / COPPA / FERPA / 中国个保法 PIIL 等）拍板**，工程侧只负责落地。

1. **同意的法定依据与文案**：采用何种合法依据、同意文案版本与语言；是否分层同意；撤回同意的具体后果（是否停止画像、是否删除历史推断）。
2. **心理推断的定性**：C2/C4、D1/D4 是否被认定为"特殊类别数据/敏感个人信息"；是否需要 DPIA/高风险评估；是否要求单独同意。
3. **未成年人阈值与机制**：年龄门槛选 13/14/16/18 的哪一档（可能随法域不同）；家长同意如何验证；对未成年人是否**完全关闭**心理推断与真实用户实验。
4. **保留期具体天数**：§3(e) 各方框内的具体保留天数（尤其 E 类逐字记录与 B 类证据）。
5. **导出范围与格式**：主体导出是否包含原始 LLM prompt/response（A 类）与逐字记录（E 类）；格式（JSON/CSV/打包）；是否需要人工审核后交付。
6. **自述优先的仲裁规则**：§3(c) 的仲裁草案最终以谁为准；冲突是否/如何影响教学决策；是否需要用户可见的"冲突说明"。
7. **删除与备份**：物理删除是否需覆盖备份（RPO/RTO）；备份中的删除例外期限与访问控制（NF-P2-1 `:750,758` 已列，仍需决策）。
8. **脱敏与存储加固**：画像/自由文本是否需要静态加密或列级掩码（G8）；访问日志与最小权限如何定义。
9. **"删除=导出"的承诺口径**：对外隐私政策上，导出与删除是否承诺同一覆盖集合，以及两者的时限 SLA。

---

## 5. 与既有文档的边界（避免重复建设）

| 层 | 已被谁覆盖 | 本文落点 |
|---|---|---|
| 基础设施安全（权限/SSRF/密钥/迁移） | `NON_FUNCTIONAL_GOVERNANCE_PLAN.md` + `SECURITY.md` | 不涉及 |
| 工程删除矩阵 / 保留 / 备份 | NF-P2-1（**需决策**，`NON_FUNCTIONAL_GOVERNANCE_PLAN.md:735-758`） | 承接并填实 §1 分类、§3(d)(e)、G4/G6/G7 |
| 伦理/同意/未成年人/自述优先 | **此前空白**（八问 §16 仅提出） | 本文 §2/§3/§4 |
| LLM 语义安全（注入/套取/内容审核） | `UPGRADE_DIRECTION_20Q.md` Q14 | 未成年人场景的前置依赖，不重复 |
| 教育公平（D_floor 等） | `UPGRADE_DIRECTION_20Q.md` Q13 | 未成年人策略与其分层审计衔接 |

---

## 附：本文核验结论索引（代码证据）

- 真实画像推断源：`backend/src/agents/learner-model-agent/types.ts:15-108`、`profile-aggregator.ts:200-260`（推断）、`:332-361`（覆盖默认）
- 死字段/死模块：`types.ts:53` + `profile-aggregator.ts:72`（`frustrationTolerance`）；`types.ts:23-29` + `profile-aggregator.ts:42-48,267-272`（`BehavioralBaseline`）
- 画像不落库（内存 5 分钟）：`services/learner/LearnerProfileService.ts:4-21`
- 合成人设字段（非真实用户）：`backend/src/skills/virtual-learner-shared/schemas.ts:30-69`
- 存储表：`backend/prisma/schema.prisma`（`goal_conversations:238`、`learning_metrics:295`、`teaching_sessions:476`、`learner_evidence:580`、`misconception_ledger:604`、`learner_projections:627`、`prediction_records:650`、`memory_traces:677`、`users:810`、`virtual_learner_profiles:872`、`virtual_sessions:901`）
- 删除：`backend/src/scripts/purge-soft-deleted-users.ts:30-41,98-107,144-152`；`backend/src/services/virtual-lab/virtual-cleanup.service.ts:21-42,113-126,164-194`
- 导出：`backend/src/routes/users.ts:586-625`（主体，仅 agent_call_logs）；`backend/src/routes/admin/export.ts:48-201`（admin CSV）
- 注销：`backend/src/routes/users.ts:222-274`
- 保留：`backend/src/services/log-retention.service.ts:8,29-35,293-345`
- NF-P2-1：`doc/NON_FUNCTIONAL_GOVERNANCE_PLAN.md:735-758,1009`
