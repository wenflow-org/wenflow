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

## 架构与治理

- [`NON_FUNCTIONAL_GOVERNANCE_PLAN.md`](./NON_FUNCTIONAL_GOVERNANCE_PLAN.md)
  - 安全、可靠性、测试、部署、可观测性、性能和数据治理统一清单
  - 发布阻断项、实施波次和发布验收标准
- [`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md)
  - 20 问（十二问 + 八问）方案 × 真实代码逐条核验 + 与项目业务对齐的升级方向（三波）
  - 结论口径：哪些方案已过期/记错、哪些现在能做、哪些缺基建；含核验中发现的即刻可修缺陷
- [`PRIVACY_DATA_GOVERNANCE_BASELINE.md`](./PRIVACY_DATA_GOVERNANCE_BASELINE.md)
  - Q16 数据治理基线：数据分类矩阵（行为/学习状态/认知画像/情绪推断/自由文本/虚拟合成人设）+ 差距清单 + 同意/未成年人/自述优先(OLM)/导出=删除同覆盖矩阵/保留期建议 + 需产品/法务拍板的决策点
- [`WAVE1_TRACK_A_VIRTUAL_CHAIN.md`](./WAVE1_TRACK_A_VIRTUAL_CHAIN.md)
  - 第一波 · Track A：虚拟学习者链路修复（检查点 payload / 定义漂移 / 时间上下文 / 策略收敛 / 虚拟侧降级）
- [`WAVE1_TRACK_B_TEACHING_GOVERNANCE.md`](./WAVE1_TRACK_B_TEACHING_GOVERNANCE.md)
  - 第一波 · Track B：真实教学侧治理（静默降级 / 语义安全 / 内容诚实 / 公平最小层）
- [`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)
  - 教育理论地图（理念宪法）：教学/心理/神经科学/LLM 理论 × 落点索引
  - 全部文献经联网核实（含 DOI/arXiv 链接）；prompt 规则与指标设计的理论依据引用源
- [`ADMIN_TERMINOLOGY_AUDIT.md`](./ADMIN_TERMINOLOGY_AUDIT.md)
  - Admin 运营台术语治理单源依据：术语族、禁用叫法与守卫规则
  - `frontend/src/views/admin-redesign/terms.ts`、`statusText.ts` 与术语守卫测试均以本文为准
- [`CONTEXT_MECHANISM_AUDIT.md`](./CONTEXT_MECHANISM_AUDIT.md)
  - 各阶段 skill 的**上下文机制审计**：真实调用遥测（输入体积 / 前缀缓存命中率）+ 优化方向
  - 结论：体积不是瓶颈，真正的杠杆是**前缀缓存命中率**（全局 20.9%）
- [`SCALE_PREREQUISITES_DESIGN.md`](./SCALE_PREREQUISITES_DESIGN.md)
  - 规模化前置设计基线（Q18 真实用户实验 / Q19 学习者生命周期 / Q20 单位经济）：现状核实 + 最小可行设计 + 前置决策点 + 验收里程碑
  - 承接 `UPGRADE_DIRECTION_20Q.md`「第三波 · 规模化前置」结论，仅为设计，不含实现
- [`NEW_FINDINGS_ASSESSMENT.md`](./NEW_FINDINGS_ASSESSMENT.md)
  - 虚拟学习者验证过程中新发现的三项问题评估（真实侧时间信号 / 路径失败无自愈 / 教学回合失败终局化）+ 优先级建议

## Agent 与场景

- [`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)
  - V3 字段路由模型：`agent-output-v1` 外壳约定、`internal.ext.*` 命名空间规范
- [`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md)（[en](./LEARNER_MODEL_ARCHITECTURE.en.md)）
  - 学习者模型场景设计：`LearnerSnapshot`、AI 介入时机、admin 观察与重算设计
- [`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md)
  - 学习者状态评审设计（LLM 诊断层 + 可配置 BKT）：补「诊断层」、投影止血、零训练时序信念更新与校准闭环
  - 硬约束：不引入额外/训练模型，全部走 prompt + LLM + 既有确定性代码
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

## 过程材料（不在仓库）

调查快照（SKILL_RUNTIME_MAP_MAIN/SIM）、设计过程（ORCHESTRATOR_FIELD_FLOW_REDESIGN、QUICK_LEARN 设计稿）、design/ 目录（主计划/诊断/草案）、CHANGES_* 改动记录与 doc/CHANGELOG 等历史过程材料已于 2026-09-05 清理（不纳入仓库）。prompt-lab/archive/ 中的 v2 遗留资产同步清理。

本机过程材料（设计稿、研究综述、日期快照、截图等）统一存放于 `doc/local/`（已被 gitignore，不进仓库）；`doc/` 根目录只保留纳入 git 的现行有效文档。
