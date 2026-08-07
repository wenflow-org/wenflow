/**
 * inputs 声明 ↔ 运行时装配一致性（首个闭环：goal-conversation 打样）
 *
 * goal-conversation.yaml 声明的三个 inputs：
 *   - user:latestMessage           → payload.userInput
 *   - sandbox:goal.collectedData.state    → payload.state
 *   - sandbox:goal.collectedData.history  → payload.conversationContext
 * 本测试验证声明的输入在 buildGoalConversationUserPayload 实际装配中均有对应。
 */

import { buildGoalConversationUserPayload } from '../index'
import { loadCoreFieldDeclarations } from '../../../services/skill-output-validator'

describe('goal-conversation inputs 声明与装配一致性', () => {
  it('声明的三个 inputs 均在实际 payload 中有对应注入', () => {
    const payload = buildGoalConversationUserPayload({
      userInput: '我向上汇报抓不住重点',
      conversationHistory: [
        { role: 'assistant', content: '先聊聊你的情况？' },
        { role: 'user', content: '每次汇报都被追问到卡壳' },
      ],
      previousUnderstanding: {
        surface_goal: '学会向上汇报',
        real_problem: '缺逻辑框架',
      },
      previousStage: 'understanding',
    })
    const parsed = JSON.parse(payload)

    // user:latestMessage → userInput
    expect(parsed.userInput).toBe('我向上汇报抓不住重点')

    // sandbox:goal.collectedData.state → state（previousUnderstanding 快照）
    expect(parsed.state.understanding.surface_goal).toBe('学会向上汇报')
    expect(parsed.state.stage).toBe('understanding')

    // sandbox:goal.collectedData.history → conversationContext
    expect(parsed.conversationContext).toHaveLength(2)
    expect(parsed.conversationContext[1]).toEqual({ role: 'user', text: '每次汇报都被追问到卡壳' })
  })

  it('core 文件声明的 ref 与装配键逐一对应', async () => {
    const fields = await loadCoreFieldDeclarations('goal-conversation')
    // inputs 声明在 core.fields 中不出现，直接从 core 文件读取声明
    const { loadCoreFile } = await import('../../../services/prompt-lab/core-file-loader')
    const core = loadCoreFile('goal-conversation')?.core
    expect(core?.inputs?.length).toBe(3)

    const refs = (core?.inputs || []).map((input) => input.ref).sort()
    expect(refs).toEqual([
      'sandbox:goal.collectedData.history',
      'sandbox:goal.collectedData.state',
      'user:latestMessage',
    ])
    expect(core?.inputs?.every((input) => input.name && input.type)).toBe(true)
  })

  it('声明的沙盘键在注册表中合法', async () => {
    const { validateSandboxPath } = await import('../../../services/agent-contract-view')
    expect(await validateSandboxPath('goal.collectedData.state')).toBeNull()
    expect(await validateSandboxPath('goal.collectedData.history')).toBeNull()
  })
})
