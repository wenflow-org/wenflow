# 设计文档索引

> 目录约定：根目录（doc/ 下）列出的 = **仓库内现行有效文档**（纳入 git，GitHub 可见）。
> archive/、history/、design/、调查快照与历史改动记录等**过程材料仅存于本机**，不纳入 git（2026-09-05 起），不在本索引列链接；
> 需要时以 doc/ 根目录现行文档与代码为准。

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

## 开发工具

- [`DEV_SCRIPTS.md`](./DEV_SCRIPTS.md)
  - 开发脚本手册：三个脚本目录的定位与命名约定、虚拟学习者跑批链路、可复用工具索引（门禁 / 审计 / 探针 / 回填 / 运维 / 评测）、一次性脚本的识别与归档约定

---

## 过程材料（不在仓库）

调查快照（SKILL_RUNTIME_MAP_MAIN/SIM）、设计过程（ORCHESTRATOR_FIELD_FLOW_REDESIGN、QUICK_LEARN 设计稿）、design/ 目录（主计划/诊断/草案）、CHANGES_* 改动记录与 doc/CHANGELOG 等历史过程材料已于 2026-09-05 清理（不纳入仓库）。prompt-lab/archive/ 中的 v2 遗留资产同步清理。

本机过程材料（设计稿、研究综述、日期快照、截图等）统一存放于 `doc/local/`（已被 gitignore，不进仓库）；`doc/` 根目录只保留纳入 git 的现行有效文档。
