# 文献调研 VL-04：LLM 仿真学习者的「人味（human-likeness）」文献线

- 调查版：2026-11-19（接 `_lit-07-simulation-meta.md` 编号续：[31] 起）
- 检索方法：Tavily 检索 8 次（未用 WebSearch）+ arXiv 摘要页 / Springer / PMC / ACL Anthology 逐篇核实（WebFetch）。
- 引用纪律：所有入表文献均真实出现在检索结果中并附 URL；题名与作者经 arXiv/期刊页面核实的不再标注；期刊名、副题等未能从命中内容确认的项标「（出处待核）」；转引均显式说明。

---

### 补充文献表

| 编号 | 文献（作者, 年份, 题名, 出处） | URL | 对应拟真维度 | 关联与评注 |
|---|---|---|---|---|
| [31] | Jones, C.R., Bergen, B.K., 2024, People cannot distinguish GPT-4 from a human in a Turing test, arXiv:2405.08007 | https://arxiv.org/html/2405.08007v1 | 人味总判据（可检测性校准） | 随机对照双人类图灵测试：GPT-4 过关率 54%（与随机不可区分），人类真人阈值 67%，ELIZA 基线被识别——「像人」有可量化的行为学判据，且默认 LLM 输出「过于整齐」并不天然像人 |
| [32] | Rathi, I.M., Taylor, S., Bergen, B., Jones, C., 2025, GPT-4 is Judged More Human than Humans in Displaced and Inverted Turing Tests, GenAIDetect @ COLING 2025, pp. 96-110 | https://aclanthology.org/2025.genaidetect-1.7.pdf | 人味总判据（prompt 对人味的杠杆） | 同组后续研究：GPT-4.5 加人格化 prompt 后被判为人类的比例达 73%（超过真人），无 prompt 则跌至 36%——「人味」可被 persona prompt 显著调高/调低，是 personaSeed 设计的直接外部证据 |
| [33] | Terčon, L., Dobrovoljc, K., 2025, Linguistic Characteristics of AI-Generated Text: A Survey, arXiv:2510.05136 | https://arxiv.org/pdf/2510.05136 | 语言学层（AI 文本指纹） | 系统综述 AI 文本的语言学特征：更正式/非人称、名词/限定词/介词占比高而形容词/副词少、词汇多样性低、词汇量小、重复短语——即「AI-typedness」线索清单，虚拟学习者需反向规避这些指纹 |
| [34] | Hassan, S.Z., Lison, P., Halvorsen, P., 2024/2025, Enhancing Naturalness in LLM-Generated Utterances through Disfluency Insertion, arXiv:2412.12710 | https://arxiv.org/html/2412.12710v2 | 语言学层（不流畅标记） | 用 LoRA 微调向 LLM 话语中注入 disfluency（犹豫词、填充词、重复），证明不流畅标记可提升话语自然度/拟人感知；「过于流畅」是 LLM 话语不像人的核心破绽之一 |
| [35] | Suresh, A. et al., 2022, The TalkMoves Dataset: K-12 Mathematics Lesson Transcripts Annotated for Teacher and Student Discursive Moves, LREC 2022, pp. 4654-4662 | https://par.nsf.gov/servlets/purl/10387284 | 行为层（真实学生话语分布） | 567 节 K-12 数学课转写、59,874 条真实学生话语，按 accountable talk 理论标注 5 类学生话语动作（making a claim / asking for info / relating to another student 等）——虚拟学习者话语应采样自这类真实学生话语行为分布 |
| [36] | Abdulhai, M., Cheng, R., Clay, D., Althoff, T., Levine, S., Jaques, N., 2025, Consistently Simulating Human Personas with Multi-Turn Reinforcement Learning, NeurIPS 2025（arXiv:2511.00222） | https://arxiv.org/html/2511.00222v1 | 记忆层（一致性-可信度） | 针对 LLM 模拟人类用户（含学生角色）的人设漂移，提出 prompt-to-line / line-to-line / Q&A 三种一致性自动指标并经人标验证，作为奖励做多轮 RL 微调，不一致性降低 55%+；明确指出一致性失败「破坏模拟人类的连贯幻觉、削弱用户信任」——一致性→可信度因果的直接文献 |
| [37] | Liu, Q., Li, L., Švábenský, V., Borchers, C., Khalil, M., 2025/2026, Measuring the Impact of Student Gaming Behaviors on Learner Modeling, LAK '26（arXiv:2512.18659） | https://arxiv.org/html/2512.18659v3 | 心理层（失联行为污染建模） | 用仿真方法量化 gaming the system（试错刷题、hint 滥用、快速点击）对知识追踪（KT）数据与学习者建模的污染——反证虚拟学习者若不复现真实失联行为统计，其产出数据与真人不兼容 |
| [38] | Baker, R.S.J.d., Walonoski, J., Heffernan, N.T., Roll, I., Corbett, A.T., Koedinger, K.R., 2008, Why Students Engage in "Gaming the System" Behavior in Interactive Learning Environments, 期刊论文（Journal of Educational Computing Research，出处待核） | https://pact.cs.cmu.edu/koedinger/pubs/Baker,%20R.,%20Walonoski,%20J.A.,%20Heffernan,%20N.T.,%20Roll,%20I.%20Corbett,%20A.,%20Koedinger,%20K.R..pdf | 心理层（失联动机分布） | 对 gaming 行为的动机研究：学生自述集中在 effort avoidance / 不想读 / 追求即时满足 / 畏惧长 hint 链——虚拟学习者「像人」需复现这类失联动机的行为学分布而非均匀随机犯错 |
| [39] | Aleven, V., McLaren, B.M., Roll, I., Koedinger, K.R., 2004, Toward Tutoring Help Seeking（副题出处待核）, ITS 2004 | http://www.cs.cmu.edu/~aleven/Papers/2004/Aleven_ea_ITS2004_HelpSeeking.pdf | 心理层（求助行为分布） | 实测学生求助行为缺陷分布：hint 滥用 18%（含「点击穿过 hints」33% 后整体 hint abuse 达 37%）、help avoidance 11%，且 hint 滥用与学习增益负相关；Aleven 等 2006 年对 help avoidance / help abuse 的定义经后续文献转引（ERIC EJ1298438）——求助回避/滥用是真实学习者的高频行为特征，虚拟学习者应可按比例复现 |
| [40] | Loyall, A.B., 1997, Believable Agents: Building Interactive Personalities, CMU 博士学位论文 CMU-CS-97-123（Oz Project） | https://www.cs.cmu.edu/Groups/oz/papers/CMU-CS-97-123.pdf | 行为层（believability 经典判据） | 游戏拟真源头文献：可信智能体=人格（personality）、情绪、目标驱动、行为一致且会变化、能从容应对意外；「角色保真/角色漂移」的字段设计可回溯到这套判据 |
| [41] | Bates, J., Loyall, A.B., Reilly, W.S., 1992, Integrating Reactivity, Goals, and Emotion in a Broad Agent, CogSci 1992 | https://escholarship.org/content/qt50g0p7t2/qt50g0p7t2_noSplash_91692713d81551b6d13fb01e3a8c5d93.pdf | 行为层（反应性-目标-情绪整合） | Oz Project 架构论：可信行为需要在同一智能体内整合即时反应性、长期目标与情绪（broad agent），为虚拟学习者「情绪范围 emotionalRange + 目标 seed + 即时反应」并存的设计提供架构原型 |
| [42] | Gnewuch, U., Morana, S., Adam, M.T.P., Maedche, A., 2022, Opposing Effects of Response Time in Human–Chatbot Interaction, Business & Information Systems Engineering 64(6): 773-791 | https://link.springer.com/article/10.1007/s12599-022-00755-x | 节奏层（延迟双刃剑） | 即时回复与延迟回复效果相反且受用户先前 chatbot 经验调节；实践中已有设计者主动给 chatbot 加延迟使其「更像人」（如汉莎航空案例）——回复节奏是「像人」的独立设计变量 |
| [43] | Wang, Y.-L., Lo, C.-W., 2025, The effects of response time on older and young adults' interaction experience with Chatbot, BMC Psychology 13:150 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11846305 | 节奏层（中等延迟最优） | 中等响应延迟增强对话自然度与「类人」感知，过快或过慢都破坏该感知（倒 U 型）；且效应随人群分化（年轻人偏好即时、老年人偏好延迟）——延迟校准需按目标用户群设定 |

---

### 拟真判据综合

把 Lit-07（[1]-[15]）与本补充线（[31]-[43]）合成「虚拟学习者像人的判据清单」，按五层组织：

**1. 语言学层（话语像不像人写的）**
- 判据 1.1：规避 AI 文本指纹——控制正式/非人称风格、名词与介词占比、词汇多样性、短语重复率，使其落在目标人群真实话语的分布内 [33][34]。
- 判据 1.2：允许不流畅——按合理比例注入犹豫词、填充词、口语化、hedging；「过于流畅」本身是可检测的机器线索 [34]（人味感知提升的直接证据），[31][32]（人类判别行为）。
- 判据 1.3：人味可校准而非最大化——用图灵测试式的人类判别率做外部锚点（GPT-4 默认 54% vs 加人格 prompt 73% vs 真人 67%），虚拟学习者的人味应校准到「目标人群 believing 率」而非追求最大欺骗 [31][32]。
- 锚点补充：Lit-07 [2]（语言真实感是模拟学生价值主张）、[13]（CharacterBox 的 Human-Likeness 维度）。

**2. 行为层（话语动作与拟真行为像不像真学生）**
- 判据 2.1：话语动作分布对齐真实学生语料——如 TalkMoves 五类学生话语动作（making a claim / asking for info / relating to another student 等）的相对频率 [35]。
- 判据 2.2： believability 四要素——人格一致、有情绪、目标驱动、会变化（并能从容应对意外），来自 Oz Project 经典判据 [40][41]。
- 判据 2.3：角色保真需对抗长期漂移——与 Lit-07 [13] 的 Character Fidelity/Consistency 评测维度闭环：believability 是源头判据，CharacterBox 类评测是其现代操作化。
- 锚点补充：Lit-07 [2]（行为可适应性）、[4]（epistemic control 优先于流畅度）。

**3. 记忆层（前后一致才能被相信）**
- 判据 3.1：三种一致性可测且应作奖励/审计信号——prompt-to-line（不漂离人设）、line-to-line（不与先前陈述矛盾）、Q&A（信念不自相矛盾）[36]。
- 判据 3.2：一致性→信任的因果链——一致性失败被文献明确记载为削弱用户信任、打破「模拟人类」幻觉 [36]；故记忆一致性不是审美问题而是可信度问题。
- 判据 3.3：记忆架构三件套——记忆流+反思+计划（Lit-07 [1]），私有状态与外显话语解耦以保证可审计（Lit-07 [6]）。
- 锚点补充：Lit-07 [13]（长期动态环境中的 Consistency 维度）。

**4. 心理层（失败模式像不像真学习者）**
- 判据 4.1：复现自我调节失败的行为统计——gaming the system（试错刷题/hint 滥用/快速点击）、求助回避与求助滥用按真实比例复现（help abuse 18%-37%、help avoidance 11%），且动机分布（省力、即时满足、畏惧长 hint 链）而非均匀随机 [38][39]。
- 判据 4.2：失联行为数据与 KT 兼容——虚拟学习者的行为轨迹应能被知识追踪/学习者建模模型正常消费，否则其产出与真实学习分析管线不兼容 [37]。
- 判据 4.3：内部认知状态与外显解耦——完成≠掌握、掌握概率带、误解状态确定性转移（Lit-07 [1][6]），认识论立场四维支撑认知判决（Lit-07 [12]）。
- 锚点补充：Lit-07 [4][5]（epistemic control、能力悖论泄露检测）。

**5. 节奏层（回复时机像不像人在打字）**
- 判据 5.1：延迟呈倒 U 型——中等延迟提升自然度与类人感知，过快（机器感）与过慢（失联感）都减分 [43]。
- 判据 5.2：延迟效应双向且受人群调节——即时/延迟各有正负效应，用户先前 chatbot 经验与年龄群显著调节最优延迟点 [42][43]，虚拟学习者的延迟参数应随 persona 目标人群设定。
- 判据 5.3：主动加延迟是「像人」的合法设计变量——业界已有刻意延迟使 bot 更像人的先例 [42]。
- 锚点补充：Lit-07 [2]（行为可适应性含节奏维度）。

---

### 与 Lit-07 的差异说明

- **不重复**：Lit-07 的仿真文献线覆盖生成式 agent 架构、模拟学生综述与效度批判、裁判字段、认识论与 groundedness；本补充线 13 篇（[31]-[43]）全部落在其空白处：图灵测试与人类判别行为 [31][32]、AI 文本语言学指纹 [33]、disfluency 与话语自然度 [34]、真实课堂学生话语语料 [35]、模拟用户一致性-信任 [36]、失联行为统计与 KT 兼容 [37][38][39]、游戏 AI believability 源头 [40][41]、回复延迟拟人效应 [42][43]。
- **方向 1 超配说明**：补查方向 1（人味语言学标记 + 图灵测试）按任务上限 1-3 篇执行，因该方向是本报告核心且语言学层拆分为「AI 指纹规避」与「不流畅注入」两条独立证据链，故保留 4 篇（[31]-[34]），其余五个方向各 1-2 篇。
- **新增判据层级**：Lit-07 无「节奏层」文献，本线补入 [42][43] 使五层判据闭合；「心理层」在 Lit-07 中主要是 epistemic control 视角，本线补入 EDM/LAK 传统中的失联行为分布证据（gaming/help avoidance）作为行为统计锚点。
- **待核与转引**：Baker 等 2008 的期刊名（Journal of Educational Computing Research）为常见归属但未在命中内容中确认，标出处待核；Aleven 等 2004 ITS 论文的副题未在命中内容中完整显示，标待核，Aleven 等 2006 的 help avoidance/help abuse 定义经 ERIC EJ1298438 转引；TalkMoves 的 arXiv 编号在二手引用中被截断（arXiv:2204.096...），故以 LREC 2022 正式版（NSF PAR 存档）入表。
- **关键外部结论**：人味不是「更流畅更聪明」，而是「分布对齐 + 可控破绽」——默认 LLM 话语因过于整齐而不像人 [31][33][34]，加人格 prompt 可显著提升人类误判率 [32]，一致性失败直接摧毁可信度 [36]，失联行为缺失反而暴露仿真身份 [37]-[39]，节奏过快是机器感来源 [42][43]。
