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

/** 把一批行的某个时间列整体平移到「最近 days 天」区间，保留相对顺序 */
async function shiftTime(table: string, col: string, days = 30): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<{ id: unknown; t: number | null }>>(
    `SELECT id, ${col} AS t FROM "${table}" WHERE ${col} IS NOT NULL ORDER BY ${col} ASC`,
  )
  if (!rows.length) return 0
  const first = Number(rows[0].t)
  const last = Number(rows[rows.length - 1].t)
  const span = Math.max(last - first, 1)
  const targetStart = now - days * DAY
  const targetSpan = now - 6 * 60 * 60 * 1000 - targetStart
  for (const r of rows) {
    const ratio = (Number(r.t) - first) / span
    const next = Math.round(targetStart + ratio * targetSpan)
    await db.$executeRawUnsafe(`UPDATE "${table}" SET ${col} = ? WHERE id = ?`, next, r.id)
  }
  return rows.length
}

async function main(): Promise<void> {
  console.log('=== 1. 平移存量时间到最近 30 天 ===')
  const shifts: Array<[string, string]> = [
    ['agent_call_logs', 'createdAt'],
    ['prompt_call_logs', 'createdAt'],
    ['llm_execution_attempts', 'createdAt'],
    ['goal_conversations', 'createdAt'],
    ['learning_paths', 'createdAt'],
    ['memory_traces', 'createdAt'],
    ['admin_audit_logs', 'createdAt'],
    ['virtual_session_logs', 'createdAt'],
    ['learner_evidence', 'createdAt'],
    ['learner_projections', 'updatedAt'],
    ['path_generation_runs', 'createdAt'],
    ['path_generation_stage_items', 'createdAt'],
    ['domain_event_outbox', 'createdAt'],
    ['domain_event_inbox', 'createdAt'],
    ['degradation_events', 'createdAt'],
    ['misconception_ledger', 'createdAt'],
    ['learning_metrics', 'calculatedAt'],
    ['prediction_records', 'createdAt'],
    ['login_attempts', 'createdAt'],
    ['admin_sessions', 'createdAt'],
    ['user_sessions', 'createdAt'],
  ]
  for (const [table, col] of shifts) {
    try {
      const n = await shiftTime(table, col)
      console.log(`  ${table}.${col}: ${n} 行`)
    } catch (e) {
      console.log(`  ${table}.${col}: 跳过（${String(e).slice(0, 60)}）`)
    }
  }

  console.log('\n=== 2. 补造空表数据 ===')
  const users = await db.users.findMany({ select: { id: true, name: true }, take: 12 })
  if (!users.length) {
    console.log('  没有用户，跳过关联数据')
    return
  }
  const u = (i: number) => users[i % users.length].id
  const sessions = await db.teaching_sessions.findMany({ select: { id: true, userId: true }, take: 12 })
  const sessionOf = (i: number) => sessions[i % Math.max(sessions.length, 1)]?.id ?? `${PREFIX}session-${i}`

  // 2a. 反馈（运营中心「待处理反馈」+ 反馈页）
  const feedbackStates = ['new', 'new', 'new', 'in_progress', 'resolved', 'new', 'in_progress', 'resolved']
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
        createdBy: users[0].id,
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
        createdBy: users[0].id,
        createdAt: new Date(now - i * 0.6 * DAY),
      },
    })
    nt++
  }
  console.log(`  站内通知：新增 ${nt} 条`)

  console.log('\n完成。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
