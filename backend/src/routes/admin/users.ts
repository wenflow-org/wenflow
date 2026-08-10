// 用户管理路由
import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { randomUUID as uuidv4 } from 'crypto';

const router = express.Router();

// 需要管理员权限
router.use(authMiddleware);

const SALT_ROUNDS = 10;

function validatePasswordRule(password: string): string | null {
  if (password.length < 8) return '密码至少 8 位';
  if (!/[a-zA-Z]/.test(password)) return '密码必须包含字母';
  if (!/[0-9]/.test(password)) return '密码必须包含数字';
  return null;
}

const ensureAdmin = async (userId: string) => {
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  });

  return !!operator?.isAdmin;
};

const requireAdmin = async (operatorId?: string) => {
  if (!operatorId || !(await ensureAdmin(operatorId))) {
    return {
      ok: false,
      response: {
        success: false,
        error: { message: '需要管理员权限' }
      }
    };
  }

  return { ok: true };
};

// 获取用户列表
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    
    // 搜索条件
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } }
      ];
    }

    // 角色筛选
    if (role === 'admin') {
      where.isAdmin = true;
    } else if (role === 'user') {
      where.isAdmin = false;
    }

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where,
        skip,
        take: Number(limit),
        select: {
          id: true,
          name: true,
          email: true,
          isAdmin: true,
          xp: true,
          currentLevel: true,
          lastLoginAt: true,
          createdAt: true,
          _count: {
            select: {
              learning_paths: true,
              teaching_sessions: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.users.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit)
        }
      }
    });
  } catch (error: any) {
    next(error);
  }
});

// 获取用户详情
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.params.id;

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        currentLevel: true,
        xp: true,
        isAdmin: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            learning_paths: true,
            goal_conversations: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: '用户不存在' }
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error: any) {
    next(error);
  }
});

// 创建用户
router.post('/', async (req, res, next) => {
  try {
    const operatorId = req.user?.userId;
    const permission = await requireAdmin(operatorId);
    if (!permission.ok) {
      return res.status(403).json(permission.response);
    }

    const {
      email,
      password,
      name,
      role = 'user',
      currentLevel = 'beginner',
      xp = 0,
      isAdmin
    } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: { message: 'email、password、name 为必填项' }
      });
    }

    const passwordError = validatePasswordRule(String(password));
    if (passwordError) {
      return res.status(400).json({
        success: false,
        error: { message: passwordError }
      });
    }

    // isAdmin 严格布尔解析：仅接受 true（兼容字符串 'true'），
    // 避免 Boolean('false') 之类的字符串陷阱把用户误判为管理员
    const adminFlag = isAdmin === true || isAdmin === 'true';

    const allowedRoles = ['user', 'admin'];
    if (typeof role !== 'string' || !allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: { message: `role 仅支持 ${allowedRoles.join(' / ')}` }
      });
    }

    // isAdmin 与 role 强绑定：管理员时强制 'admin'；
    // 非管理员时不允许 role 为 'admin'（忽略并降级为 'user'）
    const finalRole = adminFlag ? 'admin' : (role === 'admin' ? 'user' : role);

    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { message: '邮箱已存在' }
      });
    }

    const hashedPassword = await bcrypt.hash(String(password), SALT_ROUNDS);

    const user = await prisma.users.create({
      data: {
        id: uuidv4(),
        email: String(email),
        name: String(name),
        password: hashedPassword,
        role: finalRole,
        currentLevel: String(currentLevel),
        xp: Number(xp) || 0,
        isAdmin: adminFlag,
        updatedAt: new Date()
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        currentLevel: true,
        xp: true,
        isAdmin: true,
        createdAt: true
      }
    });

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error: any) {
    next(error);
  }
});

// 更新用户
router.patch('/:id', async (req, res, next) => {
  try {
    const operatorId = req.user?.userId;
    const permission = await requireAdmin(operatorId);
    if (!permission.ok) {
      return res.status(403).json(permission.response);
    }

    const userId = req.params.id;
    const { name, email, isAdmin, currentLevel, xp, password } = req.body;

    const existing = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isAdmin: true }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: '用户不存在' }
      });
    }

    if (typeof isAdmin === 'boolean' && userId === operatorId && isAdmin === false) {
      return res.status(400).json({
        success: false,
        error: { message: '不能取消当前登录管理员的管理员权限' }
      });
    }

    // 最后管理员保护：把管理员降为普通用户前，确认剩余管理员 ≥ 2
    if (typeof isAdmin === 'boolean' && isAdmin === false && existing.isAdmin) {
      const remainingAdmins = await prisma.users.count({ where: { isAdmin: true } }) - 1;
      if (remainingAdmins <= 1) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'LAST_ADMIN_PROTECTED',
            message: '系统至少需要保留 2 名管理员，无法降级最后的管理员'
          }
        });
      }
    }

    if (email && email !== existing.email) {
      const duplicated = await prisma.users.findUnique({ where: { email: String(email) } });
      if (duplicated) {
        return res.status(409).json({
          success: false,
          error: { message: '邮箱已存在' }
        });
      }
    }

    const data: any = {
      ...(name !== undefined && { name: String(name) }),
      ...(email !== undefined && { email: String(email) }),
      ...(typeof isAdmin === 'boolean' && { isAdmin, role: isAdmin ? 'admin' : 'user' }),
      ...(currentLevel !== undefined && { currentLevel: String(currentLevel) }),
      ...(xp !== undefined && { xp: Number(xp) || 0 }),
      updatedAt: new Date()
    };

    if (password) {
      const passwordError = validatePasswordRule(String(password));
      if (passwordError) {
        return res.status(400).json({
          success: false,
          error: { message: passwordError }
        });
      }
      data.password = await bcrypt.hash(String(password), SALT_ROUNDS);
    }

    const updated = await prisma.users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isAdmin: true,
        currentLevel: true,
        xp: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (error: any) {
    next(error);
  }
});

// 批量删除用户
router.post('/batch-delete', async (req, res, next) => {
  try {
    const operatorId = req.user?.userId;
    const permission = await requireAdmin(operatorId);
    if (!permission.ok) {
      return res.status(403).json(permission.response);
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!(Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every((item: any) => typeof item === 'string'))) {
      return res.status(400).json({
        success: false,
        error: { message: 'ids 必须是 1-100 个用户 ID 字符串的数组' }
      });
    }

    if (operatorId && ids.includes(operatorId)) {
      return res.status(400).json({
        success: false,
        error: { message: '批量删除中不能包含当前登录管理员账号' }
      });
    }

    // 虚拟学习者保护：虚拟用户由虚拟学习者管理模块维护，不允许在此直接删除
    const virtualProfiles = await prisma.virtual_learner_profiles.findMany({
      where: { userId: { in: ids } },
      select: { userId: true }
    });
    if (virtualProfiles.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'VIRTUAL_LEARNER_PROTECTED',
          message: `以下用户是虚拟学习者底层账号，请在「虚拟学习者管理」中处理：${virtualProfiles.map((p) => p.userId).join(', ')}`
        }
      });
    }

    // 最后管理员保护：删除管理员前统计删除后的剩余管理员数量
    const adminsInBatch = await prisma.users.findMany({
      where: { id: { in: ids }, isAdmin: true },
      select: { id: true }
    });
    if (adminsInBatch.length > 0) {
      const remainingAdmins = await prisma.users.count({ where: { isAdmin: true } }) - adminsInBatch.length;
      if (remainingAdmins <= 1) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'LAST_ADMIN_PROTECTED',
            message: '系统至少需要保留 2 名管理员，批量删除中不能包含最后的管理员'
          }
        });
      }
    }

    const result = await prisma.users.deleteMany({
      where: {
        id: { in: ids }
      }
    });

    res.json({
      success: true,
      data: {
        deletedCount: result.count
      }
    });
  } catch (error: any) {
    next(error);
  }
});

// 兼容旧接口：更新用户角色
router.patch('/:id/role', async (req, res, next) => {
  try {
    const operatorId = req.user?.userId;
    const permission = await requireAdmin(operatorId);
    if (!permission.ok) {
      return res.status(403).json(permission.response);
    }

    const userId = req.params.id;
    const { role } = req.body;

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: { message: 'role 仅支持 admin 或 user' }
      });
    }

    if (userId === operatorId && role !== 'admin') {
      return res.status(400).json({
        success: false,
        error: { message: '不能取消当前登录管理员的管理员权限' }
      });
    }

    const updated = await prisma.users.update({
      where: { id: userId },
      data: {
        role,
        isAdmin: role === 'admin',
        updatedAt: new Date()
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isAdmin: true,
        currentLevel: true,
        xp: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (error: any) {
    next(error);
  }
});

// 删除用户
router.delete('/:id', async (req, res, next) => {
  try {
    const operatorId = req.user?.userId;
    const permission = await requireAdmin(operatorId);
    if (!permission.ok) {
      return res.status(403).json(permission.response);
    }

    const userId = req.params.id;
    if (userId === operatorId) {
      return res.status(400).json({
        success: false,
        error: { message: '不能删除当前登录管理员账号' }
      });
    }

    const target = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, isAdmin: true }
    });

    if (!target) {
      return res.status(404).json({
        success: false,
        error: { message: '用户不存在' }
      });
    }

    // 最后管理员保护：删除管理员前统计剩余管理员数量
    if (target.isAdmin) {
      const remainingAdmins = await prisma.users.count({ where: { isAdmin: true } }) - 1;
      if (remainingAdmins <= 1) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'LAST_ADMIN_PROTECTED',
            message: '系统至少需要保留 2 名管理员，无法删除最后的管理员'
          }
        });
      }
    }

    await prisma.users.delete({ where: { id: userId } });

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
