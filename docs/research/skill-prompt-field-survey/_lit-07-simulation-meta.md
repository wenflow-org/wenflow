# 文献调研 07：虚拟学习者仿真与裁判字段 / 元技能与 prompt 工程字段

- 调查版：commit e736f7aa（2026-11-19）
- 检索方法：Tavily 检索 16 次 + arXiv 摘要页逐一核实（WebFetch）；不用 WebSearch。
- 引用纪律：所有入表文献均真实出现在检索结果或抓取正文中并附 URL；未经核实出处的条目标注「（出处待核）」。检索中曾出现的两条记忆编号（自偏好论文、MathDial 的 arXiv ID）经核实为错误编号，已弃用或降级为转引。

---

## 章节一：虚拟学习者仿真与裁判字段

### 覆盖字段

- personaSeed（31 子字段）：personalityTraits 六维向量（verbosity / enthusiasm / confusionStyle / patience / questionStyle / emotionalRange）；story 生活史 16 子字段；problemKnowledge；goalSeed 11 子字段；disclosurePlan 披露计划 4 子字段（opening / revelationTriggers / resistancePoints / idealProbe）
- friction 摩擦预算 / 摩擦校准（受控错误：编排层采样，让仿真学习者在可控位置犯错）
- personaAnchorHint、行为自然度、角色保真 / 角色漂移、画像一致性 / 故事一致性、私有状态连续性、能力悖论泄露（会了却装不会类一致性破绽）、误诊 misdiagnosis
- simulation-actor-audit（行为审计：5 顶层 + 25 子字段）
- simulation-epistemic-grounding（认知判决：离散判决 / 前瞻判决）
- simulation-memory-curate（长期记忆 / 到期复习点 / 具身细节 / 主观记忆「完成≠掌握」）
- simulation-referee（独立旁路裁判：5 顶层 + 26 子字段；rubric 0-100 分项 + 固定权重合成 verdict；goalExperience / pathExperience / teachingExperience；学习者困难 vs 平台缺陷归因）
- 掌握概率 masteryProb（0.40-0.55 中低位口径）、记忆提取四态 CLEAR / VAGUE / CONFUSED / FAILED、自评校准 selfAssessmentAccuracy

### 对应学术构念

**模拟学生与生成式智能体。** LLM 驱动的虚拟学习者是「生成式智能体」范式在教育领域的延伸：Park 等人的 Smallville 实验确立了「记忆流（memory stream）—反思（reflection）—计划（planning）」三件套架构，用自然语言记录智能体全部经历并周期性合成更高层推断，以产生「可信（believable）」行为 [1]。本项目 personaSeed 中 story 生活史 16 子字段相当于给智能体预置的记忆流底稿，simulation-memory-curate 的长期记忆条目、到期复习点与具身细节对应记忆流的检索与反思机制；「完成≠掌握」的主观记忆则把行为成就与内部状态显式分离。教育领域的专门综述（Marquez 等）梳理了 LLM 模拟学生的架构、机制与角色建模证据，指出其价值在于语言学真实感与行为可适应性，而非仅是流畅对话 [2]；用 LLM 智能体做「无风险演练（risk-free simulation）」来评估 AIED 创新，正是本平台黑盒演练的学术同构物（Jiang & Zhang 的 student development agent，转引自 [2] 所引文献列表）。但真实性边界已被多项研究敲打：BEA 2025 的教师评估研究发现模拟学生的现实性尚无充分证据，且 Käser & Alexandron 的综述发现仅约 3% 的模拟学习者研究做事后验证 [3]；「实质还是幻觉（Substance or Illusion）」一文指出，仅靠 persona 条件化并不足以约束学生的知识暴露与认知状态 [5]——这正是本项目 personaAnchorHint、画像/故事一致性、能力悖论泄露等字段要防御的对象。

**受控错误与摩擦预算。** 让仿真学习者在「可控位置」犯错，对应训练仿真学中成熟的 error-based training / error management training 传统：在模拟环境中刻意引入并讨论错误，能提升技能保持与迁移（中央静脉导管技能的随机对照证据）[7]。摩擦预算把「错误率与错误位置」变成编排层可采样的显式预算，相当于把 EMT 的教学设计决策工程化为字段。与受控错误紧密相关的是「能力约束 / epistemic control」：最新的学生仿真效度研究明确论证，教育有用性取决于对学习者能力的认知控制而非语言流畅度，需要用显式或演化的学习者状态来约束 LLM 智能体的 competence [4]。MathDial 等数据集证明可以条件化生成「带有特定误解」的学生对话（Macina et al. 2023，转引自 [5]，arXiv 编号出处待核）。本项目 disclosurePlan 的 revelationTriggers / resistancePoints（何时暴露弱点、何处抵抗）与 MDPI 合成学习者研究中的「内部误解状态转移与外显对话解耦」设计高度同构：后者用确定性规则管理误解状态转移，LLM 只负责把状态转译为话语，从而保证内部状态连续性可审计 [6]——这为「私有状态连续性」与「能力悖论泄露」两个字段提供了文献先例：内部状态与外显行为的缝隙正是需要专门字段去检测的一致性破绽。

**LLM-as-judge 与裁判效度。** simulation-referee 的「独立旁路裁判 + rubric 分项 + 固定权重合成 verdict」直接落在 LLM-as-a-judge 文献的问题域内。Zheng 等人的 MT-Bench 奠基工作确认 GPT-4 级裁判与人类偏好一致性可超 80%，但同时系统记录了三类偏差：位置偏差、冗长偏差与自我增强（自偏好）偏差 [8]；Wang 等人证明仅交换候选答案顺序即可操纵裁判结论，并提出多证据校准与平衡位置校准等缓解框架 [10]；JudgeLM 在微调裁判时同样处理位置 / 知识 / 格式三类偏差，并用 swap 增强与参考答案支持提升裁判质量 [9]。本项目用「分项 0-100 + 固定权重合成」而非单一整体分，与 G-Eval 的 rubric 化评分路线一致：显式评价标准 + CoT 评估步骤 + 逐分项打分可提升与人评对齐 [11]；「学习者困难 vs 平台缺陷」归因字段则呼应裁判文献中「评估证据显式化」的做法 [10]。裁判的信效度方面，自动作文评分（AES）的 65 项研究综合显示 LLM 与人评一致性普遍中到良好（QWK 等指标），但后续心理测量学分析提醒：一致性是效度的必要而非充分条件，还需要区分维度与公平性审计 [15]。

**认识论认知与接地。** simulation-epistemic-grounding 的「离散判决 / 前瞻判决」在教育学中的对应构念是 epistemic cognition / personal epistemology：Hofer & Pintrich 把「对知识与认识过程的信念」拆为知识的确定性、简单性、来源与辩护正当性四维，并论证这些信念与学习行为直接相关 [12]；「关于学习者知道什么、如何知道、下一步会怎样」的判决正落在这一构念的评估侧。其工程侧对应物是 RAG 文献中的 groundedness（接地性）：长文本生成中「每个论断是否被上下文支持」的实证研究表明，即便有检索增强，模型仍会产出无支撑内容，需要显式的 groundedness 判决层 [14]。「最新学生仿真效度研究」同样把 epistemic control 列为模拟学生有用性的核心变量 [4]——本项目把「认知判决」做成独立 skill 而非生成器的副产品，与这两条文献线一致。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
|---|---|---|---|---|
| [1] | Park, J.S. et al., 2023, Generative Agents: Interactive Simulacra of Human Behavior, UIST 2023 | https://arxiv.org/abs/2304.03442 | story 生活史、simulation-memory-curate（长期记忆/到期复习点/具身细节）、画像一致性 | 记忆流/反思/计划架构与「可信行为」目标；项目的生活史字段≈预置记忆流，memory-curate≈其检索+反思层 |
| [2] | Marquez, L., Lopez, A., Cazorla, M., 2025, Simulating students with large language models: A review of architecture, mechanisms, and role modelling in education with generative AI, 期刊综述（ScienceDirect；另 arXiv:2511.06078） | https://www.sciencedirect.com/science/article/pii/S1574013726001164 | personaSeed 整体、行为自然度 | 教育领域 LLM 模拟学生的主题综述：语言真实感与行为可适应、跨环境教学法测试；含 student development agent（risk-free simulation, arXiv:2510.09183）等引文 |
| [3] | 教师评估研究, 2025, Can LLMs Effectively Simulate Human Learners? Teachers' judgments…, BEA 2025（ACL） | https://aclanthology.org/2025.bea-1.8.pdf | simulation-actor-audit、行为真实度边界 | 指出模拟学生现实性证据不足；转引 Käser & Alexandron 2024 综述：仅约 3% 模拟学习者研究做事后验证 |
| [4] | 2026, Towards Valid Student Simulation with Large Language Models, arXiv 预印本 | https://arxiv.org/html/2601.05473v1 | 能力悖论泄露、disclosurePlan、epistemic control | 论证教育有用性取决于 epistemic control 而非流畅度；用显式/演化学习者状态约束能力，直接支持摩擦预算与能力约束字段 |
| [5] | 2026, Simulated Students in Tutoring Dialogues: Substance or Illusion?, arXiv 预印本 | https://arxiv.org/html/2601.04025v2 | 画像一致性、私有状态连续性、误诊 | 批判仅 persona 条件化的不足；提及 MathDial（Macina et al. 2023，误解条件化学生，arXiv 编号出处待核）与认知状态条件化路线 |
| [6] | 2026, Evaluating Retrieval-Augmented LLM Tutoring with Synthetic Learners: A Factorial Simulation of Newtonian Misconception Revision, Applied Sciences (MDPI) | https://www.mdpi.com/2076-3417/16/19/9938 | 私有状态连续性、masteryProb、误诊 | 合成学习者=persona+认知状态+行为指引；误解状态转移由确定性规则管理并与外显对话解耦——内部状态可审计的设计先例 |
| [7] | 仿真医学教育研究, 2015/2016, Embracing Errors in Simulation-Based Training: The Effect of Error Training on Retention and Transfer of Central Venous Catheter Skills, Simulation in Healthcare | https://www.sciencedirect.com/science/article/abs/pii/S193172041500207X | friction 摩擦预算 | error-based training 改善技能保持与迁移的实证；支持「在可控位置犯错」的教学价值 |
| [8] | Zheng, L. et al., 2023, Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena, NeurIPS 2023 D&B | https://arxiv.org/abs/2306.05685 | simulation-referee（rubric/verdict）、裁判偏差 | GPT-4 裁判与人类一致 >80%，但记录位置/冗长/自增强偏差；referee 的已知偏差清单来源 |
| [9] | Zhu, L., Wang, X., Wang, X., 2023/2025, JudgeLM: Fine-tuned Large Language Models are Scalable Judges, ICLR 2025 | https://arxiv.org/abs/2310.17631 | simulation-referee（偏差缓解） | 位置/知识/格式偏差 + swap 增强、参考支持；裁判可扩展化与校准技术清单 |
| [10] | Wang, P. et al., 2023, Large Language Models are not Fair Evaluators, arXiv（FairEval） | https://arxiv.org/abs/2305.17926 | 归因字段（证据显式化）、裁判独立性 | 顺序可操纵裁判结论；多证据校准/平衡位置校准——支撑 referee 分项证据与归因显式化 |
| [11] | Liu, Y. et al., 2023, G-EVAL: NLG Evaluation using GPT-4 with Better Human Alignment, EMNLP 2023 | https://aclanthology.org/2023.emnlp-main.153.pdf | referee rubric 0-100 分项、固定权重合成 | rubric+CoT 评估步骤+token 概率打分；rubric 化评分提升人评对齐的代表作 |
| [12] | Hofer, B.K., Pintrich, P.R., 1997, The Development of Epistemological Theories: Beliefs about Knowledge and Knowing and Their Relation to Learning, Review of Educational Research 67(1): 88-140 | https://eric.ed.gov?id=EJ548329 | simulation-epistemic-grounding（认知判决） | 个人认识论四维（确定性/简单性/来源/辩护）；认知立场评估的构念源头 |
| [13] | 2025, CharacterBox: Evaluating the Role-Playing Capabilities of LLMs in Long-Term Dynamic Environments, NAACL 2025 | https://aclanthology.org/2025.naacl-long.323.pdf | 角色保真/角色漂移、画像一致性 | 以 Character Fidelity / Human-Likeness / Consistency 三维评测角色扮演，含 Cronbach α 信度报告——「角色漂移」的评测框架对应 |
| [14] | 2024, Groundedness in Retrieval-augmented Long-form Generation: An Empirical Study, arXiv | https://arxiv.org/html/2404.07060v1 | simulation-epistemic-grounding（接地/幻觉抑制） | 长文生成中「论断是否被文档支持」的实证测量；RAG 仍会无支撑作答，需要显式 groundedness 判决 |
| [15] | 2025/2026, Agreement Between Large Language Models and Human Raters in Essay Scoring: A Research Synthesis（PRISMA，65 项研究） | https://www.alphaxiv.org/abs/2512.14561v1 | referee 信效度、人评一致性 | LLM-人评一致性中到良好；另有 IRT 心理测量分析（scitepress 2026/149825）强调「一致性必要但不充分」——referee 需独立效度证据 |

### 项目设计与文献的对照

**一致点**
1. 生活史 + 记忆流 + 复习点：personaSeed 的 story 16 子字段与 simulation-memory-curate 的「长期记忆条目 + 到期复习点 + 具身细节」几乎逐项映射到生成式智能体的记忆流/反思架构 [1]，属文献已验证的组件化路线。
2. 摩擦预算有教学科学依据：受控错误在仿真训练中改善保持与迁移 [7]，且「epistemic control 优先于流畅度」是学生仿真效度研究的核心结论 [4]——friction 预算 + disclosurePlan 是这两条证据的字段化。
3. 独立状态机管理内部认知：MDPI 合成学习者把误解状态转移与外显对话解耦、由确定性规则管理 [6]，与项目「私有状态连续性 + 能力悖论泄露检测」同构，证明该设计模式在文献中已有先例。
4. rubric 分项 + 证据显式化：referee 的 0-100 分项与固定权重合成对应 G-Eval 的 rubric 评分路线 [11]；「学习者困难 vs 平台缺陷」归因呼应多证据校准的显式证据思想 [10]。
5. 认知判决双重对应：epistemic-grounding 同时落在教育心理学的个人认识论构念 [12] 与 NLP 的 groundedness 实证测量 [14] 上，构念基础扎实。

**张力点**
1. 固定权重的可加性假设：LLM 裁判文献显示整体（holistic）与分析（analytic）评分的人评一致性并不同质——AES 证据中 analytic 分项更不稳定 [15]；项目按固定权重合成 verdict，需自证权重体系不放大分项噪声。
2. 「独立旁路」≠模型独立：裁判文献确认自增强/自偏好偏差存在于同源模型 [8]；本项目 referee 与被评者同为 LLM，「旁路」只是 prompt 层隔离，模型层自偏好仍在。
3. 披露计划的对抗性 vs 人格一致性：disclosurePlan 要求按触发器主动暴露弱点，而角色保真评测表明模型在长期动态环境中天然趋向「知识泄露/角色漂移」[13][5]——两个目标叠加时（既要藏又要露）一致性维护成本更高。
4. masteryProb 的概率带 vs 确定性状态：文献中可审计的内部状态多用确定性转移规则 [6]；项目用 0.40-0.55 概率带口径，连续概率在裁判与审计间传递时更难复现。

**风险点**
1. 自评一家之言的效度风险：referee 的 goalExperience/pathExperience/teachingExperience 三视角若全部由同族 LLM 生成，实质仍是模型自评；AES 心理测量研究明确警示一致性不等于效度 [15]，需引入人工锚点校准。
2. 行为真实性缺乏外部基准：仅约 3% 的模拟学习者研究做事后验证 [3]；simulation-actor-audit（5+25 字段）是补救，但审计本身也需与人评对齐才能闭环，否则是「无锚自检」。
3. 能力悖论的长期维持难度：高能力底座模型「装不会」时知识泄露是 CharacterEval 类评测中的常见失分维度（角色一致性评测文献 [13]），长时间演练中悖论破绽率可能随轮数上升，摩擦预算需要按轮数衰减建模。
4. 裁判稳定性受操作参数影响：温度升高会显著降低裁判一致性并抬高错误率（详见章二 [28]），referee 的 0.3 温度口径需用复测一致性数据持续验证。

---

## 章节二：元技能与 prompt 工程字段

### 覆盖字段

- skill-author：system prompt 起草约束、schema 约束 / 必填字段覆盖、元规则不暴露（meta-rules 不进下游 prompt）、字段产出指引、hallucination 防护（不承诺平台未提供能力）
- skill-compiler 验收器 / 编译期验收：requiredFieldIds 字段核对、字段冻结（缺字段即 pass=false）、JSON 可解析性校验、generate-then-check 两步、验证器中立性（不修改被验收 prompt）
- prompt injection 防护（轨迹文本非指令）、温度分档（审计/验收 0.2-0.3，判决 0.3，生成 0.7-0.9）
- 平台机制：字段冻结（Field Freeze）/ 含义冻结、coreHash 锚点、五块结构模板

### 对应学术构念

**从 prompt 艺术到 prompt 工程。** prompt 方法论已从经验技巧沉淀为系统学科：Liu 等人确立了「预训练—提示—预测」范式综述 [16]；Sahoo 等人整理了 41 种技术并按应用域分类 [17]；Schulhoff 等人的 Prompt Report 进一步建立 33 个标准术语与 58 种技术的分类体系，明确以「标准化词汇」治理领域碎片化 [18]。skill-author 的「起草约束 / 字段产出指引 / 五块结构模板」正是这一标准化运动在平台内部的延伸：把 prompt 从自由文本制品变为有 schema、有模板、有验收的工程制品。requiredFieldIds 的字段核对则对应 IFEval 开创的「可验证指令」思路——把指令遵循转化为程序可检验的谓词（如必填字段存在性），从而绕开主观判分 [19]。

**结构化输出与编译期验收。** 字段冻结与 JSON 可解析性校验的硬保证来自约束解码（constrained decoding）文献：将 JSON Schema 编译为文法/有限状态机并在每步解码时屏蔽非法 token，可使结构合法性从「概率性」变为「保证性」（Outlines 的 FSM 引导生成）[20]；工程实践报告显示 schema 约束可将结构类解析失败率降到零，但内容质量仍需独立评测 [21]——项目在应用层做 requiredFieldIds 核对，相当于在没有语法级约束时用「验收器 + 缺字段即 fail」重建同等保证。generate-then-check 两步则处在自验证文献的中心：Self-Refine 证明同一模型兼任生成者/反馈者/修订者可带来收益 [22]；Reflexion 用情景记忆中的言语化反思替代权重更新 [23]；CoVe（Chain-of-Verification）把验证拆成独立问题并控制注意力以避免原答案污染验证过程 [24]。但争议同样明确：Huang 等人证明「内在自修正」（无外部反馈、同一上下文自我检查）在推理任务上常常无效甚至退化 [25]；后续工作表明自验证要起效需要结构化条件（如遮蔽关键条件再验证）[26]。这组证据共同指向：generate-then-check 若想真提效，检查者必须与生成过程隔离——这正是「验证器中立性（验收器不修改、不续写被验收 prompt）」在 CoVe factored 变体中的直接先例 [24]，也是本项目把验收器做成独立中立步骤的理论依据。

**注入防护与元规则管理。** 「轨迹文本非指令」对应间接 prompt injection 文献：Greshake 等人首次系统分析 IPI——嵌入在被检索/被处理数据中的恶意指令可远程操纵 LLM 应用，且危害超出数据泄露（含生态污染与危险内容生成）[27]。把演练轨迹、工具输出等一切「数据性文本」显式声明为非指令，是 IPI 防御中「数据/指令分离」原则的应用；「元规则不进下游 prompt」则缩小了规则泄露与二次注入的攻击面。需要指出：学术文献对「元规则保密」本身的正面效果几乎没有定量证据，这属于平台的纵深防御实践而非已验证结论（研究空白，见对照）。

**温度分档与 prompt 评测。** 温度分档有近两年的直接证据：专门研究 LLM-as-a-Judge 温度设置的工作发现，温度升高时裁判与人类的一致性仅小幅下降、但自一致性（consistency）显著下降、错误率在平稳期后大幅上升 [28]；医学临床推理评分研究则显示低温 + 常规提示的组合取得最高的重测信度（ICC ≈ .87），高温度会拉低部分模型的一致性 [29]。因此「审计/验收 0.2-0.3、判决 0.3、生成 0.7-0.9」的分档与文献方向一致：评测端低温求稳，生成端高温求多样。prompt 版本管理与评测（prompt evals）的学术对应较弱，主要落在工程工具链实践：以固定评测集对 prompt+模型在不同温度/提示样式下做量化对比与回归 [30]——coreHash 锚点与字段冻结的组合可视为此实践的平台化：用内容哈希锚定「含义冻结」，用验收器做回归门槛。

### 文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应字段 | 关联与评注 |
|---|---|---|---|---|
| [16] | Liu, P. et al., 2021/2023, Pre-train, Prompt, and Predict: A Systematic Survey of Prompting Methods in NLP, arXiv:2107.13586 | https://arxiv.org/abs/2107.13586 | system prompt 起草约束、五块结构模板 | prompt 范式的奠基综述；把 prompt 纳入统一数学框架——「起草约束」的学科基础 |
| [17] | Sahoo, P. et al., 2024, A Systematic Survey of Prompt Engineering in Large Language Models: Techniques and Applications, arXiv:2402.07927 | https://arxiv.org/abs/2402.07927 | 字段产出指引、prompt 分类治理 | 41 种技术按应用域系统化；skill-author 字段指引的方法论参照 |
| [18] | Schulhoff, S. et al., 2024, The Prompt Report: A Systematic Survey of Prompt Engineering Techniques, arXiv:2406.06608 | https://arxiv.org/abs/2406.06608 | 五块结构模板、元规则标准化 | 33 术语 + 58 技术的分类体系与最佳实践；「用标准词汇治理 prompt 碎片化」与平台结构模板同向 |
| [19] | Zhou, J. et al., 2023, Instruction-Following Evaluation for Large Language Models (IFEval), arXiv:2311.07911 | https://arxiv.org/abs/2311.07911 | requiredFieldIds 字段核对、字段冻结 | 「可验证指令」：把指令遵循变成程序化检验——必填字段存在性检查的学术原型 |
| [20] | Willard, B.T., Louf, R., 2023, Efficient Guided Generation for Large Language Models（Outlines）, arXiv:2307.09702 | https://arxiv.org/abs/2307.09702 | JSON 可解析性校验、schema 约束 | FSM 引导生成保证输出结构；语法级约束是字段冻结的「硬保证」上界 |
| [21] | GMI Cloud（工程博客）, 2025, Structured Output for LLMs: Constrained Decoding and Parse Failure Rates | https://www.gmicloud.ai/en/blog/structured-output-for-llm-inference-json-schema-enforcement-constrained-decoding-and-parse-failure-rates | JSON 可解析性校验、验收器 pass=false | 实证 schema 约束使结构类解析失败归零；同时警示内容质量需独立于结构保证另行评测 |
| [22] | Madaan, A. et al., 2023, Self-Refine: Iterative Refinement with Self-Feedback, NeurIPS 2023 | https://arxiv.org/abs/2303.17651 | generate-then-check | 同一模型生成+反馈+修订在 7 任务上有效；自验证「乐观派」代表作 |
| [23] | Shinn, N. et al., 2023, Reflexion: Language Agents with Verbal Reinforcement Learning, arXiv:2303.11366（NeurIPS 2023） | https://arxiv.org/abs/2303.11366 | generate-then-check（记忆化反思） | 言语化反思存入情景记忆以改进后续尝试；元技能「从失败 prompt 中学习」的同构物 |
| [24] | Dhuliawala, S. et al., 2024, Chain-of-Verification Reduces Hallucination in Large Language Models, Findings of ACL 2024 | https://aclanthology.org/2024.findings-acl.212.pdf | 验证器中立性、generate-then-check | 把验证拆为独立问题并控制注意力隔离原答案（factored 变体）——「验收器不接触生成过程」的文献先例 |
| [25] | Huang, J. et al., 2024, Large Language Models Cannot Self-Correct Reasoning Yet, ICLR 2024 | https://arxiv.org/abs/2310.01798 | generate-then-check（边界条件） | 无外部反馈的内在自修正常无效甚至退化——论证「中立独立验收器」优于同上下文自检 |
| [26] | 2024, Large Language Models Can Self-Correct with Key Condition Verification, arXiv:2405.14092 | https://www.alphaxiv.org/abs/2405.14092 | 验收器设计（结构化条件） | 自验证起效需要结构化操作（遮蔽关键条件再验证）；支持把验收做成显式字段核对而非自由自评 |
| [27] | Greshake, K. et al., 2023, Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection, arXiv:2302.12173 | https://arxiv.org/abs/2302.12173 | prompt injection 防护（轨迹文本非指令）、元规则不暴露 | IPI 奠基工作：数据中的指令可劫持应用；数据/指令分离与缩小规则暴露面的防御依据 |
| [28] | 2026, The Necessity of Setting Temperature in LLM-as-a-Judge, arXiv 预印本 | https://arxiv.org/html/2603.28304v1 | 温度分档（判决/验收低温） | 温度升高：Agreement 小幅下降、Consistency 显著下降、Error Rate 大幅上升——判决 0.3 口径的直接证据 |
| [29] | 2025, How Model Size, Temperature, and Prompt Style Affect LLM-Human Agreement, AIMECON 2025（ACL） | https://aclanthology.org/2025.aimecon-main.28.pdf | 温度分档（审计 0.2-0.3） | 医学推理评分中低温+常规提示重测信度最高（ICC≈.87），高温拉低一致性 |
| [30] | Promptfoo（工程文档）, 2025, Evaluate LLM Temperature / prompt evals guide | https://www.promptfoo.dev/docs/guides/evaluate-llm-temperature | prompt 版本管理与评测 | 以固定评测集对比不同温度/提示配置并回归验证——coreHash + 字段冻结所对应的开源评测实践 |

### 项目设计与文献的对照

**一致点**
1. generate-then-check 与自验证文献方向吻合：项目把验收做成「独立中立验收器 + 字段冻结」而非同上下文自检，恰好落在 CoVe 的注意力隔离 [24] 与 Huang「内在自修正不足」[25] 两条证据线的交点上；Key Condition Verification 进一步表明结构化验证条件（显式核对项）优于自由自评 [26]。
2. 字段冻结 ≈ 结构保证的应用层等价物：约束解码文献把「结构合法」从概率变成保证 [20]，工程数据支持解析失败可归零 [21]；在无语法级约束的调用路径上，requiredFieldIds 硬门槛（缺字段即 pass=false）以验收器方式重建同类保证，且 IFEval 证明程序化可检验谓词可行 [19]。
3. 温度分档与评测证据一致：评测/判决端低温（一致性 ICC 最高、error rate 低）[28][29]，生成端高温求多样——分档方向与两类研究的结论同向。
4. 轨迹文本非指令是 IPI 文献的标准防御原则 [27]；元规则不暴露进一步缩小规则泄露面，与「最小权限暴露」的工程直觉一致。
5. prompt 工程标准化：五块结构模板与字段产出指引呼应 Prompt Report/Sahoo 综述的「分类 + 标准化词汇」路线 [17][18]。

**张力点**
1. 「验证器中立」≠「模型中立」：CoVe 的隔离只是注意力层（factored 变体）[24]，验收器与作者若是同族/同底座模型，自偏好风险仍在（裁判自增强偏差证据见章一 [8][9]）；文献未提供「中立性」的模型级实现方案，项目需自行补足（如跨模型验收或人审抽样）。
2. generate-then-check 的收益是条件性的：文献警示若无外部信号或结构化条件，自检会退化 [25][26]；「字段冻结 + JSON 可解析」是结构信号，但对语义质量（prompt 是否好）无保证——结构与质量的双重验收在文献中是两回事 [21]。
3. 温度 0.7-0.9 的生成端与一致性目标存在内在张力：高温生成带来的行为多样有利于仿真真实感（章一），却会放大 persona 漂移与审计噪声；文献只分别支持两端，未给出跨档联动的系统研究。
4. 字段冻结的硬门槛 vs prompt 的语义连续性：语义修改常不触发字段变更，coreHash 锚定的「含义冻结」没有学术对应物，属自建机制，需自证其能捕获「含义漂移」。

**风险点**
1. 元规则不暴露的效果无文献背书：IPI 研究表明攻击面随应用集成度增长且难以根除 [27]；「meta-rules 不进下游」是纵深防御之一，不应被视为安全边界，需辅以注入检测与输出过滤（文献中尚无定量防护评估，属研究空白）。
2. 「不承诺平台未提供能力」的幻觉防护只有定性规则：prompt 幻觉（对自身能力的错误声明）在文献中少有专门基准（IFEval 只覆盖可验证格式类指令 [19]），该字段的有效性只能靠验收器回归自证。
3. 验收器被验收对象「说服」的风险：裁判文献记录了 hinting/格式偏好等效应（章一 [8][9]）；验收器读取被验收 prompt 全文时，可能被其中强语气指令带偏判分，中立性约束需要操作化定义（只允许输出固定 schema 的验收报告）。
4. prompt 评测方法学的薄弱层：平台内评测（prompt evals）主要停留在工程工具链实践 [30]，学术上缺少「prompt 版本演进与下游行为漂移」的因果研究；字段冻结 + coreHash 是合理的工程假设，但应记录版本间 A/B 证据以积累内部效度。

---

### 汇总

- 章节一（虚拟学习者仿真与裁判字段）：一句话结论——项目的 personaSeed/摩擦预算/独立裁判/认知判决四个字段簇分别有生成式智能体记忆架构 [1]、error-based training 与 epistemic control [4][7]、LLM-as-judge rubric 化与偏差缓解 [8][9][10][11]、个人认识论与 groundedness [12][14] 四条成熟文献线支撑，主要风险在同源模型自评的效度与行为真实性缺乏外部锚点 [3][15]。
- 章节二（元技能与 prompt 工程字段）：一句话结论——skill-author/skill-compiler 的约束起草、字段冻结与中立验收器可分别锚定在 prompt 工程标准化 [16][17][18]、可验证指令与约束解码 [19][20][21] 及自验证边界证据 [24][25][26] 上，温度分档有直接实证支持 [28][29]，而「元规则不暴露」与「含义冻结/coreHash」目前缺乏学术对应物，属需自证效度的平台自建机制。
- 文献总数：30 篇（章节一 15 篇，章节二 15 篇）；其中 2 处转引/出处待核项已在表内显式标注（MathDial 的 arXiv 编号；Käser & Alexandron 2024 经 [3] 转引）。
