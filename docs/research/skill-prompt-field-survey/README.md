# Skill Prompt 字段学术性调研（2026-11-19 快照）

> 目的：对 `prompts/` 目录下全部 skill prompt（SKILL_PROTOCOL_V4 编译产物）中出现的**字段**做一次学术性调研——把每个字段族映射到教育学/心理学/学习科学/人工智能教育（AIED）文献中的对应构念，评估其学术依据、一致点与张力点，为后续 prompt 再开发提供文献坐标。
>
> **调查版本冻结**：仓库 commit `e736f7aa`（e736f7aaeac8bf6ed29856a7c799725b4d07d56c，2026-11-18 15:46 +0800，`fix(path-task-design): 历史 not_judgeable 任务允许改写而非保留训练形态`）；调查执行日 2026-11-19。此后 prompt 再开发不影响本报告口径（"按照调查时版本展开调研"）。

## 调查对象与方法

- **对象**：`prompts/skill.*.md` 全部 **34 个编译产物**（SKILL_PROTOCOL_V4 五块结构：身份/使用通道/执行规则/输出字段/边界约束；33 个 frontmatter 含 coreHash/coreVersion，`skill.teaching-board-design.md` 为旧式 promptContract frontmatter、无 coreVersion 锚点——与其余 33 个不同）。对应 `prompts/core/*.yaml` 核心文件 33 个（teaching-board-design 旧式链路、code-only skill 不参与编译）。字段语义的唯一人工编辑入口为 `prompts/core/*.yaml`，本调研按编译产物（模型实际读取文本）与 manifest 契约（`prompts/manifests/*.yaml`）双重口径提取。
- **口径**：输入侧 = 「使用通道/输入契约声明」的 ref 引用字段（`skill:` 上游模型输出 / `sandbox:` 编排注入 / `user:` 用户平台三类前缀）+ 规则内引用字段；输出侧 = 「输出字段」块 fields 表全部字段与子字段。
- **方法**：① 四路并行逐文件提取字段底表；② 按语义聚合为 13 个字段族；③ 七路并行文献调研（tavily 检索 + 原文核读，引用纪律：只引真实检索命中的文献，URL 可溯）；④ 人工合成主报告。
- **关联文档**：工程一致性审计见 `docs/SKILL_FIELD_AUDIT_2026-11-11.md`（声明↔载荷↔消费链路核对）；本调研与其互补，只处理字段的学术构念层。

## 文件索引

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| `学术调研报告.md` | 主报告：字段全景 → 13 字段族学术映射 → 横向议题 → 缺口与建议 | ✅ |
| `_inventory-goal-path.md` | 底表：goal / path 阶段 9 个 skill（goal-conversation v17、path-planning v8、path-reviewer v3 等） | ✅ |
| `_inventory-profile.md` | 底表：profile 阶段 7 个 skill（学习表现预测器、概念负担判定器等） | ✅ |
| `_inventory-teaching.md` | 底表：teaching 阶段 7 个 skill（teaching-turn v19 等） | ✅ |
| `_inventory-simulation-meta.md` | 底表：simulation 9 个 skill + skill-author / skill-compiler 元技能 | ✅ |
| `_lit-01-learner-model-telemetry.md` | 字段族①学习者模型与画像 ②行为遥测与交互特征（26 篇） | ✅ |
| `_lit-02-knowledge-memory.md` | 字段族③知识状态/掌握度/知识结构 ④记忆/复习/检索练习（30 篇） | ✅ |
| `_lit-03-goal-path.md` | 字段族⑤目标理解与需求诊断 ⑥路径规划与课程序列化（30 行/约 35 篇） | ✅ |
| `_lit-04-task-affect.md` | 字段族⑦任务设计与评估 ⑧动机/情感/归因支持（27 篇） | ✅ |
| `_lit-05-teaching-dialogue.md` | 字段族⑨教学对话与策略（25 篇） | ✅ |
| `_lit-06-multimodal-classroom.md` | 字段族⑩多模态图示输出 ⑪课堂组织与控制（26 篇） | ✅ |
| `_lit-07-simulation-meta.md` | 字段族⑫虚拟学习者仿真与裁判 ⑬元技能/prompt 工程（30 篇） | ✅ |
| `专项调查-虚拟学习者.md` | **专项主报告**：业务切入点 → 双轨架构与阶段对接（12 条缝风险）→ 26 条扮演机制与 9 条残留向量 → 五层拟真判据对照 → 外部工程对照（酒馆/数字人）→ T0–T3 工程改进路线 | ✅ |
| `_vl-01-architecture-handoff.md` | VL 线：虚拟学习者子系统与三阶段对接的代码级调查（双轨生命周期、persona 供给链、对接缝逐键核对、日期模拟、12 条对接风险，全部带 文件:行号） | ✅ |
| `_vl-02-dialogue-mechanisms.md` | VL 线：扮演真人对话机制盘点（26 条六族编目、跨轮状态连续性、12 项确定性护栏、2026-11-11 修复核验 13/2/1、9 条残留向量 V-D1–V-D9） | ✅ |
| `_vl-03-evidence.md` | VL 线：虚拟学习者「扮演对话失真」仓库内历史与近期实测证据集（44 条时间线、10 类失真目录、17 项开放、persona 档案三层完整度评估） | ✅ |
| `_vl-04-humanlikeness-lit.md` | VL 线：LLM 仿真学习者「人味」文献线（[31]–[43]，五层拟真判据综合：语言学/行为/记忆/心理/节奏） | ✅ |
| `_vl-05-roleplay-frontend-eng.md` | VL 线：外部角色扮演项目工程机制对照（SillyTavern/RisuAI/Character.AI/星野·Talkie/AI Dungeon/NovelAI，29 条机制 + 4 小节对照 + H7/M6/L2 迁移清单） | ✅ |
| `_vl-06-digital-human-eng.md` | VL 线：数字人/智能体模拟工程机制对照（MemGPT/Mem0/Zep/Letta/语音数字人栈/Inworld/Neuro-sama/AI Town/Nemesis，20 条机制 + H5/M8/L4 迁移清单） | ✅ |

## 字段规模速览（调查时版本）

| 阶段/批 | skill 数 | coreVersion 分布 | 输入字段最重 | 输出字段最重 |
| --- | --- | --- | --- | --- |
| goal+path | 9 | v1–v17 | path-task-design（12 顶层+38 子键） | goal-conversation（8 顶层 + 48 子键） |
| profile | 7 | 均 v1 | profile-state-review（4 顶层+6 子键） | profile-state-review（4 顶层+14 子键） |
| teaching | 7 | v1–v19 | teaching-turn（7 顶层+16 子键+约 30 组规则引用） | teaching-turn（8 顶层，analysis 14 子字段） |
| simulation+meta | 11 | 均 v1 | simulation-learn-turn（15 顶层+22 子键） | simulation-scenario-designer（3 顶层+73 子键） |

术语密度最高的机制名（全部出现在 prompt 规则正文中，供字段族映射）：愤悱带 0.6–0.8、Meno 闸、POE 先猜后揭、Productive Failure、费曼技巧/protégé effect、FSRS/retrievability、ICAP 四档、ZPD（zpdDistance 三档）、CLT（loadProfile/intrinsic load）、动机式访谈四帧（change talk/sustain talk）、SDT 三需要（sdt_needs）、SMART 校验、执行意图、RPKT 前提缺口链、CIDDP 五维评审、摩擦预算/受控错误、披露计划 disclosurePlan、epistemic grounding、LLM-as-judge 固定权重 rubric、字段冻结/含义冻结。
