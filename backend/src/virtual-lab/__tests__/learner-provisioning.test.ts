/**
 * P2-26（PD-2）：studentHints 键名错位被静默丢弃。
 *
 * 实证：learner-provisioning.ts:153 把批量实验的学生样本提示挂在 `recentScenarioHints` 键下，
 * 而 persona designer 只读 `recentPersonaHints`（index.ts buildUserPayload）——sampleType='student'
 * 指令静默丢弃，学生批量实验永不生效。本测试钉住「键名 = recentPersonaHints」这一契约。
 */
const mockProfileFindUnique = jest.fn()
const mockProfileUpdate = jest.fn()
const mockUserFindUnique = jest.fn()
const mockUserUpdate = jest.fn()
const mockExecuteSkill = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  prisma: {
    virtual_learner_profiles: {
      findUnique: mockProfileFindUnique,
      update: mockProfileUpdate,
    },
    users: {
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
    },
  },
}))

jest.mock('../../skills', () => ({
  __esModule: true,
  executeSkill: mockExecuteSkill,
}))

import { generateAndApplyPersona } from '../learner-provisioning'

describe('P2-26：generateAndApplyPersona 的 studentHints 键名', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProfileFindUnique.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      profile: JSON.stringify({ nameHint: '待生成' }),
      knowledgeLevel: 'beginner',
    })
    mockProfileUpdate.mockResolvedValue({})
    mockUserFindUnique.mockResolvedValue({ name: '旧名' })
    mockUserUpdate.mockResolvedValue({})
    mockExecuteSkill.mockResolvedValue({ personaSeed: { nameHint: '高三学生', age: 17 } })
  })

  it('studentHints 挂 recentPersonaHints（不再是 recentScenarioHints）', async () => {
    const hints = ['本次明确生成传统学生样本：学段与年级……']
    await generateAndApplyPersona('profile-1', { studentHints: hints })

    expect(mockExecuteSkill).toHaveBeenCalledTimes(1)
    const payload = mockExecuteSkill.mock.calls[0][1]
    expect(payload.recentPersonaHints).toEqual(hints)
    expect(payload).not.toHaveProperty('recentScenarioHints')
  })

  it('无 studentHints 时不注入该键（旧行为不变）', async () => {
    await generateAndApplyPersona('profile-1', {})

    const payload = mockExecuteSkill.mock.calls[0][1]
    expect(payload).not.toHaveProperty('recentPersonaHints')
    expect(payload).not.toHaveProperty('recentScenarioHints')
  })
})