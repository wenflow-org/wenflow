# 工程调研 VL-06：数字人/智能体模拟类项目的工程机制对照

- 调查版：2026-11-19。定位：与 `_vl-04-humanlikeness-lit.md`（文献判据线）互补——本篇只做**工程实现层对照**，不重复 Stanford Generative Agents 文献底稿（AI Town 一行仅从工程实现角度覆盖）。
- 检索方法：Tavily 检索 11 次（未用 WebSearch，不重复查询）+ WebFetch 逐篇核实一手源（arXiv 2310.08560 / 2504.19413、Letta 官方 docs 与 blog、a16z-infra/ai-town 与 kimjammer/Neuro 的 GitHub README、lin-guanguo 社区研究笔记）。
- 引用纪律：正文均附 URL；仅由搜索摘要支撑、未读到正文的细节在来源表中标注核实状态。

---

### 工程机制目录表

| # | 项目 | 机制 | 实现要点 | 解决的问题 | 对虚拟学习者可迁移性 | 迁移方式 |
|---|---|---|---|---|---|---|
| 1 | MemGPT（arXiv:2310.08560） | 虚拟上下文分层（OS 范式） | main context（窗口内：系统指令+近期消息+可编辑记忆区）/ external context（窗口外：recall storage 对话史 + archival storage 归档），LLM 经 function call 在快慢记忆间搬运 | 固定窗口内跑无限期交互，信息按需换入换出 | **H** | 平台「策展区 + storyHistory 归档」即同构分层；关键是让检索注入成为逐轮常规动作而非一次性策展 |
| 2 | MemGPT / Letta | self-editing memory | agent 用记忆工具自己改写 main context 里的 memory block（Letta docs：blocks 是「可被 agent 经工具编辑的字符串上下文」，可 pin 进 system prompt；具体工具名如 core_memory_append/replace，出处待核） | 记忆更新不依赖外部脚本重写 prompt，agent 对「我记了什么」有主动权 | **H** | 虚拟学习者可在会话内自报「我记得你上次说过 X」并更新自己的记忆块——这正是「回忆起对方」这类拟真行为的实现载体 |
| 3 | Letta | sleep-time compute（异步记忆重组） | 双 agent：主 agent **无** core memory 编辑权；sleep-time agent 持编辑权，在空闲期把 raw context 重写为 learned context（arXiv:2504.13171） | 记忆管理异步化，避免边聊边改导致的增量式混乱；持续重写防记忆腐烂 | **M** | 会话间隙（session-resumed 之前）异步跑一轮 memory-curate，而不是每次会话内打断节奏做策展 |
| 4 | Letta | memory block 挂载与共享 | block 可 attach/detach、跨 agent 共享（shared blocks）、开发者可经 API 直接改 | 人格/事实与提示词解耦成结构化单元，可版本化、可审计 | **H** | personaSeed/story 关键事实做成 pinned block 结构化注入，比提示词里一段自述文本更难被对话冲刷（见对照④） |
| 5 | Mem0（arXiv:2504.19413） | 抽取-更新两阶段记忆管道 | extraction（滚动摘要 S + 最近 m=10 条消息 → 候选 fact 集）→ update（向量检索 top-s=10 相似记忆，LLM 经 tool call 逐条判 ADD / UPDATE / DELETE / NOOP） | 跨会话记忆保持一致、无重复无矛盾（"住柏林→搬巴黎"自动更新而非两条并存） | **H** | storyHistory 追加链改成 fact 级增量操作：新经历先与既有记忆比对冲突再落库，直接压「记忆经历虚增/重复讲述」 |
| 6 | Mem0g（Mem0 图变体） | 过时关系标记失效而非删除 | 实体节点+关系边；冲突检测后把过时边标 invalid，保留历史供时序推理；双路检索（实体锚定子图 / 语义三元组） | 「以前知道但现已过时」不丢失；回答"当时 vs 现在" | **M** | 记忆四态里的「遗忘/过期」态可借：过期≠删除，保留「当时不知道/已忘了」的轨迹供审计 |
| 7 | Zep / Graphiti（arXiv:2501.13956） | 双时间轴（bi-temporal）知识图谱 | 每条边带 t_valid / t_invalid：事件时间（事情何时真实发生）与摄入时间（系统何时得知）分离；新边经 LLM 与语义相关旧边比对矛盾，矛盾则置 t_invalid | 时间感知记忆：可答"当时真 vs 现在真"；事实失效有明确边界 | **H** | storyHistory 每条记录双时间戳：story 内日期 vs 演练会话日期；「到期复习点」变成带有效期窗口的记忆条目 |
| 8 | LangMem / LangChain | 记忆三分类 + 双形成时机 | semantic（事实，常做每用户一份持续更新的画像文档）/ episodic（经历，常蒸馏成 few-shot 例）/ procedural（行为，由反馈重写系统提示实现）；形成时机分 hot path（会话内即时）与 background（后台批处理） | 不同留存规律的记忆分流管理；行为变化可落地为 prompt 重写 | **M** | personaSeed≈semantic 画像文档、story≈episodic、【策略】选择规律≈procedural；friction 校准可走「从复盘反馈重写策略 prompt」的 procedural 路径 |
| 9 | 语音数字人栈（Medium/EdgeAI/Deepgram 等工程文章） | barge-in 打断管线 | 说话全程 VAD 持续监听；确认用户插话 → 发 cancel 事件级联终止：拆掉在播 TTS + **同时取消正在生成的 LLM token**；prompt 只保留 text_spoken、丢弃 text_remaining | 用户插话后 agent 不再"说完没人听的话"，且能接住半截语境 | **H** | 文字版直译：教师中途打断学习者时，学习者丢弃未发话轮、保留已说部分并在下轮吸收被打断的语境——治「离场」与话轮错位 |
| 10 | 语音数字人栈 | 打断状态机 + backchannel | turn detection（何时开始/结束说话）与 interruption handling（正在说时收到信号怎么办）分离建模；快速连续打断靠显式状态机防管线不一致；听者反馈词（backchannel）单独通道 | 打断不是布尔开关而是状态迁移；抢话/接话节奏可控 | **M** | 演练中教师连续纠错=快速连续打断，学习者侧需要"承认打断→部分收回→改口"的迁移状态而非硬切 |
| 11 | 交互数字人（MDPI Sensors 25(16):5117） | 情绪状态机驱动 AU 级表情 | 管线：话语语义解析 → 多模态情绪识别（ResNet18/AffectNet）→ Unreal 中按**状态机机制**合成基础情绪的 Action Unit 运动曲线，平滑过渡表情 | 情绪是驱动连续表现参数的状态，不是事后贴的标签 | **M** | 平台 emotion 枚举加「进入-保持-衰减」三段与强度系数，把情绪映射为话语表现参数（句长、迟疑词、标点密度）而非仅存档 |
| 12 | DigiHuman（DergiPark） | 基本情绪→表情映射 + 口型同步 | 预配置 6 种基本情绪（joy/sadness/anger/fear/surprise/disgust）到面部肌肉动作的映射，对话中按情绪码驱动；唇形对齐音素 | 有限情绪集也能产出连贯可见的表现 | **L** | 印证平台用小枚举是行业常规做法；差距在「枚举是否有下游表现参数」而非枚举本身大小 |
| 13 | Inworld AI | Character Brain / World Model / Safety Layer 三层 | Character Brain：OCEAN 大五+领域特征、backstory、关系模型；World Model：游戏状态上下文；Safety Layer：内容审核（dirty words/bias/toxicity 控制"on brand"） | 人格、情境、安全解耦分层，各自可独立配置 | **M** | disclosurePlan（什么可说/不可说）对应 Inworld 的 personal knowledge「应知/不应知」边界；referee 可对标 Safety Layer 的独立拦截层 |
| 14 | Inworld AI | 情绪挂接目标与触发器 | 情绪映射到 goals + 自定义 triggers；goals & actions 系统支持**瞬态动机链**（当前动机完成→切下一个），action 由动机激活 + intent 识别触发 | 情绪/行为有因果来源（被什么触发），非每轮自由发挥 | **H** | 【策略】枚举改成「当前动机 + 触发条件 → 激活策略」的产出：错误被指出触发「防御」，连续受挫触发「退缩」，减少策略选择的随机漂移与重复 |
| 15 | Neuro-sama（官方，社区研究笔记） | 人格写权重、情境写提示词 | 人格经微调（疑 LoRA）进权重，系统提示词只注入情境（当前游戏/对话对象）；训练数据人工策展；部署→收集→再训练闭环；游戏输出经 Neuro SDK schema 约束为合法动作集 | 长期直播人格稳定；输出动作空间受控 | **L** | 平台不做训练，但「人格与情境分离装填」可直接借：personaSeed 常驻，情境（今日课程/当前挫败）按轮注入 |
| 16 | kimjammer/Neuro（Neuro-sama 开源复刻） | 模块化优先级 prompt 注入 | 全程序单 signals 对象共享状态；每模块可返回 Injection（文本+优先级），按优先级低→高排序拼接进 prompt；~1000 token 背景故事+示例对话；人格靠提示词即可塑形，但发现「基础模型顽固抗拒某些行为」 | 多注入源不打架；人格可提示词化但有天花板 | **H** | personaSeed/story/disclosurePlan/情绪等注入源统一为「带优先级的注入项排序协议」，锚定项优先级最高且放 prompt 末位（近因位）——防身份漂移与泄露的工程化装填 |
| 17 | airi（开源 AI VTuber） | 浏览器内分层记忆 | 短期=浏览器会话上下文；长期=DuckDB WASM + PGVector 语义检索；Memory Alaya 系统在研 | 轻量端侧长期记忆 | **L** | 架构参考：演练端若做本地化记忆，可按会话内存/持久库两层拆 |
| 18 | AI Town（a16z-infra + Convex） | 常驻世界生命周期管理 | Convex 一个后端兼游戏引擎+数据库+向量检索；cron「stop inactive worlds」：无浏览器 5 分钟自动暂停、加载即恢复；testing:stop/resume/kick/archive/wipeAllTables 命令显式管理引擎与 agent 生命周期 | 长时模拟可暂停可恢复，状态不丢 | **M** | session-resumed 对标 resume/kick 语义：恢复时显式交代「暂停了多久」（结合双时间轴），而非假装无缝继续 |
| 19 | AI Town | 记忆检索预算常数 | `NUM_MEMORIES_TO_SEARCH` 控制每次对话检索注入的历史记忆条数；记忆以 embedding 存储（mxbai-embed-large），换模型须清库重建（维度不匹配） | 注入记忆量可调、可预算，防 prompt 膨胀 | **H** | 会话恢复/隔日续演时按预算注入「上次回顾」检索条目——防恢复后失忆（身份漂移）也防同一事反复讲（重复） |
| 20 | 中土世界 Nemesis 系统（Monolith/WB，已专利） | NPC 记忆外显化+社会演化 | NPC 记住与玩家的过往遭遇：烧伤→下回带伤疤且对话变化；个体有名字/称号/演化的性格，嵌入反应式社会层级；每次重逢基于记忆推进新剧情 | 记忆不留在内部数据里，而是固化为**玩家可见的具体痕迹** | **H** | 学习者经历固化为外显痕迹（"上次你把变号忘了，这次我先检查符号"），既是记忆一致性的展示也是反重复素材 |

---

### 对照发现

#### ① 记忆架构：策展式 vs 分层 OS / 管道式

**平台现状**：memory-curate 是「LLM 一次性策展」——一次产出长期记忆、到期复习点、具身细节、主观记忆（完成≠掌握），记忆四态人工/批量标注状态流转；storyHistory 按「生活史追加链」累积。

**外部做法**：三条路线。(a) MemGPT/Letta 分层 OS：会话内 agent 用工具自己改 core memory block，历史逐出窗口但可经 recall/archival 检索回来（[1][2]，https://arxiv.org/abs/2310.08560 、https://docs.letta.com/guides/agents/memory ）；(b) Mem0 管道式：每轮消息对触发「抽取→与 top-10 相似记忆比对→ADD/UPDATE/DELETE/NOOP」的 fact 级判操作（https://arxiv.org/html/2504.19413v1 ），LOCOMO 上检索 token 1764 vs 全上下文 26031、p95 延迟降 91%；(c) Zep 双时间轴图谱：矛盾边置 t_invalid 而非删除（https://arxiv.org/html/2501.13956v1 ）。三者共识：**记忆维护是高频小步操作，不是低频整篇重写**。Letta 更进一步把记忆重组挪到空闲期的 sleep-time agent（主 agent 无记忆编辑权），依据是「边聊边改记忆更慢更不可靠」（https://www.letta.com/blog/sleep-time-compute ）。

**可借鉴点**：
1. 把 memory-curate 的产出粒度从「整篇策展文本」降到「fact 级条目」，追加前强制做一次与既有记忆的冲突比对（Mem0 的 ADD/UPDATE/DELETE/NOOP 判定），storyHistory 链天然是 episodic 流水，冲突消解直接压「重复讲述」与「经历虚增」。
2. 「一次性策展」的时间点从会话内挪到会话间隙（sleep-time 思路），策展产物在下次 session-resumed 时作为 learned context 装入。
3. 记忆四态的状态机可对齐 Zep 语义：过期/遗忘是 `t_invalid` 标记而非物理删除，保留「当时不知道/已遗忘」的历史轨迹供 actor-audit 回查。
4. 具身细节/主观记忆这类策展产物按 Letta block 化：结构化条目、pin 进上下文、可被学习者自己在会话中引用（self-editing memory 的正向用法）。

#### ② 情绪与状态机：枚举标签 vs 连续状态驱动表现

**平台现状**：emotion 枚举 + 【策略】枚举，逐轮「打标签」式选择；标签本身不驱动表现参数。

**外部做法**：数字人栈把情绪做成**状态机输出连续表现参数**：语义解析→情绪识别→AU 运动曲线状态机合成表情，情绪之间有平滑过渡（https://www.mdpi.com/1424-8220/25/16/5117 ）；小枚举（6 基本情绪）是行业常规，但枚举必有下游表现映射（口型/表情/语调，https://dergipark.org.tr/en/download/article-file/3160685 ）。Inworld 把情绪挂到因果系统：情绪映射到 goals + 自定义 triggers，goals & actions 支持「瞬态动机链」（当前动机完成即切下一个），行为由动机激活 + intent 识别触发（https://techcrunch.com/2023/08/02/inworld-a-generative-ai-platform-for-creating-npcs-lands-fresh-investment 、https://voicesofvr.com/1264-inworld-ai-for-dynamic-npc-characters-with-knowledge-memory-robust-narrative-controls ）。语音栈把「对话控制权」也状态机化：打断是显式状态迁移，快速连续打断须靠状态机防管线不一致（https://medium.com/@abhi.pandey03/barge-in-and-full-duplex-the-architecture-that-makes-voice-agents-feel-human-48ef1b7b7fa6 ）。

**可借鉴点**：
1. emotion 枚举保留小集合（DigiHuman 印证可行），但每态补「进入条件 / 保持 / 衰减退出 + 强度系数」，并映射到**话语层表现参数**（句子变短、迟疑词增多、句末标点变化）——文字数字人的「表情」就是文本形态。
2. 【策略】枚举改造为 Inworld 式「动机+触发器→激活」：错误被当场指出→防御策略激活；同类错误二犯→退缩/自嘲激活。策略来源有因果，既降重复又降随机漂移。
3. 定义文字版 barge-in 协议（见迁移清单 H-4）：被打断时学习者「丢弃 text_remaining、保留 text_spoken、下轮吸收打断语境」，把平台已知「离场」失真的一个子类（话轮被截断后的错位）变成显式状态迁移。

#### ③ 时间与节奏：日期模拟 vs 时间感知记忆 / 回复延迟工程

**平台现状**：日期模拟提供 story 内时间感；storyHistory 追加链记录生活史但未见「每条记录何时被系统得知」的双时间轴；会话恢复（session-resumed）后时间跳跃的处理待明确。

**外部做法**：Zep 每条事实双时间戳（事件时间 vs 摄入时间）+ 有效期窗口，可回答「当时真 vs 现在真」（https://arxiv.org/html/2501.13956v1 、https://www.getzep.com/ai-agents/temporal-knowledge-graph ）；Mem0 用工程指标证明记忆检索必须做成本控制（检索 token 与延迟可量化压缩，https://arxiv.org/html/2504.19413v1 ）；AI Town 用「无浏览器 5 分钟自动暂停、加载即恢复」处理常驻模拟的时间断点（https://github.com/a16z-infra/ai-town ）。回复延迟的人类学判据（倒 U 型、人群调节）已在 `_vl-04` [42][43] 覆盖，此处不重复——本篇补充的是**工程侧**：延迟不是一个常数而是可调的节奏策略变量（语音栈按 VAD/flush/合成排队分层控制）。

**可借鉴点**：
1. storyHistory 每条记录双时间戳：story 内日期 + 演练会话日期。「到期复习点」顺势升级为带有效期窗口的记忆条目（t_valid → t_invalid）。
2. 时间感知检索：隔日续演时检索按 story 时间过滤（"上周发生" vs "三个月前发生"决定回忆的确定性与模糊度），防「把策展文本当亲历回忆」的记忆经历虚增。
3. session-resumed 对标 AI Town：恢复是显式事件——先交代「距上次隔了多久」再续演，时间跳跃本身就是拟真素材（"上次聊到一半我赶着去自习"）。
4. 回复节奏做成 persona 级参数：不同 personaSeed 配不同打字节奏分布（快/慢/犹豫后长段），与 VL-04 的延迟倒 U 判据对接。

#### ④ 人格漂移的生产级对策：锚定 / 审计 / 记忆回放

**平台现状**：personaSeed 锚定 + actor-audit 事后审计 + referee 裁判 + epistemic-grounding 认知判决——审计与裁判齐备，但锚定主要靠提示词装填。

**外部做法**：三条生产线级经验。(a) Neuro-sama 官方：人格写权重（微调）、提示词只管情境，训练数据人工策展，部署→收集→再训练闭环；复刻社区反向验证「纯提示词人格有天花板——基础模型顽固抗拒某些行为，明确提示也无效」（https://lin-guanguo.github.io/llm-memory-research/neuro-sama.research 、https://github.com/kimjammer/Neuro ）。(b) Nemesis 系统：记忆固化为**外显具体痕迹**（伤疤、称号、对话变化），跨遭遇一致性由数据结构保证而非靠 prompt 提醒（https://medium.com/@piqulsky/nemesis-system-as-a-tool-for-immersion-and-believability-2a986eea9786 ）。(c) Letta：sleep-time agent 持续重写 memory block 防「记忆腐烂」，且主/辅 agent 编辑权分离——记忆修订可审计。另有观众侧证据：AI VTuber 粉丝把「一致性」本身当作真实性来源（"技术稳定性而非真人经验"），一致人格即产品价值（https://arxiv.org/html/2509.10427v1 ）。

**可借鉴点**：
1. 锚定从「文本自述」升级为「结构化 pinned block」：personaSeed 核心事实 + story 不可变锚点做成高优先级注入项，固定拼装位置（kimjammer 的优先级注入协议），不随对话轮冲刷。
2. audit 闭环对齐 Neuro 的 retrain 闭环：actor-audit 抓到的漂移案例不应只留档，应回流为 personaSeed 版本修订（v2 画像）或 memory-curate 规则修订——漂移对策是迭代工程而非一次性设定。
3. 记忆回放作为恢复协议：session-resumed 时按预算（AI Town 的 NUM_MEMORIES_TO_SEARCH 模式）注入上次会话的关键记忆条目，恢复后学习者的第一轮反应须引用回放内容——同时治「恢复后失忆/身份漂移」与「同一话题反复开讲」。
4. Nemesis 式外显痕迹：把关键学习经历固化成学习者日后可主动引用的具体事实（"上次我在这卡住过"），使记忆一致性**可见、可审计**，也天然是反重复素材。

---

### 迁移清单

**H（高优先，直接压已知失真模式）**

| # | 迁移项 | 来源机制 | 关联失真模式 | 落点 |
|---|---|---|---|---|
| H-1 | memory-curate 改 fact 级增量管道：追加前强制冲突比对（ADD/UPDATE/DELETE/NOOP 判定） | Mem0 两阶段管道 | 记忆经历虚增、重复 | memory-curate + storyHistory |
| H-2 | storyHistory 双时间轴 + 有效期窗口（story 时间 vs 会话时间；过期标记 t_invalid 不删除） | Zep bi-temporal | 记忆经历虚增、时间感错乱 | storyHistory + 记忆四态 |
| H-3 | personaSeed/story 锚点 block 化：统一「优先级注入协议」，锚定项固定高优先级+固定拼装位 | kimjammer/Neuro 优先级注入 + Letta pinned block | 身份漂移、泄露 | persona 装填层 |
| H-4 | 文字版 barge-in 打断协议：被打断时丢弃未发话轮、保留已说部分、下轮显式吸收打断语境 | 语音栈 cancel 事件级联 | 离场、节奏 | 会话引擎话轮管理 |
| H-5 | 恢复时按预算注入「上次回顾」并要求首轮引用 | AI Town NUM_MEMORIES_TO_SEARCH + Nemesis 回放 | 重复、身份漂移（恢复后失忆） | session-resumed |

**M（中优先，提质项）**

| # | 迁移项 | 来源机制 | 关联失真模式 | 落点 |
|---|---|---|---|---|
| M-1 | emotion 态加进入/保持/衰减+强度，映射话语表现参数（句长、迟疑词、标点密度） | MDPI 情绪状态机驱动 AU | 节奏、重复（情绪表达单一） | emotion 枚举 |
| M-2 | 【策略】改「动机+触发器→激活」的因果产出（防御/退缩由事件触发） | Inworld goals & triggers | 重复、节奏（策略切换突兀） | 【策略】枚举 |
| M-3 | 策展时机挪到会话间隙异步执行（sleep-time 模式），恢复时装入 learned context | Letta sleep-time compute | 记忆经历虚增（记忆腐烂） | memory-curate 调度 |
| M-4 | audit 案例回流机制：漂移案例触发 personaSeed 版本修订/策展规则修订 | Neuro 部署→收集→再训练闭环 | 身份漂移、误诊 | actor-audit 闭环 |
| M-5 | 经历外显化：关键学习史固化为你可主动引用的具体痕迹 | Nemesis 伤疤/对话变化 | 记忆经历虚增、身份漂移 | storyHistory 展示层 |
| M-6 | 会话生命周期显式化：stop/resume/kick/archive 语义 + 恢复先交代时间跳跃 | AI Town 生命周期命令 | 离场 | session 管理 |
| M-7 | 快速连续纠错的「部分收回-改口」迁移状态 | 打断状态机（快速打断防不一致） | 离场、节奏 | 会话引擎 |
| M-8 | friction 校准走 procedural 路径：从复盘反馈重写策略 prompt | LangMem procedural memory | 误诊 | friction 校准 |

**L（低优先，参考/远期）**

| # | 迁移项 | 来源机制 | 关联失真模式 | 说明 |
|---|---|---|---|---|
| L-1 | 权重级人格微调（LoRA）+ 人格/情境分离装填 | Neuro-sama 官方 | 身份漂移 | 成本高，提示词工程层面先做 H-3 |
| L-2 | 记忆图化（实体-关系 + 过时边标 invalid） | Mem0g | 记忆经历虚增 | fact 管道成熟后的升级项 |
| L-3 | 侧端分层记忆（会话内存/持久库两拆） | airi DuckDB+PGVector | — | 架构参考 |
| L-4 | backchannel（听者反馈词）独立通道 | 语音栈 backchannel | 节奏 | 教师侧「嗯/对」式插话拟真 |

---

### 资料来源表

| # | 名称 | URL | 核实状态 |
|---|---|---|---|
| 1 | MemGPT: Towards LLMs as Operating Systems（arXiv:2310.08560 摘要页） | https://arxiv.org/abs/2310.08560 | 已读（摘要：虚拟上下文管理、分层记忆、interrupts 管控流） |
| 2 | MemGPT 机制解读（Lacuna/Tiptree） | https://lacuna.tiptreesystems.com/work/memgpt-towards-llms-as-operating-systems/wrk_16899ad113c43bd3f523a20ed19d1412 | 搜索摘要（Main Context=RAM / External Context=disk 术语） |
| 3 | MemX Glossary: MemGPT Explained | https://memx.app/glossary/memgpt | 搜索摘要（main/external context 构成） |
| 4 | Letta docs: Introduction to Stateful Agents / Memory blocks | https://docs.letta.com/guides/agents/memory | 已读正文（blocks 可编辑可共享可 pin；core memory；compaction/eviction）。注：core_memory_append 等具体工具名本页未列，出处待核 |
| 5 | Letta blog: Sleep-time Compute | https://www.letta.com/blog/sleep-time-compute | 已读正文（双 agent 架构、编辑权分离；论文 arXiv:2504.13171） |
| 6 | Mem0 论文（arXiv:2504.19413 HTML 版） | https://arxiv.org/html/2504.19413v1 | 已读正文（extraction/update 两阶段、ADD/UPDATE/DELETE/NOOP、Mem0g、LOCOMO 数字；注意 Mem0 对 Zep 对比数字系自家评测） |
| 7 | mem0ai/mem0 GitHub README | https://github.com/mem0ai/mem0 | 搜索摘要（ADD-only 单遍模式、实体链接、多信号检索——2025 后新特性） |
| 8 | Zep: A Temporal Knowledge Graph Architecture for Agent Memory（arXiv:2501.13956） | https://arxiv.org/html/2501.13956v1 | 搜索摘要（LLM 边矛盾识别与 t_invalid 失效） |
| 9 | Zep 官方：What Is a Temporal Knowledge Graph | https://www.getzep.com/ai-agents/temporal-knowledge-graph | 搜索摘要（bi-temporal 边、事实失效、episode 溯源） |
| 10 | Neo4j blog: Graphiti Knowledge Graph Memory | https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory | 搜索摘要（t_valid/t_invalid、混合检索、失效不丢弃） |
| 11 | Graphlit 对比页（Zep/Graphlit、LangMem/Graphlit） | https://www.graphlit.com/vs/zep 、https://www.graphlit.com/vs/langmem | 搜索摘要（事件时间 vs 摄入时间；LangMem 三类记忆+形成时机）——厂商对比页，立场有偏 |
| 12 | LangChain blog: LangMem SDK launch | https://www.langchain.com/blog/langmem-sdk-launch | 搜索摘要（semantic/episodic/procedural 定义） |
| 13 | LangChain docs: Memory overview | https://docs.langchain.com/oss/python/concepts/memory | 搜索摘要（三类记忆对照表） |
| 14 | Medium: Barge-In and Full-Duplex（abhi.pandey03） | https://medium.com/@abhi.pandey03/barge-in-and-full-duplex-the-architecture-that-makes-voice-agents-feel-human-48ef1b7b7fa6 | 搜索摘要（VAD 全程监听、快速打断状态机、partial context） |
| 15 | EdgeAI: Barge-in and interruption handling | https://www.runedge.ai/blog/barge-in-interruption-handling-on-device-voice | 搜索摘要（cancel 事件级联终止 TTS+LLM 生成） |
| 16 | Deepgram: Voice agent architecture STT/LLM/TTS | https://deepgram.com/blog/voice-agent-architecture-stt-llm-tts-pipeline-design | 搜索摘要（Interrupt 保模型状态、保留 text_spoken 丢弃 text_remaining） |
| 17 | Quantum Automations: VAD Settings | https://quantumautomations.ai/blog/voice-agent-barge-in-handling.html | 搜索摘要（barge-in 增 8-12% LLM token 成本） |
| 18 | Hamming AI: Voice Agent Interruption Handling Runbook | https://hamming.ai/resources/voice-agent-interruption-handling-runbook | 搜索摘要（turn detection 与 interruption handling 分离、backchannel） |
| 19 | MDPI Sensors 25(16):5117：交互数字人上下文敏感表情 | https://www.mdpi.com/1424-8220/25/16/5117 | 搜索摘要（ResNet18/AffectNet→AU 曲线→Unreal 状态机合成） |
| 20 | DigiHuman: A Conversational Digital Human with Facial Expressions（DergiPark） | https://dergipark.org.tr/en/download/article-file/3160685 | 搜索摘要（6 基本情绪映射、口型同步） |
| 21 | TechCrunch: Inworld AI 平台报道 | https://techcrunch.com/2023/08/02/inworld-a-generative-ai-platform-for-creating-npcs-lands-fresh-investment | 搜索摘要（情绪映射 goals+triggers、personal knowledge 应知/不应知、safety on brand） |
| 22 | Voices of VR #1264：Inworld 技术访谈 | https://voicesofvr.com/1264-inworld-ai-for-dynamic-npc-characters-with-knowledge-memory-robust-narrative-controls | 搜索摘要（goals & actions 瞬态动机链、intent 识别） |
| 23 | IJETCSIT：Generative AI for Dynamic NPC Behavior（含 Inworld 分层架构描述） | https://ijetcsit.org/index.php/ijetcsit/article/download/743/676 | 搜索摘要（Character Brain/World Model/Safety Layer、OCEAN）——二手描述，待与 Inworld 官方 docs 复核 |
| 24 | lin-guanguo: Neuro-sama 工程研究笔记 | https://lin-guanguo.github.io/llm-memory-research/neuro-sama.research | 已读正文（官方人格入权重/情境入提示词、Neuro SDK、记忆挑战、复刻对比；社区研究笔记，官方细节部分未经 Vedal 确认） |
| 25 | kimjammer/Neuro GitHub README | https://github.com/kimjammer/Neuro | 已读正文（signals 单例、优先级注入、长期记忆自动生成跨重启持久、blacklist 过滤） |
| 26 | Neuro-sama - Wikipedia | https://en.wikipedia.org/wiki/Neuro-sama | 搜索摘要（基本事实：Vedal、LLM+TTS+Live2D） |
| 27 | arXiv:2509.10427：My Favorite Streamer is an LLM（AI VTuber 粉丝研究） | https://arxiv.org/html/2509.10427v1 | 搜索摘要（一致性=真实性来源：技术稳定性而非真人经验） |
| 28 | a16z-infra/ai-town GitHub README | https://github.com/a16z-infra/ai-town | 已读正文（cron 停闲置世界、testing:stop/resume/kick/archive、NUM_MEMORIES_TO_SEARCH、embedding 维度约束） |
| 29 | Convex.dev: AI Town 示例页 | https://www.convex.dev/examples/ai-town | 搜索摘要（引擎+数据库+向量检索合一的描述） |
| 30 | a16z 播客文字稿：Why a16z Built a Town for AI People | https://www.cognitiverevolution.ai/why-a16z-built-a-town-for-ai-people | 搜索摘要（源自 Generative Agents 记忆结构的工程化背景） |
| 31 | Medium: Nemesis System as a tool for immersion and believability（piqulsky，专利分析） | https://medium.com/@piqulsky/nemesis-system-as-a-tool-for-immersion-and-believability-2a986eea9786 | 搜索摘要（WB 专利、既往遭遇改变特质与对话） |
| 32 | Shokoladny: Le système Nemesis | https://shokoladny.io/en/2026/06/26/systeme-nemesis-ombre-du-mordor | 搜索摘要（记忆外显：伤疤/对话适应/演化人格/社会层级） |

---

### 与平台机制的对照速记（收尾）

- **memory-curate ↔ Mem0/Letta**：一次策展 → fact 级增量 + 异步重组；策展产物 block 化。
- **storyHistory 追加链 ↔ Zep/Mem0g**：追加 → 双时间轴追加 + 冲突消解。
- **记忆四态 ↔ t_valid/t_invalid**：状态流转可对齐失效标记语义，过期不删除。
- **emotion/【策略】枚举 ↔ 状态机/触发器**：标签 → 有进入/衰减的状态 + 有因果来源的策略激活。
- **日期模拟 ↔ 双时间轴**：story 时间感 → story 时间 + 会话时间分离记录。
- **actor-audit ↔ Neuro retrain 闭环 / Letta 编辑权分离**：审计 → 修订回流 + 记忆编辑权独立。
- **session-resumed ↔ AI Town 生命周期**：恢复 → 显式生命周期事件 + 回放预算注入。
- **referee/disclosurePlan ↔ Inworld Safety Layer / personal knowledge**：裁判 → 独立拦截层 + 应知/不应知边界。
