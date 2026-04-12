import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('开始创建测试用户...');

  // 创建管理员用户
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      name: '管理员',
      email: 'admin@example.com',
      password: adminPassword,
      xp: 1000,
      level: 5,
      skillLevel: 'intermediate',
      learningStyle: 'visual',
      timePerDay: 60,
      learningGoal: '提升技能'
    }
  });
  console.log(`✅ 创建管理员用户：${admin.id}`);

  // 创建测试用户 1
  const user1Password = await bcrypt.hash('user123', 10);
  const user1 = await prisma.user.create({
    data: {
      name: '张三',
      email: 'zhangsan@example.com',
      password: user1Password,
      xp: 500,
      level: 3,
      skillLevel: 'beginner',
      learningStyle: 'auditory',
      timePerDay: 30,
      learningGoal: '学习新知识'
    }
  });
  console.log(`✅ 创建测试用户：${user1.id}`);

  // 创建测试用户 2
  const user2Password = await bcrypt.hash('user123', 10);
  const user2 = await prisma.user.create({
    data: {
      name: '李四',
      email: 'lisi@example.com',
      password: user2Password,
      xp: 1500,
      level: 7,
      skillLevel: 'advanced',
      learningStyle: 'kinesthetic',
      timePerDay: 90,
      learningGoal: '职业发展'
    }
  });
  console.log(`✅ 创建测试用户：${user2.id}`);

  // 创建测试用户 3
  const user3Password = await bcrypt.hash('user123', 10);
  const user3 = await prisma.user.create({
    data: {
      name: '王五',
      email: 'wangwu@example.com',
      password: user3Password,
      xp: 200,
      level: 2,
      skillLevel: 'beginner',
      learningStyle: 'visual',
      timePerDay: 45,
      learningGoal: '兴趣爱好'
    }
  });
  console.log(`✅ 创建测试用户：${user3.id}`);

  console.log('\n✨ 测试用户创建完成！');
  console.log('\n登录信息:');
  console.log('  管理员：admin@example.com / admin123');
  console.log('  张三：zhangsan@example.com / user123');
  console.log('  李四：lisi@example.com / user123');
  console.log('  王五：wangwu@example.com / user123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
