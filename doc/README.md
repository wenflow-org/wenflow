# 设计文档索引

> 目录约定：根目录（doc/ 下）列出的 = **仓库内现行有效文档**（纳入 git，GitHub 可见）。
> archive/、history/、design/、调查快照与历史改动记录等**过程材料仅存于本机**，不纳入 git（2026-09-05 起），不在本索引列链接；
> 需要时以 doc/ 根目录现行文档与代码为准。

## 协议与 Prompt 体系

- [`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)
  - 统一 Skill 协议 v4 规则文档（核心文件 core.yaml / 六材料池 / 五块编译产物 / 守门三查 / SkillResult）
  - 后续 AI 开发、重构的最高指导准则（v4.1-draft：新增 §2.6 编排文件章节，编排文件为字段路由唯一源）
- [`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md)
  - Skill 开发指南（开发者向）：选型 → scaffold → 接线 → 加字段 → 门禁 → 发布 → 测试（2026-08-12）

## 架构与治理

- [`NON_FUNCTIONAL_GOVERNANCE_PLAN.md`](./NON_FUNCTIONAL_GOVERNANCE_PLAN.md)
  - 安全、可靠性、测试、部署、可观测性、性能和数据治理统一清单
  - 发布阻断项、实施波次和发布验收标准
- [`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)
  - 教育理论地图（理念宪法）：教学/心理/神经科学/LLM 理论 × 落点索引
  - 全部文献经联网核实（含 DOI/arXiv 链接）；prompt 规则与指标设计的理论依据引用源

## Agent 与场景

- [`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)
  - V3 字段路由模型：`agent-output-v1` 外壳约定、`internal.ext.*` 命名空间规范
- [`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)（[en](./LEARNER_MODEL_ARCHITECTURE.en.md)）
  - 学习者模型场景设计：`LearnerSnapshot`、AI 介入时机、admin 观察与重算设计
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

---

## 不在仓库的过程材料（仅本机）

- `archive/`：被取代的协议与设计（UNIFIED_SKILL_PROTOCOL v1/v2、PROMPT_AUTHORING_PROTOCOL v1.2/v2、STAGE_MIGRATION_GUIDE 等）
- `history/`：时间点产物（snapshots / analysis / design / notes / reports，按 YYYY-MM 归档）
- `design/`：专项设计稿（主计划、UI/UX 诊断、未落地草案等）
- 调查快照：`SKILL_RUNTIME_MAP_MAIN/SIM.md`（2026-08 运行时调查，只读、行号可能过期）
- 过程记录：`ORCHESTRATOR_FIELD_FLOW_REDESIGN.md`、`VIRTUAL_LEARNER_QUICK_LEARN_DESIGN_*.md`（quick-learn 源码注释曾引用其章节，已改为按实现说明）、`CHANGES_*.md`、`doc/CHANGELOG.md`
