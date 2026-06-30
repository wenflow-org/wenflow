import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

interface SessionAnalysis {
  basicStats: {
    totalSessions: number
    timeDistribution: {
      earliest: string
      latest: string
      spanDays: number
    }
    statusDistribution: Record<string, number>
    wrapupPresence: {
      total: number
      percentage: number
    }
    messagesPresence: {
      total: number
      percentage: number
    }
  }
  lssData: {
    sessionLss: {
      count: number
      mean: number
      median: number
      min: number
      max: number
      stdDev: number
      distribution: Record<string, number>
    }
    sessionKtl: {
      count: number
      mean: number
      median: number
      min: number
      max: number
      stdDev: number
    }
    sessionLf: {
      count: number
      mean: number
      median: number
      min: number
      max: number
      stdDev: number
    }
    evaluationConfidence: {
      count: number
      mean: number
      median: number
      min: number
      max: number
      distribution: Record<string, number>
    }
    evaluationSources: Record<string, number>
  }
  dialogueQuality: {
    averageRounds: number
    medianRounds: number
    messageAnalysisPresence: {
      total: number
      percentage: number
    }
    confusionPointsDetection: {
      sessionsWithConfusion: number
      percentage: number
      averageConfusionPerSession: number
    }
    cognitiveDistribution: Record<string, number>
  }
  userTypeAnalysis: {
    realUsers: number
    virtualLearners: number
    realUserDataQuality: any
    virtualLearnerDataQuality: any
    virtualLearnerProfiles: any[]
  }
  dataQualityIssues: {
    missingWrapup: number
    missingMessages: number
    zeroLss: number
    maxLss: number
    lowMessageCount: number
  }
  typicalScenarios: any[]
}

function calculateStats(values: number[]) {
  if (values.length === 0) return { mean: 0, median: 0, min: 0, max: 0, stdDev: 0 }
  
  const sorted = values.slice().sort((a, b) => a - b)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const median = sorted[Math.floor(sorted.length / 2)]
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
  const stdDev = Math.sqrt(variance)
  
  return { mean, median, min, max, stdDev }
}

function createDistribution(values: number[], bins: number[] = [0, 3, 5, 7, 10]) {
  const dist: Record<string, number> = {}
  
  for (let i = 0; i < bins.length - 1; i++) {
    const label = `${bins[i]}-${bins[i + 1]}`
    dist[label] = values.filter(v => v >= bins[i] && v < bins[i + 1]).length
  }
  
  const lastBin = bins[bins.length - 1]
  dist[`${lastBin}+`] = values.filter(v => v >= lastBin).length
  
  return dist
}

async function analyzeSessions() {
  console.log('开始分析 teaching_sessions 数据...\n')
  
  const sessions = await prisma.teaching_sessions.findMany({
    include: {
      users: {
        include: {
          virtual_learner_profiles: true
        }
      }
    }
  })
  
  console.log(`找到 ${sessions.length} 个 teaching_sessions\n`)
  
  if (sessions.length === 0) {
    console.log('没有找到任何 teaching_sessions 数据')
    return
  }
  
  const analysis: SessionAnalysis = {
    basicStats: {
      totalSessions: sessions.length,
      timeDistribution: {
        earliest: '',
        latest: '',
        spanDays: 0
      },
      statusDistribution: {},
      wrapupPresence: { total: 0, percentage: 0 },
      messagesPresence: { total: 0, percentage: 0 }
    },
    lssData: {
      sessionLss: { count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0, distribution: {} },
      sessionKtl: { count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0 },
      sessionLf: { count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0 },
      evaluationConfidence: { count: 0, mean: 0, median: 0, min: 0, max: 0, distribution: {} },
      evaluationSources: {}
    },
    dialogueQuality: {
      averageRounds: 0,
      medianRounds: 0,
      messageAnalysisPresence: { total: 0, percentage: 0 },
      confusionPointsDetection: { sessionsWithConfusion: 0, percentage: 0, averageConfusionPerSession: 0 },
      cognitiveDistribution: {}
    },
    userTypeAnalysis: {
      realUsers: 0,
      virtualLearners: 0,
      realUserDataQuality: {},
      virtualLearnerDataQuality: {},
      virtualLearnerProfiles: []
    },
    dataQualityIssues: {
      missingWrapup: 0,
      missingMessages: 0,
      zeroLss: 0,
      maxLss: 0,
      lowMessageCount: 0
    },
    typicalScenarios: []
  }
  
  // 1. 基础统计
  const times = sessions.map(s => new Date(s.startTime)).sort((a, b) => a.getTime() - b.getTime())
  analysis.basicStats.timeDistribution.earliest = times[0].toISOString()
  analysis.basicStats.timeDistribution.latest = times[times.length - 1].toISOString()
  analysis.basicStats.timeDistribution.spanDays = Math.ceil((times[times.length - 1].getTime() - times[0].getTime()) / (1000 * 60 * 60 * 24))
  
  sessions.forEach(s => {
    analysis.basicStats.statusDistribution[s.status] = (analysis.basicStats.statusDistribution[s.status] || 0) + 1
    if (s.wrapup) analysis.basicStats.wrapupPresence.total++
    if (s.messages) analysis.basicStats.messagesPresence.total++
  })
  
  analysis.basicStats.wrapupPresence.percentage = (analysis.basicStats.wrapupPresence.total / sessions.length) * 100
  analysis.basicStats.messagesPresence.percentage = (analysis.basicStats.messagesPresence.total / sessions.length) * 100
  
  // 2. LSS 数据分析
  const lssValues: number[] = []
  const ktlValues: number[] = []
  const lfValues: number[] = []
  const confidenceValues: number[] = []
  
  sessions.forEach(s => {
    if (s.wrapup) {
      try {
        const wrapup = JSON.parse(s.wrapup)
        
        if (wrapup.sessionLss !== undefined && wrapup.sessionLss !== null) {
          lssValues.push(wrapup.sessionLss)
        }
        if (wrapup.sessionKtl !== undefined && wrapup.sessionKtl !== null) {
          ktlValues.push(wrapup.sessionKtl)
        }
        if (wrapup.sessionLf !== undefined && wrapup.sessionLf !== null) {
          lfValues.push(wrapup.sessionLf)
        }
        
        if (wrapup.evaluation?.confidence !== undefined) {
          confidenceValues.push(wrapup.evaluation.confidence)
        }
        
        if (wrapup.sources?.evaluation) {
          const source = wrapup.sources.evaluation
          analysis.lssData.evaluationSources[source] = (analysis.lssData.evaluationSources[source] || 0) + 1
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  })
  
  if (lssValues.length > 0) {
    const stats = calculateStats(lssValues)
    analysis.lssData.sessionLss = {
      count: lssValues.length,
      ...stats,
      distribution: createDistribution(lssValues, [0, 3, 5, 7, 10])
    }
  }
  
  if (ktlValues.length > 0) {
    analysis.lssData.sessionKtl = { count: ktlValues.length, ...calculateStats(ktlValues) }
  }
  
  if (lfValues.length > 0) {
    analysis.lssData.sessionLf = { count: lfValues.length, ...calculateStats(lfValues) }
  }
  
  if (confidenceValues.length > 0) {
    const stats = calculateStats(confidenceValues)
    analysis.lssData.evaluationConfidence = {
      count: confidenceValues.length,
      ...stats,
      distribution: createDistribution(confidenceValues, [0, 0.3, 0.5, 0.7, 0.9])
    }
  }
  
  // 3. 对话质量分析
  const messageCounts: number[] = []
  let totalMessagesWithAnalysis = 0
  let totalConfusionSessions = 0
  let totalConfusions = 0
  const cognitiveCount: Record<string, number> = {}
  
  sessions.forEach(s => {
    if (s.messages) {
      try {
        const messages = JSON.parse(s.messages)
        messageCounts.push(messages.length)
        
        let hasConfusion = false
        messages.forEach((msg: any) => {
          if (msg.analysis) totalMessagesWithAnalysis++
          
          if (msg.analysis?.confusionPoints && msg.analysis.confusionPoints.length > 0) {
            hasConfusion = true
            totalConfusions += msg.analysis.confusionPoints.length
          }
          
          if (msg.analysis?.cognitiveLevel) {
            const level = msg.analysis.cognitiveLevel
            cognitiveCount[level] = (cognitiveCount[level] || 0) + 1
          }
        })
        
        if (hasConfusion) totalConfusionSessions++
      } catch (e) {
        // Skip invalid JSON
      }
    }
  })
  
  if (messageCounts.length > 0) {
    const sorted = messageCounts.slice().sort((a, b) => a - b)
    analysis.dialogueQuality.averageRounds = messageCounts.reduce((a, b) => a + b, 0) / messageCounts.length
    analysis.dialogueQuality.medianRounds = sorted[Math.floor(sorted.length / 2)]
  }
  
  analysis.dialogueQuality.messageAnalysisPresence.total = totalMessagesWithAnalysis
  analysis.dialogueQuality.messageAnalysisPresence.percentage = sessions.length > 0 ? (totalMessagesWithAnalysis / sessions.length) * 100 : 0
  
  analysis.dialogueQuality.confusionPointsDetection.sessionsWithConfusion = totalConfusionSessions
  analysis.dialogueQuality.confusionPointsDetection.percentage = (totalConfusionSessions / sessions.length) * 100
  analysis.dialogueQuality.confusionPointsDetection.averageConfusionPerSession = totalConfusions / sessions.length
  
  analysis.dialogueQuality.cognitiveDistribution = cognitiveCount
  
  // 4. 用户类型分析
  const virtualUserIds = new Set<string>()
  const profiles = await prisma.virtual_learner_profiles.findMany()
  
  profiles.forEach(p => {
    virtualUserIds.add(p.userId)
    analysis.userTypeAnalysis.virtualLearnerProfiles.push({
      userId: p.userId,
      learningGoal: p.learningGoal,
      knowledgeLevel: p.knowledgeLevel,
      simulationMode: p.simulationMode
    })
  })
  
  const virtualSessions = sessions.filter(s => virtualUserIds.has(s.userId))
  const realSessions = sessions.filter(s => !virtualUserIds.has(s.userId))
  
  analysis.userTypeAnalysis.virtualLearners = virtualSessions.length
  analysis.userTypeAnalysis.realUsers = realSessions.length
  
  // 计算数据质量差异
  const calcQuality = (sessionList: typeof sessions) => {
    return {
      total: sessionList.length,
      withWrapup: sessionList.filter(s => s.wrapup).length,
      withMessages: sessionList.filter(s => s.messages).length,
      avgMessageCount: sessionList.reduce((sum, s) => {
        try {
          return sum + (s.messages ? JSON.parse(s.messages).length : 0)
        } catch {
          return sum
        }
      }, 0) / sessionList.length
    }
  }
  
  analysis.userTypeAnalysis.realUserDataQuality = calcQuality(realSessions)
  analysis.userTypeAnalysis.virtualLearnerDataQuality = calcQuality(virtualSessions)
  
  // 5. 数据质量问题
  sessions.forEach(s => {
    if (!s.wrapup) analysis.dataQualityIssues.missingWrapup++
    if (!s.messages) analysis.dataQualityIssues.missingMessages++
    
    if (s.wrapup) {
      try {
        const wrapup = JSON.parse(s.wrapup)
        if (wrapup.sessionLss === 0) analysis.dataQualityIssues.zeroLss++
        if (wrapup.sessionLss === 10) analysis.dataQualityIssues.maxLss++
      } catch (e) {}
    }
    
    if (s.messages) {
      try {
        const messages = JSON.parse(s.messages)
        if (messages.length < 3) analysis.dataQualityIssues.lowMessageCount++
      } catch (e) {}
    }
  })
  
  // 6. 典型场景识别
  const scenarios: Array<{ session: typeof sessions[0], score: number, type: string, reason: string }> = []
  
  sessions.forEach(s => {
    if (!s.wrapup || !s.messages) return
    
    try {
      const wrapup = JSON.parse(s.wrapup)
      const messages = JSON.parse(s.messages)
      
      // 高压力场景
      if (wrapup.sessionLss > 7) {
        scenarios.push({ session: s, score: wrapup.sessionLss, type: 'high-stress', reason: `LSS=${wrapup.sessionLss}` })
      }
      
      // 低压力场景
      if (wrapup.sessionLss < 4 && wrapup.sessionLss > 0) {
        scenarios.push({ session: s, score: wrapup.sessionLss, type: 'low-stress', reason: `LSS=${wrapup.sessionLss}` })
      }
      
      // 困惑多的场景
      let confusionCount = 0
      messages.forEach((msg: any) => {
        if (msg.analysis?.confusionPoints) confusionCount += msg.analysis.confusionPoints.length
      })
      if (confusionCount > 3) {
        scenarios.push({ session: s, score: confusionCount, type: 'high-confusion', reason: `困惑点=${confusionCount}` })
      }
      
      // 顺利完成场景
      if (wrapup.isCompletionCandidate && wrapup.sessionLss < 6) {
        scenarios.push({ session: s, score: 0, type: 'smooth-completion', reason: '顺利完成' })
      }
    } catch (e) {}
  })
  
  // 每种类型选取 2-3 个典型
  const typeGroups = scenarios.reduce((acc, s) => {
    if (!acc[s.type]) acc[s.type] = []
    acc[s.type].push(s)
    return acc
  }, {} as Record<string, typeof scenarios>)
  
  Object.keys(typeGroups).forEach(type => {
    typeGroups[type].sort((a, b) => b.score - a.score)
    analysis.typicalScenarios.push(...typeGroups[type].slice(0, 3).map(s => ({
      sessionId: s.session.id,
      userId: s.session.userId,
      taskId: s.session.taskId,
      type: s.type,
      reason: s.reason,
      startTime: s.session.startTime
    })))
  })
  
  // 输出报告
  console.log('='.repeat(80))
  console.log('WenFlow Teaching Sessions 数据质量分析报告')
  console.log('='.repeat(80))
  console.log()
  
  console.log('【1. 基础统计】')
  console.log(`总 Sessions: ${analysis.basicStats.totalSessions}`)
  console.log(`时间跨度: ${analysis.basicStats.timeDistribution.earliest.split('T')[0]} 到 ${analysis.basicStats.timeDistribution.latest.split('T')[0]} (${analysis.basicStats.timeDistribution.spanDays} 天)`)
  console.log(`Status 分布:`, analysis.basicStats.statusDistribution)
  console.log(`Wrapup 覆盖率: ${analysis.basicStats.wrapupPresence.total}/${analysis.basicStats.totalSessions} (${analysis.basicStats.wrapupPresence.percentage.toFixed(1)}%)`)
  console.log(`Messages 覆盖率: ${analysis.basicStats.messagesPresence.total}/${analysis.basicStats.totalSessions} (${analysis.basicStats.messagesPresence.percentage.toFixed(1)}%)`)
  console.log()
  
  console.log('【2. LSS 数据分析】')
  console.log(`SessionLss 统计 (n=${analysis.lssData.sessionLss.count}):`)
  console.log(`  平均值: ${analysis.lssData.sessionLss.mean.toFixed(2)}`)
  console.log(`  中位数: ${analysis.lssData.sessionLss.median.toFixed(2)}`)
  console.log(`  范围: ${analysis.lssData.sessionLss.min.toFixed(2)} - ${analysis.lssData.sessionLss.max.toFixed(2)}`)
  console.log(`  标准差: ${analysis.lssData.sessionLss.stdDev.toFixed(2)}`)
  console.log(`  分布:`, analysis.lssData.sessionLss.distribution)
  console.log()
  
  if (analysis.lssData.sessionKtl.count > 0) {
    console.log(`SessionKtl 统计 (n=${analysis.lssData.sessionKtl.count}):`)
    console.log(`  平均值: ${analysis.lssData.sessionKtl.mean.toFixed(2)}`)
    console.log(`  中位数: ${analysis.lssData.sessionKtl.median.toFixed(2)}`)
    console.log(`  范围: ${analysis.lssData.sessionKtl.min.toFixed(2)} - ${analysis.lssData.sessionKtl.max.toFixed(2)}`)
    console.log()
  }
  
  if (analysis.lssData.sessionLf.count > 0) {
    console.log(`SessionLf 统计 (n=${analysis.lssData.sessionLf.count}):`)
    console.log(`  平均值: ${analysis.lssData.sessionLf.mean.toFixed(2)}`)
    console.log(`  中位数: ${analysis.lssData.sessionLf.median.toFixed(2)}`)
    console.log(`  范围: ${analysis.lssData.sessionLf.min.toFixed(2)} - ${analysis.lssData.sessionLf.max.toFixed(2)}`)
    console.log()
  }
  
  if (analysis.lssData.evaluationConfidence.count > 0) {
    console.log(`Evaluation Confidence 统计 (n=${analysis.lssData.evaluationConfidence.count}):`)
    console.log(`  平均值: ${analysis.lssData.evaluationConfidence.mean.toFixed(2)}`)
    console.log(`  中位数: ${analysis.lssData.evaluationConfidence.median.toFixed(2)}`)
    console.log(`  分布:`, analysis.lssData.evaluationConfidence.distribution)
    console.log()
  }
  
  console.log(`Evaluation Sources:`, analysis.lssData.evaluationSources)
  console.log()
  
  console.log('【3. 对话质量分析】')
  console.log(`平均对话轮次: ${analysis.dialogueQuality.averageRounds.toFixed(1)}`)
  console.log(`中位数对话轮次: ${analysis.dialogueQuality.medianRounds}`)
  console.log(`困惑点检测: ${analysis.dialogueQuality.confusionPointsDetection.sessionsWithConfusion}/${analysis.basicStats.totalSessions} 个 Session (${analysis.dialogueQuality.confusionPointsDetection.percentage.toFixed(1)}%)`)
  console.log(`平均困惑点/Session: ${analysis.dialogueQuality.confusionPointsDetection.averageConfusionPerSession.toFixed(2)}`)
  console.log(`认知层级分布:`, analysis.dialogueQuality.cognitiveDistribution)
  console.log()
  
  console.log('【4. 用户类型分析】')
  console.log(`真实用户 Sessions: ${analysis.userTypeAnalysis.realUsers}`)
  console.log(`虚拟学习者 Sessions: ${analysis.userTypeAnalysis.virtualLearners}`)
  console.log(`真实用户数据质量:`, analysis.userTypeAnalysis.realUserDataQuality)
  console.log(`虚拟学习者数据质量:`, analysis.userTypeAnalysis.virtualLearnerDataQuality)
  console.log(`虚拟学习者画像数量: ${analysis.userTypeAnalysis.virtualLearnerProfiles.length}`)
  console.log()
  
  console.log('【5. 数据质量问题】')
  console.log(`缺少 wrapup: ${analysis.dataQualityIssues.missingWrapup}`)
  console.log(`缺少 messages: ${analysis.dataQualityIssues.missingMessages}`)
  console.log(`LSS = 0: ${analysis.dataQualityIssues.zeroLss}`)
  console.log(`LSS = 10: ${analysis.dataQualityIssues.maxLss}`)
  console.log(`对话轮次 < 3: ${analysis.dataQualityIssues.lowMessageCount}`)
  console.log()
  
  console.log('【6. 典型场景】')
  console.log(`共识别 ${analysis.typicalScenarios.length} 个典型场景:`)
  analysis.typicalScenarios.forEach(s => {
    console.log(`  - [${s.type}] Session ${s.sessionId.substring(0, 8)}... (${s.reason})`)
  })
  console.log()
  
  // 保存完整报告
  const outputDir = path.join(__dirname, '..', 'analysis_output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  
  const reportPath = path.join(outputDir, 'teaching_sessions_analysis.json')
  fs.writeFileSync(reportPath, JSON.stringify(analysis, null, 2))
  console.log(`✓ 完整分析报告已保存到: ${reportPath}`)
  
  // 导出典型场景的完整数据
  if (analysis.typicalScenarios.length > 0) {
    const typicalSessionIds = analysis.typicalScenarios.map(s => s.sessionId)
    const typicalSessionsData = await prisma.teaching_sessions.findMany({
      where: { id: { in: typicalSessionIds } }
    })
    
    const scenariosPath = path.join(outputDir, 'typical_scenarios.json')
    fs.writeFileSync(scenariosPath, JSON.stringify(typicalSessionsData, null, 2))
    console.log(`✓ 典型场景数据已导出到: ${scenariosPath}`)
  }
  
  console.log()
  console.log('='.repeat(80))
  console.log('分析完成!')
  console.log('='.repeat(80))
}

analyzeSessions()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
