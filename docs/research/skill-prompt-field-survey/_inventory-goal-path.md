# 编译产物 Prompt 字段清单调查：goal / path / 判定器批次

- 调查时间：2026-11-19
- 仓库：D:\wenflow\wenflow，commit `e736f7aa`
- 调查对象：`prompts/` 目录下 9 个编译产物 prompt 文件（UTF-8 中文 markdown，五块结构：身份 / 使用通道 / 执行规则 / 输出字段 / 边界约束）：

| # | 文件 | agentId | displayName（skills.yaml） | coreVersion |
|---|------|---------|---------------------------|-------------|
| 1 | prompts/skill.goal-confirm-adjudicator.md | skill:goal-confirm-adjudicator | goal 确认裁决器 Skill | 1 |
| 2 | prompts/skill.goal-conversation.md | skill:goal-conversation | 目标对话 Skill | 17 |
| 3 | prompts/skill.path-kc-mapping.md | skill:path-kc-mapping | 知识组件映射 Skill | 1 |
| 4 | prompts/skill.path-material-brief.md | skill:path-material-brief | 资料理解摘要器 Skill | 1 |
| 5 | prompts/skill.path-material-collect.md | skill:path-material-collect | 资料采集编排器 Skill | 1 |
| 6 | prompts/skill.path-planning.md | skill:path-planning | 路径规划 Skill | 8 |
| 7 | prompts/skill.path-reviewer.md | skill:path-reviewer | 路径评审 Skill | 3 |
| 8 | prompts/skill.path-task-design.md | skill:path-task-design | 阶段设计 Skill | 1 |
| 9 | prompts/skill.semantic-freeze-judge.md | skill:semantic-freeze-judge | 语义冻结裁判 | 1 |

提取规则：
- 「输入字段」表逐行列出各文件「输入契约声明」中的全部字段；ref 前缀（skill 上游模型输出 / sandbox 编排注入 / user 用户平台）原样保留。
- 契约声明行 object 说明括号里出现的子键，展开为独立行（字段列写 `父.子`）。
- 「输出字段」表逐行列出「输出字段」块 schema 的全部顶层字段；子字段在「子字段」列以顿号连接（深层内嵌键以括号标注）。
- 4 个文件（goal-confirm-adjudicator 除外）中，path-material-brief / path-material-collect / semantic-freeze-judge 没有显式的字段化「输入契约声明」，按实际通道说明提取。
- 「教育学术语标注」收录带教育学 / 心理学 / 学习科学含义的术语（含内部隐喻但语义同族的词，注明语境与出处规则）。

---

## goal-confirm-adjudicator（goal 确认裁决器 Skill，coreVersion: 1）

**角色**：goal 会话的确认裁决器，只判断用户刚说的这段话是否表达「就要这个方案、开始排路径」。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| userUtterance（string） | `user:latestMessage`（用户/平台） | 用户刚发出的这段话（原文）——本 skill 唯一的判定对象 |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| confirm | boolean | 用户这段话是否表达「就要这个方案、开始排路径」（当轮） | — |

### 教育学术语标注

- 无（纯对话意图裁决，规则中只有「方案 / 排路径 / 拍板」等业务用语）。

---

## goal-conversation（目标对话 Skill，coreVersion: 17）

**角色**：学习目标澄清与方向收敛助手——通过自然对话澄清学习目标，信息足够时收敛到第一版学习方向；每轮接收结构化 payload，做新回合判断（fresh turn evaluation）而非续写聊天（deltaOutput）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| userInput（string） | `user:latestMessage`（用户/平台） | 用户当轮的输入内容（对话消息，运行时由执行信封承载） |
| state（object） | `sandbox:goal.collectedData.state`（编排注入） | 当前理解状态、置信度与阶段（本 Agent 状态池，来自上一轮合并结果） |
| conversationContext（object[]） | `sandbox:goal.collectedData.history`（编排注入） | 完整可见历史消息（核对原话、补足细节） |

说明：契约声明行未展开 state 的子键；state 的内部结构由输出侧「回合状态」定义（见下表 state 行）。

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| reply | string | 本轮回复文本；每次回复只能出现一个问句（一个问号）；understanding 阶段先总结已理解内容再提 1 个关键问题，proposing 阶段引导确认，ready 阶段只确认（当轮） | — |
| state | object | 回合状态；stage 是唯一阶段权威（平台由 stage 派生 isCompleted）；completed 仅用于 answer-only / not_judgeable 收口；motivation_signal / mi_frames 为 hidden 静默累积字段；ready 只在界面按钮显式确认后输出 | stage（understanding\|proposing\|ready\|completed）、confidence（0-0.99）、motivation_signal.change_talk_score（-3..+3）、mi_frames（GoalFrame、ProblemFrame、ExperienceFrame、PlanFrame；帧内 desire/harmEffect/attribution 等按规则 68 无证据留空） |
| understanding | object | 累积的理解数据（详见下方子键清单） | surface_goal、real_problem、primary_block_type、recurrence、block_type_evidence、intent_type、entry_state、skill_nature、skill_nature_evidence、platform_judgment、platform_judgment_evidence、sensor_readouts、support_need、current_baseline（level、evidence）、school_anchor（textbook、examScope、schoolPace）、scenario、background_experience、learning_signal、goal_orientation、cognitive_bandwidth、sdt_needs（autonomy、competence、relatedness）、available_resources（time_horizon、time_budget、time_per_session）、deadline_date、deadline_text、time_dimensions（timeModelVersion、sessionsLengthMin、sessionsLengthSource、objectiveScopeHours、deadlineDate、scopeAnchor）、success_criteria（observable_result、acceptance_check）、constraints_and_boundaries、motivation、urgency、pain_points、prerequisiteCheckResults（probeId、targetConcept、userAnswer、isCorrect）、needsMaterial（kind、title、why、origin、queries） |
| nextQuestions | string[] | 下一步要问的问题（当轮） | — |
| quickReplies | string[] | 快捷回复选项，每次 2-3 个、每条 ≤8 汉字；proposing 阶段只给调整方向不给确认项；用户离场/收口轮必须留空（当轮） | — |
| confirmedProposal | object? | 仅 proposing 阶段输出的确认方案 | learning_direction、first_deliverable、key_stages、scope_size、out_of_scope、prerequisiteDiagnostics（probeId、targetConcept、question、options、correctOption） |
| confidenceScores | object | 各维度置信度评分（debug 用途）（当轮） | — |
| structuredData | object? | 可选旁路字段，承载结构化画像信息，透传给路径规划 framing 逻辑（scenario 判定）的契约字段 | learner（identity、skill_level）、learning_context（urgency、motivation）、end_user（identity、pain_points） |

understanding 子键语义要点（保持原文措辞）：
- surface_goal：用户原始诉求锚点，必须保留用户原话，不概括、不改写、不升级。
- real_problem：诊断结论，回答「为什么会这样」，必须包含具体场景和具体障碍（entry_state=exploratory 时改写「当前起步位置与认知切口」）。
- primary_block_type / recurrence / block_type_evidence：主阻塞类型（capability | oneoff_operation | environment_tooling | permission_process | emotion_relationship）、是否反复发生、一句支撑证据（hidden）。
- intent_type：主导意图分型（mastery | problem-fix | troubleshooting | exam | career-switch | research | interest | multi-goal），每轮必须写。
- entry_state：focused | exploratory，本次进入对话的确定度，与 intent_type 正交，每轮更新。
- skill_nature / skill_nature_evidence：这条路径要练的东西属于哪一类（tool_operation | cognitive_internalized | physical_internalized | knowledge_structure），决定下游「AI 能不能替学习者代跑核心动作」。
- platform_judgment / platform_judgment_evidence / sensor_readouts：平台能否判断学习者做对了（judgeable_output | judgeable_sensor | not_judgeable）；judgeable_sensor 时记读数来源（如功率计、心率带）。
- support_need：除学习之外的支持需求（none | emotional | referral），只影响平台侧是否附带情绪支持或转介建议。
- learning_signal / goal_orientation / cognitive_bandwidth：学习承接信号、目标取向（偏掌握型/偏表现型）、认知带宽（均为 hidden 静默累积）。
- deadline_date / deadline_text：外部截止的绝对日期与用户原话表述，必须与 time_dimensions.deadlineDate 一致。
- time_dimensions：时间模型三字段（单次节奏 / 客观内容体量 / 截止日）；已废弃字段（totalSessions / totalWeeks / sessionsPerWeek / estimatedHours / calendarCapacityHours / scopeAnchorHours）禁止输出。
- prerequisiteCheckResults：前置探测题作答结果（静默回填，仅供 path 层校准）。
- needsMaterial：外部资料需求登记（origin=public 联网采集 / private 用户上传；未登记则禁止真实案例承诺）。

### 教育学术语标注

- 脚手架（scaffolding）：规则 21「赋能契约禁区」——「用户的焦虑要接住，接的方式是『脚手架我来给』，不是『工具我们不用』」。
- 动机式访谈 MI（Motivational Interviewing）：规则 68「动机信号检测（MI 隐式推理，Schema-Guided 四帧追踪）」；输出 state.motivation_signal.change_talk_score、state.mi_frames 四帧；语境含 change talk（「我想试试」「这次一定要」）、sustain talk（「没时间」「算了」）、evoking 式回应、正常化、承诺强度 commitment。
- 归因（attribution theory 族）：规则 68 ProblemFrame.attribution——「用户对原因的归因方式（外部归因/内部归因/策略归因）」。
- 自主 / 胜任 / 归属（SDT 自我决定理论基本心理需要）：输出 understanding.sdt_needs——「记录用户自然流露的自主/胜任/归属信号；低胜任给首胜体验，低自主给多个可选方向，低归属可提伴学」。
- 首胜体验（成功体验 / 自我效能族）：规则 66（support_need 判定）与 sdt_needs 语境——「低胜任给首胜体验」。
- 掌握型 / 表现型目标取向（成就目标理论）：输出 understanding.goal_orientation——「目标取向自由描述（偏掌握型/偏表现型）……供路径挑战性与表扬语言参考」。
- 认知带宽（认知资源）：输出 understanding.cognitive_bandwidth——「认知带宽自由描述（如『白天没法学，只能周末』）；多任务挤压时 proposal 更聚焦、key_stages 更短」。
- 心智模型（mental model）：confirmedProposal.first_deliverable——「零基础用户……优先建立基础认知框架（最小可用 mental model）」；规则 24 mastery 分型「学科本身的完整心智体系」。
- 前置知识探测 / 前置探测（诊断性前测）：规则 51「前置知识探测（prerequisiteDiagnostics）」；输出 understanding.prerequisiteCheckResults 与 confirmedProposal.prerequisiteDiagnostics——「探测题必须是一次判断的二元题（对比/辨认/最小应用），不考细节」。
- 内化（internalization）：规则 59 技能性质判定——cognitive_internalized「认知内化型：……价值在『大脑建立神经回路』，核心动作必须学习者本人做」；physical_internalized「身体内化型：价值在『身体/手上建立肌肉记忆』」。
- 神经回路 / 肌肉记忆：规则 59 同上语境（内化型技能的生理机制表述）。
- 认知共情（empathy）：输出字段 reply——「优先认知共情：先复述场景中的关键约束和冲突，再推进问题，避免『我理解你的焦虑』类空话」。
- SMART 目标（目标设定）：规则 39——「先自检方案质量（SMART 五维：具体/可衡量/可达成/与真实问题相关/有时间边界）」。
- 认知盲区（迷思概念同族）：规则 35 起步提案形态——「每个阶段对应一个具体认知盲区/判断动作」；confirmedProposal.key_stages 同款要求。

---

## path-kc-mapping（知识组件映射 Skill，coreVersion: 1）

**角色**：对给定的认知核心（cognitiveCore）与任务列表（subtasks）做机器可读的结构标注——输出知识组件（KC）及其前置依赖图；这是数据标注任务，不是教学讲解任务。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| cognitiveCore（object） | `skill:path-planning.cognitiveCore`（skill 上游模型输出） | 认知核心（coreConcepts + cognitiveDomain） |
| cognitiveCore.coreConcepts | 同上 | 认知核心内的核心概念（KC 分解的对象） |
| cognitiveCore.cognitiveDomain | 同上 | 认知核心内的一体化底层能力描述 |
| milestones（object[]） | `skill:path-planning.milestones`（skill 上游模型输出） | 里程碑骨架（title/coreConcept/description/goal） |
| milestones.title | 同上 | 里程碑标题（待标注数据，不复述不点评） |
| milestones.coreConcept | 同上 | 里程碑绑定的核心概念 id |
| milestones.description | 同上 | 里程碑描述 |
| milestones.goal | 同上 | 里程碑目标 |
| subtasks（object[]） | `sandbox:path.subtasks`（编排注入） | 阶段子任务列表（taskKey/title/type/linkedConcept/knowledgeType/cognitiveLevel）；taskKey 是稳定键（形如 task-1-0），只用于把 KC 链接对回任务，不参与语义判断 |
| subtasks.taskKey | 同上 | 任务稳定键，逐字回显用 |
| subtasks.title | 同上 | 任务标题 |
| subtasks.type | 同上 | 任务类型 |
| subtasks.linkedConcept | 同上 | 任务关联概念 |
| subtasks.knowledgeType | 同上 | 任务知识类型标注 |
| subtasks.cognitiveLevel | 同上 | 任务认知层级标注 |
| prerequisiteTree（object?） | `sandbox:path.prerequisiteTree`（编排注入） | RPKT 前提知识缺口链（可选，用于校验 KC 依赖是否覆盖已知缺口） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| conceptKcs | object[] | 每个 coreConcept 的 KC 分解（每项含 conceptId 与 kcs 数组） | conceptId（形如 concept-1）、kcs（内含 kcId「形如 kc-1a」、name「如：识别半联动点」、taxonomy「factual\|conceptual\|procedural\|metacognitive」、prerequisiteKCs「前置依赖 kcId 数组」） |
| taskKcLinks | object[] | 每个 subtask 关联的 KC（taskKey 逐字回显对应 subtask 的 taskKey；字段名必须逐字为 taskKey/taskTitle/linkedKCs，不得写成 kcIds/kcs 等别名） | taskKey（稳定键「task-1-0」）、taskTitle（照抄输入 title，仅供人读对照）、linkedKCs（该任务关联的 kcId 数组，复数） |

说明：规则明确「不需要输出 kcGraph：系统会按 conceptKcs 里的 prerequisiteKCs 自动派生节点与边（from=前置，to=后继）」。

### 教育学术语标注

- 知识组件（KC，knowledge component）：身份与规则 2——「学会它一次，所有用到它的任务的表现会一起变好」「可独立习得、可单独评估的能力单元」；这是学习科学（知识组件模型）的直接术语。
- 知识维度四分 taxonomy：规则 7 与边界约束——「taxonomy（factual\|conceptual\|procedural\|metacognitive）」，即事实性 / 概念性 / 程序性 / 元认知知识（Anderson & Krathwohl 修订版布鲁姆分类的知识维度）；metacognitive 即元认知。
- 前置依赖 / 前提知识（prerequisite）：规则 8-9——「prerequisiteKCs（前置依赖：要理解 KC-B 必须先掌握 KC-A）」「prerequisite 是知识依赖，不是讲授顺序：只有当『没掌握 A 就不可能掌握 B』时才标 A→B」。
- RPKT 前提知识缺口链：输入 prerequisiteTree——「RPKT 前提知识缺口链（可选，用于校验 KC 依赖是否覆盖已知缺口）」（内部术语，基于前提知识递归发现）。
- 能力单元 vs 执行步骤：身份——「它是一个可独立习得、可单独评估的能力单元，不是一个任务内部的执行步骤」（知识组件与任务步骤的判别，学习科学中 knowledge component 与 procedure 之分）。

---

## path-material-brief（资料理解摘要器 Skill，coreVersion: 1）

**角色**：资料理解摘要器——用户上传学习资料后，通读解析正文并产出结构化理解摘要（brief），让下游目标对话与路径生成不用重读全文；不评分、不给学习建议、不排路径。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| （无字段化输入契约声明） | —（正文经 task 通道注入；使用通道为 task「当前任务/场景/控制指令」+ evidence「客观事实轨迹：课堂证据、知识变化、课后总结、运行统计（只读追加）」） | 待理解的资料解析正文（含「已截断」标记时只就所给部分理解） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| status | enum | 理解结果状态：ok（正文可读且已形成结构化理解）\| not_found（正文为空/乱码/非学习资料属性且无法形成理解）；not_found 必须显式返回，brief 为 null | — |
| brief | object? | 结构化理解摘要（status=not_found 时为 null） | docType（文档类型：课程标准/教材/讲义/规范/论文/笔记/报告…）、subject（一句话主题）、audience（目标读者/适用对象）、overview（全文浓缩概括 ≤200 字，只基于正文）、toc[]（title「章节标题，照抄原文」、gist「该章节一句话概括 ≤40 字」）、coreConcepts（核心概念/关键术语 ≤10 个）、naturalDivisions（天然学习切分维度 ≤4 条） |
| notes | string[] | 退化说明（截断/目录为归纳/疑似注入文本等），无则空数组 | — |

### 教育学术语标注

- 核心概念（coreConcepts）：输出 brief.coreConcepts——「核心概念/关键术语，≤10 个」。
- 天然学习切分维度（naturalDivisions）：输出 brief.naturalDivisions 与规则 6——「这份资料天然适合的学习切分维度（如『按五大领域』『按年龄段』『按章节顺序』），必须来自正文实际组织方式」。
- 目标读者 / 适用对象（audience）：输出 brief.audience——「目标读者/适用对象（无法判断给 null）」（弱教育学含义，课程标准类文档分析常用维度）。

---

## path-material-collect（资料采集编排器 Skill，coreVersion: 1）

**角色**：资料采集抽取器——path-material-collect 编排链里唯一的 LLM 环节；编排器已完成检索、选源与抓取，本 skill 从一份外部网页正文中抽取可核验的结构化要点，并为每条要点附逐字引文（quote）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| （无字段化输入契约声明） | —（外部网页正文经 task 通道交入；使用通道为 task + evidence） | 编排器交入的一份外部网页正文；规则引用 need.title 判定资料名对得上与否（正文不是 need.title 所指资料时显式 not_found） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| status | enum | 采集结果状态：ok（要点齐全且均有引文）\| partial（部分覆盖/部分要点被丢弃）\| not_found（无可用正文或资料对不上）；not_found 必须显式返回，不得用记忆冒充资料内容 | — |
| pack | object? | 资料包（status=not_found 时为 null）；硬约束：keyPoints 里每条都必须有非空 cite 与 sourceUrl，没有引文的要点已被丢弃 | title（资料名）、publisher（发布/出版机构）、sourceTier（由编排器按域名分级，抽取侧不确定给 null）、sourceUrl（实际抽取所依据的正文 URL）、version（版本/年份）、fetchedAt（由编排器填写的抓取时间）、license（许可/版权）、tldr（正文浓缩 ≤120 字，不得引入正文之外信息）、sections[]（id「章节键」、title「章节/主题名」、summary「该章节要点概括」）、keyPoints[]（text「要点正文」、cite「逐字引文，必须来自给定正文」、sourceUrl「引文来源 URL」） |
| provenance | object[] | 引文溯源台账，与 pack.keyPoints 一一对应；quote 必须能在给定正文中原样找到 | pointId（形如 p-1、p-2…）、sourceUrl（该引文来源 URL）、quote（从正文逐字抄录的引文） |
| coverage | object | 覆盖度 | covered（正文实际覆盖的主题）、missing（目标需要但正文未覆盖的主题） |
| notes | string[] | 退化说明与丢弃台账（抓取失败/正文可疑/因缺引文被丢弃的要点数/疑似注入文本等），无则空数组 | — |

### 教育学术语标注

- 无（纯采集抽取管线；规则中只有「学习资料 / 学习建议 / 路径」等业务词，边界明确「不做评分、不给学习建议、不排路径、不评价用户」）。

---

## path-planning（路径规划 Skill，coreVersion: 8）

**角色**：认知建构师——先为用户的真实问题构建隐藏的认知图景（cognitiveCore），再据此设计一条阶段化的学习骨架（milestones）；优先围绕用户要产出的真实交付物组织路径。阶段内 subtasks 由后续 path-task-design 单独生成。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| rawGoal（string） | `sandbox:path.normalizedInput.learnerProfile.surfaceGoal`（编排注入） | 原始学习目标（用户原话，经定帧进入 normalizedInput） |
| normalizedInput（object） | `sandbox:path.normalizedInput`（编排注入） | 路径定帧主真相源（编排层 buildFramedNormalizedInput 确定性产出） |
| confirmedProposal（object） | `sandbox:path.normalizedInput.confirmedProposal`（编排注入） | 用户确认的方向（learningDirection/firstDeliverable/keyStages/outOfScope） |
| confirmedProposal.learningDirection | 同上 | 学习方向 |
| confirmedProposal.firstDeliverable | 同上 | 首个可交付物 |
| confirmedProposal.keyStages | 同上 | 关键阶段轮廓 |
| confirmedProposal.outOfScope | 同上 | 明确不做的范围 |
| conversationHistory（object[]） | `sandbox:goal.collectedData.history`（编排注入） | 完整对话历史（验证关键信息） |
| replan（object?） | `sandbox:path.replan`（编排注入） | 路径重调上下文（模式/触发来源/冻结任务/学习者投影；规则另引用 replan.reviewerFeedback——评审指出的结构缺陷） |
| adjustments（string?） | `sandbox:path.normalizedInput.understanding.adjustments`（编排注入） | 用户侧补充说明（path 页面「补充说明重新生成」）：用户明确说哪里不合适，重规划时最高优先级输入 |
| pathTopologyHint（string?） | `sandbox:path.normalizedInput.pathTopologyHint`（编排注入） | 定帧层给出的拓扑强信号：只有 exam（intent_type=exam）与 exploratory（entry_state=exploratory）两种；出现时必须采纳 |

说明：执行规则另引用 normalizedInput 的下列子键（不在契约声明行内，供后续调研追溯）：planningHints（conceptRange / milestoneRange / targetMilestones / targetTotalHours / targetHoursPerMilestone / targetMinutesPerTask / stageMinutesBudget / subtaskMinutesRange / subtasksPerStageRange）、timeDimensions（sessionsLengthMin / objectiveScopeHours / scopeAnchorHours / deadlineDate / maxWeeksSource）、successCriteria（observableResult / acceptanceCheck）、learnerProfile（entryState / goalOrientation / currentBaseline.level）、learnerLearningContext（masteredConcepts / fragileConcepts / strugglingConcepts / blockedFoundations / recurringConfusions / challengeLevelCap / paceMode / fatigueRisk / recommendedPacing）、prerequisiteCheckResults、materials（sections[].id / keyPoints[].cite）、backgroundExperience。

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| name | string | 路径名称 = 核心主题/技能 + 学完能做什么，8-20 字；禁止交付口径水平词（入门/起步/基础/零基础/进阶/精通/实战）与「从零开始」 | — |
| summary | string? | 用 1-2 句话概括这条路径适合谁、解决什么问题；缺省时列表页用 sceneSummary 兜底；不贬低学习者 | — |
| totalMilestones | number | 里程碑总数，与 milestones 数组一致 | — |
| topology | string | 路径拓扑，只允许 exploratory\|builder\|exam\|diagnostic 之一；判定依据见「路径拓扑」规则 | — |
| estimatedHours | number? | 内部容量参考值：按用户时间预算粗估的总投入小时；任务分钟由 path-task-design 逐任务产出后系统以真实汇总回写，此值不直接对外展示 | — |
| estimatedWeeks | number? | 预估总周数，不超过输入约束（可缺省） | — |
| cognitiveCore | object | 正式认知结构 | cognitiveDomain（这条路径主要训练的一体化底层能力）、coreConcepts[]（id「concept-1」、name「关系描述式概念名 12-28 字」、role「恰好一个 hub，其余 supporting」、description）、domainAnchors（canonicalModels「2-3 个公认理论/模型真名」、canonicalArtifacts「1-2 个标准分析载体」、commonMisconceptions「1-2 条新手头号误区」）、prerequisiteTree（rootConcept「目标核心概念」、knownConcepts「已确认掌握的前置」、unknownConcepts[]（concept、depth「1-3」、note「需补什么」）、gapChain「按深度从基础到高级排序的缺口概念」、maxDepth=3）、loadProfile（stageLoadDistribution[]（stageNumber、loadTarget「low\|medium\|high」、zpdDistance「close\|moderate\|far」）） |
| cognitiveDesign | object? | 已退役兼容镜像字段：LLM 不再输出，系统在 normalize 层用 cognitiveCore 自动补齐（保留声明仅为兼容旧 schema 校验与下游值载体） | — |
| milestones | object[] | 正式阶段骨架（只写阶段级，不含 subtask/acceptanceCriteria/周计划）；title 必须表达「认知动作 + 关系对象」；每项绑定 1 个 coreConcept | stageNumber（如 1）、title、coreConcept（concept-id）、description、goal、estimatedHours（如 4）、materialRefs[]（packIndex、sectionId「取资料包 sections[].id」、quote「逐字复制资料原文片段，代码逐字核对，不过关即丢弃」） |

### 教育学术语标注

- 认知建构（建构主义色彩）：身份「你是一位认知建构师」；「先识别这条路径真正要建立的底层认知结构」。
- 认知负荷理论（CLT，Cognitive Load Theory）：规则 45「认知负荷分区（CLT）」——loadTarget、intrinsic load（「首阶段 intrinsic load 必须 low」）、概念交互密度（「相邻 milestone 新概念数 ≤2，同一 milestone 内同时出现的新概念 ≤3」）；规则 32「按认知负荷分配（收尾/过渡可轻，主阶段必须重）」；输出 cognitiveCore.loadProfile。
- 最近发展区（ZPD）：输出 loadProfile.stageLoadDistribution[].zpdDistance（close\|moderate\|far）；规则 41「zpdDistance 可设更远、可含开放探索」。
- 心智模型（mental model）：规则 45——「首阶段 intrinsic load 必须 low（最少新概念、先建 mental model 入口）」。
- 迷思概念 / 直觉误区（misconception）：domainAnchors.commonMisconceptions「1-2 条新手头号误区」；规则 16「每个阶段对应学习者在通往目标途中必踩的一个【独立认知盲区/直觉误区】」。
- 学习迁移（transfer）：规则 11 三检验——「可迁移（换个相近领域仍成立）、非任务、可指导」；动作族「迁移/综合」；规则 36「迁移场景」。
- RPKT 前提知识递归发现 / 前提知识缺口链：规则 43——「对未知前置递归追问『要理解 X 必须先懂什么』，最大深度 3 层，直到触及已确认的知识边界；缺口写入 cognitiveCore.prerequisiteTree，milestone 顺序必须匹配缺口链深度」。
- 前置探测 / 前测（诊断性评估）：规则 44「前置探测结果硬约束（normalizedInput.prerequisiteCheckResults）：这是用户实际作答的硬证据，优先级高于 RPKT 推断」。
- 学习证据 / 掌握状态（形成性评估数据）：规则 46——「学习证据优先于自述（learnerLearningContext）：masteredConcepts 已稳定的不必从零重建；fragileConcepts/strugglingConcepts 必须在早期回补；blockedFoundations 进入 unknownConcepts；recurringConfusions 显式安排一次纠正机会」。
- 成就目标取向（掌握型 / 表现型）：规则 41——「goalOrientation：偏掌握型（想搞懂原理、知其所以然）→ 可给更高挑战与失败容忍空间；偏表现型（想做出成果、证明自己）→ 首阶段必须给快速成功小任务建立信心」。
- 考试焦虑（test anxiety）：规则 37 备考主线守护——「禁止把『对抗考试焦虑/建立信心/缓解压力』组织成路径主体（例外：用户明确说『知识都会，就是心态崩了』）」。
- 学习疲劳（fatigueRisk）：规则 46——「fatigueRisk=high 时首阶段 loadTarget 降一档且相邻新概念数 ≤1」。
- 行为表现验收 / 表现性评价：规则 25「验收写表现，不写作品」——「可验证的行为表现——『无提示连续判对 N 个带陷阱的新例』『限时连做 N 题正确率不低于 X%』『能把判断依据讲给人听』」。
- 变式（变式练习）：规则 16「任务外变式阶段」「边界反例深潜」；规则 34「次要盲区并入相邻阶段作变式深潜」。
- 认知动作（布鲁姆式动词）：规则 19——milestone title「必须表达『认知动作 + 关系对象』」。
- 执行意图（implementation intentions）：规则 28——「习惯改造就教执行意图（『如果…就…』计划）」。
- 能力增量 / 认知递进：规则 23「阶段递进轴只有一根：能力增量」——「要么引入新动作族（识别/还原 → 诊断/纠错 → 设计/映射 → 搭建/配置 → 论证/产出 → 迁移/综合），要么在同一动作族上把难度抬起来」。
- 认知透镜（内部隐喻，迷思概念同族）：规则 16「阶段即认知透镜」——「提供一副破局的【认知透镜】（= 绑定的 coreConcept）」；「透镜互异」。
- 动机分流：规则 42「动机分流传导」——motivation 信号（纯兴趣/通勤听 vs 考试/转行）决定通识阅读型 vs 应试型组织方式。
- 零基础 / 水平标签（currentBaseline.level）：规则 53——level（beginner/intermediate/advanced/unknown）只用于难度与前置假设及 summary，不写入名称；「与 evidence/backgroundExperience 冲突时以 evidence 为准」。

---

## path-reviewer（路径评审 Skill，coreVersion: 3）

**角色**：学习路径质量评审器——评审 path-planning 生成的学习路径（不直接面对用户），对路径做五维度评分，指出具体缺陷，给出可执行的重规划指令。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| pathPlan（object） | `skill:path-planning.milestones`（skill 上游模型输出） | 已生成的路径规划（name/summary/cognitiveCore/milestones/estimatedHours） |
| pathPlan.name | 同上 | 路径名称 |
| pathPlan.summary | 同上 | 路径概括 |
| pathPlan.cognitiveCore | 同上 | 认知结构 |
| pathPlan.milestones | 同上 | 阶段骨架 |
| pathPlan.estimatedHours | 同上 | 估时 |
| goalContext（object） | `sandbox:path.normalizedInput`（编排注入） | 目标上下文（surfaceGoal/confirmedProposal/successCriteria/learnerProfile） |
| goalContext.surfaceGoal | 同上 | 用户原始诉求 |
| goalContext.confirmedProposal | 同上 | 用户确认的方向 |
| goalContext.successCriteria | 同上 | 成功标准 |
| goalContext.learnerProfile | 同上 | 学习者画像（含 entryState、currentBaseline 等） |
| prerequisiteTree（object?） | `sandbox:path.prerequisiteTree`（编排注入） | RPKT 前提知识缺口链（可选，存在时用于校验路径是否覆盖了已知缺口） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| score | number | 总分 0-1（五维度加权平均） | — |
| dimensions | object | 五维度评分，每项 0-1：Clarity 0.2 / Integrity 0.25 / Depth 0.2 / Practicality 0.2 / Pertinence 0.15 | clarity（清晰度）、integrity（完整性）、depth（深度）、practicality（实用性）、pertinence（适配性） |
| issues | object[] | 具体缺陷列表，每项含维度、严重度、描述与建议 | dimension（如 integrity）、severity（low\|medium\|high）、description（具体缺陷描述）、suggestion（修改建议） |
| passed | boolean | overall ≥ 0.75 时为 true；false 时编排层触发路径重规划 | — |
| replanInstructions | string? | 仅 passed=false 时输出的具体重规划指令（如「将 milestone-3 拆分为两个阶段」），必须引用具体 milestone 编号或概念名，不可只给笼统建议 | — |

### 教育学术语标注

- 脚手架式按需供给（scaffolding on demand）：规则 4 Integrity——「unknownConcepts 是否都作为盲区阶段的透镜材料按需供给（禁止要求在阶段 1 之前单插无挑战的『基础导论/预备阶段』）」；issues 示例「未把偏导数作为透镜材料供上」。
- 认知透镜 / 盲区 / 破局（内部隐喻，迷思概念同族）：规则 4「盲区阶段」「破局」「空壳阶段应判缺陷并要求原地换芯」；规则 9「写不出具体翻车点或判别题的阶段」「可证伪的翻车点」。
- 认知动作（布鲁姆式动词）：规则 3 Clarity——「milestone title 是否表达『认知动作 + 关系对象』」。
- 可迁移能力（transfer）：规则 5 Depth——「cognitiveDomain 是否是可迁移的一体化能力而非任务清单？coreConcepts 是否通过可迁移/非任务/可指导三检验？」。
- 能力增量（递进）：规则 5——「相邻阶段是否构成能力增量」。
- 脆弱概念（fragile concepts，形成性评估数据）：规则 9「学习证据冲突：路径无视 learnerLearningContext（已掌握仍在从零重建、fragile 概念未在早期回补、前置探测已答对仍当未知）」。
- 前置探测 / 前测：规则 9 同上——「前置探测已答对仍当未知」。
- 五维度评审 rubric（Clarity / Integrity / Depth / Practicality / Pertinence）：规则 2——内部质量评审维度（评审性评价，非学界标准术语，但属评价量规方法）。
- 适配性（因材施教式匹配）：规则 7 Pertinence——「难度与节奏是否匹配 learnerProfile 的水平与背景？名称是否仍结果导向、没有误用『入门/基础』等起点标签？文案是否中性、不贬低学习者？」。
- hub concept 复用（核心概念的螺旋式回捞）：规则 4——「hub concept 是否被非首阶段显式复用」（螺旋课程 spacing/复现的内部近似）。

---

## path-task-design（阶段设计 Skill，coreVersion: 1）

**角色**：阶段任务设计师——不重新规划整条学习路径，只围绕一个已确定的 milestone，为当前阶段生成一组可执行但不过度教学化的 subtasks。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| milestone（object） | `skill:path-planning.milestones`（skill 上游模型输出） | 当前服务的 milestone（loopOver 逐阶段喂入） |
| previousMilestone（object?） | `sandbox:path.previousMilestone`（编排注入） | 前一里程碑上下文（title 与 coreConcept），consolidate 回捞的输入真相源；tasks 是上一阶段真实生成的任务清单（串行生成下前阶段完成后才注入，首阶段不注入） |
| previousMilestone.title | 同上 | 前一阶段标题 |
| previousMilestone.coreConcept | 同上 | 前一阶段绑定概念 |
| previousMilestone.tasks[].title | 同上 | 前一阶段真实任务标题（去重事实源） |
| previousMilestone.tasks[].type | 同上 | 前一阶段任务类型 |
| previousMilestone.tasks[].estimatedMinutes | 同上 | 前一阶段任务估时 |
| cognitiveCore（object） | `skill:path-planning.cognitiveCore`（skill 上游模型输出） | 认知结构，约束子任务的概念归属 |
| normalizedInput（object?） | `sandbox:path.normalizedInput`（编排注入） | 场景/预算/成功标准上下文（编排层确定性定帧注入） |
| pathTopology（string?） | `sandbox:path.pathTopology`（编排注入） | 路径拓扑（exploratory\|builder\|exam\|diagnostic，来自 path-planning）：决定任务形态——builder 要有贯穿作品的材料与架构/配置产出；exam 要有真题与模考；diagnostic 要有翻车靶子与真实材料诊断 |
| materials（object[]?） | `sandbox:path.materials`（编排注入） | 该路径关联的资料包（用户附件在前、联网采集在后）；无资料时不出现该键 |
| materials.title | 同上 | 资料名 |
| materials.sourceUrl | 同上 | 资料来源 URL |
| materials.sections[].id | 同上 | 资料章节键（materialRefs.sectionId 取自这里） |
| materials.sections[].title | 同上 | 资料章节标题 |
| materials.keyPoints[].text | 同上 | 资料要点正文 |
| materials.keyPoints[].cite | 同上 | 资料要点逐字引文 |
| repairHints（object?） | `sandbox:path.repairHints`（编排注入） | 上一次生成的修复提示（质检不合格重试时的输入）；主链路首轮恒为空，不出现该键 |
| repairHints.materialBodyViolations | 同上 | 材料自足性语义质检失败的任务清单（string[]），逐条给材料本体或删掉那句承诺 |
| supplementRequest（object?） | `sandbox:path.supplementRequest`（编排注入） | 补课调用（服务层检测到本阶段课数不足 targetSubtasksForStage 的 70% 时注入）；出现时只做增量补课，不重写既有任务 |
| supplementRequest.needed | 同上 | 需补任务数 |
| supplementRequest.existing[].title | 同上 | 既有任务标题 |
| supplementRequest.existing[].type | 同上 | 既有任务类型 |
| supplementRequest.minutesRange | 同上 | 补课任务分钟区间 |
| supplementRequest.stageNumber | 同上 | 目标阶段号 |
| schoolAnchor（object?） | `sandbox:path.schoolAnchor`（编排注入） | 校内锚（学习者在读某套教材/考试体系时由服务层确定性抽取）；出现时阶段目标与课标题必须引用其中的册次/单元/考试范围，不得编造 |
| schoolAnchor.textbook | 同上 | 教材版本+册次 |
| schoolAnchor.examScope | 同上 | 考试范围 |
| schoolAnchor.schoolPace | 同上 | 学校进度 |
| schoolAnchor.evidence | 同上 | 依据 |
| pathStageMap（object?） | `sandbox:path.pathStageMap`（编排注入） | 全路径阶段地图（服务层注入），用于对位次与全路径分工；无该键则不做跨阶段假设 |
| pathStageMap.stageCount | 同上 | 阶段总数 |
| pathStageMap.currentStageNumber | 同上 | 当前阶段号 |
| pathStageMap.stages[].stageNumber | 同上 | 各阶段号 |
| pathStageMap.stages[].title | 同上 | 各阶段标题 |
| pathStageMap.stages[].estimatedHours | 同上 | 各阶段估时 |
| allPreviousStageTasks（object[]?） | `sandbox:path.allPreviousStageTasks`（编排注入） | 全部前序阶段的真实任务标题（服务层注入），是跨阶段去重的完整事实源；本阶段任何 subtask 的「动作+对象」组合不得与其中任一任务同义 |
| allPreviousStageTasks[].stageNumber | 同上 | 前序阶段号 |
| allPreviousStageTasks[].tasks | 同上 | 该阶段任务标题列表 |
| previousStageOutcome（object?） | `sandbox:path.previousStageOutcome`（编排注入） | 上一阶段真实学习结果（动态规划信号）——已发生的学习事实而非建议：出现时按「学习信号驱动」调整坡度与补强位置 |
| previousStageOutcome.source | 同上 | 信号来源 |
| previousStageOutcome.previousStageNumber | 同上 | 上一阶段号 |
| previousStageOutcome.fragileConcepts | 同上 | 脆弱概念列表（须早期回补） |
| previousStageOutcome.strugglingConcepts | 同上 | 挣扎概念列表（前段安排 ≤2 个补强任务） |
| previousStageOutcome.prerequisiteGaps | 同上 | 前置缺口（必须先补再进新内容） |
| previousStageOutcome.stillLearning | 同上 | 仍在学习的概念 |
| previousStageOutcome.recommendation | 同上 | 建议（accelerate / reinforce / slow_down） |
| previousStageOutcome.reasonCodes | 同上 | 原因码 |
| previousStageOutcome.fatigueRisk | 同上 | 疲劳风险（high 时不排高负荷长任务） |
| previousStageOutcome.paceMode | 同上 | 节奏模式 |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| subtasks | object[] | 阶段内任务方向列表；每节课必须走完一个完整闭环（拆解 → 落成产物 → 做对一次）；阶段间递进轴是能力增量 | title（任务标题：学习动作与场景焦点；不写排期句、不写谜底）、type（acquire\|deconstruct\|model\|execute\|diagnose\|refine\|consolidate）、estimatedMinutes（单次时长；30-90 默认；上界是单课时长硬约束）、description（给人看的 1-2 句任务简介，列表页展示；题面与答案分离）、materialPayload（课堂要用的材料本体：题面/日志原文/样本值/原文片段；可选，首选）、acceptanceHint（一个轻量完成信号；必须是可判定的过关判据）、linkedConcept（当前阶段 coreConcept 的 concept-id，或同一 cognitiveCore 内 supporting concept-id）、knowledgeType（factual\|conceptual\|procedural\|metacognitive）、cognitiveLevel（remember\|understand\|apply\|analyze\|evaluate\|create）、icapLevel（active\|constructive\|interactive；同一阶段内非递减）、adjustability（core\|flexible）、transferable（boolean，可迁移标注）、materialRefs[]（packIndex、sectionId、quote「逐字复制资料里的原文片段」）、anticipatedMisconceptions[]（conceptKey「与 linkedConcept 同源」、label「学习者对该概念最容易形成的一句错误理解」、why「为什么会自然地这么错」；可选课前迷思预判，每任务至多 2 条） |

### 教育学术语标注

- ICAP 框架（Chi & Wylie 课堂参与分类）：规则 33「ICAP：每个 subtask 必须标 icapLevel（passive\|active\|constructive\|interactive），依据是要求的外显行为而非 type 名称」；映射规则含「与同伴讨论共建 → interactive」「同一阶段内 icapLevel 非递减」。
- 布鲁姆认知过程维度（修订版布鲁姆分类）：输出 cognitiveLevel——「remember\|understand\|apply\|analyze\|evaluate\|create」；「cognitiveLevel 只作目标深度标注，不约束任务顺序」。
- 知识维度四分（Anderson & Krathwohl）：输出 knowledgeType——「factual\|conceptual\|procedural\|metacognitive」；metacognitive 即元认知知识。
- 迷思概念 / 易错点预判（misconception）：输出 anticipatedMisconceptions——「可选的课前迷思预判：仅当你能具体说出『学习者在这个任务上很容易先想错成什么』时才给」；边界约束「只描述学习者易错点，不得包含教学内容、讲解话术或标准答案」。
- 学习迁移（transfer）：输出 transferable；规则 3「机制理解 → 操作实现 → 边界防御 → 迁移应用」认知分面；规则 10 动作族「迁移/综合」。
- 认知负荷（loadTarget / 概念交互密度）：规则 34——「milestone 的 loadTarget：low 时至少 60% subtasks 为 acquire/deconstruct 且每任务只引入 ≤1 个新概念；medium 时 model/execute 占比 ≥40%、允许 2-3 个概念交互；high 时 diagnose/refine 占比 ≥30%、允许 3-4 个概念同时交互」。
- 学习疲劳（fatigueRisk）：输入 previousStageOutcome.fatigueRisk；规则 36⑤——「fatigueRisk=high → 不排高负荷长任务，拆成更短的单次可完成单元」。
- 形成性学习信号（课堂学习事实回传）：输入 previousStageOutcome——fragileConcepts（脆弱概念）/ strugglingConcepts（挣扎概念）/ prerequisiteGaps（前置缺口）/ stillLearning；规则 36「学习信号驱动：strugglingConcepts/stillLearning 必须在本阶段前段安排 ≤2 个补强任务……prerequisiteGaps 必须先补再进新内容」。
- 内化（认知内化 / 身体内化，internalization）：规则 17——skillNature=cognitive_internalized「核心动作必须学习者本人做，AI 只能当出题人、事后对照者、卡壳诊断者」；physical_internalized「平台看不到手、听不到音、看不见画」；knowledge_structure「学习者必须自己复述或重建」。
- 执行意图（implementation intentions）：规则 8——「习惯改造就教执行意图」。
- 变式（变式练习）：规则 8「中间课做变式推演」；规则 10「变式靶子换情景」「课内变式」「任务外变式」。
- 认知梯度（渐进挑战）：规则 23「认知梯度靠『在真材料上做小步骤』实现，不靠『先全部学完再真实操作』」；规则 38「按认知梯度续接」。
- 同伴学习 / 协作学习（peer / collaborative learning）：规则 49——「禁止虚构『向同伴讲解/互相出题/与同行交流』类任务……只有输入明确存在同伴/班级/学习小组时才允许社交类任务」；规则 33 interactive「与同伴讨论共建」。
- 真实性任务 / 情境化（authentic tasks）：规则 22「真实场景与判断锚：每个阶段安排 1-2 个『面向学习者目标场景的真实动作』任务——在真实材料/真实约束下做一次判断、一个决定、一次演练」。
- 概念门槛门控（前置知识 gate）：规则 19「概念门槛 gate」——「学习者尚不掌握该概念的信号……stage-1 的第一个任务必须是 acquire/deconstruct（概念建立与对比）」。
- 巩固（consolidate，记忆/知识巩固语义）：任务类型 consolidate；规则 7「consolidate 不强制每阶段 ≥1：只有真正收束一个判断能力（综合实战、跨阶段合龙）时才用」；规则 6「consolidate 回捞」。
- 暴露误区 → 建立判断 → 独立做对（错误暴露与修正闭环）：规则 27 Exit Criteria——「学习者在该任务内走完『暴露误区/接触新约束 → 建立或调用判断口径 → 独立做对一次无提示判断』的完整闭环」。

---

## semantic-freeze-judge（语义冻结裁判，coreVersion: 1）

**角色**：Prompt 语义等价审查员——判断一份「核心文件」（业务真相源 SSOT）与一份「编译产物 Prompt」（候选运行文本）在业务语义上是否等价；只做语义对账，不评价文笔。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要 |
|------|----------|----------|
| （无字段化输入契约声明） | —（使用通道为 task「当前任务/场景/控制指令」） | 两份材料：【核心文件】（SSOT，含 identity/channels/rules/fields/constraints）与【编译产物】（五块结构 Prompt：身份/使用通道/执行规则/输出字段/边界约束） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
|------|------|----------|--------|
| verdict | enum | equivalent \| uncertain \| divergent；四个语义面（字段/规则/约束/身份与通道）全部等价 → equivalent；存在增删或含义改变 → divergent；无法确定 → uncertain | — |
| findings | object[] | 语义差异清单（equivalent 时为空数组） | aspect（fields\|rules\|constraints\|identity\|channels，具体语义面）、issue（具体差异描述）、severity（critical「字段或硬约束丢失/改变」\| major「规则义务弱化或部分丢失」\| minor「可疑但大概率无害」） |
| rationale | string | 一句话总结判定依据，不超过 80 字 | — |

### 教育学术语标注

- 无（纯编译器语义对账判定器；「核心文件 / 编译产物 / 字段语义 / 规则义务」均为编译工程用语）。

---

## 附：本批教育学术语总索引（跨 skill 去重）

| 术语 | 出处 skill 与语境 |
|------|------------------|
| 脚手架（scaffolding） | goal-conversation 规则 21「脚手架我来给」；path-reviewer 规则 4「透镜材料按需供给」 |
| 动机式访谈 MI（change talk / sustain talk / evoking / 正常化 / 承诺强度） | goal-conversation 规则 68、state.motivation_signal / mi_frames |
| 归因（外部/内部/策略归因） | goal-conversation mi_frames.ProblemFrame.attribution |
| 自主 / 胜任 / 归属（SDT 基本心理需要） | goal-conversation understanding.sdt_needs |
| 首胜体验（成功体验 / 自我效能族） | goal-conversation sdt_needs 语境 |
| 掌握型 / 表现型目标取向（成就目标理论） | goal-conversation understanding.goal_orientation；path-planning 规则 41 goalOrientation |
| 认知带宽（认知资源） | goal-conversation understanding.cognitive_bandwidth |
| 心智模型（mental model） | goal-conversation first_deliverable；path-planning 规则 45 |
| 前置知识探测 / 前测（诊断性评估） | goal-conversation 规则 51 + prerequisiteCheckResults；path-planning 规则 44；path-reviewer 规则 9；path-task-design previousStageOutcome.prerequisiteGaps |
| 内化（认知内化 / 身体内化，internalization） | goal-conversation 规则 59；path-task-design 规则 17 |
| 神经回路 / 肌肉记忆 | goal-conversation 规则 59 |
| 认知共情（empathy） | goal-conversation 输出 reply |
| SMART 目标（目标设定） | goal-conversation 规则 39 |
| 认知盲区 / 直觉误区 / 迷思概念（misconception） | goal-conversation 规则 35；path-planning 规则 16 + domainAnchors.commonMisconceptions；path-task-design anticipatedMisconceptions；path-reviewer 规则 4/9（透镜 / 盲区 / 翻车点） |
| 知识组件（KC，knowledge component） | path-kc-mapping 全篇（可独立习得、可单独评估的能力单元） |
| 知识维度四分 factual/conceptual/procedural/metacognitive（元认知） | path-kc-mapping 规则 7 taxonomy；path-task-design 输出 knowledgeType |
| 布鲁姆认知过程维度（remember…create） | path-task-design 输出 cognitiveLevel；path-planning / path-reviewer「认知动作 + 关系对象」 |
| 前置依赖 / 前提知识（prerequisite） | path-kc-mapping prerequisiteKCs；path-planning RPKT prerequisiteTree |
| RPKT 前提知识缺口链（递归发现） | path-kc-mapping 输入；path-planning 规则 43；path-reviewer 输入 |
| 认知建构（建构主义色彩） | path-planning 身份「认知建构师」 |
| 认知负荷理论 CLT（loadTarget / intrinsic load / 概念交互密度） | path-planning 规则 32/45 + loadProfile；path-task-design 规则 34 |
| 最近发展区（ZPD，zpdDistance close/moderate/far） | path-planning loadProfile；规则 41 |
| 学习迁移（可迁移检验 / transferable / 迁移动作族） | path-planning 规则 11/36；path-reviewer 规则 5；path-task-design transferable |
| 学习证据 / 掌握状态（mastered / fragile / struggling / blocked / recurring） | path-planning 规则 46；path-reviewer 规则 9；path-task-design previousStageOutcome |
| 考试焦虑（test anxiety） | path-planning 规则 37 |
| 学习疲劳（fatigueRisk） | path-planning 规则 46；path-task-design previousStageOutcome.fatigueRisk |
| 行为表现验收 / 表现性评价（「验收写表现，不写作品」） | path-planning 规则 25；path-reviewer Pertinence；goal-conversation first_deliverable |
| 变式（变式练习 / 课内变式 / 变式推演） | path-planning 规则 16/34；path-task-design 规则 8/10 |
| 执行意图（implementation intentions，「如果…就…」计划） | path-planning 规则 28；path-task-design 规则 8 |
| 能力增量 / 认知递进 | path-planning 规则 23/55；path-reviewer 规则 5；path-task-design 规则 10 |
| 认知透镜（内部隐喻：绑定 coreConcept 破除盲区） | path-planning 规则 16；path-reviewer 规则 4 |
| 动机分流（动机信号决定组织形态） | path-planning 规则 42；path-task-design 规则 50 |
| 脚手架式按需供给（透镜材料按需供给） | path-reviewer 规则 4 |
| 五维度评审 rubric（Clarity/Integrity/Depth/Practicality/Pertinence） | path-reviewer 规则 2（内部评审量规） |
| 适配性（难度节奏匹配学习者画像） | path-reviewer 规则 7 Pertinence |
| ICAP 框架（passive/active/constructive/interactive） | path-task-design 规则 33 + 输出 icapLevel |
| 同伴学习 / 协作学习 | path-task-design 规则 33 interactive、规则 49 |
| 真实性任务 / 情境化（真实场景动作） | path-task-design 规则 22/41 |
| 概念门槛门控（前置知识 gate） | path-task-design 规则 19 |
| 巩固（consolidate 任务类型） | path-task-design 规则 7/24 |
| 暴露误区 → 建立判断 → 独立做对（错误修正闭环） | path-task-design 规则 27 Exit Criteria |
| 核心概念 / 天然学习切分维度（资料理解侧） | path-material-brief brief.coreConcepts / naturalDivisions |
