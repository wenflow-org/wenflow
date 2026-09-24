/**
 * goal payload 的「已上传资料清单」注入（2026-09-24 缺口补齐）：
 * 有上传 → 清单（仅元信息）+ 纪律注记进入 payload；
 * 无上传/空数组 → 键完全不出现（冷启动与存量行为不变）。
 * 正文不进 goal 阶段——消费点在路径生成的附件打包（path.coordinator「附件是主线」）。
 */
import { buildGoalConversationUserPayload, type GoalUploadedMaterialSummary } from '../index'

const materials: GoalUploadedMaterialSummary[] = [
  {
    name: '《3-6岁儿童学习与发展指南》全文(1).docx',
    ext: '.docx',
    format: 'docx',
    charCount: 6250,
    headingCount: 12,
    headings: ['健康', '语言', '社会'],
  },
]

describe('goal payload 已上传资料清单注入', () => {
  it('有上传时 payload 出现清单与纪律注记，元信息逐字段可核对', () => {
    const payload = buildGoalConversationUserPayload({
      userInput: '我想按这份指南设计幼儿园课程',
      uploadedMaterials: materials,
    })
    const parsed = JSON.parse(payload)
    expect(parsed.uploadedMaterials).toHaveLength(1)
    expect(parsed.uploadedMaterials[0]).toMatchObject({
      name: '《3-6岁儿童学习与发展指南》全文(1).docx',
      ext: '.docx',
      format: 'docx',
      charCount: 6250,
      headingCount: 12,
      headings: ['健康', '语言', '社会'],
    })
    // 纪律注记三要素：收到事实 / 不假装读过 / 不重复声明 needsMaterial
    expect(parsed.uploadedMaterialsNote).toContain('已收到')
    expect(parsed.uploadedMaterialsNote).toContain('禁止假装读过')
    expect(parsed.uploadedMaterialsNote).toContain('needsMaterial')
  })

  it('无上传或空数组时键完全不出现（存量行为不变）', () => {
    const without = JSON.parse(buildGoalConversationUserPayload({ userInput: 'x' }))
    expect(without.uploadedMaterials).toBeUndefined()
    expect(without.uploadedMaterialsNote).toBeUndefined()

    const emptyArray = JSON.parse(
      buildGoalConversationUserPayload({ userInput: 'x', uploadedMaterials: [] })
    )
    expect(emptyArray.uploadedMaterials).toBeUndefined()
    expect(emptyArray.uploadedMaterialsNote).toBeUndefined()
  })

  it('键序：清单在 task 之后、state 之前（会话内稳定块靠前，KV 前缀缓存友好）', () => {
    const keys = Object.keys(
      JSON.parse(buildGoalConversationUserPayload({ userInput: 'x', uploadedMaterials: materials }))
    )
    expect(keys.indexOf('uploadedMaterials')).toBeGreaterThan(keys.indexOf('task'))
    expect(keys.indexOf('uploadedMaterials')).toBeLessThan(keys.indexOf('state'))
  })
})
