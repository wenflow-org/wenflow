import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
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

/** 开发环境内置默认初始密码（生产环境必须显式配置 INIT_ADMIN_PASSWORD） */
export const DEFAULT_INIT_ADMIN_PASSWORD = 'ChangeMe_2026_Admin';

/**
 * 明确禁止的示例 / 默认口令集合。
 * 目的：文档里出现的示例值若被直接复制上线，启动时立即失败，而不是静默生效。
 * 注意：DEFAULT_INIT_ADMIN_PASSWORD 仅在开发环境「未配置」时被回退使用（不会进入本校验）；
 * 若有人显式把它或文档占位符写进 INIT_ADMIN_PASSWORD，这里会拒绝。
 */
const DISALLOWED_INIT_ADMIN_PASSWORDS = new Set([
  'admin123',
  'password',
  'yourstrongpassword123',
  'admin@2026strong',
  'changeme_2026_admin',
  'change_me_before_deploy',
]);

function initialAdminPassword(environment: NodeJS.ProcessEnv): string | null {
  const configured = environment.INIT_ADMIN_PASSWORD;
  if (configured !== undefined && configured.trim() !== '') {
    const password = configured.trim();
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)
      || DISALLOWED_INIT_ADMIN_PASSWORDS.has(password.toLowerCase())) {
      throw new Error('INIT_ADMIN_PASSWORD 必须至少 12 位并包含大小写字母和数字，且不能使用文档示例 / 默认弱密码');
    }
    return password;
  }
  // 未配置时：开发环境使用内置默认密码（便于本地初始化）；生产环境拒绝默认口令，必须显式配置
  if (environment.NODE_ENV === 'production') {
    return null;
  }
  return DEFAULT_INIT_ADMIN_PASSWORD;
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

  const adminId = `admin_${randomUUID()}`;
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
