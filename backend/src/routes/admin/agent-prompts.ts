/**
 * Agent Prompt 管理 API（只读模式，File-as-Truth 架构）
 * 
 * 【重要变更】
 * - prompts/*.md 文件是唯一权威源，进 git
 * - 写端点（POST create、PUT update、DELETE、PUT publish、POST seed-core）已整体移除；
 *   路由级 rejectAgentPromptMutation 仍挂载，防止未来误加写端点
 * - 只保留只读查看：GET list、GET compare
 *   （只读 4 端点 active/detail/stats-overview/history 已删：列表已含全量状态与按 agentId 过滤，
 *   版本详情/统计/历史分别由 workbench-meta、overview/stats、prompt-lab 覆盖）
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

// GET /api/admin/agent-prompts/detail/:id 已删（列表含 status，详情由 workbench-meta / prompt-lab core-list 覆盖）

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
