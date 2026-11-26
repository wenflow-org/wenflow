# 设计文档索引

> 收录范围：`doc/` 只收**现行有效**的规范、设计方案、参考资料与结果台账，并且只写结论。
> 过程材料（报告、审计、快照、跑批留痕、设计过程稿）只留本机：`doc/local/` 与 `docs/` 均已被 gitignore，不进仓库。
> 登记约定：新增文档须同时 ①加入根 `.gitignore` 白名单 ②登记本表 ③在标题后写状态头 `> 📌 类型：<活规范｜设计方案｜参考资料｜结果台账>（一句话）`。

## 总索引

| 文档 | 类型 | 备注 |
|---|---|---|
| SKILL_PROTOCOL_V4.md | 活规范 | Skill 协议 SSOT（core YAML / 编译产物 / 守门） |
| MODEL_GATEWAY_DESIGN.md | 活规范 | 模型网关 SSOT（注册表、路由解析、生成参数、可靠性、传输层） |
| MODEL_SETUP_AND_CONFIG_DESIGN.md | 设计方案 | 从部署到 Skill 细调的模型接入与配置（含插件降级） |
| PROMPT_CACHE_OPTIMIZATION.md | 活规范 | Prompt 缓存与稳定前缀优化 |
| PROMPT_ADJUSTMENT_GUIDE.md | 活规范 | 提示词调整操作指南 |
| SKILL_DEVELOPMENT_GUIDE.md | 活规范 | 新建 / 改造 Skill 指南 |
| AGENT_SKILL_MANUAL.md | 活规范 | Agent / Skill 全景与设计缘由 |
| AGENT_IO_DESIGN_V3.md | 活规范 | 字段路由的概念模型（声明源的规范性定义在 SKILL_PROTOCOL_V4.md §2.6） |
| GOAL_PATH_CLARIFICATION_CONTRACT.md | 活规范 | Goal / Path 澄清契约：字段、服务端门控与 Path 消费方式 |
| PATH_PRODUCTION_REPLAN_CONTRACT.md（.en） | 活规范 | 路径生产与重规划契约 |
| KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md | 活规范 | 概念身份与知识图谱设计 |
| KC_MULTIPATH_AND_LEARNER_SIGNAL_SCOPE.md | 活规范 | 概念多路径与学习者信号作用域 |
| LEARNER_CENTER_AND_STATE_FUSION.md | 活规范 | 学习者中心与状态融合 |
| LEARNER_MODEL_ARCHITECTURE.md（.en） | 活规范 | 学习者模型架构 |
| LEARNER_STATE_REVIEW_DESIGN.md | 设计方案 | 学习者状态诊断层、探针置信更新与校准闭环（表名以代码为准） |
| SESSION_JSON_INCREMENTAL_DESIGN.md | 设计方案 | 会话大 JSON 列（messages / logs）增量化存储与迁移方式 |
| VIRTUAL_LEARNER_DESIGN.md | 活规范 | 虚拟学习者主文档 |
| VIRTUAL_LEARNER_CHAIN.md | 活规范 | 虚拟学习者链路 SoT |
| VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md | 活规范 | 虚拟日期模拟接口契约 |
| VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md | 设计方案 | 虚拟日期模拟设计（以实现与契约为准） |
| UPGRADE_DIRECTION_20Q.md | 治理台账 | 20 问的逐条核验、分级结论与升级方向（状态以 §8 为准） |
| EDUCATIONAL_THEORY_MAP.md | 参考资料 | 教育理论地图（文献已核实） |
| DIAGRAM_PEDAGOGY_RESEARCH.md | 参考资料 | 教学图证据分级与图型盘点 |
| ADMIN_TERMINOLOGY_AUDIT.md | 活规范 | 管理端术语 SSOT |
| ADMIN_OPERATIONS_MANUAL.md | 活规范 | 管理端运营操作手册 |
| ADMIN_VISUAL_LAYER_SPEC.md | 活规范 | 管理端视觉规范 |
| ADMIN_COLUMN_WIDTH_SPEC.md | 活规范 | 管理端列宽规范 |
| ADMIN_TABLE_HEADER_SPEC.md | 活规范 | 管理端表头区规范 |
| DEV_SCRIPTS.md | 活规范 | 脚本目录、跑批链路与工具索引 |
| PIPELINE_MAP.md | 生成物 | 场景 → Agent → Prompt 全管线索引（`pipeline:map` 生成，勿手改） |
| PIPELINE_PROMPTS.md | 生成物 | 全部提示词原文汇编（同上） |
| README.md | 索引 | 本文档 |

## 子目录

| 文档 | 类型 | 备注 |
|---|---|---|
| measurement/FROZEN-EXAM-PROTOCOL-2026-10-18.md | 活规范 | 冻结考卷 × 双臂协议：判分 / 教学改动是否有效的对照协议 |
| measurement/PLATFORM-MEASUREMENT-QUALITY-REPORT-2026-10-19.md | 结果台账 | 判分一致性与肯定语护栏效应的测量结果（按协议登记） |
| measurement/OFFLINE_EVAL_DESIGN.md | 活规范 | 课堂离线评审工具的 rubric、运行参数与边界 |
| measurement/frozen-exam-2026-10-18/README.md | 参考资料 | 冻结评判样本集（语料说明） |
| measurement/119/README.md | 参考资料 | 20 例 goal→path 资料引用读数的复算包 |
