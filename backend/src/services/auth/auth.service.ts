// 认证服务
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import {
  signSessionToken,
  verifySessionToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../utils/session-token';
import { getPasswordResetMailProvider } from './password-reset-mailer';
import { isTestAccountUser } from '../../utils/test-account';

interface RegisterData {
  name: string;
  password: string;
}

interface LoginData {
  name: string;
  password: string;
}

interface JWTPayload {
  userId: string;
  name: string;
  tokenVersion?: number;
}

const INVALID_LOGIN_PASSWORD_HASH = '$2b$10$OAioDMuBkv4OiDj1OPaJse/r3xbZoGaxLWtBNBD6VSlBa5T4nwkdG';

export class InvalidCredentialsError extends Error {
  readonly status = 401;
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('用户名或密码错误');
    this.name = 'InvalidCredentialsError';
  }
}

/** 注册时用户名已被占用：业务冲突，应以 409 返回（此前裸 Error 导致 500，与成功 201 形成枚举差异） */
export class UsernameTakenError extends Error {
  readonly status = 409;
  readonly code = 'USERNAME_TAKEN';

  constructor() {
    super('用户名已被使用');
    this.name = 'UsernameTakenError';
  }
}

/** 重置令牌无效/已过期 */
export class ResetTokenInvalidError extends Error {
  readonly status = 400;
  readonly code = 'RESET_TOKEN_INVALID';

  constructor() {
    super('重置链接无效或已过期');
    this.name = 'ResetTokenInvalidError';
  }
}

class AuthService {
  private JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

  constructor() {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET 未配置，请检查环境变量');
    }
  }

  // ──── Dual-token pair generation ────

  /** Issue a fresh access + refresh token pair for a user. */
  generateTokenPair(
    userId: string,
    name: string,
    tokenVersion: number
  ): { accessToken: string; refreshToken: string } {
    const accessToken = signAccessToken(userId, name, tokenVersion);
    const refreshToken = signRefreshToken(userId, tokenVersion);
    return { accessToken, refreshToken };
  }

  // 注册
  async register(data: RegisterData) {
    try {
      // 检查用户名是否已存在（使用 findFirst，因为 name 不是唯一字段）；软删账号不占用用户名
      const existingUser = await prisma.users.findFirst({
        where: { name: data.name, deletedAt: null }
      });

      if (existingUser) {
        throw new UsernameTakenError();
      }

      // 加密密码
      const hashedPassword = await bcrypt.hash(data.password, 10);

      // 创建用户（自动生成 email）；ID 用密码学随机 UUID，避免可预测/碰撞
      const userId = `user_${randomUUID()}`;
      const user = await prisma.users.create({
        data: {
          id: userId,
          name: data.name,
          email: `${data.name}@wenflow.local`,
          password: hashedPassword,
          updatedAt: new Date(),
        }
      });

      // 生成 JWT
      const { accessToken, refreshToken } = this.generateTokenPair(
        user.id,
        user.name,
        user.tokenVersion || 0
      );

      logger.info(`新用户注册：${user.name}`);

      return {
        user: {
          id: user.id,
          name: user.name,
        },
        accessToken,
        refreshToken,
      };
    } catch (error) {
      logger.error('注册失败:', error);
      throw error;
    }
  }

  // 登录
  async login(data: LoginData) {
    try {
      // 查找用户（支持用户名或邮箱登录）；软删账号视为不存在，按普通凭据错误处理
      const user = await prisma.users.findFirst({
        where: {
          OR: [
            { name: data.name },
            { email: data.name }
          ],
          isAdmin: false,
          deletedAt: null
        }
      });

      // 未命中时也执行同等成本的密码校验，避免通过响应时序探测账号。
      const isTestAccount = user ? isTestAccountUser(user) : false;
      const isValidPassword = await bcrypt.compare(
        data.password,
        user?.password || INVALID_LOGIN_PASSWORD_HASH
      );

      // 测试/审计账号（qa_audit_/e2e_/@test.local 等命名约定）不允许登录用户侧：
      // 与 admin 侧 REAL_USER_WHERE 同源识别（utils/test-account.ts），返回与凭据错误一致的 401，防枚举。
      if (!user || !isValidPassword || isTestAccount) {
        throw new InvalidCredentialsError();
      }

      // 更新最后登录时间
      await prisma.users.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });

      // 生成 JWT（携带 tokenVersion，供改密/重置后吊销旧令牌）
      const { accessToken, refreshToken } = this.generateTokenPair(
        user.id,
        user.name,
        user.tokenVersion || 0
      );

      logger.info(`用户登录：${user.name}`);

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        accessToken,
        refreshToken,
      };
    } catch (error) {
      logger.error('登录失败:', error);
      throw error;
    }
  }

  // 修改密码（需验证当前密码）
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    // 软删账号不允许修改密码，按凭据错误处理
    const user = await prisma.users.findFirst({
      where: { id: userId, deletedAt: null }
    });

    // 与登录同等的常量时间比较，避免通过响应时序探测
    const isValidPassword = await bcrypt.compare(
      oldPassword,
      user?.password || INVALID_LOGIN_PASSWORD_HASH
    );
    if (!user || !isValidPassword) {
      throw new InvalidCredentialsError();
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    // 改密即递增 tokenVersion：此前签发的所有旧 JWT 立即失效（吊销机制）
    await prisma.users.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        tokenVersion: { increment: 1 },
        updatedAt: new Date()
      }
    });

    logger.info(`用户修改密码：${user.name}`);
  }

  // 验证 Token
  async verifyToken(token: string) {
    try {
      // 显式指定允许的算法，防止算法混淆攻击
      const decoded = verifySessionToken(token, 'user') as JWTPayload;

      // 查找用户；软删账号视为不存在，令牌立即失效
      const user = await prisma.users.findFirst({
        where: { id: decoded.userId, deletedAt: null }
      });

      // 测试/审计账号的存量会话一并失效（与登录拒绝同源识别），用户侧不再展示测试账号
      if (!user || isTestAccountUser(user)) {
        throw new Error('用户不存在');
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
      };
    } catch (error) {
      logger.error('Token 验证失败:', error);
      throw new Error('无效的 Token');
    }
  }

  // 生成旧版单 token（保留供 verifyToken 等场景使用）
  private generateToken(payload: JWTPayload): string {
    return signSessionToken(payload, 'user', this.JWT_EXPIRES_IN as any);
  }

  // 忘记密码：生成一次性重置令牌（tokenHash 落库，明文仅经 provider 发送）
  // 统一响应防枚举：无论用户名是否存在均返回成功
  async requestPasswordReset(name: string): Promise<void> {
    const user = await prisma.users.findFirst({
      where: { name, deletedAt: null }
    });
    if (!user) {
      return;
    }

    // 使该用户既有未使用重置令牌全部失效
    await prisma.password_reset_tokens.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() }
    });

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await prisma.password_reset_tokens.create({
      data: { userId: user.id, tokenHash, expiresAt }
    });

    const baseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
    await getPasswordResetMailProvider().sendPasswordReset({
      toName: user.name,
      resetUrl: `${baseUrl}/reset-password?token=${token}`,
      expiresInMinutes: Math.round(RESET_TOKEN_TTL_MS / 60000)
    });

    logger.info(`用户申请密码重置：${user.name}`);
  }

  // 重置密码：校验令牌有效后更新密码并递增 tokenVersion（吊销全部旧 JWT）
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = await prisma.password_reset_tokens.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!record) {
      throw new ResetTokenInvalidError();
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.users.update({
        where: { id: record.userId },
        data: {
          password: hashedPassword,
          tokenVersion: { increment: 1 },
          updatedAt: new Date()
        }
      }),
      prisma.password_reset_tokens.update({
        where: { id: record.id },
        data: { usedAt: new Date() }
      })
    ]);

    logger.info(`用户通过重置链接修改密码：${record.userId}`);
  }
}

// 重置令牌有效期：30 分钟
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export default new AuthService();
