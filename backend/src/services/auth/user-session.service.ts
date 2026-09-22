// 用户会话（user_sessions）：refresh token 服务端登记 + 原地轮换 + 重用检测（安全审计 M2）
//
// 与 admin_sessions 的 jti 模式对齐，但按「每活跃设备一行、原地轮换」建模：
// - 登录/注册：登记新行（只存 sha256 摘要，拖库不可直接冒用）
// - 刷新轮换：tokenHash 换新、旧哈希挪入 previousTokenHash（乐观锁防并发双刷新互杀）
// - 重用检测：命中 previousTokenHash = 旧代令牌在轮换后被重放 → 吊销该会话；
//   查不到 = 未登记令牌（部署前签发/已清理/伪造）→ 刷新一律拒绝（fail-closed）
// - 登出：按令牌吊销当前会话；改密/重置：吊销该用户全部会话
import crypto from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export type RotateUserSessionResult = 'rotated' | 'reuse-detected' | 'unknown-token';

// 与 session-token.ts 的 REFRESH_TOKEN_EXPIRES_IN ('30d') 对齐
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hashRefreshToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

export const refreshTokenExpiry = (): Date => new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

/**
 * 登录/注册时登记新会话。失败仅告警不阻断登录——后续刷新会对未登记令牌
 * fail-closed 拒绝，宁可让用户重新登录，不给未登记凭证开门。
 */
export const registerUserSession = async (
  userId: string,
  refreshToken: string,
  tokenVersion: number
): Promise<void> => {
  try {
    await prisma.user_sessions.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        tokenVersion,
        expiresAt: refreshTokenExpiry(),
      }
    });
  } catch (error) {
    logger.error('[user-session] 会话登记失败（登录继续；该凭证后续刷新将被拒绝）:', error);
  }
};

/**
 * 刷新轮换：校验旧令牌的会话登记并原子换新。
 * - 'rotated'：正常轮换完成，调用方可以下发新 token 对
 * - 'reuse-detected'：已轮换/已吊销令牌被重放（可能的盗用），会话已吊销，必须 401
 * - 'unknown-token'：无会话登记（部署前签发/伪造/并发竞争落败），必须 401
 */
export const rotateUserSession = async (
  oldRefreshToken: string,
  newRefreshToken: string,
  opts: { userId: string; tokenVersion: number }
): Promise<RotateUserSessionResult> => {
  const oldHash = hashRefreshToken(oldRefreshToken);
  const newHash = hashRefreshToken(newRefreshToken);
  const now = new Date();

  // 1) 命中当前代 → 原地轮换。乐观锁（tokenHash=oldHash）保证并发双刷新只有一个赢家，
  //    输家按 unknown-token 处理（其一收到 401 重新登录，而非误判重用互杀）
  const current = await prisma.user_sessions.findUnique({ where: { tokenHash: oldHash } });
  if (current) {
    if (current.revokedAt) {
      return 'reuse-detected';
    }
    if (current.userId !== opts.userId) {
      await prisma.user_sessions.updateMany({
        where: { id: current.id },
        data: { revokedAt: now }
      });
      logger.warn('[user-session] 会话归属校验失败，已吊销', { rowUserId: current.userId, optsUserId: opts.userId });
      return 'reuse-detected';
    }
    const updated = await prisma.user_sessions.updateMany({
      where: { id: current.id, tokenHash: oldHash },
      data: {
        tokenHash: newHash,
        previousTokenHash: oldHash,
        rotatedAt: now,
        lastUsedAt: now,
        tokenVersion: opts.tokenVersion,
        expiresAt: refreshTokenExpiry(),
      }
    });
    return updated.count === 1 ? 'rotated' : 'unknown-token';
  }

  // 2) 命中上一代 → 正常轮换后旧令牌又被出示：重放（典型盗用信号），吊销该会话。
  //    注：同浏览器极端并发双刷新理论上也可能走到这里，代价只是双方重新登录，方向安全。
  const predecessor = await prisma.user_sessions.findFirst({
    where: { previousTokenHash: oldHash }
  });
  if (predecessor) {
    await prisma.user_sessions.updateMany({
      where: { id: predecessor.id, revokedAt: null },
      data: { revokedAt: now }
    });
    logger.warn('[user-session] 检测到已轮换 refresh token 被重放，已吊销该会话', { userId: predecessor.userId });
    return 'reuse-detected';
  }

  // 3) 未登记令牌：拒绝，维持「每个可用的 refresh token 都有会话行」不变量
  return 'unknown-token';
};

/** 登出：按令牌吊销当前会话（未登记令牌静默跳过；失败不阻断登出） */
export const revokeUserSessionByToken = async (refreshToken: string): Promise<void> => {
  try {
    await prisma.user_sessions.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  } catch (error) {
    logger.error('[user-session] 登出吊销会话失败:', error);
  }
};

/**
 * 改密/重置/管理员重置后吊销该用户全部会话。失败仅告警：tokenVersion 递增
 * 仍是主吊销手段（旧 JWT 在认证链即被拒），会话吊销是针对无 tokenVersion
 * 存量令牌的兜底与将来「会话管理」能力的地基。
 */
export const revokeAllUserSessions = async (userId: string): Promise<void> => {
  try {
    await prisma.user_sessions.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  } catch (error) {
    logger.error('[user-session] 吊销用户全部会话失败（tokenVersion 兜底仍生效）:', error);
  }
};

/** 惰性清理：过期/吊销满一周的行不再参与任何判定，登录时顺带清掉防膨胀 */
export const pruneUserSessions = async (): Promise<void> => {
  try {
    const now = Date.now();
    await prisma.user_sessions.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } },
          { revokedAt: { lt: new Date(now - 7 * 24 * 60 * 60 * 1000) } },
        ]
      }
    });
  } catch (error) {
    logger.warn('[user-session] 过期会话清理失败（不影响主流程）:', error);
  }
};
