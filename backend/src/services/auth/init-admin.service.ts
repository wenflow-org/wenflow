import bcrypt from 'bcrypt';
import prisma from '../../config/database';

const INIT_ADMIN_NAME = process.env.INIT_ADMIN_NAME;
const INIT_ADMIN_PASSWORD = process.env.INIT_ADMIN_PASSWORD;

export async function initializeAdmin(): Promise<void> {
  if (!INIT_ADMIN_NAME || !INIT_ADMIN_PASSWORD) {
    console.log('ℹ️  未配置初始管理员，跳过自动创建');
    return;
  }

  try {
    // 检查是否已存在管理员
    const existingAdmin = await prisma.users.findFirst({
      where: {
        OR: [
          { name: INIT_ADMIN_NAME },
          { isAdmin: true },
          { role: 'admin' }
        ]
      }
    });

    if (existingAdmin) {
      console.log('✅ 已存在管理员账户，跳过创建');
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
        email: `${INIT_ADMIN_NAME}@wenflow.local`,
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

    console.log(`✅ 初始管理员创建成功：${INIT_ADMIN_NAME}`);
    console.log(`   用户名：${INIT_ADMIN_NAME}`);
    console.log(`   密码：${INIT_ADMIN_PASSWORD}`);
    console.log(`   邮箱：${INIT_ADMIN_NAME}@wenflow.local (自动生成)`);
  } catch (error: any) {
    console.error('❌ 创建初始管理员失败:', error.message);
  }
}
