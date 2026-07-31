/**
 * Agent API 路由（仅保留 /list，供前端模型配置页使用）
 */

import { Router, Request, Response } from 'express';
import { getGateway } from '../gateway';

const router = Router();

/**
 * 获取所有 Agent 列表
 */
router.get('/list', async (_req: Request, res: Response) => {
  try {
    const gateway = getGateway();
    const agents = gateway.matchAgents({});

    res.json({
      success: true,
      data: agents.map(a => ({
        id: a.definition.id,
        name: a.definition.name,
        version: a.definition.version,
        type: a.definition.type,
        category: a.definition.category,
        description: a.definition.description,
        capabilities: a.definition.capabilities,
        stats: a.definition.stats
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
