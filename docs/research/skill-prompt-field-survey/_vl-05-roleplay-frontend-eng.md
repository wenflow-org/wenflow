# 工程调研 VL-05：外部角色扮演项目的前端工程机制对照（虚拟学习者改进调研）

- 调查版：2026-11-19（VL 系列第 5 篇，接 `_vl-04-humanlikeness-lit.md` 文献线之后的**工程机制对照**线：不看学术文献，看「外面的角色扮演产品怎么解决同类工程问题」）。
- 检索方法：Tavily 检索 12 次（未用 WebSearch）+ 官方文档 WebFetch 逐页核读 13 页成功（docs.sillytavern.app 8 页、docs.novelai.net、help.aidungeon.com、support.character.ai、github.com/kwaroran/RisuAI 仓库与 wiki 各页）；另有知乎 1 页 403（以命中摘要引用并标注）、2 个 URL 404 后换正确路径重试成功。
- 引用纪律：凡经官方文档正文核实的机制直接陈述并附 URL；仅来自搜索命中摘要、未读到正文的标（出处待核）；二手博客给出的具体数值（如 ST 默认 25% 预算）注明为二手来源。

## 对照基线：被调研平台（虚拟学习者）的机制清单

| 平台机制 | 一句话定义 |
| --- | --- |
| personaSeed（31 子字段） | personalityTraits 六维 / story 生活史 16 条 / problemKnowledge / goalSeed / disclosurePlan 披露计划 |
| personaAnchorHint | 每轮全量注入的人设锚定文本 |
| friction 摩擦预算 | 编排层采样受控错误（错多少、错什么可控） |
| shouldEnd | 离场语义（何时结束演练） |
| 重复三字组兜底 | isRepetitiveLearnerReply 检测学习者复读后兜底重采样 |
| actor-audit | 事后保真审计（对照 personaSeed 检查对话保真度） |
| 记忆四态 | CLEAR / VAGUE / CONFUSED / FAILED 四种记忆状态 |
| masteryProb | 掌握概率约束（说话水平须与掌握度对齐） |
| 多 agent | tutor / peer / referee 协同编排 |

---

## 机制目录表

| # | 项目 | 机制 | 工程实现要点 | 解决的问题 | 可迁移性 | 迁移方式建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | SillyTavern | 角色卡字段分层（常驻/一次性/元数据） | description 为 Permanent Token 每次请求必发；first_mes 只在开场发一次；mes_example 有空位才插、逐块挤出；creator_notes/character_version 是纯元数据不进 prompt | token 预算按信息生命周期分层，而非「全部常驻」 | **H** | personaSeed 31 子字段按生命周期分层：恒等层（traits/story 核心事件）常驻，problemKnowledge/goalSeed 条件注入，disclosurePlan 走时间窗（见 #7） |
| 2 | SillyTavern | mes_example `<START>` 示例对话 | `<START>` 分组的多段示例，`{{char}}:`/`{{user}}:` 前缀；「有上下文空位才插入」逐块挤出；`<START>` 本身不进 prompt（官方角色设计页） | 用「示范话语」（few-shot）而非「形容词规则」锚定语气 | **H** | 给虚拟学习者配 2–3 组话语示例（覆盖会/半会/不会三种状态），预算不足时先于核心设定被挤出 |
| 3 | SillyTavern | 角色级 system_prompt / post_history_instructions 覆盖 | 开 Prefer Char. Prompt 后覆盖全局系统提示；`{{original}}` 宏把默认提示合流；post-history 位于历史之后（注意力最强区） | 同一前端承载行为迥异的多个角色 | M | tutor/peer/referee 共享编排层但各自带角色级覆盖与收尾指令（收尾指令≈平台的每轮终末规则） |
| 4 | SillyTavern | Character's Note（角色深度注入） | 角色卡自带 in-chat 注入：@Depth N（0 = 最后一条消息之后）+ 可选角色 system/user/assistant（官方角色设计页） | 人设关键信息定点放到注意力峰值而非系统区 | **H** | personaAnchorHint 拆成「核心摘要 @D 低深度常驻 + 细节按需」，利用「越靠 prompt 底部影响越强」的位置梯度 |
| 5 | SillyTavern | World Info 触发键组 | keys 支持正则；secondary keys 四种逻辑（AND ANY / AND ALL / NOT ANY / NOT ALL）；scan depth 逐消息扫描；group scoring 取最高分子集（官方 World Info 页） | 设定按需注入：关键词不出现就不花 token | **H** | problemKnowledge/story 细节做成条件触发条目（如学习者提到「二次函数」才注入对应误解库） |
| 6 | SillyTavern | WI token budget 与激活优先级 | 预算 = 上下文百分比或绝对值（默认 25% 为二手来源说法，官方页未标默认值）；耗尽后即使命中也不再激活；constant 先占、order 降序、直接命中优先于递归命中；可 overflow 告警 | 设定注入总量可控可预期，不静默撑爆上下文 | **H** | personaAnchorHint 设 token 上限，超限按优先级丢弃并告警，杜绝每轮全量锚定无限膨胀 |
| 7 | SillyTavern | WI Timed Effects（sticky/cooldown/delay） | sticky：激活后持续 N 条消息且跳过概率检定；cooldown：N 条内不可再激活；delay：聊天不满 N 条不激活；分支聊天继承状态、swipe/删除解除（官方页含精确时序示例） | 设定「出现节奏」可编程：维持一段、休息一段、到点才解锁 | **H** | disclosurePlan 直接映射：披露某知识缺口后 sticky 3–5 轮保持一致、cooldown 防反复抛同一线索、delay 防开局早漏（泄露+节奏双修） |
| 8 | SillyTavern | WI Probability + inclusion group | 触发后按 % 概率插入（100 必插）；同 inclusion group 多条按 Group Weight 加权随机选一；Prioritize Inclusion 切确定性 | 给对话引入可调参的受控随机 | M | friction 受控错误下放到条目级概率（某口误条目 30% 触发）；inclusion group 保证同轮只出一种错误不叠加 |
| 9 | SillyTavern | WI 递归扫描与 defer | entry 内容可触发其他 entry；Non-recursable / Prevent further recursion / Delay until recursion（按 recursion level 分层放行）；Max Recursion Steps 限深 | 设定图谱联动展开且深度可控 | M | 误解链（误解 A 会引出误解 B）做成递归触发，深度限 1–2 层 |
| 10 | SillyTavern | WI Vectorized 触发 | 以嵌入相似度替代关键词（keyless），Max Entries 限条数；只替代关键词检查，概率/过滤器照常；官方明示「要确定性结果请用关键词」 | 语义级触发兜底关键词写不全 | M | 学习者话语语义触发对应误解条目（「题目看不懂」→ VAGUE 条目）；关键词保底、向量补召回 |
| 11 | SillyTavern | Author's Note 位置/频率梯度 | After Scenario 或 in-chat @Depth；官方原文「越靠近 prompt 底部对下一次回复影响越大」；插入频率 0/1/N（每 N 次用户输入插一次）；chat 级与默认级分离 | 同一段文本可控制「贴多近、隔多久说一次」 | **H** | 离场提示/情绪状态不必每轮注入：关键提示低深度、状态提醒设频率=3；省 token 且降低「过度贴合锚定→台词变僵」 |
| 12 | SillyTavern | 群聊 Natural Order 调度 | ①从最后一条消息提取成员名提及（仅全词）→②按 Talkativeness 概率激活（0%=被点名才说，100%=总说，默认 50%）→③均未命中随机兜底；Allow Self Responses 控制连说（官方群聊页） | 多角色「谁接话」的去中心化调度 | **H** | tutor/peer/referee 轮次编排借鉴：被点名者优先、各角色介入频率参数化（talkativeness）、随机兜底防冷场 |
| 13 | SillyTavern | 群聊 Swap vs Join 角色卡 | 默认 Swap：每次生成只注入当前发言者角色卡；Join：全体成员字段合并为联合 prompt，官方警告「可能导致角色自我认知混乱、人格合并」 | 多角色上下文组装的取舍 | M | 多 agent 协作时不把 tutor+referee 人设拼进同一 prompt：各自生成只带各自卡，防身份串味 |
| 14 | SillyTavern | 群聊 Auto-mode | 上一角色发言后延迟 5 秒触发下一轮；用户开始打字即禁用（已排队生成不中断） | 自动推进与人类打断权的平衡 | M | peer/tutor 连环追问加延迟；学习者开始输入即暂停排程（节奏拟真） |
| 15 | SillyTavern | Mute / Force Talk | mute 关闭某角色回复；force talk 强制发言、绕过调度策略且无视 mute | 「按需叫停/点名」 | **H** | referee 平时 mute（不抢话），需要裁决时 force talk；masteryProb 过低时临时 mute peer 防抢答 |
| 16 | SillyTavern | Regex 扩展（输入/输出硬护栏） | Find/Replace + 捕获组；placement 五位置：User Input / AI Response / Slash Commands / World Info / Reasoning；ephemerality：promptOnly/markdownOnly 勾选后「你看到一个样，LLM 看到另一个样」；min/max depth 限作用范围；scoped 脚本随角色卡分发（官方 Regex 页） | 确定性文本护栏，不依赖模型自觉 | **H** | 学习者输出过正则：披露前高阶术语黑名单（防泄露）、AI 惯用语替换（防机器感/复读）、内部标记改写为展示层 |
| 17 | SillyTavern | STscript + Quick Replies | 管道命令语言：变量/条件/循环（guard 限 100）；`/genraw` `/gen` 生成控制；`/sendas` 以任意角色发消息（at= 定位）；`/inject` 持久注入（等效无限作者注释）；QR 可在收到消息等事件自动触发；`/regex` 调用正则脚本（官方 STscript 页） | 「检测→决策→再生成/注入」编排成确定性脚本 | M | 三字组兜底升级为脚本管线：检测重复 → 重采样 → 仍重复 → 注入纠偏 hint 并记入 audit |
| 18 | SillyTavern | Summarize 滚动摘要 | 每 X 条消息/每 X 词触发（先到先得）；递归摘要 = 旧摘要+新消息再压；注入位置同 AN（含 in-chat 深度）；摘要可手动编辑 / Restore Previous 回滚 / Pause；官方明示摘要可能幻觉丢细节需人工跟踪（官方 Summarize 页） | 超长对话的上下文折叠 | **H** | 长会话把早期轮次折叠成滚动摘要；人设锚定信息不进摘要（防压缩失真）；回滚供 actor-audit 复核 |
| 19 | SillyTavern | Vector Storage / Data Bank RAG | 嵌入检索 top-k chunk 注入；score threshold 建议 0.2–0.5；chunk 按字符切、overlap %、自定义边界；检索内容可再触发 WI（Include in World Info Scanning）；换 embedding 源须重算向量（官方 Data Bank 页） | 大体量设定/历史的按需召回 | M | story 生活史 16 条不必全量常驻：向量化按当前话题召回相关经历片段，阈值过滤弱相关 |
| 20 | RisuAI | Lorebook 四要素极简触发 | Name / Activation Keys / Insertion Order / Prompt 四字段；「activation key 出现在 recent chat 即激活」；order 数值越高影响越大（官方 wiki Lorebook 页） | 低门槛按需注入，够用即止 | L | 不引入第二套 lorebook；借鉴其「最小字段集」原则控制 personaSeed 字段膨胀 |
| 21 | RisuAI | @@ 装饰器 + HypaMemory 压缩 | lorebook 条目支持 @@probability / @@depth / @@role 行内声明、默认约 800 token 预算（二手，出处待核）；README 列明 HypaMemoryV2/V3 压缩、SupaMemory 上下文管理、Powerful Prompting（顺序/条件/变量）、Emotion Images 情绪差分图 | 注入参数内联声明 + 长期记忆有损压缩 | M | 记忆压缩思想对应 memory-curate：VAGUE/CONFUSED 态记忆做有损压缩保留「话题+情绪色」，CLEAR 态保留原文 |
| 22 | Character.AI | Greeting 即风格锚 | 官方原文："Your greeting is a style anchor, not just an opener."；"The AI treats the greeting as its strongest example of how this Character writes."；"Whatever style you greet in is the style you'll keep getting."；社区口诀 "tell in the Definition, show in the greeting"（官方帮助页） | 用一段示范文本替代描述性规则的最强杠杆 | **H** | 开场白即示范学习者说话方式（语气/句长/口语特征）；shouldEnd 的离场姿态也在开场白预演一次 |
| 23 | Character.AI | Alternate greetings 多门开场 | 默认 greeting 外最多加 5 个，用户滑动选择；要求「不同情绪/场景/动态」；AI Greeting 变体按用户 Persona 定制生成（官方帮助页） | 同一角色多种入口，提高重玩性 | M | 开场白按「已掌握/半懂/抗拒」三种初始掌握态预生成变体，与 masteryProb 初始带对齐 |
| 24 | 星野/Talkie | 高阶控制对话 + 视觉沉浸 | 星野「提供了高阶的控制对话的手段」缓解对话跳脱（出处待核，仅命中摘要）；Talkie 形象/人设/声音三轴自定义、「60% 视觉+40% 聊天」产品论（腾讯云开发者社区文章，出处待核） | 防出戏靠产品层控制权 + 多模态沉浸 | L | 文字教学场景不迁移抽卡经济；吸收「给编排者保留对话控制权」思想（对应 referee 介入权） |
| 25 | Talkie/C.AI | 数据合成一致性管线（训练侧） | 候选轮 reward model 多维打分过滤低质 → BoN 选最佳轮拼接 → 每 M 轮 LLM 评估改写修正「前后文衔接/剧情推进/人设一致性」；多样性保障按身份/态度/事件/性格/关系打散采样（知乎专栏，正文 403 仅命中摘要，出处待核） | 训练数据层面保证长对话人设一致 | **H** | actor-audit 从「事后单轮审计」升级为「滑动窗口审计+改写建议」：每 N 轮回看窗口内身份/情绪/掌握度一致性 |
| 26 | AI Dungeon | context 常驻/触发二分（三件套起源） | context = story + AI Instructions + Plot Essentials（旧名 Memory）+ Author's Note + 相关 Story Cards；前三者与摘要「永远包含」，Story Cards 关键词触发才包含；超限「移除最旧的故事文本」（官方记忆系统页）；Author's Note 位于上下文底部、最近约 3 个 action 之前（官方频道视频口述，出处待核） | 「常驻 vs 触发 vs 近因」三分层的最早设计 | **H** | 全量 personaAnchorHint 二分为：恒等常驻（AI Instructions 位）+ 关键词/状态触发（Story Cards 位）+ 近因提示（Author's Note 位） |
| 27 | AI Dungeon | Memory Bank 检索记忆 | 每 6 个 action 压缩一条记忆；每 15 action 自动生成 Story Summary；嵌入相似度对最近 action 取 top-k 填入剩余上下文；容量满按「最少使用」淘汰（Forgotten Memories）；容量按订阅档 25/100/200/400（官方记忆系统页） | 长期记忆「生成→检索→淘汰」闭环 | **H** | memory-curate 增加淘汰机制：低引用记忆降权/归档，防记忆列表膨胀稀释锚定 |
| 28 | NovelAI | Lorebook 预算与放置 | Token Budget 支持 0–1 小数=上下文百分比；Reserved Tokens 在放置前先预留；Insertion Order 高者先预留先放置；Key-Relative Insertion 可插在触发键附近；Trim Direction 决定放不下从哪端裁（官方 Lorebook 页） | 注入的精细预算会计 | M | 锚定/设定注入走「预留→排序→裁剪」三步会计，杜绝末位静默截断导致的隐性人设丢失 |
| 29 | NovelAI | Phrase Bias 生成端偏置 | `{文本}`/`[token]` 偏置 + Bias Value；Ensure Completion After Start；Unbias When Generated（生成过即撤偏置）；条目级条件含 Random Chance %、Numeric Comparison（基于 currentStep/段落/字符数等变量）（官方 Lorebook 页） | 生成端（logit 层）而非提示端的风格/重复控制 | M | 重复复读兜底的补充手段：对刚出现的三字组施加负偏置（若推理端可控）；Random Chance/步数条件承载 friction 预算 |

---

## 对照发现

### ① 设定注入策略：全量锚定 vs 触发式 lorebook

- **平台现状**：personaAnchorHint 每轮全量注入，personaSeed 31 子字段整体作为锚定源；没有 token 预算、触发条件、注入位置的概念。disclosurePlan 由编排层逐轮控制，但锚定文本本身不区分「恒等核心」与「情节细节」。
- **外部做法**：SillyTavern 用 World Info 把「按需注入」做成了完整工程：触发键（含正则与二级键逻辑）决定**何时**注入（[官方 WI 页](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)）、token budget + 激活优先级决定**注多少**、insertion position（@D 深度 + system/user/assistant 角色）决定**放哪里**、sticky/cooldown/delay 决定**出现节奏**。AI Dungeon 从 2021 年起就把上下文二分为「AI Instructions/Plot Essentials 永远包含 + Story Cards 关键词触发」（[官方记忆系统页](https://help.aidungeon.com/faq/the-memory-system)）。Author's Note 有明确的位置梯度——官方原文「越靠近 prompt 底部对下一次回复影响越大」与频率控制（每 N 次输入插一次）（[官方 AN 页](https://docs.sillytavern.app/usage/core-concepts/authors-note/)）。
- **差距/可借鉴点**：平台是「重锚定」路线——一致性强，但每轮 token 成本高，且全量锚定会让模型过度贴合提示文本（台词趋于僵化、变少）。外部经验给出三个可组合的旋钮：**何时注入（触发）、注多少（预算）、放哪里（深度/角色）**。可直接迁移：① personaAnchorHint 分层为恒等核心（低深度常驻）+ 状态提示（频率化）+ 情节设定（触发式）；② disclosurePlan 映射 sticky/cooldown/delay（披露后保持 N 轮一致、冷却防重复抛线索、延迟防开局早漏）；③ 锚定文本加预算上限与溢出告警。

### ② 语气与风格锚定：示例对话 vs 规则描述

- **平台现状**：personalityTraits 六维等描述性字段 + personaAnchorHint 规则式描述（「你是……你说话应该……」）。没有示范话语层。
- **外部做法**：SillyTavern 的 mes_example 用 `<START>` 分组示例对话做语气 few-shot，且有明确的预算策略——「有上下文空位才插入、逐块挤出」（[官方角色设计页](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)）。Character.AI 把这条路走到极简：官方帮助页明言 "Your greeting is a style anchor, not just an opener"、"The AI treats the greeting as its strongest example of how this Character writes"，社区口诀 "tell in the Definition, show in the greeting"——描述写在 Definition、示范写在 greeting（[官方帮助页](https://support.character.ai/hc/en-us/articles/50609011294235)）。
- **差距/可借鉴点**：规则描述（tell）靠模型理解服从，示范话语（show）靠 few-shot 模仿——后者在社区与官方文档中一致被认为是对语气最可控的杠杆。虚拟学习者现缺 show 层。可迁移：① personaSeed 增加 2–3 组话语示例（覆盖掌握/半懂/不会三种状态），采用 mes_example 式「可挤出」预算策略；② 开场白承担风格定调（greeting-as-anchor），把语气、句长、口语特征直接示范出来，而不是写形容词。

### ③ 护栏层次：prompt 规则 vs regex/脚本硬护栏

- **平台现状**：护栏集中在编排层与事后层——isRepetitiveLearnerReply 三字组兜底（检测后处理）、friction 编排采样、actor-audit 事后审计；prompt 层靠规则文本约束。
- **外部做法**：SillyTavern 提供两层硬护栏。其一是 Regex 扩展：作用位置枚举到 User Input / AI Response / World Info / Reasoning 五处，且 promptOnly/markdownOnly 可以「你看到一个样、LLM 看到另一个样」——显示层与提示层可分离（[官方 Regex 页](https://docs.sillytavern.app/extensions/regex/)）。其二是 STscript：变量/条件/循环 + `/genraw` 重生成 + `/sendas` 以任意角色发言 + `/inject` 持久注入，把「检测→决策→再生成」编排成确定性脚本，Quick Replies 还能在收到消息等事件上自动触发（[官方 STscript 页](https://docs.sillytavern.app/usage/st-script/)）。NovelAI 则在生成端（logit 层）做 Phrase Bias，且支持 Unbias When Generated——生成过一次即撤偏置（[官方 Lorebook 页](https://docs.novelai.net/en/text/lorebook)）。
- **差距/可借鉴点**：平台的兜底是「检测到重复后补救」，缺「事前硬改写」与「生成端偏置」两档。可迁移：① 学习者输出过正则管线——披露前高阶术语黑名单（防泄露）、AI 惯用语替换（防机器感与复读）；② 显示层/提示层分离（给教学系统的内部叙述与给演练消费者看的叙述分开渲染）；③ 三字组兜底从单次补救升级为脚本管线（重采样→仍失败→注入纠偏 hint→记入 audit）；④ 若推理端可控，对刚出现的三字组做负 logit 偏置。

### ④ 记忆注入：触发检索 vs 摘要/向量

- **平台现状**：memory-curate 负责记忆整理，记忆四态（CLEAR/VAGUE/CONFUSED/FAILED）表达学习者对知识的认知状态——这是「角色内部状态机」，但状态如何装配进上下文（粒度/位置/token）没有专门机制。
- **外部做法**：三套成熟方案。ST Summarize：每 X 条消息/X 词触发（先到先得）、递归摘要（旧摘要+新消息再压）、可手动编辑、Restore Previous 回滚、Pause，官方同时警告摘要会幻觉丢细节（[官方 Summarize 页](https://docs.sillytavern.app/extensions/summarize/)）。ST Vector Storage/Data Bank：top-k chunk 检索 + score threshold（建议 0.2–0.5）+ chunk overlap，检索内容还能再触发 WI（[官方 Data Bank 页](https://docs.sillytavern.app/usage/core-concepts/data-bank/)）。AI Dungeon Memory Bank：每 6 个 action 压缩一条记忆、嵌入相似度取 top-k 填入剩余上下文、容量满按最少使用淘汰（[官方记忆系统页](https://help.aidungeon.com/faq/the-memory-system)）。
- **差距/可借鉴点**：四态状态机是平台强项（外部项目都没有「记忆的认知置信度」概念），但装配层是空白。可迁移：① 四态记忆条目化——每条记忆带状态标签，按当前话题检索 top-k 注入而非全量；② 长会话滚动摘要 + 锚定信息保护（personaSeed 恒等层不进摘要，防压缩失真）+ 摘要回滚供 actor-audit 复核；③ 引入容量上限与 LRU 淘汰（AI Dungeon 的 Forgotten Memories 思想），防记忆列表膨胀稀释每轮锚定。

---

## 迁移清单（按优先级）

### H 级（7 项，直接可落地）

| # | 迁移项 | 改动点 | 预期解决的失真模式 | 外部出处 |
| --- | --- | --- | --- | --- |
| H1 | personaAnchorHint 分层注入 | 把每轮全量锚定拆成三层：恒等核心（低深度常驻、带 token 预算与溢出告警）+ 状态提示（频率化，如每 3 轮一次）+ 情节设定（关键词/状态触发式）；离场提示降频注入 | 身份漂移（锚定截断/僵化）、泄露（全量注入扩大披露面）、节奏（锚定过长挤压自然对话）、离场（离场提示每轮出现会诱发提前收场） | ST WI/AN 官方页、AI Dungeon 三件套 |
| H2 | 话语示例层 | personaSeed 增加 voiceSamples：2–3 组 `<START>` 式话语示例（掌握/半懂/不会三态），可挤出预算策略；开场白按 greeting-as-anchor 原则直接示范说话方式 | 重复复读（示例提供多样表达范式）、身份漂移（语气 few-shot 比形容词稳定） | ST mes_example、C.AI greeting 官方页 |
| H3 | disclosurePlan 时间窗工程化 | 披露计划逐条映射 sticky（披露后 N 轮保持一致）/ cooldown（M 轮内不重提）/ delay（开局 K 轮内禁披露） | 泄露（早漏）、节奏（线索出现节奏可控） | ST WI Timed Effects 官方页 |
| H4 | 输出正则硬护栏 | 编排层对学习者输出加正则管线：披露前高阶术语黑名单（命中即改写/重采样）、AI 惯用语与套话替换表 | 泄露（术语越权）、重复复读（套话清洗） | ST Regex 官方页 |
| H5 | actor-audit 滑动窗口化 | 事后审计从单轮对照升级为每 N 轮窗口审计：窗口内身份/情绪/掌握度一致性检查并产出改写建议（对齐 Talkie 合成管线的「每 M 轮评估改写」） | 身份漂移、情绪掌握度失真（跨轮漂移窗口内可见） | Talkie/C.AI 合成管线（出处待核）+ ST Summarize 回滚 |
| H6 | 记忆装配层 | 四态记忆条目化（每条带状态标签）→ 按话题检索 top-k 注入（阈值过滤）→ 长会话滚动摘要（personaSeed 恒等层不进摘要、支持回滚）→ 容量上限 + LRU 淘汰 | 身份漂移（记忆缺失/膨胀导致不连续）、情绪掌握度失真（旧情绪事件召回不足） | ST Summarize/Vector Storage、AI Dungeon Memory Bank |
| H7 | 多 agent 三因子调度 | tutor/peer/referee 轮次借鉴 Natural Order：被点名（mention）优先 → 各角色介入频率参数化（talkativeness）→ 随机兜底防冷场；referee 默认 mute、裁决时 force talk；masteryProb 过低时临时 mute peer | 节奏（抢话/冷场）、离场（referee 过早介入终止演练） | ST 群聊官方页 |

### M 级（6 项，有依赖条件）

| # | 迁移项 | 改动点 | 预期解决的失真模式 | 外部出处 |
| --- | --- | --- | --- | --- |
| M1 | friction 采样下放条目概率 | 受控错误做成带触发概率的条目（如口误条目 30% 触发）+ inclusion group 保证同轮只出一种错误 | 情绪掌握度失真（错误密度分布可控） | ST WI Probability/inclusion group |
| M2 | 多 agent 不拼卡 | 多 agent 各自生成时只注入各自角色卡（Swap 模式），禁止 tutor+referee 人设合并进同一 prompt | 身份漂移（官方警告 Join 会致「人格合并」） | ST 群聊 Swap/Join |
| M3 | 自动连发延迟 + 输入中断 | agent 连环追问间加延迟；学习者开始输入即暂停排程（对应 auto-mode 5 秒 + 打字禁用） | 节奏 | ST 群聊 Auto-mode |
| M4 | 生成端重复偏置 | 推理端可控时，对刚出现的三字组施加负 logit 偏置，作为三字组兜底的上游补充 | 重复复读 | NovelAI Phrase Bias |
| M5 | 显示层/提示层分离 | 内部叙述（给教学系统）与外显话语（给演练消费者）分开渲染与存储 | 泄露（内部标记/审计文本外泄到话语层） | ST Regex promptOnly/markdownOnly |
| M6 | 语义触发兜底 | 误解条目除关键词外加嵌入相似度触发（关键词保确定性、向量补召回） | 身份漂移（该触发的设定未触发导致状态错乱） | ST WI Vectorized |

### L 级（2 项，暂缓）

| # | 迁移项 | 改动点 | 预期解决的失真模式 | 外部出处 |
| --- | --- | --- | --- | --- |
| L1 | 情绪差分表达 | 学习者话语附加情绪标签驱动多模态表达（表情/语气图） | 节奏（表达节奏感）——文字平台收益有限 | RisuAI Emotion Images |
| L2 | 字段集最小化原则 | 审视 personaSeed 31 子字段是否有「字段膨胀、单字段语义稀释」风险，向 RisuAI 四字段极简触发对齐 | 身份漂移（字段过多互相稀释） | RisuAI Lorebook wiki |

---

## 文献/资料来源表

### 官方文档（正文核读）

| 项目 | 页面 | URL |
| --- | --- | --- |
| SillyTavern | World Info（触发键/预算/timed effects/递归/向量触发/inclusion group） | https://docs.sillytavern.app/usage/core-concepts/worldinfo/ |
| SillyTavern | Author's Note（位置/深度/频率） | https://docs.sillytavern.app/usage/core-concepts/authors-note/ |
| SillyTavern | Group Chats（四种调度策略/talkativeness/auto-mode/mute/force talk/swap-join） | https://docs.sillytavern.app/usage/core-concepts/groupchats/ |
| SillyTavern | Character Design（角色卡字段全集/深度注入/talkativeness） | https://docs.sillytavern.app/usage/core-concepts/characterdesign/ |
| SillyTavern | Regex 扩展（placement/ephemerality/depth/global-scoped） | https://docs.sillytavern.app/extensions/regex/ |
| SillyTavern | Summarize 扩展（触发/递归摘要/回滚） | https://docs.sillytavern.app/extensions/summarize/ |
| SillyTavern | Data Bank RAG（chunk/threshold/注入位置） | https://docs.sillytavern.app/usage/core-concepts/data-bank/ |
| SillyTavern | STscript（命令语言/QR 自动触发） | https://docs.sillytavern.app/usage/st-script/ |
| NovelAI | Lorebook（预算/放置/phrase bias/advanced conditions） | https://docs.novelai.net/en/text/lorebook |
| AI Dungeon | The Memory System（context 构成/Story Cards/Memory Bank/LRU） | https://help.aidungeon.com/faq/the-memory-system |
| Character.AI | Greeting and Voice（style anchor 原文/alternate greetings/voice） | https://support.character.ai/hc/en-us/articles/50609011294235 |
| RisuAI | GitHub README（功能总表/HypaMemory/SupaMemory） | https://github.com/kwaroran/RisuAI |
| RisuAI | Wiki：Lorebook（四要素/激活逻辑） | https://github.com/kwaroran/RisuAI/wiki/Lorebook/768e5ec04d83dbf506ec6d5eb61b2fdf4f95112e |

### 二手来源（搜索命中，用于交叉验证与补细节）

| 内容 | URL |
| --- | --- |
| ST 角色卡 V1/V2/V3 字段演进（LoreWeaver） | https://www.loreweaverai.com/guides/character-cards-explained |
| ST 角色卡字段逐项解释（TavernSprite） | https://tavernsprite.com/blog/sillytavern-character-card-fields |
| ST 角色卡字段与 prompt 去留（aicompanionguides） | https://aicompanionguides.com/blog/what-is-a-character-card-2026 |
| ST WI 插入顺序/预算 25% 默认（MemoryLake，二手数值） | https://www.memorylake.ai/en/blogs/sillytavern-world-info-insertion-order |
| ST Lorebook 工作原理/预算 25% 默认（Arcanum RPGs，二手数值） | https://arcanumrpgs.com/blog/sillytavern-lorebook |
| ST WI 排障（Local Waifu） | https://localwaifu.com/blog/sillytavern-lorebook-not-working |
| ST WI 条目不触发机制（MiniTavern Blog） | https://blog.mini-tavern.com/blog/sillytavern-world-book-tutorial-building-immersive-lore-and-settings-for-ai-role-05be1d |
| ST Regex 五配方（Arcanum RPGs） | https://arcanumrpgs.com/blog/sillytavern-regex |
| ST 记忆四系统对比（Arcanum RPGs） | https://arcanumrpgs.com/blog/sillytavern-memory |
| ST 记忆扩展评测（TavernSprite） | https://tavernsprite.com/blog/best-sillytavern-memory-extensions |
| ST 角色记忆扩展（bal-spec/sillytavern-character-memory） | https://github.com/bal-spec/sillytavern-character-memory |
| ST 作为 GM：骰子/目标/AN/群聊（Arcanum RPGs） | https://arcanumrpgs.com/blog/sillytavern-game-master-dice-objectives |
| ST vs Agnai vs RisuAI 对比（PromptQuorum） | https://www.promptquorum.com/power-local-llm/sillytavern-vs-agnai-vs-risuai-roleplay |
| RisuAI Lorebook 预算 800/装饰器/HypaMemory（Arcanum RPGs，出处待核） | https://arcanumrpgs.com/blog/risuai-lorebook |
| RisuAI vs ST（charactercardconverter） | https://charactercardconverter.com/guides/risuai-vs-sillytavern |
| RisuAI 介绍（RepoCloud） | https://repocloud.io/details/Risuai |
| RisuAI 记忆结构（thredly） | https://thredly.io/risuai-memory |
| C.AI 机器人创建实战（Arcanum RPGs） | https://arcanumrpgs.com/blog/character-ai-bot-creation |
| C.AI 平台机制综述（EmergentMind，出处待核） | https://www.emergentmind.com/topics/character-ai-c-ai |
| C.AI 角色档案创建（Medium @adlerai） | https://medium.com/@adlerai/creating-a-character-ai-character-profile-5d50d2007a7f |
| NovelAI Lorebook 机制（Arcanum RPGs） | https://arcanumrpgs.com/blog/novelai-lorebook |
| Lorebook 通用格式（Novel Mage） | https://novelmage.com/blog/what-is-a-lorebook-ai-worldbuilding-explained |
| Chub AI Lorebook 参数（官方 docs.chub.ai） | https://docs.chub.ai/docs/advanced-setups/lorebooks |
| NovelAI 入门（tapwavezodiac 非官方指南） | https://tapwavezodiac.github.io/novelaiUKB/Starting-your-first-story-in-NovelAI.html |
| AI Dungeon 指令区拆解（Arcanum RPGs） | https://arcanumrpgs.com/blog/ai-dungeon-ai-instructions |
| NovelAI vs AI Dungeon 上下文（Hacker News 讨论） | https://news.ycombinator.com/item?id=29826763 |
| AI Dungeon 记忆系统视频（官方频道，AN 位置口述，出处待核） | https://www.youtube.com/watch?v=aVy-Vt5F01A |

### 中文产品分析（部分仅命中摘要，正文 403/未核，均已标注）

| 内容 | URL |
| --- | --- |
| Roleplay AI 观察：C.AI/Talkie 数据合成与一致性管线（知乎专栏，正文 403，仅命中摘要） | https://zhuanlan.zhihu.com/p/2014254323014607723 |
| 为什么 AI 陪伴产品都想抄星野（智源社区，星野控制对话手段） | https://hub.baai.ac.cn/view/32981 |
| 国内外虚拟 AI 聊天 APP 竞品分析（人人都是产品经理） | https://www.woshipm.com/evaluating/6146340.html |
| Character.ai 向左，MiniMax Talkie 向右（腾讯云开发者社区，60%视觉+40%聊天论） | https://developer.cloud.tencent.com/article/2362454 |
| Talkie/星野 陪聊+抽卡（出海参考） | https://m.yfchuhai.com/article/12737.html |

---

### 与既有调研的关系

- `_vl-04-humanlikeness-lit.md` 回答「像人的判据是什么」（学术线）；本篇回答「角色扮演工程界用什么机制实现这些判据」（工程线）。两篇共同支撑虚拟学习者的改进决策：VL-04 的「一致性失败摧毁可信度」[36] 在本篇找到工程解（WI timed effects、滑动窗口审计、摘要回滚）；VL-04 的「过于流畅不像人」[33][34] 在本篇找到护栏解（regex 输出改写、phrase bias）。
- 本篇刻意不覆盖：学术文献（见 _lit-05/_lit-07 与 _vl-04）、平台字段审计（见 `docs/SKILL_FIELD_AUDIT_2026-11-11.md`）。
