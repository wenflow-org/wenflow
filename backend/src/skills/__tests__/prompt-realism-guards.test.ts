import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')

/**
 * 2026-11-11 外评三处尾部瑕疵的提示词回归：
 * 1) 蓝屏：用户说「先去忙」后 AI 仍追问/复述，模拟学习者被拖出 8 轮告别；
 * 2) 游泳：not_judgeable 先给提案、确认时被硬拒——提示词必须与平台硬阻断同口径；
 * 3) 渐进合同：阶段 1 提前产出阶段 2 的「可发送措辞」。
 */
describe('goal/path/stage prompt realism guards', () => {
  it('goal-conversation：离场信号只收口、不下快选', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('话已说完就收口')
    expect(md).toContain('不再提问、不再复述步骤、不下发 quickReplies')
    // 快选字段说明也要保留收口轮留空
    expect(md).toContain('用户离场/收口轮')
  })

  it('goal-conversation：能力缺口 × 在办真实任务不得整包交付 SOP', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('真实任务当教材，禁止整包 SOP')
    expect(md).toContain('最多给一个轻诊断口径')
    expect(md).toContain('禁止在聊天里再布置')
    expect(md).toContain('不要再等用户离线做完')
    expect(md).toContain('弄好回我')
    expect(md).toContain('第一课的交付物必须就是这次真实任务的产物')
  })

  it('goal-conversation：scope_size 颗粒度标签必须与 key_stages 自洽', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('标签必须与你自己给的关键阶段数自洽')
    // 2026-11-22 唯一真值表：技能模块帽 3 段、4 段以上归完整学科（代码钳制同口径）
    expect(md).toContain('标 [技能模块] 时 key_stages ≤3')
    expect(md).toContain('已拆 4 个以上阶段必须标 [完整学科]')
  })

  it('goal-conversation：不在对话里报总账（总学时/总坐学数交给路径卡片）', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('不在对话里报总账')
    expect(md).toContain('不得承诺完整路径的总学时/总课次')
    expect(md).toContain('不写总小时数、不写总坐学次数')
  })

  it('goal-conversation：只给主题先补基线，不按身份分流、不直接进 proposing', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('第一性规则：先澄清，再提案')
    expect(md).toContain('先问一个能区分第一站的具体问题')
    expect(md).toContain('不先问「考试/工作/兴趣」这种身份分流')
    expect(md).toContain('答完再决定是否提案')
  })

  it('goal-conversation：零代码原型走低代码，不默认塞 Python 模板', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('零代码原型走低代码')
    expect(md).toContain('可视化低代码平台')
    expect(md).toContain('不要给 Python 脚本或工程实现当默认方案')
  })

  it('goal-conversation：论文/毕设场景用标准术语，不承诺土话能写进论文', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('论文/毕设术语与证据')
    expect(md).toContain('禁止声称土话/比喻可直接写进论文')
    expect(md).toContain('必须用标准术语，比喻只能作入口并当场对标')
    // 领域知识（Agent 四模块/ReAct/Trace）不进通用目标澄清提示词。
    expect(md).not.toContain('Agent 原理的标准四模块')
    expect(md).not.toContain('Thought → Action → Observation')
  })

  it('goal-conversation：工作/开发场景只是背景，不把知识学习改写成产品方案', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('工作/开发场景是背景，不是学习目标')
    expect(md).toContain('不得把目标改写成「把 X 产品设计好 / 解决 X 的产品问题」')
    expect(md).toContain('不得把 first_deliverable 写成「拿 X 的一个具体任务说清三句话」')
    expect(md).toContain('知识学习类目标的 first_deliverable 必须先写知识掌握本身')
    expect(md).toContain('按轻起步提案形态（≤2 阶段）处理')
  })

  it('goal-conversation：方向先给、问题后置，用户说「都要」不再拆分选择', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('方向先给、问题后置')
    expect(md).toContain('首轮最多问一个会改变路径的问题')
    expect(md).toContain('用户说「都要」就按一条链装，不再拆分选择')
    expect(md).toContain('不用「你卡在哪/你最没把握」')
  })

  it('goal-conversation：加深度只叠加、不把第一站换成论文精读', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('加深度只叠加、不替换第一站')
    expect(md).toContain('不得把第一站改写成论文精读')
    expect(md).toContain('先保留用户已经接受的入口')
    expect(md).toContain('原提案第一站本就是直觉入口')
    expect(md).toContain('起步提案因此可放宽到 3 个阶段')
  })

  it('goal-conversation：规划期只报菜名、不提前拆解案例', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('规划期只报菜名、不揭底牌')
    expect(md).toContain('只列**案例名或选题清单**')
    expect(md).toContain('不得当场逐条解释机制、归因、结论或判断答案')
  })

  it('goal-conversation：时间口径按单次节奏，不拿上限当默认值', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('时间口径一致')
    // 2026-11-24 时间降维：只留两条物理边界（单次坐姿、外部截止），总学时/周数不再采集
    expect(md).toContain('时间只采两条物理边界')
    expect(md).toContain('总可投入时间、总学时、总周数、objectiveScopeHours 一律不采集')
    expect(md).not.toContain('单点概念 objectiveScopeHours 硬上限 1.2h')
    expect(md).not.toContain('轻起步 objectiveScopeHours 硬上限 2h')
  })

  it('goal-conversation：默认假设不逐轮播报，不写「你没说」', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('reply 不再逐条播报「你没说、我先按」')
    expect(md).toContain('不在 reply 里解释「你没提/我先按 X/要调随时说」')
    expect(md).toContain('不在 reply 里写「题型你没提，我先按…」这类播报')
    expect(md).toContain('假设直接落进字段与 proposal')
  })

  it('goal-conversation：说话像懂行的真人，不像客服或教材', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('说话像懂行的真人，不像客服或教材')
    expect(md).toContain('先接话，再推进')
    expect(md).toContain('不当百科复读机')
    expect(md).toContain('不暴露系统机制')
    expect(md).toContain('不替用户宣布「来得及/来不及」')
    // 客服套话与内部词只能在规则里出现，reply 明确禁用。
    expect(md).toContain('reply 里不出现「你这边」')
    // 三段式模板已删除，避免每轮先做总结。
    expect(md).not.toContain('先 1-2 句总结已理解的内容')
  })

  it('goal-conversation：考试类不报总学时、不写「2-3 倍/行业口径」法务腔', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('考试体量边界（不报总账、不写法务腔）')
    expect(md).toContain('不要说「课下还要 2-3 倍时间」「以考试界普遍经验为准」')
    expect(md).toContain('不写精确倍数、不写行业口径')
  })

  it('goal-conversation：考试类型进入决定性维度，双题型必须进预计产出', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('考试类型（学校期末 / 教资 / 考编 / 考研统考 / 其他）')
    expect(md).toContain('首轮可同时问考期+考试类型')
    expect(md).toContain('first_deliverable 必须同时包含客观判断正确率与主观成段输出')
  })

  it('goal-conversation：not_judgeable 不排路径，禁止先提案再拒单', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('not_judgeable 一律不排路径')
    expect(md).toContain('不得输出 confirmedProposal、不得进入 proposing')
  })

  it('path-planning：交付物归属唯一（含论文正文只在最后一站）', () => {
    const md = read('prompts/skill.path-planning.md')
    expect(md).toContain('交付物归属唯一')
    expect(md).toContain('正文、架构节初稿、答辩稿只属于最后一个阶段')
  })

  it('path-task-design：阶段任务不得越界产出后段成品', () => {
    const md = read('prompts/skill.path-task-design.md')
    expect(md).toContain('交付物归属唯一')
    expect(md).toContain('禁止提前产出成品措辞或成稿')
  })

  it('path-task-design：阶段递进只看能力增量，不换材料重做同一动作（跨阶段与阶段内同一条规则）', () => {
    const md = read('prompts/skill.path-task-design.md')
    expect(md).toContain('完整闭环 × 能力增量')
    expect(md).toContain('不能只换材料重做前序动作')
    expect(md).toContain('同一阶段内两节课也不能是同动作换材料')
    expect(md).toContain('搭建/配置')
    expect(md).toContain('repairHints.actionDiversityFixes')
  })

  it('path-task-design：技术原理课用标准术语与执行轨迹，不用土话替代', () => {
    const md = read('prompts/skill.path-task-design.md')
    expect(md).toContain('领域口径落地')
    expect(md).toContain('技术原理类任务必须用标准术语')
    expect(md).toContain('后台执行轨迹（Trace）')
    expect(md).toContain('按 path-planning')
    expect(md).toContain('不能从最终回答反推内部步骤')
  })

  it('path-task-design：零代码原型落到自己的平台配置，领域品牌只在 planning 保留', () => {
    const md = read('prompts/skill.path-task-design.md')
    expect(md).toContain('零代码/低代码原型')
    expect(md).toContain('自己的平台配置')
    expect(md).toContain('交配置清单或运行 Trace 作证据')
    expect(md).not.toContain('Coze/扣子、Dify、FastGPT')
    // 标准清单留在 path-planning，task-design 只引用口径，避免双份硬补丁。
    const planning = read('prompts/skill.path-planning.md')
    expect(planning).toContain('Coze/扣子、Dify、FastGPT')
    expect(planning).toContain('Thought → Action → Observation')
  })

  it('path-task-design：论文正文只在最后一站，前序阶段不提前写成稿', () => {
    const md = read('prompts/skill.path-task-design.md')
    expect(md).toContain('交付物归属唯一')
    expect(md).toContain('repairHints.artifactFixes')
    expect(md).toContain('正文、架构节初稿、答辩稿只属于最后一个阶段')
    expect(md).toContain('不得要求成段正文或可直接引用的段落')
  })

  it('path-task-design：排版参数不进任务', () => {
    const md = read('prompts/skill.path-task-design.md')
    expect(md).toContain('学科教师口吻')
    expect(md).toContain('不写字体、字号、行距、页边距等排版参数')
  })

  it('path-planning：summary 中性不贬低、术语与证据对象同一条口径', () => {
    const md = read('prompts/skill.path-planning.md')
    expect(md).toContain('不贬低学习者')
    expect(md).toContain('术语真名与证据对象')
    expect(md).toContain('后台执行轨迹（Trace）')
    expect(md).toContain('零代码/低代码原型')
    expect(md).toContain('不写总学时、总周数、精确分钟带')
  })

  it('path-planning：课名锚定主题/机制，不写成单次故障问句或资料小节名', () => {
    const md = read('prompts/skill.path-planning.md')
    expect(md).toContain('主题/机制 + 体系能力')
    expect(md).toContain('不是一次故障排查、单条 FAQ 或单个文档小节名')
    expect(md).toContain('具体痛点、翻车场景、排障入口全部下沉到 summary 与第一课')
    expect(md).toContain('Pod 卡住不动，先查哪一层状态')
    expect(md).toContain('Pod 生命周期与状态机制')
  })

  it('path-planning：资料目录不是课程目录，用户没问的章节不得自动扩成阶段', () => {
    const md = read('prompts/skill.path-planning.md')
    expect(md).toContain('资料目录不是课程目录')
    expect(md).toContain('资料有 N 章/N 节，不等于路径要有 N 段')
    expect(md).toContain('删掉这一段，用户的原诉求是否仍然完整达成')
  })

  it('path-planning：拓扑先定再套阶段公式，基准锚必填且被里程碑引用', () => {
    const md = read('prompts/skill.path-planning.md')
    expect(md).toContain('「路径拓扑」')
    expect(md).toContain('pathTopologyHint')
    expect(md).toContain('builder：拆解标杆黑盒')
    expect(md).toContain('exam：高频考点与易混辨析')
    expect(md).toContain('「学科基准锚」')
    expect(md).toContain('domainAnchors')
    expect(md).toContain('至少点名一个锚')
  })

  it('path-task-design：按拓扑定任务形态，材料与简介分离', () => {
    const md = read('prompts/skill.path-task-design.md')
    expect(md).toContain('「按拓扑定任务形态」')
    expect(md).toContain('builder 路径的任务必须围绕同一个**贯穿作品**递进')
    expect(md).toContain('materialPayload')
    expect(md).toContain('课堂直接读它，description 只留 1-2 句简介')
  })

  it('path-kc-mapping：契约字段名统一、与字豁免、不再让模型手抄 kcGraph', () => {
    const md = read('prompts/skill.path-kc-mapping.md')
    expect(md).toContain('linkedKCs 字段，复数')
    expect(md).not.toContain('通过 linkedKC 字段')
    expect(md).toContain('「区分/对比/辨别/比较 A 与 B」作为整体能力时允许保留单个「与」字')
    expect(md).toContain('不需要输出 kcGraph')
    expect(md).toContain('unknownConcepts')
    expect(md).toContain('首个需要它的 coreConcept')
  })

  it('path-reviewer：拓扑错配与基准锚缺失进入失败特征', () => {
    const md = read('prompts/skill.path-reviewer.md')
    expect(md).toContain('拓扑错配')
    expect(md).toContain('基准锚缺失')
  })

  it('path：修复跨文件硬冲突（instance / cognitiveDesign / 错位评审项）', () => {
    const planning = read('prompts/skill.path-planning.md')
    const reviewer = read('prompts/skill.path-reviewer.md')
    // scope=instance 不再等同一次性操作，与 goal 层和新 triage 同口径。
    expect(planning).toContain('scope=instance 只表示验收对象是一份具体材料或一次真实决策')
    expect(planning).toContain('只有 kind=do 且 baseline 没有证据时才是真一次性操作')
    // cognitiveDesign 只保留“已退役、不再输出”的声明，不再要求模型镜像一份。
    expect(planning).not.toContain('cognitiveDesign = cognitiveCore')
    expect(planning).not.toContain('cognitiveDesign 只是兼容镜像')
    expect(planning).toContain('`cognitiveDesign` 不再由模型输出')
    // 课节/排版检查不属于骨架评审器。
    expect(reviewer).not.toContain('同一阶段两课核心动词相同')
    expect(reviewer).not.toContain('字体行距')
  })

  it('path：阶段只能用已解锁概念验收（防偷跑与负荷倒挂）', () => {
    const planning = read('prompts/skill.path-planning.md')
    const taskDesign = read('prompts/skill.path-task-design.md')
    const reviewer = read('prompts/skill.path-reviewer.md')
    const goal = read('prompts/skill.goal-conversation.md')
    expect(goal).toContain('不是第一站验收单')
    expect(planning).toContain('首阶段只做 firstDeliverable 的第一跳')
    expect(planning).toContain('不得把后序阶段的概念塞进 M1 的例句并作为验收判据')
    expect(planning).toContain('M1 自检（输出前必做）')
    expect(planning).toContain('M1 只取 keyStages 第 1 条的能力，不照抄 `firstDeliverable`')
    expect(planning).toContain('首站材料复杂度服从 loadTarget')
    expect(taskDesign).toContain('只有当前阶段是末阶段')
    expect(taskDesign).toContain('阶段概念边界')
    expect(taskDesign).toContain('只能作为**不考核的背景材料**出现')
    expect(taskDesign).toContain('首站（currentStageNumber=1）的例句只出现本阶段能解释的结构')
    expect(reviewer).toContain('终点前置 / 概念偷跑')
    expect(reviewer).toContain('负荷倒挂')
  })

  it('path：单次承诺与任务分钟上界一致（默认 25 分钟不再放行 35 分钟）', () => {
    const planning = read('prompts/skill.path-planning.md')
    const taskDesign = read('prompts/skill.path-task-design.md')
    expect(planning).toContain('时间只按 `timeDimensions.sessionsLengthMin` 写**单次节奏**')
    expect(taskDesign).toContain('允许浮动不超过 +5 分钟')
    expect(taskDesign).not.toContain('一节 35 分钟的真课')
  })

  it('path：首站不引入非谓语/后序结构，限时只作形态不作验收判据', () => {
    const planning = read('prompts/skill.path-planning.md')
    expect(planning).not.toContain('一个谓语 vs 多个动词形式的简单对照')
    expect(planning).toContain('首站目标只答本阶段的问题')
    expect(planning).toContain('不解释其余动词形式（-ing / to do / -ed）为什么不是谓语')
    expect(planning).not.toContain('限时连做 N 题正确率不低于 X%')
    expect(planning).toContain('限时只作任务形态')
    expect(planning).toContain('不看提示连续做对 N 题')
    // M4 标题点名「从句与非谓语」，goal 只验从句会复现「标题与验收脱节」
    expect(planning).toContain('标题与验收同域')
    expect(planning).toContain('标题写「从句与非谓语」，goal 就不能只验从句')
  })

  it('path-task-design：前置顺序、末课材料前提、收口课认知层级与 loadTarget 回退', () => {
    const taskDesign = read('prompts/skill.path-task-design.md')
    expect(taskDesign).toContain('阶段内前置顺序自检')
    expect(taskDesign).toContain('不得假设用户手头有正在读的真实材料/正在做的任务')
    expect(taskDesign).toContain('收口课不默认标 create')
    expect(taskDesign).toContain('缺省时读 `cognitiveCore.loadProfile.stageLoadDistribution`')
    // 2026-11-20 密度：low 负荷下，两个未建立概念必须拆成两节；≥4 个平级子类按 2-3 个一组拆
    expect(taskDesign).toContain('若一个任务必须同时用到两个尚未建立的概念')
    expect(taskDesign).toContain('各自只推进一个概念')
    expect(taskDesign).toContain('判断动作不同就算两个概念')
    expect(taskDesign).toContain('同一任务并列教授 ≥4 个平级子类')
    expect(taskDesign).toContain('不得一节课塞完全部子类')
  })

  it('path-reviewer：标题点名的概念必须在同阶段验收里覆盖', () => {
    const reviewer = read('prompts/skill.path-reviewer.md')
    expect(reviewer).toContain('标题与验收脱节')
    expect(reviewer).toContain('只验从句、不验非谓语')
  })

  it('path-planning：阶段递进用一条通用轴，不再内置单案例阶段模板', () => {
    const md = read('prompts/skill.path-planning.md')
    expect(md).toContain('阶段递进轴只有一根：能力增量')
    expect(md).toContain('末阶段允许把前序动作族组合成新产出')
    // 反例回归：曾为「毕设+原型」单案例写死 4 阶段模板，现由通用轴 + 交付物归属覆盖
    expect(md).not.toContain('毕设/论文 + 原型类目标的阶段骨架')
  })

  it('path-reviewer：只列失败特征，不重复定义生成规则', () => {
    const md = read('prompts/skill.path-reviewer.md')
    expect(md).toContain('失败特征清单')
    expect(md).toContain('同模复读')
    expect(md).toContain('产出越位')
    expect(md).toContain('原型落空')
    expect(md).toContain('文案失当')
    expect(md).not.toContain('动作同模检查')
  })
})

/**
 * 2026-11-11 外部评审第二轮（虚拟学习者管线 × Meno 闸/R2/R1/间隔迁移）：
 * 1) epistemic-grounding 只看静态人设，会吞掉教师支架的改进效果；
 * 2) goal 模拟器「拍板带尾巴」会被 confirm 裁决器判成改需求；
 * 3) 教师图/白板没进 visibleContext，学员会问「图在哪」；
 * 4) scenario recurrence 词表与 goal 不一致；referee 不认识 R1/R2/R4。
 */
describe('虚拟学习者管线与 Meno/三摞改造对齐', () => {
  it('epistemic-grounding：教师支架充分度纳入 sampledCorrectness', () => {
    const md = read('prompts/skill.simulation-epistemic-grounding.md')
    expect(md).toContain('无支架冷测必挂')
    expect(md).toContain('有支架微步可过')
    expect(md).toContain('0.40-0.55')
    expect(md).toContain('教师直接给答案让学生抄')
  })

  it('actor-auditor：脚手架答对不算能力悖论泄露', () => {
    const md = read('prompts/skill.simulation-actor-audit.md')
    expect(md).toContain('合理的支架承接')
    expect(md).toContain('不得判为能力悖论泄露')
  })

  it('goal 模拟器：拍板禁带新条件尾巴', () => {
    const md = read('prompts/skill.simulation-goal-dialogue.md')
    expect(md).toContain('纯粹的拍板确认')
    expect(md).toContain('严禁顺带补充新的背景信息、时间条件、顾虑或追问')
  })

  it('learn-turn：白板可见 + memoryRecall 对齐间隔迁移', () => {
    const md = read('prompts/skill.simulation-learn-turn.md')
    expect(md).toContain('【课堂白板】')
    expect(md).toContain('不要问「图在哪」')
    expect(md).toContain('能用旧框架解开老师给的新情境')
    expect(md).toContain('卡在关键判据')
  })

  it('scenario-designer：recurrence 统一 oneoff（once 作历史别名）', () => {
    const md = read('prompts/skill.simulation-scenario-designer.md')
    expect(md).toContain('oneoff | recurring')
    expect(md).toContain('不要写 once')
  })

  it('referee：认识 R1 合理收口口径与 R2/R4 扣分（2026-11-22：编译稿改写措辞，锁新口径）', () => {
    const md = read('prompts/skill.simulation-referee.md')
    expect(md).toContain('R1 无路径收口')
    expect(md).toContain('无路径可以是合理结果')
    expect(md).toContain('R2 Path 体验扣分')
    expect(md).toContain('R4 Teaching 体验扣分')
  })
})
