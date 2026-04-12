// 认证服务
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

interface RegisterData {
  email: string;
  password: string;
  name?: string;
}

interface LoginData {
  email: string;
  password: string;
}

interface JWTPayload {
  userId: string;
  email: string;
}

class AuthService {
  private JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
  private JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

  // 注册
  async register(data: RegisterData) {
    try {
      // 检查邮箱是否已存在
      const existingUser = await prisma.users.findUnique({
        where: { email: data.email }
      });

      if (existingUser) {
        throw new Error('邮箱已被注册');
      }

      // 加密密码
      const hashedPassword = await bcrypt.hash(data.password, 10);

      // 创建用户
      const user = await prisma.users.create({
        data: {
          id: `user_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          email: data.email,
          password: hashedPassword,
          name: data.name || data.email.split('@')[0],
          updatedAt: new Date(),
        }
      });

      // 生成 JWT
      const token = this.generateToken({ userId: user.id, email: user.email });

      logger.info(`新用户注册：${user.email}`);

      return {
        user: {
          id: user.id,
          email: user.email,
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
      // 查找用户
      const user = await prisma.users.findUnique({
        where: { email: data.email }
      });

      if (!user) {
        throw new Error('邮箱或密码错误');
      }

      // 验证密码
      const isValidPassword = await bcrypt.compare(data.password, user.password);

      if (!isValidPassword) {
        throw new Error('邮箱或密码错误');
      }

      // 更新最后登录时间
      await prisma.users.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });

      // 生成 JWT
      const token = this.generateToken({ userId: user.id, email: user.email });

      logger.info(`用户登录：${user.email}`);

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

  // 验证 Token
  async verifyToken(token: string) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as JWTPayload;

      // 查找用户
      const user = await prisma.users.findUnique({
        where: { id: decoded.userId }
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
    const options: SignOptions = {
      expiresIn: this.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']
    };
    return jwt.sign(payload, this.JWT_SECRET, options);
  }
}

export default new AuthService();
