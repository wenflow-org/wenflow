# 教育理论地图（理念宪法）

> 本文档为 Wenflow 教育 Agent 的**理论基座**：所有教学法/心理学/神经科学/LLM 方向的理念、引用文献与落点索引。
> 用途：prompt 规则编写、学习状态指标设计、learn agent 调度策略设计的**理论依据引用源**。
> 规范：新增任何教学法条文或指标时，应在此登记理论来源（含 DOI/arXiv ID）与代码落点，防止"理论漂移"。
> 核实说明：本文档中所有标注 ✅ 的文献均经联网核查（2026-08，Crossref / arXiv / Wikisource / Wikipedia）；标注 ⚠️ 的为存在出入的引用。

---

## 一、总体框架：理论 × Wenflow 四层映射

```
Goal 层（目标澄清）        Path 层（路径规划）         Teach 层（教学回合）            Learn 层（画像/沉淀）
─────────────────────   ──────────────────────   ───────────────────────────   ──────────────────────────
自我决定论 SDT ①         认知结构/图式/概念图       认知负荷理论（三分法）⑧         记忆巩固与睡眠 ⑭
目标设定理论 ②           间隔效应 / 检索练习 ⑨     心流理论 ⑥                   自我调节学习 SRL ⑫
动机访谈 / 认知共情      交错学习 ⑩                 Yerkes-Dodson 唤醒度 ⑦      元认知训练 ⑬
认知带宽自报（负荷）      有效失败 PF ⑪            苏格拉底法 / ICAP ⑤           生成效应 ④
                       首胜体验（自我效能）         情绪脚手架 / 成长型思维 ③      测试效应 ⑨
                                                 费曼技巧 / 自我解释 ⑮          行为强化 / 游戏化
```

---

## 二、教学 / 心理 / 神经科学理论清单

### ① 自我决定论（Self-Determination Theory, SDT）
- **文献**：Deci & Ryan (1985) *Intrinsic Motivation and Self-Determination in Human Behavior*；Ryan & Deci (2000) *Self-determination theory and the facilitation of intrinsic motivation*（DOI 10.1037/0003-066X.55.1.68）。✅ Crossref 核实
- **核心观点**：三大基本心理需求——**自主（Autonomy）/ 胜任（Competence）/ 归属（Relatedness）**。外部控制性奖励侵蚀内在动机（Deci 1971）；信息性反馈增强内在动机（CET 子理论）；内部化程度分四级（外部调节→内摄→认同→整合）。
- **Wenflow 落点**：**显式命名缺失**。工程上已实现自主（goal 确认制 `goal-conversation.yaml:38`）、胜任（XP/成就/掌握证据反馈）；归属缺失（peer 是教学功能非关系）。
- **建议**：learner-model 画像扩展 autonomy/competence/relatedness 三需求评估；motivation 字段（`learner-model-agent/types.ts:11`）与 SDT 动机谱对齐；学习状态页反馈语言避免控制性措辞。

### ② 目标设定理论（Goal-Setting Theory）
- **文献**：Locke & Latham (1990) *A Theory of Goal Setting & Task Performance*；(2002) *Building a practically useful theory of goal setting*（DOI 10.1037/0003-066X.57.9.705）。✅ Crossref 核实
- **核心观点**：具体、有难度、有反馈的目标驱动最佳表现；目标承诺与自我效能是调节变量。
- **Wenflow 落点**：success_criteria 可观察化（`goal-conversation.yaml:39,80`）；firstDeliverable 锚定（`path-planning.yaml:60-62`）。部分实现。
- **建议**：多目标预算台账中为每个 goal 维护"承诺难度"与反馈闭环。

### ③ 成长型思维（Growth Mindset / Implicit Theories）
- **文献**：Hong, Chiu & Dweck (1995) *Implicit theories of intelligence*（DOI 10.1007/978-1-4899-1280-0_10）；Dweck (2006) *Mindset*。✅ Crossref 核实
- **核心观点**：能力可塑信念（incremental theory）→ 更愿意接受挑战、从失败恢复；过程导向表扬（努力/策略）优于能力导向表扬。
- **Wenflow 落点**：**缺失**。`teaching-turn.yaml:50`（正常化）是雏形；`yaml:85`（表扬锚定具体行为）是过程导向的基础，可扩展为"归因于努力与策略"条文。
- **建议**：Learn 层反馈语言规范（process praise 条文）。

### ④ 生成效应（Generation Effect）
- **文献**：Slamecka & Graf (1978) *The generation effect*（DOI 10.1037/0278-7393.4.6.592）。✅ Crossref 核实
- **核心观点**：自己生成的信息比被动阅读记忆更牢。
- **Wenflow 落点**：**已实现未命名**——`teaching-turn.yaml:67`（reflect 讲给不懂的人听）、`:78`（交付物学生自己产出）、`:66`（无提示独立应用才算完成）、`session-wrapup.yaml:40`。
- **建议**：补理论注释，防止后续"给答案"式回归。

### ⑤ ICAP 框架（Interactive-Constructive-Active-Passive）
- **文献**：Chi & Wylie (2014) *The ICAP framework: Linking cognitive engagement to active learning outcomes*（DOI 10.1080/00461520.2014.965823）；Chi (2009) 前身（DOI 10.1111/j.1756-8765.2008.01005.x）。✅ Crossref 核实
- **核心观点**：学习活动按认知参与度分四档：**交互 > 建构 > 主动 > 被动**；建构（自己解释/产出）与交互（对话协商）显著优于被动接受。
- **Wenflow 落点**：**显式缺失**。工程上 subtask 7 类型（acquire/diagnose/deconstruct/model/execute/refine/consolidate，`stage-designer.yaml:32`）与 ICAP 可映射；teaching-turn 的产出请求实际是建构/交互驱动。
- **建议**：为 teaching-turn 提问阶梯与 subtask 类型加 ICAP 档位标注；设计"ICAP 最低档门槛"（每轮至少 Active 以上）。

### ⑥ 心流理论（Flow Theory）
- **文献**：Csikszentmihalyi (1975) *Beyond Boredom and Anxiety*；(1990) *Flow*。Schaffer (2013) 七条件。✅ Wikipedia 核实
- **核心观点**：心流三条件——清晰目标、即时反馈、**挑战与技能平衡**；挑战过低→无聊，过高→焦虑；SAKI（Pask 1956）是"平衡难度"教学机器的早期先例。
- **Wenflow 落点**：**缺失（命名）**。`LearnerSnapshotService.ts:50-94`（challengeLevelCap/paceMode）与 `stage-designer.yaml:37`（首任务低门槛）是近似实现。
- **建议**：Teach 层"三路由"条文的理论依据之一（低压升维/高压降维 = 无聊/焦虑两端的回归心流通道）；文档注释补心流理论。

### ⑦ Yerkes-Dodson 唤醒度定律（Inverted-U）
- **文献**：Yerkes & Dodson (1908) *The relation of strength of stimulus to rapidity of habit-formation*（DOI 10.1002/cne.920180503）。✅ 公认文献
- **核心观点**：表现随唤醒度倒U变化——唤醒不足→动机低；过度唤醒→表现崩溃；中等唤醒最优。
- **Wenflow 落点**：**部分（无注释）**。历史分析文档记录 LSS/LSB 阈值设计依据（`doc/history/analysis/2026-05/LEARN_PIPELINE_ANALYSIS.md:281`）；现行 `LearnerSnapshotService.ts:60-93`（lf≥6/lsb<0→recover；趋势向好→push）是倒U的量化实现。
- **建议**：给 `LearnerSnapshotService` 阈值与 LSS/LSB 指标补理论注释；"不愤不启"三路由的唤醒度映射。

### ⑧ 认知负荷理论（Cognitive Load Theory, CLT）
- **文献**：Sweller (2010) *Cognitive load theory: Recent theoretical advances*（DOI 10.1017/cbo9780511844744.004）；Sweller (2019) 综述（DOI 10.4324/9780429283895-1）；worked example 效果（DOI 10.1007/978-1-4419-8126-4_8）。✅ Crossref 核实
- **核心观点**：工作记忆容量有限；负荷三分——**内在（intrinsic）/ 外在（extraneous）/ 生成（germane）**；生成负荷需要"有益困难"（desirable difficulty）而非信息冗余。
- **Wenflow 落点**：**已实现**——外在负荷管理：单焦点≤5 知识点（`teaching-turn.yaml:53`）、回复形态预算（`yaml:92-93`）、长对话压缩（`TeachingContextCompressionService.ts`）、conceptLoad=low 不引新概念（`yaml:72`）；内在负荷量测：loadIndex（前端交互特征，`TeachingContextBuilder.ts:97-161`）。
- **缺口**：**生成负荷（desirable difficulty）未系统化**——只靠 `yaml:59` 轻量升级条文；三路由的"低压升维"是生成负荷的正规化实现。
- **已知缺陷**：interactionProfile 构建后未注入（`AITeachingCoordinator.ts:749-775` 漏字段，`teaching-turn/index.ts:431` 恒 null）——loadIndex 4 条规则全部空转。**待修（最高优先级）**。

### ⑨ 测试效应 / 检索练习（Testing Effect / Retrieval Practice）
- **文献**：Karpicke & Roediger (2007) *Expanding retrieval practice... equally spaced retrieval enhances long-term retention*（DOI 10.1037/0278-7393.33.4.704）；Karpicke & Roediger (2008) *The critical importance of retrieval for learning*（DOI 10.1126/science.1152408）；Smith, Roediger & Karpicke (2013)（DOI 10.1037/a0033569）。✅ Crossref 核实
- **核心观点**：检索 > 重读；**等距检索比递增检索更利于长期记忆**；无反馈的检索仍有收益但带反馈更强。
- **Wenflow 落点**：**已实现**——`session-wrapup.yaml:37`（actionPlan 至少 1 条检索式自测）、`teaching-turn.yaml:49`（开场承接检索题）、费曼 reflect（`yaml:67`）、checkpoint（`yaml:123,128`）。
- **建议**：复习闭环（due API + 复习课）是测试效应的完整落地；间隔递增策略参考 Karpicke（等距 vs 递增的权衡）。

### ⑩ 交错学习（Interleaving）
- **文献**：Rohrer & Taylor (2007) *The shuffling of mathematics problems improves learning*（DOI 10.1007/s11251-007-9015-8）；Rohrer (2006) 分块 vs 混合。✅ Wikipedia 核实
- **核心观点**：混合不同类型练习 > 分块练习（学会"何时用哪个方法"）；与间隔效应同为 desirable difficulty 家族。
- **Wenflow 落点**：**缺失**。跨里程碑 hub 回捞（`path-planning.yaml:56`）与 consolidate 任务（`stage-designer.yaml:36`）是间隔/检索而非交错；`teaching-turn.yaml:53` 单焦点约束与回合内交错存在张力。
- **建议**：交错应在**任务/会话粒度**落地（学习预算台账的轮换编排、复习课混合概念），不破坏回合内单焦点。

### ⑪ 有效失败（Productive Failure）
- **文献**：Kapur (2009) *Productive failure in mathematical problem solving*（DOI 10.1007/s11251-009-9093-x）；Kapur (2010)（DOI 10.1007/s11251-010-9144-3）；Kapur (2012)（DOI 10.1007/s11251-012-9209-6）。✅ Crossref 核实
- **核心观点**：先让学生尝试解决（即使失败），再提供指导，比直接讲解产生更深学习；失败激活相关图式。
- **Wenflow 落点**：**雏形**——`teaching-turn.yaml:77`（状态不明先要诊断性产出请求而非直接开讲）、`yaml:78`（交付物学生自己产出）、`yaml:50`（失败后给快速成功小动作）。
- **建议**：与"不愤不启"三路由天然契合（精准点拨前给学生挣扎空间）；苏格拉底阶梯即有效失败的对话形态。

### ⑫ 自我调节学习（Self-Regulated Learning, SRL）
- **文献**：Zimmerman (1989) *Models of self-regulated learning*（DOI 10.1007/978-1-4612-3618-4_1）；Zimmerman & Risemberg (1997)（DOI 10.1006/ceps.1997.0919）。✅ Crossref 核实
- **核心观点**：三阶段循环——**前思（Forethought：规划/目标）/ 表现（Performance：自我监控）/ 反思（Self-Reflection：归因/调整）**。
- **Wenflow 落点**：**部分**——metacognitive knowledgeType 完整链路（`teaching-turn.yaml:58,71`；`pedagogy.config.ts:171,225`）；画像 metacognitionLevel（`learner-model-agent/types.ts:5`）；无三阶段显式追踪。
- **建议**：wrapup actionPlan 可作为反思阶段产物，下一节开场承接（`teaching-turn.yaml:49`）即下一循环的前思输入；learn agent 出口可提供 SRL 三阶段状态视图。

### ⑬ 元认知训练（Metacognition）
- **文献**：Flavell (1979) *Metacognition and cognitive monitoring*（DOI 10.1037/0003-066X.34.10.906）。✅ 公认文献
- **核心观点**：对自身认知过程的计划、监控、评估；元认知监控可被刻意训练。
- **Wenflow 落点**：**有（部分）**——metacognitive 链路完整；`teaching-turn.yaml:79-83`（理解/负荷须可引用证据）即元认知证据纪律；缺"学习者反思习惯的刻意训练循环"（如定期自评）。
- **建议**：复习课可加入"自评→对照→校准"环节；Learn 层记录自我评估准确度（`types.ts:15-21` selfAssessmentAccuracy 已有字段）。

### ⑭ 记忆巩固与睡眠（Memory Consolidation / Sleep）
- **文献**：Rasch & Born (2013) *About sleep's role in memory*（DOI 10.1152/physrev.00032.2012）；Walker & Stickgold (2004) sleep-dependent consolidation。✅ 公认文献
- **核心观点**：睡眠期突触重放与巩固；跨日间隔复习受益于巩固窗口。
- **Wenflow 落点**：**缺失**——仅健康建议（`LearningMetricService.ts:387`）；M2 默认间隔恒 1 天（`actr.ts:55-58` 固定 15% 规则）偏短。
- **建议**：复习调度改为跨日递增（SM-2 式）；"今日复习"与"睡眠建议"联动。

### ⑮ 自我解释效应（Self-Explanation Effect）
- **文献**：Chi, de Leeuw, Chiu & LaVancher (1994) *Eliciting self-explanations improves understanding*（Cognitive Science 18:439-477）。✅ 公认文献（Crossref 检索有噪声但该文为领域经典）
- **核心观点**：要求学习者解释"为什么"显著提升理解与迁移。
- **Wenflow 落点**：**已实现**——README 已将费曼技巧标注为自我解释（`README.md:360`）；`teaching-turn.yaml:67-68`；`peer-reinforcement.yaml:32`（feynman 策略）。
- **建议**：无，保持。

---

## 三、神经科学底座（支撑"认知预算"叙事）

| 概念 | 文献 | 与 Wenflow 的关系 |
|---|---|---|
| 工作记忆容量 4±1 | Cowan (2010) *The magical mystery four*（DOI 10.1177/0963721410370094） | 支撑 `teaching-turn.yaml:53` 知识点上限（≤5 单焦点）与回复形态预算 |
| 幂律遗忘 / Base-Level Activation | Anderson & Schooler (1991)（DOI 10.1111/j.1467-9280.1991.tb00174.x） | M2 记忆引擎 `backend/src/services/memory/actr.ts` 的直接数学基础 |
| 间隔效应 / 遗忘曲线 | Ebbinghaus (1885)；Cepeda et al. (2006) 荟萃（DOI 10.1037/0033-2909.132.3.354）；Cepeda et al. (2008)（DOI 10.1111/j.1467-9280.2008.02209.x） | M2 间隔规则（目标保留期 15%）与复习调度设计依据 |
| 多巴胺奖励预测误差 | Schultz (1997) *A neural substrate of prediction and reward*（DOI 10.1126/science.275.5306.1593） | XP/成就/streak 游戏化的神经基础；与 SDT 内在动机保护需平衡 |
| 语言特征→认知负荷代理 | Khawaja et al. (2014)（DOI 10.1080/10447318.2013.860579）；Khawaja et al. (2009)（INTERACT）；Khawaja et al. (2007) | loadIndex 的理论来源：WPS 下降、填充词、负面情绪词、认知挣扎词 |

---

## 四、LLM / 计算机方向（与 Wenflow 的对应）

| 概念 | 文献（✅ 已核实） | 对 Wenflow 的启示 |
|---|---|---|
| 思维链 CoT | Wei et al. (2022)（arXiv 2201.11903） | reasoning tier（deepseek-r1/v4-pro）thinking mode 的理论基础；教学回合 analysis 段适用 |
| RL 推理模型自省 | DeepSeek-R1 (2025)（arXiv 2501.12948） | "R1 判定假懂/认知僵局"（用户蓝图）→ analysis 段（loadIndex/understanding）用 reasoning tier 的依据 |
| MoE 稀疏路由 | DeepSeek-V2 (2024)（arXiv 2405.04434，MLA 压缩 KV cache + DeepSeekMoE） | 蓝图"动态注入引导 MoE Router"机制上成立（路由依赖输入 token 向量）；工程上无直接实现需求 |
| 状态机+LLM 混合教学 | Chowdhury et al. (2024) MWPTutor（arXiv 2402.09216） | **Wenflow 路线（确定性状态机+prompt 约束+LLM 填充）的直接学术背书**：优于纯自由生成，防漏题需要守卫 |
| LLM tutor 共情优势 | Pal Chowdhury et al. (2025)（arXiv 2506.08702）：共情 80% 胜人类 | 情绪急救/共情 prompt 投入有实证支撑 |
| 教学对话情绪动态 | Zhang et al. (2025)（arXiv 2510.13862）：情绪短暂易碎、中性时刻是干预转折点 | loadIndex/情绪路由的干预时机设计依据 |
| RAG 优于 ToT（评估） | Han et al. (2024)（arXiv 2402.14594） | wrapup 评估若引入证据检索可提升准确率与降本 |
| 推理模型安全警示 | Zhao et al. (2025) CoT Hijacking（arXiv 2510.26418）：过长思维链削弱拒绝行为 | reasoning 段同样需要"不漏题/不越界"防线条文（教学守卫） |
| 前缀缓存 / KV Cache | DeepSeek 自动前缀缓存（usage 返回 prompt_cache_hit_tokens） | system 静态前缀 + user 尾部动态槽的注入形态设计依据 |

---

## 五、理论 → 规则映射缺口清单（现状盘点）

### 已实现且命名（README 7 条）
认知负荷 / 自我导向学习 / ZPD+支架 / 形成性评估 / 刻意练习+检索练习 / 费曼（自我解释）/ 安德森分类——**全部有代码落点**（详见 `doc/README.md` 相关章节与各 prompt 源文件）。

### 已实现但未命名（需补注释）
| 理论 | 落点 | 注释位置建议 |
|---|---|---|
| 生成效应 ④ | `teaching-turn.yaml:67,78`；`session-wrapup.yaml:40` | teaching-turn.yaml 对应规则旁 |
| Yerkes-Dodson ⑦ | `LearnerSnapshotService.ts:50-94`；LSS/LSB 阈值 | 服务头部注释 |
| 自我解释 ⑮ | 已归费曼名下（README:360） | 无需 |

### 完全缺失（最大增量空间）
| 理论 | 建议落点层 | 最小落地形态 |
|---|---|---|
| SDT ①（归属感） | Learn / Goal | learner-model 画像扩展三需求字段；peer 定位为 relatedness |
| 成长型思维 ③ | Teach / Learn | 过程导向归因条文（`teaching-turn.yaml:85` 扩展）；wrapup 反馈语言规范 |
| 心流 ⑥ | Teach / Path | 三路由理论注释；挑战-技能平衡可视化 |
| ICAP ⑤ | Teach / Stage | subtask 类型 ICAP 档位标注；ICAP 最低档门槛规则 |
| 交错学习 ⑩ | Path / 调度层 | 任务/会话粒度轮换编排（预算台账） |
| 有效失败 ⑪ | Teach | 三路由"精准点拨"前置试错流程条文 |
| SRL ⑫ | Learn / Wrapup | 三阶段状态视图；actionPlan 作为反思产物 |
| 睡眠巩固 ⑭ | Path / 复习调度 | 跨日递增间隔；复习排程 |
| 元认知训练 ⑬ | Wrapup / 复习课 | 自评→对照→校准环节 |

---

## 六、蓝图引用核实记录

对用户提供文档（超学科动态认知流控）中学术引用的联网核查结果：

| 引用 | 结果 |
|---|---|
| Cepeda 等 2008 间隔效应（间隔=目标保留期 10-20%） | ✅ 真实（DOI 10.1111/j.1467-9280.2008.02209.x） |
| Khawaja 语言特征测认知负荷 | ✅ 真实（DOI 10.1080/10447318.2013.860579 + 2009/2007 两篇） |
| Anderson & Schooler 幂律衰减 | ✅ 真实（DOI 10.1111/j.1467-9280.1991.tb00174.x） |
| Gkintoni 2025"超学科认知神经教育模型" | ⚠️ **部分**：Gkintoni（Patras 大学）真实且 2025 年有神经教育+AI 论文（INTED2025、Biomimetics 2025 等），但 Crossref 未检索到该**确切标题**论文，应为转述/融合引用 |
| Klein 超学科定义 / Ebbinghaus 公式 / Cowan 4±1 / "不愤不启" | ✅ 均符合公认文献；"不愤不启"原文见《论语·述而第七》七之八 |
| DeepSeek-V3 MLA / MoE | ✅ 真实（V2 论文 arXiv 2405.04434 明确；V3 沿用） |
| "Wenflow 四层级架构"描述 | ⚠️ 与仓库现实不符：当前为 goal/path/teaching 三主阶段 + 编排器架构，"四层"是字段路由迁移的阶段划分 |

---

## 七、维护规范

1. **新增教学法条文**：先在本文档登记理论（含 DOI/arXiv ID），再写 prompt 规则，最后在规则旁注释引用本文档条目号。
2. **指标/阈值设计**：任何学习状态阈值（LSS/LSB/loadIndex 档位）须注明理论来源（CLT/Yerkes-Dodson/心流）。
3. **引文纪律**：引用文献须可核实（提供 DOI）；无法核实的一律标注 ⚠️。
4. **定期复核**：每季度或重大架构改动时，重跑本表"已实现/缺失"状态，同步 `ARCHITECTURE_ALIGNMENT_AND_REMEDIATION_PLAN.md` §10 状态表。
