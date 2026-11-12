/**
 * learner-progress-report 的「声明 ↔ 载荷」对齐（2026-11-11 字段审计）。
 *
 * 此前 yaml 声明 sessionEvidence / learnerSnapshotDynamic，而 handler 实际下发
 * { task, metrics, signals }，模型在 payload 里找不到声明名。本用例把
 * 「每个声明名都必须是真实载荷键」钉住，防再次漂移（同 adaptive-guidance-declaration）。
 */
const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { auxSkillHandlers } from '../v4-aux-skills'

const INPUT = {
  task: { title: '盘点差异归因', timeSpent: 25, difficulty: 4 },
  metrics: { completionRate: 60, ktl: 6, lf: 4, lss: 5 },
  signals: '遇到困难: 强度 40%；学习减速: 强度 20%',
}

describe('learner-progress-report 声明与载荷对齐', () => {
  it('yaml 声明的每个 inputs.name 都是真实载荷键', async () => {
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: { reasoning: 'r', suggestion: 's' },
      debug: {},
    })

    await auxSkillHandlers['learner-progress-report'](INPUT)

    const [spec] = mockCallPrompt.mock.calls[0] as [{ buildUserPayload: () => unknown }]
    const payload = spec.buildUserPayload() as Record<string, unknown>
    const keys = Object.keys(payload)

    const yamlPath = path.resolve(__dirname, '../../../../prompts/core/learner-progress-report.yaml')
    const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as {
      inputs: Array<{ name: string; ref?: string }>
    }

    expect(doc.inputs.length).toBeGreaterThan(0)
    for (const input of doc.inputs) {
      // 声明名必须能在载荷里找到（否则模型按声明名取不到值）
      expect(keys).toContain(input.name)
      // ref 必填是 schema 约束：声明名 = 载荷键，ref 只标注数据来源
      expect(typeof input.ref).toBe('string')
    }

    // 旧声明名不得回流
    expect(doc.inputs.map((i) => i.name)).not.toContain('sessionEvidence')
    expect(doc.inputs.map((i) => i.name)).not.toContain('learnerSnapshotDynamic')
    expect(keys.sort()).toEqual(['metrics', 'signals', 'task'])
  })
})
