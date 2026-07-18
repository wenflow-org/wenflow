import bcrypt from 'bcrypt';
import prisma from '../../config/database';

interface AdminDatabase {
  users: {
    findFirst(args: any): Promise<any>;
    create(args: any): Promise<any>;
  };
}

export type InitializeAdminResult =
  | { status: 'created'; adminId: string; name: string; email: string }
  | { status: 'existing'; adminId: string }
  | { status: 'skipped_not_configured' };

function initialAdminPassword(environment: NodeJS.ProcessEnv): string | null {
  const configured = environment.INIT_ADMIN_PASSWORD;
  if (configured === undefined || configured.trim() === '') return null;
  const password = configured.trim();
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)
    || /^(admin123|password|yourstrongpassword123)$/i.test(password)) {
    throw new Error('INIT_ADMIN_PASSWORD 必须至少 12 位并包含大小写字母和数字，且不能使用示例弱密码');
  }
  return password;
}

export async function initializeAdmin(
  database: AdminDatabase = prisma,
  environment: NodeJS.ProcessEnv = process.env
): Promise<InitializeAdminResult> {
  const name = environment.INIT_ADMIN_NAME?.trim() || 'admin';
  const email = environment.INIT_ADMIN_EMAIL?.trim() || `${name}@wenflow.local`;
  const existingAdmin = await database.users.findFirst({
    where: {
      OR: [
        { isAdmin: true },
        { role: 'admin' }
      ]
    }
  });

  if (existingAdmin) {
    return { status: 'existing', adminId: existingAdmin.id };
  }

  const password = initialAdminPassword(environment);
  if (!password) return { status: 'skipped_not_configured' };

  const identityConflict = await database.users.findFirst({
    where: { OR: [{ name }, { email }] }
  });
  if (identityConflict) {
    throw new Error('INIT_ADMIN_NAME 或 INIT_ADMIN_EMAIL 已被普通用户占用，拒绝自动提升权限');
  }

  const adminId = `admin_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date();
  await database.users.create({
    data: {
      id: adminId,
      email,
      name,
      password: await bcrypt.hash(password, 10),
      role: 'admin',
      isAdmin: true,
      xp: 0,
      currentLevel: 'beginner',
      createdAt: now,
      updatedAt: now
    }
  });
  return { status: 'created', adminId, name, email };
}
