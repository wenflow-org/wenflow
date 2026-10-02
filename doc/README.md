# 设计文档索引

> 目录约定：根目录（doc/ 下）列出的 = **仓库内现行有效文档**（纳入 git，GitHub 可见）。
> archive/、history/、design/、调查快照与历史改动记录等**过程材料仅存于本机**，不纳入 git（2026-09-05 起），不在本索引列链接；
> 需要时以 doc/ 根目录现行文档与代码为准。
> **登记门禁（2026-09-28 起）**：新文档入库三件套 = 白名单 + 本表登记 + 状态头；实现与「不做」声明相悖须同提交改文档。

## 总索引（39 篇 · 全覆盖 · 2026-09-28）

> 每篇文档头部有状态行（📌 类型｜最后核验）。**登记约定**：新增 doc/ 文档须同时 ①加入根 .gitignore 白名单 ②登记本表 ③写状态头；凡实现与文档「不做/待办」声明相悖的改动，须同一提交内更新该文档声明。审计详见 doc/local/DOC-TIMELINESS-AUDIT-2026-09-28（本机）。

| 文档 | 类型 | 备注 |
|---|---|---|
| SKILL_PROTOCOL_V4.md | 活规范 | Skill 协议 SSOT（二级编译已退役） |
| MODEL_GATEWAY_DESIGN.md | 活规范 | 网关 SSOT |
| PROMPT_CACHE_OPTIMIZATION.md | 活规范 | 缓存优化（32k SSOT 已回写） |
| PROMPT_ADJUSTMENT_GUIDE.md | 活规范 | 提示词调整操作指南 |
| SKILL_DEVELOPMENT_GUIDE.md | 活规范 | 新建/改造 Skill 指南（§2 CLI 优先） |
| AGENT_SKILL_MANUAL.md | 活规范 | Agent/Skill 全景 why |
| KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md | 活规范 | KC 概念身份+图（95%） |
| KC_MULTIPATH_AND_LEARNER_SIGNAL_SCOPE.md | 活规范 | KC 多路径+学习者信号（§2 结论仍成立） |
| LEARNER_CENTER_AND_STATE_FUSION.md | 活规范 | 学习者中心/状态融合（§3.3 已接线） |
| LEARNER_MODEL_ARCHITECTURE.md（.en） | 活规范 | 学习者模型（Phase 5 已消费；§6/§10/§11 待补） |
| LEARNER_STATE_REVIEW_DESIGN.md | 设计留痕 | 🔴 三张表未建，照抄会建错表 |
| PATH_PRODUCTION_REPLAN_CONTRACT.md（.en） | 活规范 | ⚠️ 已知待办：2 处 409 判定 |
| PATH_ANDERSON_ITERATION_NOTE.md（.en） | 设计留痕（已归档） | 砍二阶段的唯一决策留痕 |
| SESSION_JSON_INCREMENTAL_DESIGN.md | 活规范 | 会话 JSON 增量（~95%） |
| VIRTUAL_LEARNER_DESIGN.md | 活规范 | VL 主文档（裁判已独立） |
| VIRTUAL_LEARNER_CHAIN.md | 活规范 | VL 链路 SoT（16/17） |
| VIRTUAL_LEARNER_PRESET_DESIGN.md | 设计留痕（已归档） | 真源已迁 presets.yaml v4 |
| VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md | 活规范 | ⚠️ 抬头待更新「已落地」 |
| VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md | 设计留痕 | ⚠️ 抬头已失准，全套修订待做 |
| AGENT_IO_DESIGN_V3.md | 设计留痕（部分归档） | §1-4 由 V4 §2.6 承接 |
| UPGRADE_DIRECTION_20Q.md | 治理台账 | Q12 已改「已实施」 |
| NON_FUNCTIONAL_GOVERNANCE_PLAN.md | 治理计划 | ⚠️ 状态基线 2026-07-17 |
| EDUCATIONAL_THEORY_MAP.md | 参考资料 | 理论地图（文献已核实） |
| ADMIN_TERMINOLOGY_AUDIT.md | 活规范 | 术语 SSOT（不可归档） |
| ADMIN_VISUAL_LAYER_SPEC.md | 活规范 | ⛔ 禁归档（守卫硬引用）｜v4 已接设计体系包，令牌层/圆角/阴影/材质收口完毕 |
| ADMIN_COLUMN_WIDTH_SPEC.md | 活规范 | 48/48 全中 |
| ADMIN_PAGE_TEMPLATES.md | 活规范（待拆分） | 1569 行 → ≤330 方案已定 |
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
