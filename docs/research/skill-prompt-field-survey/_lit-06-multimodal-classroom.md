# 附表 06｜多模态图示输出字段 与 课堂组织控制字段 文献调研

- 调研对象：WenFlow 平台 skill prompt（commit e736f7aa，2026-11-19 调查版）中的多模态图示输出字段与课堂组织控制字段。
- 检索方法：Tavily 网络检索共 10 次查询（英文，互不重复），配合 CrossRef / arXiv / PMC 公开元数据接口对每条被引文献做真实性核验；未使用 WebSearch。
- 引用纪律：下表每一条目均真实出现在本次检索结果或抓取正文之中（URL 附后）；无法完全核实卷期/页码/署名的位置逐处标注（出处待核）。严禁编造。
- 检索日期：2026-11-19。

---

## 章节一：多模态图示输出字段

### 覆盖字段

| 字段 | 内容要点 |
| --- | --- |
| `diagram` | 结构类图示：LLM 输出 mermaid 代码并渲染；`kind` 枚举 13 类（流程/层级/时序等结构关系） |
| `figure` | 空间位置类图示：确定性 SVG；`spec` 含 `cartesian-plot`（直角坐标图，5 子字段）与 `split-compare`（左右对照，4 子字段） |
| `teaching-board-design`（白板绘图员 skill） | `kindHint`、`questionIntent` 4 子字段、`lastBoard` 换板参照；输出 `title + left/right{head, rows[].label/.sub}`；规则语境含 tone/dash（实线/虚线）视觉通道 |
| 「图文互锁」规则 | 图与文字必须互补、禁止图文复读（防冗余） |
| 「双通道重构」规则（2026-09-27） | 结构类走 `diagram`（mermaid）、空间类走 `figure`（确定性 SVG）的分流 |

### 对应学术构念

**多媒体学习认知理论（CTML）。** Mayer 的 CTML 以三条假设为骨架：人经由视觉/听觉两个相对独立加工通道处理信息、每条通道容量有限、学习是主动的过滤-组织-整合过程 [1]。由此外推的设计原则中与本项目直接对应的有：冗余效应（redundancy effect）——图示加解说优于图示加解说再加逐字重复的屏幕文字，重复性图文组合损害迁移成绩 [1][2]；signaling（信号化）——用箭头、高亮、加粗等视觉线索引导注意 [1][2]；segmenting（分段）——把连续内容切成学习者可控的小步 [2]；空间/时间邻近（contiguity）——对应的文字与图示应就近、同步呈现 [2]。项目的「图文互锁」规则（禁止图文复读）是冗余效应的直接工程化：图被定义为"提供文字没有的结构信息"，而非文字的转译。`teaching-board-design` 中 tone/dash（实线/虚线）视觉通道与 `kindHint` 的用法，则与 signaling 中"以视觉通道编码关系类型"的思路一致 [2]。需要留意的是，已有批评视角（含 2026 年一篇带 DOI 的博客论文）认为 Mayer 各原则实质是"对多媒体自身引入的认知负担做减法"（该文署名信息待核，见风险点）[2]。

**双重编码与"双通道"的语义辨析。** Paivio 的双重编码理论（Dual Coding Theory）主张言语系统与非言语（表象）系统并行存储，图片与具体词可同时进入两个系统、形成相互增强的双重痕迹 [3]。这一理论常被用来解释"词+图"的增益，但在课堂化传播中已被部分实践者质疑（如 Didau 的批判文：把"配图"等同于"双编码"是过度简化，双编码理论的原始形态是记忆表征理论而非排版指南）[4]。本项目「双通道重构」中的"双通道"与上述两个学术用法均不同义：它指**输出格式的分流规则**（结构关系→mermaid 的 `diagram`；空间位置→确定性 SVG 的 `figure`），属于设计层分类，而非认知加工通道。术语的近似性可能造成解读混淆（见对照）。

**外部表征与图示的计算优势。** Larkin & Simon（1987）比较了信息等价（informationally equivalent）的图式（diagrammatic）与命题序列（sentential）表征，结论是图示的优势是**计算性的而非信息性的**：图以位置组织信息，使一次感知即可提取相邻的推理要素，显著降低搜索代价并支持感知推理 [5]。Zhang & Norman（1994）进一步论证外部表征不只是"外围辅助"：它承载规则与约束，会**改变任务本身的性质**（以河内塔同构任务为证据）[6]。Ainsworth 的 DeFT 框架则系统化了"何时使用多重表征、如何设计"：多表征可互补、可互相约束、可支持建构深层理解，但设计不当反而增加负担 [7]。这组文献为「双通道重构」提供了最贴切的学理依据：**表征形态的选择应匹配内容的结构**——层级/流程/时序属于拓扑结构信息，宜用节点-边类图示；函数关系、几何位置、量值对照属于度量空间信息，宜用直角坐标/左右对照类图示（`cartesian-plot`、`split-compare`）。Tversky、Morrison & Bétrancourt（2002）的综述则提示反面：动态与空间表征并不天然更优，只有当表征与认知过程" congruent（一致）"、把复杂运动分解为可消化的步骤时才有增益 [8]——这支持 `figure` 走**确定性模板 SVG** 而非自由生成渲染的保守选择。

**工作样例中的图示与 LLM 自动图示生成。** 样例学习（worked examples）研究表明，对新手而言，学习带解答的样例优于自行解题，可降低外在认知负荷 [9]；本项目 `figure`/`teaching-board-design` 的固定输出模板（`title + left/right{head, rows[].label/.sub}`、`cartesian-plot` 5 子字段）在功能上类似"样例模板"：把易错的排版与构图决策从生成式采样中剥离。另一方面，LLM 生成教学图示已是一个活跃的工程方向：MermaidSeqBench（2025-11）建立了自然语言到 Mermaid 时序图生成的评测基准，指出以往评测只做语法合规检查、鲁棒评测缺失 [10]；Wong、Chan & Cao（2025）在 IEEE ICET 提出以"代码定义+推理增强 LLM"生成数学题目配图的策略 [11]；另有多项会议工作比较不同 LLM 生成用例图的质量差异（该条作者名录在 CrossRef 中不全）[12]。共同点是：工程上均收敛到"LLM 输出 DSL/代码、再确定性渲染"的路线，与项目 mermaid+SVG 的实现一致；但现有评测停留在语法/结构合规层面，**尚无"自动生成图是否达成 CTML 式学习增益"的实证**（见对照·风险点）。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
| --- | --- | --- | --- | --- |
| [1] | Mayer, R. E. *Multimedia Learning*（剑桥大学出版社图书；版次年份待核。JSU 公开课程章节摘要 PDF） | https://www.jsu.edu/online/faculty/MULTIMEDIA%20LEARNING%20by%20Richard%20E.%20Mayer.pdf | diagram/figure、图文互锁 | CTML 与冗余/调制/信号化等效应的系统陈述；摘要 PDF 逐条列出 Redundancy/Signaling/Segmenting 等效应 |
| [2] | Digital Learning Institute. Mayer's 12 Principles of Multimedia Learning（实践指南，非同行评审） | https://www.digitallearninginstitute.com/blog/mayers-principles-multimedia-learning | teaching-board-design（tone/dash 视觉通道）、图文互锁 | 12 原则逐条配应用建议（signaling 用箭头/高亮；redundancy 避免重复图文）；便于与 prompt 规则逐条对齐 |
| [3] | "Dual-Coding Theory - an overview"（ScienceDirect Topics 综述条目，含 Paivio 1971 原始理论转述） | https://www.sciencedirect.com/topics/neuroscience/dual-coding-theory | 双通道重构、图文互锁 | 言语/表象双子系统概述：图片信息进入两个子系统，词主要进入言语子系统 |
| [4] | Didau, D.（年份待核）. The Dual Coding Delusion. The Learning Spy（Substack） | https://daviddidau.substack.com/p/the-dual-coding-delusion | 图文互锁 | 实践界批判：Paivio 原意是记忆表征理论， classroom 化的"双编码"易被滥用；用作张力参照 |
| [5] | Larkin, J. H., & Simon, H. A. (1987). Why a diagram is (sometimes) worth ten thousand words. *Cognitive Science*, 11(1), 65–100 | https://onlinelibrary.wiley.com/doi/10.1111/j.1551-6708.1987.tb00863.x （全文 PDF：https://mechanism.ucsd.edu/bill/teaching/F12/cs200/Readings/larkin.whyadiagramissometimesworth.1987.pdf） | diagram `kind` 枚举、lastBoard | 图示优势是计算性的：位置组织、感知推理、降低搜索；"sometimes" 提示图示并非处处更优 |
| [6] | Zhang, J., & Norman, D. A. (1994). Representations in distributed cognitive tasks. *Cognitive Science*, 18(1), 87–122 | https://pages.ucsd.edu/~scoulson/203/zhang.pdf （镜像：https://worrydream.com/refs/Zhang_2004_-_Representations_in_Distributed_Cognitive_Tasks.pdf） | cartesian-plot、figure 分流 | 外部表征承载规则、改变任务性质；支持"空间/度量信息用位置组织图示"的分流依据 |
| [7] | Ainsworth, S. (2006). DeFT: A conceptual framework for considering learning with multiple representations. *Learning and Instruction*（卷期待核） | https://doi.org/10.1016/j.learninstruc.2006.03.001 | 双通道重构、split-compare | 多表征设计框架：互补/约束/建构三功能与设计维度；多表征并置（左右对照）需明确功能 |
| [8] | Tversky, B., Morrison, J. B., & Bétrancourt, M. (2002). Animation: can it facilitate? *International Journal of Human-Computer Studies*（卷页待核） | https://doi.org/10.1006/ijhc.2002.1017 | figure（确定性 SVG 选择） | 动态/空间表征仅在认知一致（congruity）、可分段时有益；支持用确定性模板降低生成噪声 |
| [9] | Sweller, J., & Cooper, G. A. (1985). The Use of Worked Examples as a Substitute for Problem Solving in Learning Algebra. *Cognition and Instruction*, 2(1)（页码待核） | https://doi.org/10.1207/s1532690xci0201_3 | figure/board 固定输出模板 | 样例学习降低新手负荷；固定模板＝"构图决策样例化"的依据 |
| [10] | Shbita, B., Ahmed, F., & DeLuca, C. (2025). MermaidSeqBench: An Evaluation Benchmark for NL-to-Mermaid Sequence Diagram Generation. arXiv:2511.14967（预印本） | https://arxiv.org/abs/2511.14967 | diagram（mermaid 渲染） | 自然语言→Mermaid 时序图生成评测；指出既有评测仅做合规检查、鲁棒评测缺失 |
| [11] | Wong, Chan, & Cao (2025). A Mathematics Question Diagram Generation Strategy Defined with Codes and Empowered by Reasoning Large Language Models. 2025 5th International Conference on Educational Technology（IEEE ICET） | https://doi.org/10.1109/icet67421.2025.11380681 | diagram/figure 教育应用 | 代码定义+推理 LLM 生成数学题配图：与项目"代码化 DSL 再渲染"路线一致 |
| [12] | G S & Thushara（作者名录不全，据 CrossRef 条目）(2025). Comparative Analysis of Large Language Models for Automated Use Case Diagram Generation. Proc. 3rd Int. Conf. on Futuristic…（会议名截断，出处待核） | https://doi.org/10.5220/0013594700004664 | diagram | 不同 LLM 图示生成质量差异的比较：提示 kind 路由与渲染需容错 |

### 项目设计与文献的对照

**一致点**
1. **图文互锁 ↔ 冗余效应**：Mayer 冗余效应的直接工程化——同一内容"图+文字完全重复"损害学习 [1][2]；互锁规则把"图必须提供文字没有的结构信息"制度化，方向与文献一致。
2. **先问意图再选图（questionIntent/kindHint）**：与 DeFT"先确定多表征的设计功能再决定是否/如何并用"的设计顺序一致 [7]，也与 signaling 的"图示服务于注意引导"一致 [2]。
3. **双通道重构（结构→mermaid / 空间→确定性 SVG）**：表征选择匹配内容结构的分流，可由 Larkin & Simon（图示优势取决于信息结构）[5] 与 Zhang & Norman（外部表征承载结构规则）[6] 联合支撑；空间/度量类走确定性模板而非自由生成，与 Tversky 等的 congruity/分段条件一致 [8]。
4. **固定输出模板（title + left/right rows、cartesian-plot 子字段）**：与样例学习传统一致——把构图决策"样例化"以降低生成负荷与错误率 [9]。
5. **mermaid 代码渲染而非直接产图**：与当前 LLM 图示生成的工程收敛路线（输出 DSL 再确定性渲染）一致 [10][11][12]。

**张力点**
1. **"双通道"术语错位**：文献中"双通道"指认知加工通道（CTML）或言语/表象双系统（Paivio）[1][3]；项目的"双通道"是输出格式分流规则。同名异义可能诱发"项目已实现 CTML 双通道设计"的过度解读。
2. **渲染质量与设计原则的实现差距**：CTML 原则针对精心设计的教学图；LLM 生成的 mermaid 布局质量不稳定，最新基准也只评测语法/结构合规 [10][12]，"自动生成图是否兑现冗余效应所要求的图文分工"无实证支撑。
3. **split-compare 左右对照缺乏直接构念对应**：左右对照（`split-compare` 4 子字段）更像教学设计惯例；文献中最近的可援引解释是 Ainsworth 的互补性多表征 [7]，但"左右对照"这一具体版式无专门证据。
4. **"sometimes"的警示**：Larkin & Simon 标题即强调图示并非处处更优 [5]；项目的 13 类 `kind` 枚举全部以"出图"为默认动作，缺少"何时不出图"的负向约束（图文互锁只防复读，不防"图本身多余"）。

**风险点**
1. 若 `diagram`/`figure` 路由由模型自判（双通道重构），结构/空间误分类会绕过整条规则链；文献建议多表征使用需显式功能声明 [7]，项目可考虑在字段中增加路由理由的显式产出。
2. 批评视角（2026，DOI 10.59350/j989x-zqq65，署名待核）认为 Mayer 原则本质是"消除多媒体引入的负担"而非增益——提示图文互锁规则的价值主要在**防止伤害**，不宜宣称主动增益。
3. 实践界对"双编码"课堂滥用的批评 [4] 提示：把"配图+文字"当默认增益可能高估效果；对低空间能力学习者，`figure` 类图示的额外加工负担未在项目中建模。

---

## 章节二：课堂组织与控制字段

### 覆盖字段

| 字段 | 内容要点 |
| --- | --- |
| `classroomContext` | 课堂阶段/焦点，上轮持久化 |
| `classroomEventContext` | `recentEvents` 最近 5 条；`session-resumed` 断线恢复 |
| `controls` | 教学控制上下文：`priority`/`allow*` 标志 + 回合模式 |
| `checkpoint` / `warmupOutcomes` | 检查点流程；开场热身产出 |
| `teaching-opening` | 三模式：example-first / predict / self-assess；四种进入式：承接式/场景式/目标式/直入式 |
| `parkingLot`（停车区） | 课后待处理问题；另有支线预算（离题话题的预算控制）、单焦点主讲/知识看板 |
| `teaching-peer-reinforcement` | 学习伙伴：`message` + `followUpQuestions`，【策略】6 枚举；`peerTriggerService` 同伴触发 |
| `teaching-wrapup` | `summary` 10 子字段（含 knowledgeItems/evaluationHighlights/metricInterpretation）+ `evaluation` 三项档位对象 |
| `teaching-replan-attribution` | `primaryReasonCode` 归因码 / `recommendation` / `claim` / `checkOn` / `expect` / `evidenceRefs`；归因指向策略而非能力 |

### 对应学术构念

**形成性评价（formative assessment / assessment for learning）。** Black & Wiliam（1998）的《Inside the Black Box》综述认定：课堂层面的形成性评价实践（提问、反馈、自评与互评等）能带来显著且可比拟大型干预的学习增益（同年的大型综述 *Assessment and Classroom Learning*，*Assessment in Education* 5(1), 7–74，被引逾 2 万次）[1]；其后续项目文章把"在被忽略的黑箱内工作"落实为教师可操作的 AfL 流程 [2]。本项目字段组与该传统高度同构：`checkpoint` 是"课中提取证据"的检查点，`warmupOutcomes` 是开场的先备证据采集，`teaching-wrapup` 的 `summary.evaluationHighlights` + `evaluation` 三项档位是"课后证据汇总与反馈"，`parkingLot`（课后待处理问题）则相当于 exit ticket 的延伸去向——exit tickets 作为嵌入学习过程的即时形成性工具，2025 年已有实证研究考察其捕捉学生情感/学习证据的潜力 [4]。`teaching-replan-attribution` 与"依据证据调整教学"的 AfL 核心循环一致：`evidenceRefs` 显式引用证据、`recommendation`/`expect` 落实调整与再期望。

**课堂编排（orchestration）。** Dillenbourg 提出编排隐喻并给出工作定义——"教师在多约束情境中、实时地管理多层活动"；相关专刊系统讨论了课堂级技术设计（知识看板、实时 agent、活动控制）[5][6]（国际学习科学手册亦有专章 [6]）。本项目的 `controls`（priority/allow* 标志、回合模式）、单焦点主讲与知识看板，功能上正是把"编排控制面"显式化为字段：系统代替教师承担实时约束管理；`classroomContext` 持久化与 `recentEvents`（5 条）+ `session-resumed` 断线恢复，对应编排研究关注的课堂活动状态管理。Perrotta & Evans（2013）对编排隐喻提出权力维度的批评：编排天然涉及"谁控制节奏、焦点与话语权" [7]——这为"支线预算 + 单焦点主讲"的强控制设计提供了直接的批判视角。课堂话语传统中，Rowe 的 wait-time 研究表明提问后等待 3 秒以上会显著改变学生回答的长度与推理质量 [12]——`checkpoint` 的提问节奏设计有此经典依据，但如何在 LLM 导师中实现等效"等待"是开放问题（见风险点）。

**开场设计与动机。** Ausubel（1960）的先行组织者（advance organizers）实验表明：在正式材料前提供锚定结构、联结先备知识，可提升有意义学习与保持 [8]——对应教学-opening 的承接式/场景式/目标式进入（以及 `classroomContext` 承载的"先备脉络"）。开场三模式各自锚定不同实证传统：**predict**（预测先行）接近 Kapur 的 productive failure——先让学生在失败性尝试中生成与探索，后续结构化教学反而更好 [9]；**example-first**（样例先行）对应样例学习效应（对新手，带解答样例优于自行解题）[10]；**self-assess** 对应 AfL 中的学生自我评价实践 [1][2]。Keller 的 ARCS 模型（注意/相关/自信/满意）为 `warmupOutcomes` 与开场模式选择提供动机设计坐标系 [11]。ICAP 框架（Chi & Wylie, 2014）将外显参与模式分为 Interactive > Constructive > Active > Passive 的学习效应阶梯 [3]：开场三模式本质是把学生从 Passive 推向 Constructive/Interactive 的不同路径；但须注意 2026 年一项发表于 *Learning and Instruction* 的严格检验（Wekerle, Sailer, Kollar & Fütterer）发现部分 ICAP 假设在严格测试下强度存疑（ constructive 过程与学习增益关系不稳定），URL：https://www.sciencedirect.com/science/article/pii/S0959475226001672 （DOI: 10.1016/j.learninstruc.2026.102482）。

**同伴学习、归因与重规划。** 同伴辅导（peer tutoring）元分析：Rohrbeck 等（2003，*JEP* 95(2)）显示同伴辅助学习干预对小学生成就有中等以上效应，且**互惠（reciprocal）结构**效应更大；Ginsburg-Block 等（2006，*JEP* 98(4)）进一步显示其对社会性、自我概念与行为结果的普遍增益 [13][14]。中学数学领域的系统综述亦报告中等效应并讨论调节变量（Alegre, Moliner, Maroto & Lorenzo-Valentin, 2019, *Heliyon* 5(9) e02491，https://pmc.ncbi.nlm.nih.gov/articles/PMC6819807/；另见 Visible Learning MetaX 数据库条目：https://www.visiblelearningmetax.com/influences/view/peer_tutoring ；2025 年 STEM 元分析报告 ES=1.23，ScienceDirect 条目 https://www.sciencedirect.com/science/article/pii/S2666374025000123 ，作者/刊物待核）。注意：文献中的同伴效应建立在**真人互惠互教结构**之上；本项目的 `teaching-peer-reinforcement` 是 AI 扮演学习伙伴、以【策略】6 枚举触发强化话语与追问，是"示范性同伴"而非互教结构（见对照）。归因侧，Weiner（1985）的归因理论指出：把结果归因于努力/策略等**可控、不稳定**因素而非能力等**稳定**因素，可维持期望与动机 [15]——`teaching-replan-attribution` 明确"归因指向策略而非能力"，`primaryReasonCode`（策略类归因码）→ `recommendation`（改策略建议）→ `expect`（期望重置）构成字面化的归因重塑链。学习分析（learning analytics）研究中的"检测—干预—再规划"循环（如 Heikkinen, Saqr, Malmberg & Tedre, 2022 的系统综述预印本，DOI 10.21203/rs.3.rs-1738740/v1）为该字段提供了领域背景。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
| --- | --- | --- | --- | --- |
| [1] | Black, P., & Wiliam, D. (1998). Inside the Black Box: Raising Standards Through Classroom Assessment.（Granada Learning 专题本；Phi Delta Kappan 版卷期待核） | https://mededmentor.org/atlas/theories/black-box-theory （书目核验：https://scholar.google.com/citations?user=56tRR6EAAAAJ&hl=en） | checkpoint、warmupOutcomes、wrapup evaluation、parkingLot | 形成性评价奠基综述；同作者同年另有 *Assessment and Classroom Learning*（Assessment in Education 5(1), 7–74） |
| [2] | Black, P., Harrison, C., Lee, C., Marshall, B., & Wiliam, D. (2004). Working Inside the Black Box: Assessment for Learning in the Classroom. *Phi Delta Kappan*（Sep 2004，卷期待核） | https://fame-michigan.nyc3.cdn.digitaloceanspaces.com/_legacy/wp-content/uploads/2018/06/Black-Harrison-Marshall-Wiliam-Working-Inside-the-Black-Box-Assessment-for-Learning-in-the-Classroom.pdf | checkpoint、controls、parkingLot | AfL 的课堂操作化（提问环境、反馈、自评互评）；为检查点流程提供实践模板 |
| [3] | Chi, M. T. H., & Wylie, R. (2014). The ICAP Framework: Linking Cognitive Engagement to Active Learning Outcomes. *Educational Psychologist*, 49(4), 219–243 | https://psycnet.apa.org/record/2014-45290-002 （全文 PDF：https://education.asu.edu/sites/g/files/litvpz656/files/lcl/chiwylie2014icap_2.pdf） | teaching-opening 三模式、checkpoint、peer | I>C>A>P 参与阶梯；开场模式与伙伴追问均是把学生推向 C/I 模式的手段 |
| [4] | Shehzad, U., Recker, M., & Clarke-Midura, J. (2025). Exploring the potential of exit tickets as formative assessments of student affect. *Assessment in Education: Principles, Policy & Practice* | https://doi.org/10.1080/0969594x.2025.2510206 （全文 PDF：https://par.nsf.gov/servlets/purl/10617337） | parkingLot、checkpoint | exit ticket 作为嵌入学习过程的即时形成性证据工具；与停车区"课后待办"设计同构 |
| [5] | Dillenbourg, P. (2013). Design for classroom orchestration. *Computers & Education*, 69（页码待核） | https://doi.org/10.1016/j.compedu.2013.04.013 | controls、知识看板 | 课堂级可用性=编排；SRI 存档 PDF（https://www.sri.com/wp-content/uploads/2021/12/1-s2.0-s0360131513001036-main.pdf ，对应卷期待核）载其工作定义："real-time / multi-layered / multi-constraints" |
| [6] | Dillenbourg, P., Prieto, L. P., & Olsen, J. K. (2018). Classroom Orchestration. In *International Handbook of the Learning Sciences*（Routledge，页码待核） | https://doi.org/10.4324/9781315617572-18 | classroomContext、controls | 编排概念权威综述章；活动状态管理与控制面设计的直接参照 |
| [7] | Perrotta, C., & Evans, M. A. (2013). Orchestration, power, and educational technology: A response to Dillenbourg. *Computers & Education*, 69, 520–522 | https://doi.org/10.1016/j.compedu.2013.04.007 （条目见 ISLS 主题页：https://www.isls.org/research-topics/classroom-orchestration） | 支线预算、单焦点主讲 | 编排的权力批评：谁拥有节奏与焦点控制权——强控制设计的反向视角 |
| [8] | Ausubel, D. P. (1960). The use of advance organizers in the learning and retention of meaningful verbal material. *Journal of Educational Psychology*（卷期待核） | https://doi.org/10.1037/h0046669 | teaching-opening（承接式/场景式/目标式） | 先行组织者：正式内容前提供锚定结构、联结先备知识 |
| [9] | Kapur, M. (2008). Productive Failure. *Cognition and Instruction*（卷期页码待核） | https://doi.org/10.1080/07370000802212669 | teaching-opening（predict） | 先预测/尝试后教学的结构化失败路径；predict 开场模式的实证依据 |
| [10] | Sweller, J., & Cooper, G. A. (1985). The Use of Worked Examples as a Substitute for Problem Solving in Learning Algebra. *Cognition and Instruction*, 2(1)（页码待核；同第一章文献 [9]） | https://doi.org/10.1207/s1532690xci0201_3 | teaching-opening（example-first） | 样例先行优于解题先行的经典证据（对新手） |
| [11] | Keller, J. M. (1987). Development and use of the ARCS model of instructional design. *Journal of Instructional Development*（卷期待核） | https://doi.org/10.1007/bf02905780 | warmupOutcomes、开场模式选择 | 注意/相关/自信/满意四要素的动机设计框架 |
| [12] | Rowe, M. B. (1974). Wait-time and rewards as instructional variables, their influence on language, logic, and fate control: Part one—wait-time. *Journal of Research in Science Teaching*, 11(2)（页码待核） | https://doi.org/10.1002/tea.3660110202 | checkpoint（提问节奏） | 提问后等待时长改变学生话语质量；wait-time 经典 |
| [13] | Rohrbeck, R. G., Ginsburg-Block, M. D., Fantuzzo, J. W., & Miller, T. R. (2003). Peer-assisted learning interventions with elementary school students: A meta-analytic review. *Journal of Educational Psychology*, 95(2), 240 起（止页待核） | https://doi.org/10.1037/0022-0663.95.2.240 | teaching-peer-reinforcement | 同伴辅导元分析；互惠（reciprocal）结构效应更大（d=.5–.96），非互惠较小 |
| [14] | Ginsburg-Block, M. D., Rohrbeck, R. G., & Fantuzzo, J. W. (2006). A meta-analytic review of social, self-concept, and behavioral outcomes of peer-assisted learning. *Journal of Educational Psychology*, 98(4), 732 起（止页待核） | https://doi.org/10.1037/0022-0663.98.4.732 | teaching-peer-reinforcement | 同伴互助的非学业结果（社会性/自我概念/行为）增益——"强化/鼓励"设计的社会性依据 |
| [15] | Weiner, B. (1985). An attributional theory of achievement motivation and emotion. *Psychological Review*, 92(4), 548 起（止页待核） | https://doi.org/10.1037/0033-295x.92.4.548 | teaching-replan-attribution | 归因维度（部位/稳定性/可控性）与动机；归因指向可控策略因素以维持期望 |

### 项目设计与文献的对照

**一致点**
1. **checkpoint / warmupOutcomes / wrapup = AfL 证据循环**：提取证据（checkpoint、warmup）→ 汇总反馈（summary、evaluation）→ 调整教学（replan-attribution），与 Black & Wiliam 的形成性评价核心循环一致 [1][2]；`parkingLot` 与 exit-ticket 式"即时证据 + 未决问题"设计同构 [4]。
2. **controls / 知识看板 / 回合模式 = 编排控制面**：把"实时、多层、多约束"的编排工作显式化为字段约束，与课堂编排研究的设计目标一致 [5][6]；`classroomContext` 持久化与 `recentEvents`/`session-resumed` 对应课堂活动状态管理 [6]。
3. **开场三模式各有实证锚点**：example-first→样例效应 [10]；predict→productive failure [9]；self-assess→AfL 自评 [1][2]；ICAP 为三模式的共同解释框架（推向 C/I 参与模式）[3]。承接式/场景式/目标式进入与先行组织者传统一致 [8]；ARCS 为 warmup 提供动机坐标 [11]。
4. **replan-attribution「归因指向策略而非能力」**：精确对应 Weiner 归因理论的可控性/稳定性原则——归因于可控不稳定的策略因素以维持期望 [15]；`evidenceRefs` 使归因有据可查，符合学习分析干预对证据链的要求。

**张力点**
1. **"同伴"命名 vs 互教结构**：`teaching-peer-reinforcement` 的同伴是 AI 模拟的学习伙伴（message + followUpQuestions +【策略】枚举），文献中同伴辅导的效应量建立在**真人互惠互教**（双方轮流教/学）之上 [13][14]；AI 伙伴没有真实的"被教"角色，peer tutoring 证据不可直接外推。术语上避免让读者以为这是 peer tutoring 的数字化。
2. **归因主体错位**：Weiner 理论中的归因是**学习者的主观知觉**；项目的 `primaryReasonCode` 是**系统对失败原因的判定**。若系统把"策略原因"的结论直接呈现给学习者，绕过了归因重塑所依赖的感知/接受过程，可能变成"贴标签"而非归因干预 [15]。
3. **强控制设计 vs 编排的权力批评**：支线预算 + 单焦点主讲提升了编排效率 [5][6]，但 Perrotta & Evans 指出编排隐喻内嵌控制权分配问题 [7]——离题被预算压制的同时，也可能丢弃 productive failure 意义上的生产性偏离 [9]；支线预算阈值无任何文献基线。
4. **ICAP 假设强度受近期检验**：2026 年 Learning and Instruction 的严格检验显示 constructive 模式的学习增益并不稳定（正文已附 URL/DOI）；依赖 ICAP 为 opening/peer 设计背书时应保留强度限定 [3]。
5. **wrapup 的档位化粒度**：`evaluation` 三项档位把连续表现离散化；Black & Wiliam 传统强调反馈应指向任务与过程而非等级/分数 [1][2]，档位若作为面向学生的呈现形态，与该原则存在紧张。

**风险点**
1. **wait-time 在对话式 AI 中难以兑现**：Rowe 的证据来自真人课堂的静默等待 [12]；LLM 导师 checkpoint 提问若立即自答或连续追问，等效"零等待"，需要显式的静默/延迟设计，且其效果未经文献检验。
2. **事件窗口过短**：`recentEvents` 仅 5 条，而 AfL 强调纵向证据积累 [1][2]；断线恢复（session-resumed）后的阶段/焦点快照可能陈旧，checkpoint 判定可能基于不完整证据链（编排文献强调实时性 [5][6]，恢复后的重验证机制值得增加）。
3. **ARCS 是设计框架而非测量工具**：`warmupOutcomes` 若以动机维度产出指标，其 `metricInterpretation` 的效度需自行建立 [11]。
4. **归因码枚举的策略偏置**：`primaryReasonCode` 若只枚举策略类原因，将无法表达真实的先备缺口（可能需承接式重教）[8][15]；归因字段与 `classroomContext`/`warmupOutcomes` 的证据应交叉校验，避免系统性误归因。
5. **同伴触发的时机伦理**：`peerTriggerService` 在学生受挫/卡壳时插入伙伴话语，若频次过高可能干扰单焦点主讲；ICAP 提示 interactive 模式需双方实质参与 [3]，由 AI 单方面触发的"互动"更接近 scripted prompting，效应未知。
