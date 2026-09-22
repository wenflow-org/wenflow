// user-session.service 单测（安全审计 M2）：登记 / 原地轮换 / 重用检测 / 吊销 / 清理
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    user_sessions: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn()
    }
  }
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import crypto from 'crypto';
import prisma from '../../../config/database';
import {
  registerUserSession,
  rotateUserSession,
  revokeUserSessionByToken,
  revokeAllUserSessions,
  pruneUserSessions,
} from '../user-session.service';

const sessions = prisma.user_sessions as unknown as Record<string, jest.Mock>;

const hash = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

describe('user-session.service（M2 refresh token 会话化）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessions.create.mockResolvedValue({});
    sessions.findUnique.mockResolvedValue(null);
    sessions.findFirst.mockResolvedValue(null);
    sessions.updateMany.mockResolvedValue({ count: 1 });
    sessions.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('registerUserSession', () => {
    it('登记会话：只存 sha256 摘要 + tokenVersion + 30 天过期', async () => {
      await registerUserSession('user-1', 'rt-token', 3);

      expect(sessions.create).toHaveBeenCalledTimes(1);
      const args = sessions.create.mock.calls[0][0];
      expect(args.data.userId).toBe('user-1');
      expect(args.data.tokenHash).toBe(hash('rt-token'));
      expect(args.data.tokenVersion).toBe(3);
      expect(args.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('登记失败只吞错告警，不阻断登录', async () => {
      sessions.create.mockRejectedValue(new Error('db down'));
      await expect(registerUserSession('user-1', 'rt-token', 0)).resolves.toBeUndefined();
    });
  });

  describe('rotateUserSession', () => {
    it('命中当前代且归属一致 → rotated（乐观锁 where 带旧哈希，data 换新并留痕 previousTokenHash）', async () => {
      sessions.findUnique.mockResolvedValue({
        id: 's-1', userId: 'user-1', tokenHash: hash('old'), revokedAt: null
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-1', tokenVersion: 2 });

      expect(result).toBe('rotated');
      expect(sessions.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1', tokenHash: hash('old') },
        data: expect.objectContaining({
          tokenHash: hash('new'),
          previousTokenHash: hash('old'),
          tokenVersion: 2
        })
      });
    });

    it('当前代已被吊销 → reuse-detected（拒绝且不再换新）', async () => {
      sessions.findUnique.mockResolvedValue({
        id: 's-1', userId: 'user-1', tokenHash: hash('old'), revokedAt: new Date()
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('reuse-detected');
      expect(sessions.updateMany).not.toHaveBeenCalled();
    });

    it('会话归属与令牌用户不一致 → 吊销并 reuse-detected', async () => {
      sessions.findUnique.mockResolvedValue({
        id: 's-1', userId: 'user-1', tokenHash: hash('old'), revokedAt: null
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-9', tokenVersion: 0 });

      expect(result).toBe('reuse-detected');
      expect(sessions.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1' },
        data: { revokedAt: expect.any(Date) }
      });
    });

    it('命中上一代（旧令牌轮换后被重放）→ 吊销该会话并 reuse-detected', async () => {
      sessions.findFirst.mockResolvedValue({
        id: 's-1', userId: 'user-1', previousTokenHash: hash('old'), revokedAt: null
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('reuse-detected');
      expect(sessions.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
    });

    it('查无登记（部署前签发/伪造）→ unknown-token', async () => {
      const result = await rotateUserSession('ghost', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('unknown-token');
      expect(sessions.updateMany).not.toHaveBeenCalled();
    });

    it('乐观锁竞争落败（updateMany count=0）→ unknown-token 而非误判重用', async () => {
      sessions.findUnique.mockResolvedValue({
        id: 's-1', userId: 'user-1', tokenHash: hash('old'), revokedAt: null
      });
      sessions.updateMany.mockResolvedValue({ count: 0 });

      const result = await rotateUserSession('old', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('unknown-token');
    });
  });

  describe('吊销与清理', () => {
    it('revokeUserSessionByToken：按摘要吊销当前会话', async () => {
      await revokeUserSessionByToken('rt-token');

      expect(sessions.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: hash('rt-token'), revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
    });

    it('revokeAllUserSessions：按 userId 吊销全部活跃会话', async () => {
      await revokeAllUserSessions('user-1');

      expect(sessions.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
    });

    it('吊销失败吞错告警（tokenVersion 主吊销不受影响）', async () => {
      sessions.updateMany.mockRejectedValue(new Error('db down'));
      await expect(revokeAllUserSessions('user-1')).resolves.toBeUndefined();
      await expect(revokeUserSessionByToken('rt')).resolves.toBeUndefined();
    });

    it('pruneUserSessions：清理过期与吊销满一周的行', async () => {
      await pruneUserSessions();

      expect(sessions.deleteMany).toHaveBeenCalledTimes(1);
      const where = sessions.deleteMany.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(2);
      expect(where.OR[0].expiresAt.lt.getTime()).toBeLessThan(Date.now());
      expect(where.OR[1].revokedAt.lt.getTime()).toBeLessThan(Date.now());
    });
  });
});
