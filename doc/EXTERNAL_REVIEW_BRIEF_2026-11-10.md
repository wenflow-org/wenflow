# 问流（WenFlow）设计收敛与下一步方案 · 外部评审稿

> 📌 类型：外部评审稿（设计收敛与实施方案）｜最后核验：2026-11-10

- 日期：2026-11-10
- 用途：交外部评审。请评审者先读 §3（已建成基线，可对照代码验证），再评 §4（三个待实施方案），最后回答 §6 的具体问题清单。
- 姊妹文档：设计原则的完整推导见 [LEARNING_DESIGN_COGNITIVE_SCAFFOLDING.md](LEARNING_DESIGN_COGNITIVE_SCAFFOLDING.md)（本文是它的可执行方案切面）。

## 1. 系统一句话与关键事实

问流 = 一个 MIT 开源的 AI 一对一教学平台：目标会话（澄清诉求→方案确认）→ 学习路径生成 → 逐课备课 → 课堂对话教学（认知负荷/情绪/求助路由）→ 记忆与复习。Vue3 + Express + SQLite，全链路 LLM 遥测（prompt_call_logs / llm_execution_attempts）。

关键实测数字：一个账号跑完第一节课 ≈ ¥0.63（DeepSeek 官方高峰价）/ ¥0.31（空闲价）；单节课中位 ¥0.21；缓存命中率 69%；16 堂真实课样本。

## 2. 设计原则收敛（结论摘要）

四个根问题（case 只是投影，规则不对着 case 写）：

- **R1 路由的本质 = 缺口类型判断**（信息缺口/认知缺口/练习缺口 × 复用广度 × 利害结构），不是词面匹配。已部分建成：三条件测试 0/3 × 理解动词簇 × 无表现要求 → 直答（answer_only）。
- **R2 路径的阶段单位 = 认知盲区**，不是知识单位也不是动作单位。机制：排阶段前自答三问。
- **R3 验收必须外置**：内部自评是自证闭环；判官 Agent + 回归 case 集。
- **R4 提问的合法前提 = 已供给的积木**：开放度随积木衰减（白纸绝不开放是特例非根规则）。

三条工程决策：D-A 确认软路由+确定性底线（不建硬分流选择题）；D-B 画像卡点外部判官（五条规格）；D-C 认知负荷只保留升降不追科研精度。

## 3. 已建成基线（评审者可对照代码验证）

| 能力 | 代码落点 | 状态 |
| --- | --- | --- |
| answer_only 直答闸（一句话讲透测试：三条件 0/3 × 理解簇 × 无表现要求） | backend/src/services/learning/response-triage.ts L400-430 | ✓ 真机+jest |
| 范围收口纪律（单点诉求压 1-2 阶段） | prompts/core/goal-conversation.yaml L56 | ✓ |
| 交付物考场自查判据（禁文书交付物） | goal-conversation.yaml L256-259 | ✓ |
| 颗粒度硬上界（坐学判据，双定帧存活） | backend/src/services/learning/path-planning-hints.ts | ✓ 实测 2.1h→0.9h |
| 回合意图三分 / 认知负荷三路由 / 探索预算 2 轮 / 求助分流 / planned 误区 | prompts/core/teaching-turn.yaml L59-127 | ✓ |
| 教案步骤不是课程目录（教师走堂测试） | prompts/core/stage-designer.yaml L89 | ✓ |
| 课内温故（FSRS 调度 + CLT 负荷预算 + 85% 检索成功率动态校准 + warmupOutcomes 结构化回传） | backend/src/services/memory/review-plan.service.ts、teaching-turn.yaml L108-110 | ✓ |
| 全链遥测与成本归因 | prompt_call_logs / llm_execution_attempts | ✓ |
| 判官先例 | prompt-lab/semantic-freeze-judge、prompt-ops/simulated-eval-engine、skills/virtual-learner-referee | ✓ 存在 |

证据等级说明：上表均过代码（通读规则原文或真机实测）；黑盒虚拟学习者「批量产能」继承自本会话实操经验未重验；「Meno 闸不存在」为 grep 反证；零真人用户是本项目一切测量的根本瓶颈。

## 4. 待评审方案（三摞）

### 方案一（prompt 一炉批，风险最低）：Meno 闸 + 三问 + 真名扩展 + SOP 条款 + 间隔迁移 payload

**1a. Meno 闸（提问前提审计，teaching-turn.yaml 一条规则）**

> 向学习者提出任何问题前自查：回答这个问题所需的认知积木（概念/场景/判据），学习者是否已在本课或此前拿到？没有 → 先给（具象场景 → 拆直觉（点破普通人会怎么做、为什么错）→ 真名亮剑），问题改成「在刚给的结构里做选择/填空」；有 → 按回合意图正常问。掌握度高位 + bored 走 challenge 路由者例外，可开高阶开放问句。

预期行为变化：消灭「对白纸抛开放式问题」的挫败回合；与回合意图三分/探索预算叠加而非替代。
风险（我们自己看到的）：可能与既有三道闸双重管束，规则措辞需要"自查前提"而非"新增审批层"。

**1b. R2 三问（path-planning.yaml 排阶段前自答，不新增信封字段）**

> 排阶段前自答：① 用户拿这套能力去做的真实交付是什么（复用 first_deliverable）；② 学习者最典型的认知误区/盲区是什么——每个误区必须能落成「一道多数人会答错的检查题」或「一个会翻车的沙盘动作」，落不出来就是没找到，删；③ 每个盲区用什么透镜 + 任务外变式破（透镜按任务自然形状 1~5 个，禁止凑数）。第一阶段的入口挑战 = 暴露头号误区的那道题。

防退化设计：这是规划期一次性推理，产出直接决定阶段排布，不落成逐轮表单。

**1c. 真名措辞扩展（一处改动）**

> 「理论亮剑真名」原则从「学科术语」扩展为「学科或实务体系的真名」（ABC 分类/先进先出/PDCA/5Why 与珀尔因果图/共轭效应同格）；SOP 只能作为沙盘练手骨架被引用，每条步骤必须配「什么时候失效、失效时用什么判据」，配不出的步骤不出现在课程里。

**1d. 间隔迁移 payload（teaching-turn.yaml 温故规则改写 + 少量 service）**

> 现状：开场回捞到期旧知，「无提示检索 → 最小提示 → 一句话对照」（teaching-turn.yaml L108-110）。升级：回捞点携带该概念的误区检查题/任务外变式，温故形式 = 新情境微型挑战（「新员工明知乱放会找不到还是乱塞，你怎么用上次的框架设计一句提醒」）而非复述。调度/配额/warmupOutcomes 回传不动。迁移挑战按复合点同款纪律占预算 1.5-2×；判分沿用 warmupOutcomes（unaided/with-hint/failed 三级），温故片段抽样进判官审计。

### 方案二（动 schema，单独批）：R1 gapType 字段

goal 会话 understanding 显式抽取 `gapType`（信息缺口/认知缺口/练习缺口），纯函数裁决「信息缺口 × 三条件低 → 直答」；现行理解动词簇正则降级为测试兜底，今后不再新增关键词表。走字段同步门禁（prompts:check:all）。

### 方案三（独立脚本）：D-B 画像卡点判官

样本=虚拟学习者流水线批量产课堂数据 → 被评=learner-model-agent 抽取的卡点/干预点 → 判官=独立高阶模型，**必须同时携带课堂上下文与学习者历史上下文** → 1-5 分 + 一句话致命偏差 → 通过率阈值 ≥80% 立住 → 评语驱动改抽取 prompt。

## 5. 我们自己已经知道的疑点（不必重复指出，但欢迎加深）

1. 三问会否退化成新的填表表演（死区教训：模型被逼填表=死板感来源）；防编造判据「配不出检查题就删」是否可执行；
2. gapType 三分是否完备——「想学 X 但其实只需要答案」「边修边学」类混合诉求怎么落；
3. Meno 闸与回合意图三分/探索预算的双重管束风险；
4. 间隔迁移的 rating 语义漂移：FSRS 状态机的 rating 从「记得吗」变成「会应用吗」，同一状态机承载两种语义是否可接受；
5. 迁移挑战预算 1.5-2× 是类比复合点，不是实测；
6. 判官与被评者同为 LLM 的同源偏见怎么破；
7. onboarding 未明示「可以直接要答案」，快餐用户体验不知有出口；
8. 后台 UI 简陋合理，但聊课堂对话 UI 是产品本体，不适用「可用即完美」。

## 6. 请评审回答的问题（按此清单逐条回答，不要泛评）

1. 三问规则的防表单化措辞是否足够？给出你会怎么改写的版本。
2. gapType 三分法是否有漏项？给出混合诉求（如「边排障边学」）的判定建议。
3. Meno 闸的例外条款（bored/高位学习者开开放问句）是否会被模型滥用为「随意开放提问」的借口？如何收紧？
4. 间隔迁移的 rating 语义漂移：建议接受、还是为迁移挑战建独立状态机？给出理由。
5. 迁移挑战占预算 1.5-2× 的量级判断。
6. 判官同源偏见的破法：换供应商大模型、多人格评审、还是人工抽样校准？在零真人用户约束下的最优解。
7. onboarding 快餐出口的明示措辞建议（一句话以内，出现在哪）。
8. 三个方案的执行顺序建议与理由。

## 7. 验证与回滚（评审者可据此检查我们是否说话算话）

- 方案一：双门禁（prompts:check:all + prompts:core:check）→ 真机回归 case（盘库、蓝屏、均线、英文综述、黄山戒手机）对照改造前后行为；
- 方案二：字段同步门禁 + jest（蓝屏直答/复发性留路径/要练到自修留路径）；
- 方案三：先 10 份样本试跑判官，校准 prompt 后再上 50 份；
- 每批独立 commit，单批可 revert。

## 8. 评审回复（2026-11-10 收到，落地时并入规则文本）

| # | 问题 | 评审结论 | 处置 |
| --- | --- | --- | --- |
| 1 | 三问防表单化 | 不够——改写为「逆向剔除断言」：盲区唯一性 / 翻车可证伪 / 破局即入口 | 采纳，规则文本以评审版为底 |
| 2 | gapType 漏项 | 不建第四态；加 `urgentTroubleshooting` 布尔修饰符——急救诉求首轮强制直答，尾部挂「生成 15 分钟排障认知课」转化钩子 | 采纳 |
| 3 | Meno 闸例外被滥用 | 剥夺当轮自由裁量，绑硬状态标签：`mastery_level=='high'` 且 `consecutive_unaided_hits>=2` 才解锁开放问句 | 采纳 |
| 4 | rating 语义漂移 | 坚决复用单一 FSRS 状态机——「背得出但不会用」=惰性知识，failed 重置间隔是升维非 bug | 采纳 |
| 5 | 预算 1.5-2× | 偏乐观，上调 2.5-3×，或干脆硬上限：单课开场最多 1 道迁移挑战 | 采纳硬上限（可执行性优先） |
| 6 | 判官同源偏见 | 异构模型交叉评审 + 黄金负样本校准：试跑 10 份中掺 3 份人工烂画像（复读机/幻觉/爹味），判不进 ≤2 分不放行 | 采纳 |
| 7 | onboarding 措辞 | 输入框下方常驻浅提示或欢迎语末行：「只想快速拿现成答案或排障步骤？直接说『只看答案』即可跳过排课。」 | 采纳待真机试 |
| 8 | 执行顺序 | 方案一（最高 ROI）→ 方案三（建外部标尺）→ 方案二（架构收口） | 采纳 |

**另附三条设计补充**：① 颗粒度从「坐学时长」松绑为「单盲区闭环判据（Exit Node）」——入口翻车挑战 → 接住真名透镜 → 独立通过任务外变式即收口（触及 path-planning-hints 的时长帽，与坐学判据并存还是替代，落地时定）；② 物理技能（乐器/书法）边界劝退话术入路由；③ 课堂白板仅限纯代码生成轻量 SVG，不引入外部生图模型（锁死 ¥0.21/课成本与延迟）。

**基线快照**：改造前全量技能包已存档 `wenflow-skill-baseline-core-2026-11-10.zip`（prompts 真源+编译产物+manifests+orchestration + PIPELINE-BASELINE.md 管线底图），供独立研究线对照。

## 9. 落地计划 v2（研究线读码校准后 · 2026-11-10 深夜）

研究线持基线包读穿 YAML 后的 7 项关键断言已逐一过码验证：**5 确认**（teaching-turn L97 盘问规则架空 L239 开场微讲授协议；path-planning L66/72/89 三问+四段八股；session-wrapup L46 背诵种子；goal-conversation L69 时间决定性维度采集门；teaching-checkpoint.ts L117-121 低 understanding 加速出题至 2 条消息）、**1 部分确认**（stage-designer L107 充实度鞭子存在，但研究线漏看 L107 内 2026-11-09 已加的「≤6h 小体量反注水例外」——v2 把它从例外吸收为通例）、1 未验（referee reachability=external，非阻塞）。方案二架构预警（understanding 已有 4 套分类字段：intent_type / primary_block_type / skill_nature / platform_judgment）属实，采纳。

### 第一刀 · prompt 批（8 处手术，行号已定位，规则文本以研究线版本为底）

1. **teaching-turn.yaml L97 改写 = Meno 闸**：原「状态不明→先给诊断性产出请求，不要直接开讲」是对白纸盘问的根因，架空了 L239 开场微讲授协议。改为「提问前提审计」：积木未给（首轮/刚切焦点/状态不明）→ 禁开放式问题与「用自己的话写出来」，先供积木（场景靶→拆直觉→亮机制）再问框架内二选一/填空；积木已有→按回合意图走；豁免硬锁 `ktEstimate.recommendation==='challenge'` 或 progress≥80 且 loadIndex<0.3/bored。改后与 L239 天然同向。
2. **teaching-turn.yaml L108 温故 → 间隔迁移微挑战**：禁字面定义复述（「什么是X/X有三个要点」），到期概念包装为异构新情境 1-2 句翻车/决策小现场，不点破该用哪个旧概念；unaided 一句肯定进正课，答偏给最小线索（with-hint）或一句点破用法（failed），不纠缠第 2 轮；原名字上报 + warmupOutcomes 契约不变。
3. **session-wrapup.yaml L46 同步**：检索种子改迁移种子——「下一课开场先判这个现场：…」（具体小场景），禁「不看笔记说出三个要点」。
4. **path-planning.yaml L72 废四段八股 → 盲区三律**（逆向剔除）：①盲区唯一性（每阶段=一个独立认知盲区+破局透镜=绑定 coreConcept）②翻车可证伪（写不出具体翻车点的阶段=目录凑数，当场合并/删除，按自然盲区数收敛）③破局即入口（阶段 1 直击头号盲区翻车现场，禁导论/热身段）。L66 三问保留（那是 coreConcepts 提炼，用途不同）；L89 预算不足「四段合并两段」同步改为「按盲区优先级裁剪」。
5. **真名+SOP 禁令扩充**（path-planning「问题切入理论亮剑」条 + stage-designer 对应条）：非学术实务同权亮真名（ABC 分类/FIFO/5Why/鱼骨图/PDCA 与珀尔因果图同格）；SOP 只作课堂「待诊断靶子」，每步配失效条件与判据，配不出的纯执行步骤不立课。
6. **stage-designer.yaml L107 充实度 → 单次认知闭环定界（Exit Node）**：subtask 边界由 acceptanceHint 的可验证结束节点决定，不由分钟数决定；闭环成立即收口；targetSubtasksForStage 与 subtaskMinutesRange 仅作上限容器参考，严禁拆闭环凑课数或 15 分钟虚标 45。已有「≤6h 反注水例外」吸收为通例。
7. **stage-designer.yaml L109 supplementRequest 收紧（后端 stage-enrichment.ts 配合）**：增量补课仅 `intent_type==='exam'` 且存在未覆盖考纲实体时触发，普通认知建构路径关闭课数下限补课。
8. **goal-conversation.yaml L69 时间采集门按 D-E 松绑 + 物理技能收紧**：时间仅在 deadlineDate 非空时为决定性维度；自由学习未提时间严禁追问，sessionsLengthMin 静默默认 25、objectiveScopeHours 按盲区数自下而上估；物理技能（physical_internalized + not_judgeable）从「排训练计划+事后文字归因」收紧为「仅可文本化底层理论（乐理/透视）或劝退」，落实物理课禁令。

### 第一刀预检补丁（研究线上机前预检 · 已过码验证）

- **第 4 项联动**：path-planning 废四段八股必须**同步改 path-reviewer.yaml L31 Integrity 维度**——原文「是否所有 unknownConcepts 都有对应 milestone」+ L55 示例「在 concept-3 之前增加一个简短阶段，建立基础理解」会判 破局即入口 不及格并发 replanInstructions 插回导论段（reviewerFeedback 具最高修改权）。改为「unknownConcepts 是否已融入对应盲区阶段的破局透镜按需供给，禁止要求在阶段 1 前单独插入无挑战的导论/预备段」，L55 示例同步换。
- **第 6 项联动**：stage-designer 改 L107 充实度时必须**同步改 L64 数量优先级第①项**——原文「必须且只能输出恰好该数量的 subtasks」与「仅作上限容器」同文件撞车。改为「为本阶段课数上限（服务层按学时反推的容器上限），实际课数由本阶段自然包含的独立认知闭环个数决定，≤ 上限即可」。

### 第一刀预检补丁三（同文件互搏清扫 · 第三轮预检，已过码验证）

- **补丁 A（=研究线补丁 1，并入前条 L64 项）**：数量优先级第①项改为上限容器时**加 exam 保底 carve-out**——「仅当 intent_type==='exam' 且需覆盖完整考纲清单时，targetSubtasksForStage 才作为保底下限」（与手术 7 的 exam-only 补课同口径）。
- **补丁 B（里程碑数量死锁，实证 L78+L96 双条）**：path-planning 两处「targetMilestones 存在时必须且只能输出恰好该数量，不得增减」会锁死盲区三律的删并——而 targetMilestones 几乎 100% 存在（来自已确认 keyStages）。两步修：① **源头拦截**——goal-conversation 的 key_stages 字段定义末尾补「每个阶段必须对应一个具体认知盲区（外行按直觉做会翻车的点），严禁把概念导论/发展史/热身准备列为独立阶段」；② **本层换芯**——盲区三律第②条补「若 targetMilestones 已锁定不可减，写不出翻车点的空壳阶段必须原地换芯为头号盲区的边界反例深潜或任务外变式阶段，严禁保留导论式空壳」。
- **补丁 C（时间硬条件残留，实证 L59）**：推进 proposing 的 4 项硬条件里「available_resources 至少含 time_horizon 或 time_budget」需补第二例外——L59 已有「颗粒度路由例外」先例结构，并列加「无 deadline 的自由学习未提时间时按单次 25 分钟静默满足，不追问」（与手术 8 的 L69 改动同语义闭合）。
- **补丁 D（物理承接三处对齐，实证 goal L88/L90 + stage-designer L70）**：goal-conversation 能力边界披露的「能做的：给训练计划（练什么、练多久…）」与说法示例、stage-designer not_judgeable 三形态里的「①训练计划」全部改为二选一口径：「要么诚实收窄到纯文本可检验的底层理论（乐理/透视/脚本结构），要么明确劝退；禁止生成线下练琴/绘画打卡式训练计划课」（保留复盘归因/原理讲解两形态）。
- **补丁 E（破局即入口防跑偏措辞，实证 stage-designer L87 概念门槛 gate）**：盲区三律第③条措辞点明——阶段 1 直击的是【经典公共翻车靶子】，以 acquire/deconstruct 形态带学习者直面「普通人按直觉会怎么错」当场亮真名透镜；用户自带半成品材料仍留该阶段末课收口。防两类误读：首课让零基础者 execute 硬刚（撞 L87 gate）、拿用户半成品开刀（撞阶段内顺序铁律）。
- **补丁 F（温故微挑战上报时点两档，对齐 teaching-turn L109 既有语义）**：failed（完全卡住/离谱）→ 当轮上报、一句话点破用法、立即进正课不纠缠；with-hint（方向对差半步）→ 本轮**不报**，给 1 句最小线索并顺势搭正课第一步同构小问，学生下一轮接住后补报 with-hint——防 with-hint 分支变死代码或模型虚报。

（第一刀手术清单至此：9 处主手术 + 6 处同文件同步补丁，全部行号锁定。）

### 第二刀 · checkpoint 降频（teaching-checkpoint.ts，一处小改 + 时序条件）

删「understanding<0.6 → 2 条消息加速出题」（学生懵时需要支架不是考题）；emitCheckpoint 改「单焦点收口触发」。**时序约束（预检 3，已验证 emitCheckpoint 为编排层调用前注入、isCompletionCandidate 为本轮输出——严禁同轮）**，确定性触发条件 4 条同时满足：

1. 当前焦点本课尚未通过任何 checkpoint（单焦点最多 1 道）；
2. **上一轮** analysis.understanding ≥ 0.7（或当前焦点 progress ≥ 60 / ktEstimate.mastery ≥ 0.7）；
3. 本课已进行 ≥ 2 个有效教学回合；
4. 当前无待答 checkpoint，且**上一轮未触发 isCompletionCandidate**（防结课信号与待答卡同轮卡死状态机）。

### 第三刀 · 判官脚本（payload 四块 + 黄金负样本 + 渐进式备课对策）

Payload = ①课堂 visibleDialogueContext + personaSeed（真值）②lesson-knowledge-enricher 产出（blockedFoundations/recurringConfusions/knowledgeStateSummary，被评 A）③previousStageOutcome（strugglingConcepts/recommendation）+ replan-attribution reason（被评 B）④stage-designer 下一阶段 subtasks（被评 C）。判官 prompt 用研究线版本（幻觉/复读审计、负荷升降审计、干预合理性审计三铁律 + JSON verdict + evidenceQuote）；校准 = 7 真实 + 3 黄金负样本（全抄原话/反向乱报/高负荷加难），3 假全判 fail 且 ≤2 分才放行 50 份批跑。

**渐进式备课对策（预检 4）**：备课首跑只生成 Stage 1，跑完 1 堂课时被评 C 为空——判官脚本内用已产出的 previousStageOutcome 对 Stage 2 做一次 **stage-designer dry-run 调用**凑齐 payload ④，单样本测试成本省 ~75%（跑 1 堂课而非一整阶段）。

### 方案二修订 v2（预检 5：零新增字段，连 response_mode_hint 也不需要）

`prompts/orchestration/goal.yaml` 已实证注册四个分类字段的路由（L135 `understanding.primary_block_type`、L144 `recurrence`——描述原文即「triage 分流钥匙」、L160 `skill_nature`，handoff 已打通 goal-agent→path）。因此方案二从「动 Schema 批」**降维为纯规则 + TS 纯函数批**，零字段门禁：

1. goal-conversation.yaml：primary_block_type / recurrence 填写时机从「诊断门槛后」提权到**第 1 轮按首句填写**；首句命中 oneoff_operation / environment_tooling × recurrence=oneoff（如蓝屏）→ 直接触发一句话讲透测试的首轮直答 + 句尾转化钩子（「想系统建立排障思维，回『生成排障课』练 1-2 节」）。
2. response-triage.ts 纯函数：直接读现成落库的 primary_block_type / recurrence / skill_nature / platform_judgment 四字段做确定性路由（skill_nature=physical_internalized × platform_judgment=not_judgeable → physical_decline，与第一刀第 8 条联动）。

（注：原 v2 的 response_mode_hint 提案随本修订作废——路由态由既有四字段组合表达，不再新造枚举。）

### 执行顺序（沿用评审结论，校准后不变）

第一刀（prompt 8 处，compile-all + check:all + 3 真机 case：盘库/蓝屏/心理学）→ 第二刀（checkpoint 15 分钟）→ 第三刀（判官挂机批跑）→ 方案二（response_mode_hint，走字段门禁）。
