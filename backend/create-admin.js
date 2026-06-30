/**
 * 创建管理员账号脚本
 * 用法：node create-admin.js
 * 
 * 从环境变量读取配置，如果未设置则使用默认值
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createAdmin() {
  // 从环境变量读取配置，提供默认值
  const email = process.env.INIT_ADMIN_EMAIL || 'admin@wenflow.local';
  const password = process.env.INIT_ADMIN_PASSWORD || 'admin123';
  const name = process.env.INIT_ADMIN_NAME || 'admin';

  try {
    // 检查是否已存在管理员
    const existingAdmin = await prisma.users.findFirst({
      where: { 
        OR: [
          { email },
          { name }
        ]
      }
    });

    if (existingAdmin) {
      console.log('✅ 管理员账号已存在');
      console.log('   用户名:', existingAdmin.name);
      console.log('   邮箱:', existingAdmin.email);
      console.log('   无需重复创建');
      return;
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建管理员账号
    const admin = await prisma.users.create({
      data: {
        email,
        password: hashedPassword,
        name,
        isAdmin: true,
        role: 'admin',
        xp: 0,
        currentLevel: 1,
      }
    });

    console.log('✅ 管理员账号创建成功！');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👤 用户名：', name);
    console.log('📧 邮箱：', email);
    console.log('🔑 密码：', password);
    console.log('🆔 ID:', admin.id);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n⚠️  管理员登录仅限本地访问（localhost/127.0.0.1）');
    console.log('   如需远程登录，请在 .env 中设置: ADMIN_LOCALHOST_ONLY=false');
    console.log('\n💡 密码已在上方显示，请妥善保管后按任意键继续...');
    console.log('   （此密码仅在创建时显示一次）');
    console.log('\n访问管理平台：http://localhost:5173/admin/login');
    
  } catch (error) {
    console.error('❌ 创建管理员失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
