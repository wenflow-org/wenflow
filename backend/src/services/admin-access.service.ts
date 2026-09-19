import prisma from '../config/database';

/**
 * 管理端接口鉴权：读取用户的 `isAdmin` 标记。
 *
 * 与 `authService.isUserAdmin` 的差异：本函数**不吞查询错误**，失败向上抛出，
 * 由调用方（路由）统一转 500，保持既有路由内 `ensureAdmin` 的语义。
 */
export async function checkIsAdmin(userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return !!operator?.isAdmin;
}
