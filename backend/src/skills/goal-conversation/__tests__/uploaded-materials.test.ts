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
    brief: {
      docType: '课程标准',
      subject: '3-6 岁儿童学习与发展指南',
      audience: '幼儿园教师与家长',
      overview: '按五大领域、每领域三个年龄段描述典型发展表现，并附教育建议。',
      naturalDivisions: ['按五大领域', '按年龄段'],
      toc: [
        { title: '一、健康', gist: '身体状况与动作发展目标及教育建议' },
        { title: '二、语言', gist: '倾听表达与阅读书写准备' },
      ],
    },
  },
]

describe('goal payload 已上传资料清单注入', () => {
  it('有 brief 时 payload 出现理解摘要（overview/naturalDivisions/toc 截 12 条）与纪律注记', () => {
    const payload = buildGoalConversationUserPayload({
      userInput: '我想按这份指南设计幼儿园课程',
      uploadedMaterials: materials,
    })
    const parsed = JSON.parse(payload)
    expect(parsed.uploadedMaterials).toHaveLength(1)
    const entry = parsed.uploadedMaterials[0]
    expect(entry).toMatchObject({
      name: '《3-6岁儿童学习与发展指南》全文(1).docx',
      ext: '.docx',
      format: 'docx',
      charCount: 6250,
      docType: '课程标准',
      subject: '3-6 岁儿童学习与发展指南',
      overview: '按五大领域、每领域三个年龄段描述典型发展表现，并附教育建议。',
      naturalDivisions: ['按五大领域', '按年龄段'],
    })
    expect(entry.toc).toHaveLength(2)
    expect(entry.headings).toBeUndefined()
    // 纪律注记三要素：收到事实 / 澄清范围与切分 / 不假装读过正文细节 / 不重复声明 needsMaterial
    expect(parsed.uploadedMaterialsNote).toContain('已收到')
    expect(parsed.uploadedMaterialsNote).toContain('重点学某些章节')
    expect(parsed.uploadedMaterialsNote).toContain('禁止假装读过')
    expect(parsed.uploadedMaterialsNote).toContain('needsMaterial')
  })

  it('brief 未就绪时降级为 headings 元信息（不出现 brief 字段键）', () => {
    const fallback: GoalUploadedMaterialSummary[] = [
      { ...materials[0], brief: null },
    ]
    const parsed = JSON.parse(
      buildGoalConversationUserPayload({ userInput: 'x', uploadedMaterials: fallback })
    )
    expect(parsed.uploadedMaterials[0].headings).toEqual(['健康', '语言', '社会'])
    expect(parsed.uploadedMaterials[0].overview).toBeUndefined()
    expect(parsed.uploadedMaterials[0].toc).toBeUndefined()
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
