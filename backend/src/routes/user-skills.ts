// 用户 Skill 配置路由（只读模式）
// 用户只能查看系统配置的 Skills，不能创建、修改或执行自定义代码
import express from 'express';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

router.use(authMiddleware);

// 获取用户 Skill 配置列表（只读）
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const enabled = req.query.enabled as string;

    const where: any = { userId };
    
    if (enabled !== undefined) {
      where.enabled = enabled === 'true';
    }

    const skills = await prisma.user_skill_configs.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        skillName: true,
        enabled: true,
        sourceType: true,
        endpoint: true,
        parameters: true,
        stats: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: skills,
      total: skills.length
    });
  } catch (error) {
    next(error);
  }
});

// 获取 Skill 配置详情（只读）
router.get('/:name', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;

    const skill = await prisma.user_skill_configs.findFirst({
      where: {
        userId,
        skillName: name
      }
    });

    if (!skill) {
      return res.status(404).json({
        success: false,
        error: { message: 'Skill 配置不存在' }
      });
    }

    res.json({
      success: true,
      data: skill
    });
  } catch (error) {
    next(error);
  }
});

// 启用/禁用 Skill（保留此功能，用户可以控制是否启用某个 Skill）
router.post('/:name/enable', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;
    const { enabled } = req.body;

    const skill = await prisma.user_skill_configs.findFirst({
      where: { userId, skillName: name }
    });

    if (!skill) {
      return res.status(404).json({
        success: false,
        error: { message: 'Skill 配置不存在' }
      });
    }

    await prisma.user_skill_configs.update({
      where: { id: skill.id },
      data: { enabled: enabled !== false, updatedAt: new Date() }
    });

    res.json({
      success: true,
      message: `Skill 已${enabled !== false ? '启用' : '禁用'}`
    });
  } catch (error) {
    next(error);
  }
});

// 以下端点已移除（出于安全考虑）：
// - POST / (创建自定义 Skill)
// - PUT /:name (更新自定义 Skill)
// - DELETE /:name (删除自定义 Skill)
// - POST /:name/test (执行自定义代码)
// 
// 所有 Skill 配置由管理员通过 /api/admin/skills 管理

export default router;
