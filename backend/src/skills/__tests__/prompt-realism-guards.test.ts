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
  it('goal-conversation：离场信号只收口、不下快选、不援引延期同权', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('离场信号 ≠ 延期信号')
    expect(md).toContain('不得再提问、不得复述步骤、不得下发 quickReplies')
    // 快选字段说明也要保留收口轮留空
    expect(md).toContain('用户离场/收口轮')
  })

  it('goal-conversation：能力缺口 × 在办真实任务不得整包交付 SOP', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('真实任务当教材，禁止整包 SOP')
    expect(md).toContain('最多给一个诊断动作')
    expect(md).toContain('不要再等用户离线做完')
    expect(md).toContain('弄好回我')
    expect(md).toContain('第一课的交付物必须就是这次真实任务的产物')
  })

  it('goal-conversation：scope_size 颗粒度标签必须与 key_stages 自洽', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('标签必须与你自己给的关键阶段数自洽')
    expect(md).toContain('3 段以上仍写 [单点概念] 会被忽略')
  })

  it('goal-conversation：不在对话里报总账（总学时/总坐学数交给路径卡片）', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('不在对话里报总账')
    expect(md).toContain('不得在对话文本里口头承诺')
    expect(md).toContain('不写总小时数、不写总坐学次数')
  })

  it('goal-conversation：not_judgeable 不排路径，禁止先提案再拒单', () => {
    const md = read('prompts/skill.goal-conversation.md')
    expect(md).toContain('not_judgeable 一律不排路径')
    expect(md).toContain('不得输出 confirmedProposal、不得进入 proposing')
  })

  it('path-planning：交付物归属唯一（不再把后段成品写进前段）', () => {
    const md = read('prompts/skill.path-planning.md')
    expect(md).toContain('交付物归属唯一')
    expect(md).toContain('不得出现「转成/写成/改成/说出可直接发送的话」')
  })

  it('stage-designer：阶段任务不得越界产出后段成品', () => {
    const md = read('prompts/skill.stage-designer.md')
    expect(md).toContain('阶段交付物不越界')
    expect(md).toContain('禁止提前产出成品措辞或成稿')
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
    const md = read('prompts/skill.virtual-learner-epistemic-grounding.md')
    expect(md).toContain('无支架冷测必挂')
    expect(md).toContain('有支架微步可过')
    expect(md).toContain('0.40-0.55')
    expect(md).toContain('教师直接给答案让学生抄')
  })

  it('actor-auditor：脚手架答对不算能力悖论泄露', () => {
    const md = read('prompts/skill.virtual-learner-actor-auditor.md')
    expect(md).toContain('合理的支架承接')
    expect(md).toContain('不得判为能力悖论泄露')
  })

  it('goal 模拟器：拍板禁带新条件尾巴', () => {
    const md = read('prompts/skill.virtual-learner-goal-dialogue-simulator.md')
    expect(md).toContain('纯粹的拍板确认')
    expect(md).toContain('严禁顺带补充新的背景信息、时间条件、顾虑或追问')
  })

  it('learn-turn：白板可见 + memoryRecall 对齐间隔迁移', () => {
    const md = read('prompts/skill.virtual-learner-learn-turn-simulator.md')
    expect(md).toContain('【课堂白板】')
    expect(md).toContain('不要问「图在哪」')
    expect(md).toContain('能用旧框架解开老师给的新情境')
    expect(md).toContain('卡在关键判据')
  })

  it('scenario-designer：recurrence 统一 oneoff（once 作历史别名）', () => {
    const md = read('prompts/skill.virtual-learner-scenario-designer.md')
    expect(md).toContain('oneoff | recurring')
    expect(md).toContain('不要写 once')
  })

  it('referee：认识 R1 豁免与 R2/R4 扣分', () => {
    const md = read('prompts/skill.virtual-learner-referee.md')
    expect(md).toContain('R1 豁免')
    expect(md).toContain('R2 Path 体验扣分')
    expect(md).toContain('R4 Teaching 体验扣分')
  })
})
