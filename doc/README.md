# 设计文档索引

> 目录约定：根目录 = 现行有效文档；`archive/` = 被取代的历史版本；`history/` = 按类型和月份归档的时间点产物；`design/` = 专项设计稿。
>
> 版本控制：doc/ 现行规范文档已纳入 git（2026-08-10），变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)；`archive/` 与 `history/` 保持不追踪。

## 协议与 Prompt 体系

- [`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)
  - 统一 Skill 协议 v4 规则文档（核心文件 core.yaml / 六材料池 / 五块编译产物 / 守门三查 / SkillResult）
  - 后续 AI 开发、重构的最高指导准则（v4.1-draft：新增 §2.6 编排文件章节，编排文件为字段路由唯一源）
- [`PROMPT_AUTHORING_PROTOCOL.md`](./archive/PROMPT_AUTHORING_PROTOCOL_v2.md)（已归档 2026-08-09）
  - Prompt 编写协议 v2（原现行 ACTIVE）：八类标准块 / archetype 矩阵 / promptContract / runtimeContract
  - 归档原因：LLM 部分已被 v4 取代；code-only 约束并入 v4.1
- [`PROMPT_PROTOCOL_V4_PREWORK_SURVEY.md`](./PROMPT_PROTOCOL_V4_PREWORK_SURVEY.md)
  - v4 预改造调查：25 个 prompt 结构盘点、运行时链路、材料池适配、基建落点与 M0 清单（M0 已完成输入 2026-07-27，仅供参考）
- [`PROMPT_MANAGEMENT_GUIDE.md`](./archive/PROMPT_MANAGEMENT_GUIDE.md)（已归档 2026-08-09）
  - Prompt 管理指南（File-as-Truth 架构）：文件为准、DB 为镜像（v2 旧编译模型，与 v4 版本模型互斥）
- [`PROMPT_COMPILE_GLOSSARY.md`](./archive/PROMPT_COMPILE_GLOSSARY.md)（已归档 2026-08-09）
  - Prompt 编译概念术语表（旧 prompt-compiler 编译术语，仅描述遗留子系统）
- [`PROMPT_RECOVERY_MATRIX.md`](./PROMPT_RECOVERY_MATRIX.md)
  - Prompt 恢复矩阵：各 skill prompt 的可恢复来源（随 prompt-lab sources 退役而失效）

## 架构与治理

- [`ARCHITECTURE_BASELINE_2026-07.md`](./ARCHITECTURE_BASELINE_2026-07.md)
  - 基于当前代码的前后端、AI Skill、数据、事件和部署架构基线
  - 核心业务链路与当前风险摘要
- [`ARCHITECTURE_ALIGNMENT_AND_REMEDIATION_PLAN.md`](./ARCHITECTURE_ALIGNMENT_AND_REMEDIATION_PLAN.md)
  - Prompt 漂移、Agent/Skill 概念错位和事件链错位说明
  - P0/P1/P2 修复顺序、依赖关系与验收标准
- [`NON_FUNCTIONAL_GOVERNANCE_PLAN.md`](./NON_FUNCTIONAL_GOVERNANCE_PLAN.md)
  - 安全、可靠性、测试、部署、可观测性、性能和数据治理统一清单
  - 发布阻断项、实施波次和发布验收标准
- [`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)
  - 教育理论地图（理念宪法）：教学/心理/神经科学/LLM 理论 × 落点索引
  - 全部文献经联网核实（含 DOI/arXiv ID）；prompt 规则与指标设计的理论依据引用源
- [`design/LEARN_AGENT_CENTRALIZATION_PLAN.md`](./design/LEARN_AGENT_CENTRALIZATION_PLAN.md)
  - Learn Agent 中心化改造主计划（2026-08）：唯一进度真相源
  - profile-agent 统一出口 / 复习闭环 / loadIndex 消费 / 多目标预算 / 工程补强 / 死代码退役

## Agent 与场景

- [`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)
  - V3 字段路由模型：`agent-output-v1` 外壳约定、`internal.ext.*` 命名空间规范
- [`STAGE_MIGRATION_GUIDE.md`](./archive/STAGE_MIGRATION_GUIDE.md)（已归档 2026-08-09）
  - stage / skill / orchestrator 迁移到 V3 字段路由模型的实操手册（字段路由单源化已完成，编排文件为唯一源）
- [`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)（[en](./LEARNER_MODEL_ARCHITECTURE.en.md)）
  - 学习者模型场景设计：`LearnerSnapshot`、AI 介入时机、admin 观察与重算设计
- `session-wrapup-agent`（已落代码，待进一步文档拆分）
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
- [`VIRTUAL_LEARNER_QUICK_LEARN_DESIGN_2026-07-21_091152.md`](./VIRTUAL_LEARNER_QUICK_LEARN_DESIGN_2026-07-21_091152.md)
  - quick-learn 快速学习模式设计（被 backend quick-learn 代码引用）

## 归档与历史

- `archive/`：被取代的协议与设计（含 UNIFIED_SKILL_PROTOCOL v1/v2、PROMPT_PROTOCOL_V4_DESIGN、GOAL_CONVERSATION_LAYERING_NOTE、PROMPT_AUTHORING_PROTOCOL v1.2/v2、PROMPT_MANAGEMENT_GUIDE、PROMPT_COMPILE_GLOSSARY、STAGE_MIGRATION_GUIDE（均 2026-08-09 归档）等）
- `history/snapshots/YYYY-MM/`：基于当时代码的功能或架构快照，不作为现行实现依据
- `history/analysis/YYYY-MM/`：阶段性分析、研究问题和接入建议
- `history/design/YYYY-MM/`：已完成、部分落地或已被后续方案调整的专项设计
- `history/notes/YYYY-MM/`：时间点笔记（含 ORCHESTRATOR_TO_AGENT_MIGRATION、API 网关可靠性设计快照）
- `history/reports/YYYY-MM/`：时间点报告（含 WENFLOW_FUNCTIONAL_MODULE_REPORT、安全/迁移报告）
- `design/`：专项设计稿（platform-capabilities-design）

### 已归档（2026-08-11）

以下 10 份调查/规格文档使命已完成，结论已被实施吸收，移入 `archive/` 作背景参考：

- [`RETIRED_SKILLS_FIX_PLAN.md`](./archive/RETIRED_SKILLS_FIX_PLAN.md) — 退役名单单源化 → `retired-skills.ts` 已建立
- [`YAML_UNIFICATION_AUDIT.md`](./archive/YAML_UNIFICATION_AUDIT.md) — YAML 生态统一化 → yaml-vocabulary 已建立
- [`DATASOURCE_P4_SURVEY.md`](./archive/DATASOURCE_P4_SURVEY.md) — dataSource 决策调查 → `dataSource` 已声明
- [`SCAFFOLD_P5_SURVEY.md`](./archive/SCAFFOLD_P5_SURVEY.md) — admin 新建 Skill 向导调查 → scaffold 已实现
- [`SKILL_READINESS_SPEC.md`](./archive/SKILL_READINESS_SPEC.md) — 完成度状态机规格 → readiness/状态机已实现
- [`SKILL_LIFECYCLE_SURVEY.md`](./archive/SKILL_LIFECYCLE_SURVEY.md) — 注册链全景调查 → skills.yaml 已上线
- [`SKILL_DIAGNOSTICS_SURVEY.md`](./archive/SKILL_DIAGNOSTICS_SURVEY.md) — 诊断面全景调查 → 诊断建议已实施
- [`MCP_DOMAIN_SURVEY.md`](./archive/MCP_DOMAIN_SURVEY.md) — MCP 域机制调查 → 调查使命完成
- [`CONFIG_SECURITY_CLEANUP.md`](./archive/CONFIG_SECURITY_CLEANUP.md) — 配置安全审计 → 安全清理已实施
- [`SKILLS_YAML_SPEC.md`](./archive/SKILLS_YAML_SPEC.md) — skills.yaml 实施规格 → skills.yaml 已上线

### 2026-04 至 2026-05 历史材料

以下文档记录早期平台扫描与设计演进。涉及当前架构、运行链路或协议时，应优先以本索引中的现行文档为准。

- 快照
  - [`PLATFORM_ARCHITECTURE_SNAPSHOT.md`](./history/snapshots/2026-04/PLATFORM_ARCHITECTURE_SNAPSHOT.md)
  - [`CODE_FUNCTION_INVENTORY.md`](./history/snapshots/2026-04/CODE_FUNCTION_INVENTORY.md)
- 分析
  - [`EVOLUTIONARY_LEARNING_FEATURE_ANALYSIS.md`](./history/analysis/2026-04/EVOLUTIONARY_LEARNING_FEATURE_ANALYSIS.md)
  - [`LEARN_PIPELINE_ANALYSIS.md`](./history/analysis/2026-05/LEARN_PIPELINE_ANALYSIS.md)
- 设计
  - [`LEARN_STAGE_ARCHITECTURE.md`](./history/design/2026-05/LEARN_STAGE_ARCHITECTURE.md)（部分落地）
  - [`LEARNER_BACKGROUND_ORCHESTRATION.md`](./history/design/2026-05/LEARNER_BACKGROUND_ORCHESTRATION.md)（部分落地）
  - [`VIRTUAL_LEARNER_CONTROL_CENTER_REDESIGN.md`](./history/design/2026-05/VIRTUAL_LEARNER_CONTROL_CENTER_REDESIGN.md)（部分落地）
