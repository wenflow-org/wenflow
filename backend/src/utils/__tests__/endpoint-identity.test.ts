import {
  endpointsMatch,
  normalizeEndpointIdentity,
  resolveEndpointBoundSecret
} from '../endpoint-identity'

describe('endpoint identity', () => {
  it('忽略尾部斜杠但保留路径和查询参数身份', () => {
    expect(endpointsMatch('https://provider.example/v1/', 'https://provider.example/v1')).toBe(true)
    expect(endpointsMatch('https://provider.example/v1?a=1', 'https://provider.example/v1?a=2')).toBe(false)
    expect(normalizeEndpointIdentity(' https://provider.example/v1/ ')).toBe('https://provider.example/v1')
  })

  it('仅在 Endpoint 未变化时复用已保存密钥', () => {
    expect(resolveEndpointBoundSecret(
      'https://provider.example/v1/',
      '',
      'https://provider.example/v1',
      'saved-key'
    )).toBe('saved-key')
    expect(resolveEndpointBoundSecret(
      'https://attacker.example/v1',
      '',
      'https://provider.example/v1',
      'saved-key'
    )).toBe('')
    expect(resolveEndpointBoundSecret(
      'https://attacker.example/v1',
      'fresh-key',
      'https://provider.example/v1',
      'saved-key'
    )).toBe('fresh-key')
  })
})
