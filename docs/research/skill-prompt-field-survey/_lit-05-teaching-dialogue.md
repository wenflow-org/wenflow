# 05 教学对话与策略字段：文献调研

> 调查对象：WenFlow teaching 系列 skill prompt（commit e736f7aa，2026-11-19 调查版；teaching-turn coreVersion 19）。
> 检索方法：Tavily 搜索 12 次（不重复查询）+ 已知候选 URL 正文抓取 6 次；检索与抓取日期 2026-11-19。所有被引文献均出现在搜索结果或抓取正文中，URL 见文献表；无法核实完整出处的条目已标注（出处待核）。

---

### 覆盖字段

**（1）输出字段结构**

| 字段 | 结构 | 功能 |
|---|---|---|
| `reply` | 面向学生的回复文本 | 对话反馈的直接载体：纠错反馈、微讲授/直觉破题、图文互锁（防图文复读） |
| `analysis` | 14 个子字段（含 `confusionPoints` 困惑点、策略依据等） | 对话诊断层：困惑点定位、策略选择依据、迷思概念预判（`canonicalLabel` / `planned`） |
| `pedagogy` | `strategies`：8 个枚举策略 | 策略层：苏格拉底提问阶梯、guided discovery、先猜后揭 POE、Productive Failure、以教代学等 |
| `control` | `checkpoint` 检查点（6 子字段，含答案键/代码裁决）、`warmupOutcomes`、`supplement` 补充 | 形成性评价装置：检查点、独立锚题探针 `anchorProbe`、exit 类收束 |
| `knowledge` | `ktEstimate`（θ−d 掌握估计），知识看板回灌 | 学生掌握状态估计，跨回合回灌给教学决策 |

**（2）prompt 规则内嵌的教学法机制**

| 机制 | prompt 中的表述 | 对应输出字段 |
|---|---|---|
| Meno 闸（美诺悖论） | 提问前提审计：学生不具备提问所需前提时不允许纯追问 | analysis / 回合控制 |
| 苏格拉底提问阶梯 | 事实→关系→迁移三级 | analysis / pedagogy |
| 引导发现 guided discovery | 不代答、以问题引导 | pedagogy.strategies |
| 追问递进 / 线索式反问 | 逐级提升认知要求 | analysis / reply |
| 诊断追问 ≤2 轮探索预算 | 限制接管前等待学生作答的回合数 | 回合控制 |
| 先猜后揭 POE | 预测—揭晓—解释三段 | pedagogy.strategies / reply |
| Productive Failure 有效失败 | 生成期 / 整合期两阶段 | pedagogy.strategies / 回合控制 |
| 费曼技巧 / 以教代学 | protégé effect，让学生讲出来 | pedagogy.strategies |
| 愤悱带 0.6-0.8 | 可解率口径，功能近似 ZPD | knowledge / 出题决策 |
| 脚手架三件套 | 具象场景 + 判断口径 + 低门槛作答 | reply / analysis |
| 掌握学习证据口径 | 行动证明优先、口头宣称不算、答对=无提示 | control / knowledge |
| 布鲁姆认知层级 | remember→create 六层 | pedagogy / analysis |
| checkpoint 检查点 | 答案键 / 代码裁决 | control |
| 独立锚题探针 anchorProbe | 未训练过的锚题验证掌握 | control |
| exit 类收束 | 课末形成性检查 | control |
| 纠错反馈 | 错误定位+修正路径 | reply |
| 迷思概念预判 | `canonicalLabel` / `planned` 预置标准标签 | analysis |
| 微讲授 / 直觉破题 | 短平直讲解切入 | reply |
| 图文互锁 | 图文内容互补、防复读 | reply |
| 检索练习 / 课内温故 | 提取式复习 | pedagogy / control |
| 异构新情境微型挑战 | 新情境小题验证迁移 | pedagogy / control |
| 不预告方法的交错式回捞 | 不标注题型、混排回访旧知识点 | pedagogy |

---

### 对应学术构念

**1. 整体效度基线：这套字段体系站在 ITS 元分析的"已验证区间"内。** WenFlow teaching 的五层输出结构（学生回复/诊断/策略/评价装置/掌握估计）并非悬空设计：VanLehn [1] 对受控比较研究的再分析发现，step-based 智能导学系统（ITS）的效应量 d=0.76，几乎追平人类一对一辅导的 d=0.79；Ma 等 [2] 对 107 项研究、14,321 名学习者的元分析给出 ITS 总体 g=0.41，显著优于教师大班授课（g=0.42）、非 ITS 计算机教学（g=0.57）和课本/练习册（g=0.35），而与个体化人类辅导无显著差异。Corbett–Anderson 系认知导师 [3][4] 提供了"怎么做"的机制模板：领域模型 + 每次成功应用规则后更新掌握概率、达到约 95% 掌握概率才允许晋级。WenFlow 把"学生模型（knowledge.ktEstimate）—教学策略（pedagogy.strategies）—反馈装置（reply/control）—掌握判定（checkpoint 口径）"拆成显式输出 schema，等价于把认知导师的运行时架构转写为 LLM 的回合制输出协议——落点恰在文献中效度最高的"step-based 对话教学"象限。

**2. 愤悱带 0.6-0.8 对 85% 规则与 ZPD：方向一致、口径不同、数值偏保守。** "愤悱带 0.6-0.8（可解率）"是 prompt 中最明确的量化参数，可对照两类文献。其一是 Wilson 等 [19] 的 85% 规则：对误差/梯度驱动类学习者，训练时最优错误率约 15.85%（即约 84% 的训练正确率）是学习速度最快点；对弱学习者，最优点向更低正确率方向移动。项目上限 0.8 略低于理论最优 0.84，下限 0.6 落在弱学习者方向，整个 0.6-0.8 带恰好处于该论文给出的可学区间之内——但必须指出：85% 规则刻画的是**学习器的训练误差率**，而 0.6-0.8 刻画的是**学生可解题目的比例**，二者是类比映射而非同构（需要假设"训练正确率≈可解率"且学生的学习动力学近似梯度型）。其二是 ZPD/脚手架传统：Wood、Bruner 与 Ross [5] 将脚手架定义为"导师控制超出学习者能力的任务部分，使其能完成能力范围内的部分，并随能力增长撤除支持"；van de Pol 等 [6] 的十年综述把脚手架操作化为"应变性支持（contingency）+ 渐隐（fading）"，并指出 ZPD 本身是定性构念，实证文献没有给出统一的量化分位。因此 0.6-0.8 应视为对 ZPD 的**可解率式工程近似**：有两条独立文献线支持"难度带"的存在，但 0.6 与 0.8 这两个具体端点没有直接文献出处。另注意"愤悱"（《论语·述而》"不愤不启，不悱不发"）强调的求助动机状态在两个西方构念中均无对应变量，属于项目自有补充。

**3. Meno 闸与提问理论：把"无前提纯追问"制度化地判负。** Meno 闸以美诺悖论命名——Plato《Meno》80d-e 中 Meno 质问"人如何探求他所不知道的东西？"，Socrates 复述为"人不能探求他所知道的，也不能探求他所不知道的"（抓取正文见文献表下方 Meno 出处说明），随后以对奴隶男孩的几何引导问答（82a-86c）示范：先铺前提（正方形、对角线），再逐步引导至目标结论。其行为学对应有两条。第一，Graesser 与 Person [8] 的对话分析发现真实学生在课堂、辅导与 AutoTutor 会话中极少提问，且自然辅导遵循五步对话框架（导师提问→学生尝试→简短评价→协作改进→检查理解）；AutoTutor [9] 据此以"期望（expectations）—迷思（misconceptions）"双目录驱动导师主动发起对话。第二，Alfieri 等 [7] 的元分析给出关键分野：无人协助的发现式教学显著劣于显式教学（d=-0.38），而"增强的（guided）发现式"显著优于其他教学（d=0.30）。Meno 闸正是这一分野的工程实现：**前提缺失时的纯追问 ≈ unassisted discovery（文献判负）；前提具备后的阶梯式提问（事实→关系→迁移）≈ guided discovery（文献判正）**。苏格拉底在《Meno》中的实践本身就是"先审计前提、再引导"的原型——Meno 闸引用的与其说是悖论，不如说是该篇对话的教学法结构。

**4. 掌握证据口径与掌握学习/形成性评价：两支文献同构，反馈一支解释"为什么口头宣称不算"。** "行动证明优先、口头宣称不算、答对=无提示"的三层口径与两支文献同构。掌握学习一支：Bloom [16] 的 Learning for Mastery 提出以掌握标准而非正态分布组织教学，其 1984 年"2σ 问题"[17] 指出一对一辅导可使学生成绩比大班高约两个标准差；Kulik 等 [18] 的元分析确认掌握学习项目显著提升考试成绩且对低成就学生增益最大。认知导师一支：Anderson 等 [3] 与 Corbett & Anderson [4] 用规则级掌握概率（≥95%）决定晋级，并**以解题行为而非学生自陈更新估计**——与"口头宣称不算"直接对应。反馈一支提供了机理：Hattie 与 Timperley [10] 的四层反馈模型（任务/过程/自我调节/自我）中，针对"自我"的表扬性反馈信息量最小、最无效，任务与过程层反馈最有效；Shute [11] 综述指出验证正确性、解释正确答案、提示（hints）等要素及其时机交互决定形成性反馈效果。据此：checkpoint 的答案键/代码裁决对应任务层客观验证；"答对=无提示"把提示消耗量作为掌握的反指标，与 Shute 框架中 hints 的诊断用法一致；`anchorProbe` 独立锚题相当于把掌握判定从训练题泛化到未训练题，是"行动证明优先"的最强实现；exit 类收束对应形成性评价"每课终点采样"的惯例。

**5. POE / Productive Failure / 以教代学：三个"反直觉顺序"机制各有独立证据线。** 先猜后揭 POE 逐段对应 White 与 Gunstone [12] 的 Predict-Observe-Explain 三步技术（要求给出理由的预测→观察→对照预测给出解释），其设计目的正是"揭示学生的预测及其理由"以暴露前概念——项目的"先猜后揭"在回合顺序上与其完全同构。Productive Failure 对应 Kapur [13] 及 Kapur 与 Bielaczyc [14] 的设计理论：生成期（学生先解复杂、结构不良的问题，激活并分化先备知识，允许并利用失败）与整合期（结构化讲解、知识组装）直接映射 prompt 的"生成期/整合期"机制；其证据基础是 PS-I（先解题后讲授）设计中"短期表现差、长期学习好"的权衡。费曼技巧/以教代学对应 Chase 等 [15] 的 protégé effect：在 Betty's Brain 可教学智能体环境中，"为教 agent 而学"的学生比为自己学投入更大努力——但需注意其效应载体是**可推理的真实被教者（teachable agent）**，LLM 对话中"教"的对象缺失，属类比迁移。

**6. 检索练习/交错/迷思预判/追问预算：其余机制各有对应构念。** 检索练习与交错练习支撑"课内温故、异构新情境微型挑战、不预告方法的交错式回捞"：Roediger 与 Karpicke [23] 证明提取记忆（testing）比重读更能促进延迟保持（一周后 61% vs 40%）；Rohrer 与 Taylor [24] 证明混排（interleaved）题型练习的表现"大幅优于"分块练习，机制正是"学生会公式但不知道何时用哪种"——这与"不预告方法"（不先告诉题型再练）的设计逻辑一致。迷思概念预判（`canonicalLabel`/`planned`）对应概念改变研究：Chi 等 [22] 区分信念修正与心理模型转变，指出系统性迷思是**连贯但错误的模型**（能自洽地产生一致的错误解释与预测），需要针对性暴露而非一般性纠错。诊断追问 ≤2 轮探索预算与 Rowe [21] 的 wait-time 研究同源不同形：Rowe 发现教师提问后停留不足 1 秒会截断学生思考，延长到 3 秒以上显著提升回答长度与逻辑质量；LLM 对话中没有真实的"沉默"，预算约束转译为"不连续接管"的回合上限，其机制（防止学生浅答被截断 vs 防止 tutor 过早接管）是否保留待验证。

---

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段/机制 | 关联与评注 |
|---|---|---|---|---|
| [1] | VanLehn, K. (2011). The Relative Effectiveness of Human Tutoring, Intelligent Tutoring Systems, and Other Tutoring Systems. *Educational Psychologist*, 46(4), 197–221. | https://educationgroup.mit.edu/HHMIEducationGroup/wp-content/uploads/2011/02/VanLehnPresentationSlides.pdf （佐证：https://pmc.ncbi.nlm.nih.gov/articles/PMC8095475 ） | 整套 teaching 字段体系 | 人类辅导 d=0.79 ≈ ITS d=0.76；WenFlow 的字段化教学落在 step-based ITS 效度区间 |
| [2] | Ma, W., Adesope, O. O., Nesbit, J. C., & Liu, Q. (2014). Intelligent Tutoring Systems and Learning Outcomes: A Meta-Analysis. *Journal of Educational Psychology*, 106(4), 901–918. | https://eric.ed.gov?id=EJ1049508 | 整套字段体系 | 107 项研究、14,321 人；总体 g=0.41；优于教师授课（0.42）与非 ITS 计算机教学（0.57），与个体辅导无显著差异 |
| [3] | Anderson, J. R., Corbett, A. T., Koedinger, K. R., & Pelletier, R. (1995). Cognitive Tutors: Lessons Learned. *Journal of the Learning Sciences*, 4(2), 167–207. | https://en.wikipedia.org/wiki/Intelligent_tutoring_system （页面引用著录） | 掌握证据口径、ktEstimate、checkpoint | 认知导师经验总结；以解题行为更新规则级掌握概率，达到≥95% 才晋级 |
| [4] | Corbett, A. T., & Anderson, J. R. (2008). Student Modeling and Mastery Learning in a Computer-Based Programming Tutor. | https://en.wikipedia.org/wiki/Intelligent_tutoring_system （页面引用著录） | knowledge.ktEstimate、掌握口径 | 程序设计导师中的学生建模与掌握学习；知识追踪（knowledge tracing）按规则追踪强弱项 |
| [5] | Wood, D., Bruner, J. S., & Ross, G. (1976). The Role of Tutoring in Problem Solving. *Journal of Child Psychology and Psychiatry*, 17(2), 89–100. | https://pubmed.ncbi.nlm.nih.gov/932126 | 脚手架三件套、pedagogy.strategies | "scaffolding"概念源头：控制超出能力部分、随能力增长撤除 |
| [6] | van de Pol, J., Volman, M., & Beishuizen, J. (2010). Scaffolding in Teacher–Student Interaction: A Decade of Research. *Educational Psychology Review*, 22, 271–296. | https://link.springer.com/article/10.1007/s10648-010-9127-6 | 脚手架三件套、诊断追问 | 综述确认脚手架有效；操作化为应变性支持+渐隐；指出 ZPD 为定性构念、无统一量化分位 |
| [7] | Alfieri, L., Brooks, P. J., Aldrich, N. J., & Tenenbaum, H. R. (2011). Does Discovery-Based Instruction Enhance Learning? *Journal of Educational Psychology*, 103(1), 1–18. | https://teach.peabody.kids/library/studies/alfieri-2011 | Meno 闸、苏格拉底阶梯、guided discovery | 元分析：unassisted discovery d=−0.38（劣于显式教学），enhanced/guided discovery d=0.30（优于其他教学） |
| [8] | Graesser, A. C., & Person, N. K. (1994). 提问研究（五步对话框架出处；题名待核，通行著录为 "Question asking during tutoring", *American Educational Research Journal*, 31(1)）. | https://reed.cs.depaul.edu/peterh/papers/Graesserjcsr1999.pdf （另见 https://talkbank.org/class/access/0docs/person1995.pdf ） | Meno 闸、追问递进 | 学生极少提问；自然辅导遵循五步对话框架（提问→尝试→评价→协作改进→检查理解） |
| [9] | Olney, A.（年份待核）. AutoTutor: An Intelligent Tutoring System with Mixed-Initiative Dialogue（章节）. | https://bpb-us-w2.wpmucdn.com/blogs.memphis.edu/dist/d/2954/files/2019/10/AutoTutor-chapter-olney_publications.pdf （另见 https://ceur-ws.org/Vol-2128/industrial1.pdf ） | analysis.confusionPoints、迷思预判 | 以"期望—迷思"双目录生成对话 move；学生输入对照期望与迷思目录定位 |
| [10] | Hattie, J., & Timperley, H. (2007). The Power of Feedback. *Review of Educational Research*, 77(1), 81–112. doi:10.3102/003465430298487 | https://exprea.io/blog/hattie-timperley-2007-the-power-of-feedback | reply 纠错反馈、checkpoint | 四层反馈（任务/过程/自我调节/自我）；feed up–feed back–feed forward；"自我"层信息量最小 |
| [11] | Shute, V. J. (2008). Focus on Formative Feedback. *Review of Educational Research*, 78(1), 153–189. doi:10.3102/0034654307313795 | https://eric.ed.gov?id=EJ787077 | 纠错反馈、"答对=无提示"、反馈时机 | 验证正确性、解释正确答案、提示（hints）等要素及时机交互决定形成性反馈效果 |
| [12] | White, R. T., & Gunstone, R. F. (1992). *Probing Understanding*. Great Britain: Falmer Press. | https://arbs.nzcer.org.nz/predict-observe-explain-poe | 先猜后揭 POE | POE 技术出处：带理由的预测→观察→对照解释，目的为揭示学生预测与前概念 |
| [13] | Kapur, M. (2008). Productive Failure. *Cognition and Instruction*, 26(3), 379–424. | https://boldscience.org/wp-content/uploads/2025/04/Productive-Failure.pdf （页面引用著录） | Productive Failure 生成期 | 短期失败、长期学习更好；先解复杂问题激活先备知识 |
| [14] | Kapur, M., & Bielaczyc, K. (2012). Designing for Productive Failure（生成期/整合期设计理论）. | https://www.isls.org/icls/2012/downloads/K2Kapur.pdf | 生成期/整合期两阶段 | 显式区分 Generation Phase（复杂问题、协作、探索）与 Consolidation Phase（结构化讲解、知识组装） |
| [15] | Chase, C. C., Chin, D. B., Oppezzo, M. A., & Schwartz, D. L. (2009). Teachable Agents and the Protégé Effect: Increasing the Effort Towards Learning. *Journal of Science Education and Technology*, 18(4). doi:10.1007/s10956-009-9180-4 | https://eric.ed.gov?id=EJ855299 （另 https://link.springer.com/article/10.1007/s10956-009-9180-4 ） | 费曼技巧/以教代学 | Betty's Brain：为教可推理智能体而学，努力投入大于为自己学；protégé effect 一词的实验出处 |
| [16] | Bloom, B. S. (1968). Learning for Mastery. *Evaluation Comment*, 1(2). UCLA Center for the Study of Evaluation of Instructional Programs. | https://journals.sagepub.com/doi/pdf/10.3102/00346543060002265?download=true （该文献表列出 Evaluation Comment 1968 条目） | 掌握学习证据口径、checkpoint | 掌握标准取代正态分布；"掌握再晋级"是 checkpoint 口径的思想源头 |
| [17] | Bloom, B. S. (1984). The 2 Sigma Problem: The Search for Methods of Group Instruction as Effective as One-to-One Tutoring. *Educational Researcher*, 13(6). | https://wiz.kids/learn/science-of-learning/mastery-learning （页面引用著录） | 整套一对一教学机制 | 一对一辅导 ≈ 2 个标准差优势；ITS 元分析（[1][2]）即对该问题的回应 |
| [18] | Kulik, C.-L. C., Kulik, J. A., & Bangert-Drowns, R. L. (1990). Effectiveness of Mastery Learning Programs: A Meta-Analysis. *Review of Educational Research*, 60(2), 265–299. | https://researchconnect.suny.edu/en/publications/effectiveness-of-mastery-learning-programs-a-meta-analysis | 掌握证据口径 | 掌握学习项目显著提升考试成绩，对低成就学生增益最大 |
| [19] | Wilson, R. C., Shenhav, A., Straccia, M., & Cohen, J. D. (2019). The Eighty Five Percent Rule for Optimal Learning. *Nature Communications*, 10, 4646. doi:10.1038/s41467-019-12552-4 | https://pmc.ncbi.nlm.nih.gov/articles/PMC6831579 | 愤悱带 0.6-0.8 | 训练正确率约 84% 时学习最快；注意第四作者为 Cohen 而非 O'Doherty（常见误引） |
| [20] | Anderson, L. W., & Krathwohl, D. R. (Eds.) (2001). *A Taxonomy for Learning, Teaching, and Assessing: A Revision of Bloom's Taxonomy of Educational Objectives*. New York: Longman. | https://en.wikipedia.org/wiki/Bloom%27s_taxonomy （页面引用著录） | 布鲁姆六层 remember→create | 修订版：层次更名、顶部两层换序，Create 置于最高层 |
| [21] | Rowe, M. B. (1986). Wait Time: Slowing Down May Be a Way of Speeding Up! *Journal of Teacher Education*, 37(1), 43–50.（源头为 1972/1974 研究） | https://www.structural-learning.com/post/wait-time-a-teachers-guide （另见 https://link.springer.com/rwe/10.1007/978-3-030-15789-0_100030 ） | 诊断追问 ≤2 轮探索预算 | 教师平均等待 <1 秒；≥3 秒显著提升回答长度与逻辑；wait-time 1/2 区分 |
| [22] | Chi, M. T. H., Slotta, J. D., & de Leeuw, N. (1994). 概念改变理论（题名待核，通行著录为 "From Things to Processes: A Theory of Conceptual Change for Learning Science Concepts", *Cognition and Instruction*）.（另见 Chi 概念改变章节：Three Types of Conceptual Change） | https://education.asu.edu/sites/g/files/litvpz656/files/lcl/chi_concpetualchangechapter_0.pdf （另见 https://3starlearningexperiences.wordpress.com/2019/06/04/tackling-misconceptions-through-conceptual-change-part-i ） | 迷思概念预判 canonicalLabel/planned | 系统性迷思是连贯但错误的心理模型，产生一致的错误解释与预测；需针对性暴露 |
| [23] | Roediger, H. L., III, & Karpicke, J. D. (2006). The Power of Testing Memory: Basic Research and Implications for Educational Practice. *Perspectives on Psychological Science*, 1(3), 181–210. | https://link.springer.com/article/10.3758/s13421-023-01477-5 （其参考文献列出该条目；另见 https://www.sciencedirect.com/topics/psychology/testing-effect ） | 检索练习/课内温故、交错回捞 | testing effect：提取比重读更能促进延迟保持（一周后 61% vs 40%） |
| [24] | Rohrer, D., & Taylor, K. (2007). The Shuffling of Mathematics Problems Improves Learning. *Instructional Science*, 35(6), 481–498. doi:10.1007/s11251-007-9015-8 | https://en.wikipedia.org/wiki/Spacing_effect （页面引用著录） | 异构新情境微型挑战、不预告方法的交错式回捞 | 混排题型练习表现"大幅优于"分块；机制为学会判断"何时用哪种方法" |
| [25] | Item response theory（IRT；构念参考条目，θ=能力、b=难度，logit=a(θ−b)） | https://en.wikipedia.org/wiki/Item_response_theory | knowledge.ktEstimate 的 θ−d 记号 | IRT 中正确率由 θ−b 决定（θ=b 时 1:1 命中率）；项目 θ−d 记号与 IRT 的 θ−b 同形 |

**Meno 悖论出处说明**：Plato《Meno》80d-e（悖论）与 82a-86c（奴隶男孩几何问答）。抓取正文见 Wikipedia《Meno》条目（含 Jowett 译本 "a man cannot enquire either about that which he knows, or about that which he does not know"，Stephanus 页码 80d-e）：
https://en.wikipedia.org/wiki/Meno 。项目 Meno 闸的用法（提问前提审计）是该对话教学法结构的功能性引用。

---

### 项目设计与文献的对照

**一致点**

1. **字段体系 vs ITS 已验证架构**：reply/analysis/pedagogy/control/knowledge 五层对应认知导师的"反馈—对话诊断—策略—评价—学生模型"，VanLehn 与 Ma 等元分析确认该架构整体有效（d≈0.76 / g≈0.41）[1][2]。
2. **愤悱带与文献难度带方向一致**：0.6-0.8 落在 85% 规则给出的可学区间（弱学习者端 50% 至最优 84%）内，也与 ZPD"略高于当前能力"的定性描述相容 [5][6][19]。
3. **Meno 闸与 guided discovery 元分析同向**：禁止无前提纯追问 ≈ 避免 unassisted discovery（d=−0.38），保留阶梯式提问 ≈ guided discovery（d=0.30）[7]。
4. **三个"顺序反转"机制逐字对应文献**：先猜后揭与 POE 三段一致 [12]；生成期/整合期与 Kapur 设计理论一致 [13][14]；以教代学与 protégé effect 一致 [15]。
5. **掌握证据口径与掌握学习/认知导师同构**：行动证明优先 ↔ 以解题行为更新掌握概率；checkpoint 口径 ↔ Bloom LfM 与认知导师 95% 阈值；"自我层反馈最无效"为"口头宣称不算"提供机理 [3][4][10][16][17][18]。
6. **复习类机制有强实证**：检索练习与交错练习均系教育心理学中效应最稳的发现之一，"不预告方法"与 interleaving 的机制解释（学会选择方法）吻合 [23][24]。
7. **布鲁姆六层与修订版一致**：remember→create 次序即 Anderson & Krathwohl 2001 的修订结果 [20]。

**张力点**

1. **数值口径不可直接等同**：85% 规则刻画学习器的训练误差率，0.6-0.8 刻画学生可解率；ZPD 无统一量化分位。0.8 略低于理论最优 0.84，0.6 的下限无直接文献端点——愤悱带是有理据的工程折中，不是文献直接结论 [19][5][6]。
2. **8 策略枚举是离散封闭集**：文献中的教学法多为连续/条件化维度（反馈层次、脚手架应变度、渐隐节奏），枚举策略可能丢失"条件化"信息；且未见与任何已发表教学模型分类学的显式对齐（对照风险，出处待核）。
3. **θ−d 记号的伪 IRT 风险**：IRT 中 logit=a(θ−b)、θ=b 时 1:1 命中率，θ 与 b 需在同一标尺上经校准 [25]；若 ktEstimate 的 θ 与 d 未经 IRT 校准（题目参数未标定），θ−d 只是记号借用，且 d 与文献中效应量 d（[1][7]）符号冲突。
4. **POE 的"观察"环节被重定义**：White & Gunstone 的观察依赖真实演示的意外感 [12]；LLM 回合制中"观察"=系统揭晓，预测承诺与惊讶机制是否保留存疑。
5. **Productive Failure 的媒体迁移**：PF/PS-I 证据主要来自数学多解情境的小组课堂 [13][14]；对话式生成期（单学生、回合预算内）是否产生同等"知识激活与分化"效应未经对话媒体验证。
6. **wait-time 机制形式替代**：Rowe 的实证机制是物理沉默保护思考时间 [21]；LLM 中 ≤2 轮预算是形式替代物，学生"浅答被截断"的风险反而可能由模型快速接管引入。

**风险点**

1. **掌握判据的行为化 vs 概率化**：项目"答对=无提示"是行为判据，认知导师用概率口径（≥95%）且以大量题目响应支撑估计 [3][4]；锚题暴露不足时 ktEstimate 可能高估掌握，出现伪精度。
2. **迷思静态预判 vs 动态模型**：Chi 等强调迷思是连贯心理模型、因人而异 [22]；`planned`（预置 canonical 标签）若按预判执行而不做现场证伪，可能错配学生的实际模型。
3. **protégé effect 的对象缺失**：Chase 等的效应依赖可推理的真实被教者（teachable agent）[15]；LLM 对话中"以教代学"没有真实学习对象，动机机制能否迁移未知。
4. **引用链风险**：85% 规则第四作者常被误引为 O'Doherty，实为 Jonathan D. Cohen [19]；Graesser & Person 1994 与 Chi et al. 1994 的题名在本轮抓取正文中未直接出现（已标"题名待核"），项目文档引用时应以原始刊源复核。
5. **规则内嵌的可执行性**：checkpoint 答案键/代码裁决、图文互锁等机制以自然语言规则内嵌于 prompt，其效果依赖评测脚本与图理解链路的稳定性；Shute 综述提醒反馈效果与时机、长度、学习者特征强交互 [11]，固定化规则在不同情境可能失效。

---

*本章节检索记录：Tavily 搜索 12 次（VanLehn 2011；Wilson 2019 85% 规则；Wood/Bruner/Ross 1976；Alfieri 2011；Hattie & Timperley 2007；Kapur productive failure；Chase 2009 protégé；Graesser AutoTutor；White & Gunstone POE；Rowe wait-time；Bloom/Kulik mastery learning；Ma 2014 ITS 元分析；另加概念改变与检索练习/交错共 12 条查询）+ WebFetch 抓取 6 次（Wikipedia ITS / Bloom taxonomy / Meno / Spacing effect / Item response theory；uark 与 Iowa State 修订版布鲁姆页面）。*
