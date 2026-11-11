import { describe, expect, it } from 'vitest'
import { testFailureReason } from '../modelTestHints'

describe('testFailureReason（行内测试失败的短判词）', () => {
  it('优先透出 HTTP 状态码', () => {
    expect(testFailureReason('HTTP 401: Unauthorized')).toBe('401')
    expect(testFailureReason('Request failed with status code 429')).toBe('429')
  })

  it('识别常见上游报文', () => {
    expect(testFailureReason('Model does not exist. Please check it carefully.')).toBe('无此模型')
    expect(testFailureReason('Insufficient quota')).toBe('额度不足')
    expect(testFailureReason('Invalid API key provided')).toBe('Key 无效')
    expect(testFailureReason('请求超时（30s）')).toBe('超时')
    expect(testFailureReason('Failed to fetch')).toBe('连不上')
  })

  it('认不出的报文不硬猜：返回空串，行内只留「连接失败」', () => {
    expect(testFailureReason('上游返回了无法归类的内容')).toBe('')
    expect(testFailureReason('')).toBe('')
  })
})
