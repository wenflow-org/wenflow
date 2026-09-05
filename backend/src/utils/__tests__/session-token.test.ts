export {}

process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters'

import jwt from 'jsonwebtoken'
import {
  ADMIN_TOKEN_AUDIENCE,
  SESSION_TOKEN_ISSUER,
  USER_TOKEN_AUDIENCE,
  signSessionToken,
  verifySessionToken
} from '../session-token'

describe('session token domain isolation', () => {
  it('签发带有明确 type、issuer 和 audience 的用户与 Admin Token', () => {
    const userToken = signSessionToken({ userId: 'user-1', name: 'alice' }, 'user', '1h')
    const adminToken = signSessionToken({
      userId: 'admin-1',
      email: 'admin@example.com',
      isAdmin: true
    }, 'admin', '1h')

    expect(jwt.decode(userToken)).toEqual(expect.objectContaining({
      type: 'user',
      iss: SESSION_TOKEN_ISSUER,
      aud: USER_TOKEN_AUDIENCE
    }))
    expect(jwt.decode(adminToken)).toEqual(expect.objectContaining({
      type: 'admin',
      isAdmin: true,
      iss: SESSION_TOKEN_ISSUER,
      aud: ADMIN_TOKEN_AUDIENCE
    }))
  })

  it('拒绝用户与 Admin Token 跨域验证', () => {
    const userToken = signSessionToken({ userId: 'user-1' }, 'user', '1h')
    const adminToken = signSessionToken({ userId: 'admin-1', isAdmin: true }, 'admin', '1h')

    expect(() => verifySessionToken(userToken, 'admin')).toThrow()
    expect(() => verifySessionToken(adminToken, 'user')).toThrow()
  })

  it('兼容可明确识别域的旧 Token，但不允许旧 Token 跨域', () => {
    const secret = process.env.JWT_SECRET as string
    const legacyUserToken = jwt.sign({ userId: 'user-1', name: 'alice' }, secret, { algorithm: 'HS256' })
    const legacyAdminToken = jwt.sign({ userId: 'admin-1', isAdmin: true }, secret, { algorithm: 'HS256' })

    expect(verifySessionToken(legacyUserToken, 'user').userId).toBe('user-1')
    expect(verifySessionToken(legacyAdminToken, 'admin').userId).toBe('admin-1')
    expect(() => verifySessionToken(legacyUserToken, 'admin')).toThrow('会话域')
    expect(() => verifySessionToken(legacyAdminToken, 'user')).toThrow('会话域')
  })

  it('带有任一新格式域声明的 Token 不进入旧格式兼容路径', () => {
    const malformed = jwt.sign({
      userId: 'admin-1',
      isAdmin: true,
      type: 'admin'
    }, process.env.JWT_SECRET as string, { algorithm: 'HS256' })

    expect(() => verifySessionToken(malformed, 'admin')).toThrow()
  })

  it('签发 Token 携带 jti 会话声明，验证后原样返回', () => {
    const jti = 'session-uuid-1'
    const token = signSessionToken({
      userId: 'admin-1',
      isAdmin: true,
      jti
    }, 'admin', '1h')

    expect(jwt.decode(token)).toEqual(expect.objectContaining({ jti }))
    expect(verifySessionToken(token, 'admin').jti).toBe(jti)
  })

  it('jti 为可选声明：不传 jti 的 Token 验证后无 jti（兼容既有调用）', () => {
    const token = signSessionToken({ userId: 'admin-1', isAdmin: true }, 'admin', '1h')
    expect(verifySessionToken(token, 'admin').jti).toBeUndefined()
  })

  it('旧格式兼容路径保留：无 jti 的 legacy Admin Token 仍可验证', () => {
    const legacy = jwt.sign({ userId: 'admin-1', isAdmin: true }, process.env.JWT_SECRET as string, { algorithm: 'HS256' })
    expect(verifySessionToken(legacy, 'admin').userId).toBe('admin-1')
    expect(verifySessionToken(legacy, 'admin').jti).toBeUndefined()
  })

  it('jti 不是域声明：仅带 jti 的 legacy 格式 Token 仍走旧格式兼容路径放行', () => {
    const legacyWithJti = jwt.sign(
      { userId: 'admin-1', isAdmin: true, jti: 'session-uuid-2' },
      process.env.JWT_SECRET as string,
      { algorithm: 'HS256' }
    )

    expect(verifySessionToken(legacyWithJti, 'admin').jti).toBe('session-uuid-2')
  })
})
