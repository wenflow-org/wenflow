# 学术调研（一）：学习者模型/画像字段 与 行为遥测/交互特征字段

> 调研对象：WenFlow 平台 skill prompt 字段底表（commit e736f7aa，2026-11-19 调查版）。
> 检索方法：Tavily 联网检索 9 次（学生建模/ITS、开放学习者模型、学习风格迷思、SRL 与校准、生成式 agent、人格与对话式 AI、动机理论、按键与日志遥测、情感检测与预警），并对候选原始出处页（arXiv、Springer、PMC、CMU DataShop 等）做 WebFetch 逐一核实作者与出处。
> 引用纪律：每篇被引文献均出现在上述检索结果或抓取正文中并附 URL；无法完全核实处以「（出处待核）」显式标注，未做任何编造。

---

## 章节一：学习者模型与画像字段

### 覆盖字段

| 字段 | 含义（按项目底表） |
| --- | --- |
| learner.profile | 长期画像投影，含 narrativeInsights.practicePreferenceNote（练习/交付形式偏好） |
| learner.dynamicState | 学习者动态状态（与长期画像相对的近期状态层） |
| learner.knowledgeMemory | 知识记忆/知识状态，含 transferSignals（迁移就绪度信号） |
| learnerPersona | 虚拟学习者 persona（6 子字段） |
| domainFamiliarity | 领域熟悉度 |
| personalityTraits | 人格特质向量：verbosity 冗长度 / enthusiasm 热情 / confusionStyle 困惑风格 / patience 耐心 / questionStyle 提问风格 / emotionalRange 情绪幅度（用于虚拟学习者 persona） |
| metacognitiveProfile | 元认知特征 |
| resiliencePattern | 心理韧性模式 |
| selfAssessmentAccuracy | 自评校准（高估/低估倾向） |
| selfReportedTaskDone | 自报完成度（结课权威在教师侧，自报不作为真相） |
| motivationType | 动机类型：career / interest / necessity / social |
| VARK 式学习风格 | reading / watching / doing / listening 偏好 |
| learningControlState | 学习控制状态 |
| replanSignal | 重规划信号 |

### 对应学术构念

**学习者建模与知识追踪。** 把「学习者知识状态」形式化为系统内可推理、可更新的模型，是智能辅导系统（ITS）四十余年传统的核心 [1][2]。Corbett & Anderson 的知识追踪（Knowledge Tracing, KT）用隐马尔可夫模型从答题序列推断知识成分掌握概率 [2]，Piech 等人将其推广为基于循环神经网络的深度知识追踪 [3]。WenFlow 的 learner.knowledgeMemory 及其 transferSignals 延续这一传统，但把建模对象从「答题正确率」扩展到「对话中的知识表现与迁移就绪度」——后者在经典 KT 中并不直接建模，属于项目对 ITS 建模传统的扩展。值得注意的是，ITS 文献长期区分「学生模型（student model，系统对学习者知识的内部信念）」与「学习者模型（learner model，含偏好、目标、情绪等更广属性）」[1][4]，WenFlow 将 learner.knowledgeMemory 与 learner.profile 分置，恰好对应了这一区分。

**开放学习者模型（OLM）与画像的透明性。** Bull 与 Kay 的 SMILI:) 框架系统化了「把学生模型开放给学习者本人查看、检视甚至协商」的设计空间：模型内容可包括知识、误解、偏好、目标等多种属性，接口可从只读视图到可协商模型连续变化 [4]。OLM 传统的两个立场与本项目直接相关：其一，模型是系统的「信念」而非真相，天然可错；其二，开放画像能促进元认知与自我调节。WenFlow 把「自报完成度」降权、将结课权威放在教师侧，与 OLM「模型信念≠真相」的立场一致；但 WenFlow 的画像主要服务于教学侧决策，尚未利用 OLM 文献强调的「向学习者开放以促进元认知」的价值路径。

**人格、persona 与生成式 agent。** 对话式 AI 中「人格」研究通常以 Big Five（OCEAN）为标准框架，并区分 personality（稳定特质）、persona（角色设定）与 profile（档案）三层概念 [13]。Park 等人的生成式 agent 证明了给 LLM 注入人格档案与记忆后，可以产生可信的社会化行为模拟（观察—规划—反思架构，消融实验证明各成分对行为可信度贡献关键）[12]，这为 WenFlow 用 personalityTraits（verbosity/enthusiasm/confusionStyle/patience/questionStyle/emotionalRange）驱动虚拟学习者 persona 提供了可行性证据。但项目向量并非 Big Five，而是更贴近会话行为学的「表面风格参数」；文献表明这类 persona 参数可以被注入甚至通过训练塑造 [14]，同时也有实证研究警告 LLM 的自评人格并不可靠——模型自称比人类更宜人、更尽责，且同一模型重复测量结果不稳定 [15]（第一手文献出处待核，经 Nautilus 报道）。这意味着虚拟学习者的「人格」是叙事设定而非心理测量对象。

**元认知、自评校准与动机。** Zimmerman 的自我调节学习（SRL）循环模型（forethought—performance—self-reflection）把自我监控、自我评价与校准置于学习过程的核心 [7]；Panadero 的综述确认该模型是 SRL 研究的主流框架之一，并指出校准（calibration，自评与实际表现的偏差）是其中的关键测量点 [8]。WenFlow 的 metacognitiveProfile 与 selfAssessmentAccuracy（高估/低估倾向）对应 SRL 的自我反思阶段与元认知监测文献；文献一致发现学习者普遍存在自评高估倾向，这正是「自报完成不作为真相」的经验基础。动机方面，自我决定理论（SDT）区分内在动机与沿「外部调节—内摄—认同—整合」连续谱分布的外在动机，并强调胜任、自主、归属三种基本心理需要 [9][10]；期待-价值理论则强调成就行为由期待成功与任务价值共同决定 [11]。WenFlow 的 motivationType 四分类（career/interest/necessity/social）可与该理论谱系粗略映射（interest≈内在动机；career/necessity≈工具性外在动机；social≈归属需要），但四分类是项目自建的离散类型，未覆盖 SDT 的连续性与混合动机。

**必须单列的争议：学习风格。** WenFlow 采用 VARK 式字段（reading/watching/doing/listening）。VARK 是 Fleming 提出的视觉/听觉/读写/动觉四分偏好模型 [5]。然而，Pashler 等人对学习风格的系统审查得出结论：不存在足够证据支持「按学习风格匹配（meshing）教学方式能提升学习效果」，学习风格量表用于教育实践缺乏效度基础 [5]；Newton & Miah 进一步指出该「neuromyth」在高等教育中仍广泛流行且可能误导教学设计 [6]。将 VARK 字段写入教学 prompt 时，若下游策略据此「按风格匹配内容形式」，即在直接复现被系统证伪的假设（详见本节「对照」）。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
| --- | --- | --- | --- | --- |
| [1] | Pavlik 等, 2013, A Review of Student Models Used in Intelligent Tutoring Systems（作者全名待核，PDF 题名与正文见于检索） | https://bpb-us-w2.wpmucdn.com/blogs.memphis.edu/dist/d/2954/files/2019/10/pavlik_studentmodels_2013.pdf | learner.knowledgeMemory、learner.profile | ITS 学生模型综述；明确区分 model tracing（解释当前行为）与 knowledge tracing（推断知识增长序列），为「知识记忆 vs 画像」分层提供概念框架 |
| [2] | Corbett, A.T. & Anderson, J.R., 1995, Knowledge tracing: Modeling the acquisition of procedural knowledge, UMUAI 4(4)（卷页/DOI 待核） | https://bpb-us-w2.wpmucdn.com/blogs.memphis.edu/dist/d/2954/files/2019/10/pavlik_studentmodels_2013.pdf（出处经 [1] 正文引用核实） | learner.knowledgeMemory | BKT 经典；从练习表现序列推断知识掌握，是「从交互推断知识」范式的奠基 |
| [3] | Piech, C., Spencer, J., Huang, J., Ganguli, S., Sahami, M., Guibas, L., Sohl-Dickstein, J., 2015, Deep Knowledge Tracing（arXiv 预印本；NIPS 2015 出处待核） | https://arxiv.org/abs/1506.05908 | learner.knowledgeMemory | 用 RNN 对整个交互历史建模知识状态；提示「对话全文也是序列证据」，但深度 KT 依赖大规模交互数据，WenFlow 语境下只能做轻量近似 |
| [4] | Bull, S. & Kay, J., 2007, Student Models that Invite the Learner In: The SMILI:) Open Learner Modelling Framework, IJAIED 17(2): 89–120 | https://edutechwiki.unige.ch/en/Open_learner_model | learner.profile、learnerPersona、selfReportedTaskDone | OLM 框架经典；模型属性可含知识/偏好/目标等，接口可协商。支持「模型=系统信念而非真相」立场；也提示画像可向学习者开放以促进元认知（项目未采用该路径） |
| [5] | Pashler, H., McDaniel, M., Rohrer, D., Bjork, R.A., 2008, Learning Styles: Concepts and Evidence, Psychological Science in the Public Interest 9(3): 105–119 | https://en.wikipedia.org/wiki/Learning_styles（出处条目经维基百科参考文献列表核实） | VARK 式学习风格 | 学习风格系统审查权威文献：无充分证据支持 meshing 假设、无充分效度基础支持将风格量表用于教育实践。对项目 VARK 字段构成直接反证（见对照·风险点） |
| [6] | Newton, P.M. & Miah, M., 2017, Evidence-Based Higher Education – Is the Learning Styles 'Myth' Important?, Frontiers in Psychology 8:444 | https://pmc.ncbi.nlm.nih.gov/articles/PMC5366351/ | VARK 式学习风格 | 记录学习风格迷思在教育界的流行度并论证其危害（误导资源配置与教学设计）；为项目「改称偏好、避免风格匹配」提供建议依据 |
| [7] | Zimmerman, B.J., 2002, Becoming a Self-Regulated Learner: An Overview, Theory Into Practice（卷期待核） | https://www.leiderschapsdomeinen.nl/wp-content/uploads/2016/12/Zimmerman-B.-2002-Becoming-Self-Regulated-Learner.pdf | metacognitiveProfile、learningControlState、replanSignal | SRL 概览经典；自我观察—自我判断—自我反应循环，对应项目的元认知特征与学习控制/重规划状态 |
| [8] | Panadero, E., 2017, A Review of Self-regulated Learning: Six Models and Four Directions for Research, Frontiers in Psychology 8:422 | https://pmc.ncbi.nlm.nih.gov/articles/PMC5408091/ | metacognitiveProfile、selfAssessmentAccuracy、learningControlState | SRL 六模型综述，专节分析 Zimmerman 循环相位模型（forethought/performance/self-reflection），并把校准列为 SRL 关键测量；为「自评校准」字段提供构念定位 |
| [9] | Ryan, R.M. & Deci, E.L., 2000, Intrinsic and Extrinsic Motivations: Classic Definitions and New Directions, Contemporary Educational Psychology 25(1)（卷页待核） | https://www.selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_IntExtDefs.pdf | motivationType | SDT 经典定义：内在动机 vs 外在动机及内化连续谱；为 motivationType 的 interest/career/necessity 维度提供理论映射 |
| [10] | Ryan, R.M. & Deci, E.L., 2020, Intrinsic and extrinsic motivation from a self-determination theory perspective: Definitions, theory, practices, and future directions, Contemporary Educational Psychology | https://www.sciencedirect.com/science/article/pii/S0361476X20300254 | motivationType | SDT 二十年回顾：基本心理需要（胜任/自主/归属）与动机内化；social 类型可映射到归属（relatedness）需要，但 SDT 中动机是连续谱而非离散类型 |
| [11] | Eccles, J.S. & Wigfield, A., 2002, Motivational beliefs, values, and goals, Annual Review of Psychology 53: 109–132 | https://en.wikipedia.org/wiki/Expectancy-value_theory（出处经维基百科参考文献列表核实） | motivationType、domainFamiliarity | 期待-价值理论综述：成就行为由成功期待×任务价值驱动；提示 motivationType 与 domainFamiliarity 应联合影响任务推荐难度与 framing |
| [12] | Park, J.S., O'Brien, J.C., Cai, C.J., Morris, M.R., Liang, P., Bernstein, M.S., 2023, Generative Agents: Interactive Simulacra of Human Behavior, UIST '23 | https://arxiv.org/abs/2304.03442 | learnerPersona、personalityTraits | 生成式 agent 奠基作：人格档案+记忆+观察/规划/反思产生可信行为；为「LLM 驱动虚拟学习者 persona」的可行性提供直接证据，消融实验表明成分缺一不可 |
| [13] | Sutcliffe, R., 2024, A Survey of Personality, Persona, and Profile in Conversational Agents and Chatbots（arXiv 预印本，2023-12 提交） | https://arxiv.org/abs/2401.00609 | personalityTraits、learnerPersona | 系统综述区分 personality/persona/profile 三层概念，梳理 Big Five（OCEAN）等框架在对话式 AI 中的用法；项目向量属「行为风格参数化」，比 OCEAN 更表层但更易注入 |
| [14] | Li, W., Liu, J., Liu, A., Zhou, X., Diab, M.T., Sap, M., 2025, BIG5-CHAT: Shaping LLM Personalities Through Training on Human-Grounded Data, ACL 2025 | https://aclanthology.org/2025.acl-long.999/ | personalityTraits | 证明 Big Five 维度可显式注入 LLM 对话并改变会话风格（含冗长度、热情度等表现层差异）；支持项目用连续向量控制虚拟学习者行为风格 |
| [15] | Körner 等（第一手文献出处待核），经 Nautilus 报道（2025, We Attribute Personalities to Chatbots, Even When We Know Better） | https://nautil.us/we-attribute-personalities-to-chatbots-even-when-we-know-better-1286429 | personalityTraits、learnerPersona（可信度） | 实证警告：7 个 LLM 自评人格普遍比人类更宜人/更尽责，同一模型重复测量不稳定。提示虚拟学习者 persona 的「特质」不可当心理测量读数，且跨会话可能漂移 |

### 项目设计与文献的对照

**一致点**

1. 分层建模结构。learner.knowledgeMemory（知识）/ learner.profile（长期画像）/ learner.dynamicState（近期状态）的三层划分与 ITS 文献「知识追踪模型 + 更广学习者属性」的分工 [1][2] 及 SMILI:) 框架中模型属性的多元性（知识、偏好、目标可共处一模型）[4] 相容；transferSignals 把「迁移就绪度」显式化，是对经典 KT 只看表现概率的合理扩展，方向上与深度 KT「从整个交互历史推断更泛化的状态」的思路一致 [3]。
2. 信念与真相分离。「自报完成（selfReportedTaskDone）不作语义真相、结课权威在教师侧」的设定，与校准文献「学习者自评普遍存在系统性偏差（尤以高估为常）」[7][8] 及 OLM「学生模型是系统信念、可错可协商」的立场 [4] 双重一致——自报数据应作输入信号而非输出真相。
3. 虚拟学习者 persona 的技术路线。用人格/风格向量驱动 LLM 虚拟学习者，与生成式 agent 的「档案注入 → 可信行为模拟」范式一致 [12]；Sutcliffe 综述表明 persona 参数化是对话式 AI 的成熟做法 [13]，BIG5-CHAT 更证明会话风格特质可被连续数值控制 [14]。项目选择 verbosity/patience 等表层行为维度而非 OCEAN，反而更贴近「可观察、可注入、可验证」的工程口径。
4. 元认知与动机构念定位。metacognitiveProfile/selfAssessmentAccuracy 对应 SRL 自我反思阶段与校准测量 [7][8]；motivationType 与 SDT/期待-价值理论的映射关系基本成立（interest↔内在动机，career/necessity↔工具性外在动机，social↔归属需要）[9][10][11]。

**张力点**

1. VARK 字段与 neuromyth 争议（必读评注）。项目 VARK 式字段（reading/watching/doing/listening）直接沿用被系统审查否定的「学习风格」框架：Pashler 等人 2008 年的权威结论是「无充分证据支持按风格匹配教学能提升学习，也无充分效度基础将风格量表用于教育实践」[5]；Newton & Miah 进一步警告该迷思继续流行会误导高等教育实践 [6]。风险在于字段语义：若 VARK 字段仅作「内容形式偏好」（学习者自述更喜欢视频/动手），则是无害偏好记录；若下游教学策略据此执行「按风格匹配内容形式以提升效果」，即复现被证伪的 meshing 假设。建议：(a) 字段更名为 preference（如 practicePreferenceNote 已是正确先例）；(b) 在 prompt 中明文禁止「因 X 风格而必须用 Y 形式」的推理；(c) 叙事中避免从偏好推断能力或局限。
2. 「人格特质」的措辞超出测量基础。personalityTraits 六维并非 Big Five，也不是经心理测量学检验的量表得分，而是 LLM 从对话推断的行为风格参数。文献上可行（persona 注入本就使用表层参数 [13][14]），但「traits」一词暗示稳定性与测量效度；Körner 等的发现（LLM 自评人格普遍偏高且不稳定 [15]）提示这些向量跨会话可能漂移。建议措辞改为「会话风格画像」，并将向量视为「本次 persona 的设定值」而非「学习者的心理测量读数」。
3. motivationType 的离散化。SDT 将外在动机处理为内化连续谱（外部调节→内摄→认同→整合）[9][10]，期待-价值理论强调期待×价值的乘性结构 [11]；项目四分类（career/interest/necessity/social）是离散标签，会丢失混合动机（career+interest 并存极常见）与内化程度信息。建议至少允许多标签或附强度。
4. OLM 的开放价值未被利用。OLM 传统强调把模型开放给学习者本人以促进元认知与协商 [4]；WenFlow 画像面向教师/教学决策侧，学习者看不到系统对自己的「信念」。这不构成设计错误，但放弃了文献已验证的一条元认知促进路径；同时画像不透明也带来下述伦理风险。

**风险点**

1. 推断效度风险：profile/personalityTraits/motivationType 等均由 LLM 从自然对话推断，无心理测量学信效度证据（对比 Big Five 依赖数十年量表验证 [13]）；标签（如「高估倾向」「低韧性」）一旦写入长期画像即可能形成标签效应，影响后续教学互动（自证预言）。
2. persona 稳定性风险：虚拟学习者 persona 依赖 LLM 人格一致性，实证显示其自评人格跨查询不稳定 [15]；长时间会话中 verbosity/patience 等参数可能漂移，使「对照教学实验」类用途的基线失真。建议在 prompt 中要求 persona 参数按设定值锚定并周期性自检。
3. 自评校准字段的双向误判风险：selfAssessmentAccuracy 需要「自报—真实表现」配对数据才能成立；若真实表现标签本身不可靠（如结课权威在教师侧、教师标注稀疏），高估/低估标签可能只是噪声。文献中校准研究均以实测成绩为基准 [8]，项目需保证该基准字段有稳定来源。
4. 敏感画像的伦理风险：人格、动机、心理韧性（resiliencePattern）属于敏感个人信息；OLM 文献主张学习者应能查看、质疑其模型 [4]。建议项目为画像提供学习者可见性/纠错通道，至少在产品层声明画像仅用于教学适配。

---

## 章节二：行为遥测与交互特征字段

### 覆盖字段

| 字段 | 含义（按项目底表） |
| --- | --- |
| interactionProfile.draftMs | 输入总时长（毫秒） |
| interactionProfile.idleMsBefore | 上条回复到首次输入的间隔 |
| interactionProfile.lastIdleMs | 单条输入过程中的最大停顿 |
| interactionProfile.editingCount | 编辑次数 |
| interactionProfile.deleteCount | 回退字符数 |
| interactionProfile.charsPerSentence | 每句平均字符数 |
| interactionProfile.current / history | 本轮统计值 + 近 6 条带 timestamps 的特征对比 |
| 定位声明 | 「认知负荷量测的辅助情报，不作语义真相」 |
| sessionLss / sessionLf | 学习压力 / 疲劳负担 proxy 指标 |
| fatigueSignal | 疲劳信号 |
| stallRisk | 卡壳风险/概率 |
| behavioralProfile | 行为画像 |
| rsmAttempts | rsm 尝试次数 |
| checkpointHistory | 检查点历史 |

### 对应学术构念

**交互日志与按键级分析。** 将学习者在界面上的微观操作（按键、停顿、编辑、删除）作为数据源，在教育研究中有成熟传统：CMU 的 PSLC DataShop 自称「世界最大的学习交互数据仓库」，托管了从数百到逾 240 万条事务（transaction）的辅导系统交互日志，覆盖数学、物理、语言学习等学科，是学习科学与教育数据挖掘（EDM）的基础设施 [1]。写作研究中，Conijn 等人系统检验了按键日志特征（停顿、修改、爆发长度）对任务条件的敏感性，并明确指出「我们无法直接断言按键特征与认知负荷的确切关系」[2]——这句限定对本项目至关重要。WenFlow 的 interactionProfile（draftMs/idleMsBefore/lastIdleMs/editingCount/deleteCount/charsPerSentence + current/history 对比）即属这一范式：以行为流特征作为认知与困难状态的间接信号。

**响应时间与认知负荷。** 响应时间（latency）作为认知负荷的行为指标有实验心理学依据：在标准化任务中，反应时随负荷条件系统性变化 [3]。但两条文献边界同样明确：其一，行为/表现类测度（完成时间、错误率、响应延迟）与心理负荷的关系受任务类型与时间约束调节，需要与其他模态交叉验证 [4]；其二，基于生理传感的认知负荷预测研究表明，稳定信号需要较长的时间窗（最优窗口常超 90 秒），且不同分类器最优窗口不同——单一瞬时读数不可靠 [5]。WenFlow 用「current（单轮统计）+ history（近 6 条对比）」部分回应了窗口问题（以历史基线校正单轮噪声），方向与文献一致，但单轮特征作为「认知负荷辅助情报」的定位必须维持（详见对照）。

**行为参与度与情感状态检测。** 教育心理学将参与度（engagement）拆分为行为、情感、认知三维，行为参与度（参与行为、持久性）是可观察测量的核心维度 [6]。ITS/EDM 文献进一步表明，无聊、困惑、受挫等情感状态可从交互与行为线索推断，且情感状态呈动态转移链（受挫→无聊→脱离学习）[7]；较新的工作从「事后识别情感」转向「预测未来情感」，以便提前干预脱离行为 [8]。多模态检测综述显示，摄像头、眼动、皮肤电等传感器可提升检测精度，但也带来成本与生态效度问题 [9]。WenFlow 的 fatigueSignal、stallRisk、sessionLss/sessionLf 在构念上对应「脱离/疲劳/压力检测」，只是没有传感器，纯粹依赖行为代理——这正是文献中「sensor-free」路线的思路，其代价是效度证据更弱、混淆更难排除。

**早期预警与风险预测。** 学习分析（learning analytics）的标志性应用之一即是从交互数据预测「at-risk」学生、触发早期干预 [10]。stallRisk（卡壳风险概率）与 checkpointHistory（检查点历史）的功能定位与该方向吻合：用近期行为轨迹预测「即将脱离/卡住」，在恶化前介入。文献同时提示两条边界：概率预测需要校准与验证（数据驱动的模型需报告预测性能），且风险标签对学生有标签效应，干预设计须谨慎 [10]。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
| --- | --- | --- | --- | --- |
| [1] | PSLC DataShop（CMU LearnLab），学习交互数据仓库与在线分析工具（持续维护） | https://pslcdatashop.web.cmu.edu/ | interactionProfile、behavioralProfile、checkpointHistory | 「世界最大学习交互数据仓库」：辅导系统事务级日志（单数据集可达 240 万条事务）是该领域标准基础设施；证明项目对细粒度交互特征的重视方向正确，也提示事务级数据需极大规模才足以支撑稳定推断 |
| [2] | Conijn, R., Roeser, J., van Zaanen, M., 2019, Understanding the keystroke log: the effect of writing task on keystroke features, Reading and Writing 32: 2353–2374 | https://link.springer.com/article/10.1007/s11145-019-09953-8 | draftMs、lastIdleMs、editingCount、deleteCount、charsPerSentence | 按键特征对写作任务条件敏感，但作者明言无法直接断言按键特征↔认知负荷关系；为「辅助情报、不作语义真相」定位提供直接文献依据 |
| [3] | Pillai, P., Ayare, P., Balasingam, B., Milne, K., Biondi, F., 2020, Response time and eye tracking datasets for activities demanding varying cognitive load, Data in Brief 33: 106389 | https://pmc.ncbi.nlm.nih.gov/articles/PMC7578673/ | idleMsBefore、lastIdleMs | 响应时被广泛用作认知负荷测度的数据集论文；注意其效度建立在标准化任务与对照条件上，聊天场景不具备该条件 |
| [4] | Rahimi 等, 2026, Measuring Cognitive Load Index in Online Learning: A Multi-Modal Approach, Journal of Computer Assisted Learning（完整作者列表待核） | https://onlinelibrary.wiley.com/doi/full/10.1002/jcal.70252 | interactionProfile（定位） | 多模态认知负荷测度综述：行为/表现类指标（错误率、完成时间、响应延迟）反映负荷但受任务约束，需与其他模态交叉验证；支持项目「行为遥测只作辅助情报」 |
| [5] | Cai, M. & Demmans Epp, C., 2024, Exploring the Optimal Time Window for Predicting Cognitive Load Using Physiological Sensor Data, PhysioCHI @ CHI 2024（arXiv 预印本） | https://arxiv.org/abs/2406.13793 | interactionProfile.current / history、sessionLf | 生理信号预测认知负荷需 >90 秒窗口且跨分类器最优窗口不同；对项目含义：单轮 current 读数噪声大，history 基线是必要校正 |
| [6] | Fredricks, J.A., Blumenfeld, P.C., Paris, A.H., 2004, School Engagement: Potential of the Concept, State of the Evidence, Review of Educational Research 74(1): 59–109 | https://en.wikipedia.org/wiki/Student_engagement（出处条目经维基百科参考文献列表核实） | behavioralProfile、stallRisk | 参与度三维框架（行为/情感/认知）的权威综述；行为参与度是可观察测量维度，为「行为画像→参与/脱离推断」提供构念合法性 |
| [7] | D'Mello, S.K. & Graesser, A.C., 2012, Dynamics of affective states during complex learning, Learning and Instruction（卷页待核；出处经 UC Merced 学位论文正文引用核实） | https://repositories.cdlib.org/content/qt9z7170zz/qt9z7170zz.pdf | fatigueSignal、stallRisk、sessionLss | 情感状态动态学：受挫→无聊→脱离的转移链，且情感状态与学习增益相关；为「从行为信号推断疲劳/卡壳」提供情感检测理论基础 |
| [8] | Zambrano, A.F., Baker, R.S., Baral, S., Heffernan, N.T., Lan, A., 2024, From Reaction to Anticipation: Predicting Future Affect, EDM 2024 (short paper 58) | https://www.educationaldatamining.org/edm2024/proceedings/2024.EDM-short-papers.58/ | stallRisk、fatigueSignal、sessionLf | 从「事后识别情感」转向「预测未来情感」；为项目 stallRisk 的前瞻性定位（提前干预而非事后归因）提供范式参照 |
| [9] | Myers, M.H., 2021, Automatic Detection of a Student's Affective States for Intelligent Teaching Systems, Brain Sciences 11(3):331 | https://pmc.ncbi.nlm.nih.gov/articles/PMC7998267/ | fatigueSignal、sessionLss | 多模态情感检测综述：摄像头/压力/眼动/皮肤电等传感器可检测参与与情感；对照说明 WenFlow 无传感器的行为代理路线证据更弱、需保守解读 |
| [10] | Learning analytics「at-risk 预测与早期预警」方向（百科条目，方向佐证，非原始文献） | https://en.wikipedia.org/wiki/Learning_analytics | stallRisk、checkpointHistory | 学习分析领域将「识别 at-risk 学生并早期干预」列为核心用途；原始文献（如 Course Signals 等）未能在本次检索中核实（出处待核），此处仅作方向锚点 |
| [11] | Cognitive Learning Analytics（作者待核）, 2026, Analytics（MDPI） | https://www.mdpi.com/2673-8392/6/3/69 | interactionProfile（定位）、sessionLf | 提出「认知构念 ↔ 可观察数据 ↔ 建模 ↔ 验证策略」链条：时间花费、clickstream、解题序列可连向内在/外在/相关负荷，但须逐构念验证；为项目遥测字段建立「可观察量→构念」映射时的效度清单 |

### 项目设计与文献的对照

**一致点**

1. 遥测范式与基础设施传统。interactionProfile 的六特征（时长、首输入延迟、输入中停顿、编辑、回退、句长）全部落在按键/日志分析文献检验过的特征族内 [1][2]；PSLC DataShop 的事务级交互数据传统 [1] 表明「从微观交互推断学习过程」是学习科学主流方法而非噱头。
2. current + history 的基线设计。文献一致表明行为指标单次读数噪声大、需时间窗与个体基线校正：生理负荷预测需 >90 秒窗口 [5]，按键特征依任务条件而变 [2]，情感检测依赖轨迹而非瞬时点 [7][8]。项目「current + 近 6 条带时间戳 history」的设计方向正确——history 提供个人基线，使「本轮显著偏离常态」成为可计算信号。
3. 「辅助情报，不作语义真相」的定位声明。这与文献的两条效度共识完全一致：行为/表现类测度与认知构念的关系受任务调节、需交叉验证 [2][4]；构念推断须走「可观察量→构念→验证」链条 [11]。将该声明写进 prompt 属于教科书式的效度边界管理。
4. 前瞻性风险信号。stallRisk 从「事后识别脱离」转向「预测即将发生」的定位，与 EDM 前沿（预测未来情感优于事后反应）同向 [8]；checkpointHistory 提供轨迹锚点，符合参与度动态学中「状态转移链」的分析思路 [6][7]。

**张力点**

1. 认知负荷 proxy 的效度边界（必读评注）。项目把 interactionProfile 定位为「认知负荷量测的辅助情报」。文献支持「辅助」但强烈反对「量测」：Conijn 等人直接指出按键特征与认知负荷的关系无法从其研究中断言 [2]；响应时间的负荷效度依赖标准化任务条件 [3]，自由对话场景不具备；多模态研究要求行为指标与生理/主观指标交叉验证才能逼近负荷构念 [4][9]。因此该字段的正确语义是「交互困难度的行为线索」（如停顿、频繁回退可能暗示卡壳），而非「认知负荷数值」。建议 prompt 中避免出现「认知负荷」字样于该字段的推断规则里，改用「交互困难/迟滞信号」，把「负荷」一词留给有生理或主观测度的场景。
2. 疲劳/压力 proxy 的文献支撑更薄。sessionLss/sessionLf/fatigueSignal 在交互日志中直接估计疲劳的成熟效度研究在本次检索中未找到（直接相关文献待核）；文献中疲劳更接近无聊/脱离的情感链 [7] 或生理信号域 [5][9]。将它们称为「proxy」是诚实的，但应显式记录假设链：行为迟滞→可能疲劳→可能需要调整节奏；每一环都可被其他解释（分心、输入法卡顿、多任务）打断。
3. stallRisk 的「概率」语义。EDM 文献中的风险概率来自有 AUC/校准验证的数据驱动模型 [8][10]；若项目概率由 LLM 主观给出，则其「概率」是语言模型的置信性表述而非校准概率。建议在 prompt 中将其降格为「风险等级（低/中/高）」，或注明「非统计校准概率」。
4. 单轮语义 vs 跨轮历史。current（本轮）在 prompt 中若与 history（近 6 条）同等权重使用，会放大噪声（文献窗口证据 [5]）；应规定「偏离判断以 history 基线为主，current 仅作触发器」。

**风险点**

1. 输入方式混杂：draftMs/editingCount/deleteCount 的基线强烈依赖输入设备（移动端 vs 桌面）、输入法（拼音联想 vs 直接输入）、语言类型（字符 vs 词）与用户打字熟练度；跨用户比较几乎无效，应只做「个体内历史对比」——项目 history 设计恰好限定了这一点，须在推断规则中固化。
2. 标签与干预的误伤风险：at-risk/预警文献警示风险标签的标签效应与公平性问题 [10]；stallRisk 触发的教学降阶（如简化任务）若误触发，反而剥夺练习机会。建议将 stallRisk 用于「调节提示力度/节奏」而非「改变任务难度判定」。
3. 隐私与监控感：按键级遥测（编辑、删除、停顿）对用户有较强监控意涵，超出一般对话日志的敏感度；建议产品层明示采集范围与用途，并考虑最小化存储周期（checkpointHistory 的「检查点」粒度是合理的中间态）。
4. 反馈回路风险：若模型用 history 特征持续调整回复（例如对慢输入者自动简化），可能强化既有行为模式（自我实现回路），使 history 基线漂移并污染长期画像（与章节一的 learner.dynamicState 联动）。建议对「因遥测而改变的互动」打标记，避免其污染画像推断的输入分布。

---

## 附：检索与核实记录

- Tavily 检索 9 次（查询词各异）：① student modeling / knowledge tracing review；② open learner model Bull Kay；③ learning styles neuromyth Pashler VARK；④ Zimmerman SRL + calibration；⑤ Park generative agents 2023；⑥ Big Five personality chatbot；⑦ SDT Deci Ryan；⑧ keystroke log / response time / cognitive load / DataShop；⑨ D'Mello affect detection / disengagement。
- WebFetch 核实：arXiv:2401.00609、arXiv:2304.03442、arXiv:1506.05908、arXiv:2406.13793、Springer（BF01099821 被墙改走二手证据；s11145-019-09953-8 已核实）、SagePub（Fredricks 403，改走维基百科参考文献列表核实）、ACM（Arnold & Pistilli 403 且未能在开放页面核实，故未收入文献表）、pslcdatashop.web.cmu.edu、PMC5366351、PMC5408091、PMC7578673、PMC7998267、维基百科（Learning styles / Student engagement / Learning analytics / Expectancy-value theory）、aclanthology.org。
- 明确未收录/待核：Arnold & Pistilli 2012（Course Signals，未核实，不引用）；Piech et al. 2015 的 NIPS 出处（arXiv 已核实，会议出处待核）；Körner 等的第一手论文（仅经 Nautilus 报道，标注待核）；D'Mello & Graesser 2012 卷页；Zimmerman 2002 卷期；Corbett & Anderson 1995 卷页/DOI。
