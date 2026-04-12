/**
 * 创建管理员账号脚本
 * 用法：node create-admin.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createAdmin() {
  const email = 'admin@example.com';
  const password = 'admin123';
  const name = '系统管理员';

  try {
    // 检查是否已存在管理员
    const existingAdmin = await prisma.user.findFirst({
      where: { email }
    });

    if (existingAdmin) {
      console.log('✅ 管理员账号已存在:', email);
      console.log('   无需重复创建');
      return;
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建管理员账号
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        isAdmin: true,
        xp: 9999,
        level: 99,
      }
    });

    console.log('✅ 管理员账号创建成功！');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 邮箱：', email);
    console.log('🔑 密码：', password);
    console.log('👤 昵称：', name);
    console.log('🆔 ID:', admin.id);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n访问管理平台：http://localhost:5173/admin/login');
    
  } catch (error) {
    console.error('❌ 创建管理员失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
