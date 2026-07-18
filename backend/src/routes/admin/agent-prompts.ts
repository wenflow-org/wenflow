/**
 * Agent Prompt 管理 API（只读模式，File-as-Truth 架构）
 * 
 * 【重要变更】
 * - prompts/*.md 文件是唯一权威源，进 git
 * - 在线编辑功能已禁用：POST create、PUT update、DELETE、PUT publish 不再可用
 * - 只保留只读查看：GET list、GET detail、GET stats
 * - 修改 prompt 的唯一方式：编辑 prompts/*.md 文件 + git commit + 启动/手动 sync
 */

import { Router, Request, Response } from 'express';
import systemPrisma from '../../config/system-database';
import { randomUUID as uuidv4 } from 'crypto';
import { logger } from '../../utils/logger';
import { getAgentManifest, getCanonicalAgentId } from '../../services/agent-manifest.service';
import {
  loadCoreAgentPromptSeeds,
  ensureCoreAgentPrompts,
} from '../../scripts/seed-core-agent-prompts';
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

router.post('/seed-core', async (_req: Request, res: Response) => {
  try {
    const result = await ensureCoreAgentPrompts(systemPrisma, 'backfill');
    res.json({
      success: true,
      data: {
        seeds: loadCoreAgentPromptSeeds().map((seed) => ({
          agentId: seed.agentId,
          name: seed.name,
        })),
        result,
      },
    });
  } catch (error) {
    logger.error('初始化核心 Agent Prompt 失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '初始化核心 Agent Prompt 失败' },
    });
  }
});

// POST /api/admin/agent-prompts
// 创建新版本（草稿状态）
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      agentId,
      name,
      description,
      systemPrompt,
      temperature,
      maxTokens,
      model,
    } = req.body;

    // 验证必填字段
    if (!agentId || !name || !systemPrompt) {
      return res.status(400).json({
        success: false,
        error: { message: 'agentId, name, systemPrompt 是必填字段' },
      });
    }

    // 获取当前最大版本号
    const latestVersion = await systemPrisma.agent_prompts.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const newVersion = (latestVersion?.version || 0) + 1;

    const resolvedModel = (model || process.env.AI_MODEL || '').trim();
    if (!resolvedModel) {
      return res.status(400).json({
        success: false,
        error: { message: 'model 未配置，请在管理员配置默认模型或请求中传入 model' },
      });
    }

    // 创建新版本
    const prompt = await systemPrisma.agent_prompts.create({
      data: {
        id: uuidv4(),
        agentId,
        version: newVersion,
        name,
        description: description || null,
        systemPrompt,
        temperature: temperature ?? 0.7,
        maxTokens: maxTokens ?? 2000,
        model: resolvedModel,
        status: 'DRAFT',
        createdBy: req.body.createdBy || 'admin',
      },
    });

    logger.info(`创建新 Prompt 版本: ${agentId} v${newVersion}`);

    res.status(201).json({
      success: true,
      data: prompt,
    });
  } catch (error) {
    logger.error('创建 Prompt 版本失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '创建 Prompt 版本失败' },
    });
  }
});

// PUT /api/admin/agent-prompts/:id/publish
// 发布版本：把指定版本状态置为 ACTIVE，同时把同 agentId 的其他 ACTIVE 改为 ARCHIVED
router.put('/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const target = await systemPrisma.agent_prompts.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ success: false, error: { message: 'Prompt 版本不存在' } });
    }

    await systemPrisma.$transaction([
      systemPrisma.agent_prompts.updateMany({
        where: { agentId: target.agentId, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      }),
      systemPrisma.agent_prompts.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          publishedAt: new Date(),
        },
      }),
    ]);

    const fresh = await systemPrisma.agent_prompts.findUnique({ where: { id } });

    logger.info(`Prompt 版本已发布: ${target.agentId} ${target.name} v${target.version}`);
    res.json({
      success: true,
      data: fresh,
      warning: '注意：File-as-Truth 架构下，下次启动若 prompts/*.md 与 DB 不一致会被覆盖',
    });
  } catch (error: any) {
    logger.error('发布 Prompt 版本失败:', error?.message || error);
    res.status(500).json({ success: false, error: { message: '发布 Prompt 版本失败' } });
  }
});

// PUT /api/admin/agent-prompts/:id
// 更新草稿版本（仅允许 status=DRAFT 的版本被改写；ACTIVE/ARCHIVED 不允许）
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await systemPrisma.agent_prompts.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: { message: 'Prompt 版本不存在' } });
    }
    if (existing.status !== 'DRAFT') {
      return res.status(409).json({
        success: false,
        error: { message: `仅允许编辑 DRAFT 状态的 Prompt（当前 status=${existing.status}）` },
      });
    }

    const { name, description, systemPrompt, temperature, maxTokens, model } = req.body || {};
    const data: any = {};
    if (typeof name === 'string') data.name = name;
    if (typeof description === 'string') data.description = description;
    if (typeof systemPrompt === 'string') data.systemPrompt = systemPrompt;
    if (typeof temperature === 'number') data.temperature = temperature;
    if (typeof maxTokens === 'number') data.maxTokens = maxTokens;
    if (typeof model === 'string' && model.trim()) data.model = model.trim();

    if (!Object.keys(data).length) {
      return res.status(400).json({ success: false, error: { message: '没有可更新字段' } });
    }
    data.updatedAt = new Date();

    const updated = await systemPrisma.agent_prompts.update({ where: { id }, data });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    logger.error('更新 Prompt 版本失败:', error?.message || error);
    res.status(500).json({ success: false, error: { message: '更新 Prompt 版本失败' } });
  }
});

// DELETE /api/admin/agent-prompts/:id
// 删除 Prompt 版本：仅允许 DRAFT 状态版本删除；ACTIVE/ARCHIVED 一律拒绝
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await systemPrisma.agent_prompts.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: { message: 'Prompt 版本不存在' } });
    }
    if (existing.status !== 'DRAFT') {
      return res.status(409).json({
        success: false,
        error: { message: `仅允许删除 DRAFT 状态的 Prompt（当前 status=${existing.status}）` },
      });
    }
    await systemPrisma.agent_prompts.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('删除 Prompt 版本失败:', error?.message || error);
    res.status(500).json({ success: false, error: { message: '删除 Prompt 版本失败' } });
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
