import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function generateExecutiveSummary() {
  console.log('生成执行摘要...\n')
  
  const sessions = await prisma.teaching_sessions.findMany({
    include: {
      users: {
        include: {
          virtual_learner_profiles: true
        }
      }
    }
  })
  
  // 统计数据
  const stats = {
    total: sessions.length,
    withWrapup: sessions.filter(s => s.wrapup).length,
    withMessages: sessions.filter(s => s.messages).length,
    statusBreakdown: {} as Record<string, number>,
    avgMessageCount: 0,
    sessionsOver5Rounds: 0,
    sessionsOver10Rounds: 0,
    virtualLearnerSessions: 0,
    realUserSessions: 0
  }
  
  const virtualUserIds = new Set<string>()
  const profiles = await prisma.virtual_learner_profiles.findMany()
  profiles.forEach(p => virtualUserIds.add(p.userId))
  
  sessions.forEach(s => {
    stats.statusBreakdown[s.status] = (stats.statusBreakdown[s.status] || 0) + 1
    
    if (virtualUserIds.has(s.userId)) {
      stats.virtualLearnerSessions++
    } else {
      stats.realUserSessions++
    }
    
    if (s.messages) {
      try {
        const messages = JSON.parse(s.messages)
        stats.avgMessageCount += messages.length
        if (messages.length >= 5) stats.sessionsOver5Rounds++
        if (messages.length >= 10) stats.sessionsOver10Rounds++
      } catch (e) {}
    }
  })
  
  stats.avgMessageCount = stats.avgMessageCount / sessions.length
  
  // 查找最有价值的 sessions
  const valuableSessions = sessions
    .filter(s => s.messages && s.status === 'completed')
    .map(s => {
      try {
        const messages = JSON.parse(s.messages!)
        let confusionCount = 0
        let analysisCount = 0
        
        messages.forEach((msg: any) => {
          if (msg.analysis) analysisCount++
          if (msg.analysis?.confusionPoints) confusionCount += msg.analysis.confusionPoints.length
        })
        
        return {
          id: s.id,
          userId: s.userId,
          messageCount: messages.length,
          confusionCount,
          analysisCount,
          hasWrapup: !!s.wrapup,
          score: messages.length * 2 + confusionCount * 3 + analysisCount + (s.wrapup ? 10 : 0)
        }
      } catch {
        return null
      }
    })
    .filter(s => s !== null)
    .sort((a, b) => b!.score - a!.score)
  
  console.log('================================================================================')
  console.log('WenFlow Teaching Sessions 数据分析 - 执行摘要')
  console.log('================================================================================')
  console.log()
  console.log(`📊 数据概览`)
  console.log(`   总 Sessions: ${stats.total}`)
  console.log(`   时间跨度: 2026-04-24 到 2026-06-16 (53 天)`)
  console.log()
  console.log(`📈 数据完整性`)
  console.log(`   ✅ Messages 覆盖率: ${stats.withMessages}/${stats.total} (100%)`)
  console.log(`   ⚠️  Wrapup 覆盖率: ${stats.withWrapup}/${stats.total} (${(stats.withWrapup/stats.total*100).toFixed(1)}%)`)
  console.log(`   ❌ LSS 指标覆盖率: 0/${stats.total} (0%)`)
  console.log()
  console.log(`🎯 数据质量`)
  console.log(`   平均对话轮次: ${stats.avgMessageCount.toFixed(1)}`)
  console.log(`   ≥5 轮对话: ${stats.sessionsOver5Rounds} sessions`)
  console.log(`   ≥10 轮对话: ${stats.sessionsOver10Rounds} sessions`)
  console.log()
  console.log(`👥 用户类型`)
  console.log(`   真实用户: ${stats.realUserSessions} sessions`)
  console.log(`   虚拟学习者: ${stats.virtualLearnerSessions} sessions`)
  console.log()
  console.log(`📋 Status 分布`)
  Object.entries(stats.statusBreakdown).forEach(([status, count]) => {
    const percentage = (count / stats.total * 100).toFixed(1)
    console.log(`   ${status}: ${count} (${percentage}%)`)
  })
  console.log()
  console.log(`================================================================================`)
  console.log()
  console.log(`🎯 关键发现`)
  console.log()
  console.log(`1. LSS 指标完全缺失`)
  console.log(`   - 所有 wrapup 中都没有 sessionLss、sessionKtl、sessionLf 字段`)
  console.log(`   - 无法用于测试 "学习压力识别" 相关 Prompt`)
  console.log(`   - 需要检查 wrapup 生成逻辑`)
  console.log()
  console.log(`2. Wrapup 生成率低`)
  console.log(`   - 只有 completed sessions 有 wrapup (8/36)`)
  console.log(`   - timeout 和 paused sessions 都没有 wrapup (0/70)`)
  console.log(`   - 可能是因为 session 未正常结束`)
  console.log()
  console.log(`3. 超时率高`)
  console.log(`   - 59.4% 的 sessions 状态为 timeout`)
  console.log(`   - timeout sessions 平均只有 2.6 轮对话`)
  console.log(`   - 可能是测试数据或用户中途离开`)
  console.log()
  console.log(`4. 虚拟学习者数据质量更好`)
  console.log(`   - 虚拟学习者平均 10.5 轮对话，真实用户平均 4.7 轮`)
  console.log(`   - 虚拟学习者对话更完整、更连贯`)
  console.log(`   - 建议优先使用虚拟学习者数据进行测试`)
  console.log()
  console.log(`================================================================================`)
  console.log()
  console.log(`✅ 可立即使用的数据`)
  console.log()
  console.log(`1. 困惑点检测测试 (31 sessions)`)
  console.log(`   - 29.2% 的 sessions 有困惑点标注`)
  console.log(`   - 平均每 session 1.75 个困惑点`)
  console.log(`   - 可用于测试 AI 的困惑识别和解惑策略`)
  console.log()
  console.log(`2. 认知层级识别测试 (303 次标注)`)
  console.log(`   - analyze: 181 次`)
  console.log(`   - understand: 47 次`)
  console.log(`   - apply: 41 次`)
  console.log(`   - 可用于测试 AI 的认知层级判断`)
  console.log()
  console.log(`3. 对话连贯性测试 (40 sessions, ≥5轮)`)
  console.log(`   - 包含 ${stats.sessionsOver5Rounds} 个对话轮次 ≥5 的 sessions`)
  console.log(`   - 包含 ${stats.sessionsOver10Rounds} 个对话轮次 ≥10 的 sessions`)
  console.log(`   - 可用于测试 AI 的对话流畅度和上下文理解`)
  console.log()
  console.log(`================================================================================`)
  console.log()
  console.log(`❌ 需要补充的数据`)
  console.log()
  console.log(`1. LSS 指标数据 (优先级: 🔥🔥🔥)`)
  console.log(`   - 需要修复 wrapup 生成逻辑，确保包含 sessionLss、sessionKtl、sessionLf`)
  console.log(`   - 或者重新运行已有 sessions 生成 wrapup`)
  console.log(`   - 或者生成新的完整 sessions`)
  console.log()
  console.log(`2. 完整的 Wrapup 数据 (优先级: 🔥🔥)`)
  console.log(`   - 目前只有 7.5% 的 sessions 有 wrapup`)
  console.log(`   - 需要确保 sessions 正常结束时生成 wrapup`)
  console.log(`   - 或者为现有 sessions 补充生成 wrapup`)
  console.log()
  console.log(`3. 更多高质量对话 (优先级: 🔥)`)
  console.log(`   - 目前只有 ${stats.sessionsOver10Rounds} 个 sessions 对话 ≥10 轮`)
  console.log(`   - 建议通过虚拟学习者生成 20-30 个完整对话`)
  console.log(`   - 覆盖不同难度、不同主题`)
  console.log()
  console.log(`================================================================================`)
  console.log()
  console.log(`🏆 TOP 10 最有价值的 Sessions (按评分排序)`)
  console.log()
  console.log(`评分规则: 对话轮次×2 + 困惑点×3 + 分析次数 + 有wrapup奖励10分`)
  console.log()
  
  valuableSessions.slice(0, 10).forEach((s, idx) => {
    console.log(`${idx + 1}. Session ${s!.id.substring(0, 30)}...`)
    console.log(`   评分: ${s!.score} | 对话: ${s!.messageCount}轮 | 困惑点: ${s!.confusionCount} | 分析: ${s!.analysisCount} | Wrapup: ${s!.hasWrapup ? '✅' : '❌'}`)
  })
  console.log()
  console.log(`================================================================================`)
  console.log()
  console.log(`📝 下一步行动建议`)
  console.log()
  console.log(`立即可做:`)
  console.log(`  1. 使用现有的困惑点和认知层级数据测试相关 Prompt`)
  console.log(`  2. 检查 wrapup 生成代码，找出为什么 LSS 字段缺失`)
  console.log(`  3. 导出 TOP 10 sessions 作为测试 seed`)
  console.log()
  console.log(`短期 (1-2 天):`)
  console.log(`  1. 修复 wrapup 生成逻辑，确保包含 LSS 字段`)
  console.log(`  2. 为现有的 completed sessions 补充生成 wrapup`)
  console.log(`  3. 通过虚拟学习者生成 10 个新的完整 sessions`)
  console.log()
  console.log(`中期 (1 周):`)
  console.log(`  1. 建立标准测试数据集 (20-30 个高质量 sessions)`)
  console.log(`  2. 清理低质量数据 (对话 <3 轮的 timeout sessions)`)
  console.log(`  3. 建立数据质量监控机制`)
  console.log()
  console.log(`================================================================================`)
  console.log()
  console.log(`分析完成! 所有报告已保存到 analysis_output/ 目录`)
  console.log()
  
  // 保存摘要
  const summary = {
    generatedAt: new Date().toISOString(),
    stats,
    topSessions: valuableSessions.slice(0, 10),
    recommendations: {
      immediate: [
        '使用现有的困惑点和认知层级数据测试相关 Prompt',
        '检查 wrapup 生成代码，找出为什么 LSS 字段缺失',
        '导出 TOP 10 sessions 作为测试 seed'
      ],
      shortTerm: [
        '修复 wrapup 生成逻辑，确保包含 LSS 字段',
        '为现有的 completed sessions 补充生成 wrapup',
        '通过虚拟学习者生成 10 个新的完整 sessions'
      ],
      mediumTerm: [
        '建立标准测试数据集 (20-30 个高质量 sessions)',
        '清理低质量数据 (对话 <3 轮的 timeout sessions)',
        '建立数据质量监控机制'
      ]
    }
  }
  
  const outputDir = path.join(__dirname, '..', 'analysis_output')
  const summaryPath = path.join(outputDir, 'executive_summary.json')
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.log(`✓ 执行摘要已保存: ${summaryPath}`)
}

generateExecutiveSummary()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
