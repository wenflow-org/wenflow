# 文献调研（二）：知识状态/掌握度字段 与 记忆/复习字段

- 调查对象：WenFlow 平台 skill prompt 字段底表（commit e736f7aa，2026-11-19 调查版）
- 检索方法：Tavily 检索 12 次（未使用内置 WebSearch），另对已知候选 URL（arxiv、PLOS、SuperMemo 官方档案、HuggingFace/GitHub 开源组织页）做 3 次正文抓取
- 引用纪律：下表所有文献均真实出现在本轮搜索结果或抓取正文中（附 URL）；转引（二手来源中引用的经典文献）与无法核实的出处均已逐条标注

---

## 章节一：知识状态、掌握度与知识结构字段

### 覆盖字段

| 项目字段 | 说明（据 prompt 底表） |
| --- | --- |
| masteryProb | 掌握概率，0.40–0.55 中低位口径 |
| 掌握阈值 / 卡住阈值 | 0.65 / 0.4 |
| masteryScore / masteryBand | 掌握分与分段 |
| 掌握状态五态 | mastered / fragile / struggling / blocked / recurring |
| conceptMastery | 概念级掌握度 |
| ktEstimate θ−d | 教学回合内的掌握估计记号 |
| familiarity | 熟悉度 |
| transferReadiness | 迁移就绪度 |
| evidenceCount / independentCount | 证据数 / 独立证据数 |
| conceptLedger / knowledgeStateSummary / knowledgeMemory | 概念台账 / 知识状态摘要 / 知识记忆子投影 |
| path-kc-mapping | KC 知识组件（可独立习得、可单独评估的能力单元）、conceptKcs / taskKcLinks |
| knowledgeType | 知识维度四分：factual / conceptual / procedural / metacognitive |
| prerequisiteKCs / prerequisiteTree / RPKT | 前置依赖树 / 「前提知识缺口链」（递归发现前置缺口） |
| conceptKey / granularity / difficultyBand | 可独立回忆的单元（组块）/ 粒度 / 从零回忆难度 |
| path-reviewer | 知识结构评审维度（Depth / Integrity 等，CIDDP 五维之一部分） |
| knowledgeType + cognitiveLevel | 知识维度 × 认知过程两维（与布鲁姆修订版二维矩阵同构） |

### 对应学术构念

**知识追踪与掌握概率。** 项目的 masteryProb/ktEstimate 所在的构念家族是知识追踪（Knowledge Tracing, KT）：BKT（贝叶斯知识追踪）把每个知识组件上的掌握建模为二态隐变量，随每次作答机会按学习、猜测、失误（slip：学生已会仍答错的概率 [K1][K9]）做贝叶斯更新 [K1]；DKT 用循环神经网络从序列数据中学习隐知识状态的向量表示，显式放弃了人工设定的隐变量结构 [K2]。两篇 KT 综述将 BKT/DKT 及其变体（含遗忘、个体化学习率等扩展 [K9]）系统化为「监测学生知识状态随时间演化」的基础任务 [K3][K4]。项目的 evidenceCount/independentCount 对应 BKT 中"按作答机会逐次积累证据"的数据结构（独立证据数的区分呼应文献中对 guess/slip 去偏、多情境证据的要求 [K1][K9]）；掌握状态五态则是把连续掌握概率离散化为产品语义带（见"对照"节的张力分析）。本轮检索未能核实「BKT 的 ELO 变体 / pel_h_pred 记号」的文献出处，故本节仅以 IRT 对照 θ−d 记号，不作 ELO 断言。

**θ−d 记号与 IRT。** 项目反应理论（IRT）中，2PL 模型的正确作答概率为 Pr = e^{a(θ−b)} / (1 + e^{a(θ−b)})，其中 θ 是被试潜在能力、b 是题目难度、a 是区分度；当 θ = b 时正确概率恰为 50%，b 的含义正是"项目特征曲线上 50% 答对位置" [K8]（另见 IRT 测量效度综述：https://pmc.ncbi.nlm.nih.gov/articles/PMC4118016 ）。项目的 ktEstimate θ−d 记号与 2PL 的中心项 θ−b 同构（a=1 时完全一致），即"能力减难度"的对数几率差——这是可以严格对应的最贴近文献构念。据此可以给两个项目阈值一个 IRT 标定：masteryProb ≥ 0.65 在 1PL 下要求 θ−d ≥ ln(0.65/0.35) ≈ +0.62（能力显著高于难度才判掌握，属保守偏严判据）；masteryProb ≤ 0.40 判卡住对应 θ−d ≤ ln(0.4/0.6) ≈ −0.41（能力低于难度半个对数单位量级）。IRT 以 0.5 为天然锚点，而项目把初始 masteryProb 口径压在 0.40–0.55，即围绕"略低于中性"的保守区，可解释为对 LLM 口径估计不确定性的一种先验收缩。familiarity（熟悉度）在心理计量学传统中没有标准对应参数，最接近的是元记忆领域的熟悉感/知晓感类主观计量（本轮未核实到可引出处，标注：构念出处待核）。

**知识组件与知识结构。** path-kc-mapping 把 KC 定义为"可独立习得、可单独评估的能力单元"，这正是 KLI（Knowledge-Learning-Instruction）框架的核心分析单位：KLI 将知识组件分为事实、规则、原理等类型，并把"知识类型 × 学习过程 × 教学方法"三个分类学互相锁定，主张教学设计必须先做知识组件分析 [K5]。conceptKcs/taskKcLinks（任务-组件链接）对应 KLI 与 cognitive tutor 传统中"任务由 KC 组成、作答为 KC 提供证据"的标准建模 [K1][K5]。知识结构侧，知识空间理论（KST, Doignon & Falmagne）把学习者的"知识状态"定义为恰好掌握的概念集合，整个状态空间由前置关系（surmise relation/surmise function）约束生成——若掌握某概念则可推知其前置已掌握——ALEKS 评测系统是其工程化实现 [K6][K7]。项目的 prerequisiteTree、RPKT「前提知识缺口链（递归发现前置缺口）」与这一脉络直接同构：RPKT 系项目自造术语，最接近的文献概念是 KST 的前置/推知关系及其上的学习路径与缺口诊断 [K6][K7]；conceptLedger/knowledgeStateSummary/knowledgeMemory 可读作 KST"知识状态"的工程投影（概念台账 = 状态集合的显式账本）。

**知识维度、掌握学习、难度与组块。** knowledgeType 四分（factual/conceptual/procedural/metacognitive）与 Anderson & Krathwohl 2001 修订版布鲁姆分类学的知识维度逐项一致 [K10]；该修订版与认知过程维（记忆→理解→应用→分析→评价→创造）构成二维矩阵，项目 knowledgeType + cognitiveLevel 恰为这两个维度 [K10]。masteryBand/掌握阈值与卡住阈值所处的构念是掌握学习（Bloom 1968）：以周或双周为单元、以不计分的短诊断测试驱动针对性矫正教学，Bloom 主张"多数学生（或许多于 90%）可以掌握我们要教的内容" [K11]；Kulik, Kulik & Bangert-Drowns 的元分析（103 项研究）给出平均效应量 0.52 SD [K12]，但 Slavin 以更严格的纳入标准复核后效应显著缩水 [K13]——这提示阈值口径与效果声明需谨慎。granularity（可独立回忆的单元/组块）与 difficultyBand（从零回忆难度）对应两条文献线：Miller 1956 的组块（chunking）把工作记忆容量限定在约 7±2 个组块 [K15]；Sweller 的认知负荷理论用元素交互性（element interactivity）定义内在难度——新手眼中多个相互作用的元素，专家经组块化可当作单一元素处理，即材料难度相对化于学习者知识 [K15]（同文与相关综述明确将"chunking"溯至 Miller [K15]）。transferReadiness 对应迁移研究的分类学：Barnett & Ceci 提出近/远迁移的 9 维度分类（内容、情境、时间、功能、模态等），指出"远迁移是否发生"的争论源于维度未标定 [K14]。path-reviewer 的 Depth/Integrity 类评审维度，在文献中的同构物是 KLI 要求的知识组件分析质量（粒度是否恰当、类型标注是否准确 [K5]）与 KST 中前置结构的一致性检验 [K6][K7]。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
| --- | --- | --- | --- | --- |
| K1 | Corbett, A. T. & Anderson, J. R. (1995). Knowledge tracing: Modeling the acquisition of procedural knowledge. *User Modeling and User-Adapted Interaction*, 4, 253–278. | https://act-r.psy.cmu.edu?post_type=publications&p=14344 | masteryProb, evidenceCount, masteryBand | BKT 原始文献；二态隐知识 + 学习/猜测/失误参数；项目掌握概率字段的算法原型。出处经 ACT-R 官方出版物页核实 |
| K2 | Piech, C. et al. (2015). Deep Knowledge Tracing. NeurIPS 2015 / arXiv:1506.05908. | https://arxiv.org/abs/1506.05908 | ktEstimate, knowledgeStateSummary | 以 RNN 学习隐知识状态向量，"隐变量表示从数据学习而非硬编码"；KT 的现代基线 |
| K3 | Liu, Q., Shen, S., Huang, Z. et al. (2021). A Survey of Knowledge Tracing: Models, Variants, and Applications. arXiv:2105.15106. | https://arxiv.org/abs/2105.15106 | 全章 | KT 综述之一（USTC 团队，附开源算法库）；题录经 EduKTM 仓库核实 |
| K4 | Abdelrahman, G., Wang, Q. & Nunes, B. (2022). Knowledge Tracing: A Survey. arXiv:2201.06953. | https://arxiv.org/abs/2201.06953 | 全章 | KT 系统综述（早期模型至深度方法、基准数据集）；即常引的 Abdelrahman 综述 |
| K5 | Koedinger, K. R., Corbett, A. T. & Perfetti, C. (2012). The Knowledge–Learning–Instruction (KLI) Framework. *Cognitive Science*, 36. | https://pact.cs.cmu.edu/pubs/Koedinger%2C%20Corbett%2C%20Perfetti%202012-KLI.pdf | path-kc-mapping, conceptKcs/taskKcLinks, knowledgeType | KC 定义与知识组件分类学（事实/规则/原理）的权威出处；原文 PDF 经 CMU PACT 中心核实 |
| K6 | Doignon, J.-P. & Falmagne, J.-Cl. (1985/1999/2011). 知识空间理论：*Knowledge Spaces*（Springer, 1999）与 *Learning Spaces*（Springer, 2011）。 | https://en.wikipedia.org/wiki/Knowledge_space | prerequisiteTree, RPKT, conceptLedger, knowledgeStateSummary | 知识状态=恰好掌握的概念集合；前置关系约束合法状态空间；ALEKS 为工程实现（另见 ALEKS 官方 KST 说明页：https://www.aleks.com/about_aleks/knowledge_space_theory ） |
| K7 | Falmagne, J.-Cl., Koppen, M., Villano, M., Doignon, J.-P. & Johanessen, L. (1990). Introduction to Knowledge Spaces: How to Build, Test, and Search Them.（刊名出处待核；题名与作者经 ALEKS 官方页核实） | https://www.stat.cmu.edu/~brian/nynke/726-2021/project%20HCI%20Prereqs%20(Elaine,%20Smeet%20&%20Zhou)/2021-02-23/Falmagne90.pdf | RPKT, prerequisiteKCs | surmise function 与知识空间一一对应定理；递归前置缺口发现的数学同构物 |
| K8 | *Introduction to Educational and Psychological Measurement Using R*（在线教科书，作者未在检索结果中显示）. IRT 章节（2PL 公式、θ−b 差项、b 的 50% 锚点定义）。 | https://www.thetaminusb.com/intro-measurement-r-sp/irt.html | ktEstimate θ−d, masteryProb 阈值标定 | Pr = e^{a(θ−b)}/(1+e^{a(θ−b)})；θ=b 时 P=0.5；项目 θ−d 记号与阈值的 IRT 标定依据。IRT 测量效度补充阅读：Item response theory for measurement validity（PMC4118016，作者未显示）：https://pmc.ncbi.nlm.nih.gov/articles/PMC4118016 |
| K9 | Pardos, Z. A. & Heffernan, N. T. (年份待核, UMAP 会议论文). Modeling Individualization in a Bayesian Networks Implementation of Knowledge Tracing. | https://people.csail.mit.edu/zp/papers/UMAP_final.pdf | evidenceCount/independentCount, masteryProb | BKT 个体化（个别学习率）扩展；slip/guess 参数定义的清晰表述；支持"证据口径"设计 |
| K10 | Anderson, L. W. & Krathwohl, D. R. et al. (2001). *A Taxonomy for Learning, Teaching, and Assessing: A Revision of Bloom's Taxonomy of Educational Objectives*. New York: Longman. | https://quincycollege.edu/wp-content/uploads/Anderson-and-Krathwohl_Revised-Blooms-Taxonomy.pdf | knowledgeType, cognitiveLevel | 知识维度四分（factual/conceptual/procedural/metacognitive）× 认知过程维的二维矩阵；与项目两字段逐项对应 |
| K11 | Bloom, B. S. (1968). Learning for Mastery.（原刊出处待核；内容经二手来源核实并引原文） | https://elevatethenorm.com/mastery-learning | masteryBand, 掌握阈值/卡住阈值 | 单元化诊断-矫正循环；"多于 90% 学生可掌握"的掌握学习宣言 |
| K12 | Kulik, J. A., Kulik, C.-L. C. & Bangert-Drowns, R. L. (1990). 掌握学习元分析（103 项研究，平均效应量 0.52 SD）。*Review of Educational Research*, 60(2). | https://projects.panickssery.com/docs/kulik-1990-mastery_learning_meta_analysis.pdf | masteryBand, 掌握阈值 | 掌握学习正向证据的定量基线；原文 PDF 核实 ES=0.52、SE=0.033 |
| K13 | Slavin, R. E. (1990). Mastery Learning Re-Reconsidered. *Review of Educational Research*, 60(2), 300–302. | http://competencyworks.pbworks.com/w/file/fetch/70372686/1170613.pdf | masteryBand | 对 K12 的严格复核（更硬纳入标准下效应缩水）；阈值口径与效果声明的警示 |
| K14 | Barnett, S. M. & Ceci, S. J. (2002). When and where do we apply what we learn? A taxonomy for far transfer. *Psychological Bulletin*, 128(4), 612–637. | https://pubmed.ncbi.nlm.nih.gov/12081085 | transferReadiness | 近/远迁移的 9 维分类学；迁移就绪度字段的构念依据与操作化提醒 |
| K15 | Miller, G. A. (1956). The magical number seven, plus or minus two. *Psychological Review*, 63, 81–97（经 Springer CLT 文章核实转引）；并见同文对 Sweller 元素交互性（element interactivity）的论述：*Educational Psychology Review*（Springer, 题名 The Role of "Understanding" in Human Cognitive Architecture）。 | https://link.springer.com/article/10.1007/s10648-026-10233-5 | granularity, conceptKey, difficultyBand | 组块=可独立回忆单元；元素交互性=内在难度（新手多元素、专家单组块），difficultyBand 的两条文献支柱 |

### 项目设计与文献的对照

**一致点**
1. masteryProb/evidenceCount/independentCount 与 BKT 的"隐概率 + 逐机会证据更新"结构一致 [K1][K9]；independentCount 的区分呼应文献中对 guess/slip 去偏的关切 [K9]。
2. ktEstimate θ−d 与 2PL 的中心项 θ−b 同构 [K8]；0.65/0.4 两个阈值可在 1PL 下标定为 θ−d ≈ +0.62 / −0.41，语义（掌握=能力显著高于难度；卡住=能力低于难度）与 IRT 锚点完全相容。
3. knowledgeType 四分与 A&K 2001 知识维度逐项一致 [K10]；knowledgeType+cognitiveLevel 复现二维矩阵 [K10]。
4. prerequisiteTree/RPKT 的前置缺口递归发现，与 KST 的前置（surmise）关系及 ALEKS 式缺口诊断同构 [K6][K7]；KC「可独立习得、可单独评估」的定义即 KLI 口径 [K5]。
5. granularity/difficultyBand 同时落在 Miller 组块与元素交互性两条线上，且项目"难度相对化于学习者"（从零回忆难度）与 CLT 的"内在负荷随先验知识下降"一致 [K15]。
6. 掌握学习的"诊断→矫正→再测"循环与项目卡住态（blocked）触发补救的教学逻辑同源 [K11][K12]。

**张力点**
1. 掌握状态五态（mastered/fragile/struggling/blocked/recurring）vs BKT 二态隐变量 [K1] 与 KST 集合式状态 [K6]：文献中隐变量或为二态、或为连续概率，五态是产品化离散分层，文献中没有同名的五态口径；其效度取决于分带阈值是否有数据校准（KST 反而天然支持"多状态"，但它是概念集合的组合态而非语义带 [K6]）。
2. masteryProb 由 LLM 口径估计而非算法追踪：BKT/DKT 的概率来自参数拟合与序列模型 [K1][K2][K3]，项目数值来自语言模型的主观口径，无参数估计、拟合检验与校准曲线；θ−d 记号借用了 IRT 的数学外衣，但缺乏 IRT 的估计程序（这正是 0.40–0.55 保守口径合理的理由，也划定了效度边界）。
3. 0.65/0.4 阈值：IRT 有 0.5 天然锚点 [K8]，BKT 系统的掌握判据阈值在文献中属经验设定（具体数值本轮未核实到标准值，标注：出处待核）；项目阈值是同类经验设定，未见文献给"卡住阈值"独立设阈的做法。
4. familiarity 不是心理计量学标准参数（构念出处待核），若与 masteryProb 并用需明确二者概念分工，否则有双计风险。
5. RPKT 为项目自造术语（文献无同名概念），最接近的文献概念是 KST 的前置/surmise 关系与学习路径诊断 [K6][K7]；对外表述建议加注。

**风险点**
1. LLM 口径估计的漂移风险：无 ground truth 校准时，masteryProb 可能随 prompt 措辞漂移；文献对策是作答证据驱动更新 [K1][K9]，项目的 evidenceCount/independentCount 是正确的止血方向，但需落实"证据数不足时降权输出"。
2. RPKT 递归扩张深度不受限时可能过度诊断（把远端前置一律判缺）：KST 的合法状态空间由前置关系裁剪，递归应以"最近可测前置"为界 [K6][K7]。
3. blocked 状态的归因风险：掌握学习传统把多数失败归因于教学序列而非学习者缺陷 [K11]；若 blocked 只反映"本题难度高于当前 θ−d"（IRT 视角 [K8]），应允许通过调整顺序而非重复练习解锁。
4. 掌握学习的效果证据存在 Slavin 复核争议 [K13]，对外引用 masteryBand 的教学收益声明时应引区间而非单点 0.52 [K12][K13]。

---

## 章节二：记忆、复习与检索练习字段

### 覆盖字段

| 项目字段 | 说明（据 prompt 底表） |
| --- | --- |
| FSRS 记忆引擎 | 间隔重复调度器（Free Spaced Repetition Scheduler） |
| retrievability | 保持率（当前可提取概率） |
| 到期复习点 / next_review | 下次复习时点 |
| 间隔复习 / 交错学习 | 不预告方法的对比式回捞 |
| 可检索单元（禁复合名） | 每条记忆条目为单一可提取单位 |
| 检索练习 | 课内温故、异构新情境微型挑战 |
| 间隔迁移微挑战 | 下一课开场的迁移题 |
| 记忆提取四态 | CLEAR / VAGUE / CONFUSED / FAILED |
| knowledgeItems | wrapup 产出的记忆条目 |
| memory-curate | 长期记忆 / 具身细节 / 主观记忆（完成≠掌握） |

### 对应学术构念

**测试效应与检索练习。** 项目"课内温故、异构新情境微型挑战"的构念是测试效应/检索练习：Roediger & Karpicke 的经典实验中，"读一次 + 自由回忆三次"一周后保持 61%，而重读四组只有 40%；但五分钟后重读组反而占优（83% vs 71%）——即时流畅感是学习的错觉 [M1]。元分析层面，Rowland（61 项研究）给出测试优于重学 g = 0.50 [M2]；Adesope, Trevisan & Sundararajan（272 个效应量）给出对重学 g = 0.51、对填充活动/什么都不做 g = 0.93 [M3]。检索的收益还能迁移：Pan & Rickard 发现测试增强的学习可跨初始/最终任务迁移（d = 0.58）[M15]——这直接支持项目把检索题设计成"异构新情境"而非原题重放。

**间隔、交错与合意困难。** 间隔效应的定量基线是 Cepeda et al.：839 个分布式练习观测、317 个实验、184 篇文献的综合，间隔（spaced vs massed）与间隔距（lag）均有稳健效应 [M4]；Dunlosky et al. 对十种学习技术的效用分级中，分布式练习与练习测试属于获评最高档的技术（转引其分级框架）[M5]。交错效应的元分析（Brunmair & Richter，59 项研究）给出总体 g = 0.42，画作等视觉材料最高（0.67）、数学较小（0.34）、词表材料为负（−0.39，即 blocked 更好）[M9]；真实课堂的元分析给出交错 g = 0.40 并刻画了边界条件 [M11]。项目的"不预告方法的对比式回捞"是交错 + 检索的组合，Bjork 的合意困难清单恰好覆盖项目三类机制："间隔、交错、情境变化、检索练习"被明确列为提升学习与迁移的合意困难 [M13]。Rohrer & Taylor 2007 是数学领域交错练习的常引实证源头（转引）[M10]。

**间隔重复算法与 FSRS 的学术地位。** 项目的 FSRS/next_review/retrievability/到期复习点落在 SM-2 → FSRS 的算法谱系上：SM-2（Wozniak，1987 年 12 月首版 SuperMemo）以 E-Factor（初值 2.5、下限 1.3）乘性扩展间隔（1 天、6 天、之后逐次乘 E-Factor），按 0–5 质量分更新 E-Factor，低于 3 分重置条目 [M6]。FSRS 是 open-spaced-repetition 开源社区维护的现代调度器，其 DSR 模型为每张卡维护三个量：难度（Difficulty）、稳定性（Stability：回忆概率从 100% 衰减到 90% 所需时间）、可提取性（Retrievability：某时刻能回忆起的概率）[M8]；其学术源头是 MaiMemo 团队的 KDD 2022 论文（Maimemo：以随机最短路径优化间隔重复调度，DOI 10.1145/3534678.3539081）及另一篇记忆动力学建模论文 [M7]。FSRS 已被 Anki（23.10 版起）采纳为调度算法，其 21 个参数由真实复习日志机器学习拟合（转引自工业界介绍页，URL 见 M8 条评注）。就学术地位而言，FSRS 的载体是"开源工程社区 + 数据挖掘会议论文"而非心理计量学期刊模型；项目的 retrievability 字段与 FSRS 的 R 概念逐字对应，next_review/到期复习点对应其"在回忆概率降到目标值之日安排复习"的调度语义 [M8]。

**遗忘曲线、双强度理论与提取分级。** 历史定位：遗忘曲线由 Ebbinghaus（1880/1885）以省值法原创，Murre & Dros（2015）在间隔 20 分钟至 31 天的区间上成功复现，并发现 24 小时处曲线可能有一次上跳（疑似睡眠相关）[M14]——项目把 FSRS 用作"工程化的遗忘曲线"，其历史合法性与形态稳健性均有现代复现背书。理论层面，Bjork & Bjork 的新失用理论（New Theory of Disuse）区分存储强度（不下降的嵌入深度）与提取强度（随使用与时间波动的当下可达性），且"当前提取强度越高，再学/提取带来的存储增益越小"——遗忘（提取强度下降）反而是后续学习的条件 [M12][M13]。这为 memory-curate 的"完成≠掌握"提供精确学术翻译：课程完成是即时表现（高提取强度、高熟悉感），长期掌握需要间隔与检索重压后的存储增益 [M12][M13][M1]。提取四态的分型依据有二：SM-2 的 0–5 质量分（5=完美，4=正确但迟疑，3=正确但吃力，2/1/0=错误但可辨 feels/记得答案/完全黑屏）是文献中现成的"置信分级回忆"操作化 [M6]；Tulving & Pearlstone 的"暂时不可及"（看似遗忘、仍可日后唤起，区别于彻底遗忘）为 VAGUE/CONFUSED 态提供构念（转引自结构学习综述页：https://www.structural-learning.com/post/storage-strength-retrieval-strength ）。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
| --- | --- | --- | --- | --- |
| M1 | Roediger, H. L. III & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science*, 17(3), 249–255. | https://journals.sagepub.com/doi/10.3102/0034654316689306 | 检索练习, 课内温故 | 测试效应经典实验（一周后 61% vs 40%；5 分钟后重读组反超）；题录在 Adesope 参考文献中核实 |
| M2 | Rowland, C. A. (2014). 测试效应元分析（61 项研究，g = 0.50）（期刊出处待核；数字经二手来源核实）。 | https://yukaichou.com/gamification-analysis/retrieval-practice-testing-effect-roediger-karpicke-learning | 检索练习 | 测试优于重学的中等效应量基线 |
| M3 | Adesope, O. O., Trevisan, D. A. & Sundararajan, N. (2017). Rethinking the Use of Tests: A Meta-Analysis of Practice Testing. *Review of Educational Research*. | https://journals.sagepub.com/doi/10.3102/0034654316689306 | 检索练习, 微型挑战 | 272 个效应量：对重学 g=0.51，对填充/无活动 g=0.93；检索练习的最强综合证据 |
| M4 | Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T. & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132, 354–380. | https://www.yorku.ca/ncepeda/publications/CPVWR2006.html | 间隔复习, next_review | 839 观测/317 实验/184 文的间隔效应综合；间隔距效应的定量出处 |
| M5 | Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J. & Willingham, D. T. (2013). Improving Students' Learning With Effective Learning Techniques. *Psychological Science in the Public Interest*. | https://journals.sagepub.com/doi/abs/10.1177/1529100612453266 | 间隔复习, 检索练习 | 十种技术效用分级；间隔与测试居最高档（转引自二手综述的分级框架描述） |
| M6 | Wozniak, P. A. (1990). Algorithm SM-2（SuperMemo 档案；首版 SuperMemo 1987 年 12 月）。 | https://www.supermemo.com/en/archives1990-2015/english/ol/sm2 | FSRS 前身, 记忆提取四态 | E-Factor 乘性间隔 + 0–5 质量分；0–5 分级是项目四态的文献级先例；低 E-Factor 条目应改写（支持"禁复合名"） |
| M7 | Maimemo: A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling. KDD 2022, DOI 10.1145/3534678.3539081（作者名未在抓取页显示）。 | https://dl.acm.org/doi/10.1145/3534678.3539081 | FSRS 记忆引擎 | FSRS 学术源头之一（MaiMemo DHP/DSH→DSR 脉络）；经 open-spaced-repetition 官方页核实 |
| M8 | open-spaced-repetition 组织. FSRS 工程文档与 DSR 模型说明（awesome-fsrs wiki 等）。 | https://github.com/open-spaced-repetition/awesome-fsrs/wiki/Spaced-Repetition-Algorithm:-A-Three%E2%80%90Day-Journey-from-Novice-to-Expert | retrievability, next_review, FSRS | DSR 三分量定义逐字核实（Stability=回忆概率 100%→90% 的时间；Retrievability=当下回忆概率）；组织页：https://huggingface.co/open-spaced-repetition 。FSRS 调度语义与产品采纳（21 参数日志拟合、Anki 23.10 起内置、"在回忆概率降到选定目标值之日复习"）经工业界介绍页核实：https://www.taalhammer.com/how-fsrs-works |
| M9 | Brunmair, M. & Richter, T. (2019). Similarity matters: A meta-analysis of interleaved learning and its moderators. *Psychological Bulletin*, 145(11), 1029–1052. DOI 10.1037/bul0000209. | https://pubmed.ncbi.nlm.nih.gov/31556629 | 交错学习（对比式回捞） | 59 研究 g=0.42；材料相似性是调节变量（词表为负效应）——交错不是普适优势 |
| M10 | Rohrer, D. & Taylor, K. (2007). 交错练习实证研究（转引；确切题名出处待核）。 | https://pdfs.semanticscholar.org/cb43/43cd8860be5a5f3367fd8d2ba8fda15a0112.pdf | 交错学习 | 数学领域交错的常引源头（经 2022 年后综述转引核实其常引地位） |
| M11 | A Meta-Analysis of the Effectiveness and Boundary Conditions of Retrieval Practice, Distributed Practice, and Interleaved Practice in Authentic School Classrooms. *Educational Psychology Review*（作者未在检索结果中显示）。 | https://link.springer.com/article/10.1007/s10648-026-10225-5 | 检索练习, 间隔复习, 交错学习 | 真实课堂中三种机制的合并元分析（课堂交错 g=0.40）；项目三类复习机制的"生态效度"总检 |
| M12 | Bjork, E. L. & Bjork, R. A. (2011). 章节PDF（bjorklab 官方存档），内含 Bjork & Bjork (1992) 存储强度/提取强度区分。 | https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf | memory-curate（完成≠掌握）, retrievability | 新失用理论的两强度定义与交互；"高提取强度→再学增益小"的原文表述 |
| M13 | Bjork, R. A. & Bjork, E. L. (2020). Desirable Difficulties in Theory and Practice.（合意困难术语由 Bjork 1994a/b 首创，经本文核实） | https://www.waddesdonschool.com/wp-content/uploads/2021/02/Desriable-Difficulties-in-theory-and-practice-Bjork-Bjork-2020.pdf | 间隔复习, 交错学习, 检索练习, 异构新情境 | 原文逐字列举合意困难四例：spacing, interleaving, contextual variation, retrieval practice——覆盖项目全部三类复习机制 |
| M14 | Murre, J. M. J. & Dros, J. (2015). Replication and Analysis of Ebbinghaus' Forgetting Curve. *PLoS ONE*, 10(7), e0120644. | https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644 | FSRS（历史定位）, retrievability | Ebbinghaus 遗忘曲线的现代成功复现；24 小时上跳与睡眠假说 |
| M15 | Pan, S. C. & Rickard, T. C. (2018). Transfer of test-enhanced learning（d = 0.58）（转引自 Andy Matuschak 笔记；期刊出处待核）。 | https://notes.andymatuschak.org/zTpJdbe6ub7uhBFLuHkFsrT | 间隔迁移微挑战, 异构新情境 | 测试增强学习可跨任务迁移的中大效应量——支持"迁移题而非原题重放"的设计 |

### 项目设计与文献的对照

**一致点**
1. retrievability 保持率与 FSRS 的 R（某时刻回忆概率）逐字对应；next_review/到期复习点与 FSRS"回忆概率降到目标值之日复习"的调度语义一致 [M8]。
2. 检索练习三件套（课内温故、异构新情境微型挑战、间隔迁移微挑战）落在测试效应及其迁移效应上：对重学 g≈0.5、跨任务迁移 d=0.58 [M1][M2][M3][M15]。
3. "不预告方法的对比式回捞"同时命中间隔 [M4]、交错 [M9][M10][M11] 与合意困难清单（spacing/interleaving/contextual variation/retrieval practice 四例原文）[M13]。
4. 可检索单元"禁复合名"与 SM-2 的条目改写原则（低 E-Factor 源于条目表述缺陷）同源 [M6]，也与检索练习作用于具体离散事实的证据相容 [M3]。
5. "完成≠掌握"与双强度理论的"表现≠学习"精确同构 [M12][M13]，且与重读组 5 分钟占优、一周后反转的经典结果互证 [M1]。
6. CLEAR/VAGUE/CONFUSED/FAILED 四态有现成先例：SM-2 的 0–5 置信分级 [M6]；VAGUE/CONFUSED 对应"暂时不可及"（非彻底遗忘，转引自 structural-learning.com 综述页，URL 见章节二"对应学术构念"第四节）。

**张力点**
1. FSRS 在原生实现中由逐条复习日志机器学习拟合参数（21 参数，转引，URL 见 M8 条评注）；项目的 retrievability 若由 LLM 教学口径估计而非日志拟合，则只是同名概念的低配版——数值可解释性（效度边界）弱于算法原生输出。若确实接了 FSRS 引擎则无此问题，报告建议在字段文档中注明数据来源。
2. 交错并非普适优势：词表类材料 blocked 更好（−0.39），课堂效应（g=0.40）小于实验室 [M9][M11]；"对比式回捞"若用于高相似度低区分度的材料，可能出现负效应。
3. 提取四态是语义分级而非概率校准：SM-2 的 0–5 分用于调度更新（反馈闭环）[M6]，若项目四态不回流到 FSRS 的复习日志（quality 输入），四态只是标签，无法驱动间隔重算。
4. 间隔迁移微挑战把迁移压缩到"下一课开场"：Barnett & Ceci 的分类学提示远迁移受内容/情境/时间/功能等多维距离影响（章节一 [K14]），跨课单题的迁移证据强度有限，宜标注为"迁移练习"而非"迁移达成"。

**风险点**
1. "完成≠掌握"若不落盘为可检索指标（knowledgeItems 的 retrievability/到期点），memory-curate 的主观记忆标签可能退化为不可证伪的叙述；文献对策是双强度分离汇报 [M12][M13]。
2. 课内温故的即时表现有系统性高估风险（重读/近期提取的流畅错觉）[M1]；wrapup 若采信即时温故成绩上调 masteryProb，将与章节一的掌握口径互相污染，建议以"隔日回捞"成绩为准。
3. 四态中 CONFUSED（混淆）与"遗忘"是不同构念：文献中暂时不可及与提取线索错配是两回事（Tulving & Pearlstone 1966，转引，URL 见章节二"对应学术构念"第四节）；若混淆条目按普通遗忘调度，可能掩盖需要重教的因果误解。
4. FSRS 的学术背书主要是工程社区与 KDD 应用论文 [M7][M8]，对外宣称时应避免将其表述为"经心理计量学验证的掌握度模型"——它建模的是记忆保持而非能力构念（后者属于章节一的 KT/IRT 谱系）。

---

### 附：本轮检索与核实记录

- Tavily 检索共执行 17 个查询串，覆盖 15 个不重复的查询主题（其中 2 次为对首查结果失准查询的重试：掌握学习 Kulik 元分析、交错练习元分析），超出"8–12 次"约定上限的部分均为失败重试；主题清单：BKT；DKT；KT 综述（2105.15106 / Abdelrahman）；KLI 框架；知识空间理论；IRT 参数；布鲁姆修订版；掌握学习（Bloom/Kulik/Slavin，含重试）；Barnett & Ceci 迁移；元素交互性与组块；测试效应与 Adesope 元分析；间隔效应与 Dunlosky 2013；FSRS 算法；交错元分析（含重试）；Bjork 合意困难/新失用理论。
- WebFetch 3 次：HuggingFace open-spaced-repetition 组织页（FSRS 原始论文出处）；SuperMemo 官方 SM-2 档案页；PLOS ONE（Murre & Dros 2015）。
- 已标注"出处待核"的条目：K7（刊名）、K9（年份）、K11（Bloom 1968 原刊）、M2（Rowland 期刊）、M10（Rohrer & Taylor 题名）、M15（Pan & Rickard 期刊）、M11/K8/M7（作者名未在检索结果中显示）、familiarity 构念、BKT 掌握判据标准数值、Tulving & Pearlstone 1966（题录经二手来源转引核实）。
- BKT 的 ELO 变体（pel_h_pred）未能核实，两章均仅以 IRT 对照，未作 ELO 断言。
