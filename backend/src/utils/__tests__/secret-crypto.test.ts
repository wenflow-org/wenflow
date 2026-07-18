import {
  decryptSecret,
  decryptSecretTree,
  encryptSecret,
  encryptSecretTree,
  isEncryptedSecret,
  SecretCryptoError,
  validateSecretEncryptionConfig
} from '../secret-crypto'

const KEY_1 = Buffer.alloc(32, 1).toString('base64')
const KEY_2 = Buffer.alloc(32, 2).toString('base64')

describe('secret crypto', () => {
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'v1'
    process.env.SECRET_ENCRYPTION_KEYS = `v1:${KEY_1},v2:${KEY_2}`
  })

  afterEach(() => {
    delete process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
    delete process.env.SECRET_ENCRYPTION_KEYS
  })

  it('使用随机 IV 加密并通过 AAD 解密', () => {
    const first = encryptSecret('sk-example', 'table.column')!
    const second = encryptSecret('sk-example', 'table.column')!

    expect(first).not.toBe(second)
    expect(isEncryptedSecret(first)).toBe(true)
    expect(decryptSecret(first, 'table.column')).toBe('sk-example')
    expect(() => decryptSecret(first, 'other.column')).toThrow(SecretCryptoError)
  })

  it('支持旧明文双读、避免双重加密并拒绝篡改', () => {
    expect(decryptSecret('legacy-plain', 'table.column')).toBe('legacy-plain')
    const encrypted = encryptSecret('secret', 'table.column')!
    expect(encryptSecret(encrypted, 'table.column')).toBe(encrypted)
    const parts = encrypted.split(':')
    const tag = parts[5]
    const index = Math.floor(tag.length / 2)
    parts[5] = `${tag.slice(0, index)}${tag[index] === 'A' ? 'B' : 'A'}${tag.slice(index + 1)}`
    const tampered = parts.join(':')
    expect(() => decryptSecret(tampered, 'table.column')).toThrow(SecretCryptoError)
  })

  it('保留旧密钥用于解密并用当前密钥写入', () => {
    const oldEnvelope = encryptSecret('rotated', 'table.column')!
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'v2'
    const newEnvelope = encryptSecret('current', 'table.column')!

    expect(oldEnvelope).toContain('wfsec:v1:v1:')
    expect(newEnvelope).toContain('wfsec:v1:v2:')
    expect(decryptSecret(oldEnvelope, 'table.column')).toBe('rotated')
  })

  it('递归处理 JSON Secret 字段但保留普通配置', () => {
    const source = {
      endpoint: 'https://example.com',
      headers: { Authorization: 'Bearer secret', Accept: 'application/json' },
      env: { OPENAI_API_KEY: 'key-value', REGION: 'cn' },
      auth: { clientSecret: 'client-value' }
    }
    const encrypted = encryptSecretTree(source, 'main.user_mcp_configs.servers')

    expect(isEncryptedSecret(encrypted.headers.Authorization)).toBe(true)
    expect(isEncryptedSecret(encrypted.env.OPENAI_API_KEY)).toBe(true)
    expect(encrypted.env.REGION).toBe('cn')
    expect(decryptSecretTree(encrypted, 'main.user_mcp_configs.servers')).toEqual(source)
  })

  it('生产环境缺少密钥时拒绝启动', () => {
    delete process.env.SECRET_ENCRYPTION_KEYS
    expect(() => validateSecretEncryptionConfig(true)).toThrow(SecretCryptoError)
  })
})
