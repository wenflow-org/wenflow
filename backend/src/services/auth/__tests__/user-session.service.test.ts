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

    it('超窗（#116-d）：上一代令牌轮换已过 60s → 维持严格吊销并 reuse-detected', async () => {
      sessions.findFirst.mockResolvedValue({
        id: 's-1', userId: 'user-1', previousTokenHash: hash('old'), revokedAt: null,
        rotatedAt: new Date(Date.now() - 5 * 60 * 1000) // 5 分钟前轮换，超出 60s 容忍窗
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('reuse-detected');
      expect(sessions.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
    });

    it('并发容忍窗（#116-a）：毫秒级双刷新落败方出示上一代令牌 → concurrent，不吊销会话', async () => {
      // 赢家刚完成轮换：旧令牌不再是当前代（findUnique 落空），但仍是上一代（findFirst 命中）
      sessions.findUnique.mockResolvedValue(null);
      sessions.findFirst.mockResolvedValue({
        id: 's-1', userId: 'user-1', previousTokenHash: hash('old'), revokedAt: null,
        rotatedAt: new Date(Date.now() - 25) // 25ms 前刚轮换
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('concurrent');
      // 会话存活：既未吊销、也未再轮换（不写任何行）
      expect(sessions.updateMany).not.toHaveBeenCalled();
    });

    it('更旧代令牌（#116-b）：摘要已被后续轮换覆盖、无任何登记 → 不判并发，fail-closed 拒绝', async () => {
      // 两代之前的令牌：tokenHash 与 previousTokenHash 均不匹配（库内只留一代历史，无从吊销）
      sessions.findUnique.mockResolvedValue(null);
      sessions.findFirst.mockResolvedValue(null);

      const result = await rotateUserSession('ancient', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('unknown-token');
      expect(sessions.updateMany).not.toHaveBeenCalled(); // 绝不放行、绝不复活
    });

    it('更旧数据无法证明在窗内（#116-b）：上一代行缺轮换时间 → 维持严格吊销', async () => {
      sessions.findUnique.mockResolvedValue(null);
      sessions.findFirst.mockResolvedValue({
        id: 's-1', userId: 'user-1', previousTokenHash: hash('old'), revokedAt: null,
        rotatedAt: null // 缺时间戳：不能证明 ≤60s，按重放严格吊销
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('reuse-detected');
      expect(sessions.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
    });

    it('已吊销代（#116-c）：上一代行已吊销 → 容忍窗不适用，仍吊销并 reuse-detected', async () => {
      sessions.findUnique.mockResolvedValue(null);
      sessions.findFirst.mockResolvedValue({
        id: 's-1', userId: 'user-1', previousTokenHash: hash('old'),
        revokedAt: new Date(Date.now() - 1000), rotatedAt: new Date(Date.now() - 10)
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-1', tokenVersion: 0 });

      expect(result).toBe('reuse-detected');
      expect(sessions.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
    });

    it('容忍窗内但归属不一致：不放行，仍吊销并 reuse-detected', async () => {
      sessions.findUnique.mockResolvedValue(null);
      sessions.findFirst.mockResolvedValue({
        id: 's-1', userId: 'user-1', previousTokenHash: hash('old'), revokedAt: null,
        rotatedAt: new Date(Date.now() - 25)
      });

      const result = await rotateUserSession('old', 'new', { userId: 'user-9', tokenVersion: 0 });

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
