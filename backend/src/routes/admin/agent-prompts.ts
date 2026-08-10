/**
 * Agent Prompt 管理 API（只读模式，File-as-Truth 架构）
 * 
 * 【重要变更】
 * - prompts/*.md 文件是唯一权威源，进 git
 * - 写端点（POST create、PUT update、DELETE、PUT publish、POST seed-core）已整体移除；
 *   路由级 rejectAgentPromptMutation 仍挂载，防止未来误加写端点
 * - 只保留只读查看：GET list、GET active、GET detail、GET stats、GET history、GET compare
 * - 修改 prompt 的唯一方式：编辑 prompts/*.md 文件 + git commit + 启动/手动 sync
 */

import { Router, Request, Response } from 'express';
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import { getAgentManifest, getCanonicalAgentId } from '../../services/agent-manifest.service';
import { rejectAgentPromptMutation } from '../../middleware/prompt-file-truth.middleware';

const router = Router();
router.use(rejectAgentPromptMutation);

function resolveAgentPromptIds(agentId: string): string[] {
  const canonicalId = getCanonicalAgentId(agentId);
  const manifest = getAgentManifest(agentId);
  const ids = new Set<string>([agentId, canonicalId]);

  for (const alias of manifest?.aliases || []) {
    ids.add(alias);
  }

  return Array.from(ids);
}

// GET /api/admin/agent-prompts
// 列出所有 Agent 的 Prompt 版本
router.get('/', async (req: Request, res: Response) => {
  try {
    const { agentId, status } = req.query;

    const where: any = {};
    if (agentId) {
      where.agentId = { in: resolveAgentPromptIds(agentId as string) };
    }
    if (status) {
      where.status = status as string;
    }

    const prompts = await systemPrisma.agent_prompts.findMany({
      where,
      orderBy: [
        { agentId: 'asc' },
        { version: 'desc' },
      ],
      select: {
        id: true,
        agentId: true,
        version: true,
        name: true,
        description: true,
        status: true,
        model: true,
        temperature: true,
        maxTokens: true,
        useCount: true,
        avgLatency: true,
        successRate: true,
        createdBy: true,
        createdAt: true,
        // 不包含 systemPrompt，避免数据过大
      },
    });

    // 按 agentId 分组
    const grouped = prompts.reduce((acc: any, prompt) => {
      if (!acc[prompt.agentId]) {
        acc[prompt.agentId] = [];
      }
      acc[prompt.agentId].push(prompt);
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        list: prompts,
        grouped,
        total: prompts.length,
      },
    });
  } catch (error) {
    logger.error('获取 Agent Prompts 失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取 Agent Prompts 失败' },
    });
  }
});

// GET /api/admin/agent-prompts/:agentId/active
// 获取指定 Agent 当前活跃的 Prompt
router.get('/:agentId/active', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const agentIds = resolveAgentPromptIds(agentId);

    const prompt = await systemPrisma.agent_prompts.findFirst({
      where: {
        agentId: { in: agentIds },
        status: 'ACTIVE',
      },
      orderBy: [
        { publishedAt: 'desc' },
        { updatedAt: 'desc' },
        { version: 'desc' },
      ],
    });

    if (!prompt) {
      return res.status(404).json({
        success: false,
        error: { message: '未找到活跃的 Prompt 版本' },
      });
    }

    res.json({
      success: true,
      data: prompt,
    });
  } catch (error) {
    logger.error('获取活跃 Prompt 失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取活跃 Prompt 失败' },
    });
  }
});

// GET /api/admin/agent-prompts/:id
// 获取特定版本详情
router.get('/detail/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const prompt = await systemPrisma.agent_prompts.findUnique({
      where: { id },
    });

    if (!prompt) {
      return res.status(404).json({
        success: false,
        error: { message: 'Prompt 版本不存在' },
      });
    }

    res.json({
      success: true,
      data: prompt,
    });
  } catch (error) {
    logger.error('获取 Prompt 详情失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取 Prompt 详情失败' },
    });
  }
});

// GET /api/admin/agent-prompts/stats/overview
// 获取 Prompt 使用统计概览
router.get('/stats/overview', async (req: Request, res: Response) => {
  try {
    const stats = await systemPrisma.agent_prompts.groupBy({
      by: ['agentId', 'status'],
      _count: {
        id: true,
      },
      _sum: {
        useCount: true,
      },
    });

    // 获取总体统计
    const totalStats = await systemPrisma.agent_prompts.aggregate({
      _count: { id: true },
      _sum: { useCount: true },
    });

    res.json({
      success: true,
      data: {
        byAgent: stats,
        total: totalStats,
      },
    });
  } catch (error) {
    logger.error('获取 Prompt 统计失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取 Prompt 统计失败' },
    });
  }
});

/**
 * 获取指定 agent 的 prompt 版本历史（含已归档版本）
 * GET /api/admin/agent-prompts/:agentId/history
 */
router.get('/:agentId/history', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const prompts = await systemPrisma.agent_prompts.findMany({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        name: true,
        description: true,
        temperature: true,
        maxTokens: true,
        useCount: true,
        avgLatency: true,
        successRate: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json({ success: true, data: prompts });
  } catch (error) {
    logger.error('获取 Prompt 历史失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '获取 Prompt 历史失败' },
    });
  }
});

/**
 * 对比两个 Prompt 版本
 * GET /api/admin/agent-prompts/compare?a=<promptId>&b=<promptId>
 * 返回并排对比，含 systemPrompt diff
 */
router.get('/compare', async (req: Request, res: Response) => {
  try {
    const idA = typeof req.query.a === 'string' ? req.query.a : '';
    const idB = typeof req.query.b === 'string' ? req.query.b : '';
    if (!idA || !idB) {
      return res.status(400).json({ success: false, error: '缺少 a 或 b 参数' });
    }

    const [promptA, promptB] = await Promise.all([
      systemPrisma.agent_prompts.findUnique({ where: { id: idA } }),
      systemPrisma.agent_prompts.findUnique({ where: { id: idB } }),
    ]);

    if (!promptA) return res.status(404).json({ success: false, error: `Prompt ${idA} 未找到` });
    if (!promptB) return res.status(404).json({ success: false, error: `Prompt ${idB} 未找到` });

    const linesA = (promptA.systemPrompt || '').split('\n');
    const linesB = (promptB.systemPrompt || '').split('\n');
    const maxLen = Math.max(linesA.length, linesB.length);
    const diffs: Array<{ type: 'same' | 'added' | 'removed' | 'modified'; aLine?: number; bLine?: number; aText?: string; bText?: string }> = [];

    for (let i = 0; i < maxLen; i++) {
      const aLine = linesA[i] !== undefined ? linesA[i] : undefined;
      const bLine = linesB[i] !== undefined ? linesB[i] : undefined;
      if (aLine === undefined && bLine !== undefined) {
        diffs.push({ type: 'added', bLine: i + 1, bText: bLine });
      } else if (bLine === undefined && aLine !== undefined) {
        diffs.push({ type: 'removed', aLine: i + 1, aText: aLine });
      } else if (aLine !== bLine) {
        diffs.push({ type: 'modified', aLine: i + 1, bLine: i + 1, aText: aLine, bText: bLine });
      } else {
        diffs.push({ type: 'same', aLine: i + 1, bLine: i + 1, aText: aLine });
      }
    }

    res.json({
      success: true,
      data: {
        a: { id: promptA.id, agentId: promptA.agentId, version: promptA.version, name: promptA.name, status: promptA.status, temperature: promptA.temperature, maxTokens: promptA.maxTokens },
        b: { id: promptB.id, agentId: promptB.agentId, version: promptB.version, name: promptB.name, status: promptB.status, temperature: promptB.temperature, maxTokens: promptB.maxTokens },
        diffs,
        totalLines: maxLen,
        changedLines: diffs.filter(d => d.type !== 'same').length,
      },
    });
  } catch (error) {
    logger.error('Prompt 对比失败:', error);
    res.status(500).json({ success: false, error: { message: 'Prompt 对比失败' } });
  }
});

export default router;
