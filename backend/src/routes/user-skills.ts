// 用户 Skill 自定义路由
import express from 'express';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

router.use(authMiddleware);

// 获取用户 Skill 配置列表
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

// 获取 Skill 配置详情
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

// 创建/更新 Skill 配置
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const {
      skillName,
      sourceType = 'CUSTOM',
      codeRepositoryId,
      parameters,
      customCode,
      endpoint
    } = req.body;

    if (!skillName) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少必填字段：skillName' }
      });
    }

    if (sourceType === 'CUSTOM' && !codeRepositoryId && !customCode && !endpoint) {
      return res.status(400).json({
        success: false,
        error: { message: '自定义 Skill 需要提供 codeRepositoryId、customCode 或 endpoint' }
      });
    }

    const existing = await prisma.user_skill_configs.findFirst({
      where: { userId, skillName }
    });

    let skill;
    
    if (existing) {
      skill = await prisma.user_skill_configs.update({
        where: { id: existing.id },
        data: {
          sourceType,
          codeRepositoryId,
          parameters,
          customCode,
          endpoint,
          updatedAt: new Date()
        }
      });
    } else {
      const data: any = {
        id: uuidv4(),
        skillName,
        sourceType,
        codeRepositoryId,
        parameters,
        customCode,
        endpoint,
        enabled: true,
        updatedAt: new Date(),
        users: {
          connect: { id: userId }
        }
      };
      skill = await prisma.user_skill_configs.create({ data });
    }

    res.json({
      success: true,
      data: skill
    });
  } catch (error) {
    next(error);
  }
});

// 更新 Skill 配置
router.put('/:name', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;
    const { parameters, customCode, endpoint, codeRepositoryId } = req.body;

    const skill = await prisma.user_skill_configs.findFirst({
      where: { userId, skillName: name }
    });

    if (!skill) {
      return res.status(404).json({
        success: false,
        error: { message: 'Skill 配置不存在' }
      });
    }

    const updated = await prisma.user_skill_configs.update({
      where: { id: skill.id },
      data: {
        ...(parameters !== undefined && { parameters }),
        ...(customCode !== undefined && { customCode }),
        ...(endpoint !== undefined && { endpoint }),
        ...(codeRepositoryId !== undefined && { codeRepositoryId }),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// 删除 Skill 配置
router.delete('/:name', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;

    const skill = await prisma.user_skill_configs.findFirst({
      where: { userId, skillName: name }
    });

    if (!skill) {
      return res.status(404).json({
        success: false,
        error: { message: 'Skill 配置不存在' }
      });
    }

    await prisma.user_skill_configs.delete({
      where: { id: skill.id }
    });

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    next(error);
  }
});

// 启用/禁用 Skill
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

// 测试 Skill
router.post('/:name/test', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.params;
    const { input } = req.body;

    const skill = await prisma.user_skill_configs.findFirst({
      where: { userId, skillName: name }
    });

    if (!skill) {
      return res.status(404).json({
        success: false,
        error: { message: 'Skill 配置不存在' }
      });
    }

    if (skill.codeRepositoryId) {
      const repo = await prisma.user_code_repositories.findUnique({
        where: { id: skill.codeRepositoryId }
      });

      if (repo) {
        try {
          const userFunction = new Function('input', `${repo.code}; return execute(input);`);
          const result = await userFunction(input);

          res.json({
            success: true,
            data: { result, executedAt: new Date() }
          });
          return;
        } catch (error: any) {
          res.status(400).json({
            success: false,
            error: { message: '代码执行失败', details: error.message }
          });
          return;
        }
      }
    }

    if (skill.customCode) {
      try {
        const userFunction = new Function('input', `${skill.customCode}; return execute(input);`);
        const result = await userFunction(input);

        res.json({
          success: true,
          data: { result, executedAt: new Date() }
        });
        return;
      } catch (error: any) {
        res.status(400).json({
          success: false,
          error: { message: '代码执行失败', details: error.message }
        });
        return;
      }
    }

    res.status(400).json({
      success: false,
      error: { message: 'Skill 没有可执行的代码' }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
