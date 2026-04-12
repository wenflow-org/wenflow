// 用户代码仓库路由
import express from 'express';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// 所有路由都需要认证
router.use(authMiddleware);

// 获取当前用户的代码仓库列表
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const type = req.query.type as string;
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string) || 100;

    const where: any = { userId };
    
    if (type) {
      where.type = type;
    }
    
    if (status) {
      where.status = status;
    }

    const repositories = await prisma.user_code_repositories.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        type: true,
        version: true,
        status: true,
        description: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: repositories,
      total: repositories.length
    });
  } catch (error) {
    next(error);
  }
});

// 获取代码仓库详情
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const repository = await prisma.user_code_repositories.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!repository) {
      return res.status(404).json({
        success: false,
        error: { message: '代码仓库不存在' }
      });
    }

    res.json({
      success: true,
      data: repository
    });
  } catch (error) {
    next(error);
  }
});

// 创建/更新代码仓库
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const {
      name,
      type,
      code,
      description,
      inputSchema,
      outputSchema,
      metadata
    } = req.body;

    // 验证必填字段
    if (!name || !type || !code) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少必填字段：name, type, code' }
      });
    }

    // 验证 type
    if (!['AGENT', 'SKILL', 'MCP_TOOL'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: { message: 'type 必须是 AGENT, SKILL 或 MCP_TOOL' }
      });
    }

    // 检查是否已存在同名仓库
    const existing = await prisma.user_code_repositories.findFirst({
      where: {
        userId,
        name,
        type
      }
    });

    let repository;
    
    if (existing) {
      // 更新现有仓库
      repository = await prisma.user_code_repositories.update({
        where: { id: existing.id },
        data: {
          code,
          description,
          inputSchema,
          outputSchema,
          metadata,
          version: incrementVersion(existing.version),
          updatedAt: new Date()
        }
      });
    } else {
      // 创建新仓库
      const data: any = {
        id: uuidv4(),
        name,
        type,
        code,
        description,
        inputSchema,
        outputSchema,
        metadata,
        version: '1.0.0',
        status: 'active',
        updatedAt: new Date(),
        users: {
          connect: { id: userId }
        }
      };
      repository = await prisma.user_code_repositories.create({ data });
    }

    res.json({
      success: true,
      data: repository
    });
  } catch (error) {
    next(error);
  }
});

// 删除代码仓库
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const repository = await prisma.user_code_repositories.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!repository) {
      return res.status(404).json({
        success: false,
        error: { message: '代码仓库不存在' }
      });
    }

    await prisma.user_code_repositories.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    next(error);
  }
});

// 测试执行代码
router.post('/:id/test', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { input } = req.body;

    const repository = await prisma.user_code_repositories.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!repository) {
      return res.status(404).json({
        success: false,
        error: { message: '代码仓库不存在' }
      });
    }

    // 简单执行用户代码（无沙盒限制，用户自行负责）
    try {
      // 创建一个函数并执行
      const userFunction = new Function('input', `${repository.code}; return execute(input);`);
      const result = await userFunction(input);

      res.json({
        success: true,
        data: {
          result,
          executedAt: new Date()
        }
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: { 
          message: '代码执行失败',
          details: error.message
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

// 辅助函数：版本号递增
function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

export default router;
