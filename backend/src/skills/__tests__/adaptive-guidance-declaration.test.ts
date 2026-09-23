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
import { adaptiveGuidanceCopy } from '../adaptive-guidance-copy'

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
})
