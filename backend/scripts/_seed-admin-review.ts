/**
 * 后台走查用的数据准备（一次性脚本，不进生产路径）
 *
 * 背景：工作树 dev.db 的数据最新停在 2026-10-09，而今天是 10-26——所有默认「今天 / 近 7 天」
 * 筛选的页面自然全是空态。空态好看不代表有数据时好用，走查必须看到真实密度下的排版。
 *
 * 做两件事：
 *   1) 把存量业务数据的时间平移到「最近 30 天」，让今天 / 近 7 天窗口里有东西；
 *   2) 补造两边都空的表（反馈 / 公告 / 学习目标 / 快速学习），这些是页面空态的真正原因。
 *
 * 幂等：靠固定 id 前缀 wfaudit- 判重，重复跑不会翻倍。
 * 安全：只动本工作树的 prisma/dev.db，先备份再跑。
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const DAY = 86_400_000
const now = Date.now()
const PREFIX = 'wfaudit-'

/** 把一批行的某个时间列整体平移到「最近 days 天」区间，保留相对顺序。
 *
 *  `also` 列出同一行上要**按同一比例**跟着走的兄弟时间列。只平移锚列会让同一行
 *  自相矛盾：目标对话的 createdAt 进了最近 30 天，updatedAt / completedAt 还停在 10-09，
 *  于是页面「最近活动」列整列显示 10月9日（2026-10-26 有数据走查实见）——
 *  看着像所有人那天之后都没再动过。
 *
 *  兄弟列按**各自相对锚列的时间差**平移（差值保留，不是简单覆盖）：
 *  completedAt 晚于 createdAt 三分钟，平移后仍晚三分钟。 */
async function shiftTime(
  table: string,
  col: string,
  also: string[] = [],
  days = 30,
): Promise<number> {
  const extra = also.length ? `, ${also.join(', ')}` : ''
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, ${col} AS t${extra} FROM "${table}" WHERE ${col} IS NOT NULL ORDER BY ${col} ASC`,
  )
  if (!rows.length) return 0
  const first = Number(rows[0].t)
  const last = Number(rows[rows.length - 1].t)
  const span = Math.max(last - first, 1)
  const targetStart = now - days * DAY
  const targetSpan = now - 6 * 60 * 60 * 1000 - targetStart
  for (const r of rows) {
    const anchor = Number(r.t)
    const next = Math.round(targetStart + ((anchor - first) / span) * targetSpan)
    const sets = [`${col} = ?`]
    const vals: unknown[] = [next]
    for (const sibling of also) {
      const v = r[sibling]
      if (v == null) continue
      sets.push(`${sibling} = ?`)
      vals.push(Math.round(next + (Number(v) - anchor)))
    }
    vals.push(r.id)
    await db.$executeRawUnsafe(
      `UPDATE "${table}" SET ${sets.join(', ')} WHERE id = ?`,
      ...vals,
    )
  }
  return rows.length
}

async function main(): Promise<void> {
  console.log('=== 1. 平移存量时间到最近 30 天 ===')
  const shifts: Array<[string, string, string[]?]> = [
    ['agent_call_logs', 'createdAt'],
    ['prompt_call_logs', 'createdAt'],
    ['llm_execution_attempts', 'createdAt'],
    ['goal_conversations', 'createdAt', ['updatedAt', 'completedAt']],
    ['learning_paths', 'createdAt', ['updatedAt']],
    ['memory_traces', 'createdAt', ['updatedAt', 'lastReviewedAt']],
    ['admin_audit_logs', 'createdAt'],
    ['virtual_session_logs', 'createdAt'],
    ['learner_evidence', 'createdAt', ['occurredAt']],
    ['learner_projections', 'updatedAt'],
    ['path_generation_runs', 'createdAt', ['updatedAt', 'finishedAt']],
    ['path_generation_stage_items', 'createdAt', ['updatedAt']],
    ['domain_event_outbox', 'createdAt'],
    ['domain_event_inbox', 'createdAt'],
    ['degradation_events', 'createdAt'],
    ['misconception_ledger', 'createdAt', ['updatedAt']],
    ['learning_metrics', 'calculatedAt'],
    ['prediction_records', 'createdAt'],
    ['teaching_sessions', 'createdAt', ['updatedAt', 'startTime', 'endTime']],
    /* 认证表不在这里平移：admin_sessions 的 expiresAt 不随 createdAt 走，
       平移 createdAt 会让「已签发会话」看起来刚建、却按旧 expiresAt 判过期——
       走查时登录态被踢出，且 403 会把前端 localStorage 的会话标记清掉。
       login_attempts / user_sessions 同理：它们是安全审计时间线，不该被伪造。 */
  ]
  for (const [table, col, also] of shifts) {
    try {
      const n = await shiftTime(table, col, also)
      console.log(`  ${table}.${col}: ${n} 行`)
    } catch (e) {
      console.log(`  ${table}.${col}: 跳过（${String(e).slice(0, 60)}）`)
    }
  }

  console.log('\n=== 2. 补造空表数据 ===')
  /* 反馈列表默认排除虚拟账号（buildNonVirtualUserWhere）——种子必须挂真实账号，
     否则页面上「待处理反馈」恒为 0，走查看到的是假空态。 */
  const users = await db.users.findMany({
    where: { isVirtualLearner: false, deletedAt: null },
    select: { id: true, name: true },
    take: 12,
  })
  if (!users.length) {
    console.log('  没有非虚拟账号，跳过关联数据')
    return
  }
  /* 公告的创建人写管理员 id（admin_ 前缀），不写普通账号：
     后端 shapeWithCreatorNames 只解析 admin_* → 管理员名，其它 id 原样上屏，
     页面上就是那串 UUID（2026-10-26 走查实见）。 */
  const admin = await db.users.findFirst({ where: { isAdmin: true }, select: { id: true } })
  const authorId = admin?.id ?? users[0].id
  const u = (i: number) => users[i % users.length].id
  const sessions = await db.teaching_sessions.findMany({ select: { id: true, userId: true }, take: 12 })
  const sessionOf = (i: number) => sessions[i % Math.max(sessions.length, 1)]?.id ?? `${PREFIX}session-${i}`

  // 2a. 反馈（运营中心「待处理反馈」+ 反馈页）
  // 状态枚举与后端 listQuerySchema 对齐：new / triaged / resolved / dismissed
  const feedbackStates = ['new', 'new', 'new', 'triaged', 'resolved', 'new', 'triaged', 'resolved']
  let fb = 0
  for (let i = 0; i < 14; i++) {
    const id = `${PREFIX}feedback-${i}`
    const exists = await db.content_feedback.findUnique({ where: { id } })
    if (exists) continue
    await db.content_feedback.create({
      data: {
        id,
        feedbackKey: `${PREFIX}fbkey-${i}`,
        userId: u(i),
        sessionId: sessionOf(i),
        agentId: ['teaching-agent', 'goal-conversation', 'path-planning'][i % 3],
        rating: [5, 4, 3, 2, 5, 4, 1, 3][i % 8],
        helpfulness: 1 + (i % 5),
        clarity: 1 + ((i + 2) % 5),
        difficulty: 1 + ((i + 1) % 5),
        difficultyFit: ['too_easy', 'fit', 'fit', 'too_hard'][i % 4],
        comment: [
          '第三步的示例和练习题对不上，看了两遍没明白要算什么',
          '总结里把我的目标写成了「提高数学」，我原话是「把函数单调性弄懂」',
          '节奏太快，一节课塞了五个知识点',
          '这个比喻很好懂，希望后面也这样讲',
          '复习提醒来得太频繁，一天推了三次',
          '路径里第二章直接跳过了基础概念，卡住了',
          '对话里重复问我同一个问题两次',
          '界面上的「继续」按钮点了没反应，要刷新才行',
        ][i % 8],
        suggestions: i % 3 === 0 ? '希望每个知识点后面跟一道小题' : null,
        confusionPoint: i % 4 === 0 ? '函数单调性判定' : null,
        reasonCodes: i % 2 === 0 ? '["content_unclear"]' : '["pace_too_fast"]',
        strategy: ['socratic', 'direct', 'scaffold'][i % 3],
        uiType: ['lesson', 'summary', 'review'][i % 3],
        roundNumber: 1 + (i % 4),
        status: feedbackStates[i % feedbackStates.length],
        createdAt: new Date(now - (i * 1.8 + 0.4) * DAY),
        updatedAt: new Date(now - (i * 1.8 + 0.4) * DAY),
      },
    })
    fb++
  }
  console.log(`  反馈：新增 ${fb} 条`)

  // 2b. 公告（运营中心「草稿公告」+ 公告页）
  const annSpecs: Array<[string, string, string, string, number | null]> = [
    ['10 月 26 日 02:00-04:00 例行维护', '维护期间教学会话可能中断，未保存的进度会自动恢复。', 'warning', 'published', 0.3],
    ['新增「复习积压」观测页', '运营可以在「学习」组直接看到跨用户的到期复习量。', 'info', 'published', 2.5],
    ['关于虚拟学习者并发上限的调整', '单实例并发上限由 5 调到 10，压测前请先确认上游配额。', 'info', 'published', 5],
    ['11 月课程内容更新计划', '第一批更新的 12 个知识点已进入评审，预计 11 月 3 日上线。', 'info', 'draft', null],
    ['反馈处理时效要求调整', '待处理反馈的首次响应时限从 48 小时收紧到 24 小时。', 'warning', 'draft', null],
    ['历史公告归档说明', '9 月之前的公告已归档，可在公告页切换状态查看。', 'info', 'archived', 20],
  ]
  let an = 0
  for (let i = 0; i < annSpecs.length; i++) {
    const id = `${PREFIX}announce-${i}`
    const exists = await db.announcements.findUnique({ where: { id } })
    if (exists) continue
    const [title, body, severity, status, publishedDaysAgo] = annSpecs[i]
    await db.announcements.create({
      data: {
        id,
        title,
        body,
        severity,
        status,
        publishedAt: publishedDaysAgo === null ? null : new Date(now - publishedDaysAgo * DAY),
        expiresAt: status === 'published' ? new Date(now + 30 * DAY) : null,
        createdBy: authorId,
        createdAt: new Date(now - (publishedDaysAgo ?? i + 1) * DAY),
        updatedAt: new Date(now - (publishedDaysAgo ?? i + 1) * DAY),
      },
    })
    an++
  }
  console.log(`  公告：新增 ${an} 条`)

  // 2c. 学习目标（目标对话页的父实体）
  const goals = [
    ['把函数单调性彻底弄懂', '能在不看笔记的情况下判断复合函数的单调区间'],
    ['三周内完成需求分析作品集', '产出 3 份可展示的需求分析文档'],
    ['准备心理学流派考试', '区分四大流派的核心主张与代表人物'],
    ['提高地理综合题得分', '综合题从 18 分提到 25 分'],
    ['搞定期末线性代数', '矩阵与特征值部分不再丢分'],
    ['系统学习分布式一致性', '能讲清 Raft 与 Paxos 的差别'],
    ['通过电工证理论考试', '模拟卷稳定在 85 分以上'],
    ['把数学英语提到及格线', '专业术语能读能写'],
  ]
  let lg = 0
  for (let i = 0; i < goals.length; i++) {
    const id = `${PREFIX}goal-${i}`
    const exists = await db.learning_goals.findUnique({ where: { id } })
    if (exists) continue
    await db.learning_goals.create({
      data: {
        id,
        userId: u(i),
        title: goals[i][0],
        description: goals[i][1],
        status: i < 6 ? 'active' : i === 6 ? 'completed' : 'paused',
        priority: i % 3,
        plannedMinutesPerDay: [30, 45, 60][i % 3],
        createdAt: new Date(now - (i * 2.2 + 1) * DAY),
        updatedAt: new Date(now - (i * 1.1) * DAY),
      },
    })
    lg++
  }
  console.log(`  学习目标：新增 ${lg} 条`)

  // 2d. 站内通知（按用户投递：后台公告页与用户端共用一张表）
  let nt = 0
  for (let i = 0; i < 8; i++) {
    const id = `${PREFIX}notif-${i}`
    const exists = await db.notifications.findUnique({ where: { id } })
    if (exists) continue
    await db.notifications.create({
      data: {
        id,
        userId: u(i),
        title: ['维护通知已发布', '你有 3 条待处理反馈', '本月成本报告已生成', '有 2 个 Skill 成功率低于 60%', '复习积压超过阈值'][i % 5],
        body: '详情见对应页面。',
        kind: ['announcement', 'system', 'system', 'system', 'system'][i % 5],
        link: ['/admin/ops-hub?tab=announce', '/admin/ops-hub?tab=feedback', '/admin/token-cost', '/admin/skills', '/admin/memory-review'][i % 5],
        isRead: i > 5,
        createdBy: authorId,
        createdAt: new Date(now - i * 0.6 * DAY),
      },
    })
    nt++
  }
  console.log(`  站内通知：新增 ${nt} 条`)

  /* 2e. 派生虚拟学习者实例
     「虚拟学习者」页只列派生实例（profile 含 derivedFrom），卡库那 21 张是 builtin 预置卡。
     两边都空时该页恒为空态，看不出运行态列表的排版。
     约束：virtual_learner_profiles.userId 与 presetKey 都是唯一键——每个实例要配独立虚拟账号，
     且不能复用模板的 presetKey（留空）。 */
  const templates = await db.virtual_learner_profiles.findMany({ where: { source: 'builtin' }, take: 3 })
  let derived = 0
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    const vpId = `${PREFIX}vp-${i}`
    const existing = await db.virtual_learner_profiles.findUnique({ where: { id: vpId } })
    if (existing) {
      /* 早期版本写的是 presetId/presetKey，卡墙认不出派生（见下）。已存在的行就地补正。 */
      let old: Record<string, unknown> = {}
      try {
        old = JSON.parse(String(existing.profile))
      } catch {
        old = {}
      }
      const df = old.derivedFrom as Record<string, unknown> | undefined
      if (!df?.name) {
        delete old.cardKey
        old.cardKey = `vl-${vpId.slice(-8)}`
        old.derivedFrom = {
          profileId: t.id,
          cardKey: t.presetKey ?? null,
          name: `派生学习者${i + 1}`,
          at: df?.at ?? new Date(now - i * DAY).toISOString(),
        }
        await db.virtual_learner_profiles.update({
          where: { id: vpId },
          data: { profile: JSON.stringify(old) },
        })
        derived++
      }
      continue
    }
    const uid = `${PREFIX}vu-${i}`
    if (!(await db.users.findUnique({ where: { id: uid } }))) {
      await db.users.create({
        data: {
          id: uid,
          email: `${uid}@wenflow.local`,
          name: `派生学习者${i + 1}`,
          password: 'x',
          role: 'user',
          currentLevel: 'beginner',
          isVirtualLearner: true,
          createdAt: new Date(now - (i + 2) * DAY),
          updatedAt: new Date(now - (i + 2) * DAY),
        },
      })
    }
    let prof: Record<string, unknown> = {}
    try {
      prof = JSON.parse(String(t.profile))
    } catch {
      prof = {}
    }
    /* 派生标记要照 card-import.service 的真实形状写：卡墙用 profile.derivedFrom.**name**
       判「这是实例不是卡」（buildCardWallEntries:502）。只写 presetId/presetKey 的话
       卡库认不出来，3 张派生实例会混进身份卡墙，「已创建实例」恒为 0
       （2026-10-26 有数据走查实见）。
       同时剥掉模板身份：cardKey 必须重算（沿用源卡号会让「导出卡库」把它当同一张卡），
       运行期状态（recentCompleted）也不该跟着克隆走。 */
    const cardKey = `vl-${vpId.slice(-8)}`
    delete prof.cardKey
    delete prof.recentCompleted
    prof.cardKey = cardKey
    prof.derivedFrom = {
      profileId: t.id,
      cardKey: t.presetKey ?? null,
      name: `派生学习者${i + 1}`,
      at: new Date(now - i * DAY).toISOString(),
    }
    await db.virtual_learner_profiles.create({
      data: {
        id: vpId,
        userId: uid,
        profile: JSON.stringify(prof),
        learningGoal: t.learningGoal,
        knowledgeLevel: t.knowledgeLevel,
        knownConcepts: t.knownConcepts,
        struggleConcepts: t.struggleConcepts,
        simulationPrompt: t.simulationPrompt,
        simulationModel: t.simulationModel,
        simulationTemperature: t.simulationTemperature,
        personalityTraits: t.personalityTraits,
        tags: t.tags,
        notes: t.notes,
        createdAt: new Date(now - (i + 1) * DAY),
        updatedAt: new Date(now - (i + 1) * DAY),
        source: 'derived',
        presetKey: null,
        presetVersion: null,
      },
    })
    derived++
  }
  console.log(`  派生虚拟学习者：新增 ${derived} 条`)

  /* 2g. 学习路径进度
     源库 20 条路径的 completedMilestones 全是 0——「进度」列整列 0%，看不出进度条
     有值时的排版与「已完成」页签。给前 6 条各补一段真实进度：解锁若干里程碑、
     完成其中 1-2 个，并把 path 的 completedMilestones 一起改写（两处不一致会互相打架）。 */
  const paths = await db.learning_paths.findMany({
    where: { status: 'active' },
    select: { id: true, totalMilestones: true },
    take: 6,
    orderBy: { updatedAt: 'desc' },
  })
  let msDone = 0
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]
    const done = (i % 3) + 1
    const ms = await db.milestones.findMany({
      where: { learningPathId: p.id },
      select: { id: true, stageNumber: true, status: true, startedAt: true, completedAt: true },
      orderBy: { stageNumber: 'asc' },
    })
    for (const m of ms) {
      if (m.completedAt) continue
      if (m.stageNumber > done + 1) break
      const isDone = m.stageNumber <= done
      await db.milestones.update({
        where: { id: m.id },
        data: {
          status: isDone ? 'completed' : 'in_progress',
          unlockedAt: m.stageNumber === 1 ? new Date(now - (i + 3) * DAY) : new Date(now - (i + 2) * DAY),
          startedAt: new Date(now - (i + 2) * DAY),
          completedAt: isDone ? new Date(now - (i + 1) * DAY) : null,
          updatedAt: new Date(now - i * DAY),
        },
      })
      msDone++
    }
    await db.learning_paths.update({
      where: { id: p.id },
      data: { completedMilestones: done, updatedAt: new Date(now - i * 0.8 * DAY) },
    })
  }
  console.log(`  学习路径进度：${paths.length} 条路径、${msDone} 个里程碑`)

  /* 2f. Prompt 评估用例 + 评估历史
     两张表都在 system.db（评估是跨库的运维数据，不跟业务数据同库），所以这里另开一个
     system client——上面的 db 指向 dev.db，用它是查不到这两张表的。
     用例两边都空：页面只剩一个空态，看不出表格、期望摘要、人设失效徽章的排版。
     历史从主库借 3 条（主库有运行记录但没有用例——用例是跑之前才建的，被清过）。 */
  const { PrismaClient: SystemClient } = require('../src/generated/system-client')
  const sys = new SystemClient()
  try {
    const evalCases = [
      ['skill:goal-conversation', 'gc-money-01', '基金亏 30% 该割还是该补', '学生带着「要一个答案」的诉求进来，实际缺的是决策框架。',
        [{ role: 'user', content: '我买的那只基金亏了 30%，你说我该割肉还是补仓？' }],
        { mustIncludeFields: ['stage', 'confidence'], expectedStage: 'understanding' }],
      ['skill:goal-conversation', 'gc-time-02', '想学 Python 但每天只有 20 分钟', '时间极紧的上班族，检验方案是否会压到不可执行。',
        [{ role: 'user', content: '我想学 Python 做数据分析，但每天最多只有 20 分钟。' }],
        { mustIncludeFields: ['stage'], mustContainText: ['每天'], expectedStage: 'understanding' }],
      ['skill:goal-conversation', 'gc-sim-03', '模拟：被大道理劝退的学生', '用派生虚拟学习者跑多轮，检验面对抗拒时的收敛能力。',
        [],
        { mode: 'simulated', scenario: '学生对「长期主义」说教反感，只想要能马上用的办法。', personaId: `${PREFIX}vp-0`, dialogueRounds: 2, frictionBudget: 'normal' }],
      ['skill:path-planning', 'pp-exam-01', '两个月准备教师资格证', '有明确考试日期，检验里程碑是否落在可检查的节点上。',
        [{ role: 'user', content: '我要在两个月内考过教师资格证，帮我拆一下路径。' }],
        { mustIncludeFields: ['cognitiveCore', 'milestones'], expectedStage: 'understanding' }],
      ['skill:path-planning', 'pp-career-02', '转岗做产品经理', '目标宽泛、无截止时间，检验是否会先收敛范围。',
        [{ role: 'user', content: '我想转岗做产品经理，但不知道从哪开始。' }],
        { mustIncludeFields: ['milestones'] }],
      ['skill:stage-designer', 'sd-01', '把「学会函数单调性」拆成子任务', '单里程碑展开，检验子任务粒度是否可执行。',
        [{ role: 'user', content: '把「学会判断复合函数单调性」这个里程碑拆成具体子任务。' }],
        { mustIncludeFields: ['subtasks'] }],
    ] as const
    let ec = 0
    for (let i = 0; i < evalCases.length; i++) {
      const [agentId, caseId, name, description, messages, expectations] = evalCases[i]
      const id = `${PREFIX}ec-${i}`
      if (await sys.prompt_eval_cases.findUnique({ where: { id } })) continue
      await sys.prompt_eval_cases.create({
        data: {
          id,
          agentId,
          caseId,
          name,
          description,
          messagesJson: JSON.stringify(messages),
          expectationsJson: JSON.stringify(expectations),
          // 停用 1 条：列表的启用/停用两态都要能看到
          enabled: i !== 4,
          createdBy: users[0].id,
          createdAt: new Date(now - (i * 1.4 + 1) * DAY),
          updatedAt: new Date(now - (i * 1.4 + 1) * DAY),
        },
      })
      ec++
    }
    console.log(`  评估用例：新增 ${ec} 条`)

    /* 历史从主库借：只读打开主库 system.db，按原 id 写入本库。
       主库路径写死是故意的——这个脚本只服务走查，不参与生产，不引入环境变量。 */
    let er = 0
    const mainSystemDb = 'file:D:/test/wenflow/backend/prisma/system.db'
    const mainSys = new SystemClient({ datasources: { db: { url: mainSystemDb } } })
    try {
      const borrowed = await mainSys.prompt_eval_runs.findMany({ orderBy: { createdAt: 'asc' } })
      for (let i = 0; i < borrowed.length; i++) {
        const r = borrowed[i]
        if (await sys.prompt_eval_runs.findUnique({ where: { id: r.id } })) continue
        // 主库记录停在 10-09，走查看「最近」页签会以为是旧数据：按顺序挪进最近几天
        await sys.prompt_eval_runs.create({
          data: { ...r, createdAt: new Date(now - (borrowed.length - i) * 1.3 * DAY) },
        })
        er++
      }
    } catch (e) {
      console.log(`  评估历史：借入失败（${(e as Error).message.split('\n')[0]}），跳过`)
    } finally {
      await mainSys.$disconnect()
    }
    console.log(`  评估历史：借入 ${er} 条`)
  } finally {
    await sys.$disconnect()
  }

  console.log('\n完成。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
