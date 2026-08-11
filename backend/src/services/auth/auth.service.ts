// 认证服务
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { signSessionToken, verifySessionToken } from '../../utils/session-token';

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

class AuthService {
  private JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

  constructor() {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET 未配置，请检查环境变量');
    }
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
      const token = this.generateToken({ userId: user.id, name: user.name });

      logger.info(`新用户注册：${user.name}`);

      return {
        user: {
          id: user.id,
          name: user.name,
        },
        token
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
      const isValidPassword = await bcrypt.compare(
        data.password,
        user?.password || INVALID_LOGIN_PASSWORD_HASH
      );

      if (!user || !isValidPassword) {
        throw new InvalidCredentialsError();
      }

      // 更新最后登录时间
      await prisma.users.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });

      // 生成 JWT（携带 tokenVersion，供改密/重置后吊销旧令牌）
      const token = this.generateToken({
        userId: user.id,
        name: user.name,
        tokenVersion: user.tokenVersion || 0,
      });

      logger.info(`用户登录：${user.name}`);

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        token
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

      if (!user) {
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

  // 生成 JWT
  private generateToken(payload: JWTPayload): string {
    return signSessionToken(payload, 'user', this.JWT_EXPIRES_IN as any);
  }
}

export default new AuthService();
