/**
 * 创建管理员账号脚本
 * 用法：node create-admin.js
 * 
 * 从环境变量读取配置，密码必须显式提供
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createAdmin() {
  // 从环境变量读取配置；未配置时开发环境回退内置默认密码，生产环境强制显式配置
  const email = process.env.INIT_ADMIN_EMAIL || 'admin@wenflow.local';
  const configured = (process.env.INIT_ADMIN_PASSWORD || '').trim();
  const password = configured || (process.env.NODE_ENV === 'production' ? '' : 'ChangeMe_2026_Admin');
  const name = process.env.INIT_ADMIN_NAME || 'admin';

  try {
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      throw new Error('INIT_ADMIN_PASSWORD 必须显式设置（生产环境不允许默认口令），且至少 12 位并包含大小写字母和数字');
    }
    if (/^(admin123|password|yourstrongpassword123)$/i.test(password)) {
      throw new Error('INIT_ADMIN_PASSWORD 不能使用默认或示例密码');
    }

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
        currentLevel: 'beginner',
      }
    });

    console.log('✅ 管理员账号创建成功！');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👤 用户名：', name);
    console.log('📧 邮箱：', email);
    console.log('🔑 密码：已通过环境变量设置，不在终端显示');
    console.log('🆔 ID:', admin.id);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n访问范围由 ADMIN_ACCESS_MODE 或 Admin“连接与安全”页面控制');
    console.log('\n访问管理平台：http://localhost:5173/admin/login');
    
  } catch (error) {
    console.error('❌ 创建管理员失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
