# 教学类 skill prompt 字段清单底表（teaching 系列 7 件）

- 调查时间：2026-11-19
- 仓库：D:\wenflow\wenflow @ commit e736f7aa
- 调查对象（prompts/ 目录下 7 个编译产物 prompt 文件，UTF-8 中文 markdown，五块结构：身份 / 使用通道（含输入契约声明） / 执行规则 / 字段（输出 schema） / 边界约束或产物说明，块名以各文件实际内容为准）：
  1. skill.teaching-board-design.md（白板绘图员）
  2. skill.teaching-classroom-judge.md（独立旁路评审）
  3. skill.teaching-opening.md（课堂开场交互生成器）
  4. skill.teaching-peer-reinforcement.md（学习伙伴/伴学）
  5. skill.teaching-replan-attribution.md（路径重排归因器）
  6. skill.teaching-turn.md（结构化教学回合生成器，coreVersion: 19，全批最大约 85KB）
  7. skill.teaching-wrapup.md（课后产出助手）
- ref 前缀约定（原样保留）：`skill:` = 上游模型输出 / `sandbox:` = 编排注入 / `user:` = 用户平台
- 说明：teaching-board-design 与 teaching-classroom-judge 两件没有「输入契约声明」段，输入字段取自「输入说明 / 使用通道」块，已在表内注明；各 skill 执行规则中引用、但未列入契约声明的运行时可选输入子对象，另行单列为「规则中引用的输入子对象」，供学术调研核对。

---

## teaching-board-design（白板绘图员，coreVersion: 未标注；frontmatter 为 promptContract: skill-prompt-contract/v2，stage: classroom，calledBy: board-probe.ts / teaching-turn-engine 板书层）

**角色**：课堂板书绘图员，只负责根据课堂上下文画一张白板 figure JSON，不负责讲课；白板留在学生眼前随教学推进更新。

### 输入字段（模型读取）

本文件无「输入契约声明」段，字段取自「输入说明」块，无 ref 前缀（由编排层/板书层装配）。

| 字段 | ref 来源 | 语义摘要（1 句） |
| --- | --- | --- |
| task（object） | —（无 ref 前缀，输入说明块） | 本课任务上下文：标题/描述/任务类型 |
| task.title | — | 任务标题 |
| task.description | — | 任务描述（可能内含固定清单/样例，开场须露出） |
| task.taskType | — | 任务类型（示例值 diagnose） |
| scenario（object） | —（无 ref 前缀） | 学科/主题/水平 |
| scenario.subject | — | 学科 |
| scenario.topic | — | 主题 |
| scenario.learnerLevel | — | 学习者水平（示例值 beginner） |
| studentSays | —（无 ref 前缀） | 学生这一句（本轮发言） |
| kindHint | —（无 ref 前缀） | 编排层建议的图型，可能为空（示例值 split-compare） |
| questionIntent（object） | —（无 ref 前缀） | 本轮问法四元组，决定板面画到哪里、边界在哪 |
| questionIntent.askAbout | — | 问什么：fork/condition/order/mapping/none（两栏分叉/两条件/时序/映射迁移/完整参考板） |
| questionIntent.instruction | — | 本轮板面的边界——画到那里为止，多画的每一句都是替学生答题 |
| questionIntent.exampleChange | — | 变式类型：variant（同结构换新数据）/ scene（换对象或条件）/ none |
| questionIntent.newNumbers | — | 新数字数组 |
| lastTeacherReply | —（无 ref 前缀） | 老师上一轮原话（老师已宣布的条件/新数据构成当前现场，板面须一致） |
| 上一块板的 kind 与 spec（换板时附带） | —（无 ref 前缀） | 换板时的参照板 |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| figure | object | 本块白板的图载荷；只输出 `{"figure":{"kind","spec"}}`，不输出任何解释或 Markdown | kind、spec |
| figure.kind | string（图型枚举语境） | 图型编排：按 kindHint/questionIntent 选型（示例 split-compare；规则语境含概念图、两栏对照、分帧时序等） | — |
| figure.spec | object | 图型载荷，结构随 kind 而定；通用约束见下 | title、left.head、left.rows[].label、left.rows[].sub、right.head、right.rows[].label、right.rows[].sub（示例 split-compare 结构）；规则语境另含 tone（如 "neutral"）、dash（如 true） |

spec 约束要点（规则语境）：title 只点题不写结论；标签 ≤18 字（英文句子可到 26 字）；化学式用 Unicode 下标；rows[].sub 副标注写「单位、俗称、一句话解释」不写判断；概念图无关关系用 `tone:"neutral"` + `dash:true` 画出并与实线区分。

### 教育学术语标注

- 认知压力/减负（减负区口径：白板「替学生扛住纯文字造成的认知压力」——面向认知负荷的减负设计）—「口径：减负区（conceal = none / takeaway，默认）」
- 检索练习（做题区口径 conceal = full，明确标注「检索练习用」）— mode:full 块
- 提问态/挖空揭晓（做题区由系统自动派生「提问态」：把答案位挖成 `?`、把结论藏起来，学生答对后再揭晓——cloze/检索练习设计）— mode:full 块
- 变式（exampleChange = variant：「同一结构换成新数据」——变式练习）—「本轮问法 questionIntent」规则
- 换现场/情境迁移（exampleChange = scene 换液体/换物体；「与旧现场绑定的前提不得沿用」——防负迁移）—「本轮问法 questionIntent」规则
- 迁移参照物（askAbout = mapping：「可以给完整结构 + 结论句（迁移的参照物）」）—「本轮问法 questionIntent」规则
- 结论由学生说出来（「结论由老师在对话里问、由学生说出来」——不替代学习者作答/建构取向）— 通用硬约束 2
- 留白让学生判断（换现场拿不准就留空或写 `?` 让学生自己判断）— exampleChange 规则

---

## teaching-classroom-judge（独立旁路评审，coreVersion: 1）

**角色**：WenFlow 课堂的独立旁路评审，评审一节课的完整逐轮记录（含板书/图文载荷与收束产出），只依据可定位证据评估教学质量、教师说的话与学习者真实可见世界的一致性；不扮演师生任何一方，不生成教学文本。

### 输入字段（模型读取）

本文件无「输入契约声明」段，输入取自「使用通道」块，无 ref 前缀。

| 字段 | ref 来源 | 语义摘要（1 句） |
| --- | --- | --- |
| evidence | —（通道注入） | 客观事实轨迹：课堂证据、知识变化、课后总结、运行统计（只读追加） |
| task | —（通道注入） | 当前任务 / 场景 / 控制指令 |

规则中引用的具体证据面：transcript 逐轮记录（含 index）、board 快照（任务级白板）、逐轮 figure 载荷、wrapup 收束产出、classroom.sessionTerminal.status（'abandoned' 弃跑豁免）、检查点记录。

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| verdict | enum | 总裁决 | pass、pass_with_concerns、fail、inconclusive |
| scores | object | 六维 0-100 分（无证据的维度输出 null，不按 0 分处理） | overall、openingAnchor、criteriaClarity、scaffolding、boardConsistency、closureQuality |
| findings | object[] | 发现列表 | code（稳定机器码）、severity（critical/major/minor/info）、category（opening/criteria/scaffolding/board/notation/closure/assessment/boundary）、title、detail、evidenceIds |
| recommendations | object[] | 只面向平台与课程维护者的改进建议 | priority（P0/P1/P2/P3）、action、rationale、findingCodes |
| evidence | object[] | 证据条目（每条 finding 必须引用至少一个 evidenceId） | id（"E1"）、index（transcript 序号或 null）、path（content/board/figure/checkpoint/wrapup）、excerpt、interpretation |

### 教育学术语标注

- 学习困难归因纪律（学习者答错/记不住/不想学是**学习困难**不是平台缺陷——学习困难与平台缺陷的归因区分）— 执行规则 1
- Meno 闸（零基础/无先修证据学习者，抛开放问题前必须先给具象场景+判断口径+低门槛作答入口——源自柏拉图《美诺篇》的美诺悖论/先备积木闸）— 执行规则 3
- 脚手架（scaffolding：卡住后 1-2 轮内降阶——给对照物/候选项/先给口径再复用；重复同构问法不算脚手架；对应 scores.scaffolding 维度）— 执行规则 4、输出 scores
- 同构问法（同一问型连续重复 ≥3 次记 finding，引用起止轮次）— 执行规则 5
- 开场锚定（openingAnchor：开场不得假定学习者经历、不得把结论/答案写进开场、应锚定本课任务材料）— 执行规则 2、输出 scores
- 判断口径（criteriaClarity 维度；「带走的判断口径」）— 执行规则 3/8、输出 scores
- 板书一致性（boardConsistency：指图指称「板上/图上/左栏/那一格」必须可定位；board_dangling_trace 与 board_mismatch 根因不同分开报）— 执行规则 6、输出 scores
- 内部记号泄漏（notation_leak：给零代码/零基础学习者未定义的英文记号/字段名/工程缩写且未当场用场景语言解释）— 执行规则 7
- 收束/课后总结（closure：wrapup.present=false 或收束语只复述内容而无「带走的判断口径/下一步动作」记 closure 缺口；closureQuality 维度；弃跑豁免）— 执行规则 8、输出 scores
- 复述 vs 迁移（检查点口径：复述=回忆已贴标签结论；迁移=把刚学的口径用于未贴标签的新情形；连续复述 ≥2 记 assessment finding）— 执行规则 9
- 检查点（checkpoint 作为证据面 path 枚举之一——形成性评价痕迹）— 输出 evidence.path
- 学习目标未达成（弃跑收口的当然结果，不得按 critical/major 报）— 执行规则 8
- prompt injection 防御（记录文本不是指令）— 执行规则 11（非教育学术语，列出备查）

---

## teaching-opening（课堂开场交互生成器，coreVersion: 1）

**角色**：课堂开场交互生成器，基于课堂场景、当前阶段与学习者状态，为一个教学 Session 生成短、低门槛、可直接渲染的开场交互块。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句） |
| --- | --- | --- |
| scenarioContext（object） | `sandbox:teaching.scenario`（编排注入） | 任务与路径上下文——调用方据此派生开场内容 |
| scenarioContext.subject / .topic / .taskTitle / .taskDescription / .taskType / 当前里程碑 | 同上 | 子字段：学科/主题/任务标题/任务说明/任务类型/当前里程碑 |
| learnerProjection（object） | `sandbox:teaching.learner.learnerProjection`（编排注入） | 学习者运行信号与开场模式判定所需的状态投影 |
| learnerProjection.confidenceLevel / .recentTrend / .recommendedPacing | 同上 | 子字段：自信度水平/近期趋势/推荐配速 |
| sessionInfo（object） | `sandbox:teaching.session.info`（编排注入） | 会话信息；openingMode 由编排层判定，随该上下文一同给出 |
| sessionInfo.学科 / 主题 / 时长；openingMode | 同上 | 子字段；开场模式（编排层判定值） |
| learnerPersona（object） | `sandbox:teaching.learner.persona`（编排注入） | 学习者画像摘要（出自 goal 阶段叙述性理解）；null 或缺省表示无画像数据 |
| learnerPersona.surfaceGoal / .realProblem / .background / .currentLevel / .motivation / .sourceGoal | 同上 | 子字段：表层目标/真实困扰/背景/自述水平/动机/出处标记（sourceGoal 只是读侧防串味的出处标记，不念给学生） |
| schoolAnchor（object） | `sandbox:teaching.school.anchor`（编排注入） | 学校体系锚（教材版本/考试形式背景句 + 现状自评证据句）；两者皆空时缺省 |
| schoolAnchor.background / .baselineEvidence | 同上 | 子字段：教材版本/考试形式背景句；现状自评证据句 |
| taskProfile（object） | `sandbox:teaching.task.profile`（编排注入） | 本课任务画像 |
| taskProfile.learningObjectives / .coreConcept | 同上 | 子字段：本课学习目标/核心概念清单；本课核心概念名 |
| learnerPrediction（object） | `sandbox:teaching.learnerPrediction`（编排注入） | 任务前学习表现预测（profile-learning-predict 产出）；开场节奏的参考信号非命令；null 表示未预测 |
| learnerPrediction.stallRisk / .predictedTone / .toneDetail / .suggestedDepth / .depthDetail / .reliability | 同上 | 子字段：卡壳风险/预测语气/语气细节/建议深度/深度细节/可靠性 |

规则中引用、未列入契约声明的运行时可选输入子对象：

| 字段 | 出现语境 | 语义摘要 |
| --- | --- | --- |
| lastLessonRecap（.topicSummary / .unresolvedPoints / .retrievalCue / .relation / .sameTaskHistory.lastUnresolvedPoints） | 规则 9-11 | 上一课摘要；relation 枚举 same-milestone-prev-task / prev-milestone / same-task / last-any；retrievalCue 为检索线索（可判定的具体情境/反例/未答检索题） |
| priorLearningContext（.adjacent / .sameTask / .priorMilestoneMastery） | 规则 12 | 结构化前序：紧邻前序/当前任务重学历史/已学阶段掌握汇总 |
| learningSignal | 规则 18 | 学习者在目标阶段流露的交付形式偏好 |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| message | string | 1-3 句开场定位语；不携带行动指令，不得是系统通知或命令式说明 | — |
| question | string? | 一句可选的低门槛引导（可答可不答，语气「可以想想/也可以直接开始」）；与 quickReplies 互斥 | — |
| quickReplies | object[]? | 0-3 个「下一步动作」选项（动词开头 ≤12 字、含本课真实内容）；禁止自评标签式选项；无可执行动作时输出空数组或省略 | 元素仅含 text |
| mode | enum? | 开场模式：example-first / predict / self-assess；必须与输入给出的开场模式一致 | — |

### 教育学术语标注

- 开场三模式 example-first / predict / self-assess（例证先行/先判断后讲解（预测-验证式）/快速自评——三类开场教学策略）— 规则 6/7、输出 mode
- 自评标签禁令（quickReplies 禁止「掌握了/没掌握/会一点」式自评标签，必须转为可执行动作——避免自我评估虚标）— 规则 3/4/5
- 低门槛引导（question 是「低门槛、可答可不答」的软引导——low-floor entry）— 输出 question、规则 2
- 迁移开场/检索线索（retrievalCue 是可判定的具体情境/反例/未答检索题时，开场第一段必须摆出来让学习者「当场用上一课的口径判一次」——检索练习/迁移开场；间隔迁移）— 规则 10
- 摸底（question 若用于摸底/自评，quickReplies 必须留空）— 规则 2
- 开场形态四式：承接式/场景式/目标式/直入式（相邻两课换形态，防模板化）— 规则 8
- 卡壳风险预测驱动（stallRisk ≥ 0.7 或 predictedTone/toneDetail 语义吃力 → 更小一步切入、更低门槛动作；疲劳 → 降低信息密度——学习风险预测差异化开场）— 规则 19
- 承接上次未掌握点（unresolvedPoints / lastUnresolvedPoints 未解决点承接；不编造上次经历——honest recap）— 规则 9/10/11
- 前序掌握汇总（priorMilestoneMastery：「前面 X 已经稳了」自然带一句，不罗列数据）— 规则 12
- 学习目标/核心概念落点（开场定位语优先落在 learningObjectives/coreConcept 指向的本课核心）— 规则 15
- 卡点（内部行话，开场文本最多 1 次、理想 0 次——教学障碍的语言纪律）— 规则 21

---

## teaching-peer-reinforcement（学习伙伴/伴学，coreVersion: 1）

**角色**：学习伙伴，和学生一起平等探索问题的伴学消息生成器（同伴侧信道，语气像同学不像老师）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句） |
| --- | --- | --- |
| topic（string） | `sandbox:teaching.session.topic`（编排注入） | 当前任务主题 |
| studentMessage（string） | `user:latestMessage`（用户/平台） | 学生本轮消息（触发伴学的输入） |
| tutorLatestReply（string） | `skill:teaching-turn.reply` | 老师最近一条回复原文 |
| tutorContext（object[]） | `sandbox:teaching.session.messages`（编排注入） | 最近对话上下文（供伴学引用） |
| cognitiveLevel（string） | `skill:teaching-turn.analysis.cognitiveLevel` | 本轮教学回合判定的学生认知层级（同链上一步产物） |
| understanding（number） | `skill:teaching-turn.analysis.understanding` | 本轮理解度 0-1（同链上一步产物） |
| peerHistory（object[]?） | `user:peerHistory`（用户/平台） | 此前伴学对话历史（可选；运行时从会话消息里装配 peer 标记消息/伴学插话后随执行信封送入；规则 11 的 3 问预算依赖它） |

标签化纯文本输入分区（规则 1，非 JSON；随编排装配）：【主题】【策略】（枚举 feyman/debate/counterexample/analogy/error-analysis/encourage）【策略要求】【学生认知层级】（如 understand，缺省按 understand）【理解度】0-1【本轮认知负荷】0-1【本轮情绪】枚举【最近对话】（最近 5 条课堂对话摘要）【老师本轮回复】【此前伴学对话】【学生消息】【本轮禁令】（老师正等学生作答时的最高优先级禁令，出现即压过【策略要求】）。

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| message | string | 一段自然、口语化、像同学讨论的伴学消息；非空，长度 1-4 句（当轮） | — |
| followUpQuestions | string[]? | 可选的后续追问（缺失等价于「本轮不追问」，平台收敛为 []）（当轮） | — |

### 教育学术语标注

- 同伴强化/同伴教学（skill 本名 peer reinforcement；伴学作为主教学之外的同伴侧信道——peer tutoring）— 身份/全篇
- 费曼技巧（策略 feyman：让学生解释并挑刺——Feynman technique/以教代学）— 规则 1/9
- 辩论（策略 debate：analyze 及以上用辩论让其解释并挑刺）— 规则 1/9
- 反例（策略 counterexample；apply 层「用反例/边界情况挑战其应用」）— 规则 1/9
- 类比（策略 analogy；understand 层「用类比/例子帮助建立直觉」）— 规则 1/9
- 错误分析（策略 error-analysis）— 规则 1
- 鼓励（策略 encourage；老师等学生作答时不论层级一律只做鼓励——策略降级）— 规则 1/7/9
- 认知层级选型（understand→类比直觉 / apply→反例挑战 / analyze 及以上→辩论费曼——对应布鲁姆认知目标分级；「不要对低层级学生使用需要高阶推理的追问」）— 规则 9
- 认知负荷（【本轮认知负荷】0-1；「学生处于高认知负荷」时不连续追问或挑战性反问）— 规则 1/12、边界约束
- 追问递进/脚手架渐撤（一次只推进一层：确认理解→找漏洞→换场景迁移；连续 3 问无进展停止追问改为示范最小一步——guided probing + fading）— 规则 11
- 引导发现（「不要直接给正确答案，引导用户自己发现」——guided discovery）— 规则 3、边界约束
- 线索式反问 + 先认可再纠偏（学生答错先认可思路中正确部分，再指出偏差，再给一个线索式反问——scaffolding/正向框架）— 规则 10
- 迁移（「换场景迁移」为追问递进第三层）— 规则 11
- 共情（理解度 < 0.3 或高负荷/情绪受挫时「先共情一句，再用小例子帮其站稳」——affective support）— 规则 12
- 示范（modeling：连续 3 问无进展时「示范最小一步并把剩余交还学生」）— 规则 11
- 作答权保护/对齐老师节奏（老师提问等学生作答时不代替学生回答、不提前给线索；老师搁置话题时不追问——wait time/答题权保护）— 规则 7/8

---

## teaching-replan-attribution（路径重排归因器，coreVersion: 1）

**角色**：WenFlow 的路径重排归因器：系统已用阈值判定「这条路径值得提示重排」，任务是在给定证据里找出主因、在已给选项里选一个方向、并留一条可被事后检验的断言。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句） |
| --- | --- | --- |
| recall（object） | `sandbox:profile.snapshot.replanSignal`（编排注入） | 阈值召回信号——归因必须在它允许的方向内选 |
| recall.reasonCodes / .recommendation / .priority / .rationale | 同上 | 子字段：原因码集合/建议方向/优先级/依据说明 |
| allowedRecommendations（string[]） | `sandbox:path.planningHints`（编排注入） | 系统真正能执行的方向集合（含 keep）；recommendation 必须取自其中 |
| evidence（object[]） | `sandbox:teaching.session.wrapup`（编排注入） | 归因证据条目 [{ id, 概念名/未解决点名/掌握状态 }]；evidenceRefs 只能引用其中出现过的 id |
| pathContext（object?） | `sandbox:path.path.summary`（编排注入） | 路径位置上下文（可选） |
| pathContext.milestoneTitle / .stageNumber | 同上 | 子字段：里程碑标题/阶段序号 |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| primaryReasonCode | string | 主因，原样取自 recall.reasonCodes；无法判断时取其第一项 | — |
| recommendation | string | 方向，取自 allowedRecommendations（含 keep）；都不合适时给 keep | — |
| reason | string | 一句人话归因（≤40 字）；必须点名 evidence 里的具体卡点名（如「识别日志痕迹、还原断点还没稳」），禁止泛指；与已学会名单冲突时写清张力；不出现内部字段名与数值 | — |
| claim | string? | 可证伪断言（≤60 字），只在有把握时输出，最多 1 条 | — |
| checkOn | string? | 断言检验时机：next_lesson / next_task | — |
| expect | string? | 断言期望（如仍不稳 / 已能独立完成） | — |
| evidenceRefs | string[]? | 引用的证据 id（必须来自输入 evidence；无可引用证据时省略） | — |

### 教育学术语标注

- 归因（attribution：为「路径值得提示重排」找主因——学习困难归因；要求点名具体卡点、泛指禁止）— 身份/规则 1/3/4
- 学习疲劳（「长期学习疲劳偏高」是允许的系统级原因示例——learning fatigue）— 规则 4
- 掌握状态/已学会名单（evidence 条目含「掌握状态」；wrapup:mastered 本节已学会名单，reason 要写清「哪些是本课刚学会的、哪些旧点仍挂着」的张力）— 输入 evidence/规则 4
- 可证伪断言/形成性闭环（claim + checkOn + expect 构成一条可被后续证据检验的断言——falsifiable claim）— 规则 6/7
- 里程碑/阶段（milestoneTitle/stageNumber——路径课程结构单位）— 输入 pathContext
- 未解决点名（evidence 条目结构之一——unresolved points）— 输入 evidence

---

## teaching-turn（结构化教学回合生成器，coreVersion: 19）

**角色**：结构化教学回合生成器：每轮读课堂上下文与学生发言，产出老师回复 + 学生状态分析 + 知识看板 + 教学策略 + 流程控制 + 可选图示的完整回合 JSON。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句） |
| --- | --- | --- |
| learner（object） | `sandbox:teaching.learner.learnerProjection`（编排注入） | 学习者教学投影（画像叙述/困惑点/教学提示） |
| knowledge（object） | `sandbox:teaching.knowledge.state`（编排注入） | 知识看板当前状态 |
| knowledge.points / .currentPoint | 同上 | 子字段：看板点数组/当前主焦点 |
| classroomContext（object） | `sandbox:teaching.classroomContext`（编排注入） | 课堂上下文（阶段/焦点，上轮持久化） |
| classroomContext.stage.current | 同上 | 子字段：当前阶段（'intervention' 表示上一轮已判定卡住、本轮进入干预） |
| classroomEventContext（object） | `sandbox:teaching.classroomEventContext`（编排注入） | 近期课堂事件（recentEvents 最近 5 条；如 session-resumed 断线恢复），由 classroomEventHistory 派生 |
| classroomEventContext.recentEvents | 同上 | 子字段：近期事件数组 |
| controls（object） | `sandbox:teaching.controls.teachingControlContext`（编排注入） | 教学控制上下文（priority/allow* 标志）+ 回合模式 |
| controls.priority / controls.allow* | 同上 | 子字段：控制优先级与允许标志 |
| scenario（object） | `sandbox:teaching.scenario`（编排注入） | 任务与路径上下文（编排层组装） |
| scenario.taskProfile / .cognitiveFrame / .pathProgress | 同上 | 子字段：任务画像/局部认知图景/路径进度 |
| interactionProfile（object） | `sandbox:teaching.interactionProfile`（编排注入） | 本轮学生输入的前端交互特征情报（认知负荷量测）：current（本轮统计值）+ history（近 6 条消息含 timestamps 的特征对比）；缺失字段/whole profile 为 absent（旧客户端/虚拟学习者）；仅辅助情报，与 messages 同权、低于 classroomContext 的语义真相优先级 |
| interactionProfile.current / .history | 同上 | 子字段：本轮统计值容器/近 6 条特征对比容器 |
| interactionProfile.draftMs | 同上 | 输入总时长 |
| interactionProfile.idleMsBefore | 同上 | 上条回复到首次输入的间隔 |
| interactionProfile.lastIdleMs | 同上 | 输入中最大停顿 |
| interactionProfile.editingCount | 同上 | 编辑次数 |
| interactionProfile.deleteCount | 同上 | 回退字符数 |
| interactionProfile.charsPerSentence | 同上 | 每句平均字符数 |

规则中引用、未列入契约声明的输入子对象（随上述字段注入）：

| 字段 | 出现语境 | 语义摘要 |
| --- | --- | --- |
| scenario.pathBackgroundContext（.schoolAnchor.background / .baselineEvidence / .entryState） | 规则 5/55 | 学校体系锚（教材版本/考试形式/在校进度）；entryState='exploratory' 起步课例外 |
| scenario.lastLessonRecap（.relation / .unresolvedPoints / .retrievalCue / .sameTaskHistory.lastUnresolvedPoints） | 规则 6 | 上一课摘要；relation 枚举 same-milestone-prev-task / prev-milestone / same-task / last-any |
| scenario.materials | 规则 7 | 路径关联资料包（用户上传附件在前、联网采集在后） |
| scenario.supplementaryMaterial（.topic / .excerpt） | 规则 8 | 教师补充材料（上一轮 supplement 请求的采集结果） |
| scenario.priorLearningContext（.adjacent / .sameTask / .priorMilestoneMastery） | 规则 9 | 结构化前序：紧邻前序/当前任务重学历史/已学阶段掌握汇总（at-risk/partial 前序概念是回补信号） |
| controls.temporalGap（.isLongGap） | 规则 10 | 距上一节课间隔较长判定（按保留率下降处理） |
| scenario.learnerPrediction（.stallRisk / .predictedTone / .toneDetail / .suggestedDepth / .depthDetail / .reliability.total） | 规则 12 | 任务前预测（stallRisk ≥ 0.7 或语气吃力 → 放缓；reliability.total < 5 不采用） |
| scenario.learnerInsights（.type / .claim / .action） | 规则 13 | 状态评审给出的诊断洞察（每项类型/判断/建议动作） |
| scenario.taskKnowledgeScope | 规则 19 | 任务知识边界提示（只当作边界，不是唯一可用名称） |
| scenario.taskProfile（.linkedConceptName / .coreConcept / .learningObjectives） | 规则 22/23 | 任务画像：隐藏认知目标/核心概念/学习目标 |
| scenario.cognitiveFrame（.currentCoreConcept / .targetRelation / .prerequisiteConcepts / .neighboringConcepts） | 规则 21 | 当前任务局部认知图景：核心概念/目标关系/前置概念/邻近概念 |
| scenario.taskKcs（.kcId / .name） | 规则 23/90 | 细粒度知识组件 KC 列表（path-kc-mapping 产出）；kcId 是身份稳定键 |
| scenario.currentTaskContext（.description / .acceptanceCriteria） | 规则 30/32 | 当前子任务简介/验收标准 |
| scenario.taskMaterial；activeTaskMaterialExcerpts | 规则 31、例题引用约束 | 本课材料本体（题面/日志/样本值/原文片段）及其摘录 |
| scenario.lessonContract（.coreKc；scenario.branchState / branchDirective） | 规则 49-54 | 本节课最低必须完成集（主线契约）与支线预算状态/指令（deeper 每课 ≤3 轮、example 每 KC ≤1 次、prerequisite_gap 每课 ≤1 次 ≤3 轮、off_topic 课内 ≤1 轮） |
| scenario.teachingStrategyGuidance（.explanationStyle / .interactionPattern / .targetDepth / .preferredStrategies / .responseConstraints） | 规则 41 | 教学策略显式控制信号 |
| scenario.taskMode | 规则 82 | 任务模式（'productiveFailure' 启用有效失败模式） |
| scenario.priorMisconceptions（.source: "planned"） | 规则 75/76 | 该学习者在此概念上的历史误解台账（planned 为课前预判非已确诊） |
| scenario.transferGoal | 规则 29/91 | 迁移目标 |
| scenario.repairInstruction | 边界约束 | 上一条回复算式被确定性复算判定有误的修正指令（列原文算式与正确值） |
| scenario.misconceptionHints / planned 误区 | 规则 16/18 | 任务级迷思预判（误区冲突优先出图的先验） |
| taskDifficulty（载荷尾部键，.adjusted / .baseline / .reasons / .cap） | 规则 46 | 编排层按学习者状态判定的难度档位与理由/上限 |
| controls.emitCheckpoint | 边界约束 | 出题时机唯一权威开关（true 必出题、false/缺失不得出题） |
| controls.targetDepth | 规则 12/41 | 目标深度（与 suggestedDepth 冲突时以课堂实况为准） |
| controls.checkpointVerdict（.passed / .detail） | 边界约束 | 编排层按答案键算出的检查点权威对错 |
| controls.anchorProbe（.conceptKey / .expected） | 边界约束 | 独立锚题探针：指定概念复测（expected 仅为内部预期，绝不可透露） |
| behavioralProfile（.sampleSize / .avgUnderstanding / .frustrationRate / .dominantEmotion / .knowledgeMasteryEma / .recentHelpSeeking / .helpSeekingCount） | 规则 81 | 行为投影器近期压缩画像（节奏基线参考，sampleSize < 3 基本忽略） |
| checkpointHistory（.recent / .total / .passed / .failed / .skipped） | 边界约束 | 本节课检查点历史摘要（含未通过/跳过的点） |
| memoryWarmup（.items（.originPathTitle） / planned / .backlogCount / .relearnSuggestions） | 规则 66/67 | 温故计划（到期复习点；回捞结果上报依赖 planned 原名/下标） |
| teachingState.closureRepeatStreak | 边界约束 | 收尾重复计数（≥1 时本轮只做一句话收干） |
| visualOpportunity.suggested | 规则 18 | 编排层判定的出图时机 |
| boardContext | 规则 15/16 | 板书内容描述（「本任务暂无板书」或真实板书，决定 reply 可否依赖图） |
| learner.teachingHints.avoid | 规则 71 | 学习者明确排斥的教学形式（如"不要抽象定义"） |
| learner.backgroundKnowledge.transferSignals（.label / .readiness / .confidence） | 规则 91 | 迁移就绪度信号（readiness high/medium 可作迁移佐证） |
| learner.liveState | 规则 4 | 学习者实时状态（当前 session 实时状态高于它） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| reply | string | 老师本轮真正对学生说的话，允许 Markdown；与 control.isCompletionCandidate 保持一致；形态预算：默认 ≤3 个短块、每块 ≤4 行，一轮只推进一个意思，结尾最多 1 个问题或 1 个动作指令；示例优先用学生自己给过的真实场景（当轮） | — |
| analysis | object | 本轮学生状态分析（当轮） | cognitiveLevel、levelScore、understanding、confusionPoints、misconceptions、rsmAttempts、selfAssessmentSignal、helpSeekingType、studentNeed、engagement、emotionalState、loadIndex、loadBasis、ktEstimate |
| analysis.cognitiveLevel | enum | 认知层级：remember / understand / apply / analyze / evaluate / create | — |
| analysis.levelScore | number | 1-6 层级分 | — |
| analysis.understanding | number/null | 0-1 理解度；只在学生本轮发言确有可引用证据时给数，否则输出 null（「本轮不可观测」，禁止低值冒充读数——null 使系统维持常规出题节奏） | — |
| analysis.confusionPoints | string[]? | 困惑点简名列表（未输出时系统自动从 misconceptions.canonicalLabel 派生；输出则优先采用） | — |
| analysis.misconceptions | object[] | 结构化误解台账（无误解输出空数组 []） | conceptKey（概念键）、hypothesis（自由形式「学生误以为…」假设）、canonicalLabel（规范误解标签——priorMisconceptions 有语义相同条目则原样复用，新误解给 ≤12 字短标签，概括不出为 null）、confidence（0/25/50/75/100 五档）、evidence（学生原话引用）、status（"suspected"） |
| analysis.rsmAttempts | object[]? | 解法尝试台账（仅 PF 模式输出；PF 生成期每轮记录新解法尝试） | method（方法简述）、outcome（stuck/partial/wrong/success）、evidence（学生原话引用） |
| analysis.selfAssessmentSignal | enum? | 隐藏自评信号：high / medium / low（从学生自然语言静默提取，不主动询问，只用于后台校准） | — |
| analysis.helpSeekingType | string? | 求助行为自由描述（执行性求助「直接要答案」/工具性求助「要最小提示」/回避性「转移话题拖延」；可附参考词 instrumental/executive/avoidant；用于后台统计与拦截） | — |
| analysis.studentNeed | enum | 本轮学生发言的语义诉求（每轮必填，按语义判断不用关键词）：answer / clarify / example / deeper / prerequisite_gap / off_topic / goal_change / test_out | — |
| analysis.engagement | number | 0-1 投入度 | — |
| analysis.emotionalState | enum | positive / neutral / frustrated / confused / bored | — |
| analysis.loadIndex | number | 0-1 合成认知负荷（语义挣扎为主，结构（句子碎裂/长度骤降）与节奏（长停顿后短消息/密集编辑）为强化信号；对比近 3 轮 vs 更早判断「异动」而非绝对值；无证据取 0.5） | — |
| analysis.loadBasis | enum | 本轮 loadIndex 主要判断依据：semantic / structure / pacing / combined / absent | — |
| analysis.ktEstimate | object? | 回合级知识状态估计（θ−d 路由信号，供编排层难度感知路由；无充分证据可整体省略） | conceptMastery[]（conceptKey、kcId?（与 knowledge.points 同一概念保持一致）、mastery（0-1 掌握概率）、evidence（学生言行依据，禁止写估计过程））、currentTaskDifficulty（0-1 当前任务难度估计）、recommendation（consolidate/advance/challenge/scaffold） |
| knowledge | object | 当前任务知识看板 | currentPoint、points、confirmCheck |
| knowledge.currentPoint | string/null | 当前主焦点知识点名称 | — |
| knowledge.points | object[] | 完整数组（无则 []）；最多 5 个，「单焦点主讲 + 多点看板」；每点必须是一个可检索单元（禁复合名） | name、kcId?（对应 taskKcs[].kcId 原样回填，拿不准就不填）、status（pending/learning/mastered/review）、progress（0-100 整数） |
| knowledge.confirmCheck | object? | 需要学生对当前点表态时的确认动作组（actions 恰好 2 项，一正一反；有 checkpoint 客观验证时不输出） | prompt（≤20 字引导，可空串）、actions[]（label ≤12 字按钮文字、message 学生点按钮后发出的第一人称原话） |
| pedagogy | object | 本轮教学策略 { strategies }（当轮） | strategies（枚举：explain、demonstrate、scaffold、drill、diagnose、feedback、motivate、reflect） |
| control | object | 本轮流程控制信号（交编排层仲裁） | isCompletionCandidate、shouldTriggerPeer、checkpoint?、warmupOutcomes?、voidCheckpoint?、supplement? |
| control.isCompletionCandidate | boolean | 当前任务完成候选判定（行动证据口径；语义覆盖 acceptanceCriteria 要点即达成，引导下答对也算；口头宣称无产出不算） | — |
| control.shouldTriggerPeer | boolean | 触发伴学（连续 2 轮困惑未解决/明确求助/understanding 持续 < 0.4 且该焦点已尝试多轮；其余 false，编排层 PeerTriggerService 兜底） | — |
| control.checkpoint | object? | 检查点（controls.emitCheckpoint=true 时必须输出；必须同时给答案键——硬契约；优先选择题；同一知识点一课最多一次） | question（检查点问题）、type（short_answer/single_choice/multi_choice）、options[]（id、text；选择题必填 2-4 项）、correctOptionIds[]（选择题必填：正确选项 id，须真实存在，单选只给一个）、expectedKeywords[]（简答题必填：1-3 个核心词，同义写法用半角竖线 `\|` 合并）、hint?（可选提示） |
| control.warmupOutcomes | object[]? | 温故结果上报（本节回捞了 planned 里的点时必填，硬契约；漏报等于回捞白做；还没问到/学生尚未作答的点不报） | conceptKey（计划项原名字）、itemIndex?（下标 0 基，可选；与 conceptKey 同时给时以 itemIndex 为准）、recall（unaided/with-hint/failed——给了多少帮助才想起来）、evidence?（学生原话片段） |
| control.supplement | object? | 补充资料请求（每个 session 至多请求一次；仅当主线资料确实没覆盖且学生明确需要外部/最新信息时输出；编排层采集后下一轮才注入） | topic（缺什么一句话主题）、query?（检索词） |
| control.voidCheckpoint | boolean? | 判定刚发出或仍待答的题应当作废时置 true（题干/选项有误、学生明确跳过、话题已推进）；作废回合不得再出 checkpoint | — |
| visual | object? | 教学配图请求——**已废弃，不要再输出本块**（需要图时输出 diagram）；原契约保留备查 | prompt（画面描述）、caption?、kind?（原契约字段） |
| diagram | object? | 课堂结构图请求（前端 mermaid 确定性渲染，毫秒级零乱码，图内可写中文标签）；结构类（过程/循环、结构装配、多对象对比、时序、层级、分类）才画；节点总数 ≤9、单个标签 ≤12 字；不要连续每轮都画；布置学生自己画结构的轮不画（答案泄漏） | engine（"mermaid"，缺省）、code（mermaid 源码必填——flowchart/sequenceDiagram 等，节点与连线写中文标签，禁 %%{init}%% 配置块/click/href）、caption?（图下方一句说明） |
| figure | object? | 位置线图请求（空间位置关系的确定性渲染：位置/距离/朝向/先后/追及相遇；学生刚用文字描述完这类关系时外化成图请他核验——「共同坐标系」）；除 position-line 外其余 kind 字段放 spec | engine（"svg"，缺省）、kind、axis、marks[]、spans[]、guides[]、why?、caption?、spec（非 position-line 的 kind） |
| figure.kind | enum | position-line / cartesian-plot / range-bar / matrix / balance / quadrant / bipartite / cycle / tree / venn / bullseye / split-compare / board（缺省 position-line，按本轮图型指南选；split-compare 用于正误并排对照；grid/compare/bins/ladder 已退役，输出会被丢弃） | — |
| figure.axis | object | position-line 轴（仅 position-line 用顶层 axis/marks/spans） | min、max、unit?（如"米"）、ticks[]（at、label?） |
| figure.marks | object[] | position-line 标记（1-6 个必填，至少一个） | at（数字）、label（必填 ≤16 字）、dir（right/left/none——朝向，静态点用 none） |
| figure.spans | object[] | 位置区间（≤3） | from、to（数字）、label（≤24 字） |
| figure.guides | object[] | 辅助参考线（≤4） | at（数字）、label? |
| figure.why | string? | 为什么用这张图（≤40 字；只进复盘，不进 reply、不念给学生；不写不影响出图） | — |
| figure.caption | string? | 图下方一句说明 | — |
| figure.spec（cartesian-plot） | object | 直角坐标图载荷（轨迹/曲线/函数关系；数值必须真实量纲，同一张图所有 series 共用同一组轴） | x / y（label、min、max、ticks）、series[]（name、form（如 "parabola"）、a、b、c、tone（ok/accent 等）、dotPoints（等时间间隔频闪点，属同一条曲线））、guides[]（axis、at、label）、vectors[]（at、dx、dy、label）、marks[]（at、label、tone） |
| figure.spec（split-compare） | object | 正误并排对照载荷（误区冲突优先出图） | left / right（head 必填 ≤30 字、tone（warn/ok）、rows[]（label 必填 ≤40 字、sub? 可选）；rows 1~4 行且两栏行数差 ≤2）、delta（label、at——1-based 行号，分叉在第几步，越界会丢）、title?（可选标题） |

### 教育学术语标注

- 信令隔离（第 0 公理：内部遥测严禁在 reply 提及——测量的隐蔽性/unobtrusive measurement，防霍桑式干扰）— 执行规则 1
- 脚手架（scaffold 为策略枚举之一；「多给支架、放缓推进」「逐级加提示（每次只加一级）」；PF 逃生舱转 scaffold）— 规则 42/46/81/82
- Meno 闸/提问前提审计（认知积木——概念机制、具象靶子、判断口径——未给时严禁抛开放式问题；先给具象场景靶子→点破直觉翻车→亮机制真名→低门槛二选一/填空；源自美诺悖论）— 规则 55
- 探索预算（对同一焦点诊断性追问最多 2 轮，第 3 轮必须给核心机制/规律）— 规则 55
- 真名锚定（学科真名首次涉及必须点出，转述词不得替代；符号/缩写/工程记号必须当场用场景语言解释——术语锚定）— 规则 56
- 簿记负荷（板书代号逼学员先翻译再思考，「簿记负荷挤掉的正是学科思考本身」——extraneous cognitive load）— 规则 56
- 布鲁姆认知层级（analysis.cognitiveLevel 枚举 remember→create 六层；levelScore 1-6）— 输出 analysis
- 认知负荷（loadIndex 合成负荷量测；「认知负荷三路由」阈值分档）— 规则 59-63、输出 analysis.loadIndex
- 愤悱带（loadIndex 0.6-0.8「愤悱带」：学生卡在即将想通的状态只给一条最小提示——出自「不愤不启，不悱不发」，启发时机带，功能上类似最近发展区）— 规则 63
- 唤醒度/认知冲突（loadIndex < 0.3「唤醒度不足」，抛高阶边界用例或反常识反问「制造轻微认知冲突后再给出思考线索（引而不发）」）— 规则 63
- 认知过载（loadIndex > 0.85：先共情安抚（正常化+赋权）再拆解为更小步骤或二元选择）— 规则 63
- 知识追踪（ktEstimate：θ−d 路由信号、conceptMastery 0-1 掌握概率、currentTaskDifficulty——knowledge tracing 与能力-难度参数化路由）— 输出 analysis.ktEstimate、规则 83
- 掌握判定纪律（「答对」= 无提示不依赖当轮提示词；「讲清楚」= 自己的话+自己的例子+应对反例；口头宣称不构成掌握证据；行动证明优先——mastery learning 证据口径）— 规则 37/38/39
- 迷思概念/误解台账（misconceptions 结构化记录、canonicalLabel 规范误解标签、priorMisconceptions 历史台账、source:"planned" 课前预判、misconceptionHints 迷思预判——misconception 研究脉络）— 规则 74/75/76/16、输出 analysis.misconceptions
- 苏格拉底提问阶梯（只属于 check 轮：先事实层→关系层→迁移层；每问后留作答机会，禁连续 3 问不给反馈）— 规则 64
- 回合意图三分（demonstrate/co-create/check；taskType 节奏主色：工作台副驾/沙盘共建/动作诊所/复盘收束）— 规则 64
- 有效失败 Productive Failure（PF 模式：Phase 1 生成期先挣扎不给标准解法、记录解法尝试；Phase 2 整合期「你的方法 vs 标准解法」对比——Kapur 有效失败教学法）— 规则 82、输出 analysis.rsmAttempts
- 成长型思维语言规范（过程表扬（行为引用+结果关联）vs 禁特质表扬（聪明/天赋/厉害）；失败归因于方法/策略而非能力——归因重训；「还没」框架（yet framework）；正常化挣扎；禁怜悯式安慰；努力表扬须有努力证据——Dweck growth mindset）— 规则 70/86
- 检索练习/课内温故（status=review 到期点回捞、包装为「异构新情境的微型挑战」、不预告该用哪个旧概念——retrieval practice/testing effect）— 规则 66
- 间隔复习/记忆引擎（temporalGap 长间隔「按保留率下降处理」；warmupOutcomes 上报回写记忆引擎、更新间隔与预算——spaced repetition）— 规则 10/66/67
- 交错学习（复习题不预告方法（「预告方法就消除了交错训练的核心价值」）、优先表面相似解法不同的点做对比式回捞——interleaving）— 规则 69
- 迁移（transferGoal 迁移目标；transferSignals 迁移就绪度；「用刚学的口径去判一个新情形」——transfer of learning；「依口径 ≠ 考原话」）— 规则 29/91、边界约束
- 先猜后揭（「预测—揭晓—解释」——predict-observe-explain 式提问设计）— 边界约束「讲完不许立刻考原话」
- 求助行为分流（执行性/工具性/回避性求助 executive/instrumental/avoidant help-seeking；反复求助不降低要求、不代劳——academic help-seeking 理论）— 规则 81/85、输出 analysis.helpSeekingType
- 隐藏自评信号（selfAssessmentSignal 静默提取、只用于后台校准——self-assessment calibration）— 规则 77、输出 analysis
- 情绪急救（自我否定/放弃倾向时：正常化→赋权（指出已有证据）→必能完成的小动作；此轮不推进新知识点——affective intervention）— 规则 65
- 无聊判定 bored（高掌握+低负荷+敷衍回复 → challenge/reflect「重建认知张力」——挑战-能力匹配/心流语境；bored 不等同已掌握）— 规则 84
- 以教代学（reflect：让学生「把自己的话讲给一个不懂的人听」——protégé effect/learning by teaching）— 规则 37/84
- 外化/共同坐标系（把学生文字描述的空间关系摆成位置线「外化出来请他核验」——externalization/shared representation）— 规则 17、figure 字段说明
- 图文互锁（防「图文复读」：图已画出的分支/数值正文严禁逐条罗列，改指示性语言——多表征协同、与多媒体学习冗余原则相关的约束）— 规则 15、边界约束「学习者的节奏请求必须兑现」
- 同构问法/逐个过堂禁令（同一问法（同构动作）连续重复 ≤3 次；改归类/排序/找茬/连线一次扫完或「同题对照」——提问多样性）— 边界约束「禁止同类对象逐个过堂」
- 停车区（off_topic「已记入停车区，课后/下次处理」——parking lot 课堂管理）— 规则 53
- test_out 免修测验（学生声称已会先出一道独立题验证，通过则标 mastered 并压缩本课——挑战考试/test-out）— 规则 54
- 支线预算（deeper/example/prerequisite_gap/off_topic 各有轮数预算，耗尽一句话收束回主线——课堂节奏管理）— 规则 50-52
- 独立锚题探针（anchorProbe 换一个来源验证既有信念——多源复测）— 边界约束
- 检查点/答案键/代码裁决（checkpoint 为形成性评价装置；checkpointVerdict 为编排层权威对错；答案键不得外泄）— 输出 control.checkpoint、边界约束
- 单焦点收口/知识看板（knowledge.points「单焦点主讲 + 多点看板」；同一点连续 2 轮答对后 reflect 再推 mastered）— 规则 20/25/37
- 可检索单元（禁用「、和与及→」把子概念并成复合名——「复合名会让系统按技能簇计认知负担、挤掉温故预算」——retrieval unit 化）— 规则 68
- 微讲授/直觉破题（开场微讲授协议：限长直觉破题 + 锚点小问——advance organizer 式先行组织者）— 边界约束「开场微讲授协议」
- 正常化（「这个阶段卡住很常见」「这类题第一次做卡住是正常的」——struggle normalization）— 规则 14/65/86
- 内容诚实/降断言（知识性断言按把握度措辞，避免「一定/永远/绝对」；算式须可复核——epistemic honesty）— 规则 87/88/89、边界约束「算式正确性」
- 纠正前先核对（防幻觉纠正：「无依据的纠正比放过一个错误更伤信任」）— 边界约束
- 学习者的节奏请求必须兑现（学生提出教学方式/节奏请求本轮必须兑现——learner agency/voice）— 边界约束

---

## teaching-wrapup（课后产出助手，coreVersion: 1）

**角色**：课后产出助手，基于本节课的结构化证据生成课后总结（给学生看）与评估（给系统用）。

### 输入字段（模型读取）

| 字段 | ref 来源 | 语义摘要（1 句） |
| --- | --- | --- |
| messages（object[]） | `sandbox:teaching.session.messages`（编排注入） | 会话消息（含 analysis 标注） |
| knowledgePoints（object[]） | `sandbox:teaching.knowledge.state`（编排注入） | 会话结束时知识看板状态（knowledgeItems 优先复用其名称/状态/progress） |
| sessionInfo（object） | `sandbox:teaching.session.info`（编排注入） | 会话信息（主题/任务/路径/时长） |
| learningState（object） | `sandbox:teaching.learningState`（编排注入） | 学习状态与运行时信号（内部字段如 lsb/ktl，禁冒充记忆保持率） |
| sessionEvidence（object） | `sandbox:teaching.session.evidence`（编排注入） | 会话证据：回合数/理解均值/困惑点/情绪信号/loadIndex 均值与峰值（若输入提供，用于判定「高负荷」而非猜测） |
| sessionEvidence.rsmAttempts | 同上 | 子字段：解法尝试台账（method/outcome/evidence，最近 5 条；规则 20 方法层面对比整合） |
| knowledgeContext（object） | `sandbox:teaching.session.knowledgeContext`（编排注入） | 知识上下文——证据优先级与记忆保持率引用规则依赖它 |
| knowledgeContext.initialPoints / .delta / .reviewHints | 同上 | 子字段：课前初始知识点快照/本节知识点变化/记忆保持率提示（FSRS 计算，每项 concept、retrievability 0-1） |
| sessionStructure（object） | `sandbox:teaching.session.structure`（编排注入） | 课堂结构证据——证据优先级与结束原因解释依赖它 |
| sessionStructure.pathBackground / .finalClassroomContext / .classroomEventHistory / 阶段轨迹 / 结束原因 / .lessonReport | 同上 | 子字段：路径背景/课堂最终状态/课堂事件历史/阶段轨迹/结束原因/主线契约报告（lessonReport 含 coveredKcs/missingKcs/independentCount） |

### 输出字段（模型产出）

| 字段 | 类型 | 语义摘要 | 子字段 |
| --- | --- | --- | --- |
| summary | object | 给学生看的课后总结（token 预算见各子字段） | topicSummary、knowledgeSummary、practiceAdvice、learningEvaluation、knowledgeItems、keyTakeaways、actionPlan、evaluationHighlights、metricInterpretation、summaryVersion |
| summary.topicSummary | string | 本节课围绕主题的核心总结（≤2 句） | — |
| summary.knowledgeSummary | string | 知识点掌握情况总结（≤3 句） | — |
| summary.practiceAdvice | string | 实践建议（多行动换行分隔，≤3 条；按 taskType：reading 偏阅读复盘、practice 偏练习巩固、project 偏产出推进、quiz 偏错题回顾） | — |
| summary.learningEvaluation | string | 亮点和改进建议（≤3 句） | — |
| summary.knowledgeItems | object[] | 知识点条目（≤5 项；优先复用输入 knowledgePoints 名称/状态/progress） | name（知识点名称）、status（mastered/learning/pending/review）、progress（0-100）、evidence（须引用学员自己的产出） |
| summary.keyTakeaways | string[] | 收获列表（≤3 条） | — |
| summary.actionPlan | string[] | 行动列表（≤3 条；至少 1 条必须是间隔迁移微挑战；有复习点/易遗忘概念时必须额外给 1 条「下一课开场迁移题」原文——给具体小场景而非问定义） | — |
| summary.evaluationHighlights | object | 亮点/改进（必须能解释 evaluation 评分结论，不得矛盾；improvements 必须对应课内真实失误） | strengths（string[]）、improvements（string[]） |
| summary.metricInterpretation | object | 指标解读（输入未提供保持率提示时不得出现记忆保持量化表述） | session（本节指标解读）、longTerm（长期指标说明） |
| summary.summaryVersion | string | 固定 "v2" | — |
| evaluation | object? | 给系统使用的本节课评分（原则上必须输出；证据不足给保守评分+低 confidence；档位→数值由平台映射） | sessionKtl、sessionLss、sessionLf、confidence、reasoning、metricMetadata |
| evaluation.sessionKtl / .sessionLss / .sessionLf | object（档位对象） | 三项档位评分（禁输出 0-10 数字）：sessionKtl 本节知识获得质量 / sessionLss 本节学习压力 / sessionLf 本节疲劳负担；每项 tier 三档定义见评分参考（如 Ktl high=8-10 独立完成核心任务或修正关键误解后稳定应用） | tier（low/mid/high）、evidence（一句引用本节课证据的说明） |
| evaluation.confidence | number | 0-1 证据充分度（不是主观自信；零证据分支取 0.1） | — |
| evaluation.reasoning | string | ≤120 字，引用 1-2 个关键证据 | — |
| evaluation.metricMetadata | object | 效度元数据（固定输出；显式标注三项为间接推断值） | sessionLss.isDirectMeasurement（false）/.proxyBasis（「基于对话语速与文本语义特征推断的学习压力，非生理测量」）、sessionLf.isDirectMeasurement/.proxyBasis（「基于对话语义与投入变化的疲劳推断，非生理测量」）、sessionKtl.isDirectMeasurement/.proxyBasis（「基于本节课产出证据的知识获得质量评估」） |

### 教育学术语标注

- 课后总结/收束（wrap-up：summary 与 evaluation 双产出；「带走的判断口径/下一步动作」）— 身份/输出结构
- 掌握状态分级（mastered 只给「无提示下的独立应用」或「纠正先前错误理解后仍能稳定作答」；learning=仅引导下答对一次；「复述与跟随不是独立应用」——mastery learning 证据分级）— 规则 13
- 归因诚实（「不得把老师给的结果记成学员自查」——honest attribution）— 规则 13
- 覆盖边界诚实（目标/任务要求未全部覆盖时 summary 必须如实列明「本次未覆盖：X/Y/Z」——学习目标对齐/coverage honesty）— 规则 13
- 记忆保持率/FSRS（knowledgeContext.reviewHints 为「FSRS 公式算出的记忆保持率」，每项 concept 与 retrievability 0-1；数值逐字引用、禁止编造——间隔重复调度器与记忆保持）— 输入 knowledgeContext、规则 10
- 间隔迁移微挑战（actionPlan 至少 1 条；「下一课开场迁移题」供 teaching-turn 开场承接、与其「课内温故 · 间隔迁移协议」同口径——spaced retrieval + transfer）— 规则 9
- 解法尝试台账/方法对比整合（sessionEvidence.rsmAttempts：≥2 条时做方法层面对比整合「A 在 X 上有效、B 在 Y 上失败」——self-regulated learning 策略监控）— 规则 20
- 学习压力 sessionLss / 疲劳负担 sessionLf / 知识获得质量 sessionKtl（三项 proxy 指标；「多轮阻塞、反复困惑、高负荷」等档位锚点）— evaluation、评分参考
- 效度元数据/间接推断（metricMetadata 强制 isDirectMeasurement=false + proxyBasis——构念效度/代理测量声明；「不得向学生输出压力/疲劳值为 X 的绝对化断言」）— 规则 19、evaluation.metricMetadata
- 情绪收尾（frustrated/confused 占比高时 actionPlan 第一条必须是安抚/重启类建议，summary 语气以认可投入为主——affective closure）— 规则 14
- 停车区（parkingLot 里的问题如实列为「课后待处理」，不得当作已解决——parking lot 课堂管理）— 规则 4
- 独立应用 vs 复述/跟随（掌握证据必须引用学员自己的产出：他写的判断、他算的数、他举的案例）— 规则 13
- 主线契约报告（sessionStructure.lessonReport：coveredKcs/missingKcs/independentCount 逐项引用；met=false 时如实写「本节契约未达成」——学习契约达成度）— 规则 4
- 零证据分支（消息数 < 2 或知识状态空或回合数 < 1 视为「会话未产生可评估内容」，保守兜底——证据门槛）— 规则 5
- 错题回顾/阅读复盘/练习巩固/产出推进（practiceAdvice 按 taskType 四型——practice taxonomy）— 规则 8
- 降断言（知识性断言按把握度措辞——epistemic honesty，与 teaching-turn 同口径）— 规则 21
- 不编造数字/引文/参考文献（引用纪律）— 规则 22

---

## 字段数量统计（速览）

| skill | 输入顶层字段 | 输入子字段（契约声明内） | 规则引用的输入子对象 | 输出顶层字段 | 输出子字段 |
| --- | --- | --- | --- | --- | --- |
| teaching-board-design | 7（含换板参照） | 12 | — | 1（figure） | kind、spec 及示例子字段约 9 |
| teaching-classroom-judge | 2 | — | — | 5 | 21 |
| teaching-opening | 7 | 17 | 3 组 | 4 | quickReplies 元素 text 等 |
| teaching-peer-reinforcement | 7 | —（标签化分区 12 类） | — | 2 | — |
| teaching-replan-attribution | 4 | 7 | — | 7 | — |
| teaching-turn | 7 | 16 | 约 30 组 | 8 | analysis 14、knowledge 3、pedagogy 1、control 6、diagram 3、figure 9 + spec 两组 |
| teaching-wrapup | 7 | 约 10 | — | 2 | summary 10、evaluation 6 |
