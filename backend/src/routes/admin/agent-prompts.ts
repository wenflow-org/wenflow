/**
 * Agent Prompt 管理 API
 * 提供 Lab 层对 Prompt 的版本管理功能
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

const router = Router();
const prisma = new PrismaClient();

// GET /api/admin/agent-prompts
// 列出所有 Agent 的 Prompt 版本
router.get('/', async (req: Request, res: Response) => {
  try {
    const { agentId, status } = req.query;

    const where: any = {};
    if (agentId) {
      where.agentId = agentId as string;
    }
    if (status) {
      where.status = status as string;
    }

    const prompts = await prisma.agent_prompts.findMany({
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

    const prompt = await prisma.agent_prompts.findFirst({
      where: {
        agentId,
        status: 'ACTIVE',
      },
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

    const prompt = await prisma.agent_prompts.findUnique({
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
    const latestVersion = await prisma.agent_prompts.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const newVersion = (latestVersion?.version || 0) + 1;

    // 创建新版本
    const prompt = await prisma.agent_prompts.create({
      data: {
        id: uuidv4(),
        agentId,
        version: newVersion,
        name,
        description: description || null,
        systemPrompt,
        temperature: temperature ?? 0.7,
        maxTokens: maxTokens ?? 2000,
        model: model || process.env.AI_MODEL || 'deepseek-chat',
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
// 发布版本（设为 ACTIVE，之前的 ACTIVE 设为 ARCHIVED）
router.put('/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 查找要发布的版本
    const promptToPublish = await prisma.agent_prompts.findUnique({
      where: { id },
    });

    if (!promptToPublish) {
      return res.status(404).json({
        success: false,
        error: { message: 'Prompt 版本不存在' },
      });
    }

    if (promptToPublish.status === 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: { message: '该版本已经是 ACTIVE 状态' },
      });
    }

    // 使用事务：归档旧的 ACTIVE 版本，发布新版本
    const result = await prisma.$transaction(async (tx) => {
      // 归档旧的 ACTIVE 版本
      await tx.agent_prompts.updateMany({
        where: {
          agentId: promptToPublish.agentId,
          status: 'ACTIVE',
        },
        data: {
          status: 'ARCHIVED',
        },
      });

      // 发布新版本
      const published = await tx.agent_prompts.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          updatedAt: new Date(),
        },
      });

      return published;
    });

    logger.info(`发布 Prompt 版本: ${result.agentId} v${result.version}`);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('发布 Prompt 版本失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '发布 Prompt 版本失败' },
    });
  }
});

// PUT /api/admin/agent-prompts/:id
// 更新草稿版本（只有 DRAFT 可以更新）
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, systemPrompt, temperature, maxTokens, model } = req.body;

    // 查找版本
    const existing = await prisma.agent_prompts.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: 'Prompt 版本不存在' },
      });
    }

    if (existing.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        error: { message: '只有 DRAFT 状态的版本可以更新' },
      });
    }

    // 更新版本
    const updated = await prisma.agent_prompts.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        description: description ?? existing.description,
        systemPrompt: systemPrompt ?? existing.systemPrompt,
        temperature: temperature ?? existing.temperature,
        maxTokens: maxTokens ?? existing.maxTokens,
        model: model ?? existing.model,
      },
    });

    logger.info(`更新 Prompt 版本: ${updated.agentId} v${updated.version}`);

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error('更新 Prompt 版本失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '更新 Prompt 版本失败' },
    });
  }
});

// DELETE /api/admin/agent-prompts/:id
// 删除草稿版本（只有 DRAFT 可以删除）
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 查找版本
    const existing = await prisma.agent_prompts.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: 'Prompt 版本不存在' },
      });
    }

    if (existing.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        error: { message: '只有 DRAFT 状态的版本可以删除' },
      });
    }

    // 删除版本
    await prisma.agent_prompts.delete({
      where: { id },
    });

    logger.info(`删除 Prompt 版本: ${existing.agentId} v${existing.version}`);

    res.json({
      success: true,
      message: 'Prompt 版本已删除',
    });
  } catch (error) {
    logger.error('删除 Prompt 版本失败:', error);
    res.status(500).json({
      success: false,
      error: { message: '删除 Prompt 版本失败' },
    });
  }
});

// GET /api/admin/agent-prompts/stats/overview
// 获取 Prompt 使用统计概览
router.get('/stats/overview', async (req: Request, res: Response) => {
  try {
    const stats = await prisma.agent_prompts.groupBy({
      by: ['agentId', 'status'],
      _count: {
        id: true,
      },
      _sum: {
        useCount: true,
      },
    });

    // 获取总体统计
    const totalStats = await prisma.agent_prompts.aggregate({
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

export default router;
