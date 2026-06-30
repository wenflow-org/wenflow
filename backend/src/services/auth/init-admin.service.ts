import bcrypt from 'bcrypt';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

const INIT_ADMIN_NAME = process.env.INIT_ADMIN_NAME || 'admin';
const INIT_ADMIN_PASSWORD = process.env.INIT_ADMIN_PASSWORD || 'admin123';
const INIT_ADMIN_EMAIL = process.env.INIT_ADMIN_EMAIL || `${INIT_ADMIN_NAME}@wenflow.local`;

export async function initializeAdmin(): Promise<void> {
  try {
    // 检查是否已存在管理员
    const existingAdmin = await prisma.users.findFirst({
      where: {
        OR: [
          { name: INIT_ADMIN_NAME },
          { email: INIT_ADMIN_EMAIL },
          { isAdmin: true },
          { role: 'admin' }
        ]
      }
    });

    if (existingAdmin) {
      logger.info('✅ 管理员账户已存在，跳过创建');
      return;
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(INIT_ADMIN_PASSWORD, 10);

    // 生成唯一 ID
    const adminId = `admin_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 当前时间
    const now = new Date();

    // 创建管理员
    await prisma.users.create({
      data: {
        id: adminId,
        email: INIT_ADMIN_EMAIL,
        name: INIT_ADMIN_NAME,
        password: hashedPassword,
        role: 'admin',
        isAdmin: true,
        xp: 0,
        currentLevel: 'beginner',
        createdAt: now,
        updatedAt: now
      }
    });

    logger.info('✅ 初始管理员创建成功');
    logger.info(`   用户名：${INIT_ADMIN_NAME}`);
    logger.info(`   密码：****** (已设置)`);
    logger.info(`   邮箱：${INIT_ADMIN_EMAIL}`);
    logger.info(`   ⚠️  管理员登录仅限本地访问 (localhost/127.0.0.1)`);
  } catch (error: any) {
    logger.error('❌ 创建初始管理员失败:', error.message);
  }
}
