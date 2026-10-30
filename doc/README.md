# 设计文档索引

> 目录约定：根目录（doc/ 下）列出的 = **仓库内现行有效文档**（纳入 git，GitHub 可见）。
> archive/、history/、design/、调查快照与历史改动记录等**过程材料仅存于本机**，不纳入 git（2026-09-05 起），不在本索引列链接；
> 需要时以 doc/ 根目录现行文档与代码为准。
> **登记门禁（2026-09-28 起）**：新文档入库三件套 = 白名单 + 本表登记 + 状态头；实现与「不做」声明相悖须同提交改文档。

## 总索引（doc/ 根 42 篇 · 全覆盖 · 2026-10-29）

> 每篇文档头部有状态行（📌 类型｜最后核验）。**登记约定**：新增 doc/ 文档须同时 ①加入根 .gitignore 白名单 ②登记本表 ③写状态头；凡实现与文档「不做/待办」声明相悖的改动，须同一提交内更新该文档声明。审计详见 doc/local/DOC-TIMELINESS-AUDIT-2026-09-28（本机）。

| 文档 | 类型 | 备注 |
|---|---|---|
| SKILL_PROTOCOL_V4.md | 活规范 | Skill 协议 SSOT（二级编译已退役） |
| MODEL_GATEWAY_DESIGN.md | 活规范 | 网关 SSOT |
| PROMPT_CACHE_OPTIMIZATION.md | 活规范 | 缓存优化（32k SSOT 已回写） |
| PROMPT_ADJUSTMENT_GUIDE.md | 活规范 | 提示词调整操作指南 |
| SKILL_DEVELOPMENT_GUIDE.md | 活规范 | 新建/改造 Skill 指南（§2 CLI 优先） |
| AGENT_SKILL_MANUAL.md | 活规范 | Agent/Skill 全景 why |
| PIPELINE_MAP.md | 生成物 | 场景→Agent→Prompt 全管线索引（`pipeline:map` 生成，勿手改） |
| PIPELINE_PROMPTS.md | 生成物 | 全部提示词原文汇编，按场景归档（同上） |
| KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md | 活规范 | KC 概念身份+图（95%） |
| KC_MULTIPATH_AND_LEARNER_SIGNAL_SCOPE.md | 活规范 | KC 多路径+学习者信号（§2 结论仍成立） |
| LEARNER_CENTER_AND_STATE_FUSION.md | 活规范 | 学习者中心/状态融合（§3.3 已接线） |
| LEARNER_MODEL_ARCHITECTURE.md（.en） | 活规范 | 学习者模型（Phase 5 已消费；§6/§10/§11 待补） |
| LEARNER_STATE_REVIEW_DESIGN.md | 设计留痕 | ⚠️ 文内表名与现状不符，已锚定 learner_projections（见文内复核行） |
| PATH_PRODUCTION_REPLAN_CONTRACT.md（.en） | 活规范 | ⚠️ 已知待办：2 处 409 判定 |
| PATH_ANDERSON_ITERATION_NOTE.md（.en） | 设计留痕（已归档） | 砍二阶段的唯一决策留痕 |
| SESSION_JSON_INCREMENTAL_DESIGN.md | 设计留痕（已落地） | 会话大 JSON 列增量化设计与验收清单 |
| VIRTUAL_LEARNER_DESIGN.md | 活规范 | VL 主文档（裁判已独立） |
| VIRTUAL_LEARNER_CHAIN.md | 活规范 | VL 链路 SoT（16/17） |
| VIRTUAL_LEARNER_PRESET_DESIGN.md | 设计留痕（已归档） | 真源已迁 presets.yaml v4 |
| VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md | 活规范 | 页面侧已落地（e2af8f7/ce8c983/b57c480）；系统层 ③④ 见正文 |
| VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md | 设计留痕 | ⚠️ 抬头已失准，全套修订待做 |
| AGENT_IO_DESIGN_V3.md | 设计留痕（部分归档） | §1-4 由 V4 §2.6 承接 |
| UPGRADE_DIRECTION_20Q.md | 治理台账 | Q12/Q18 分级串位已修正；「向量/embedding/材料库」过期全局声明已回收 |
| NON_FUNCTIONAL_GOVERNANCE_PLAN.md | 治理计划 | ⚠️ 状态基线 2026-07-17 |
| EDUCATIONAL_THEORY_MAP.md | 参考资料 | 理论地图（文献已核实） |
| DIAGRAM_PEDAGOGY_RESEARCH.md | 参考资料 | 教学图证据分级（A–D）与 15 图型实证盘点 |
| ADMIN_TERMINOLOGY_AUDIT.md | 活规范 | 术语 SSOT（不可归档） |
| ADMIN_OPERATIONS_MANUAL.md | 活规范 | 管理端运营操作手册（路由 → 职责、指标口径、动作名、SOP + YAML 速查） |
| ADMIN_VISUAL_LAYER_SPEC.md | 活规范 | ⛔ 禁归档（守卫硬引用）｜v4 已接设计体系包，令牌层/圆角/阴影/材质收口完毕 |
| NEWUI-PROTOTYPES.md | 活规范 | newui 原型登记与「原型值残留」规则（基准层级：tokens.css/spec v4 > 原型 > 历史文档） |
| ADMIN_COLUMN_WIDTH_SPEC.md | 活规范 | 48/48 全中 |
| ADMIN_PAGE_TEMPLATES.md | 历史快照（已存档） | 2026-10-02 存档；惟 R2 状态语义色 / 危险确认约定仍被活代码引用，2026-10-16 已迁 spec §0.5 |
| ADMIN_TABS_BUSINESS_AUDIT.md | 历史审计 | 未核验 |
| ADMIN_MODULE_BENCHMARK.md | 历史快照 | 未核验 |
| CONTEXT_MECHANISM_AUDIT.md | 历史审计 | 缓存基线为改造前口径 |
| LEARNING_SCIENCE_AUDIT.md | 历史审计 | 科学性判断仍有效 |
| DEV_SCRIPTS.md | 活规范 | 脚本唯一索引（86 条零失效） |
| ADMIN_UI_WALKTHROUGH.md | 历史快照 | 已迁 doc/re_test/ |
| ADMIN_PAGE_AUDIT.md | 历史快照 | 已迁 doc/re_test/ |
| README.md / README.en.md | 索引 | 本文档 |
| re_test/（3 篇） | 历史快照 | 归档头已加 |


## 协议与 Prompt 体系

- [`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)
  - 统一 Skill 协议 v4 规则文档（核心文件 core.yaml / 六材料池 / 五块编译产物 / 守门三查 / SkillResult）
  - 后续 AI 开发、重构的最高指导准则（v4.1：新增 §2.6 编排文件章节，编排文件为字段路由唯一源）
- [`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md)
  - Skill 开发指南（开发者向）：选型 → scaffold → 接线 → 加字段 → 门禁 → 发布 → 测试（2026-08-12）
- [`AGENT_SKILL_MANUAL.md`](./AGENT_SKILL_MANUAL.md)
  - Agent / Skill 全景与缘由（开发者向）：每个顶层 Agent 与 Skill 的**为什么**（功能缘由 / 设计意图 / 边界 / 五阶段数据旅程）
  - 与自动生成的 `prompts/AGENTS_SELF_INTRO.md`（机械附录，只有 what）互补，是 "how-to" 开发指南前面的 "why"；**开发文档，不是平台功能/能力说明**
- [`PIPELINE_MAP.md`](./PIPELINE_MAP.md) / [`PIPELINE_PROMPTS.md`](./PIPELINE_PROMPTS.md)
  - 自动生成的全管线视图：场景为一级轴、Agent 为二级轴、Prompt 为三级轴；后者逐篇嵌入 `prompts/core/*.yaml` 原文
  - 改管线后运行 `npm --prefix backend run pipeline:map` 刷新，`pipeline:map:check` 做漂移校验

## 架构与治理

- [`NON_FUNCTIONAL_GOVERNANCE_PLAN.md`](./NON_FUNCTIONAL_GOVERNANCE_PLAN.md)
  - 安全、可靠性、测试、部署、可观测性、性能和数据治理统一清单
  - 发布阻断项、实施波次和发布验收标准
- [`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md)
  - **20 问合并总纲（单一结论文档）**：教学实验/Demo 定位下的逐条核验（Q1–Q20）+ 分级（核心/轻量保留/不做）+ 升级方向
  - 原第一波 Track A/B、Q16 数据治理基线、Q18–Q20 规模化前置、虚拟验证新发现评估的结论已全部并入本文
  - 结论口径：哪些方案已过期/记错、哪些是本定位下的实验核心、哪些属商业级不做；含核验中发现的即刻可修缺陷与提交台账
- [`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)
  - 教育理论地图（理念宪法）：教学/心理/神经科学/LLM 理论 × 落点索引
  - 全部文献经联网核实（含 DOI/arXiv 链接）；prompt 规则与指标设计的理论依据引用源
- [`DIAGRAM_PEDAGOGY_RESEARCH.md`](./DIAGRAM_PEDAGOGY_RESEARCH.md)
  - 教学图的理论依据与证据分级（A/B/C/D）：表征效应、知觉推断、冗余与专家反转、评审方法
  - 15 个图型逐一标注图型级实证等级；含 2023–2025 新研究与本仓库 744 张图的实测数据（分列）
- [`ADMIN_TERMINOLOGY_AUDIT.md`](./ADMIN_TERMINOLOGY_AUDIT.md)
  - Admin 运营台术语治理单源依据：术语族、禁用叫法与守卫规则
  - `frontend/src/views/admin-redesign/terms.ts`、`statusText.ts` 与术语守卫测试均以本文为准
- [`CONTEXT_MECHANISM_AUDIT.md`](./CONTEXT_MECHANISM_AUDIT.md)
  - 各阶段 skill 的**上下文机制审计**：真实调用遥测（输入体积 / 前缀缓存命中率）+ 优化方向
  - 结论：体积不是瓶颈，真正的杠杆是**前缀缓存命中率**（全局 20.9%）

## Agent 与场景

- [`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)
  - V3 字段路由模型：`agent-output-v1` 外壳约定、`internal.ext.*` 命名空间规范
- [`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)（[en](./LEARNER_MODEL_ARCHITECTURE.en.md)）
  - 学习者模型场景设计：`LearnerSnapshot`、AI 介入时机、admin 观察与重算设计
- [`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md)
  - 学习者状态评审设计（LLM 诊断层 + 可配置 BKT）：补「诊断层」、投影止血、零训练时序信念更新与校准闭环
  - 硬约束：不引入额外/训练模型，全部走 prompt + LLM + 既有确定性代码
- [`LEARNER_CENTER_AND_STATE_FUSION.md`](./LEARNER_CENTER_AND_STATE_FUSION.md)
  - Q6/Q7 专门说明（开发者向）：学习者模型的**通用维度 vs 项目特异维度**；状态/知识的**聚合→拆分→融合→评估**怎么做、哪些已接线、哪些未接线
- `skill:session-wrapup`（旧名 `session-wrapup-agent`，保留为 alias，已落代码）
  - 统一生成课后总结与评估
  - 当前主链路已替代 `summary-agent + session-evaluation-agent`

## 路径相关

- [`PATH_PRODUCTION_REPLAN_CONTRACT.md`](./PATH_PRODUCTION_REPLAN_CONTRACT.md)（[en](./PATH_PRODUCTION_REPLAN_CONTRACT.en.md)）
  - 路径生产链路与 replan 契约
- [`PATH_ANDERSON_ITERATION_NOTE.md`](./PATH_ANDERSON_ITERATION_NOTE.md)（[en](./PATH_ANDERSON_ITERATION_NOTE.en.md)）
  - 路径 enrichment / Anderson 标注迭代说明

## 虚拟学习者

- [`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)
  - 虚拟学习者链路 Source of Truth：persona / 故事 / 会话模拟 / 裁判
- [`VIRTUAL_LEARNER_PRESET_DESIGN.md`](./VIRTUAL_LEARNER_PRESET_DESIGN.md)
  - 预制虚拟学习者设计稿 v0（历史设计；真源已迁 `virtual-learners/presets.yaml` v4——19 条，2026-09-27）
- [`VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md`](./VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md)
  - 日期模拟与学习负担评估设计：跨日语义、系统层契约、页面落点、待做清单
- [`VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md`](./VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md)
  - 日期模拟接口冻结清单：系统层 ↔ 页面层的分工边界与数据契约

## 开发工具

- [`DEV_SCRIPTS.md`](./DEV_SCRIPTS.md)
  - 开发脚本手册：三个脚本目录的定位与命名约定、虚拟学习者跑批链路、可复用工具索引（门禁 / 审计 / 探针 / 回填 / 运维 / 评测）、一次性脚本的识别与归档约定

---

## 过程材料（不在仓库）

调查快照（SKILL_RUNTIME_MAP_MAIN/SIM）、设计过程（ORCHESTRATOR_FIELD_FLOW_REDESIGN、QUICK_LEARN 设计稿）、design/ 目录（主计划/诊断/草案）、CHANGES_* 改动记录与 doc/CHANGELOG 等历史过程材料已于 2026-09-05 清理（不纳入仓库）。prompt-lab/archive/ 中的 v2 遗留资产同步清理。

本机过程材料（设计稿、研究综述、日期快照、截图等）统一存放于 `doc/local/`（已被 gitignore，不进仓库）；`doc/` 根目录只保留纳入 git 的现行有效文档。

**2026-10-16 整理**：`doc/` 根目录下三份未入库文件移入 `doc/local/`——`ADMIN-OPERATIONS-MANUAL.md`（连字符拼写的运营手册并行草稿，真源为 `ADMIN_OPERATIONS_MANUAL.md`；其独有章节「其余页面简表」「术语与状态字典」未并入真源，仅存本机副本）、`USER_SIDE_QA_REPORT.md`（2026-09-18 用户侧走查）、`agent-usage-audit-2026-09-22.md`（Agent 使用调查）。同批补入 11 个「已跟踪但漏登记白名单」的文档，并登记 `NEWUI-PROTOTYPES.md`。

**2026-10-17 教学链提示词审计两版正主判定**（两版正文均留在本机 `doc/local/`，不入库；此处只登记判定结论，供远端复核）：

- 正主：`doc/local/TEACH-SKILL-PROMPT-AUDIT-2026-10-06.md` —— 61 条发现（P1/P2/P3 = 18/36/7，v2.1）；2026-10-07 并行写入冲突的说明见其第 8 行。引用审计结论以此为准。sha256 `55458677b272fa4ee28448f8e650d7cb39d4a098fecc514e425c124189c4b019`。
- 非正主快照：`doc/local/TEACH-SKILL-PROMPT-AUDIT-2026-10-06.b65f-parallel-snapshot.md` —— 另一批审计输入（65 条发现，P1/P2/P3 按发现数 15/27/23；正文 64 个编号，因 P1-02 合并两条同根发现），仅用于追溯被覆盖的版本；文首第 3 行已标注「非正主快照，仅供参考」。sha256 `b055136aa204d3a5f4b359be422d7132d5406c37428202309122fbbc7e98f67b`。
- 两版正文转录了生产 DB 样本，故按本小节的约定留在本机、不纳入 git；外部复核如需正文，请向本机持有者索取并按上面的 sha256 校验。
