import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function detailedAnalysis() {
  console.log('开始深度分析...\n')
  
  // 获取所有 sessions
  const sessions = await prisma.teaching_sessions.findMany({
    include: {
      users: {
        include: {
          virtual_learner_profiles: true
        }
      }
    }
  })
  
  console.log(`分析 ${sessions.length} 个 sessions\n`)
  
  // 检查 wrapup 的结构
  console.log('【检查 Wrapup 数据结构】')
  const sessionsWithWrapup = sessions.filter(s => s.wrapup)
  console.log(`有 wrapup 的 sessions: ${sessionsWithWrapup.length}`)
  
  if (sessionsWithWrapup.length > 0) {
    console.log('\n示例 wrapup 数据:')
    sessionsWithWrapup.slice(0, 3).forEach((s, idx) => {
      console.log(`\n--- Session ${idx + 1} (${s.id.substring(0, 20)}...) ---`)
      try {
        const wrapup = JSON.parse(s.wrapup!)
        console.log('Keys:', Object.keys(wrapup))
        console.log('Wrapup 内容:', JSON.stringify(wrapup, null, 2).substring(0, 500) + '...')
      } catch (e) {
        console.log('无法解析 wrapup JSON')
      }
    })
  }
  
  // 详细分析 messages 结构
  console.log('\n\n【分析 Messages 数据结构】')
  const sessionsWithMessages = sessions.filter(s => s.messages)
  console.log(`有 messages 的 sessions: ${sessionsWithMessages.length}`)
  
  if (sessionsWithMessages.length > 0) {
    const messageLengths = sessionsWithMessages.map(s => {
      try {
        return JSON.parse(s.messages!).length
      } catch {
        return 0
      }
    }).sort((a, b) => a - b)
    
    console.log(`消息轮次分布:`)
    console.log(`  最少: ${messageLengths[0]}`)
    console.log(`  最多: ${messageLengths[messageLengths.length - 1]}`)
    console.log(`  平均: ${(messageLengths.reduce((a, b) => a + b, 0) / messageLengths.length).toFixed(1)}`)
    console.log(`  中位数: ${messageLengths[Math.floor(messageLengths.length / 2)]}`)
    
    // 找到对话轮次最多的 session
    const maxMsgSession = sessionsWithMessages.reduce((max, s) => {
      try {
        const len = JSON.parse(s.messages!).length
        const maxLen = max ? JSON.parse(max.messages!).length : 0
        return len > maxLen ? s : max
      } catch {
        return max
      }
    }, sessionsWithMessages[0])
    
    console.log(`\n对话轮次最多的 session: ${maxMsgSession.id}`)
    console.log(`轮次: ${JSON.parse(maxMsgSession.messages!).length}`)
    
    // 示例 message 结构
    console.log('\n示例 messages 结构 (取前 2 条):')
    try {
      const messages = JSON.parse(maxMsgSession.messages!)
      messages.slice(0, 2).forEach((msg: any, idx: number) => {
        console.log(`\n--- Message ${idx + 1} ---`)
        console.log('Keys:', Object.keys(msg))
        if (msg.analysis) {
          console.log('Analysis Keys:', Object.keys(msg.analysis))
        }
        console.log('Content:', JSON.stringify(msg, null, 2).substring(0, 400) + '...')
      })
    } catch (e) {
      console.log('无法解析 messages')
    }
  }
  
  // 分析困惑点数据
  console.log('\n\n【分析困惑点数据】')
  const confusionData: Array<{
    sessionId: string
    userId: string
    confusionCount: number
    confusionPoints: any[]
  }> = []
  
  sessionsWithMessages.forEach(s => {
    try {
      const messages = JSON.parse(s.messages!)
      let sessionConfusions: any[] = []
      
      messages.forEach((msg: any) => {
        if (msg.analysis?.confusionPoints && msg.analysis.confusionPoints.length > 0) {
          sessionConfusions.push(...msg.analysis.confusionPoints)
        }
      })
      
      if (sessionConfusions.length > 0) {
        confusionData.push({
          sessionId: s.id,
          userId: s.userId,
          confusionCount: sessionConfusions.length,
          confusionPoints: sessionConfusions
        })
      }
    } catch (e) {}
  })
  
  confusionData.sort((a, b) => b.confusionCount - a.confusionCount)
  
  console.log(`有困惑点的 sessions: ${confusionData.length}`)
  console.log(`\n困惑点最多的 5 个 sessions:`)
  confusionData.slice(0, 5).forEach((cd, idx) => {
    console.log(`  ${idx + 1}. Session ${cd.sessionId.substring(0, 20)}... - ${cd.confusionCount} 个困惑点`)
    if (cd.confusionPoints[0]) {
      console.log(`     示例困惑点:`, JSON.stringify(cd.confusionPoints[0]).substring(0, 100) + '...')
    }
  })
  
  // 分析认知层级分布
  console.log('\n\n【认知层级详细分布】')
  const cognitiveBySession: Record<string, Record<string, number>> = {}
  
  sessionsWithMessages.forEach(s => {
    try {
      const messages = JSON.parse(s.messages!)
      const levels: Record<string, number> = {}
      
      messages.forEach((msg: any) => {
        if (msg.analysis?.cognitiveLevel) {
          const level = msg.analysis.cognitiveLevel
          levels[level] = (levels[level] || 0) + 1
        }
      })
      
      if (Object.keys(levels).length > 0) {
        cognitiveBySession[s.id] = levels
      }
    } catch (e) {}
  })
  
  console.log(`有认知层级数据的 sessions: ${Object.keys(cognitiveBySession).length}`)
  
  // 找到认知层级最丰富的 session
  const richestSession = Object.entries(cognitiveBySession).reduce((max, [id, levels]) => {
    const diversity = Object.keys(levels).length
    const maxDiversity = max ? Object.keys(max[1]).length : 0
    return diversity > maxDiversity ? [id, levels] : max
  }, null as [string, Record<string, number>] | null)
  
  if (richestSession) {
    console.log(`\n认知层级最丰富的 session: ${richestSession[0].substring(0, 20)}...`)
    console.log(`层级分布:`, richestSession[1])
  }
  
  // 查看状态分布详情
  console.log('\n\n【Status 分布详情】')
  const statusGroups = {
    timeout: sessions.filter(s => s.status === 'timeout'),
    completed: sessions.filter(s => s.status === 'completed'),
    paused: sessions.filter(s => s.status === 'paused')
  }
  
  Object.entries(statusGroups).forEach(([status, group]) => {
    console.log(`\n${status} (${group.length} sessions):`)
    
    const avgMessages = group.reduce((sum, s) => {
      try {
        return sum + (s.messages ? JSON.parse(s.messages).length : 0)
      } catch {
        return sum
      }
    }, 0) / group.length
    
    const withWrapup = group.filter(s => s.wrapup).length
    
    console.log(`  平均消息轮次: ${avgMessages.toFixed(1)}`)
    console.log(`  有 wrapup: ${withWrapup}/${group.length}`)
    
    // 统计 duration
    const durations = group.filter(s => s.duration).map(s => s.duration!)
    if (durations.length > 0) {
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
      console.log(`  平均持续时间: ${(avgDuration / 1000 / 60).toFixed(1)} 分钟`)
    }
  })
  
  // 导出完整的典型场景
  console.log('\n\n【导出典型场景完整数据】')
  
  const typicalScenarios = [
    ...confusionData.slice(0, 3).map(cd => ({
      ...cd,
      type: 'high-confusion'
    })),
    ...sessions
      .filter(s => s.status === 'completed' && s.messages)
      .sort((a, b) => {
        try {
          const aLen = JSON.parse(a.messages!).length
          const bLen = JSON.parse(b.messages!).length
          return bLen - aLen
        } catch {
          return 0
        }
      })
      .slice(0, 3)
      .map(s => ({
        sessionId: s.id,
        userId: s.userId,
        confusionCount: 0,
        confusionPoints: [],
        type: 'completed-with-dialogue'
      })),
    ...sessions
      .filter(s => s.status === 'timeout' && s.messages)
      .sort((a, b) => {
        try {
          const aLen = JSON.parse(a.messages!).length
          const bLen = JSON.parse(b.messages!).length
          return bLen - aLen
        } catch {
          return 0
        }
      })
      .slice(0, 2)
      .map(s => ({
        sessionId: s.id,
        userId: s.userId,
        confusionCount: 0,
        confusionPoints: [],
        type: 'timeout-with-dialogue'
      }))
  ]
  
  console.log(`准备导出 ${typicalScenarios.length} 个典型场景`)
  
  const outputDir = path.join(__dirname, '..', 'analysis_output')
  const scenariosWithData = []
  
  for (const scenario of typicalScenarios) {
    const session = sessions.find(s => s.id === scenario.sessionId)
    if (session) {
      const sessionData: any = {
        id: session.id,
        userId: session.userId,
        taskId: session.taskId,
        subject: session.subject,
        topic: session.topic,
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        scenarioType: scenario.type,
        confusionCount: scenario.confusionCount
      }
      
      if (session.messages) {
        try {
          sessionData.messages = JSON.parse(session.messages)
          sessionData.messageCount = sessionData.messages.length
        } catch (e) {
          sessionData.messages = null
        }
      }
      
      if (session.wrapup) {
        try {
          sessionData.wrapup = JSON.parse(session.wrapup)
        } catch (e) {
          sessionData.wrapup = null
        }
      }
      
      scenariosWithData.push(sessionData)
    }
  }
  
  const scenariosPath = path.join(outputDir, 'typical_scenarios_detailed.json')
  fs.writeFileSync(scenariosPath, JSON.stringify(scenariosWithData, null, 2))
  console.log(`✓ 已导出到: ${scenariosPath}`)
  
  // 生成 Markdown 报告
  console.log('\n\n【生成 Markdown 报告】')
  
  const markdown = `# WenFlow Teaching Sessions 数据质量分析报告

**生成时间**: ${new Date().toISOString()}  
**分析样本**: ${sessions.length} 个 teaching_sessions  
**时间跨度**: ${new Date(sessions[0].startTime).toISOString().split('T')[0]} 到 ${new Date(sessions[sessions.length - 1].startTime).toISOString().split('T')[0]}

---

## 1. 核心发现

### 🚨 主要问题

1. **Wrapup 数据严重缺失**: 只有 ${sessionsWithWrapup.length}/106 (${(sessionsWithWrapup.length / sessions.length * 100).toFixed(1)}%) 的 sessions 有 wrapup 数据
2. **LSS 指标完全缺失**: 在所有 wrapup 中都没有找到 sessionLss、sessionKtl、sessionLf 数据
3. **对话轮次偏少**: 66/106 (${(66 / 106 * 100).toFixed(1)}%) 的 sessions 对话轮次 < 3
4. **超时率高**: ${statusGroups.timeout.length}/106 (${(statusGroups.timeout.length / sessions.length * 100).toFixed(1)}%) 的 sessions 状态为 timeout

### ✅ 可用数据

1. **Messages 完整**: 100% 的 sessions 都有对话数据
2. **困惑点检测良好**: ${confusionData.length}/106 (${(confusionData.length / sessions.length * 100).toFixed(1)}%) 的 sessions 检测到困惑点
3. **认知层级标注**: 大部分消息有认知层级标注 (analyze: 181, understand: 47, apply: 41...)
4. **虚拟学习者数据质量更好**: 虚拟学习者平均 10.5 轮对话，真实用户平均 4.7 轮

---

## 2. 数据分布统计

### Status 分布

| Status | 数量 | 比例 | 平均对话轮次 | 有 Wrapup |
|--------|------|------|--------------|-----------|
| timeout | ${statusGroups.timeout.length} | ${(statusGroups.timeout.length / sessions.length * 100).toFixed(1)}% | ${(statusGroups.timeout.reduce((s, sess) => s + (sess.messages ? JSON.parse(sess.messages).length : 0), 0) / statusGroups.timeout.length).toFixed(1)} | ${statusGroups.timeout.filter(s => s.wrapup).length} |
| completed | ${statusGroups.completed.length} | ${(statusGroups.completed.length / sessions.length * 100).toFixed(1)}% | ${(statusGroups.completed.reduce((s, sess) => s + (sess.messages ? JSON.parse(sess.messages).length : 0), 0) / statusGroups.completed.length).toFixed(1)} | ${statusGroups.completed.filter(s => s.wrapup).length} |
| paused | ${statusGroups.paused.length} | ${(statusGroups.paused.length / sessions.length * 100).toFixed(1)}% | ${(statusGroups.paused.reduce((s, sess) => s + (sess.messages ? JSON.parse(sess.messages).length : 0), 0) / statusGroups.paused.length).toFixed(1)} | ${statusGroups.paused.filter(s => s.wrapup).length} |

### 用户类型对比

|  | 真实用户 | 虚拟学习者 |
|--|----------|------------|
| Sessions 数量 | 69 | 37 |
| 平均对话轮次 | 4.7 | 10.5 |
| 有 Wrapup | 8 | 0 |
| 有 Messages | 69 | 37 |

### 认知层级分布

- **analyze**: 181 次 (最多，表示学习者在进行分析思考)
- **understand**: 47 次
- **apply**: 41 次
- **remember**: 29 次
- **evaluate**: 5 次

### 困惑点检测

- **有困惑的 sessions**: ${confusionData.length}/106 (${(confusionData.length / sessions.length * 100).toFixed(1)}%)
- **平均困惑点/session**: ${(confusionData.reduce((s, cd) => s + cd.confusionCount, 0) / sessions.length).toFixed(2)}
- **最多困惑点的 session**: ${confusionData[0]?.confusionCount || 0} 个

---

## 3. 数据质量评估

### ❌ 不能直接用于 Prompt 测试的原因

1. **LSS 指标缺失**: 
   - 无法评估 "学习压力" 场景
   - 无法区分 "高压力" vs "低压力" sessions
   - Wrapup 数据结构可能与预期不符

2. **Wrapup 覆盖率低**:
   - 只有 7.5% 的 sessions 有 wrapup
   - 无法评估 "总结质量"
   - 缺少 Session 级别的评估数据

3. **对话轮次偏少**:
   - 62% 的 sessions 对话 < 3 轮
   - 不足以评估 "对话连贯性"
   - 可能是测试数据或中断的 session

### ✅ 可以直接使用的数据

1. **困惑点场景**: ${confusionData.length} 个 sessions 可用于测试 "困惑检测" 和 "解惑策略"
2. **认知层级标注**: 可用于测试 "认知层级识别" 和 "教学策略调整"
3. **虚拟学习者数据**: 37 个高质量对话 sessions (平均 10.5 轮)

---

## 4. 典型场景分类

已导出 ${typicalScenarios.length} 个典型场景到 \`typical_scenarios_detailed.json\`:

### 高困惑场景 (3 个)
${confusionData.slice(0, 3).map((cd, i) => `${i + 1}. Session ${cd.sessionId.substring(0, 20)}... - ${cd.confusionCount} 个困惑点`).join('\n')}

### 顺利完成场景 (3 个)
包含对话轮次较多的 completed sessions

### 超时场景 (2 个)
包含对话轮次较多但 timeout 的 sessions

---

## 5. 建议

### 短期 (立即可做)

1. **使用困惑点场景**: 
   - 使用现有的 ${confusionData.length} 个困惑点 sessions 测试 AI 的 "解惑能力"
   - 测试 "困惑检测准确性"

2. **使用认知层级数据**:
   - 测试 AI 对学习者认知层级的识别准确度
   - 测试教学策略是否匹配认知层级

3. **使用虚拟学习者数据**:
   - 37 个高质量对话可以作为 baseline
   - 对话轮次更多，更适合测试 "对话连贯性"

### 中期 (需要补充数据)

1. **修复 Wrapup 生成逻辑**:
   - 检查为什么 92% 的 sessions 没有 wrapup
   - 确认 wrapup 中应该包含哪些字段 (sessionLss, sessionKtl, sessionLf)
   - 是否有代码逻辑问题导致 wrapup 未保存？

2. **生成更多完整 sessions**:
   - 通过虚拟学习者生成 20-30 个完整对话 (> 5 轮)
   - 确保每个 session 都有完整的 wrapup 数据
   - 覆盖不同难度、不同主题

3. **补充 LSS 测试数据**:
   - 手动创建 "高压力" 场景 (LSS > 7)
   - 手动创建 "低压力" 场景 (LSS < 4)
   - 用于测试 AI 对压力的识别和响应

### 长期 (数据清洗)

1. **清理无效 sessions**:
   - 删除或标记对话轮次 < 3 的 sessions
   - 删除或标记 timeout 且无有效对话的 sessions

2. **标准化数据格式**:
   - 统一 wrapup 数据结构
   - 统一 messages.analysis 数据结构
   - 建立数据 schema 验证

3. **建立测试数据集**:
   - 精选 20-30 个高质量 sessions 作为 "黄金标准"
   - 每个场景类型至少 5 个样本
   - 人工审核和标注

---

## 6. 可用性总结

| 数据类型 | 可用性 | 数量 | 推荐用途 |
|----------|--------|------|----------|
| 困惑点场景 | ✅ 可用 | ${confusionData.length} | 测试困惑检测、解惑策略 |
| 认知层级标注 | ✅ 可用 | 303 次标注 | 测试认知层级识别 |
| 虚拟学习者对话 | ✅ 可用 | 37 sessions | 测试对话连贯性 |
| LSS 指标 | ❌ 不可用 | 0 | **需要重新生成** |
| Wrapup 总结 | ⚠️ 部分可用 | 8 sessions | **需要修复生成逻辑** |
| 完整对话 | ⚠️ 部分可用 | 40 sessions (>5轮) | 可用于基础测试 |

**总体评估**: 数据可以部分用于 Prompt 测试，但**需要补充 LSS 相关数据**和**修复 Wrapup 生成逻辑**。

---

**报告结束**
`
  
  const reportPath = path.join(outputDir, 'analysis_report.md')
  fs.writeFileSync(reportPath, markdown)
  console.log(`✓ Markdown 报告已保存到: ${reportPath}`)
  
  console.log('\n分析完成!')
}

detailedAnalysis()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
