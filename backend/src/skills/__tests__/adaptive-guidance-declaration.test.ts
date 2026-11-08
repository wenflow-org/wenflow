/**
 * adaptive-guidance-copy 的「声明 ↔ 载荷」对齐（审计 P1 §2.4d）。
 *
 * 此前 yaml 声明 learnerSnapshotDynamic/learningControlState/replanSignal/sessionWrapup，
 * 而载荷实际是 learner/learningState/advisory/wrapup，规则里引用的又是载荷键
 * ⇒ 两套名字对不上账。本用例把「每个声明名都必须是真实载荷键」钉住，防再次漂移。
 *
 * 实测依据（真实载荷，2026-09-23）：顶层键 = view, path, learner, learningState, wrapup, advisory。
 */
const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { adaptiveGuidanceCopy, adaptiveGuidanceCopyDefinition, GUIDANCE_VIEWS } from '../adaptive-guidance-copy'

const INPUT = {
  view: 'dashboard',
  learnerSnapshot: { profile: { narratives: {} }, dynamicState: { recentTrend: 'stable' } },
  learningState: { tasks: { total: 3, completed: 1, inProgress: 1, started: 2 } },
  path: { title: '汇报框架' },
  sessionWrapup: null,
  advisory: null,
}

const LLM_OUTPUT = {
  headline: 'h', subtitle: 's',
  todayActions: [{ title: 't', desc: 'd', action: 'a', to: 'continue-learning' }],
  pathHint: 'p', nextStep: 'n', paceHint: 'c',
  emptyStateCopy: 'e', warningCopy: null,
}

describe('adaptive-guidance-copy 声明与载荷对齐', () => {
  it('yaml 声明的每个 inputs.name 都是真实载荷键；调用方直供的 view/path 亦在载荷中', async () => {
    mockCallPrompt.mockResolvedValue({ success: true, output: LLM_OUTPUT, debug: {} })
    await adaptiveGuidanceCopy(INPUT as never)

    const [spec] = mockCallPrompt.mock.calls[0] as [{ buildUserPayload: (i: unknown, c: unknown) => string }]
    // buildUserPayload 返回 JSON 字符串（不是对象）
    const payload = JSON.parse(spec.buildUserPayload(INPUT, {})) as Record<string, unknown>
    const keys = Object.keys(payload)

    const yamlPath = path.resolve(__dirname, '../../../../prompts/core/adaptive-guidance-copy.yaml')
    const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as { inputs: Array<{ name: string; ref?: string }> }

    expect(doc.inputs.length).toBeGreaterThan(0)
    for (const input of doc.inputs) {
      // 声明名必须能在载荷里找到（否则声明是摆设，规则会指向不存在的键）
      expect(keys).toContain(input.name)
      // ref 必填是 schema 约束（无沙盘来源的调用方直供键因此不入声明）
      expect(typeof input.ref).toBe('string')
    }

    // 调用方直供、无沙盘 ref 的两个键：以 yaml 注释为凭，不入 inputs
    expect(keys).toEqual(expect.arrayContaining(['view', 'path']))
    expect(doc.inputs.map((i) => i.name)).not.toContain('view')
  })

  /**
   * #187：skill 的 view 是**真实分支**。此前 rules 只写 dashboard（"生成适合 Dashboard 页面展示的
   * 动态文案"），learning-state 页只能拿 dashboard 口径的 copy。声明与提示词必须同时覆盖两个视图，
   * 且 learning-state 视图禁止输出指回本页的自指深链——否则「4 个 view」又会退化成一句空话。
   */
  it('#187：提示词规则与产出口径覆盖两个视图，learning-state 禁自指深链', () => {
    const yamlPath = path.resolve(__dirname, '../../../../prompts/core/adaptive-guidance-copy.yaml')
    const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as {
      rules: string[]
      fields: Array<{ name: string; desc?: string }>
    }
    const rules = doc.rules.join('\n')

    expect(rules).toContain('view=dashboard')
    expect(rules).toContain('view=learning-state')
    // 自指深链禁令必须写在规则里（不只是代码兜底）
    expect(rules).toMatch(/严禁[\s\S]{0,80}learning-state/)
    // 旧的「统一到 dashboard」口径不得再出现在规则里
    expect(rules).not.toContain('复用 dashboard')

    const todayActionsDesc = doc.fields.find((field) => field.name === 'todayActions')?.desc || ''
    expect(todayActionsDesc).toContain('view=dashboard')
    expect(todayActionsDesc).toContain('view=learning-state')
  })

  it('#187：skill 入参 schema 声明的 view 枚举与 views.ts 同源', () => {
    expect(adaptiveGuidanceCopyDefinition.inputSchema.properties.view.enum).toEqual([...GUIDANCE_VIEWS])
  })
})
