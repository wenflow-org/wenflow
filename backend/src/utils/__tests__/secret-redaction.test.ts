import {
  preserveConfiguredSecret,
  preserveNestedSecrets,
  preserveNestedSecretsById,
  redactLogValue,
  redactSecretText,
  toSecretSafeResponse
} from '../secret-redaction'

describe('secret redaction', () => {
  it('递归隐藏响应中的 Secret 并保留配置状态', () => {
    const response = toSecretSafeResponse({
      apiKey: 'sk-secret-value',
      nested: [{ token: 'token-value', name: 'provider' }]
    })

    expect(response).toEqual({
      apiKey: '',
      apiKeyConfigured: true,
      nested: [{ token: '', tokenConfigured: true, name: 'provider' }]
    })
  })

  it('空 Secret 输入保留数据库中的现有值', () => {
    expect(preserveConfiguredSecret(
      { model: 'new-model', apiKey: '' },
      { model: 'old-model', apiKey: 'saved-key' }
    )).toEqual({ model: 'new-model', apiKey: 'saved-key' })
  })

  it('按 ID 合并 MCP Secret，不在无 ID 项之间串用密钥', () => {
    expect(preserveNestedSecretsById(
      [{ id: 'a', apiKey: '' }, { name: 'no-id', apiKey: '' }],
      [{ id: 'a', apiKey: 'saved-a' }, { name: 'old-no-id', apiKey: 'saved-other' }]
    )).toEqual([
      { id: 'a', apiKey: 'saved-a' },
      { name: 'no-id', apiKey: '' }
    ])
  })

  it('按 ID 递归保留 MCP 嵌套 Secret', () => {
    expect(preserveNestedSecretsById(
      [{ id: 'a', headers: { Authorization: '', Accept: 'text/plain' }, auth: { clientSecret: '' } }],
      [{ id: 'a', headers: { Authorization: 'Bearer saved', Accept: 'application/json' }, auth: { clientSecret: 'saved' } }]
    )).toEqual([
      { id: 'a', headers: { Authorization: 'Bearer saved', Accept: 'text/plain' }, auth: { clientSecret: 'saved' } }
    ])
  })

  it('递归保留 healthCheck 中的空 Secret', () => {
    expect(preserveNestedSecrets(
      { headers: { Authorization: '', Accept: 'text/plain' } },
      { headers: { Authorization: 'Bearer saved', Accept: 'application/json' } }
    )).toEqual({ headers: { Authorization: 'Bearer saved', Accept: 'text/plain' } })
  })

  it('日志对象和文本均隐藏常见凭据', () => {
    expect(redactLogValue({
      authorization: 'Bearer abc.def',
      nested: { password: 'Password123', note: 'key sk-1234567890123456' }
    })).toEqual({
      authorization: '[REDACTED]',
      nested: { password: '[REDACTED]', note: 'key sk-[REDACTED]' }
    })
    expect(redactSecretText('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer [REDACTED]')
  })
})
