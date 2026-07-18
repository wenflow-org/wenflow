import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

function requireSeedPassword(name: string): string {
  const value = process.env[name] || '';
  if (value.length < 12) {
    throw new Error(`${name} 必须显式配置且至少 12 位`);
  }
  return value;
}

async function main() {
  const adminPassword = await bcrypt.hash(requireSeedPassword('SEED_ADMIN_PASSWORD'), 10);
  const userPassword = await bcrypt.hash(requireSeedPassword('SEED_USER_PASSWORD'), 10);

  const users = [
    {
      name: '管理员',
      email: 'admin@example.com',
      password: adminPassword,
      role: 'admin',
      isAdmin: true,
      currentLevel: 'intermediate',
      xp: 1000
    },
    {
      name: '张三',
      email: 'zhangsan@example.com',
      password: userPassword,
      role: 'user',
      isAdmin: false,
      currentLevel: 'beginner',
      xp: 500
    },
    {
      name: '李四',
      email: 'lisi@example.com',
      password: userPassword,
      role: 'user',
      isAdmin: false,
      currentLevel: 'advanced',
      xp: 1500
    },
    {
      name: '王五',
      email: 'wangwu@example.com',
      password: userPassword,
      role: 'user',
      isAdmin: false,
      currentLevel: 'beginner',
      xp: 200
    }
  ];

  for (const user of users) {
    const created = await prisma.users.create({
      data: {
        id: randomUUID(),
        ...user,
        updatedAt: new Date()
      }
    });
    console.log(`创建测试用户：${created.id}`);
  }

  console.log('测试用户创建完成。密码来自环境变量，未输出。');
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
