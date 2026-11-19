# _lit-04｜字段族⑦ 任务设计与评估 ＆ ⑧ 动机/情感/归因支持 —— 学术文献调研

> **调查版本冻结**：WenFlow skill prompt，仓库 commit `e736f7aa`（2026-11-18 +0800）；调查执行日 2026-11-19。
> **检索方法**：tavily 检索 12 次（12 条互不重复的英文查询）＋已知候选 URL 核读（WebFetch：Wikipedia、PubMed、Crossref API、ERIC、ASCD、大学/机构 PDF 存档）。检索与核读清单见文末附录。
> **引用纪律**：全部被引文献均真实出现在本次检索结果或核读正文中（附 URL）；无法逐字核实卷期页码或原始篇名处，一律标注（出处待核）；`sessionLss/sessionLf`、`predictedTone` 三档、情绪急救三步等无文献口径的项目内部构造，如实标注为项目内部指标，不强行配文献。

---

## 章节一：任务设计与评估字段（字段族⑦）

### 覆盖字段

- **subtasks（14 子键）**：`cognitiveLevel`（布鲁姆认知层级）、`icapLevel`（ICAP 四档 passive/active/constructive/interactive）、`knowledgeType`、`anticipatedMisconceptions`（预判迷思概念）、`transferable`（可迁移检验）、`prerequisiteGaps`（前提缺口）、`taskType`（含 `consolidate` 巩固）、`exitCriteria`（「暴露误区→建立判断→独立做对」错误修正闭环）、概念门槛门控 `gate`、真实性任务情境化、同伴互动设计等；
- **任务二分与裁决**：`judgeable` / `not_judgeable`（可评判任务 vs 训练形态任务）、`taskDifficulty`、checkpoint 答案键 / 代码裁决 `checkpointVerdict`；
- **探针与量规**：`anchorProbe`（独立锚题探针，无提示变式轮）、rubric 档位 `low/mid/high`；
- **免修与验收口径**：`test_out` 免修测验、「验收写表现，不写作品」（表现性验收口径）；
- **可证伪断言三件套**：`falsifiableClaims`（`claim` / `checkOn` / `expect`）；
- **粒度参数**：`difficultyBand`、`suggestedDepth`（讲解深度 shallow/standard/deep）。

### 对应学术构念

**（一）建构性一致与评估对齐：subtasks 全族、judgeable 二分、rubric。** 项目 `subtasks` 的 14 个子键本质上是一条「预期成果—学习活动—评估证据」的对齐链：`cognitiveLevel`/`knowledgeType`/`taskType` 描述成果的认知属性，任务形态与真实性情境化描述活动侧，`judgeable`/checkpoint 答案键/`exitCriteria`/rubric 描述评估侧。这正是 Biggs 建构性一致（constructive alignment）的处方：预期学习成果（ILO）、教学活动与评估任务三者须直接互指，使学生「以评估要求的方式」学习 [1-1]；综述文献将其概括为「定义成果→设计对齐活动→设计对齐评估→一致性检验」四步（IntechOpen 章节，检索结果）。`judgeable`/`not_judgeable` 二分在评估学上承担关键功能：只有产出可评证据的任务才能作为「达成」的判定材料，训练形态任务（示范、跟练）不产生达成证据——对应成果本位教育中「评估任务与评估准则须明确、直接关联学习成果」的审计要求（Biggs 对 QAA 原则的转述，tru.ca 存档 PDF）[1-1]。rubric 档位 low/mid/high 对应 Brookhart 对 rubric 的定义——「描述学生作品表现质量等级的连贯准则集」，她同时警告 rubric「常被误解与误用」[1-5]（项目单维三档与多准则 rubric 的差距见对照节）。

**（二）形成性评价、迷思诊断与可证伪验收：exitCriteria 闭环、gate、anchorProbe、falsifiableClaims。** `exitCriteria` 的「暴露误区→建立判断→独立做对」是一个三段错误修正闭环，文献对应有三层。第一层是形成性评价纲领：Black & Wiliam 1998 确立「用课堂评估证据驱动教学调整」的范式，其后续课堂操作化（Working Inside the Black Box）把「收集证据→反馈→调整」落为常规动作 [1-2][1-3]；项目的闭环把「证据→判断」交给 checkpoint 裁决（`checkpointVerdict`），把「调整」交给 gate 与下一轮任务。第二层是迷思概念诊断：`anticipatedMisconceptions`、`prerequisiteGaps` 与 gate 对应诊断性评估/诊断教学文献——NZCER 的数学诊断材料明确将「预判学生会遇到的迷思→从错误答案推断成因→回灌教学修正迷思与错误」作为设计原则 [1-9]，Galeos 2024 提供诊断性教学改善概念理解、迷思与成绩的实证（期刊层级较低，作辅助证据）[1-10]。第三层是「独立做对」的判据：`anchorProbe` 无提示变式轮与 `taskType=consolidate` 巩固题直接对应测试效应（testing effect）——Roediger & Karpicke 的结论「测试是改进学习的强大手段，而不只是评估」[1-8]；以同构变题而非原题复测还隐含迁移检验（对应 `transferable`），但迁移构念的专文本次未直接命中（出处待核）。`falsifiableClaims` 三件套则是 Popper 可证伪性的教学化转写：`claim` 相当于待检命题，`checkOn` 相当于检验时点/初始条件，`expect` 相当于该命题所排除的可观察陈述——观察与 expect 相悖即判伪（modus tollens 结构）[1-11]。

**（三）icapLevel：直接以 ICAP 命名字段的正确性与边界。** `icapLevel` 是本项目少数直接以学术框架命名的字段，命名正确性可确认：Chi & Wylie 2014 的 ICAP 框架按外显行为把认知投入分为 Interactive / Constructive / Active / Passive 四档，并提出随 Passive→Active→Constructive→Interactive 学习增益递增的假设（ERIC 摘要原文："engagement behaviors can be categorized... into one of four modes: Interactive, Constructive, Active, and Passive... from passive to active to constructive to interactive, their learning will increase"）；框架源头是 Chi 2009 提出的三档（active/constructive/interactive），2014 年补入 passive 档（ISLS 会议存档，检索结果）[1-6]。命名边界有三：其一，ICAP 分类的是「学习活动中的外显投入行为」，不是任务难度也不是知识类型，故 `icapLevel` 必须与 `cognitiveLevel`、`difficultyBand` 正交使用——同一任务可以「高认知层级、被动投入」或「低认知层级、互动投入」；其二，interactive 档的行为学定义要求同伴共创（互教、协作辩论等），1:1 人机教学场景天然难达成——项目把同伴互动设计单列为子键是自洽的，但应显式声明该档在无同伴条件下的降级规则，否则模型可能虚构「同伴互动已发生」；其三，ICAP 的证据基础是行为模式与学习结果的总体相关，田野记录显示教师存在对该框架的误读误用（ISLS 存档，检索结果），故四档取值虽与原框架逐字一致、属忠实引用，但不宜在 prompt 中宣称「越高档越必然更好」的逐任务保证。

**（四）认知层级、难度与免修：cognitiveLevel vs Webb DOK，difficultyBand，suggestedDepth，test_out。** `cognitiveLevel`（布鲁姆层级）与 Webb 的 Depth of Knowledge 是两套常被并置的认知需求分级。Webb 把「认知深度一致性（Depth of Knowledge Consistency）」列为课程标准—评估对齐的判据之一：评估任务的认知深度须与标准要求的深度一致（Webb 2007, Applied Measurement in Education, ERIC EJ752688）[1-7]；常被引用的 DOK 四档命名（回忆/技能与概念/策略思考/扩展思考）在本次核读中未取得原文逐字出处（出处待核），正式引用前应复核 Webb 原始技术报告。项目把 `cognitiveLevel`（按认知动作分级）与 `difficultyBand`/`taskDifficulty`（经验难度）并列，方向正确：难度与认知深度是可错位的两个构念——难题可以低 DOK，容易题可以高 DOK；若用判对率反推认知层级会造成对齐误判。`suggestedDepth`（shallow/standard/deep）在本次检索中未见直接文献锚点，应标注为项目内部设计参数。`test_out` 免修测验对应 competency-based learning 的核心命题：以「证明掌握」而非学时推进，学习成果以行为/表现术语定义并写明达成判据（criterion level），学生可多次尝试直至展示掌握 [1-12]；credit by exam / prior learning assessment 的专项文献未检索命中（出处待核），CBE 词条为可用对照。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
| --- | --- | --- | --- | --- |
| [1-1] | Biggs, J. (1996). Constructive alignment in university teaching. *HERDSA Review of Higher Education*, 1（同年另刊 Enhancing teaching through constructive alignment, *Higher Education*, 32, 1–18，经转引源核实） | https://www.tru.ca/__shared/assets/Constructive_Alignment36087.pdf | subtasks 全族、judgeable/not_judgeable、exitCriteria、rubric | 建构性一致：ILO—活动—评估三者对齐；IntechOpen 综述与 Wikipedia 词条交叉确认 Biggs 1996 为框架源头。项目任务链即「成果可评证据链」的直接实现。 |
| [1-2] | Black, P., & Wiliam, D. (1998). Inside the Black Box: Raising Standards Through Classroom Assessment. *Phi Delta Kappan*, 80(2) | https://www.michigan.gov/-/media/Project/Websites/mde/Year/2017/09/18/Inside_The_Black_Box_-_Black_and_William.pdf | exitCriteria、gate、checkpoint、anchorProbe | 形成性评价纲领文献；配套书讯/导读称其综述约 600 项研究、形成性用法下学生进步近乎翻倍（转引摘要，效果量表述待核原书）。 |
| [1-3] | Black, P., Harrison, C., Lee, C., Marshall, B., & Wiliam, D. (2004). Working Inside the Black Box: Assessment for Learning in the Classroom. *Phi Delta Kappan*（完整作者序待核：检索摘要可见 Lee/Marshall/Wiliam 署名） | https://fame-michigan.nyc3.cdn.digitaloceanspaces.com/_legacy/wp-content/uploads/2018/06/Black-Harrison-Marshall-Wiliam-Working-Inside-the-Black-Box-Assessment-for-Learning-in-the-Classroom.pdf | exitCriteria「暴露误区→建立判断→独立做对」 | 1998 纲领的课堂操作化；「证据→反馈→调整」的常规化与项目三段闭环同构。 |
| [1-4] | Wiggins, G. (1989–1993). 真实性评价系列主张（原始篇名与刊源待核；经 Illinois State 大学讲义与 InSITE 2020 论文两处转引核实） | https://education.illinoisstate.edu/downloads/linc/linccurriculummodule/Defining%20Authentic%20Assessment.pdf | 真实性任务情境化、「验收写表现，不写作品」、taskType | 真实任务应 mirror 真实世界的复杂性、协作与高层思维；authentic assessment 亦称 direct/performance assessment——「学生展示能做什么，而非能回忆什么」（XJTLU 存档转引）。 |
| [1-5] | Brookhart, S. M. (2013). *How to Create and Use Rubrics for Formative Assessment and Grading*. ASCD（ISBN 978-1-4166-1507-1；出版年页面未标注，待核） | https://www.ascd.org/books/how-to-create-and-use-rubrics-for-formative-assessment-and-grading | rubric 档位 low/mid/high、checkpointVerdict | rubric =「描述表现质量等级的连贯准则集」；书中专章讨论「关于 rubric 的常见误解」——单维三档的粒度风险见对照节。另见 Brookhart (2023) *Classroom Assessment Essentials*, ASCD, ERIC ED633854（本次检索命中）。 |
| [1-6] | Chi, M. T. H., & Wylie, R. (2014). The ICAP Framework: Linking Cognitive Engagement to Active Learning Outcomes. *Educational Psychologist*（卷期页码待核） | https://eric.ed.gov?id=EJ1044018 | subtasks.icapLevel、同伴互动设计 | 四档定义与 P<A<C<I 假设经 ERIC 摘要＋ASU 存档 PDF（https://education.asu.edu/sites/g/files/litvpz656/files/lcl/chiwylie2014icap_2.pdf）双源核实；Chi 2009 三档起源见 ISLS 存档（https://repository.isls.org/bitstream/1/6584/1/2407-2408.pdf）。原文 PDF 全文可取，icapLevel 为忠实引用。 |
| [1-7] | Webb, N. L. (2007). Issues Related to Judging the Alignment of Curriculum Standards and Assessments. *Applied Measurement in Education*（ERIC EJ752688，同行评审） | https://eric.ed.gov/?q=Webb+%22depth+of+knowledge%22+levels&ff1=autWebb%2c+Norman+L. | cognitiveLevel、difficultyBand、judgeable | 对齐四判据含「Depth of Knowledge Consistency」——cognitiveLevel 与评估任务深度一致性的判据来源；DOK 四档命名未获逐字原文（出处待核）。 |
| [1-8] | Roediger, H. L., III, & Karpicke, J. D. (2006). Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention. *Psychological Science*, 17(3), 249–255. DOI: 10.1111/j.1467-9280.2006.01693.x | https://doi.org/10.1111/j.1467-9280.2006.01693.x | anchorProbe、taskType=consolidate、exitCriteria | 「测试是改进学习的手段而不只是评估」——无提示独立再测作为验收判据的直接依据；书目经 Crossref API 核实。 |
| [1-9] | NZCER（作者/年份未见于检索摘要，待核）. Diagnosing misconceptions in mathematics: Using the Assessment Resource Banks to remedy student errors. *Set*（NZCER 期刊） | https://www.nzcer.org.nz/nzcerpress/set/articles/diagnosing-misconceptions-mathematics-using-assessment-resource-banks-remedy | anticipatedMisconceptions、prerequisiteGaps、gate | 「预判迷思→诊断成因→回灌教学修正」的实践文献；诊断信息用于教学规划并修正数学错误。 |
| [1-10] | Galeos, A. W. J. (2024). The Impact of the Diagnostic Teaching Approach on Students' Conceptual Understanding, Misconceptions, and Performance in Mathematics. *IJSMS* | https://www.ijsmsjournal.org/ijsms-v7i3p115.html | gate、exitCriteria | 诊断性教学的实证检验；期刊层级较低，作 gate/迷思修正主张的辅助证据。 |
| [1-11] | Popper, K. (1934/1959). *Logik der Forschung* / *The Logic of Scientific Discovery*（本行经 Wikipedia "Falsifiability" 词条核读；词条给出德文初版 1934、英译 1959） | https://en.wikipedia.org/wiki/Falsifiability | falsifiableClaims（claim/checkOn/expect） | 可证伪性=理论须排除某些可观察的基本陈述；C⇒P 且观察 ¬P 即判伪（modus tollens）——claim/checkOn/expect 三件套即「命题—检验条件—预期观察」结构的教学化。 |
| [1-12] | Competency-based learning（Wikipedia 词条，2026-11-19 核读） | https://en.wikipedia.org/wiki/Competency-based_learning | test_out、exitCriteria、checkpointVerdict | 以证明掌握而非学时推进；成果以行为/表现术语定义并写明达成判据（criterion level），可多次尝试。例：Western Governors University、Mastery Transcript Consortium。credit by exam 专项文献未检索命中（待核）。 |

### 项目设计与文献的对照

**一致点**
- 对齐链完整无悬空：subtasks 成果属性→任务形态→judgeable 评估→exitCriteria 闭环，逐段可映射到建构性一致 [1-1]、形成性评价 [1-2][1-3]、诊断教学 [1-9][1-10] 与测试效应 [1-8]。
- `icapLevel` 命名忠实：四档取值与 Chi & Wylie 原框架逐字一致 [1-6]。
- 「验收写表现，不写作品」与 performance/authentic assessment 的「展示能做什么」口径一致 [1-4]；`anchorProbe` 无提示变式轮是测试效应的实践化 [1-8]；`falsifiableClaims` 是 Popper 判伪结构的严格转写 [1-11]。
- `cognitiveLevel` 与 `difficultyBand` 并列而非合并，符合「认知深度≠经验难度」的构念区分 [1-7]。

**张力点**
- rubric `low/mid/high` 是单维三档；Brookhart 的 rubric 观念是「多准则＋质量等级」的连贯集合 [1-5]。单维三档更接近 holistic scoring，在准则覆盖面窄时裁决一致性风险高；若要向文献口径靠拢，rubric 应携带分项准则而非单一档位。
- 真实性任务情境化是 Wiggins 真实性评价的弱版本：Wiggins 要求任务 mirror 真实世界的复杂性、协作与高层思维，项目的情境化子任务更接近「有真实情境包装的表现性任务」[1-4]。
- ICAP interactive 档在 1:1 场景不可达：需要显式降级规则，否则 prompt 可能生成虚构的同伴互动叙述 [1-6]。
- 「暴露误区→建立判断→独立做对」中「判断」环节的裁决权在系统答案键（`checkpointVerdict`），而形成性评价文献强调学习者参与证据解释；闭环是教师侧（系统侧）版本，学生侧元认知参与较弱 [1-2][1-3]。

**风险点**
- `not_judgeable` 的评估学含义：训练形态任务产出不得进入达成判定。若 profile 侧评估字段混用两类任务的产出，掌握度判定存在效度污染。commit e736f7aa 允许历史 not_judgeable 任务改写为可评任务，方向与成果本位一致，但需防「为可评而改写」稀释训练价值。
- Webb DOK 四档命名未逐字核实 [1-7]：项目文档引用 DOK 层级名前需复核 Webb 原始技术报告。
- `difficultyBand` 与 `cognitiveLevel` 若在下游被互相推导（以难度反推层级），将破坏两者正交性，造成对齐误判 [1-7]。
- `test_out` 免修的效度依赖题目对成果域的覆盖度与判据阈值（criterion level）的明确性 [1-12]；免修决策直接改变学习路径，误判成本高。

---

## 章节二：动机、情感与归因支持字段（字段族⑧）

### 覆盖字段

- **基调与风险信号**：`predictedTone`（smooth/struggle/fatigue）、`stallRisk` 卡壳风险、`fatigueSignal` 疲劳信号（`sessionLss`/`sessionLf` 压力/疲劳 proxy）；
- **动机信念**：成长型思维（过程表扬 vs 特质表扬、「还没 yet」框架）、归因重训（归因指向策略而非能力）、normalize struggle 正常化挣扎；
- **情绪支持**：情绪急救三步（正常化→赋权→小动作）、`empathy` 共情、`anxiety` / `motivation` / `confidenceLevel`；
- **求助与样例**：求助行为分流（executive/instrumental/avoidant）、`adaptive help` / `wantsWorkedExample`、适应性求助；
- **自评与结课权威**：`selfAssessmentAccuracy` 自评校准（高估/低估倾向）、隐藏自评信号、自报完成 vs 教师侧结课权威。

### 对应学术构念

**（一）成长型思维：正反证据并陈。** 项目成长型思维字段的正面依据是 Mueller & Dweck 1998 的六项实验（412 名五年级学生）：被表扬「聪明」（特质表扬）的儿童在经历失败后表现出更少的坚持、更差的表现、更低的任务愉悦感与更强的能力归因，而被表扬「努力」（过程表扬）的儿童显著更坚毅 [2-1]；Dweck 后续面向教师的转写（"The Perils and Promises of Praise"）把结论压成话术级原则——「表扬智力给一次短暂的骄傲爆发，随后是一长串负面后果」，挣扎应被解读为「还不熟练」而非「不聪明」，即「还没 yet」框架的语义来源 [2-2]。反方证据必须同栏并陈：Sisk 等 2018 的两项元分析发现 mindset 与学业成绩的关联及干预对成绩的效应都很小（干预标准化均差 d̄=0.08）[2-3]；Macnamara & Burgoyne 2023 的系统综述进一步报告总体 d̄=0.05、剔除偏倚风险后 d̄=0.04、最高质量 6 项研究 d̄=0.02 且置信区间跨零，结论是「表面效应可能源于研究设计缺陷、报告缺陷与偏倚」（有发表激励的作者报告的效应显著更大）[2-3]。对项目的含义：过程表扬/yet 框架属于「反馈话术级」应用，比「信念干预提升成绩」的强主张风险小得多，是双方文献都能接受的低剂量用法；但 prompt 不应承诺成绩效应（如「这样表扬会提高成绩」），也不应把 mindset 干预当作独立教学手段。

**（二）归因、学业情绪与基调预测。** 「归因指向策略而非能力」直接对应 Weiner 归因理论：成就情境中的因果归因沿 locus（内外）/stability（稳定）/controllability（可控）三维展开，归因维度决定后续期望（稳定归因维持期望方向）与情绪（羞耻、愤怒、内疚、自豪）[2-4]；把失败归因到不稳定、可控因素（努力、策略）是维持期望与适应情绪的教科书结论（WSU 教学理论开放教材亦以此向教师转译）。归因可被系统性改变并有干预文献支撑——Försterling 1985 对归因再训练（attribution retraining）的系统综述 [2-5]，normalize struggle（正常化挣扎）正是「把困难重归因为普遍、暂态、可控」的话术实现。情绪侧，Pekrun 控制—价值理论（control-value theory）给出学业情绪的产生机制：情绪由控制感×价值感评价产生——enjoyment=高控制高价值、anxiety=高价值低控制、boredom=低价值；情绪按效价×激活分为四象限（正激活：enjoyment/hope/pride；负激活：anger/anxiety/shame；负去活：hopelessness/boredom）[2-6]。项目 `anxiety`/`motivation`/`confidenceLevel` 可在此框架下解释为控制感、价值感与期望的代理读数；情绪急救三步（正常化→赋权→小动作）与 CVT 的干预路径（改变控制/价值评价、环境设计）同向，但「三步」这一具体结构本身无逐字文献出处（出处待核，属项目内部组合）。`predictedTone`（smooth/struggle/fatigue）则是**交互基调的功能分诊标签**，不是情绪状态识别——文献中对应的情绪离散模型（Pekrun 四象限 [2-6]；D'Mello 线的 boredom/frustration/confusion/flow [2-7]）粒度与语义均与之不同，二者不可互相宣称等价。

**（三）求助行为三分法的文献出处核实结果与工作样例。** 核实结论：**executive / instrumental 二分确证出自 Nelson-Le Gall (1981)**——转引源一（Karabenick & Newman《Help Seeking in Academic Settings》书稿预览页）原文引用其 1981 年论述（p.224）：executive 求助「为完成任务或规避批评而求助，表现为直接索要答案或明确指令、动员他人替自己解决问题」；instrumental 求助「由学习与掌握技能/理解的动机驱动」[2-8]；转引源二（Karabenick & Knapp 1991）再次确认「这两类求助被称为 executive 与 instrumental」并实证求助作为主动的、掌握取向的活动与学习策略使用正相关 [2-9]。**第三档 avoidant（回避型求助）在本次检索与核读源中未见与 Nelson-Le Gall 直接绑定的原文**：ITS 文献中的对应描述是「hint 滥用/猜答」行为模式——Roll 等的 Help Tutor 用平均 hint 层级（直取 bottom-out 答案＝executive 型依赖）与反应时间（快速点穿提示＝未阅读）识别不当求助，并引 Aleven et al. 2006 的框架比较 [2-10]；`avoidant` 一词的原始出处标注（出处待核），项目三分法中前两档文献谱系明确，第三档更接近文献中的 help abuse/avoidance 描述。`wantsWorkedExample`/`adaptive help` 对应工作样例效应：Sweller & Cooper 1985 证明用工作样例替换部分练习题获得更高学习增益、纯练习组耗时约为样例组 6 倍且错误更多 [2-11]；适应性给样例的时机机制由渐退（fading）＋自我解释提示研究给出——Atkinson, Renkl & Merrill 2003 证明渐退样例步骤促进「从读样例到独立解题」的过渡 [2-12]；边界由专长反转效应给出——样例优势随领域经验增长消失乃至反转，对高掌握者继续给样例有害 [2-13]，故 `wantsWorkedExample` 的满足应与掌握度状态门控联动而非无条件响应。

**（四）自评校准、情感支持与项目内部 proxy。** `selfAssessmentAccuracy`（高估倾向）的直接文献是 Kruger & Dunning 1999：实际成绩处于第 12 百分位的学习者自评约第 62 百分位，低技能者缺乏识别自身无能的元认知 [2-14]；但该效应的机制解释存在复现争议（Gignac & Zajenkowski 2020 主张主要是统计伪影——回归均值＋优于平均效应；McIntosh 等 2022 实证反驳「双重负担」解释），字段设计可采用其现象层（低表现者倾向高估）而避免采用机制层断言。Dunlosky & Rawson 2012 提供后果侧证据：不准的自我评估使学习者误判「已达标」而过早停止学习，损害考试成绩与长期保持（Crossref 核实题名）；同组 PubMed 检索另见 Lipko 等 2009（PMID 20025417）与 Dunlosky 等 2011（PMID 20700858）：引入外部标准（idea-unit）可降低过自信——这支持项目「自报完成须由教师侧判据锚定」的设计 [2-15]。情感支持侧（`empathy`、fatigueSignal、stallRisk），学习分析/AIED 证据链为：Baker 等 2010 测得无聊/沮丧/困惑在人机学习中的发生率、持续性与学习后果——无聊与学习显著负相关且比沮丧更持久（"Better to be frustrated than bored"）；D'Mello & Graesser 的 Affective AutoTutor 在对话导师中检测情感状态（对话特征+SVM）并作情感响应 [2-7]。`sessionLss`/`sessionLf` 是项目内部构造的会话级压力/疲劳 proxy（内部缩写，无文献口径，标注为项目内部指标）：文献只支持「情感状态可由交互行为间接推断」，不支持这两个缩写所隐含的具体测量口径；`predictedTone` 同理是分诊预测而非测量。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
| --- | --- | --- | --- | --- |
| [2-1] | Mueller, C. M., & Dweck, C. S. (1998). Praise for Intelligence Can Undermine Children's Motivation and Performance. *Journal of Personality and Social Psychology*, 75(1), 33–52 (PMID 9686450) | https://pubmed.ncbi.nlm.nih.gov/9686450 | 过程表扬 vs 特质表扬、normalize struggle | 六实验/412 名五年级生：特质表扬使受挫后坚持与表现更差、能力归因增强（Columbia 存档 PDF 另核：https://www.columbia.edu/cu/psychology/courses/3615/Readings/Mueller_Dweck.pdf）。过程表扬字段的经典正面依据。 |
| [2-2] | Dweck, C. S. (2007). The Perils and Promises of Praise. *Educational Leadership*（卷期待核；*Mindset* 一书（2006）为理论体系化出处，本次未直接命中，待核） | https://teaching.temple.edu/sites/teaching/files/resource/pdf/Dweck-Perils%20&%20Promises%20of%20Praise.pdf | 过程表扬、「还没 yet」框架 | 「表扬智力＝一次短暂的骄傲＋一长串负面后果」；失败时的挣扎意味着「还不熟练」——yet 框架语义来源；亦转引 Kamins & Dweck 1999、Cimpian 等 2007 同向结果。 |
| [2-3] | Sisk, V. F., Burgoyne, A. P., Sun, J., Butler, J. L., & Macnamara, B. N. (2018). To What Extent and Under Which Circumstances Are Growth Mind-Sets Important to Academic Achievement? Two Meta-Analyses. *Psychological Science*, 29(4), 549–571 ＋ Macnamara, B. N., & Burgoyne, A. P. (2023). Do Growth Mindset Interventions Impact Students' Academic Achievement? A Systematic Review and Meta-Analysis with Recommendations for Best Practices. *Psychological Bulletin*, 149(3-4), 133–173. DOI: 10.1037/bul0000352 | https://pubmed.ncbi.nlm.nih.gov/36326645 | 成长型思维字段（反方证据） | Sisk：干预对成绩 d̄=0.08；M&B 2023：总体 d̄=0.05、最高质量 6 研究 d̄=0.02 不显著，归因设计/报告缺陷与偏倚。两篇均经检索与 Crossref 双源核实（Sisk 书目经 englelab 存档 PDF 核实：https://englelab.gatech.edu/articles/2022/Macnamara%20and%20Burgoyne%20(2022)%20-%20Do%20Growth%20Mindset%20Interventions%20Impact%20Students%E2%80%99%20Academic%20Achievement.pdf）。 |
| [2-4] | Weiner, B. (1985). An Attributional Theory of Achievement Motivation and Emotion. *Psychological Review*, 92(4), 548–573 (PMID 3903815) | https://pubmed.ncbi.nlm.nih.gov/3903815 | 归因重训、normalize struggle、anxiety | 归因三维（locus/stability/controllability）决定期望与情绪；失败归因到不稳定可控因素维持期望——「归因指向策略而非能力」的理据（原文 PDF 另核：https://acmd615.pbworks.com/f/weinerAnattributionaltheory.pdf；教学转译见 WSU 开放教材 https://wsu.pressbooks.pub/theoreticalmodelsforteachingandresearch/chapter/attribution-theory）。 |
| [2-5] | Försterling, F. (1985). Attributional retraining: A review. *Psychological Bulletin*, 98(3), 495–512. DOI: 10.1037/0033-2909.98.3.495 | https://doi.org/10.1037/0033-2909.98.3.495 | 归因重训 | 归因再训练干预的系统综述（Crossref 核实）——归因可被系统改变，支持把归因重训做成常规教学动作而非临场话术。 |
| [2-6] | Pekrun, R. (2006). The control-value theory of achievement emotions: Assumptions, corollaries, and implications for educational research and practice. *Educational Psychologist*（卷期页码待核） | https://d-nb.info/1093175664/34 | anxiety、motivation、predictedTone、情绪急救 | 情绪=控制×价值评价的产物：enjoyment=高控高值、anxiety=高值低控、boredom=低值；四象限分类（正/负×激活/去活）经 Augsburg 存档 PDF 与 PMC12319179 双源核实。项目情绪字段的离散化对照系。 |
| [2-7] | Baker, R. S., D'Mello, S. K., Rodrigo, M. M. T., & Graesser, A. C. (2010). Better to be frustrated than bored: The incidence, persistence, and impact of learners' cognitive–affective states during interactions with three different computer-based learning environments. *International Journal of Human-Computer Studies*, 68(4), 223–241. DOI: 10.1016/j.ijhcs.2009.12.003 ＋ D'Mello, S., & Graesser, A. (2012). Affective AutoTutor（ACM TiiS；篇名尾部经检索摘要截断，待核） | https://doi.org/10.1016/j.ijhcs.2009.12.003 | fatigueSignal、stallRisk、empathy、predictedTone | Baker 等：无聊/沮丧/困惑的发生率、持续性及对学习的影响，无聊与学习显著负相关且更持久（UPenn 存档 PDF 另核：https://learninganalytics.upenn.edu/ryanbaker/BDRG-IJHCS-Final.pdf）。D'Mello & Graesser TiiS 2012：Affective AutoTutor 由对话特征检测情感并作情感响应（https://www.ida.liu.se/divisions/hcs/seminars/cogsciseminars/Papers/dmello-TiiS12.pdf）；另见 EDM2010 体态模式挖掘（https://educationaldatamining.org/EDM2010/uploads/proc/edm2010_submission_26.pdf）。 |
| [2-8] | Nelson-Le Gall, S. (1981). 求助行为 executive/instrumental 二分（原始篇名待核；经 Karabenick & Newman 2006 书稿预览引其 1981, p.224 及 Karabenick & Knapp 1991 转引核实） | https://api.pageplace.de/preview/DT0400.9781135810443_A26884942/preview-9781135810443_A26884942.pdf | 求助分流 executive/instrumental | executive 求助=只要答案/指令以完成任务甚至规避批评（动员他人替己解题）；instrumental 求助=为学会技能与理解而求助。项目前两档的直接出处；**avoidant 档未获直接原文出处（待核）**。 |
| [2-9] | Karabenick, S. A., & Knapp, J. R. (1991). Relationship of academic help seeking to the use of learning strategies and other instrumental achievement behavior in college students（刊名据 PDF 上下文待核） | https://ssrlsig.org/wp-content/uploads/2018/01/karabenick-knapp-1991-relationship-of-academic-help-seeking.pdf | 求助分流、adaptive help | 把求助确立为「主动的、掌握取向的自调节活动」并实证其与学习策略使用正相关——支持把「会求助」作为积极学习行为而非依赖。 |
| [2-10] | Aleven, V., 等 (2006) ITS 求助框架研究（篇名待核）＋ Roll, I., Aleven, V., McLaren, B. M., & Koedinger, K. R. Improving students' help-seeking skills using metacognitive feedback in an intelligent tutoring system（刊名缩写 JLI，全名待核） | https://pact.cs.cmu.edu/koedinger/pubs/Roll%20JLI.pdf | 求助分流、adaptive help、wantsWorkedExample | Help Tutor 以平均 hint 层级（直取 bottom-out＝executive 依赖）与反应时（快速点穿＝未读）识别不当求助；文中引 Aleven et al. 2006 为模型比较来源（另见 ITS 章节转引：https://merithub.com/tutorial/improving-students%E2%80%99-help-seeking-skills-in-an-intelligent-tutoring-system-c7cb2dlonhcu71pbqtrg）。 |
| [2-11] | Sweller, J., & Cooper, G. A. (1985). The use of worked examples as a substitute for problem solving in learning algebra. *Cognition and Instruction*, 2(1), 59–89. DOI: 10.1207/s1532690xci0201_3 | https://en.wikipedia.org/wiki/Worked-example_effect | wantsWorkedExample、adaptive help | 样例替换练习→增益更高；纯练习组耗时约为样例组 6 倍且错误更多（MIT TLL 摘述：https://tll.mit.edu/teaching-resources/how-people-learn/worked-examples；Springer 词条参考文献核图书目）。 |
| [2-12] | Atkinson, R. K., Renkl, A., & Merrill, M. M. (2003). Transitioning from studying examples to solving problems: Effects of self-explanation prompts and fading worked-out steps. *Journal of Educational Psychology*, 95(4), 774–783. DOI: 10.1037/0022-0663.95.4.774 | https://doi.org/10.1037/0022-0663.95.4.774 | adaptive help、wantsWorkedExample | 渐退式样例步骤＋自我解释提示促进「从读样例到独立解题」的过渡（Crossref 核实）——适应性给样例的时机机制；Renkl 系列另见 Cambridge Handbook 章节（DOI: 10.1017/cbo9780511816819.016 等）。 |
| [2-13] | Kalyuga, S. (2007). Expertise reversal effect and its implications for learner-tailored instruction（期刊卷期待核） | https://www.uky.edu/~gmswan3/EDC608/Kalyuga2007_Article_ExpertiseReversalEffectAndItsI.pdf | adaptive help、wantsWorkedExample | 专长反转：样例优势随经验增长消失乃至反转（文中引 Kalyuga et al. 2001 与 Cooper/Sweller 系列）——给样例须随掌握度门控，否则对高掌握者有害。 |
| [2-14] | Kruger, J., & Dunning, D. (1999). Unskilled and Unaware of It: How Difficulties in Recognizing One's Own Incompetence Lead to Inflated Self-Assessments. *Journal of Personality and Social Psychology*, 77(6), 1121–1134 | https://en.wikipedia.org/wiki/Dunning%E2%80%93Kruger_effect | selfAssessmentAccuracy（高估倾向）、隐藏自评信号、自报完成 | 实际 12 百分位者自评 62 百分位；技能与识别无能的元认知同源。**复现争议并陈**：Gignac & Zajenkowski (2020) 统计伪影说、McIntosh 等 (2022) 实证反驳双重负担——现象层可用，机制层慎断。 |
| [2-15] | Dunlosky, J., & Rawson, K. A. (2012). Overconfidence produces underachievement: Inaccurate self evaluations undermine students' learning and retention. *Learning and Instruction*, 22, 271–280. DOI: 10.1016/j.learninstruc.2011.08.003 | https://doi.org/10.1016/j.learninstruc.2011.08.003 | selfAssessmentAccuracy、自报完成 vs 教师侧结课权威、confidenceLevel | 不准自评→误判已达标→过早停止学习→成绩与保持受损（Crossref 核实题名；注：常见转引副标题与 Crossref 登记不符，以本条为准）。同组 PubMed 检索另见 Lipko 等 2009（PMID 20025417）、Dunlosky 等 2011（PMID 20700858）：外部标准（idea-unit）可降过自信——支持自报完成以教师侧判据锚定。 |

### 项目设计与文献的对照

**一致点**
- 过程表扬/特质表扬区分、「还没 yet」框架、归因指向策略、求助 executive/instrumental 分流、工作样例供给、自评校准，均有一代文献直接背书，且出处核实成功（Nelson-Le Gall 1981 经两个独立转引源确认 [2-8][2-9]）。
- 「自报完成 vs 教师侧结课权威」与校准文献方向一致：自评过自信有实证后果（过自信→少学→低成就）[2-15]，外部标准可校正 [2-15]。
- `wantsWorkedExample`＋掌握度门控的组合同时满足样例效应 [2-11]、渐退机制 [2-12] 与专长反转边界 [2-13]，是文献上最完整的字段设计之一。
- normalize struggle 与归因重训 [2-4][2-5]、成长思维话术 [2-1][2-2] 同向，三个字段形成互证的动机话术簇。

**张力点**
- `predictedTone` 三档（smooth/struggle/fatigue）与文献情绪离散模型（Pekrun 效价×激活四象限 [2-6]；D'Mello 线 boredom/frustration/confusion/flow [2-7]）粒度与语义均不同：tone 是**交互基调预测**（教学响应的分诊变量），不是情绪状态识别结果；两边不可互相宣称等价，消费 tone 的下游规则应按「分诊标签」而非「情绪测量」书写。
- 成长型思维字段的反方证据必须约束其用法：文献效应量小且高质量证据不显著 [2-3]，字段定位应是低剂量话术（反馈层），不得承载成绩效应承诺。
- 情绪急救「正常化→赋权→小动作」三步：与 CVT 干预路径（改变控制/价值评价）[2-6] 和归因再训练 [2-5] 同向，但三步结构本身无逐字文献出处（待核），是项目内部组合。
- 求助三分法中 `avoidant` 档无直接原文出处 [2-8]：文献谱系上它更接近 ITS 文献的 help abuse/avoidance 行为描述 [2-10]，建议 prompt 文档注明该档为操作性扩展而非 Nelson-Le Gall 原始分类。
- 文献中的情感响应依赖情感检测准确性；由 prompt 脚本化生成的 `empathy` 若基于误判（如把无聊当沮丧处理），文献证据提示无效甚至错位 [2-7]。

**风险点**
- `sessionLss`/`sessionLf` 为项目内部缩写、无文献口径：文献只支持「情感/投入状态可由交互行为间接推断」[2-7]，不支持具体测量定义；跨系统解释或对外文档引用时应明确标注为内部 proxy，避免被当作既有量表。
- `selfAssessmentAccuracy` 若被用于贴「高估型/低估型」人格标签，则超出 Kruger & Dunning 现象层证据的适用范围（该效应机制解释仍有争议 [2-14]）；作为单次任务的校准读数使用是安全的。
- 「隐藏自评信号」的推断链在文献中属于弱推断（自评信号≠稳定特质），且情绪/动机 proxy 的误判可能触发错误的话术分支（如对非焦虑者做焦虑干预）；建议所有动机/情感字段在 prompt 中声明「假设而非结论」的地位，由后续交互验证。
- 自报完成与教师侧权威的张力：外部判据优先 [2-15] 可能与用户自主感冲突；结课驳回应以判据呈现（哪里未达 exitCriteria），而非以权威口吻否定自报。

---

## 附录：检索与核读清单（审计用）

**tavily 检索 12 次（2026-11-19，互不重复）**
1. ICAP framework Chi Wylie 2014 passive active constructive interactive engagement modes
2. Biggs constructive alignment 1996 intended learning outcomes assessment higher education
3. Black Wiliam 1998 formative assessment feedback Inside the Black Box exit ticket
4. Wiggins 1990 authentic assessment performance assessment Brookhart rubrics design criteria
5. diagnostic tasks student misconceptions assessment mathematics science teaching anticipated errors
6. D'Mello Graesser affect detection AutoTutor boredom frustration confusion disengagement learning
7. Mueller Dweck 1998 praise for intelligence process praise children motivation setbacks
8. growth mindset interventions meta-analysis Sisk 2018 Macnamara Burgoyne 2023 effect size academic achievement
9. Weiner 1985 attributional theory achievement motivation emotion attribution retraining classroom
10. Pekrun 2006 control-value theory academic emotions anxiety boredom achievement emotions
11. Aleven help seeking Cognitive Tutor Nelson-Le Gall instrumental executive hints help-seeking
12. worked example effect Sweller Cooper 1985 algebra Renkl fading adaptive expertise reversal

**已知候选 URL 核读（WebFetch）**
- Wikipedia：Dunning–Kruger effect（Kruger & Dunning 书目＋复现争议）、Falsifiability（Popper 结构）、Competency-based learning（CBE 口径）；Depth of knowledge 词条 404（故 Webb 四档命名标待核）
- Crossref API：Macnamara & Burgoyne 2023（Psychological Bulletin 149(3-4)）、Dunlosky & Rawson 2012（Learning and Instruction 22）、Roediger & Karpicke 2006（Psychological Science 17(3)）、Försterling 1985（Psych Bull 98(3)）、Baker et al. 2010（IJHCS 68(4)）、Atkinson/Renkl/Merrill 2003（JEP 95(4)）
- PubMed：Dunlosky/Rawson/overconfidence 检索页（PMID 20700858、20025417）；9686450、3903815 摘要经 tavily 检索命中；36326645 摘要经 tavily 检索命中
- ERIC：Webb 作者过滤检索页（EJ752688 等 3 条）、Brookhart rubrics 检索页（ED633854、EJ1116552）、EJ1044018（Chi & Wylie）
- 机构 PDF 存档：ASU（chiwylie2014）、ISLS（Chi 2009 转引）、tru.ca（Biggs 1996）、michigan.gov（Black & Wiliam 1998）、fame-michigan（Working Inside the Black Box）、Illinois State（Wiggins 转引）、XJTLU（Wiggins/Mueller 转引）、Columbia（Mueller & Dweck）、Temple（Dweck 2007）、englelab（Sisk/M&B 效应量）、pbworks（Weiner 原文）、wsu.pressbooks（归因教学转译）、d-nb.info（Pekrun CVT）、Augsburg/PMC12319179（CVT 四象限）、UPenn（Baker IJHCS）、ida.liu.se（Affective AutoTutor）、EDM2010（体态—情绪）、pageplace（Karabenick & Newman 书稿：Nelson-Le Gall 1981 转引）、ssrlsig（Karabenick & Knapp 1991）、pact.cs.cmu.edu（Roll 等 Help Tutor）、uky.edu（Kalyuga 2007）、IntechOpen（CA 综述）、NZCER（数学迷思诊断）、IJSMS（Galeos 2024）、MIT TLL（工作样例）、ASCD（Brookhart 2013 书页）、Annoto/ALTC（ICAP 应用例）

**未获文献锚点、标注为项目内部或待核的项**：`sessionLss`/`sessionLf`（内部 proxy）；`predictedTone` 三档语义（内部分诊标签）；情绪急救三步结构（待核）；求助 `avoidant` 档（待核）；Webb DOK 四档命名（待核）；credit by exam 专项文献（待核，对照 CBE [1-12]）；`suggestedDepth` 三档（内部参数）；`transferable` 迁移构念专文（待核）；Dweck *Mindset* 2006 出版信息（待核）。
